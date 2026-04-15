// ─── WORKOUT TYPES ───────────────────────────────────────────────────────────

export type WorkoutType = 'running' | 'cycling' | 'walking';

export type Coords = [number, number];

export interface Workout {
  id:           string;
  type:         WorkoutType;
  date:         string;         // ISO string
  coords:       Coords;
  description:  string;
  distance:     number;         // km
  duration:     number;         // min
  cadence:      number | null;  // running / walking
  pace:         number | null;  // min/km
  elevGain:     number | null;  // cycling
  elevationGain:number | null;
  speed:        number | null;  // km/h
  routeCoords:  Coords[] | null;
}

export interface CreateWorkoutDto {
  type:         WorkoutType;
  coords:       Coords;
  distance:     number;
  duration:     number;
  cadence?:     number | null;
  elevGain?:    number | null;
  elevationGain?: number | null;
  routeCoords?: Coords[] | null;
  description?: string;
  date?:        string;
}

export interface UpdateWorkoutDto extends Partial<CreateWorkoutDto> {}

// ─── PUSH SUBSCRIPTION ───────────────────────────────────────────────────────

export interface PushSubscriptionRecord {
  id:           string;
  endpoint:     string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth:   string;
  };
  createdAt:    string;
}

export interface PushPayload {
  title:  string;
  body:   string;
  icon?:  string;
  badge?: string;
  url?:   string;
}
