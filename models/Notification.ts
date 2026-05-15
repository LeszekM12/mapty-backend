// ─── NOTIFICATION MODEL ───────────────────────────────────────────────────────
import { Schema, model, Document } from 'mongoose';

export type NotifType =
  | 'activity_added'
  | 'achievement'
  | 'weekly_goal'
  | 'streak'
  | 'friend_activity'
  | 'club_post'
  | 'system'
  | 'follow_request'
  | 'comment'
  | 'like'
  | 'friend_activity'
  | 'friend_post';

export interface INotification extends Document {
  notifId:   string;
  userId:    string;
  type:      NotifType;
  title:     string;
  body:      string;
  icon:      string;
  read:      boolean;
  timestamp: number;
  syncedAt:  Date;
  meta?:     string;
}

const NotificationSchema = new Schema<INotification>(
  {
    notifId:   { type: String, required: true },
    userId:    { type: String, required: true, index: true },
    type:      {
      type: String,
      enum: ['activity_added','achievement','weekly_goal','streak','friend_activity','club_post','system','follow_request','comment','like','friend_post'],
      default: 'system',
    },
    title:     { type: String, required: true },
    body:      { type: String, default: '' },
    icon:      { type: String, default: '🔔' },
    read:      { type: Boolean, default: false },
    timestamp: { type: Number, required: true },
    syncedAt:  { type: Date, default: Date.now },
    meta:      { type: String, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

NotificationSchema.index({ userId: 1, notifId: 1 }, { unique: true });

// TTL index — automatycznie usuwa powiadomienia starsze niż 90 dni
// MongoDB sprawdza i czyści co ~60 sekund
NotificationSchema.index({ syncedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const Notification = model<INotification>('Notification', NotificationSchema);
