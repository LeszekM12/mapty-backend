// ─── USERS ROUTER ────────────────────────────────────────────────────────────
import { Router, Request, Response } from 'express';
import { User } from '../models/User.js';
import { PushSubscription } from '../models/PushSubscription.js';
import { notifyFollow, notifyFollowRequest } from './pushService.js';

export const usersRouter = Router();

// POST /users/lookup-by-endpoint — znajdź userId po push endpoint
usersRouter.post('/lookup-by-endpoint', async (req: Request, res: Response) => {
  const { endpoint } = req.body as { endpoint?: string };
  if (!endpoint) return void res.status(400).json({ status: 'error', message: 'endpoint required' });
  const sub = await PushSubscription.findOne({ endpoint });
  if (!sub) return void res.status(404).json({ status: 'error', message: 'Not found' });
  res.json({ status: 'ok', userId: sub.userId });
});

// GET /users/public/:userId — publiczny profil
usersRouter.get('/public/:userId', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  const { viewerId } = req.query as { viewerId?: string };
  const user = await User.findOne({ userId: req.params.userId });
  if (!user) return void res.status(404).json({ status: 'error', message: 'User not found' });

  const isFollowing = viewerId
    ? (user.followers ?? []).includes(viewerId)
    : false;

  const isPending = viewerId
    ? ((user as unknown as Record<string,unknown>).pendingFollowers as string[] ?? []).includes(viewerId)
    : false;
  res.json({
    status: 'ok',
    data: {
      userId:         user.userId,
      name:           user.name,
      bio:            user.bio,
      avatarB64:      user.avatarB64,
      followersCount: (user.followers ?? []).length,
      followingCount: (user.following ?? []).length,
      isFollowing,
      isPending,
      isPrivate:      (user as unknown as Record<string,unknown>).isPrivate ?? false,
      weeklyWins:     (user.weeklyWins as number | undefined) ?? 0,
      bestStreak:     (user.bestStreak as number | undefined) ?? 0,
    },
  });
});

// POST /users/:userId/follow/:targetId — obserwuj
usersRouter.post('/:userId/follow/:targetId', async (req: Request, res: Response) => {
  const { userId, targetId } = req.params;
  if (userId === targetId) return void res.status(400).json({ status: 'error', message: 'Cannot follow yourself' });

  await Promise.all([
    User.findOneAndUpdate({ userId: targetId }, { $addToSet: { followers: userId } }),
    User.findOneAndUpdate({ userId },           { $addToSet: { following: targetId } }),
  ]);

  // Push do obserwowanego
  const follower = await User.findOne({ userId }).select('name');
  void notifyFollow(userId, follower?.name ?? 'Ktoś', targetId);

  res.json({ status: 'ok', following: true });
});

// POST /users/:userId/follow-request/:targetId — wyślij request do prywatnego profilu
usersRouter.post('/:userId/follow-request/:targetId', async (req: Request, res: Response) => {
  const { userId, targetId } = req.params;
  if (userId === targetId) return void res.status(400).json({ status: 'error', message: 'Cannot follow yourself' });
  await User.findOneAndUpdate(
    { userId: targetId },
    { $addToSet: { pendingFollowers: userId } },
  );
  const requester = await User.findOne({ userId }).select('name');
  void notifyFollowRequest(userId, requester?.name ?? 'Ktoś', targetId);
  res.json({ status: 'ok', pending: true });
});

// POST /users/:userId/follow-cancel/:targetId — anuluj request
usersRouter.post('/:userId/follow-cancel/:targetId', async (req: Request, res: Response) => {
  const { userId, targetId } = req.params;
  await User.findOneAndUpdate(
    { userId: targetId },
    { $pull: { pendingFollowers: userId } },
  );
  res.json({ status: 'ok', pending: false });
});

// POST /users/:userId/follow-approve/:requesterId — zatwierdź request
usersRouter.post('/:userId/follow-approve/:requesterId', async (req: Request, res: Response) => {
  const { userId, requesterId } = req.params;
  await Promise.all([
    User.findOneAndUpdate({ userId }, { $pull: { pendingFollowers: requesterId }, $addToSet: { followers: requesterId } }),
    User.findOneAndUpdate({ userId: requesterId }, { $addToSet: { following: userId } }),
  ]);
  const approver = await User.findOne({ userId }).select('name');
  void notifyFollow(userId, approver?.name ?? 'Ktoś', requesterId);
  res.json({ status: 'ok', approved: true });
});

// POST /users/:userId/follow-reject/:requesterId — odrzuć request
usersRouter.post('/:userId/follow-reject/:requesterId', async (req: Request, res: Response) => {
  const { userId, requesterId } = req.params;
  await User.findOneAndUpdate({ userId }, { $pull: { pendingFollowers: requesterId } });
  res.json({ status: 'ok', rejected: true });
});

// DELETE /users/:userId/follow/:targetId — przestań obserwować
usersRouter.delete('/:userId/follow/:targetId', async (req: Request, res: Response) => {
  const { userId, targetId } = req.params;

  await Promise.all([
    User.findOneAndUpdate(
      { userId: targetId },
      { $pull: { followers: userId } },
    ),
    User.findOneAndUpdate(
      { userId },
      { $pull: { following: targetId } },
    ),
  ]);

  res.json({ status: 'ok', following: false });
});

// GET /users/search?q=name&exclude=userId — szukaj użytkowników po nazwie
usersRouter.get('/search', async (req: Request, res: Response) => {
  const { q, exclude } = req.query as { q?: string; exclude?: string };
  if (!q || q.trim().length < 1) {
    return void res.json({ status: 'ok', data: [] });
  }
  const regex = new RegExp(q.trim(), 'i');
  const users = await User.find({
    name:   { $regex: regex },
    userId: { $ne: exclude ?? '' },
  }).select('userId name bio avatarB64 city region followers following').limit(30);

  res.json({ status: 'ok', data: users.map(u => ({
    userId:       u.userId,
    name:         u.name,
    bio:          u.bio,
    avatarB64:    u.avatarB64,
    city:         u.city ?? '',
    region:       u.region ?? '',
    followersCount: (u.followers ?? []).length,
    followingCount: (u.following ?? []).length,
  })) });
});

// GET /users/suggestions?userId=xxx — znajomi znajomych (2 stopnie)
usersRouter.get('/suggestions', async (req: Request, res: Response) => {
  const { userId } = req.query as { userId?: string };
  if (!userId) return void res.status(400).json({ status: 'error', message: 'userId required' });

  const me = await User.findOne({ userId });
  if (!me) return void res.status(404).json({ status: 'error', message: 'User not found' });

  const myFriends    = me.friends   ?? [];
  const myFollowing  = (me.following as string[] | undefined) ?? [];
  const myConnections = [...new Set([...myFriends, ...myFollowing])];
  const alreadyKnown = new Set([userId, ...myConnections]);

  // Stopień 2 — znajomi moich znajomych
  const degree2Set = new Set<string>();
  if (myConnections.length > 0) {
    const connections = await User.find({ userId: { $in: myConnections } })
      .select('friends following');
    for (const conn of connections) {
      for (const f of [...(conn.friends ?? []), ...((conn.following as string[] | undefined) ?? [])]) {
        if (!alreadyKnown.has(f)) degree2Set.add(f);
      }
    }
  }

  const suggestionIds = [...degree2Set].slice(0, 20);
  
  // Fallback — jeśli za mało sugestii, dodaj najnowszych użytkowników
  let suggestions = await User.find({ userId: { $in: suggestionIds } })
    .select('userId name bio avatarB64 city region followers following');

  if (suggestions.length < 10) {
    const fallback = await User.find({ userId: { $nin: [...alreadyKnown] } })
      .sort({ createdAt: -1 }).limit(20 - suggestions.length)
      .select('userId name bio avatarB64 city region followers following');
    const fallbackIds = new Set(suggestions.map(u => u.userId));
    suggestions = [...suggestions, ...fallback.filter(u => !fallbackIds.has(u.userId))];
  }

  res.json({ status: 'ok', data: suggestions.map(u => ({
    userId:       u.userId,
    name:         u.name,
    bio:          u.bio,
    avatarB64:    u.avatarB64,
    city:         u.city ?? '',
    region:       u.region ?? '',
    followersCount: (u.followers ?? []).length,
  })) });
});

// GET /users/:userId/feed — posty i aktywności konkretnego użytkownika
usersRouter.get('/:userId/feed', async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { EnrichedActivity } = await import('../models/EnrichedActivity.js');
  const { Post }             = await import('../models/Post.js');

  const [activities, posts] = await Promise.all([
    EnrichedActivity.find({ userId }).sort({ date: -1 }).limit(50),
    Post.find({ userId, clubOnly: { $ne: true }, type: { $ne: 'club_event' } }).sort({ date: -1 }).limit(50),
  ]);

  const merged = [
    ...activities.map(a => ({ kind: 'activity', date: a.date, data: { ...a.toObject(), authorAvatarUrl: null } })),
    ...posts.map(p => ({ kind: 'post', date: p.date, data: { ...p.toObject(), authorAvatarUrl: null } })),
  ].sort((a, b) => b.date - a.date);

  res.json({ status: 'ok', data: merged });
});

// GET /users/:userId
usersRouter.get('/:userId', async (req: Request, res: Response) => {
  const user = await User.findOne({ userId: req.params.userId });
  if (!user) return void res.status(404).json({ status: 'error', message: 'User not found' });
  res.json({ status: 'ok', data: user });
});

// POST /users — upsert (create or update)
usersRouter.post('/', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  if (!body.userId) return void res.status(400).json({ status: 'error', message: 'userId required' });
  const user = await User.findOneAndUpdate(
    { userId: body.userId as string },
    { $set: body },
    { upsert: true, new: true },
  );
  res.status(201).json({ status: 'ok', data: user });
});

// PUT /users/:userId
usersRouter.put('/:userId', async (req: Request, res: Response) => {
  const user = await User.findOneAndUpdate(
    { userId: req.params.userId },
    { $set: req.body },
    { new: true },
  );
  if (!user) return void res.status(404).json({ status: 'error', message: 'User not found' });
  res.json({ status: 'ok', data: user });
});

// POST /users/:userId/friends/:friendId — dodaj znajomego
usersRouter.post('/:userId/friends/:friendId', async (req: Request, res: Response) => {
  const user = await User.findOneAndUpdate(
    { userId: req.params.userId },
    { $addToSet: { friends: req.params.friendId } },
    { new: true },
  );
  if (!user) return void res.status(404).json({ status: 'error', message: 'User not found' });
  res.json({ status: 'ok', data: user });
});

// DELETE /users/:userId/friends/:friendId — usuń znajomego
usersRouter.delete('/:userId/friends/:friendId', async (req: Request, res: Response) => {
  const user = await User.findOneAndUpdate(
    { userId: req.params.userId },
    { $pull: { friends: req.params.friendId } },
    { new: true },
  );
  if (!user) return void res.status(404).json({ status: 'error', message: 'User not found' });
  res.json({ status: 'ok', data: user });
});
