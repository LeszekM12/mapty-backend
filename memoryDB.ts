// ─── IN-MEMORY DATABASE ───────────────────────────────────────────────────────
//
// Prosta baza w pamięci — gotowa do zamiany na MongoDB.
// Wystarczy podmienić implementację metod zachowując ten sam interfejs.
//
// Aby zamienić na MongoDB:
//   1. npm install mongoose
//   2. Utwórz plik db/mongooseDB.ts z tą samą klasą DB
//   3. Podmień import w routes/workouts.ts i services/pushService.ts

import { Workout, PushSubscriptionRecord } from '../types/Workout.js';

class MemoryDB {
  // ── Workouty ────────────────────────────────────────────────────────────────

  private workouts: Map<string, Workout> = new Map();

  getAllWorkouts(): Workout[] {
    return Array.from(this.workouts.values())
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  getWorkoutById(id: string): Workout | undefined {
    return this.workouts.get(id);
  }

  saveWorkout(workout: Workout): Workout {
    this.workouts.set(workout.id, workout);
    return workout;
  }

  updateWorkout(id: string, data: Partial<Workout>): Workout | null {
    const existing = this.workouts.get(id);
    if (!existing) return null;
    const updated: Workout = { ...existing, ...data, id };
    this.workouts.set(id, updated);
    return updated;
  }

  deleteWorkout(id: string): boolean {
    return this.workouts.delete(id);
  }

  clearWorkouts(): void {
    this.workouts.clear();
  }

  workoutCount(): number {
    return this.workouts.size;
  }

  // ── Push subskrypcje ────────────────────────────────────────────────────────

  private subscriptions: Map<string, PushSubscriptionRecord> = new Map();

  getAllSubscriptions(): PushSubscriptionRecord[] {
    return Array.from(this.subscriptions.values());
  }

  getSubscriptionByEndpoint(endpoint: string): PushSubscriptionRecord | undefined {
    for (const sub of this.subscriptions.values()) {
      if (sub.endpoint === endpoint) return sub;
    }
    return undefined;
  }

  saveSubscription(sub: PushSubscriptionRecord): PushSubscriptionRecord {
    this.subscriptions.set(sub.id, sub);
    return sub;
  }

  deleteSubscription(id: string): boolean {
    return this.subscriptions.delete(id);
  }

  deleteSubscriptionByEndpoint(endpoint: string): boolean {
    for (const [id, sub] of this.subscriptions.entries()) {
      if (sub.endpoint === endpoint) {
        this.subscriptions.delete(id);
        return true;
      }
    }
    return false;
  }

  subscriptionCount(): number {
    return this.subscriptions.size;
  }
}

// Singleton — jedna instancja na cały proces
export const db = new MemoryDB();
