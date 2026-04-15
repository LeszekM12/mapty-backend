// ─── PUSH NOTIFICATION SERVICE ───────────────────────────────────────────────

import webpush from 'web-push';
import { Router, Request, Response } from 'express';
import { db } from './memoryDB.js';
import { PushSubscriptionRecord, PushPayload } from './Workout.js';

// ── VAPID setup ───────────────────────────────────────────────────────────────
//
// Klucze VAPID generowane są raz i trzymane w zmiennych środowiskowych.
// Jeśli nie ma kluczy w env → generujemy nowe i logujemy.
// Na Render: ustaw VAPID_PUBLIC_KEY i VAPID_PRIVATE_KEY w Environment.

let vapidPublicKey:  string;
let vapidPrivateKey: string;

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  vapidPublicKey  = process.env.VAPID_PUBLIC_KEY;
  vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  console.log('[Push] VAPID keys loaded from environment.');
} else {
  // Generuj nowe klucze (tylko przy pierwszym uruchomieniu bez env)
  const keys = webpush.generateVAPIDKeys();
  vapidPublicKey  = keys.publicKey;
  vapidPrivateKey = keys.privateKey;
  console.warn('┌─────────────────────────────────────────────────────┐');
  console.warn('│  ⚠️  VAPID keys generated — save them in .env!      │');
  console.warn('├─────────────────────────────────────────────────────┤');
  console.warn(`│  VAPID_PUBLIC_KEY=${vapidPublicKey}  │`);
  console.warn(`│  VAPID_PRIVATE_KEY=${vapidPrivateKey}  │`);
  console.warn('└─────────────────────────────────────────────────────┘');
}

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL ?? 'admin@mapty.app'}`,
  vapidPublicKey,
  vapidPrivateKey,
);

// ── Router ────────────────────────────────────────────────────────────────────

export const pushRouter = Router();

// GET /push/vapid-public-key — frontend pobiera klucz do subskrypcji
pushRouter.get('/vapid-public-key', (_req: Request, res: Response) => {
  res.json({ status: 'ok', publicKey: vapidPublicKey });
});

// POST /push/subscribe — zapisuje subskrypcję przeglądarki
pushRouter.post('/subscribe', (req: Request, res: Response) => {
  const body = req.body as {
    endpoint?:       string;
    expirationTime?: number | null;
    keys?: {
      p256dh?: string;
      auth?:   string;
    };
  };

  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    res.status(400).json({
      status:  'error',
      message: 'Missing endpoint, keys.p256dh or keys.auth',
    });
    return;
  }

  // Jeśli subskrypcja już istnieje — zaktualizuj, nie duplikuj
  const existing = db.getSubscriptionByEndpoint(body.endpoint);
  if (existing) {
    console.log(`[Push] Subscription already exists: ${existing.id}`);
    res.json({ status: 'ok', message: 'Already subscribed', id: existing.id });
    return;
  }

  const record: PushSubscriptionRecord = {
    id:             String(Date.now()),
    endpoint:       body.endpoint,
    expirationTime: body.expirationTime ?? null,
    keys: {
      p256dh: body.keys.p256dh,
      auth:   body.keys.auth,
    },
    createdAt: new Date().toISOString(),
  };

  db.saveSubscription(record);
  console.log(`[Push] New subscription saved: ${record.id}`);
  res.status(201).json({ status: 'ok', message: 'Subscribed', id: record.id });
});

// POST /push/unsubscribe — usuwa subskrypcję
pushRouter.post('/unsubscribe', (req: Request, res: Response) => {
  const { endpoint } = req.body as { endpoint?: string };
  if (!endpoint) {
    res.status(400).json({ status: 'error', message: 'Missing endpoint' });
    return;
  }

  const deleted = db.deleteSubscriptionByEndpoint(endpoint);
  if (!deleted) {
    res.status(404).json({ status: 'error', message: 'Subscription not found' });
    return;
  }

  console.log(`[Push] Subscription removed: ${endpoint.slice(0, 50)}...`);
  res.json({ status: 'ok', message: 'Unsubscribed' });
});

// POST /push/send — wysyła push do wszystkich subskrypcji
pushRouter.post('/send', async (req: Request, res: Response) => {
  const body = req.body as Partial<PushPayload>;

  if (!body.title || !body.body) {
    res.status(400).json({ status: 'error', message: 'Missing title or body' });
    return;
  }

  const payload: PushPayload = {
    title:  body.title,
    body:   body.body,
    icon:   body.icon  ?? '/icon-192.png',
    badge:  body.badge ?? '/icon-192.png',
    url:    body.url   ?? '/',
  };

  const subscriptions = db.getAllSubscriptions();
  if (subscriptions.length === 0) {
    res.json({ status: 'ok', message: 'No subscriptions to send to', sent: 0 });
    return;
  }

  const results = await Promise.allSettled(
    subscriptions.map(sub =>
      webpush.sendNotification(
        {
          endpoint:       sub.endpoint,
          expirationTime: sub.expirationTime,
          keys: {
            p256dh: sub.keys.p256dh,
            auth:   sub.keys.auth,
          },
        },
        JSON.stringify(payload),
      ).catch(async (err: { statusCode?: number }) => {
        // 410 Gone — subskrypcja wygasła, usuń ją
        if (err.statusCode === 410) {
          console.log(`[Push] Removing expired subscription: ${sub.id}`);
          db.deleteSubscription(sub.id);
        }
        throw err;
      }),
    ),
  );

  const sent   = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  console.log(`[Push] Sent: ${sent}, Failed: ${failed}`);
  res.json({
    status:  'ok',
    message: `Sent to ${sent}/${subscriptions.length} subscribers`,
    sent,
    failed,
  });
});

// GET /push/subscriptions — podgląd liczby subskrypcji (diagnostyczne)
pushRouter.get('/subscriptions', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    count:  db.subscriptionCount(),
  });
});
