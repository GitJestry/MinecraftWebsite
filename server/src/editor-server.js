import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import DownloadStore from './download-store.js';
import {
  decodeBase64Payload,
  isMultipartFormData,
  MAX_UPLOAD_BYTES,
  parseMultipartFormData,
  resolveUploadDestination,
  sanitizeUploadFilename,
} from './upload-utils.js';

const { PORT = 3001 } = process.env;

const ADMIN_USERNAME = 'admin';
const PASSWORD_DIGEST = 'sha512';
const PASSWORD_ITERATIONS = 120000;
const PASSWORD_SALT = Buffer.from('c0ffee1234', 'hex');
const PASSWORD_HASH = Buffer.from(
  '50e5f3e807679f082cbb2a7c35ea3b18ef92c91f8150c0b2f7ae72c7b4ddfde4dcba3a25527c362aee21cd773cbd3142c3b29d49a5a592fda5c2102613b36714',
  'hex',
);

function safeEquals(a, b) {
  if (!(a instanceof Buffer)) {
    a = Buffer.from(a);
  }
  if (!(b instanceof Buffer)) {
    b = Buffer.from(b);
  }
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function verifyPassword(password) {
  try {
    const candidate = String(password ?? '');
    const derived = crypto.pbkdf2Sync(
      candidate,
      PASSWORD_SALT,
      PASSWORD_ITERATIONS,
      PASSWORD_HASH.length,
      PASSWORD_DIGEST,
    );
    return safeEquals(derived, PASSWORD_HASH);
  } catch (err) {
    console.warn('Failed to verify hashed admin password:', err);
    return false;
  }
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16mb' }));

// Very simple CORS so you can open projects.html directly from disk during dev.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// In-memory token store (dev only)
const tokens = new Map(); // token -> { username }

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

function requireAuth(req, res, next) {
  const auth = req.get('Authorization') || '';
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) {
    return res.status(401).json({ error: 'missing_token' });
  }
  const token = m[1].trim();
  const user = tokens.get(token);
  if (!user) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  req.user = user;
  next();
}

// --- Auth endpoints ---

app.post('/editor/login', (req, res) => {
  const { username, password } = req.body || {};
  const uEnv = String(ADMIN_USERNAME || '').trim();
  const uReq = String(username || '').trim();
  const pReq = String(password || '');
  if (uReq !== uEnv || !verifyPassword(pReq)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const token = makeToken();
  tokens.set(token, { username: uReq });
  return res.json({ token, user: { username: uReq } });
});

app.get('/editor/me', (req, res) => {
  const auth = req.get('Authorization') || '';
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) {
    return res.json({ authenticated: false });
  }
  const token = m[1].trim();
  const user = tokens.get(token);
  if (!user) {
    return res.json({ authenticated: false });
  }
  return res.json({ authenticated: true, user });
});

app.post('/editor/logout', requireAuth, (req, res) => {
  const auth = req.get('Authorization') || '';
  const m = auth.match(/^Bearer (.+)$/);
  if (m) {
    tokens.delete(m[1].trim());
  }
  return res.json({ ok: true });
});

// --- Projects store ---

const projectsFile = new URL('../data/projects.json', import.meta.url);
async function readProjects() {
  try {
    const txt = await fs.readFile(projectsFile, 'utf8');
    const data = JSON.parse(txt);
    if (Array.isArray(data)) return data;
    return [];
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

async function writeProjects(projects) {
  await fs.writeFile(projectsFile, JSON.stringify(projects, null, 2), 'utf8');
}

function slugify(str) {
  return String(str || 'project')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '') || 'project';
}

function ensureModalFields(target, source) {
  const project = target || {};
  const input = source || {};
  const fields = ['modalHero', 'modalBody', 'modalBadges', 'modalHeroActions', 'modalStats'];
  fields.forEach((field) => {
    if (typeof input[field] === 'string') {
      project[field] = input[field];
    } else if (typeof project[field] !== 'string') {
      project[field] = '';
    }
  });
  return project;
}

function withModalDefaults(project) {
  if (!project || typeof project !== 'object') {
    return project;
  }
  return ensureModalFields({ ...project });
}

// List all projects
app.get('/editor/projects', async (req, res, next) => {
  try {
    const projects = await readProjects();
    return res.json(projects.map((project) => withModalDefaults(project)));
  } catch (err) {
    return next(err);
  }
});

// Single project
app.get('/editor/projects/:id', requireAuth, async (req, res, next) => {
  try {
    const projects = await readProjects();
    const project = projects.find((p) => p.id === req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'not_found' });
    }
    return res.json(withModalDefaults(project));
  } catch (err) {
    return next(err);
  }
});

// Create
app.post('/editor/projects', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    let { id } = body;
    const projects = await readProjects();
    if (!id || typeof id !== 'string' || !id.trim()) {
      id = slugify(body.title || 'project');
      let base = id;
      let n = 1;
      while (projects.some((p) => p.id === id)) {
        id = `${base}-${n++}`;
      }
    }
    const now = new Date().toISOString();
    const project = ensureModalFields({
      id,
      title: body.title || 'Untitled project',
      type: body.type || 'datapack',
      shortDescription: body.shortDescription || '',
      modalBody: typeof body.modalBody === 'string' ? body.modalBody : '',
      mcVersion: body.mcVersion || '',
      status: body.status || 'planned',
      category: body.category || '',
      tags: Array.isArray(body.tags)
        ? body.tags
        : typeof body.tags === 'string'
        ? body.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : [],
      downloadFile: body.downloadFile || '',
      image: body.image || '',
      createdAt: now,
      updatedAt: now,
    }, body);
    projects.push(project);
    await writeProjects(projects);
    return res.status(201).json(withModalDefaults(project));
  } catch (err) {
    return next(err);
  }
});

const multipartFormParser = express.raw({
  limit: MAX_UPLOAD_BYTES + 64 * 1024,
  type: (req) => isMultipartFormData(req.headers['content-type'] || ''),
});

function extractMultipartUpload(req) {
  const parsed = parseMultipartFormData(req.body, req.headers['content-type'] || '');
  if (!parsed) {
    return null;
  }
  const filePart = parsed.files.find((part) => part.fieldName === 'file') || parsed.files[0];
  if (!filePart) {
    return null;
  }
  const fields = parsed.fields || {};
  return {
    buffer: filePart.data,
    filename: fields.filename || fields.name || filePart.filename,
    prefix: fields.prefix || fields.target || '',
    contentType: filePart.contentType || fields.contentType || '',
  };
}

function extractJsonUpload(req) {
  const body = (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) ? req.body : {};
  return {
    buffer: decodeBase64Payload(body.data || body.base64 || ''),
    filename: body.filename || body.name || 'upload.bin',
    prefix: body.prefix || body.target || '',
    contentType: typeof body.contentType === 'string' ? body.contentType : '',
  };
}

app.post('/editor/uploads', requireAuth, multipartFormParser, async (req, res, next) => {
  try {
    const isMultipart = isMultipartFormData(req.headers['content-type'] || '');
    const payload = isMultipart ? extractMultipartUpload(req) : extractJsonUpload(req);
    if (!payload || !payload.buffer) {
      return res.status(400).json({ error: 'invalid_data' });
    }
    const destination = resolveUploadDestination(payload.prefix);
    if (!destination) {
      return res.status(400).json({ error: 'invalid_prefix' });
    }
    const filename = sanitizeUploadFilename(payload.filename || 'upload.bin');
    const buffer = payload.buffer;
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ error: 'file_too_large' });
    }
    const contentType = (payload.contentType || '').toLowerCase();
    if (destination.publicPrefix.startsWith('assets/img/') && contentType) {
      if (!contentType.startsWith('image/')) {
        return res.status(400).json({ error: 'invalid_type' });
      }
    }
    await fs.mkdir(destination.directoryUrl, { recursive: true });
    const fileUrl = new URL(filename, destination.directoryUrl);
    await fs.writeFile(fileUrl, buffer);
    return res.status(201).json({
      path: destination.publicPrefix + filename,
      size: buffer.length,
      contentType: payload.contentType || 'application/octet-stream',
    });
  } catch (err) {
    return next(err);
  }
});

// Update
app.put('/editor/projects/:id', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    const projects = await readProjects();
    const idx = projects.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'not_found' });
    }
    const existing = projects[idx];
    const updated = ensureModalFields({
      ...existing,
      ...body,
      id: existing.id,
      tags: Array.isArray(body.tags)
        ? body.tags
        : typeof body.tags === 'string'
        ? body.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : existing.tags,
      updatedAt: new Date().toISOString(),
    }, body);
    projects[idx] = updated;
    await writeProjects(projects);
    return res.json(withModalDefaults(updated));
  } catch (err) {
    return next(err);
  }
});

// Delete
app.delete('/editor/projects/:id', requireAuth, async (req, res, next) => {
  try {
    const projects = await readProjects();
    const idx = projects.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'not_found' });
    }
    projects.splice(idx, 1);
    await writeProjects(projects);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

// --- Simple download analytics (ID -> count) ---

const downloadStore = new DownloadStore(new URL('../data/download-counts.json', import.meta.url));
await downloadStore.init();

app.get('/analytics/downloads', async (req, res, next) => {
  try {
    const idsParam = req.query.ids;
    if (!idsParam) {
      return res.json({ counts: {} });
    }
    const ids = String(idsParam)
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const counts = {};
    for (const id of ids) {
      counts[id] = await downloadStore.getCount(id);
    }
    return res.json({ counts });
  } catch (err) {
    return next(err);
  }
});

app.post('/analytics/downloads', async (req, res, next) => {
  try {
    const { projectId } = req.body || {};
    if (typeof projectId !== 'string' || !projectId.trim()) {
      return res.status(400).json({ error: 'invalid_project' });
    }
    await downloadStore.increment(projectId.trim());
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

// Health
app.get('/healthz', (req, res) => {
  return res.json({ status: 'ok' });
});

app.use((err, req, res, next) => {
  console.error(err);
  return res.status(500).json({ error: 'internal_error' });
});

console.log('Editor admin user from configuration:', {
  ADMIN_USERNAME,
  ADMIN_PASSWORD_HASH_SET: true,
});

app.listen(PORT, () => {
  console.log(`Editor dev server listening on port ${PORT}`);
});
