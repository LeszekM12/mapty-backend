"use strict";
// ─── MAPTY BACKEND ───────────────────────────────────────────────────────────
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const workouts_js_1 = require("./workouts.js");
const pushService_js_1 = require("./pushService.js");
const app = (0, express_1.default)();
const PORT = process.env.PORT ?? 3000;
// ── Dozwolone originy ─────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
    'https://leszekm12.github.io', // GitHub Pages
    'http://localhost:5173', // Vite dev
    'http://localhost:3000', // local backend dev
    ...(process.env.EXTRA_ORIGINS
        ? process.env.EXTRA_ORIGINS.split(',')
        : []),
];
// ── Middleware ────────────────────────────────────────────────────────────────
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // Pozwól na brak originu (np. curl, Postman, mobile PWA)
        if (!origin)
            return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin))
            return callback(null, true);
        callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
}));
app.use((0, morgan_1.default)('dev'));
app.use(express_1.default.json({ limit: '1mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
    res.json({
        name: 'Mapty API',
        version: '1.0.0',
        status: 'running',
        endpoints: {
            workouts: '/workouts',
            push_key: '/push/vapid-public-key',
            subscribe: '/push/subscribe',
            unsubscribe: '/push/unsubscribe',
            send_push: '/push/send',
            subscriptions: '/push/subscriptions',
        },
    });
});
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});
app.use('/workouts', workouts_js_1.workoutsRouter);
app.use('/push', pushService_js_1.pushRouter);
// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ status: 'error', message: 'Route not found' });
});
// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
    console.error('[Error]', err.message);
    const status = err.message.startsWith('CORS') ? 403 : 500;
    res.status(status).json({ status: 'error', message: err.message });
});
// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`✅ Mapty backend running on port ${PORT}`);
    console.log(`   Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
exports.default = app;
//# sourceMappingURL=index.js.map