// ─── LIVE TRACKING ROUTER ────────────────────────────────────────────────────
// Logika bez zmian — sesje nadal in-memory (live tracking nie wymaga persistence)
// Tylko push notification idą przez MongoDB

import { Router, Request, Response } from 'express';
import { sendToSubscriptions } from './pushService.js';
import { PushSubscription } from '../models/PushSubscription.js';

export const liveRouter = Router();

// ── Typy ─────────────────────────────────────────────────────────────────────

export type SessionStatus = 'running' | 'paused' | 'finished';

export interface PositionPoint {
  lat: number; lng: number; speed: number; timestamp: number;
}

export interface LiveSession {
  token:        string;
  userName:     string;
  status:       SessionStatus;
  startedAt:    number;
  updatedAt:    number;
  current:      PositionPoint | null;
  history:      PositionPoint[];
  notifiedSubs: string[];
}

// ── In-memory stores ──────────────────────────────────────────────────────────

const sessions        = new Map<string, LiveSession>();
const endpointToToken = new Map<string, string>(); // pushEndpoint → token
const userIdToToken   = new Map<string, string>(); // userId → token

// Cleanup: remove finished sessions after 30min, force-finish stale sessions after 2h
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions.entries()) {
    // Remove finished sessions after 30 min
    if (s.status === 'finished' && now - s.updatedAt > 30 * 60 * 1000) {
      sessions.delete(token);
      for (const [ep, t] of endpointToToken.entries()) { if (t === token) endpointToToken.delete(ep); }
      for (const [uid, t] of userIdToToken.entries())  { if (t === token) userIdToToken.delete(uid); }
      continue;
    }
    // Force-finish sessions with no update for 2 hours (phone died, app crashed, etc.)
    if (s.status !== 'finished' && now - s.updatedAt > 2 * 60 * 60 * 1000) {
      s.status    = 'finished';
      s.updatedAt = now;
      console.log(`[Live] Force-finished stale session: ${token} (${s.userName})`);
    }
  }
}, 5 * 60 * 1000);

// Invite kody
interface InviteRecord { name: string; pushSub: object; userId: string | null; created: number }
const invites = new Map<string, InviteRecord>();
setInterval(() => {
  const now = Date.now();
  for (const [code, inv] of invites.entries()) {
    if (now - inv.created > 7 * 24 * 60 * 60 * 1000) invites.delete(code);
  }
}, 60 * 60 * 1000);

function randomCode(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

// ── POST /live/start ──────────────────────────────────────────────────────────

liveRouter.post('/start', async (req: Request, res: Response) => {
  const { token, userName, liveUrl, friendSubs, myUserId } = req.body as {
    token: string; userName: string; liveUrl: string; myUserId?: string;
    friendSubs: Array<{ endpoint: string; expirationTime: number | null; keys: { p256dh: string; auth: string } }>;
  };

  if (!token || !userName) {
    return void res.status(400).json({ status: 'error', message: 'Missing token or userName' });
  }

  const session: LiveSession = {
    token, userName, status: 'running',
    startedAt: Date.now(), updatedAt: Date.now(),
    current: null, history: [], notifiedSubs: [],
  };
  sessions.set(token, session);

  // Wyślij push do znajomych — używaj sendToSubscriptions (ma VAPID, obsługuje APNs/FCM)
  if (Array.isArray(friendSubs) && friendSubs.length) {
    const payload = {
      title: `🏃 ${userName} started a workout!`,
      body:  'Tap to watch the live route.',
      url:   liveUrl ?? '/',
      icon:  '/public/icon-192.png',
    };

    // Filter out local: fake subs — only send to real push endpoints
    const realSubs = friendSubs.filter(s =>
      s.endpoint && !s.endpoint.startsWith('local:')
    );

    if (realSubs.length) {
      // Map to format expected by sendToSubscriptions
      const subDocs = realSubs.map(s => ({
        subId:          s.endpoint,
        endpoint:       s.endpoint,
        expirationTime: s.expirationTime,
        keys:           s.keys,
      }));
      const { sent, failed } = await sendToSubscriptions(subDocs, payload);
      console.log(`[Live] Push sent: ${sent} ok, ${failed} failed`);
    }

    // Register all endpoints (real + local userId) in endpointToToken for polling
    for (const sub of friendSubs) {
      if (!sub.endpoint.startsWith('local:')) {
        endpointToToken.set(sub.endpoint, token);
      }
    }
  }

  // Map userId → token so friends without push sub can still detect live
  if (myUserId) {
    userIdToToken.set(myUserId, token);
    console.log(`[Live] Mapped userId ${myUserId} → token ${token}`);
  }

  console.log(`[Live] Session started: ${token} by ${userName}`);
  res.status(201).json({ status: 'ok', token });
});

// ── POST /live/update ─────────────────────────────────────────────────────────

liveRouter.post('/update', (req: Request, res: Response) => {
  const { token, lat, lng, speed, timestamp } = req.body as {
    token: string; lat: number; lng: number; speed: number; timestamp: number;
  };
  const s = sessions.get(token);
  if (!s) return void res.status(404).json({ status: 'error', message: 'Session not found' });
  if (s.status === 'finished') return void res.status(409).json({ status: 'error', message: 'Session finished' });

  const point: PositionPoint = { lat, lng, speed: speed ?? 0, timestamp: timestamp ?? Date.now() };
  s.current = point;
  s.updatedAt = Date.now();
  s.history.push(point);
  if (s.history.length > 10_000) s.history.shift();
  res.json({ status: 'ok' });
});

// ── GET /live/status/:token ───────────────────────────────────────────────────

liveRouter.get('/status/:token', (req: Request, res: Response) => {
  const s = sessions.get(req.params.token);
  // Return 'finished' instead of 404 — client clears token and stops polling
  if (!s) return void res.json({ status: 'ok', token: req.params.token,
    session: 'finished', userName: '', startedAt: 0, updatedAt: 0, current: null, history: [] });
  res.json({ status: 'ok', token: s.token, userName: s.userName, session: s.status,
    startedAt: s.startedAt, updatedAt: s.updatedAt, current: s.current, history: s.history });
});

liveRouter.get('/:token', (req: Request, res: Response) => {
  const s = sessions.get(req.params.token);
  // Return 'finished' so client clears the stale token
  if (!s) return void res.json({ status: 'ok', session: 'finished' });
  res.json({ status: 'ok', session: s.status, userName: s.userName, updatedAt: s.updatedAt });
});

// ── POST /live/pause ──────────────────────────────────────────────────────────

liveRouter.post('/pause', (req: Request, res: Response) => {
  const s = sessions.get(req.body.token);
  if (!s || s.status === 'finished') return void res.status(404).json({ status: 'error', message: 'Not found' });
  s.status = 'paused'; s.updatedAt = Date.now();
  res.json({ status: 'ok' });
});

// ── POST /live/resume ─────────────────────────────────────────────────────────

liveRouter.post('/resume', (req: Request, res: Response) => {
  const s = sessions.get(req.body.token);
  if (!s || s.status === 'finished') return void res.status(404).json({ status: 'error', message: 'Not found' });
  s.status = 'running'; s.updatedAt = Date.now();
  res.json({ status: 'ok' });
});

// ── POST /live/finish ─────────────────────────────────────────────────────────

liveRouter.post('/finish', (req: Request, res: Response) => {
  const s = sessions.get(req.body.token);
  if (!s) return void res.status(404).json({ status: 'error', message: 'Not found' });
  s.status = 'finished'; s.updatedAt = Date.now();
  for (const [ep, t] of endpointToToken.entries()) {
    if (t === req.body.token) endpointToToken.delete(ep);
  }
  for (const [uid, t] of userIdToToken.entries()) {
    if (t === req.body.token) userIdToToken.delete(uid);
  }
  res.json({ status: 'ok' });
});

// ── GET /live/active/:endpoint ────────────────────────────────────────────────

liveRouter.get('/active/:endpoint', (req: Request, res: Response) => {
  const endpoint = decodeURIComponent(req.params.endpoint);

  // Check by push endpoint first, then by userId (for local: friends without push sub)
  const token = endpointToToken.get(endpoint) ?? userIdToToken.get(endpoint);
  if (!token) return void res.json({ status: 'ok', active: false, token: null });

  const s = sessions.get(token);
  if (!s || s.status === 'finished') {
    endpointToToken.delete(endpoint);
    userIdToToken.delete(endpoint);
    return void res.json({ status: 'ok', active: false, token: null });
  }
  res.json({ status: 'ok', active: true, token, userName: s.userName, session: s.status });
});

// ── GET /live — diagnostics ───────────────────────────────────────────────────

liveRouter.get('/', (_req: Request, res: Response) => {
  const active = [...sessions.values()].filter(s => s.status !== 'finished').length;
  res.json({ status: 'ok', totalSessions: sessions.size, activeSessions: active });
});

// ── POST /live/invite ─────────────────────────────────────────────────────────

liveRouter.post('/invite', (req: Request, res: Response) => {
  const { name, pushSub, userId } = req.body as { name: string; pushSub: object; userId?: string };
  if (!name || !pushSub) return void res.status(400).json({ status: 'error', message: 'Missing name or pushSub' });
  const code = randomCode();
  invites.set(code, { name, pushSub, userId: userId ?? null, created: Date.now() });
  console.log(`[Live] Invite created: ${code} for ${name} userId=${userId}`);
  res.json({ status: 'ok', code });
});

// ── GET /live/invite/:code ────────────────────────────────────────────────────

liveRouter.get('/invite/:code', (req: Request, res: Response) => {
  const inv = invites.get(req.params.code.toUpperCase());
  if (!inv) return void res.status(404).json({ status: 'error', message: 'Invite not found or expired' });
  res.json({ status: 'ok', name: inv.name, pushSub: inv.pushSub, friendUserId: inv.userId });
});
