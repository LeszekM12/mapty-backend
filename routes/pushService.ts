// ─── PUSH NOTIFICATION SERVICE ───────────────────────────────────────────────
// Zmiana: subskrypcje w MongoDB zamiast in-memory — przeżyją restart Rendera!

import webpush from 'web-push';
import { Router, Request, Response } from 'express';
import { PushSubscription } from '../models/PushSubscription.js';

// ── VAPID setup ───────────────────────────────────────────────────────────────

let vapidPublicKey:  string;
let vapidPrivateKey: string;

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  vapidPublicKey  = process.env.VAPID_PUBLIC_KEY;
  vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  console.log('[Push] ✅ VAPID keys loaded from environment.');
} else {
  const keys = webpush.generateVAPIDKeys();
  vapidPublicKey  = keys.publicKey;
  vapidPrivateKey = keys.privateKey;
  console.warn('⚠️  VAPID keys generated dynamically — zapisz je w .env na Render!');
  console.warn(`VAPID_PUBLIC_KEY=${vapidPublicKey}`);
  console.warn(`VAPID_PRIVATE_KEY=${vapidPrivateKey}`);
}

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL ?? 'admin@mapyou.app'}`,
  vapidPublicKey,
  vapidPrivateKey,
);

// ── Wysyłka do listy subskrypcji ──────────────────────────────────────────────

interface PushPayload {
  title:  string;
  body:   string;
  icon?:  string;
  badge?: string;
  url?:   string;
}

async function sendToSubscriptions(
  subs:    { subId: string; endpoint: string; expirationTime: number | null; keys: { p256dh: string; auth: string } }[],
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  if (!subs.length) return { sent: 0, failed: 0 };

  const results = await Promise.allSettled(
    subs.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, expirationTime: sub.expirationTime ?? undefined, keys: sub.keys },
        JSON.stringify(payload),
      ).catch(async (err: { statusCode?: number }) => {
        if (err.statusCode === 410) {
          // Subskrypcja wygasła — usuń z MongoDB
          await PushSubscription.deleteOne({ subId: sub.subId });
          console.log(`[Push] Removed expired subscription: ${sub.subId}`);
        }
        throw err;
      }),
    ),
  );

  return {
    sent:   results.filter(r => r.status === 'fulfilled').length,
    failed: results.filter(r => r.status === 'rejected').length,
  };
}

// ── Router ────────────────────────────────────────────────────────────────────

export const pushRouter = Router();

// Eksportuj klucz publiczny dla webpush live tracking
export { vapidPublicKey };

// GET /push/vapid-public-key
pushRouter.get('/vapid-public-key', (_req: Request, res: Response) => {
  res.json({ status: 'ok', publicKey: vapidPublicKey });
});

// POST /push/subscribe
pushRouter.post('/subscribe', async (req: Request, res: Response) => {
  const body = req.body as {
    userId?:         string;
    deviceId?:       string;
    endpoint?:       string;
    expirationTime?: number | null;
    keys?: { p256dh?: string; auth?: string };
  };

  if (!body.userId || !body.deviceId || !body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return void res.status(400).json({ status: 'error', message: 'Missing required fields' });
  }

  try {
    // Usuń stary rekord z tym samym endpoint jeśli należał do innego userId
    await PushSubscription.deleteOne({
      endpoint: body.endpoint,
      subId: { $ne: `${body.userId}:${body.deviceId}` }
    });
    await PushSubscription.findOneAndUpdate(
      { subId: `${body.userId}:${body.deviceId}` },
      {
        subId:          `${body.userId}:${body.deviceId}`,
        userId:         body.userId,
        deviceId:       body.deviceId,
        endpoint:       body.endpoint,
        expirationTime: body.expirationTime ?? null,
        keys:           { p256dh: body.keys.p256dh, auth: body.keys.auth },
      },
      { upsert: true, new: true },
    );
    console.log(`[Push] ✅ Subscribed: ${body.userId}:${body.deviceId}`);
    res.status(201).json({ status: 'ok', message: 'Subscribed' });
  } catch (err) {
    console.error('[Push] Subscribe error:', err);
    res.status(500).json({ status: 'error', message: String(err) });
  }
});

// POST /push/unsubscribe
pushRouter.post('/unsubscribe', async (req: Request, res: Response) => {
  const { endpoint, userId, deviceId } = req.body as {
    endpoint?: string; userId?: string; deviceId?: string;
  };

  let result;
  if (endpoint) {
    result = await PushSubscription.deleteOne({ endpoint });
  } else if (userId && deviceId) {
    result = await PushSubscription.deleteOne({ subId: `${userId}:${deviceId}` });
  } else {
    return void res.status(400).json({ status: 'error', message: 'Provide endpoint or userId+deviceId' });
  }

  if (!result.deletedCount) {
    return void res.status(404).json({ status: 'error', message: 'Subscription not found' });
  }
  res.json({ status: 'ok', message: 'Unsubscribed' });
});

// POST /push/notify/:userId
pushRouter.post('/notify/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  const body = req.body as Partial<PushPayload>;

  if (!body.title || !body.body) {
    return void res.status(400).json({ status: 'error', message: 'Missing title or body' });
  }

  const subs = await PushSubscription.find({ userId });
  if (!subs.length) {
    return void res.json({ status: 'ok', message: 'No subscriptions for this user', sent: 0 });
  }

  const payload: PushPayload = {
    title: body.title,
    body:  body.body,
    icon:  body.icon  ?? '/public/icon-192.png',
    badge: body.badge ?? '/public/icon-192.png',
    url:   body.url   ?? '/',
  };

  const { sent, failed } = await sendToSubscriptions(subs, payload);
  console.log(`[Push] notify userId=${userId}: sent=${sent} failed=${failed}`);
  res.json({ status: 'ok', sent, failed, devices: subs.length });
});

// POST /push/send — legacy endpoint (kompatybilność wsteczna)
pushRouter.post('/send', async (req: Request, res: Response) => {
  const body = req.body as Partial<PushPayload> & { userId?: string };
  if (!body.userId) {
    return void res.status(400).json({ status: 'error', message: 'userId required' });
  }
  req.params.userId = body.userId;
  // Re-use notify logic
  const subs = await PushSubscription.find({ userId: body.userId });
  if (!subs.length) return void res.json({ status: 'ok', sent: 0 });
  const { sent, failed } = await sendToSubscriptions(subs, {
    title: body.title ?? 'MapYou',
    body:  body.body  ?? '',
    icon:  body.icon,
    url:   body.url,
  });
  res.json({ status: 'ok', sent, failed });
});

// GET /push/subscriptions-for/:userId — pobierz subskrypcje dla konkretnego użytkownika
pushRouter.get('/subscriptions-for/:userId', async (req: Request, res: Response) => {
  const subs = await PushSubscription.find({ userId: req.params.userId })
    .select('endpoint expirationTime keys');
  res.json({ status: 'ok', data: subs.map(s => ({
    endpoint:       s.endpoint,
    expirationTime: s.expirationTime,
    keys:           s.keys,
  })) });
});

// GET /push/subscriptions — diagnostyka
pushRouter.get('/subscriptions', async (_req: Request, res: Response) => {
  const all = await PushSubscription.find();
  const byUser: Record<string, number> = {};
  for (const s of all) byUser[s.userId] = (byUser[s.userId] ?? 0) + 1;
  res.json({ status: 'ok', totalCount: all.length, byUser });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function pushToUser(userId: string, payload: PushPayload): Promise<void> {
  const subs = await PushSubscription.find({ userId });
  if (subs.length) void sendToSubscriptions(subs, payload);
}

async function pushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  for (const uid of [...new Set(userIds)]) await pushToUser(uid, payload);
}

async function getFollowersAndFriends(userId: string): Promise<string[]> {
  const { User } = await import('../models/User.js');
  const u = await User.findOne({ userId }).select('followers friends');
  if (!u) return [];
  return [...new Set([...(u.followers ?? []), ...(u.friends ?? [])])];
}

// ── Club notifications ───────────────────────────────────────────────────────

export async function notifyClubMembers(
  clubId:   string,
  authorId: string,
  title:    string,
  body:     string,
): Promise<void> {
  try {
    const { Club } = await import('../models/Club.js');
    const club = await Club.findOne({ clubId }).select('members');
    if (!club) return;
    const recipients = (club.members as string[]).filter(uid => uid !== authorId);
    for (const uid of recipients) {
      const subs = await PushSubscription.find({ userId: uid });
      if (subs.length) void sendToSubscriptions(subs, {
        title, body,
        icon:  '/public/icon-192.png',
        badge: '/public/icon-192.png',
        url:   `/#club_open=${clubId}`,
      });
    }
  } catch { /* non-critical */ }
}

// ── Social notifications ─────────────────────────────────────────────────────

/** Gdy użytkownik dodaje aktywność — push do followers + friends */
export async function notifyNewActivity(
  authorId: string, authorName: string,
  sport: string, distanceKm: number, activityName: string,
): Promise<void> {
  try {
    const recipients = await getFollowersAndFriends(authorId);
    if (!recipients.length) return;
    const icons: Record<string,string> = { running:'🏃', cycling:'🚴', walking:'🚶' };
    const icon = icons[sport] ?? '🏅';
    await pushToUsers(recipients, {
      title: `${icon} ${authorName}`,
      body:  activityName
        ? `${activityName} · ${distanceKm.toFixed(1)} km`
        : `${sport} · ${distanceKm.toFixed(1)} km`,
      icon:  '/public/icon-192.png',
      url:   '/',
    });
  } catch { /* non-critical */ }
}

/** Gdy użytkownik dodaje post — push do followers + friends */
export async function notifyNewPost(
  authorId: string, authorName: string,
  title: string, hasPhoto: boolean,
): Promise<void> {
  try {
    const recipients = await getFollowersAndFriends(authorId);
    if (!recipients.length) return;
    await pushToUsers(recipients, {
      title: `📸 ${authorName}`,
      body:  hasPhoto ? (title || 'Dodał nowe zdjęcie') : (title || 'Dodał nowy post'),
      icon:  '/public/icon-192.png',
      url:   '/',
    });
  } catch { /* non-critical */ }
}

/** Gdy ktoś daje lajka — push do właściciela itemu */
export async function notifyLike(
  likerId: string, likerName: string,
  ownerId: string, itemType: 'activity' | 'post',
): Promise<void> {
  if (likerId === ownerId) return;
  try {
    const label = itemType === 'activity' ? 'aktywność' : 'post';
    await pushToUser(ownerId, {
      title: `❤️ ${likerName}`,
      body:  `Polubił Twoją ${label}`,
      icon:  '/public/icon-192.png',
      url:   '/',
    });
  } catch { /* non-critical */ }
}

/** Gdy ktoś zaczyna obserwować — push do obserwowanego */
export async function notifyFollow(
  followerId: string, followerName: string,
  targetId: string,
): Promise<void> {
  if (followerId === targetId) return;
  try {
    await pushToUser(targetId, {
      title: `👋 ${followerName}`,
      body:  'Zaczął Cię obserwować',
      icon:  '/public/icon-192.png',
      url:   '/',
    });
  } catch { /* non-critical */ }
}

/** Gdy tracking się kończy — push do samego siebie */
export async function notifyActivityFinished(
  userId: string, sport: string, distanceKm: number, durationSec: number,
): Promise<void> {
  try {
    const icons: Record<string,string> = { running:'🏃', cycling:'🚴', walking:'🚶' };
    const icon = icons[sport] ?? '🏅';
    const min  = Math.floor(durationSec / 60);
    const h    = Math.floor(min / 60);
    const m    = min % 60;
    const time = h > 0 ? `${h}h ${m}min` : `${m}min`;
    await pushToUser(userId, {
      title: `${icon} Trening zapisany!`,
      body:  `${distanceKm.toFixed(2)} km · ${time} — świetna robota!`,
      icon:  '/public/icon-192.png',
      url:   '/',
    });
  } catch { /* non-critical */ }
}

// Eksportuj sendToSubscriptions do użycia w liveTracking
export { sendToSubscriptions };
