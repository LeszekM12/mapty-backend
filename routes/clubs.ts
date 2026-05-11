// ─── CLUBS ROUTER ────────────────────────────────────────────────────────────
import { Router, Request, Response } from 'express';
import { Club } from '../models/Club.js';

export const clubsRouter = Router();

// GET /clubs?q=name&city=xxx&sport=running — szukaj klubów
clubsRouter.get('/', async (req: Request, res: Response) => {
  const { q, city, region, sport } = req.query as { q?: string; city?: string; region?: string; sport?: string };
  const filter: Record<string, unknown> = {};
  if (q)      filter['$or'] = [{ name: { $regex: new RegExp(q.trim(), 'i') } }, { city: { $regex: new RegExp(q.trim(), 'i') } }, { location: { $regex: new RegExp(q.trim(), 'i') } }];
  if (region) filter['$or'] = [{ region: { $regex: new RegExp(region.trim(), 'i') } }, { location: { $regex: new RegExp(region.trim(), 'i') } }];
  if (city && !region)   filter['$or'] = [{ city: { $regex: new RegExp(city.trim(), 'i') } }, { location: { $regex: new RegExp(city.trim(), 'i') } }];
  if (sport)  filter['sport'] = sport;
  const clubs = await Club.find(filter).sort({ createdAt: -1 }).limit(50);
  res.json({ status: 'ok', count: clubs.length, data: clubs });
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
  const club = await Club.findOneAndUpdate(
    { clubId: body.clubId as string },
    {
      $set: body,
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
