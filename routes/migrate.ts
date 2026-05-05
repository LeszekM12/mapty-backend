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

    // Sortuj Cloudinary assets po dacie
    cloudActivities.sort((a: { created_at: string }, b: { created_at: string }) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    // Dla każdej aktywności z null photoUrl — znajdź najbliższe zdjęcie w Cloudinary po dacie
    const usedCloudIds = new Set<string>();
    for (const act of nullActivities) {
      const actDate = act.date; // timestamp ms
      // Znajdź najbliższy asset który nie był już użyty
      let bestMatch: { created_at: string; secure_url: string; public_id: string } | null = null;
      let bestDiff = Infinity;
      for (const r of cloudActivities as { created_at: string; secure_url: string; public_id: string }[]) {
        if (usedCloudIds.has(r.public_id)) continue;
        const cloudDate = new Date(r.created_at).getTime();
        const diff = Math.abs(cloudDate - actDate);
        if (diff < bestDiff) { bestDiff = diff; bestMatch = r; }
      }
      const match = bestMatch && bestDiff < 60 * 60 * 1000 ? bestMatch : null; // 1h tolerancji

      if (match) {
        await EnrichedActivity.findOneAndUpdate(
          { activityId: act.activityId, userId },
          { $set: { photoUrl: match.secure_url, photoPublicId: match.public_id } }
        );
        usedCloudIds.add(match.public_id);
        fixed++;
        console.log(`[Migrate] Fixed activity ${act.name}: diff=${Math.round(bestDiff/1000)}s url=${match.secure_url}`);
      }
    }

    // Dla postów
    const usedPostIds = new Set<string>();
    cloudPosts.sort((a: { created_at: string }, b: { created_at: string }) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    for (const post of nullPosts) {
      const postDate = post.date;
      let bestPostMatch: { created_at: string; secure_url: string; public_id: string } | null = null;
      let bestPostDiff = Infinity;
      for (const r of cloudPosts as { created_at: string; secure_url: string; public_id: string }[]) {
        if (usedPostIds.has(r.public_id)) continue;
        const cloudDate = new Date(r.created_at).getTime();
        const diff = Math.abs(cloudDate - postDate);
        if (diff < bestPostDiff) { bestPostDiff = diff; bestPostMatch = r; }
      }
      const match = bestPostMatch && bestPostDiff < 60 * 60 * 1000 ? bestPostMatch : null;

      if (match) {
        await Post.findOneAndUpdate(
          { postId: post.postId, userId },
          { $set: { photoUrl: match.secure_url, photoPublicId: match.public_id } }
        );
        usedPostIds.add(match.public_id);
        fixed++;
        console.log(`[Migrate] Fixed post ${post.title}: diff=${Math.round(bestPostDiff/1000)}s`);
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
