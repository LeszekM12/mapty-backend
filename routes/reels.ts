// ─── REELS ROUTER ─────────────────────────────────────────────────────────────
// POST   /reels                    — dodaj reelsa
// GET    /reels/feed?userId=xxx    — reelsy znajomych + followujących
// GET    /reels/user/:userId       — reelsy konkretnego użytkownika
// POST   /reels/:reelId/view       — oznacz jako obejrzany
// POST   /reels/:reelId/like       — toggle lajk
// DELETE /reels/:reelId            — usuń reelsa

import { Router, Request, Response } from 'express';
import { Reel }  from '../models/Reel.js';
import { User }  from '../models/User.js';
import { v2 as cloudinary } from 'cloudinary';

export const reelsRouter = Router();

// ── POST /reels ───────────────────────────────────────────────────────────────

reelsRouter.post('/', async (req: Request, res: Response) => {
  const body = req.body as {
    reelId:       string;
    userId:       string;
    authorName:   string;
    avatarB64?:   string | null;
    mediaUrl:     string;
    mediaType:    'image' | 'video';
    publicId:     string;
    caption?:     string | null;
    captionX?:    number;
    captionY?:    number;
    captionSize?: number;
    captionColor?:string;
    duration?:    number;
  };

  if (!body.reelId || !body.userId || !body.mediaUrl || !body.publicId) {
    return void res.status(400).json({ status: 'error', message: 'reelId, userId, mediaUrl, publicId required' });
  }

  const now       = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // +24h

  const reel = await Reel.findOneAndUpdate(
    { reelId: body.reelId },
    {
      ...body,
      views:     [],
      likes:     [],
      expiresAt,
    },
    { upsert: true, new: true },
  );

  res.status(201).json({ status: 'ok', data: reel });
});

// ── GET /reels/feed?userId=xxx ────────────────────────────────────────────────
// Zwraca aktywne reelsy znajomych + followujących + własne

reelsRouter.get('/feed', async (req: Request, res: Response) => {
  const { userId } = req.query as { userId?: string };
  if (!userId) return void res.status(400).json({ status: 'error', message: 'userId required' });

  const user         = await User.findOne({ userId });
  const friendIds    = user?.friends   ?? [];
  const followingIds = (user?.following as string[] | undefined) ?? [];
  const allIds       = [...new Set([userId, ...friendIds, ...followingIds])];

  const now   = new Date();
  const reels = await Reel.find({
    userId:    { $in: allIds },
    expiresAt: { $gt: now },
  }).sort({ createdAt: 1 }); // oldest first → viewer plays 1→2→3

  // Grupuj po userId — każdy user jako osobna lista reelsów
  const byUser: Record<string, typeof reels> = {};
  for (const r of reels) {
    if (!byUser[r.userId]) byUser[r.userId] = [];
    byUser[r.userId].push(r);
  }

  // Zwróć jako tablicę userów z ich reelsami
  const result = Object.entries(byUser).map(([uid, userReels]) => ({
    userId:     uid,
    authorName: userReels[0].authorName,
    avatarB64:  userReels[0].avatarB64,
    reels:      userReels,
    hasUnseen:  userReels.some(r => !r.views.includes(userId)),
  }));

  res.json({ status: 'ok', data: result });
});

// ── GET /reels/user/:userId ───────────────────────────────────────────────────

reelsRouter.get('/user/:userId', async (req: Request, res: Response) => {
  const now   = new Date();
  const reels = await Reel.find({
    userId:    req.params.userId,
    expiresAt: { $gt: now },
  }).sort({ createdAt: 1 });
  res.json({ status: 'ok', count: reels.length, data: reels });
});

// ── POST /reels/:reelId/view ──────────────────────────────────────────────────

reelsRouter.post('/:reelId/view', async (req: Request, res: Response) => {
  const { userId } = req.body as { userId?: string };
  if (!userId) return void res.status(400).json({ status: 'error', message: 'userId required' });

  await Reel.findOneAndUpdate(
    { reelId: req.params.reelId },
    { $addToSet: { views: userId } },
  );
  res.json({ status: 'ok' });
});

// ── POST /reels/:reelId/like ──────────────────────────────────────────────────

reelsRouter.post('/:reelId/like', async (req: Request, res: Response) => {
  const { userId } = req.body as { userId?: string };
  if (!userId) return void res.status(400).json({ status: 'error', message: 'userId required' });

  const reel = await Reel.findOne({ reelId: req.params.reelId });
  if (!reel) return void res.status(404).json({ status: 'error', message: 'Reel not found' });

  const liked = reel.likes.includes(userId);
  if (liked) {
    await Reel.findOneAndUpdate({ reelId: req.params.reelId }, { $pull: { likes: userId } });
  } else {
    await Reel.findOneAndUpdate({ reelId: req.params.reelId }, { $addToSet: { likes: userId } });
  }

  res.json({ status: 'ok', liked: !liked, count: reel.likes.length + (liked ? -1 : 1) });
});

// ── DELETE /reels/:reelId ─────────────────────────────────────────────────────

reelsRouter.delete('/:reelId', async (req: Request, res: Response) => {
  const { userId } = req.query as { userId?: string };
  const reel = await Reel.findOne({ reelId: req.params.reelId });
  if (!reel) return void res.status(404).json({ status: 'error', message: 'Not found' });
  if (reel.userId !== userId) return void res.status(403).json({ status: 'error', message: 'Not authorized' });

  // Usuń z Cloudinary
  try {
    await cloudinary.uploader.destroy(reel.publicId, {
      resource_type: reel.mediaType === 'video' ? 'video' : 'image',
    });
  } catch { /* ignoruj */ }

  await Reel.deleteOne({ reelId: req.params.reelId });
  res.json({ status: 'ok', message: 'Deleted' });
});

// ── Cron-style cleanup — wywołuj raz dziennie z zewnątrz lub przy starcie ─────
// Usuwa wygasłe reelsy z Cloudinary których MongoDB TTL jeszcze nie wyczyścił

export async function cleanupExpiredReels(): Promise<void> {
  const expired = await Reel.find({ expiresAt: { $lte: new Date() } });
  for (const r of expired) {
    try {
      await cloudinary.uploader.destroy(r.publicId, {
        resource_type: r.mediaType === 'video' ? 'video' : 'image',
      });
    } catch { /* ignoruj */ }
  }
  if (expired.length > 0) {
    await Reel.deleteMany({ expiresAt: { $lte: new Date() } });
    console.log(`[Reels] Cleaned up ${expired.length} expired reels`);
  }
}

// Uruchom cleanup co godzinę
setInterval(() => void cleanupExpiredReels(), 60 * 60 * 1000);
