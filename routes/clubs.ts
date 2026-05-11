// ─── CLUBS ROUTER ────────────────────────────────────────────────────────────
import { Router, Request, Response } from 'express';
import { Club } from '../models/Club.js';

export const clubsRouter = Router();

// GET /clubs?q=name&city=xxx&sport=running — szukaj klubów
clubsRouter.get('/', async (req: Request, res: Response) => {
  const { q, city, region, sport } = req.query as { q?: string; city?: string; region?: string; sport?: string };
  const filter: Record<string, unknown> = {};
  const locConditions = city && !region
    ? [{ city: { $regex: new RegExp(city.trim(), 'i') } }, { location: { $regex: new RegExp(city.trim(), 'i') } }]
    : region
      ? [{ region: { $regex: new RegExp(region.trim(), 'i') } }, { location: { $regex: new RegExp(region.trim(), 'i') } }]
      : null;
  const nameConditions = q
    ? [{ name: { $regex: new RegExp(q.trim(), 'i') } }, { city: { $regex: new RegExp(q.trim(), 'i') } }, { location: { $regex: new RegExp(q.trim(), 'i') } }]
    : null;
  if (nameConditions && locConditions) {
    filter['$and'] = [{ $or: nameConditions }, { $or: locConditions }];
  } else if (nameConditions) {
    filter['$or'] = nameConditions;
  } else if (locConditions) {
    filter['$or'] = locConditions;
  }
  if (sport) filter['sport'] = sport;
  const clubs = await Club.find(filter).sort({ createdAt: -1 }).limit(50);
  res.json({ status: 'ok', count: clubs.length, data: clubs });
});

// GET /clubs/:id/feed — activities and posts shared to this club
clubsRouter.get('/:id/feed', async (req: Request, res: Response) => {
  const { EnrichedActivity } = await import('../models/EnrichedActivity.js');
  const { Post }             = await import('../models/Post.js');
  const { User }             = await import('../models/User.js');

  const [activities, posts] = await Promise.all([
    EnrichedActivity.find({ clubIds: req.params.id }).sort({ date: -1 }).limit(50),
    Post.find({ clubIds: req.params.id }).sort({ date: -1 }).limit(50),
  ]);

  const userIds  = [...new Set([...activities.map(a => a.userId), ...posts.map(p => p.userId)])];
  const users    = await User.find({ userId: { $in: userIds } }).select('userId name avatarB64');
  const nameMap  = new Map(users.map(u => [u.userId, u.name]));
  const avMap    = new Map(users.map(u => [u.userId, u.avatarB64]));

  const feed = [
    ...activities.map(a => ({ kind: 'activity', date: a.date, data: { ...a.toObject(), authorName: nameMap.get(a.userId) ?? '', authorAvatarUrl: avMap.get(a.userId) ?? null } })),
    ...posts.map(p =>     ({ kind: 'post',     date: p.date, data: { ...p.toObject(), authorName: nameMap.get(p.userId) ?? '', authorAvatarUrl: avMap.get(p.userId) ?? null } })),
  ].sort((a, b) => b.date - a.date);

  res.json({ status: 'ok', count: feed.length, data: feed });
});

// GET /clubs/:id
clubsRouter.get('/:id', async (req: Request, res: Response) => {
  const club = await Club.findOne({ clubId: req.params.id });
  if (!club) return void res.status(404).json({ status: 'error', message: 'Club not found' });
  res.json({ status: 'ok', data: club });
});

// POST /clubs — utwórz klub
clubsRouter.post('/', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  if (!body.clubId || !body.ownerId || !body.name) {
    return void res.status(400).json({ status: 'error', message: 'clubId, ownerId, name required' });
  }
  // Extract members separately to avoid $set/$addToSet conflict on same field
  const { members: _m, ...bodyWithoutMembers } = body as Record<string,unknown> & { members?: unknown };
  void _m;
  const club = await Club.findOneAndUpdate(
    { clubId: body.clubId as string },
    {
      $set: bodyWithoutMembers,
      $addToSet: { members: body.ownerId },
    },
    { upsert: true, new: true },
  );
  res.status(201).json({ status: 'ok', data: club });
});

// PUT /clubs/:id
clubsRouter.put('/:id', async (req: Request, res: Response) => {
  const club = await Club.findOneAndUpdate(
    { clubId: req.params.id },
    { $set: req.body },
    { new: true },
  );
  if (!club) return void res.status(404).json({ status: 'error', message: 'Club not found' });
  res.json({ status: 'ok', data: club });
});

// DELETE /clubs/:id
clubsRouter.delete('/:id', async (req: Request, res: Response) => {
  const r = await Club.deleteOne({ clubId: req.params.id });
  if (!r.deletedCount) return void res.status(404).json({ status: 'error', message: 'Not found' });
  res.json({ status: 'ok', message: 'Deleted' });
});

// POST /clubs/:id/join — dołącz do klubu
clubsRouter.post('/:id/join', async (req: Request, res: Response) => {
  const { userId } = req.body as { userId: string };
  if (!userId) return void res.status(400).json({ status: 'error', message: 'userId required' });
  const club = await Club.findOneAndUpdate(
    { clubId: req.params.id },
    { $addToSet: { members: userId } },
    { new: true },
  );
  if (!club) return void res.status(404).json({ status: 'error', message: 'Club not found' });
  res.json({ status: 'ok', data: club });
});

// Club invite codes (in-memory, 7 days TTL)
const clubInvites = new Map<string, { clubId: string; created: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [code, inv] of clubInvites.entries()) {
    if (now - inv.created > 7 * 24 * 60 * 60 * 1000) clubInvites.delete(code);
  }
}, 60 * 60 * 1000);

// POST /clubs/:id/invite — generate invite code
clubsRouter.post('/:id/invite', async (req: Request, res: Response) => {
  const club = await Club.findOne({ clubId: req.params.id });
  if (!club) return void res.status(404).json({ status: 'error', message: 'Club not found' });
  const code = Math.random().toString(36).slice(2, 10).toUpperCase();
  clubInvites.set(code, { clubId: req.params.id, created: Date.now() });
  res.json({ status: 'ok', code });
});

// GET /clubs/invite/:code — get clubId from invite code
clubsRouter.get('/invite/:code', (req: Request, res: Response) => {
  const inv = clubInvites.get(req.params.code.toUpperCase());
  if (!inv) return void res.status(404).json({ status: 'error', message: 'Invite not found or expired' });
  res.json({ status: 'ok', clubId: inv.clubId });
});

// POST /clubs/:id/leave — opuść klub
clubsRouter.post('/:id/leave', async (req: Request, res: Response) => {
  const { userId } = req.body as { userId: string };
  if (!userId) return void res.status(400).json({ status: 'error', message: 'userId required' });
  const club = await Club.findOneAndUpdate(
    { clubId: req.params.id },
    { $pull: { members: userId } },
    { new: true },
  );
  if (!club) return void res.status(404).json({ status: 'error', message: 'Club not found' });
  res.json({ status: 'ok', data: club });
});
