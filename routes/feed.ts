// ─── FEED ROUTER ─────────────────────────────────────────────────────────────
// GET  /feed?userId=xxx           — własne + znajomych aktywności i posty
// POST /feed/like                 — dodaj/usuń lajk
// GET  /feed/likes/:itemId        — pobierz lajki dla itemu
// POST /feed/comment              — dodaj komentarz
// GET  /feed/comments/:itemId     — pobierz komentarze dla itemu
// DELETE /feed/comment/:commentId — usuń komentarz

import { Router, Request, Response } from 'express';
import { EnrichedActivity } from '../models/EnrichedActivity.js';
import { Post }             from '../models/Post.js';
import { User }             from '../models/User.js';
import { Like, Comment }    from '../models/LikeComment.js';

export const feedRouter = Router();

// ── GET /feed?userId=xxx ──────────────────────────────────────────────────────
// Zwraca aktywności + posty własne i znajomych posortowane po dacie

feedRouter.get('/', async (req: Request, res: Response) => {
  const { userId } = req.query;
  if (!userId) return void res.status(400).json({ status: 'error', message: 'userId required' });

  // Pobierz listę znajomych
  const user = await User.findOne({ userId });
  const friendIds = user?.friends ?? [];
  const allIds = [userId as string, ...friendIds];

  // Pobierz aktywności i posty wszystkich równolegle
  const [activities, posts] = await Promise.all([
    EnrichedActivity.find({ userId: { $in: allIds } }).sort({ date: -1 }).limit(50),
    Post.find({ userId: { $in: allIds } }).sort({ date: -1 }).limit(50),
  ]);

  // Pobierz avatary użytkowników
  const userIds = [...new Set([...activities.map(a => a.userId), ...posts.map(p => p.userId)])];
  const users   = await (await import('../models/User.js')).User.find({ userId: { $in: userIds } });
  const avatarMap = new Map(users.map(u => [u.userId, u.avatarB64]));

  // Zmerguj i posortuj po dacie
  const feed = [
    ...activities.map(a => ({ kind: 'activity', date: a.date, data: { ...a.toObject(), authorAvatarUrl: avatarMap.get(a.userId) ?? null } })),
    ...posts.map(p => ({ kind: 'post', date: p.date, data: { ...p.toObject(), authorAvatarUrl: avatarMap.get(p.userId) ?? null } })),
  ].sort((a, b) => b.date - a.date).slice(0, 50);

  res.json({ status: 'ok', count: feed.length, data: feed });
});

// ── POST /feed/like ───────────────────────────────────────────────────────────
// Body: { userId, itemId, itemType: 'activity'|'post' }
// Toggle — jeśli już lajkował, usuwa lajk

feedRouter.post('/like', async (req: Request, res: Response) => {
  const { userId, itemId, itemType } = req.body as {
    userId: string; itemId: string; itemType: 'activity' | 'post';
  };
  if (!userId || !itemId || !itemType) {
    return void res.status(400).json({ status: 'error', message: 'userId, itemId, itemType required' });
  }

  const existing = await Like.findOne({ itemId, userId });
  if (existing) {
    await Like.deleteOne({ itemId, userId });
    const count = await Like.countDocuments({ itemId });
    return void res.json({ status: 'ok', liked: false, count });
  }

  await Like.create({ itemId, itemType, userId });
  const count = await Like.countDocuments({ itemId });
  res.json({ status: 'ok', liked: true, count });
});

// ── GET /feed/likes/:itemId ───────────────────────────────────────────────────

feedRouter.get('/likes/:itemId', async (req: Request, res: Response) => {
  const { userId } = req.query;
  const count = await Like.countDocuments({ itemId: req.params.itemId });
  const liked = userId
    ? !!(await Like.findOne({ itemId: req.params.itemId, userId }))
    : false;
  res.json({ status: 'ok', count, liked });
});

// ── POST /feed/comment ────────────────────────────────────────────────────────
// Body: { userId, authorName, itemId, itemType, text }

feedRouter.post('/comment', async (req: Request, res: Response) => {
  const { userId, authorName, itemId, itemType, text } = req.body as {
    userId: string; authorName: string;
    itemId: string; itemType: 'activity' | 'post'; text: string;
  };
  if (!userId || !itemId || !text) {
    return void res.status(400).json({ status: 'error', message: 'userId, itemId, text required' });
  }

  const comment = await Comment.create({
    commentId:  `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    itemId,
    itemType:   itemType ?? 'activity',
    userId,
    authorName: authorName ?? '',
    text:       text.slice(0, 500),
  });

  res.status(201).json({ status: 'ok', data: comment });
});

// ── GET /feed/comments/:itemId ────────────────────────────────────────────────

feedRouter.get('/comments/:itemId', async (req: Request, res: Response) => {
  const comments = await Comment.find({ itemId: req.params.itemId }).sort({ createdAt: 1 });
  res.json({ status: 'ok', count: comments.length, data: comments });
});

// ── DELETE /feed/comment/:commentId ──────────────────────────────────────────

feedRouter.delete('/comment/:commentId', async (req: Request, res: Response) => {
  const { userId } = req.query;
  const r = await Comment.deleteOne({ commentId: req.params.commentId, userId });
  if (!r.deletedCount) {
    return void res.status(404).json({ status: 'error', message: 'Not found or not authorized' });
  }
  res.json({ status: 'ok', message: 'Deleted' });
});
