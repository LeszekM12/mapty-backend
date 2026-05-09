// ─── LIVE SESSION MODEL ──────────────────────────────────────────────────────
import { Schema, model, Document } from 'mongoose';

export interface IPositionPoint {
  lat:       number;
  lng:       number;
  speed:     number;
  timestamp: number;
}

export interface ILiveSession extends Document {
  token:        string;
  userName:     string;
  userId:       string | null;
  status:       'running' | 'paused' | 'finished';
  startedAt:    number;
  updatedAt:    number;
  current:      IPositionPoint | null;
  history:      IPositionPoint[];
  notifiedSubs: string[];
  // Lookup keys for polling
  endpoints:    string[]; // push endpoints of friends watching
  friendUserIds: string[]; // userIds of friends watching
}

const PositionPointSchema = new Schema<IPositionPoint>({
  lat:       Number,
  lng:       Number,
  speed:     Number,
  timestamp: Number,
}, { _id: false });

const LiveSessionSchema = new Schema<ILiveSession>({
  token:        { type: String, required: true, unique: true, index: true },
  userName:     { type: String, required: true },
  userId:       { type: String, default: null, index: true },
  status:       { type: String, enum: ['running', 'paused', 'finished'], default: 'running' },
  startedAt:    { type: Number, required: true },
  updatedAt:    { type: Number, required: true },
  current:      { type: PositionPointSchema, default: null },
  history:      { type: [PositionPointSchema], default: [] },
  notifiedSubs: [{ type: String }],
  endpoints:    [{ type: String }],
  friendUserIds: [{ type: String }],
}, {
  versionKey: false,
});

// Auto-cleanup: TTL index removes finished sessions after 2 hours
LiveSessionSchema.index({ updatedAt: 1 }, {
  expireAfterSeconds: 7200,
  partialFilterExpression: { status: 'finished' },
});

// Force-finish sessions not updated for 2 hours
LiveSessionSchema.index({ status: 1, updatedAt: 1 });

export const LiveSession = model<ILiveSession>('LiveSession', LiveSessionSchema);
