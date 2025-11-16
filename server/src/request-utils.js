import { createHash } from 'node:crypto';

function normalizeForwardedHeader(value) {
  if (!value || typeof value !== 'string') {
    return undefined;
  }
  return value
    .split(',')
    .map((part) => part.trim())
    .find((part) => part.length > 0);
}

export function getClientIp(req) {
  if (!req) {
    return undefined;
  }
  const headerPriorities = [
    'cf-connecting-ip',
    'x-client-ip',
    'x-forwarded-for',
    'x-real-ip',
  ];
  for (const headerName of headerPriorities) {
    const rawValue = req.get ? req.get(headerName) : req.headers?.[headerName];
    const value = headerName === 'x-forwarded-for' ? normalizeForwardedHeader(rawValue) : (rawValue || '').trim();
    if (value) {
      return value;
    }
  }
  if (typeof req.ip === 'string' && req.ip.trim()) {
    return req.ip.trim();
  }
  if (typeof req.connection?.remoteAddress === 'string' && req.connection.remoteAddress.trim()) {
    return req.connection.remoteAddress.trim();
  }
  if (typeof req.socket?.remoteAddress === 'string' && req.socket.remoteAddress.trim()) {
    return req.socket.remoteAddress.trim();
  }
  return undefined;
}

export function hashIpAddress(ipAddress) {
  if (!ipAddress || typeof ipAddress !== 'string') {
    return undefined;
  }
  const trimmed = ipAddress.trim();
  if (!trimmed) {
    return undefined;
  }
  return createHash('sha256').update(trimmed).digest('hex');
}

export function getHashedClientIp(req) {
  const ip = getClientIp(req);
  if (!ip) {
    return undefined;
  }
  return hashIpAddress(ip);
}

export default getHashedClientIp;
