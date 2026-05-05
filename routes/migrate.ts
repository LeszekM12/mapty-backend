import { Router, Request, Response } from 'express';
import { v2 as cloudinary } from 'cloudinary';
import { EnrichedActivity } from '../models/EnrichedActivity.js';
import { Post } from '../models/Post.js';

export const migrateRouter = Router();

// GET /migrate/fix-photos?userId=xxx
// Szuka zdjęć w Cloudinary dla danego userId i aktualizuje Atlas
migrateRouter.get('/fix-photos', async (req: Request, res: Response) => {
  const { userId } = req.query as { userId?: string };
  if (!userId) return void res.status(400).json({ status: 'error', message: 'userId required' });

  let fixed = 0;
  const errors: string[] = [];

  try {
    // Pobierz wszystkie zasoby z Cloudinary dla tego userId
    const [actResult, postResult] = await Promise.all([
      cloudinary.api.resources({
        type: 'upload',
        prefix: `mapyou/activities/${userId}/`,
        max_results: 500,
      }),
      cloudinary.api.resources({
        type: 'upload',
        prefix: `mapyou/posts/${userId}/`,
        max_results: 500,
      }),
    ]);

    // Pobierz rekordy z null photoUrl
    const [nullActivities, nullPosts] = await Promise.all([
      EnrichedActivity.find({ userId, photoUrl: null }),
      Post.find({ userId, photoUrl: null }),
    ]);

    // Dla activities — próbuj dopasować po dacie (timestamp w nazwie folderu)
    // Cloudinary resources mają created_at — porównaj z activity.date
    const cloudActivities = actResult.resources ?? [];
    const cloudPosts = postResult.resources ?? [];

    // Dla każdej aktywności z null photoUrl — znajdź najbliższe zdjęcie w Cloudinary po dacie
    for (const act of nullActivities) {
      const actDate = act.date; // timestamp ms
      // Znajdź zasób Cloudinary stworzony najbliżej tej daty (w ciągu 1 minuty)
      const match = cloudActivities.find((r: { created_at: string; secure_url: string; public_id: string }) => {
        const cloudDate = new Date(r.created_at).getTime();
        return Math.abs(cloudDate - actDate) < 5 * 60 * 1000; // 5 minut tolerancji
      });

      if (match) {
        await EnrichedActivity.findOneAndUpdate(
          { activityId: act.activityId, userId },
          { $set: { photoUrl: match.secure_url, photoPublicId: match.public_id } }
        );
        fixed++;
        console.log(`[Migrate] Fixed activity ${act.name}: ${match.secure_url}`);
      }
    }

    // Dla postów
    for (const post of nullPosts) {
      const postDate = post.date;
      const match = cloudPosts.find((r: { created_at: string; secure_url: string; public_id: string }) => {
        const cloudDate = new Date(r.created_at).getTime();
        return Math.abs(cloudDate - postDate) < 5 * 60 * 1000;
      });

      if (match) {
        await Post.findOneAndUpdate(
          { postId: post.postId, userId },
          { $set: { photoUrl: match.secure_url, photoPublicId: match.public_id } }
        );
        fixed++;
        console.log(`[Migrate] Fixed post ${post.title}: ${match.secure_url}`);
      }
    }

    res.json({
      status: 'ok',
      fixed,
      nullActivities: nullActivities.length,
      nullPosts: nullPosts.length,
      cloudAssets: cloudActivities.length + cloudPosts.length,
      errors,
    });
  } catch (err) {
    console.error('[Migrate] fix-photos error:', err);
    res.status(500).json({ status: 'error', message: String(err) });
  }
});
