// ─── REEL MODEL ───────────────────────────────────────────────────────────────
// Reelsy — zdjęcia/video widoczne 24h od dodania
// TTL index automatycznie usuwa dokument z MongoDB po 24h
// Cloudinary TTL ustawiony osobno przy uploadzie

import { Schema, model, Document } from 'mongoose';

export interface IReel extends Document {
  reelId:       string;         // unikalny ID
  userId:       string;         // autor
  authorName:   string;
  avatarB64:    string | null;
  mediaUrl:     string;         // Cloudinary URL
  mediaType:    'image' | 'video';
  publicId:     string;         // Cloudinary public_id do usunięcia
  caption:      string | null;  // tekst overlay
  captionX:     number;         // pozycja tekstu (0-100%)
  captionY:     number;
  captionSize:  number;         // font size px
  captionColor: string;         // hex color
  duration:     number;         // czas wyświetlania w sekundach (zdjęcie=5, video=auto)
  views:        string[];       // userIds którzy obejrzeli
  likes:        string[];       // userIds którzy polajkowali
  createdAt:    Date;
  expiresAt:    Date;           // createdAt + 24h
}

const ReelSchema = new Schema<IReel>(
  {
    reelId:       { type: String, required: true, unique: true, index: true },
    userId:       { type: String, required: true, index: true },
    authorName:   { type: String, default: '' },
    avatarB64:    { type: String, default: null },
    mediaUrl:     { type: String, required: true },
    mediaType:    { type: String, enum: ['image', 'video'], required: true },
    publicId:     { type: String, required: true },
    caption:      { type: String, default: null },
    captionX:     { type: Number, default: 50 },
    captionY:     { type: Number, default: 80 },
    captionSize:  { type: Number, default: 20 },
    captionColor: { type: String, default: '#ffffff' },
    duration:     { type: Number, default: 5 },
    views:        [{ type: String }],
    likes:        [{ type: String }],
    expiresAt:    { type: Date, required: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// TTL index — MongoDB automatycznie usuwa dokument gdy expiresAt minie
ReelSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
ReelSchema.index({ userId: 1, createdAt: -1 });

export const Reel = model<IReel>('Reel', ReelSchema);
