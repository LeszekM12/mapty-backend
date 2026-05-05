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
  // Wyłącz cache — feed musi być zawsze świeży
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const { userId, before } = req.query as { userId?: string; before?: string };
  if (!userId) return void res.status(400).json({ status: 'error', message: 'userId required' });

  const PAGE_SIZE = 20;
  // before = timestamp — pobierz rekordy starsze niż ten timestamp
  const beforeDate = before ? parseInt(before, 10) : Date.now();

  // Pobierz listę znajomych i obserwowanych
  const user = await User.findOne({ userId });
  const friendIds    = user?.friends   ?? [];
  const followingIds = (user?.following as string[] | undefined) ?? [];
  const allIds = [...new Set([userId as string, ...friendIds, ...followingIds])];

  // Pobierz aktywności i posty starsze niż beforeDate
  const [activities, posts] = await Promise.all([
    EnrichedActivity.find({ userId: { $in: allIds }, date: { $lt: beforeDate } }).sort({ date: -1 }).limit(PAGE_SIZE + 1),
    Post.find({ userId: { $in: allIds }, date: { $lt: beforeDate } }).sort({ date: -1 }).limit(PAGE_SIZE + 1),
  ]);

  // Pobierz avatary użytkowników
  const userIds = [...new Set([...activities.map(a => a.userId), ...posts.map(p => p.userId)])];
  const users   = await (await import('../models/User.js')).User.find({ userId: { $in: userIds } });
  const avatarMap = new Map(users.map(u => [u.userId, u.avatarB64]));

  // Zmerguj i posortuj po dacie — strip heavy fields
  const stripActivity = (a: ReturnType<typeof activities[0]['toObject']>) => {
    const { coords, ...lean } = a as Record<string, unknown> & { coords?: unknown };
    void coords;
    return { ...lean, authorAvatarUrl: avatarMap.get(a.userId) ?? null };
  };
  const stripPost = (p: ReturnType<typeof posts[0]['toObject']>) => {
    const { avatarB64, ...lean } = p as Record<string, unknown> & { avatarB64?: unknown };
    void avatarB64;
    return { ...lean, authorAvatarUrl: avatarMap.get(p.userId) ?? null };
  };

  const merged = [
    ...activities.map(a => ({ kind: 'activity', date: a.date, data: stripActivity(a.toObject()) })),
    ...posts.map(p => ({ kind: 'post', date: p.date, data: stripPost(p.toObject()) })),
  ].sort((a, b) => b.date - a.date);

  const hasMore   = merged.length > PAGE_SIZE;
  const feedItems = merged.slice(0, PAGE_SIZE);

  // Pobierz lajki i komentarze dla wszystkich itemów naraz
  const itemIds = feedItems.map(f => {
    const d = f.data as Record<string, unknown>;
    return (d.activityId ?? d.postId ?? d._id) as string;
  }).filter(Boolean);

  const [likeCounts, commentCounts] = await Promise.all([
    Like.aggregate([
      { $match: { itemId: { $in: itemIds } } },
      { $group: { _id: '$itemId', count: { $sum: 1 } } },
    ]),
    Comment.aggregate([
      { $match: { itemId: { $in: itemIds } } },
      { $group: { _id: '$itemId', count: { $sum: 1 } } },
    ]),
  ]);

  const likeMap    = Object.fromEntries(likeCounts.map((l: {_id: string; count: number}) => [l._id, l.count]));
  const commentMap = Object.fromEntries(commentCounts.map((c: {_id: string; count: number}) => [c._id, c.count]));

  const feed = feedItems.map(f => {
    const d2 = f.data as Record<string, unknown>;
    const id = (d2.activityId ?? d2.postId ?? d2._id) as string;
    return { ...f, data: { ...f.data, _likeCount: likeMap[id] ?? 0, _commentCount: commentMap[id] ?? 0 } };
  });

  res.json({ status: 'ok', count: feed.length, hasMore, data: feed });
});

// ── GET /feed/likes/batch?userId=xxx&items=id1,id2,id3 ───────────────────────
// Pobiera lajki dla wielu itemów naraz — jeden request zamiast N

feedRouter.get('/likes/batch', async (req: Request, res: Response) => {
  const { userId, items } = req.query as { userId?: string; items?: string };
  if (!items) return void res.status(400).json({ status: 'error', message: 'items required' });

  const itemIds = items.split(',').filter(Boolean);
  const [counts, userLikes] = await Promise.all([
    Like.aggregate([
      { $match: { itemId: { $in: itemIds } } },
      { $group: { _id: '$itemId', count: { $sum: 1 } } },
    ]),
    userId
      ? Like.find({ itemId: { $in: itemIds }, userId }).select('itemId')
      : Promise.resolve([]),
  ]);

  const likedSet  = new Set((userLikes as { itemId: string }[]).map(l => l.itemId));
  const countMap  = Object.fromEntries(counts.map((c: { _id: string; count: number }) => [c._id, c.count]));

  const result = Object.fromEntries(
    itemIds.map(id => [id, { count: countMap[id] ?? 0, liked: likedSet.has(id) }])
  );

  res.json({ status: 'ok', data: result });
});

// ── GET /feed/comments/batch?items=id1,id2,id3 ───────────────────────────────
// Pobiera komentarze dla wielu itemów naraz

feedRouter.get('/comments/batch', async (req: Request, res: Response) => {
  const { items } = req.query as { items?: string };
  if (!items) return void res.status(400).json({ status: 'error', message: 'items required' });

  const itemIds  = items.split(',').filter(Boolean);
  const comments = await Comment.find({ itemId: { $in: itemIds } }).sort({ createdAt: 1 });

  const result: Record<string, typeof comments> = {};
  for (const id of itemIds) result[id] = [];
  for (const c of comments) {
    if (!result[c.itemId]) result[c.itemId] = [];
    result[c.itemId].push(c);
  }

  res.json({ status: 'ok', data: result });
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
