// ─── POST MODEL (Home feed posts) ────────────────────────────────────────────
import { Schema, model, Document } from 'mongoose';

export interface IPost extends Document {
  postId:     string;
  userId:     string;
  type:       'post';
  date:       number;   // timestamp ms
  title:      string;
  body:       string;
  photoUrl:   string | null;
  photoPublicId: string | null;
  clubIds?:      string[];
  authorName: string;
  avatarB64:  string | null;
  syncedAt:   Date;
}

const PostSchema = new Schema<IPost>(
  {
    postId:     { type: String, required: true },
    userId:     { type: String, required: true, index: true },
    type:       { type: String, default: 'post' },
    date:       { type: Number, required: true },
    title:      { type: String, default: '' },
    body:       { type: String, default: '' },
    photoUrl:   { type: String, default: null },
    photoPublicId: { type: String, default: null },
    clubIds:      [{ type: String }],
    authorName: { type: String, default: '' },
    avatarB64:  { type: String, default: null },
    syncedAt:   { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

PostSchema.index({ userId: 1, postId: 1 }, { unique: true });

export const Post = model<IPost>('Post', PostSchema);
