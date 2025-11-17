import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import DownloadStore from './download-store.js';
import { getHashedClientIp } from './request-utils.js';
import { isMultipartFormData, parseMultipartFormData, sanitizeUploadFilename } from './upload-utils.js';

const {
  NODE_ENV = 'production',
  APP_ORIGIN,
  PORT = 4000,
} = process.env;

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXTENSIONS = new Set(['.zip', '.mcfunction', '.stl', '.png']);
const ALLOWED_MIME_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'text/plain',
  'model/stl',
  'image/png',
]);

const uploadsDirectory = fileURLToPath(new URL('../uploads/', import.meta.url));

const app = express();
app.disable('x-powered-by');
app.use(express.json());

// Simple security headers
app.use(
  helmet({
    contentSecurityPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginEmbedderPolicy: NODE_ENV === 'production',
  }),
);

// Very small CORS layer: allow APP_ORIGIN if set, otherwise allow same-origin-only
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (!origin) {
    return next();
  }
  if (APP_ORIGIN && origin !== APP_ORIGIN) {
    return res.status(403).json({ error: 'origin_not_allowed' });
  }
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
});

const downloadStore = new DownloadStore(new URL('../data/download-counts.json', import.meta.url));

const downloadCatalog = new Map([
  [
    'jetpack-datapack',
    {
      files: new Set(['jetpack-datapack-1.21.8.zip']),
      paths: new Set(['downloads/jetpack-datapack-1.21.8.zip']),
    },
  ],
]);

const PROJECT_ID_PATTERN = /^[a-z0-9-]{1,64}$/;
const FILE_ID_PATTERN = /^[a-z0-9-\.]{1,128}$/;

const downloadRecordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadBodyParser = express.raw({
  limit: MAX_UPLOAD_BYTES + 64 * 1024,
  type: (req) => isMultipartFormData(req.headers['content-type'] || ''),
});

await fs.mkdir(uploadsDirectory, { recursive: true });
await downloadStore.init();

app.get('/healthz', (req, res) => {
  return res.json({ status: 'ok' });
});

app.post('/api/upload', uploadBodyParser, async (req, res) => {
  if (!isMultipartFormData(req.headers['content-type'] || '')) {
    return res.status(400).json({ error: 'invalid_content_type' });
  }

  const parsed = parseMultipartFormData(req.body, req.headers['content-type'] || '');
  if (!parsed) {
    return res.status(400).json({ error: 'invalid_form_data' });
  }
  const filePart = parsed?.files.find((part) => part.fieldName === 'file') || parsed?.files[0];

  if (!filePart || !filePart.data) {
    return res.status(400).json({ error: 'file_required' });
  }

  if (filePart.data.length > MAX_UPLOAD_BYTES) {
    return res.status(413).json({ error: 'file_too_large' });
  }

  const extension = path.extname(filePart.filename || '').toLowerCase();
  const contentType = (filePart.contentType || '').toLowerCase();
  const hasAllowedExtension = ALLOWED_EXTENSIONS.has(extension);
  const hasAllowedMime = ALLOWED_MIME_TYPES.has(contentType);
  const isAllowed = hasAllowedExtension || hasAllowedMime;

  if (!isAllowed) {
    return res.status(400).json({ error: 'invalid_type' });
  }

  const safeName = sanitizeUploadFilename(filePart.filename || 'upload');
  const timestampedName = `${Date.now()}-${safeName}`;
  const targetUrl = new URL(timestampedName, new URL(`file://${uploadsDirectory}/`));

  await fs.writeFile(targetUrl, filePart.data);

  const baseUrl = (APP_ORIGIN || `${req.protocol}://${req.get('host') || ''}`).replace(/\/$/, '');
  const downloadUrl = `${baseUrl}/downloads/uploads/${timestampedName}`;

  return res.status(201).json({ status: 'ok', filename: timestampedName, url: downloadUrl });
});

// GET /analytics/downloads?ids=jetpack-datapack
app.get('/analytics/downloads', async (req, res) => {
  try {
    const idsParam = typeof req.query.ids === 'string' ? req.query.ids : '';
    if (!idsParam) {
      return res.json({ counts: {} });
    }
    const ids = idsParam
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => PROJECT_ID_PATTERN.test(value));

    if (!ids.length) {
      return res.json({ counts: {} });
    }

    const counts = await downloadStore.getCounts(ids);
    return res.json({ counts });
  } catch (error) {
    console.error('Failed to load download statistics', error);
    return res.status(500).json({ error: 'download_stats_unavailable' });
  }
});

// POST /analytics/downloads
app.post('/analytics/downloads', downloadRecordLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const projectIdRaw = body.projectId;
    const fileIdRaw = body.fileId;
    const pathRaw = body.path;

    if (typeof projectIdRaw !== 'string' || !projectIdRaw.trim()) {
      return res.status(400).json({ error: 'invalid_project' });
    }
    const projectId = projectIdRaw.trim().toLowerCase();
    if (!PROJECT_ID_PATTERN.test(projectId)) {
      return res.status(400).json({ error: 'invalid_project' });
    }

    const catalogEntry = downloadCatalog.get(projectId);
    if (!catalogEntry) {
      return res.status(404).json({ error: 'project_not_found' });
    }

    let fileId;
    if (typeof fileIdRaw === 'string' && fileIdRaw.trim().length > 0) {
      const trimmed = fileIdRaw.trim();
      if (!FILE_ID_PATTERN.test(trimmed)) {
        return res.status(400).json({ error: 'invalid_file' });
      }
      if (catalogEntry.files && !catalogEntry.files.has(trimmed)) {
        return res.status(400).json({ error: 'file_not_registered' });
      }
      fileId = trimmed;
    }

    let downloadPath;
    if (typeof pathRaw === 'string' && pathRaw.trim().length > 0) {
      const trimmedPath = pathRaw.trim();
      if (trimmedPath.length > 256) {
        return res.status(400).json({ error: 'invalid_path' });
      }
      if (catalogEntry.paths && !catalogEntry.paths.has(trimmedPath)) {
        return res.status(400).json({ error: 'path_not_registered' });
      }
      downloadPath = trimmedPath;
    }

    const result = await downloadStore.record(projectId, {
      fileId,
      path: downloadPath,
      clientHash: getHashedClientIp(req),
    });

    return res.status(202).json({ count: result.count });
  } catch (error) {
    console.error('Failed to record download event', error);
    return res.status(500).json({ error: 'download_record_failed' });
  }
});

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'file_too_large' });
  }
  console.error(err);
  return res.status(500).json({ error: 'internal_error' });
});

app.listen(PORT, () => {
  console.log(`Download analytics server listening on port ${PORT}`);
});
