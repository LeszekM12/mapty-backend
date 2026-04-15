// ─── WORKOUTS ROUTER ─────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { db } from './memoryDB.js';
import { Workout, CreateWorkoutDto, UpdateWorkoutDto, WorkoutType } from './Workout.js';

export const workoutsRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function generateDescription(type: WorkoutType, isoDate: string): string {
  const d = new Date(isoDate);
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  return `${label} on ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function buildWorkout(dto: CreateWorkoutDto, id?: string): Workout {
  const now  = new Date().toISOString();
  const date = dto.date ?? now;
  const type = dto.type;

  let cadence:     number | null = null;
  let pace:        number | null = null;
  let elevGain:    number | null = null;
  let elevationGain: number | null = null;
  let speed:       number | null = null;

  if (type === 'running' || type === 'walking') {
    cadence = dto.cadence ?? null;
    pace    = dto.duration > 0 && dto.distance > 0
      ? dto.duration / dto.distance
      : null;
  }

  if (type === 'cycling') {
    elevGain      = dto.elevGain ?? dto.elevationGain ?? 0;
    elevationGain = elevGain;
    speed         = dto.duration > 0 && dto.distance > 0
      ? dto.distance / (dto.duration / 60)
      : 0;
  }

  return {
    id:           id ?? String(Date.now()),
    type,
    date,
    coords:       dto.coords,
    description:  dto.description ?? generateDescription(type, date),
    distance:     dto.distance,
    duration:     dto.duration,
    cadence,
    pace,
    elevGain,
    elevationGain,
    speed,
    routeCoords:  dto.routeCoords ?? null,
  };
}

function validateCreateDto(body: unknown): { valid: boolean; error?: string } {
  if (!body || typeof body !== 'object') return { valid: false, error: 'Body must be an object' };
  const b = body as Record<string, unknown>;

  if (!['running', 'cycling', 'walking'].includes(b.type as string))
    return { valid: false, error: 'type must be running | cycling | walking' };

  if (!Array.isArray(b.coords) || b.coords.length !== 2 ||
      typeof b.coords[0] !== 'number' || typeof b.coords[1] !== 'number')
    return { valid: false, error: 'coords must be [lat, lng] numbers' };

  if (typeof b.distance !== 'number' || b.distance <= 0)
    return { valid: false, error: 'distance must be a positive number (km)' };

  if (typeof b.duration !== 'number' || b.duration <= 0)
    return { valid: false, error: 'duration must be a positive number (min)' };

  return { valid: true };
}

// ── GET /workouts ─────────────────────────────────────────────────────────────

workoutsRouter.get('/', (_req: Request, res: Response) => {
  const workouts = db.getAllWorkouts();
  res.json({
    status:  'ok',
    count:   workouts.length,
    data:    workouts,
  });
});

// ── GET /workouts/:id ─────────────────────────────────────────────────────────

workoutsRouter.get('/:id', (req: Request, res: Response) => {
  const workout = db.getWorkoutById(req.params.id);
  if (!workout) {
    res.status(404).json({ status: 'error', message: `Workout ${req.params.id} not found` });
    return;
  }
  res.json({ status: 'ok', data: workout });
});

// ── POST /workouts ────────────────────────────────────────────────────────────

workoutsRouter.post('/', (req: Request, res: Response) => {
  const { valid, error } = validateCreateDto(req.body);
  if (!valid) {
    res.status(400).json({ status: 'error', message: error });
    return;
  }

  const dto     = req.body as CreateWorkoutDto;
  const workout = buildWorkout(dto);
  const saved   = db.saveWorkout(workout);

  console.log(`[Workouts] POST — saved ${saved.id} (${saved.type})`);
  res.status(201).json({ status: 'ok', data: saved });
});

// ── PUT /workouts/:id ─────────────────────────────────────────────────────────

workoutsRouter.put('/:id', (req: Request, res: Response) => {
  const existing = db.getWorkoutById(req.params.id);
  if (!existing) {
    res.status(404).json({ status: 'error', message: `Workout ${req.params.id} not found` });
    return;
  }

  const dto     = req.body as UpdateWorkoutDto;
  const updated = db.updateWorkout(req.params.id, {
    ...(dto.type        !== undefined && { type:        dto.type }),
    ...(dto.coords      !== undefined && { coords:      dto.coords }),
    ...(dto.distance    !== undefined && { distance:    dto.distance }),
    ...(dto.duration    !== undefined && { duration:    dto.duration }),
    ...(dto.cadence     !== undefined && { cadence:     dto.cadence ?? null }),
    ...(dto.elevGain    !== undefined && { elevGain:    dto.elevGain ?? null, elevationGain: dto.elevGain ?? null }),
    ...(dto.routeCoords !== undefined && { routeCoords: dto.routeCoords ?? null }),
    ...(dto.description !== undefined && { description: dto.description }),
    ...(dto.date        !== undefined && { date:        dto.date }),
  });

  console.log(`[Workouts] PUT — updated ${req.params.id}`);
  res.json({ status: 'ok', data: updated });
});

// ── DELETE /workouts/:id ──────────────────────────────────────────────────────

workoutsRouter.delete('/:id', (req: Request, res: Response) => {
  const deleted = db.deleteWorkout(req.params.id);
  if (!deleted) {
    res.status(404).json({ status: 'error', message: `Workout ${req.params.id} not found` });
    return;
  }

  console.log(`[Workouts] DELETE — removed ${req.params.id}`);
  res.json({ status: 'ok', message: `Workout ${req.params.id} deleted` });
});
