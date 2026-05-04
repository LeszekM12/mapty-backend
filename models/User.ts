// ─── USER MODEL ──────────────────────────────────────────────────────────────
import { Schema, model, Document } from 'mongoose';

export interface IUser extends Document {
  userId:       string;   // UUID z localStorage (primary key z frontendu)
  name:         string;
  bio:          string;
  avatarB64:    string | null;
  friends:      string[]; // userId[]
  followers:    string[]; // userId[] — kto obserwuje tego usera
  following:    string[]; // userId[] — kogo ten user obserwuje
  clubs:        string[]; // clubId[]
  createdAt:    Date;
  updatedAt:    Date;
}

const UserSchema = new Schema<IUser>(
  {
    userId:    { type: String, required: true, unique: true, index: true },
    name:      { type: String, required: true, default: 'MapYou User' },
    bio:       { type: String, default: '' },
    avatarB64: { type: String, default: null },
    friends:   [{ type: String }],
    followers: [{ type: String }],
    following: [{ type: String }],
    clubs:     [{ type: String }],
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const User = model<IUser>('User', UserSchema);
