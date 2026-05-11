// ─── CLUB MODEL ───────────────────────────────────────────────────────────────
import { Schema, model, Document } from 'mongoose';

export interface IClub extends Document {
  clubId:      string;
  ownerId:     string;
  name:        string;
  description: string;
  sport:       string;
  avatarB64:   string | null;
  city:        string;
  isPrivate:   boolean;   // private clubs only visible to members
  region:      string;    // auto-filled from city — used for location search
  members:      string[];  // userId[]
  pendingMembers: string[]; // pending join requests
  posts:       string[];  // postId[]
  createdAt:   Date;
  updatedAt:   Date;
}

const ClubSchema = new Schema<IClub>(
  {
    clubId:      { type: String, required: true, unique: true },
    ownerId:     { type: String, required: true, index: true },
    name:        { type: String, required: true },
    description: { type: String, default: '' },
    sport:       { type: String, default: 'running' },
    avatarB64:   { type: String, default: null },
    city:        { type: String, default: '' },
    isPrivate:   { type: Boolean, default: false },
    region:      { type: String, default: '' },
    members:        [{ type: String }],
    pendingMembers: [{ type: String }],
    posts:       [{ type: String }],
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const Club = model<IClub>('Club', ClubSchema);
