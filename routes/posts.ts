// ─── POSTS ROUTER ────────────────────────────────────────────────────────────
import { Router, Request, Response } from 'express';
import { Post } from '../models/Post.js';
import { User } from '../models/User.js';

export const postsRouter = Router();

// GET /posts?userId=xxx — posty użytkownika
postsRouter.get('/', async (req: Request, res: Response) => {
  const { userId } = req.query;
  if (!userId) return void res.status(400).json({ status: 'error', message: 'userId required' });
  const posts = await Post.find({ userId }).sort({ date: -1 });
  res.json({ status: 'ok', count: posts.length, data: posts });
});

// GET /posts/feed?userId=xxx — posty znajomych + własne
postsRouter.get('/feed', async (req: Request, res: Response) => {
  const { userId } = req.query;
  if (!userId) return void res.status(400).json({ status: 'error', message: 'userId required' });

  // Pobierz znajomych
  const user = await User.findOne({ userId });
  const friendIds = user?.friends ?? [];
  const allIds = [userId as string, ...friendIds];

  const posts = await Post.find({ userId: { $in: allIds } }).sort({ date: -1 }).limit(50);
  res.json({ status: 'ok', count: posts.length, data: posts });
});

// POST /posts
postsRouter.post('/', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  if (!body.userId || !body.postId) {
    return void res.status(400).json({ status: 'error', message: 'userId and postId required' });
  }
  // Usuń avatarB64 — avatar jest już w users, nie duplikuj w każdym poście
  const { avatarB64: _avatar, ...lean } = body as Record<string, unknown> & { avatarB64?: unknown };
  void _avatar;
  const post = await Post.findOneAndUpdate(
    { postId: lean.postId as string, userId: lean.userId as string },
    { ...lean, avatarB64: null, syncedAt: new Date() },
    { upsert: true, new: true },
  );
  res.status(201).json({ status: 'ok', data: post });
});

// DELETE /posts/:id?userId=xxx&ownerId=xxx
postsRouter.delete('/:id', async (req: Request, res: Response) => {
  const { userId, ownerId } = req.query as { userId?: string; ownerId?: string };
  // Allow delete if: author OR club owner
  let r = await Post.deleteOne({ postId: req.params.id, userId });
  if (!r.deletedCount && ownerId) {
    // Owner can delete any post in their club
    const post = await Post.findOne({ postId: req.params.id });
    if (post) {
      const { Club } = await import('../models/Club.js');
      const clubIds = (post.clubIds as string[] | undefined) ?? [];
      const ownerClub = await Club.findOne({ clubId: { $in: clubIds }, ownerId });
      if (ownerClub) r = await Post.deleteOne({ postId: req.params.id });
    }
  }
  if (!r.deletedCount) return void res.status(404).json({ status: 'error', message: 'Not found' });
  res.json({ status: 'ok', message: 'Deleted' });
});

// POST /posts/bulk
postsRouter.post('/bulk', async (req: Request, res: Response) => {
  const { userId, items } = req.body as { userId: string; items: Record<string, unknown>[] };
  if (!userId || !Array.isArray(items)) {
    return void res.status(400).json({ status: 'error', message: 'userId and items[] required' });
  }
  const ops = items.map(item => {
    const { avatarB64: _a, ...lean } = item as Record<string, unknown> & { avatarB64?: unknown };
    void _a;
    return {
      updateOne: {
        filter: { postId: lean.postId ?? lean.id, userId },
        update: { $set: { ...lean, postId: lean.postId ?? lean.id, userId, avatarB64: null, syncedAt: new Date() } },
        upsert: true,
      },
    };
  });
  const result = await Post.bulkWrite(ops as any[]);
  res.json({ status: 'ok', upserted: result.upsertedCount, modified: result.modifiedCount });
});

// PATCH /posts/:postId/photo — zaktualizuj photoUrl
postsRouter.post('/:postId/photo', async (req: Request, res: Response) => {
  const { userId, photoUrl, photoPublicId } = req.body as { userId: string; photoUrl: string; photoPublicId: string };
  const { postId } = req.params;
  await Post.findOneAndUpdate(
    { postId, userId },
    { $set: { photoUrl, photoPublicId } }
  );
  res.json({ status: 'ok' });
});
