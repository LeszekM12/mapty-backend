// ─── NOTIFICATIONS ROUTER ────────────────────────────────────────────────────
import { Router, Request, Response } from 'express';
import { Notification } from '../models/Notification.js';

export const notificationsRouter = Router();

// GET /notifications?userId=xxx
notificationsRouter.get('/', async (req: Request, res: Response) => {
  const { userId } = req.query;
  if (!userId) return void res.status(400).json({ status: 'error', message: 'userId required' });
  const items = await Notification.find({ userId }).sort({ timestamp: -1 }).limit(50);
  const unread = items.filter(n => !n.read).length;
  res.json({ status: 'ok', count: items.length, unread, data: items });
});

// POST /notifications — utwórz powiadomienie
notificationsRouter.post('/', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  if (!body.userId || !body.notifId) {
    return void res.status(400).json({ status: 'error', message: 'userId and notifId required' });
  }
  const n = await Notification.findOneAndUpdate(
    { notifId: body.notifId as string, userId: body.userId as string },
    { ...body, syncedAt: new Date() },
    { upsert: true, new: true },
  );
  res.status(201).json({ status: 'ok', data: n });
});

// PUT /notifications/read-all?userId=xxx — oznacz wszystkie jako przeczytane
notificationsRouter.put('/read-all', async (req: Request, res: Response) => {
  const { userId } = req.query;
  if (!userId) return void res.status(400).json({ status: 'error', message: 'userId required' });
  await Notification.updateMany({ userId, read: false }, { $set: { read: true } });
  res.json({ status: 'ok', message: 'All marked as read' });
});

// PUT /notifications/:id/read?userId=xxx
notificationsRouter.put('/:id/read', async (req: Request, res: Response) => {
  const n = await Notification.findOneAndUpdate(
    { notifId: req.params.id, userId: req.query.userId },
    { $set: { read: true } },
    { new: true },
  );
  if (!n) return void res.status(404).json({ status: 'error', message: 'Not found' });
  res.json({ status: 'ok', data: n });
});

// DELETE /notifications/:id?userId=xxx
notificationsRouter.delete('/:id', async (req: Request, res: Response) => {
  const r = await Notification.deleteOne({ notifId: req.params.id, userId: req.query.userId });
  if (!r.deletedCount) return void res.status(404).json({ status: 'error', message: 'Not found' });
  res.json({ status: 'ok', message: 'Deleted' });
});

// DELETE /notifications/all?userId=xxx — wyczyść wszystkie
notificationsRouter.delete('/all', async (req: Request, res: Response) => {
  const { userId } = req.query;
  if (!userId) return void res.status(400).json({ status: 'error', message: 'userId required' });
  await Notification.deleteMany({ userId });
  res.json({ status: 'ok', message: 'All cleared' });
});

// POST /notifications/bulk
notificationsRouter.post('/bulk', async (req: Request, res: Response) => {
  const { userId, items } = req.body as { userId: string; items: Record<string, unknown>[] };
  if (!userId || !Array.isArray(items)) {
    return void res.status(400).json({ status: 'error', message: 'userId and items[] required' });
  }
  const ops = items.map(item => ({
    updateOne: {
      filter: { notifId: item.notifId ?? item.id, userId },
      update: { $set: { ...item, notifId: item.notifId ?? item.id, userId, syncedAt: new Date() } },
      upsert: true,
    },
  }));
  const result = await Notification.bulkWrite(ops as any[]);
  res.json({ status: 'ok', upserted: result.upsertedCount, modified: result.modifiedCount });
});
