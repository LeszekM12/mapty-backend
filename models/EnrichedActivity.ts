// ─── ENRICHED ACTIVITY MODEL (Home feed — rich activities) ───────────────────
import { Schema, model, Document } from 'mongoose';

export interface IEnrichedActivity extends Document {
  activityId:  string;
  userId:      string;
  sport:       string;
  date:        number;   // timestamp ms
  name:        string;
  description: string;
  photoUrl:    string | null;
  clubIds:     string[]; // clubs this activity is shared to
  photoPublicId: string | null;
  distanceKm:  number;
  durationSec: number;
  paceMinKm:   number;
  speedKmH:    number;
  intensity:   number;   // 1–5
  notes:       string;
  coordsEnc:   string | null;   // Encoded Polyline (compressed coords)
  syncedAt:    Date;
}

const EnrichedActivitySchema = new Schema<IEnrichedActivity>(
  {
    activityId:  { type: String, required: true },
    userId:      { type: String, required: true, index: true },
    sport:       { type: String, required: true },
    date:        { type: Number, required: true },
    name:        { type: String, default: '' },
    description: { type: String, default: '' },
    photoUrl:    { type: String, default: null },
    clubIds:     [{ type: String }],
    photoPublicId: { type: String, default: null },
    distanceKm:  { type: Number, default: 0 },
    durationSec: { type: Number, default: 0 },
    paceMinKm:   { type: Number, default: 0 },
    speedKmH:    { type: Number, default: 0 },
    intensity:   { type: Number, default: 3, min: 1, max: 5 },
    notes:       { type: String, default: '' },
    coordsEnc:   { type: String, default: null },
    syncedAt:    { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

EnrichedActivitySchema.index({ userId: 1, activityId: 1 }, { unique: true });

export const EnrichedActivity = model<IEnrichedActivity>('EnrichedActivity', EnrichedActivitySchema);
