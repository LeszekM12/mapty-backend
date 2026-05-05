// ─── CLOUDINARY UPLOAD ROUTER ────────────────────────────────────────────────
// POST /upload/image   — przyjmuje base64, wrzuca do Cloudinary, zwraca URL
// DELETE /upload/image — usuwa zdjęcie z Cloudinary po public_id

import { Router, Request, Response } from 'express';
import { v2 as cloudinary } from 'cloudinary';

// ── Konfiguracja Cloudinary ───────────────────────────────────────────────────

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME ?? '',
  api_key:    process.env.CLOUDINARY_API_KEY    ?? '',
  api_secret: process.env.CLOUDINARY_API_SECRET ?? '',
  secure:     true,
});

export const uploadRouter = Router();

// ── POST /upload/image ────────────────────────────────────────────────────────
// Body: {
//   image:    string   — base64 data URI (data:image/jpeg;base64,...)
//   userId:   string   — do organizacji folderów w Cloudinary
//   folder?:  string   — podfolder: 'activities' | 'posts' | 'avatars'
//   publicId?: string  — opcjonalne nadpisanie public_id (np. avatar zawsze ten sam)
// }
// Zwraca: { url: string, publicId: string }

uploadRouter.post('/image', async (req: Request, res: Response) => {
  const { image, userId, folder = 'general', publicId } = req.body as {
    image:     string;
    userId:    string;
    folder?:   'activities' | 'posts' | 'avatars' | 'minimaps' | 'general';
    publicId?: string;
  };

  if (!image || !userId) {
    return void res.status(400).json({ status: 'error', message: 'image and userId required' });
  }

  // Walidacja — tylko base64 data URI
  if (!image.startsWith('data:image/')) {
    return void res.status(400).json({ status: 'error', message: 'image must be a base64 data URI' });
  }

  // Limit rozmiaru — ~3MB base64 ≈ 2.25MB plik
  if (image.length > 50_000_000) {
    return void res.status(413).json({ status: 'error', message: 'Image too large (max ~37MB)' });
  }

  try {
    const uploadOptions: Record<string, unknown> = {
      folder:         `mapyou/${folder}/${userId}`,
      resource_type:  'image',
      transformation: [
        // Automatyczna optymalizacja — max 1200px, webp, quality auto
        { width: 1200, height: 1200, crop: 'limit' },
        { quality: 'auto', fetch_format: 'auto' },
      ],
    };

    // Avatar — nadpisuj ten sam plik (nie tworzy duplikatów)
    if (publicId) {
      uploadOptions.public_id    = publicId;
      uploadOptions.overwrite    = true;
      uploadOptions.invalidate   = true;
    }

    const result = await cloudinary.uploader.upload(image, uploadOptions);

    console.log(`[Upload] ✅ ${folder}/${userId} → ${result.public_id} (${Math.round(result.bytes / 1024)}KB)`);

    res.json({
      status:   'ok',
      url:      result.secure_url,
      publicId: result.public_id,
      width:    result.width,
      height:   result.height,
      bytes:    result.bytes,
    });

  } catch (err) {
    console.error('[Upload] ❌ Cloudinary error:', err);
    res.status(500).json({ status: 'error', message: 'Upload failed', detail: String(err) });
  }
});

// ── DELETE /upload/image ──────────────────────────────────────────────────────
// Body: { publicId: string }

uploadRouter.delete('/image', async (req: Request, res: Response) => {
  const { publicId } = req.body as { publicId?: string };

  if (!publicId) {
    return void res.status(400).json({ status: 'error', message: 'publicId required' });
  }

  try {
    await cloudinary.uploader.destroy(publicId);
    console.log(`[Upload] 🗑 Deleted: ${publicId}`);
    res.json({ status: 'ok', message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: String(err) });
  }
});

// ── GET /upload/health ────────────────────────────────────────────────────────
// Sprawdź czy Cloudinary jest poprawnie skonfigurowany

uploadRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const result = await cloudinary.api.ping();
    res.json({ status: 'ok', cloudinary: result });
  } catch (err) {
    res.status(500).json({ status: 'error', message: String(err) });
  }
});

// GET /upload/tile?z=&x=&y= — proxy OSM tiles (avoids CORS)
import type { IncomingMessage, ServerResponse } from 'http';
import https from 'https';

uploadRouter.get('/tile', (req: Request, res: Response) => {
  const { z, x, y } = req.query as { z: string; x: string; y: string };
  if (!z || !x || !y) return void res.status(400).json({ error: 'z,x,y required' });

  const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  https.get(url, {
    headers: { 'User-Agent': 'MapYou/1.0 (leszekm12@github)' }
  }, (tileRes: IncomingMessage) => {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    tileRes.pipe(res as unknown as ServerResponse);
  }).on('error', () => res.status(502).send('tile error'));
});
