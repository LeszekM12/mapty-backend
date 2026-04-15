"use strict";
// ─── IN-MEMORY DATABASE ───────────────────────────────────────────────────────
//
// Prosta baza w pamięci — gotowa do zamiany na MongoDB.
// Wystarczy podmienić implementację metod zachowując ten sam interfejs.
//
// Aby zamienić na MongoDB:
//   1. npm install mongoose
//   2. Utwórz plik db/mongooseDB.ts z tą samą klasą DB
//   3. Podmień import w routes/workouts.ts i services/pushService.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
class MemoryDB {
    constructor() {
        // ── Workouty ────────────────────────────────────────────────────────────────
        this.workouts = new Map();
        // ── Push subskrypcje ────────────────────────────────────────────────────────
        this.subscriptions = new Map();
    }
    getAllWorkouts() {
        return Array.from(this.workouts.values())
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    getWorkoutById(id) {
        return this.workouts.get(id);
    }
    saveWorkout(workout) {
        this.workouts.set(workout.id, workout);
        return workout;
    }
    updateWorkout(id, data) {
        const existing = this.workouts.get(id);
        if (!existing)
            return null;
        const updated = { ...existing, ...data, id };
        this.workouts.set(id, updated);
        return updated;
    }
    deleteWorkout(id) {
        return this.workouts.delete(id);
    }
    clearWorkouts() {
        this.workouts.clear();
    }
    workoutCount() {
        return this.workouts.size;
    }
    getAllSubscriptions() {
        return Array.from(this.subscriptions.values());
    }
    getSubscriptionByEndpoint(endpoint) {
        for (const sub of this.subscriptions.values()) {
            if (sub.endpoint === endpoint)
                return sub;
        }
        return undefined;
    }
    saveSubscription(sub) {
        this.subscriptions.set(sub.id, sub);
        return sub;
    }
    deleteSubscription(id) {
        return this.subscriptions.delete(id);
    }
    deleteSubscriptionByEndpoint(endpoint) {
        for (const [id, sub] of this.subscriptions.entries()) {
            if (sub.endpoint === endpoint) {
                this.subscriptions.delete(id);
                return true;
            }
        }
        return false;
    }
    subscriptionCount() {
        return this.subscriptions.size;
    }
}
// Singleton — jedna instancja na cały proces
exports.db = new MemoryDB();
//# sourceMappingURL=memoryDB.js.map