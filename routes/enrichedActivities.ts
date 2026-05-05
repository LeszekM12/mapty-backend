// ─── ENRICHED ACTIVITIES ROUTER (Home feed) ──────────────────────────────────
import { Router, Request, Response } from 'express';
import { EnrichedActivity } from '../models/EnrichedActivity.js';

export const enrichedActivitiesRouter = Router();

enrichedActivitiesRouter.get('/', async (req: Request, res: Response) => {
  const { userId } = req.query;
  if (!userId) return void res.status(400).json({ status: 'error', message: 'userId required' });
  const items = await EnrichedActivity.find({ userId }).sort({ date: -1 });
  res.json({ status: 'ok', count: items.length, data: items });
});

enrichedActivitiesRouter.get('/:id', async (req: Request, res: Response) => {
  const item = await EnrichedActivity.findOne({ activityId: req.params.id, userId: req.query.userId });
  if (!item) return void res.status(404).json({ status: 'error', message: 'Not found' });
  res.json({ status: 'ok', data: item });
});

enrichedActivitiesRouter.post('/', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  if (!body.userId || !body.activityId) {
    return void res.status(400).json({ status: 'error', message: 'userId and activityId required' });
  }
  // Usuń coords — są już w activities, nie duplikuj w enrichedActivities
  const { coords: _coords, ...lean } = body as Record<string, unknown> & { coords?: unknown };
  void _coords;
  const item = await EnrichedActivity.findOneAndUpdate(
    { activityId: lean.activityId as string, userId: lean.userId as string },
    { ...lean, coords: [], syncedAt: new Date() },
    { upsert: true, new: true },
  );
  res.status(201).json({ status: 'ok', data: item });
});

enrichedActivitiesRouter.delete('/:id', async (req: Request, res: Response) => {
  const r = await EnrichedActivity.deleteOne({ activityId: req.params.id, userId: req.query.userId });
  if (!r.deletedCount) return void res.status(404).json({ status: 'error', message: 'Not found' });
  res.json({ status: 'ok', message: 'Deleted' });
});

enrichedActivitiesRouter.post('/bulk', async (req: Request, res: Response) => {
  const { userId, items } = req.body as { userId: string; items: Record<string, unknown>[] };
  if (!userId || !Array.isArray(items)) {
    return void res.status(400).json({ status: 'error', message: 'userId and items[] required' });
  }
  const ops = items.map(item => {
    const { coords: _c, ...lean } = item as Record<string, unknown> & { coords?: unknown };
    void _c;
    return {
      updateOne: {
        filter: { activityId: lean.activityId ?? lean.id, userId },
        update: { $set: { ...lean, activityId: lean.activityId ?? lean.id, userId, coords: [], syncedAt: new Date() } },
        upsert: true,
      },
    };
  });
  const result = await EnrichedActivity.bulkWrite(ops as any[]);
  res.json({ status: 'ok', upserted: result.upsertedCount, modified: result.modifiedCount });
});

// POST /enriched-activities/:activityId/photo — zaktualizuj photoUrl i/lub minimapUrl
enrichedActivitiesRouter.post('/:activityId/photo', async (req: Request, res: Response) => {
  const { userId, photoUrl, photoPublicId, minimapUrl } = req.body as {
    userId: string; photoUrl?: string; photoPublicId?: string; minimapUrl?: string;
  };
  const { activityId } = req.params;
  const update: Record<string, unknown> = {};
  if (photoUrl !== undefined)    update.photoUrl    = photoUrl;
  if (photoPublicId !== undefined) update.photoPublicId = photoPublicId;
  if (minimapUrl !== undefined)  update.minimapUrl  = minimapUrl;
  await EnrichedActivity.findOneAndUpdate(
    { activityId, userId },
    { $set: update }
  );
  res.json({ status: 'ok' });
});
