// ─── USERS ROUTER ────────────────────────────────────────────────────────────
import { Router, Request, Response } from 'express';
import { User } from '../models/User.js';
import { PushSubscription } from '../models/PushSubscription.js';

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
    // Dodaj userId do followers targetu
    User.findOneAndUpdate(
      { userId: targetId },
      { $addToSet: { followers: userId } },
    ),
    // Dodaj targetId do following usera
    User.findOneAndUpdate(
      { userId },
      { $addToSet: { following: targetId } },
    ),
  ]);

  res.json({ status: 'ok', following: true });
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
  const { userId, friendId } = req.params;

  // 1. Add friendId to my friends list
  const user = await User.findOneAndUpdate(
    { userId },
    { $addToSet: { friends: friendId } },
    { new: true },
  );
  if (!user) return void res.status(404).json({ status: 'error', message: 'User not found' });

  // 2. Add me to friend's pendingFriends queue (so they auto-add me on next app open)
  // Only add if not already friends (avoid duplicate pending)
  const friend = await User.findOne({ userId: friendId });
  if (friend) {
    const alreadyFriends = (friend.friends ?? []).includes(userId);
    if (!alreadyFriends) {
      await User.findOneAndUpdate(
        { userId: friendId },
        {
          $addToSet: {
            pendingFriends: { userId, name: user.name ?? 'MapYou User' },
          },
        },
      );
      console.log(`[Users] Added ${userId} to ${friendId}'s pendingFriends`);
    }
  }

  res.json({ status: 'ok', data: user });
});

// GET /users/:userId/pending-friends — pobierz i wyczyść pending queue
usersRouter.get('/:userId/pending-friends', async (req: Request, res: Response) => {
  const user = await User.findOne({ userId: req.params.userId });
  if (!user) return void res.status(404).json({ status: 'error', message: 'User not found' });

  const pending = user.pendingFriends ?? [];
  if (pending.length === 0) {
    return void res.json({ status: 'ok', data: [] });
  }

  // Clear pending queue atomically — return what was there
  await User.findOneAndUpdate(
    { userId: req.params.userId },
    { $set: { pendingFriends: [] } },
  );

  // Also add them as friends in Atlas automatically
  await User.findOneAndUpdate(
    { userId: req.params.userId },
    { $addToSet: { friends: { $each: pending.map((p: { userId: string }) => p.userId) } } },
  );

  console.log(`[Users] Auto-added ${pending.length} pending friends for ${req.params.userId}`);
  res.json({ status: 'ok', data: pending });
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
