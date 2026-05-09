// ─── LIVE TRACKING ROUTER v2 ─────────────────────────────────────────────────
// Sesje przechowywane w MongoDB — działa poprawnie na wielu maszynach Fly.io
// POST /live/start
// POST /live/update
// POST /live/pause
// POST /live/resume
// POST /live/finish
// GET  /live/status/:token
// GET  /live/active/:endpoint
// GET  /live/invite (POST)
// GET  /live/invite/:code

import { Router, Request, Response } from 'express';
import { LiveSession } from '../models/LiveSession.js';
import { sendToSubscriptions } from './pushService.js';

export const liveRouter = Router();

// ── Invite kody (in-memory — krótkotrwałe, OK) ───────────────────────────────

interface InviteRecord {
  name:    string;
  pushSub: object;
  userId:  string | null;
  created: number;
}
const invites = new Map<string, InviteRecord>();

// Czyść stare invite kody co godzinę (TTL 7 dni)
setInterval(() => {
  const now = Date.now();
  for (const [code, inv] of invites.entries()) {
    if (now - inv.created > 7 * 24 * 60 * 60 * 1000) invites.delete(code);
  }
}, 60 * 60 * 1000);

function randomCode(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

// ── Force-finish stale sessions every 5 min ───────────────────────────────────

setInterval(async () => {
  try {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const result = await LiveSession.updateMany(
      { status: { $ne: 'finished' }, updatedAt: { $lt: twoHoursAgo } },
      { $set: { status: 'finished', updatedAt: Date.now() } },
    );
    if (result.modifiedCount > 0) {
      console.log(`[Live] Force-finished ${result.modifiedCount} stale sessions`);
    }
  } catch (e) {
    console.warn('[Live] Stale session cleanup error:', e);
  }
}, 5 * 60 * 1000);

// ── POST /live/start ──────────────────────────────────────────────────────────

liveRouter.post('/start', async (req: Request, res: Response) => {
  const { token, userName, liveUrl, friendSubs, myUserId } = req.body as {
    token:      string;
    userName:   string;
    liveUrl:    string;
    myUserId?:  string;
    friendSubs: Array<{
      endpoint:       string;
      expirationTime: number | null;
      keys:           { p256dh: string; auth: string };
    }>;
  };

  if (!token || !userName) {
    return void res.status(400).json({ status: 'error', message: 'Missing token or userName' });
  }

  // Real push endpoints (not local: fakes)
  const realSubs = (friendSubs ?? []).filter(s =>
    s.endpoint && !s.endpoint.startsWith('local:')
  );
  // All endpoints for polling lookup
  const allEndpoints = (friendSubs ?? []).map(s => s.endpoint);

  // Create session in MongoDB
  await LiveSession.findOneAndUpdate(
    { token },
    {
      token,
      userName,
      userId:    myUserId ?? null,
      status:    'running',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      current:   null,
      history:   [],
      notifiedSubs: realSubs.map(s => s.endpoint),
      endpoints:    allEndpoints,
    },
    { upsert: true, new: true },
  );

  // Send push notifications (with VAPID — uses sendToSubscriptions)
  if (realSubs.length) {
    const subDocs = realSubs.map(s => ({
      subId:          s.endpoint,
      endpoint:       s.endpoint,
      expirationTime: s.expirationTime,
      keys:           s.keys,
    }));
    const { sent, failed } = await sendToSubscriptions(subDocs, {
      title: `🏃 ${userName} started a workout!`,
      body:  'Tap to watch the live route.',
      url:   liveUrl ?? '/',
      icon:  '/public/icon-192.png',
    });
    console.log(`[Live] Push: ${sent} ok, ${failed} failed`);
  }

  // Map userId → token for polling (store in session)
  if (myUserId) {
    console.log(`[Live] Session started by userId=${myUserId} token=${token}`);
  }

  res.status(201).json({ status: 'ok', token });
});

// ── POST /live/update ─────────────────────────────────────────────────────────

liveRouter.post('/update', async (req: Request, res: Response) => {
  const { token, lat, lng, speed, timestamp } = req.body as {
    token: string; lat: number; lng: number; speed: number; timestamp: number;
  };

  const point = { lat, lng, speed: speed ?? 0, timestamp: timestamp ?? Date.now() };

  const s = await LiveSession.findOneAndUpdate(
    { token, status: { $ne: 'finished' } },
    {
      $set:  { current: point, updatedAt: Date.now() },
      $push: { history: { $each: [point], $slice: -10000 } }, // keep last 10k points
    },
  );

  if (!s) return void res.status(404).json({ status: 'error', message: 'Session not found' });
  res.json({ status: 'ok' });
});

// ── GET /live/status/:token ───────────────────────────────────────────────────

liveRouter.get('/status/:token', async (req: Request, res: Response) => {
  const s = await LiveSession.findOne({ token: req.params.token });
  // Return 'finished' for unknown tokens — client clears stale token and stops polling
  if (!s) {
    return void res.json({
      status: 'ok', token: req.params.token,
      session: 'finished', userName: '', startedAt: 0, updatedAt: 0,
      current: null, history: [],
    });
  }
  res.json({
    status:    'ok',
    token:     s.token,
    userName:  s.userName,
    session:   s.status,
    startedAt: s.startedAt,
    updatedAt: s.updatedAt,
    current:   s.current,
    history:   s.history,
  });
});

// ── GET /live/:token — short status ──────────────────────────────────────────

liveRouter.get('/:token', async (req: Request, res: Response) => {
  // Skip special routes
  if (['start','update','pause','resume','finish','active','invite','status'].includes(req.params.token)) {
    return void res.status(404).json({ status: 'error', message: 'Not found' });
  }
  const s = await LiveSession.findOne({ token: req.params.token });
  if (!s) return void res.json({ status: 'ok', session: 'finished' });
  res.json({ status: 'ok', session: s.status, userName: s.userName, updatedAt: s.updatedAt });
});

// ── POST /live/pause ──────────────────────────────────────────────────────────

liveRouter.post('/pause', async (req: Request, res: Response) => {
  const s = await LiveSession.findOneAndUpdate(
    { token: req.body.token, status: { $ne: 'finished' } },
    { $set: { status: 'paused', updatedAt: Date.now() } },
  );
  if (!s) return void res.status(404).json({ status: 'error', message: 'Not found' });
  res.json({ status: 'ok' });
});

// ── POST /live/resume ─────────────────────────────────────────────────────────

liveRouter.post('/resume', async (req: Request, res: Response) => {
  const s = await LiveSession.findOneAndUpdate(
    { token: req.body.token, status: { $ne: 'finished' } },
    { $set: { status: 'running', updatedAt: Date.now() } },
  );
  if (!s) return void res.status(404).json({ status: 'error', message: 'Not found' });
  res.json({ status: 'ok' });
});

// ── POST /live/finish ─────────────────────────────────────────────────────────

liveRouter.post('/finish', async (req: Request, res: Response) => {
  const s = await LiveSession.findOneAndUpdate(
    { token: req.body.token },
    { $set: { status: 'finished', updatedAt: Date.now() } },
  );
  if (!s) return void res.status(404).json({ status: 'error', message: 'Not found' });
  res.json({ status: 'ok' });
});

// ── GET /live/active/:endpoint ────────────────────────────────────────────────
// Checks by push endpoint OR by userId (for local: friends without push sub)

liveRouter.get('/active/:endpoint', async (req: Request, res: Response) => {
  const key = decodeURIComponent(req.params.endpoint);

  // Look up by push endpoint or by userId
  const s = await LiveSession.findOne({
    status: { $ne: 'finished' },
    $or: [
      { endpoints:     key },
      { userId:        key },
    ],
  });

  if (!s) return void res.json({ status: 'ok', active: false, token: null });
  res.json({ status: 'ok', active: true, token: s.token, userName: s.userName, session: s.status });
});

// ── GET /live — diagnostics ───────────────────────────────────────────────────

liveRouter.get('/', async (_req: Request, res: Response) => {
  const total  = await LiveSession.countDocuments();
  const active = await LiveSession.countDocuments({ status: { $ne: 'finished' } });
  res.json({ status: 'ok', totalSessions: total, activeSessions: active });
});

// ── POST /live/invite ─────────────────────────────────────────────────────────

liveRouter.post('/invite', (req: Request, res: Response) => {
  const { name, pushSub, userId } = req.body as {
    name: string; pushSub: object; userId?: string;
  };
  if (!name || !pushSub) {
    return void res.status(400).json({ status: 'error', message: 'Missing name or pushSub' });
  }
  const code = randomCode();
  invites.set(code, { name, pushSub, userId: userId ?? null, created: Date.now() });
  console.log(`[Live] Invite created: ${code} for ${name} userId=${userId}`);
  res.json({ status: 'ok', code });
});

// ── GET /live/invite/:code ────────────────────────────────────────────────────

liveRouter.get('/invite/:code', (req: Request, res: Response) => {
  const inv = invites.get(req.params.code.toUpperCase());
  if (!inv) {
    return void res.status(404).json({ status: 'error', message: 'Invite not found or expired' });
  }
  res.json({ status: 'ok', name: inv.name, pushSub: inv.pushSub, friendUserId: inv.userId });
});
