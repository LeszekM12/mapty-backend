// ─── CLOUDINARY UPLOAD ROUTER v2 ─────────────────────────────────────────────
// POST   /upload/media   — multipart file → ffmpeg compress → Cloudinary
// DELETE /upload/media   — usuwa plik z Cloudinary po public_id
// GET    /upload/health  — status Cloudinary + usage wszystkich kont
// GET    /upload/tile    — proxy OSM tiles
// POST   /upload/image   — backward-compat base64 (avatars, minimaps)
// DELETE /upload/image   — backward-compat delete

import { Router, Request, Response } from 'express';
import { v2 as cloudinary }          from 'cloudinary';
import multer                         from 'multer';
import ffmpeg                         from 'fluent-ffmpeg';
import ffmpegInstaller                from '@ffmpeg-installer/ffmpeg';
import fs                             from 'fs';
import path                           from 'path';
import os                             from 'os';
import https                          from 'https';
import type { IncomingMessage, ServerResponse } from 'http';

// Use system ffmpeg if available (Dockerfile installs it with full codec support)
const SYSTEM_FFMPEG = '/usr/bin/ffmpeg';
const FFMPEG_PATH   = fs.existsSync(SYSTEM_FFMPEG) ? SYSTEM_FFMPEG : ffmpegInstaller.path;
console.log(`[Upload] ffmpeg: ${FFMPEG_PATH}`);
ffmpeg.setFfmpegPath(FFMPEG_PATH);

export const uploadRouter = Router();

// ── 3-account Cloudinary rotation ────────────────────────────────────────────

interface CloudinaryAccount {
  index:      number;
  cloudName:  string;
  apiKey:     string;
  apiSecret:  string;
  usageBytes: number;  // from last Admin API check
  lastCheck:  number;  // timestamp ms
}

const ACCOUNTS: CloudinaryAccount[] = [
  {
    index:     1,
    // Account 1 — falls back to old single-account env vars for zero-config migration
    cloudName: process.env.CLOUDINARY_1_CLOUD_NAME ?? process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey:    process.env.CLOUDINARY_1_API_KEY    ?? process.env.CLOUDINARY_API_KEY    ?? '',
    apiSecret: process.env.CLOUDINARY_1_API_SECRET ?? process.env.CLOUDINARY_API_SECRET ?? '',
    usageBytes: 0, lastCheck: 0,
  },
  {
    index: 2,
    cloudName: process.env.CLOUDINARY_2_CLOUD_NAME ?? '',
    apiKey:    process.env.CLOUDINARY_2_API_KEY    ?? '',
    apiSecret: process.env.CLOUDINARY_2_API_SECRET ?? '',
    usageBytes: 0, lastCheck: 0,
  },
  {
    index: 3,
    cloudName: process.env.CLOUDINARY_3_CLOUD_NAME ?? '',
    apiKey:    process.env.CLOUDINARY_3_API_KEY    ?? '',
    apiSecret: process.env.CLOUDINARY_3_API_SECRET ?? '',
    usageBytes: 0, lastCheck: 0,
  },
];

// Local byte counters — added since last Admin API check.
// Survives between requests, resets when Admin API refreshes the real figure.
const localAdded = [0, 0, 0]; // index 0 = account 1, etc.

const LIMIT_BYTES      = 25 * 1024 ** 3; // 25 GB
const SWITCH_THRESHOLD = 0.99;            // switch at 99%
const CACHE_MS         = 60 * 60 * 1000; // Admin API re-checked every 1 h

// Build an isolated cloudinary instance for one account
function makeClient(acc: CloudinaryAccount) {
  cloudinary.config({
    cloud_name: acc.cloudName,
    api_key:    acc.apiKey,
    api_secret: acc.apiSecret,
    secure:     true,
  });
  return cloudinary;
}

async function refreshUsage(acc: CloudinaryAccount): Promise<void> {
  if (Date.now() - acc.lastCheck < CACHE_MS)        return; // still fresh
  if (!acc.cloudName || !acc.apiKey || !acc.apiSecret) return; // not configured

  try {
    const cl   = makeClient(acc);
    const info = await cl.api.usage();
    acc.usageBytes        = (info.storage as { usage: number })?.usage ?? 0;
    acc.lastCheck         = Date.now();
    localAdded[acc.index - 1] = 0; // reset — we have a fresh baseline
    console.log(`[Upload] 📊 Account ${acc.index}: ${(acc.usageBytes / 1024 ** 3).toFixed(2)} GB`);
  } catch (e) {
    console.warn(`[Upload] ⚠️  Cannot refresh account ${acc.index} usage:`, e);
  }
}

async function pickAccount(): Promise<CloudinaryAccount> {
  await Promise.all(ACCOUNTS.map(refreshUsage));

  for (const acc of ACCOUNTS) {
    if (!acc.cloudName || !acc.apiKey) continue;
    const estimated = acc.usageBytes + localAdded[acc.index - 1];
    const pct       = estimated / LIMIT_BYTES;
    console.log(`[Upload] Account ${acc.index}: ${(pct * 100).toFixed(1)}%`);
    if (pct < SWITCH_THRESHOLD) return acc;
  }

  // All accounts ≥ 99% — use last configured as emergency fallback
  const fallback = [...ACCOUNTS].reverse().find(a => a.cloudName && a.apiKey);
  if (!fallback) throw new Error('No Cloudinary accounts configured');
  console.warn('[Upload] ⚠️  All accounts near limit — using fallback');
  return fallback;
}

// ── multer — memory storage, 850 MB hard limit ────────────────────────────────

const MAX_BYTES = 500 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image and video files are allowed'));
    }
  },
});

// ── ffmpeg helpers ────────────────────────────────────────────────────────────

function compressVideo(src: string, dst: string): Promise<void> {
  return new Promise((resolve, reject) =>
    ffmpeg(src)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-threads 0',   // use all available CPU cores automatically
        '-crf 32',
        '-preset ultrafast',
        '-movflags +faststart',
        "-vf scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease",
        '-max_muxing_queue_size 9999',
        '-map 0:v:0',   // first video stream
        '-map 0:a:0?',  // first audio stream if present (? = optional)
        '-ac 2',        // stereo
        '-ar 44100',    // standard sample rate
      ])
      .output(dst)
      .on('end',   () => resolve())
      .on('error', reject)
      .run()
  );
}

function optimiseImage(src: string, dst: string): Promise<void> {
  return new Promise((resolve, reject) =>
    ffmpeg(src)
      .outputOptions([
        "-vf scale='min(1200,iw)':'min(1200,ih)':force_original_aspect_ratio=decrease",
      ])
      .output(dst)
      .on('end',   () => resolve())
      .on('error', reject)
      .run()
  );
}

// ── POST /upload/media ────────────────────────────────────────────────────────

uploadRouter.post(
  '/media',
  upload.single('file'),
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      return void res.status(400).json({ status: 'error', message: 'file required' });
    }

    const { userId, folder = 'general', publicId } = req.body as {
      userId: string; folder?: string; publicId?: string;
    };
    if (!userId) {
      return void res.status(400).json({ status: 'error', message: 'userId required' });
    }

    const isVideo: boolean  = file.mimetype.startsWith('video/');
    const mediaType         = isVideo ? 'video' : 'image';
    // Keep original extension for input (iPhone sends .mov, Android .mp4)
    // Output is always .mp4 (H.264)
    const origExt = path.extname(file.originalname).toLowerCase() || (isVideo ? '.mp4' : '.jpg');
    const ext     = isVideo ? origExt : origExt;
    const tmpIn             = path.join(os.tmpdir(), `mpy_in_${Date.now()}${ext}`);
    const tmpOut            = path.join(os.tmpdir(), `mpy_out_${Date.now()}${ext}`);

    fs.writeFileSync(tmpIn, file.buffer);

    // Log file info for debugging — helps identify iPhone codec issues
    console.log(`[Upload] file.mimetype=${file.mimetype} originalname=${file.originalname} size=${file.size}`);

    try {
      console.log(`[Upload] 🔧 Compressing ${mediaType} (${(file.size / 1024 / 1024).toFixed(1)} MB)…`);

      if (isVideo) await compressVideo(tmpIn, tmpOut);
      else         await optimiseImage(tmpIn, tmpOut);

      const compressedBytes = fs.statSync(tmpOut).size;
      console.log(`[Upload] ✅ → ${(compressedBytes / 1024 / 1024).toFixed(1)} MB after compression`);

      const acc  = await pickAccount();
      const cl   = makeClient(acc);
      const opts: Record<string, unknown> = {
        folder:        `mapyou/${folder}/${userId}`,
        resource_type: mediaType,
      };
      if (publicId) {
        opts.public_id  = publicId;
        opts.overwrite  = true;
        opts.invalidate = true;
      }

      const result = await cl.uploader.upload(tmpOut, opts);
      localAdded[acc.index - 1] += compressedBytes;

      console.log(`[Upload] ☁️  Account ${acc.index} → ${result.public_id}`);

      return void res.json({
        status:       'ok',
        url:          result.secure_url,
        publicId:     result.public_id,
        mediaType,
        bytes:        result.bytes,
        width:        result.width        ?? null,
        height:       result.height       ?? null,
        duration:     (result as Record<string, unknown>).duration ?? null,
        accountIndex: acc.index,
      });

    } catch (err) {
      console.error('[Upload] ❌', err);
      return void res.status(500).json({ status: 'error', message: 'Upload failed', detail: String(err) });
    } finally {
      try { fs.unlinkSync(tmpIn);  } catch {}
      try { fs.unlinkSync(tmpOut); } catch {}
    }
  },
);

// ── DELETE /upload/media ──────────────────────────────────────────────────────

uploadRouter.delete('/media', async (req: Request, res: Response) => {
  const { publicId, accountIndex } = req.body as {
    publicId?: string; accountIndex?: number;
  };
  if (!publicId) {
    return void res.status(400).json({ status: 'error', message: 'publicId required' });
  }

  const isVideo      = publicId.includes('/video/');
  const resourceType = isVideo ? 'video' : 'image';

  const order = accountIndex
    ? [ACCOUNTS[accountIndex - 1], ...ACCOUNTS.filter((_, i) => i !== accountIndex - 1)]
    : ACCOUNTS;

  for (const acc of order) {
    if (!acc.cloudName || !acc.apiKey) continue;
    try {
      const cl = makeClient(acc);
      await cl.uploader.destroy(publicId, { resource_type: resourceType });
      console.log(`[Upload] 🗑  Deleted ${publicId} (account ${acc.index})`);
      return void res.json({ status: 'ok', message: 'Deleted' });
    } catch { /* try next */ }
  }

  return void res.status(404).json({ status: 'error', message: 'Not found on any account' });
});

// ── POST /upload/image — backward-compat base64 (avatars, minimaps) ───────────

uploadRouter.post('/image', async (req: Request, res: Response) => {
  const { image, userId, folder = 'general', publicId } = req.body as {
    image: string; userId: string; folder?: string; publicId?: string;
  };
  if (!image || !userId) {
    return void res.status(400).json({ status: 'error', message: 'image and userId required' });
  }
  if (!image.startsWith('data:image/')) {
    return void res.status(400).json({ status: 'error', message: 'image must be a base64 data URI' });
  }
  if (image.length > 50_000_000) {
    return void res.status(413).json({ status: 'error', message: 'Image too large' });
  }

  try {
    const acc  = await pickAccount();
    const cl   = makeClient(acc);
    const opts: Record<string, unknown> = {
      folder:         `mapyou/${folder}/${userId}`,
      resource_type:  'image',
      transformation: [
        { width: 1200, height: 1200, crop: 'limit' },
        { quality: 'auto', fetch_format: 'auto' },
      ],
    };
    if (publicId) { opts.public_id = publicId; opts.overwrite = true; opts.invalidate = true; }

    const result = await cl.uploader.upload(image, opts);
    localAdded[acc.index - 1] += result.bytes;

    return void res.json({
      status: 'ok', url: result.secure_url, publicId: result.public_id,
      mediaType: 'image', width: result.width, height: result.height, bytes: result.bytes,
    });
  } catch (err) {
    return void res.status(500).json({ status: 'error', message: 'Upload failed', detail: String(err) });
  }
});

// ── DELETE /upload/image — backward-compat ────────────────────────────────────

uploadRouter.delete('/image', async (req: Request, res: Response) => {
  const { publicId } = req.body as { publicId?: string };
  if (!publicId) return void res.status(400).json({ status: 'error', message: 'publicId required' });

  for (const acc of ACCOUNTS) {
    if (!acc.cloudName || !acc.apiKey) continue;
    try {
      const cl = makeClient(acc);
      await cl.uploader.destroy(publicId);
      return void res.json({ status: 'ok', message: 'Deleted' });
    } catch {}
  }
  return void res.status(404).json({ status: 'error', message: 'Not found' });
});

// ── GET /upload/health ────────────────────────────────────────────────────────

uploadRouter.get('/health', async (_req: Request, res: Response) => {
  const results = [];
  for (const acc of ACCOUNTS) {
    if (!acc.cloudName) { results.push({ account: acc.index, status: 'not configured' }); continue; }
    try {
      const cl   = makeClient(acc);
      const ping = await cl.api.ping();
      const est  = acc.usageBytes + localAdded[acc.index - 1];
      results.push({
        account:     acc.index,
        status:      ping.status,
        usageGB:     (acc.usageBytes / 1024 ** 3).toFixed(2),
        estimatedGB: (est / 1024 ** 3).toFixed(2),
        pct:         ((est / LIMIT_BYTES) * 100).toFixed(1) + '%',
      });
    } catch (err) {
      results.push({ account: acc.index, status: 'error', detail: String(err) });
    }
  }
  res.json({ status: 'ok', accounts: results });
});

// ── GET /upload/tile — proxy OSM tiles ───────────────────────────────────────

uploadRouter.get('/tile', (req: Request, res: Response) => {
  const { z, x, y } = req.query as { z: string; x: string; y: string };
  if (!z || !x || !y) return void res.status(400).json({ error: 'z,x,y required' });

  const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  https.get(url, { headers: { 'User-Agent': 'MapYou/1.0 (leszekm12@github)' } },
    (tileRes: IncomingMessage) => {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');
      tileRes.pipe(res as unknown as ServerResponse);
    }
  ).on('error', () => res.status(502).send('tile error'));
});
