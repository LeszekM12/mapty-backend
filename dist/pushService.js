"use strict";
// ─── PUSH NOTIFICATION SERVICE ───────────────────────────────────────────────
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushRouter = void 0;
const web_push_1 = __importDefault(require("web-push"));
const express_1 = require("express");
const memoryDB_js_1 = require("./memoryDB.js");
// ── VAPID setup ───────────────────────────────────────────────────────────────
//
// Klucze VAPID generowane są raz i trzymane w zmiennych środowiskowych.
// Jeśli nie ma kluczy w env → generujemy nowe i logujemy.
// Na Render: ustaw VAPID_PUBLIC_KEY i VAPID_PRIVATE_KEY w Environment.
let vapidPublicKey;
let vapidPrivateKey;
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
    console.log('[Push] VAPID keys loaded from environment.');
}
else {
    // Generuj nowe klucze (tylko przy pierwszym uruchomieniu bez env)
    const keys = web_push_1.default.generateVAPIDKeys();
    vapidPublicKey = keys.publicKey;
    vapidPrivateKey = keys.privateKey;
    console.warn('┌─────────────────────────────────────────────────────┐');
    console.warn('│  ⚠️  VAPID keys generated — save them in .env!      │');
    console.warn('├─────────────────────────────────────────────────────┤');
    console.warn(`│  VAPID_PUBLIC_KEY=${vapidPublicKey}  │`);
    console.warn(`│  VAPID_PRIVATE_KEY=${vapidPrivateKey}  │`);
    console.warn('└─────────────────────────────────────────────────────┘');
}
web_push_1.default.setVapidDetails(`mailto:${process.env.VAPID_EMAIL ?? 'admin@mapty.app'}`, vapidPublicKey, vapidPrivateKey);
// ── Router ────────────────────────────────────────────────────────────────────
exports.pushRouter = (0, express_1.Router)();
// GET /push/vapid-public-key — frontend pobiera klucz do subskrypcji
exports.pushRouter.get('/vapid-public-key', (_req, res) => {
    res.json({ status: 'ok', publicKey: vapidPublicKey });
});
// POST /push/subscribe — zapisuje subskrypcję przeglądarki
exports.pushRouter.post('/subscribe', (req, res) => {
    const body = req.body;
    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
        res.status(400).json({
            status: 'error',
            message: 'Missing endpoint, keys.p256dh or keys.auth',
        });
        return;
    }
    // Jeśli subskrypcja już istnieje — zaktualizuj, nie duplikuj
    const existing = memoryDB_js_1.db.getSubscriptionByEndpoint(body.endpoint);
    if (existing) {
        console.log(`[Push] Subscription already exists: ${existing.id}`);
        res.json({ status: 'ok', message: 'Already subscribed', id: existing.id });
        return;
    }
    const record = {
        id: String(Date.now()),
        endpoint: body.endpoint,
        expirationTime: body.expirationTime ?? null,
        keys: {
            p256dh: body.keys.p256dh,
            auth: body.keys.auth,
        },
        createdAt: new Date().toISOString(),
    };
    memoryDB_js_1.db.saveSubscription(record);
    console.log(`[Push] New subscription saved: ${record.id}`);
    res.status(201).json({ status: 'ok', message: 'Subscribed', id: record.id });
});
// POST /push/unsubscribe — usuwa subskrypcję
exports.pushRouter.post('/unsubscribe', (req, res) => {
    const { endpoint } = req.body;
    if (!endpoint) {
        res.status(400).json({ status: 'error', message: 'Missing endpoint' });
        return;
    }
    const deleted = memoryDB_js_1.db.deleteSubscriptionByEndpoint(endpoint);
    if (!deleted) {
        res.status(404).json({ status: 'error', message: 'Subscription not found' });
        return;
    }
    console.log(`[Push] Subscription removed: ${endpoint.slice(0, 50)}...`);
    res.json({ status: 'ok', message: 'Unsubscribed' });
});
// POST /push/send — wysyła push do wszystkich subskrypcji
exports.pushRouter.post('/send', async (req, res) => {
    const body = req.body;
    if (!body.title || !body.body) {
        res.status(400).json({ status: 'error', message: 'Missing title or body' });
        return;
    }
    const payload = {
        title: body.title,
        body: body.body,
        icon: body.icon ?? '/icon-192.png',
        badge: body.badge ?? '/icon-192.png',
        url: body.url ?? '/',
    };
    const subscriptions = memoryDB_js_1.db.getAllSubscriptions();
    if (subscriptions.length === 0) {
        res.json({ status: 'ok', message: 'No subscriptions to send to', sent: 0 });
        return;
    }
    const results = await Promise.allSettled(subscriptions.map(sub => web_push_1.default.sendNotification({
        endpoint: sub.endpoint,
        expirationTime: sub.expirationTime,
        keys: {
            p256dh: sub.keys.p256dh,
            auth: sub.keys.auth,
        },
    }, JSON.stringify(payload)).catch(async (err) => {
        // 410 Gone — subskrypcja wygasła, usuń ją
        if (err.statusCode === 410) {
            console.log(`[Push] Removing expired subscription: ${sub.id}`);
            memoryDB_js_1.db.deleteSubscription(sub.id);
        }
        throw err;
    })));
    const sent = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    console.log(`[Push] Sent: ${sent}, Failed: ${failed}`);
    res.json({
        status: 'ok',
        message: `Sent to ${sent}/${subscriptions.length} subscribers`,
        sent,
        failed,
    });
});
// GET /push/subscriptions — podgląd liczby subskrypcji (diagnostyczne)
exports.pushRouter.get('/subscriptions', (_req, res) => {
    res.json({
        status: 'ok',
        count: memoryDB_js_1.db.subscriptionCount(),
    });
});
//# sourceMappingURL=pushService.js.map