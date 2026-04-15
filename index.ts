// ─── MAPTY BACKEND ───────────────────────────────────────────────────────────

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { workoutsRouter } from './workouts.js';
import { pushRouter }     from './pushService.js';

const app  = express();
const PORT = process.env.PORT ?? 3000;

// ── Dozwolone originy ─────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  'https://leszekm12.github.io',            // GitHub Pages
  'http://localhost:5173',                  // Vite dev
  'http://localhost:3000',                  // local backend dev
  ...(process.env.EXTRA_ORIGINS
    ? process.env.EXTRA_ORIGINS.split(',')
    : []),
];

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(helmet());

app.use(cors({
  origin: (origin, callback) => {
    // Pozwól na brak originu (np. curl, Postman, mobile PWA)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/', (_req: Request, res: Response) => {
  res.json({
    name:    'Mapty API',
    version: '1.0.0',
    status:  'running',
    endpoints: {
      workouts:     '/workouts',
      push_key:     '/push/vapid-public-key',
      subscribe:    '/push/subscribe',
      unsubscribe:  '/push/unsubscribe',
      send_push:    '/push/send',
      subscriptions:'/push/subscriptions',
    },
  });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use('/workouts', workoutsRouter);
app.use('/push',     pushRouter);

// ── 404 handler ───────────────────────────────────────────────────────────────

app.use((_req: Request, res: Response) => {
  res.status(404).json({ status: 'error', message: 'Route not found' });
});

// ── Global error handler ──────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Error]', err.message);
  const status = err.message.startsWith('CORS') ? 403 : 500;
  res.status(status).json({ status: 'error', message: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✅ Mapty backend running on port ${PORT}`);
  console.log(`   Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});

export default app;
