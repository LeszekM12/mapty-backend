// ─── MAPYOU BACKEND v2 ───────────────────────────────────────────────────────
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors    from 'cors';
import helmet  from 'helmet';
import morgan  from 'morgan';
import { connectDB }               from './db.js';
import { workoutsRouter }          from './routes/workouts.js';
import { activitiesRouter }        from './routes/activities.js';
import { enrichedActivitiesRouter } from './routes/enrichedActivities.js';
import { unifiedWorkoutsRouter }   from './routes/unifiedWorkouts.js';
import { usersRouter }             from './routes/users.js';
import { postsRouter }             from './routes/posts.js';
import { clubsRouter }             from './routes/clubs.js';
import { notificationsRouter }     from './routes/notifications.js';
import { recordsRouter }           from './routes/records.js';
import { pushRouter }              from './routes/pushService.js';
import { liveRouter }              from './routes/liveTracking.js';
import { migrateRouter }           from './routes/migrate.js';
import { recoverRouter }           from './routes/recover.js';
import { feedRouter }              from './routes/feed.js';
import { uploadRouter }           from './routes/upload.js';

const app  = express();
const PORT = process.env.PORT ?? 3000;

// ── CORS ──────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
    'https://leszekm12.github.io',
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:8080',
    ...(process.env.EXTRA_ORIGINS ? process.env.EXTRA_ORIGINS.split(',') : []),
];

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(helmet());
app.use(cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true);           // curl / Postman / PWA
        if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    methods:      ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials:  true,
}));
// Skip logging for high-frequency polling endpoints
app.use(morgan('dev', {
    skip: (req) => {
        const p = req.path;
        return p.startsWith('/live/active/') ||
            p.startsWith('/live/status/') ||
            (p.startsWith('/live/') && req.method === 'GET');
    }
}));
app.use(express.json({ limit: '50mb' }));  // 50mb — bulk migration with base64
app.use(express.urlencoded({ extended: true }));

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/', (_req: Request, res: Response) => {
    res.json({
        name:    'MapYou API',
        version: '2.0.0',
        status:  'running',
        db:      'MongoDB Atlas',
        endpoints: {
            workouts:          '/workouts',
            activities:        '/activities',
            enrichedActivities:'/enriched-activities',
            unifiedWorkouts:   '/unified-workouts',
            users:             '/users',
            posts:             '/posts',
            clubs:             '/clubs',
            notifications:     '/notifications',
            records:           '/records',
            push:              '/push',
            live:              '/live',
        },
    });
});

app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptime: process.uptime(), db: 'connected' });
});

app.use('/workouts',           workoutsRouter);
app.use('/activities',         activitiesRouter);
app.use('/enriched-activities', enrichedActivitiesRouter);
app.use('/unified-workouts',   unifiedWorkoutsRouter);
app.use('/users',              usersRouter);
app.use('/posts',              postsRouter);
app.use('/clubs',              clubsRouter);
app.use('/notifications',      notificationsRouter);
app.use('/records',            recordsRouter);
app.use('/push',               pushRouter);
app.use('/live',               liveRouter);
app.use('/migrate',            migrateRouter);
app.use('/recover',            recoverRouter);
app.use('/feed',               feedRouter);
app.use('/upload',             uploadRouter);

// ── 404 ───────────────────────────────────────────────────────────────────────

app.use((_req: Request, res: Response) => {
    res.status(404).json({ status: 'error', message: 'Route not found' });
});

// ── Global error handler ──────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Error]', err.message);
    const status = err.message.startsWith('CORS') ? 403 : 500;
    res.status(status).json({ status: 'error', message: err.message });
});

// ── Boot ──────────────────────────────────────────────────────────────────────

(async () => {
    await connectDB();
    app.listen(PORT, () => {
        console.log(`✅ MapYou backend v2 running on port ${PORT}`);
        console.log(`   Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
    });
})();

export default app;