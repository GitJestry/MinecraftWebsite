import { Buffer } from 'node:buffer';

const uploadTargets = [
  { prefix: 'assets/img/', url: new URL('../../assets/img/', import.meta.url) },
  { prefix: 'downloads/', url: new URL('../../downloads/', import.meta.url) },
];

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

export function sanitizeUploadSegment(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function sanitizeUploadFilename(name) {
  const base = String(name || '').split(/[\\/]/).pop() || 'file';
  return sanitizeUploadSegment(base) || 'file';
}

function normaliseUploadPrefix(value) {
  if (!value) return '';
  const trimmed = String(value).trim().replace(/\\/g, '/');
  const withoutLeading = trimmed.replace(/^\/+/, '');
  const withoutTrailing = withoutLeading.replace(/\/+$/, '');
  if (!withoutTrailing) return '';
  return `${withoutTrailing}/`;
}

export function resolveUploadDestination(prefix) {
  const normalized = normaliseUploadPrefix(prefix);
  if (!normalized) return null;
  const target = uploadTargets.find((entry) => normalized.startsWith(entry.prefix));
  if (!target) return null;
  const remainder = normalized.slice(target.prefix.length);
  const segments = remainder
    .split('/')
    .map((segment) => sanitizeUploadSegment(segment))
    .filter(Boolean);
  const subPath = segments.length ? `${segments.join('/')}/` : '';
  const directoryUrl = new URL(subPath || '.', target.url);
  const publicPrefix = target.prefix + subPath;
  return { directoryUrl, publicPrefix };
}

export function decodeBase64Payload(payload) {
  if (typeof payload !== 'string') {
    return null;
  }
  const sanitized = payload.trim().replace(/\s+/g, '');
  if (!sanitized) {
    return null;
  }
  try {
    return Buffer.from(sanitized, 'base64');
  } catch (err) {
    return null;
  }
}

export function isMultipartFormData(contentType) {
  if (!contentType) {
    return false;
  }
  return /multipart\/form-data/i.test(contentType);
}

export function parseMultipartFormData(bodyBuffer, contentTypeHeader) {
  if (!Buffer.isBuffer(bodyBuffer)) {
    return null;
  }
  const boundaryMatch = /boundary=(?:"?)([^";]+)(?:"?)/i.exec(contentTypeHeader || '');
  if (!boundaryMatch) {
    return null;
  }
  const boundaryToken = `--${boundaryMatch[1]}`;
  const raw = bodyBuffer.toString('latin1');
  const segments = raw.split(boundaryToken);
  const fields = {};
  const files = [];

  for (const segment of segments) {
    if (!segment || segment === '--' || segment === '--\r\n') {
      continue;
    }
    let part = segment;
    if (part.startsWith('--')) {
      continue;
    }
    if (part.startsWith('\r\n')) {
      part = part.slice(2);
    }
    if (!part) {
      continue;
    }
    if (part === '--') {
      break;
    }
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      continue;
    }
    const headerText = part.slice(0, headerEnd);
    let bodyContent = part.slice(headerEnd + 4);
    if (bodyContent.endsWith('\r\n')) {
      bodyContent = bodyContent.slice(0, -2);
    }
    const headers = {};
    headerText.split('\r\n').forEach((line) => {
      const idx = line.indexOf(':');
      if (idx === -1) {
        return;
      }
      const name = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      if (name) {
        headers[name] = value;
      }
    });
    const disposition = headers['content-disposition'] || '';
    const nameMatch = disposition.match(/name="([^"]+)"/i);
    if (!nameMatch) {
      continue;
    }
    const fieldName = nameMatch[1];
    const filenameMatch = disposition.match(/filename="([^"]*)"/i);
    if (filenameMatch && filenameMatch[1]) {
      const fileBuffer = Buffer.from(bodyContent, 'latin1');
      files.push({
        fieldName,
        filename: filenameMatch[1],
        contentType: headers['content-type'] || 'application/octet-stream',
        data: fileBuffer,
      });
    } else {
      fields[fieldName] = Buffer.from(bodyContent, 'latin1').toString('utf8');
    }
  }

  return { fields, files };
}
