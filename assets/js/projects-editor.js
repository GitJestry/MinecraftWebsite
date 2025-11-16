(function(){
  'use strict';

  function resolveProjectsDataUrl() {
    if (typeof document !== 'undefined') {
      try {
        const html = document.documentElement;
        if (html) {
          const attr = html.getAttribute('data-projects-url');
          if (attr) {
            try {
              return new URL(attr, document.baseURI).toString();
            } catch (err) {
              return attr;
            }
          }
        }
        const meta = document.querySelector('meta[name="projects-data-url"]');
        if (meta) {
          const content = meta.getAttribute('content');
          if (content) {
            try {
              return new URL(content, document.baseURI).toString();
            } catch (err) {
              return content;
            }
          }
        }
      } catch (err) {}
    }
    if (typeof document !== 'undefined') {
      try {
        return new URL('assets/data/projects.json', document.baseURI).toString();
      } catch (err) {}
    }
    return 'assets/data/projects.json';
  }

  const STATIC_PROJECTS_URL = resolveProjectsDataUrl();
  const DEFAULT_EDITOR_DISABLED_REASON = 'Editorfunktionen sind in dieser statischen Veröffentlichung deaktiviert.';
  const DEFAULT_API_RETRY_ATTEMPTS = 1;
  const DEFAULT_API_RETRY_DELAY = 400;
  let editingSupported = true;
  let editorDisabledReason = DEFAULT_EDITOR_DISABLED_REASON;

  const LOCAL_ADMIN_USERNAME = 'admin';
  const LOCAL_PASSWORD_SALT = 'mirl-editor::v1';
  const LOCAL_ADMIN_PASSWORD_HASH = '5c216a33f072ffb714c1bbf9ca2de0668621baf8b7158e3d591feea0f048cbe3';
  const LOCAL_EDITOR_TOKEN = 'local-editor-token';
  const LOCAL_SESSION_STORAGE_KEY = 'mirl.editor.session.v1';
  const LOCAL_PROJECTS_STORAGE_KEY = 'mirl.editor.projects.v1';
  const LOCAL_LABEL_HISTORY_KEY = 'mirl.editor.labels.v1';
  const LOCAL_UPLOAD_METADATA_KEY = 'mirl.editor.uploads.meta.v1';
  const LOCAL_UPLOAD_DB_NAME = 'mirl.editor.uploads.db';
  const LOCAL_UPLOAD_DB_VERSION = 1;
  const LOCAL_UPLOAD_DB_STORE = 'files';
  const LOCAL_UPLOAD_MAX_ITEMS = 60;
  let localSessionCache = undefined;
  let localProjectsStore = null;
  let labelHistoryCache = null;
  let uploadMetaCache = null;
  let uploadDbPromise = null;
  const uploadPreviewUrlCache = new Map();
  const fileLibrarySlots = [];
  const chipFieldControllers = Object.create(null);
  let projectsById = Object.create(null);
  const labelCollator = (typeof Intl !== 'undefined' && typeof Intl.Collator === 'function')
    ? new Intl.Collator('de', { sensitivity: 'base' })
    : null;

  function getCryptoSubtle() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
      return globalThis.crypto.subtle;
    }
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
      return window.crypto.subtle;
    }
    try {
      if (typeof require === 'function') {
        const cryptoModule = require('crypto');
        if (cryptoModule && cryptoModule.webcrypto && cryptoModule.webcrypto.subtle) {
          return cryptoModule.webcrypto.subtle;
        }
      }
    } catch (err) {}
    return null;
  }

  function getTextEncoderCtor() {
    if (typeof TextEncoder !== 'undefined') {
      return TextEncoder;
    }
    try {
      if (typeof require === 'function') {
        const util = require('util');
        if (util && util.TextEncoder) {
          return util.TextEncoder;
        }
      }
    } catch (err) {}
    return null;
  }

  function bufferToHex(buffer) {
    if (!buffer) return '';
    const view = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer || buffer);
    let hex = '';
    for (let i = 0; i < view.length; i += 1) {
      hex += view[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  async function hashPasswordWithSalt(password) {
    const subtle = getCryptoSubtle();
    const TextEncoderCtor = getTextEncoderCtor();
    if (!subtle || !TextEncoderCtor) {
      return null;
    }
    const encoder = new TextEncoderCtor();
    const normalized = typeof password === 'string' && password.normalize ? password.normalize('NFKC') : String(password || '');
    const data = encoder.encode(LOCAL_PASSWORD_SALT + normalized);
    try {
      const digest = await subtle.digest('SHA-256', data);
      return bufferToHex(digest);
    } catch (err) {
      return null;
    }
  }

  async function verifyLocalAdminPassword(password) {
    const hash = await hashPasswordWithSalt(password);
    if (!hash) {
      return null;
    }
    return hash === LOCAL_ADMIN_PASSWORD_HASH;
  }

  function readLocalSession() {
    if (localSessionCache !== undefined) {
      return localSessionCache;
    }
    if (typeof localStorage === 'undefined') {
      localSessionCache = null;
      return localSessionCache;
    }
    try {
      const raw = localStorage.getItem(LOCAL_SESSION_STORAGE_KEY);
      localSessionCache = raw ? JSON.parse(raw) : null;
    } catch (err) {
      localSessionCache = null;
    }
    return localSessionCache;
  }

  function writeLocalSession(data) {
    localSessionCache = data || null;
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      if (!data) {
        localStorage.removeItem(LOCAL_SESSION_STORAGE_KEY);
      } else {
        localStorage.setItem(LOCAL_SESSION_STORAGE_KEY, JSON.stringify(localSessionCache));
      }
    } catch (err) {}
  }

  let uploadDbInstance = null;

  function supportsIndexedDb() {
    return typeof indexedDB !== 'undefined' && typeof indexedDB.open === 'function';
  }

  function openUploadDb() {
    if (!supportsIndexedDb()) {
      return Promise.resolve(null);
    }
    if (uploadDbInstance) {
      return Promise.resolve(uploadDbInstance);
    }
    if (uploadDbPromise) {
      return uploadDbPromise;
    }
    uploadDbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(LOCAL_UPLOAD_DB_NAME, LOCAL_UPLOAD_DB_VERSION);
        request.onerror = () => resolve(null);
        request.onupgradeneeded = (event) => {
          const db = event.target && event.target.result;
          if (db && !db.objectStoreNames.contains(LOCAL_UPLOAD_DB_STORE)) {
            db.createObjectStore(LOCAL_UPLOAD_DB_STORE, { keyPath: 'id' });
          }
        };
        request.onsuccess = () => {
          uploadDbInstance = request.result;
          if (uploadDbInstance) {
            uploadDbInstance.onclose = () => {
              uploadDbInstance = null;
              uploadDbPromise = null;
            };
          }
          resolve(uploadDbInstance);
        };
      } catch (err) {
        resolve(null);
      }
    });
    return uploadDbPromise;
  }

  async function storeUploadBlob(id, file) {
    const db = await openUploadDb();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(LOCAL_UPLOAD_DB_STORE, 'readwrite');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        const store = tx.objectStore(LOCAL_UPLOAD_DB_STORE);
        store.put({ id, blob: file });
      } catch (err) {
        resolve(false);
      }
    });
  }

  async function deleteUploadBlob(id) {
    if (!id) return false;
    const db = await openUploadDb();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(LOCAL_UPLOAD_DB_STORE, 'readwrite');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        const store = tx.objectStore(LOCAL_UPLOAD_DB_STORE);
        store.delete(id);
      } catch (err) {
        resolve(false);
      }
    });
  }

  async function loadUploadBlob(id) {
    if (!id) return null;
    const db = await openUploadDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(LOCAL_UPLOAD_DB_STORE, 'readonly');
        const store = tx.objectStore(LOCAL_UPLOAD_DB_STORE);
        const request = store.get(id);
        request.onsuccess = () => {
          const value = request.result;
          resolve(value && value.blob ? value.blob : null);
        };
        request.onerror = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    });
  }

  function readUploadMeta() {
    if (uploadMetaCache) {
      return uploadMetaCache;
    }
    if (typeof localStorage === 'undefined') {
      uploadMetaCache = [];
      return uploadMetaCache;
    }
    try {
      const raw = localStorage.getItem(LOCAL_UPLOAD_METADATA_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      uploadMetaCache = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      uploadMetaCache = [];
    }
    return uploadMetaCache;
  }

  function writeUploadMeta(list) {
    uploadMetaCache = Array.isArray(list) ? list : [];
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      localStorage.setItem(LOCAL_UPLOAD_METADATA_KEY, JSON.stringify(uploadMetaCache));
    } catch (err) {}
  }

  function revokeUploadPreview(id) {
    if (!id) return;
    const url = uploadPreviewUrlCache.get(id);
    if (url && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try { URL.revokeObjectURL(url); } catch (err) {}
    }
    uploadPreviewUrlCache.delete(id);
  }

  function persistUploadMeta(record) {
    if (!record) return [];
    const list = readUploadMeta().slice();
    const existingIndex = list.findIndex((item) => item && (item.path === record.path || item.id === record.id));
    if (existingIndex >= 0) {
      const removed = list.splice(existingIndex, 1)[0];
      if (removed && removed.id && removed.id !== record.id) {
        deleteUploadBlob(removed.id);
        revokeUploadPreview(removed.id);
      }
    }
    list.unshift(record);
    while (list.length > LOCAL_UPLOAD_MAX_ITEMS) {
      const removed = list.pop();
      if (removed && removed.id) {
        deleteUploadBlob(removed.id);
        revokeUploadPreview(removed.id);
      }
    }
    writeUploadMeta(list);
    return list;
  }

  function getUploadMetaById(id) {
    return readUploadMeta().find((item) => item && item.id === id) || null;
  }

  function listUploadsByPrefix(prefix) {
    const list = readUploadMeta();
    if (!prefix) {
      return list.slice();
    }
    return list.filter((item) => item && item.prefix === prefix);
  }

  function guessContentType(filename, fallback) {
    const lower = String(filename || '').toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.svg')) return 'image/svg+xml';
    if (lower.endsWith('.zip')) return 'application/zip';
    if (lower.endsWith('.mcpack')) return 'application/zip';
    if (lower.endsWith('.mcaddon')) return 'application/zip';
    if (lower.endsWith('.rar')) return 'application/vnd.rar';
    if (lower.endsWith('.stl')) return 'model/stl';
    if (lower.endsWith('.obj')) return 'model/obj';
    if (lower.endsWith('.gcode')) return 'text/plain';
    if (lower.endsWith('.3mf')) return 'application/octet-stream';
    return fallback || 'application/octet-stream';
  }

  function base64ToBlob(data, type) {
    try {
      const binary = typeof atob === 'function' ? atob(data) : null;
      if (!binary) return null;
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new Blob([bytes], { type: type || 'application/octet-stream' });
    } catch (err) {
      return null;
    }
  }

  async function getUploadBlobData(upload) {
    if (!upload) return null;
    if (upload.inlineData) {
      return base64ToBlob(upload.inlineData, upload.type || 'application/octet-stream');
    }
    return loadUploadBlob(upload.id);
  }

  function formatUploadTimestamp(value) {
    if (!value) return '';
    try {
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) {
        return '';
      }
      if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
        const formatter = new Intl.DateTimeFormat('de-DE', { year: 'numeric', month: 'short', day: 'numeric' });
        return formatter.format(date);
      }
      return date.toISOString().slice(0, 10);
    } catch (err) {
      return '';
    }
  }

  function extractExtension(filename) {
    const match = /\.([a-z0-9]+)$/i.exec(String(filename || ''));
    return match ? match[1].toUpperCase() : 'FILE';
  }

  function extractBearerToken(headers) {
    if (!headers || typeof headers !== 'object') return '';
    const header = headers.Authorization || headers.authorization || '';
    if (!header || typeof header !== 'string') return '';
    return header.replace(/^Bearer\s+/i, '').trim();
  }

  function createHttpError(status, message) {
    const error = new Error(message || 'Request failed');
    error.status = status;
    return error;
  }

  function requireLocalAuth(headers) {
    const token = extractBearerToken(headers);
    const session = readLocalSession();
    if (session && token && token === session.token) {
      return session;
    }
    throw createHttpError(401, 'Nicht autorisiert.');
  }

  function cloneProject(project) {
    return project ? JSON.parse(JSON.stringify(project)) : project;
  }

  function normaliseTags(value) {
    if (Array.isArray(value)) {
      return value.map((tag) => String(tag || '').trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
      return value.split(',').map((tag) => tag.trim()).filter(Boolean);
    }
    return [];
  }

  function normaliseProjectRecord(project) {
    const record = cloneProject(project) || {};
    record.id = (record.id || '').trim();
    if (!record.id && record.title) {
      record.id = slugifyId(record.title);
    }
    record.type = normaliseType(record.type);
    record.tags = normaliseTags(record.tags);
    return record;
  }

  function normaliseLabelValue(value) {
    if (typeof value === 'string') {
      return value.trim().toLowerCase();
    }
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim().toLowerCase();
  }

  function createEmptyLabelHistory() {
    return { categories: [], tags: [] };
  }

  function readLabelHistory() {
    if (labelHistoryCache) {
      return labelHistoryCache;
    }
    let history = createEmptyLabelHistory();
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(LOCAL_LABEL_HISTORY_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          history = Object.assign(createEmptyLabelHistory(), parsed);
        }
      } catch (err) {
        history = createEmptyLabelHistory();
      }
    }
    labelHistoryCache = history;
    return labelHistoryCache;
  }

  function persistLabelHistory(next) {
    const target = next || labelHistoryCache || createEmptyLabelHistory();
    labelHistoryCache = target;
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      localStorage.setItem(LOCAL_LABEL_HISTORY_KEY, JSON.stringify(target));
    } catch (err) {}
  }

  function getLabelHistoryKey(kind) {
    return kind === 'category' ? 'categories' : 'tags';
  }

  function getLabelHistoryList(kind) {
    const history = readLabelHistory();
    const key = getLabelHistoryKey(kind);
    const list = Array.isArray(history[key]) ? history[key] : [];
    return list.slice();
  }

  function addLabelToHistory(kind, value) {
    const clean = typeof value === 'string' ? value.trim() : '';
    if (!clean) {
      return false;
    }
    const key = getLabelHistoryKey(kind);
    const history = readLabelHistory();
    if (!Array.isArray(history[key])) {
      history[key] = [];
    }
    const normalised = normaliseLabelValue(clean);
    if (!normalised) {
      return false;
    }
    const exists = history[key].some((entry) => normaliseLabelValue(entry) === normalised);
    if (exists) {
      return false;
    }
    history[key].push(clean);
    persistLabelHistory(history);
    return true;
  }

  function buildLabelSuggestions(kind) {
    const suggestions = [];
    const seen = new Set();
    const pushValue = (value) => {
      if (!value || typeof value !== 'string') {
        return;
      }
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      const normalised = normaliseLabelValue(trimmed);
      if (!normalised || seen.has(normalised)) {
        return;
      }
      seen.add(normalised);
      suggestions.push(trimmed);
    };

    Object.keys(projectsById || {}).forEach((projectId) => {
      const project = projectsById[projectId];
      if (!project) {
        return;
      }
      if (kind === 'category') {
        if (project.category) {
          pushValue(project.category);
        }
        return;
      }
      const tags = Array.isArray(project.tags)
        ? project.tags
        : normaliseTags(project.tags);
      tags.forEach(pushValue);
    });

    getLabelHistoryList(kind).forEach(pushValue);

    if (labelCollator) {
      suggestions.sort(labelCollator.compare);
    } else {
      suggestions.sort((a, b) => a.localeCompare(b));
    }
    return suggestions;
  }

  function getChipFieldController(kind) {
    if (!chipFieldControllers) {
      return null;
    }
    return chipFieldControllers[kind] || null;
  }

  function refreshLabelSuggestions(kind) {
    const kinds = kind ? [kind] : ['category', 'tags'];
    kinds.forEach((key) => {
      const controller = getChipFieldController(key);
      if (!controller) {
        return;
      }
      controller.renderSuggestions(buildLabelSuggestions(key));
    });
  }

  function persistLocalProjects() {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      if (!localProjectsStore || !Array.isArray(localProjectsStore)) {
        localStorage.removeItem(LOCAL_PROJECTS_STORAGE_KEY);
      } else {
        localStorage.setItem(LOCAL_PROJECTS_STORAGE_KEY, JSON.stringify(localProjectsStore));
      }
    } catch (err) {}
  }

  async function loadLocalProjects() {
    if (localProjectsStore && Array.isArray(localProjectsStore)) {
      return localProjectsStore;
    }
    let stored = null;
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(LOCAL_PROJECTS_STORAGE_KEY);
        stored = raw ? JSON.parse(raw) : null;
      } catch (err) {
        stored = null;
      }
    }
    if (Array.isArray(stored)) {
      localProjectsStore = stored.map((item) => normaliseProjectRecord(item));
      persistLocalProjects();
      return localProjectsStore;
    }
    const staticData = await fetchStaticProjects();
    localProjectsStore = Array.isArray(staticData) ? staticData.map((item) => normaliseProjectRecord(item)) : [];
    persistLocalProjects();
    return localProjectsStore;
  }

  function updateLocalProject(updated) {
    if (!updated) return;
    if (!localProjectsStore) {
      localProjectsStore = [];
    }
    const record = normaliseProjectRecord(updated);
    const entry = cloneProject(record);
    const index = localProjectsStore.findIndex((project) => project && project.id === entry.id);
    if (index === -1) {
      localProjectsStore.push(entry);
    } else {
      localProjectsStore[index] = entry;
    }
    persistLocalProjects();
  }

  function removeLocalProject(projectId) {
    if (!localProjectsStore || !Array.isArray(localProjectsStore)) {
      return;
    }
    const next = localProjectsStore.filter((project) => project && project.id !== projectId);
    localProjectsStore = next;
    persistLocalProjects();
  }

  function parseJsonBody(body) {
    if (!body) return {};
    if (typeof body === 'string') {
      try {
        return body ? JSON.parse(body) : {};
      } catch (err) {
        return {};
      }
    }
    if (typeof body === 'object') {
      return body;
    }
    return {};
  }

  function buildSessionResponse(session) {
    if (session && session.username) {
      return { authenticated: true, user: { username: session.username } };
    }
    return { authenticated: false };
  }

  async function handleLocalEditorRequest(path, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const method = (options.method || 'GET').toUpperCase();

    if (path === '/editor/login') {
      if (method !== 'POST') {
        throw createHttpError(405, 'Methode nicht erlaubt.');
      }
      const payload = parseJsonBody(options.body);
      const username = String(payload.username || '').trim();
      const password = String(payload.password || '');
      if (username !== LOCAL_ADMIN_USERNAME) {
        throw createHttpError(401, 'Ungültige Zugangsdaten.');
      }
      const passwordCheck = await verifyLocalAdminPassword(password);
      if (passwordCheck === null) {
        throw createHttpError(500, 'Passwortverifizierung nicht verfügbar.');
      }
      if (passwordCheck) {
        const session = { username: LOCAL_ADMIN_USERNAME, token: LOCAL_EDITOR_TOKEN };
        writeLocalSession(session);
        return { token: LOCAL_EDITOR_TOKEN };
      }
      throw createHttpError(401, 'Ungültige Zugangsdaten.');
    }

    if (path === '/editor/logout') {
      writeLocalSession(null);
      return { success: true };
    }

    if (path === '/editor/me') {
      const session = readLocalSession();
      const token = extractBearerToken(options.headers || {});
      if (session && token === session.token) {
        return buildSessionResponse(session);
      }
      return { authenticated: false };
    }

    if (path === '/editor/projects') {
      if (method === 'GET') {
        const data = await loadLocalProjects();
        return data.map((project) => cloneProject(project));
      }
      requireLocalAuth(options.headers || {});
      if (method === 'POST') {
        const payload = normaliseProjectRecord(parseJsonBody(options.body));
        if (!payload.title) {
          throw createHttpError(400, 'Titel darf nicht leer sein.');
        }
        if (!payload.id) {
          payload.id = slugifyId(payload.title);
        }
        const store = await loadLocalProjects();
        if (store.some((project) => project && project.id === payload.id)) {
          throw createHttpError(409, 'Projekt-ID existiert bereits.');
        }
        updateLocalProject(payload);
        const stored = localProjectsStore && Array.isArray(localProjectsStore)
          ? localProjectsStore.find((project) => project && project.id === payload.id)
          : null;
        return cloneProject(stored || payload);
      }
      throw createHttpError(405, 'Methode nicht erlaubt.');
    }

    if (path.startsWith('/editor/projects/')) {
      const idPart = path.slice('/editor/projects/'.length);
      const projectId = decodeURIComponent(idPart || '');
      if (!projectId) {
        throw createHttpError(404, 'Projekt nicht gefunden.');
      }
      const store = await loadLocalProjects();
      const existing = store.find((project) => project && project.id === projectId);
      if (method === 'GET') {
        if (!existing) {
          throw createHttpError(404, 'Projekt nicht gefunden.');
        }
        return cloneProject(existing);
      }
      requireLocalAuth(options.headers || {});
      if (method === 'PUT') {
        if (!existing) {
          throw createHttpError(404, 'Projekt nicht gefunden.');
        }
        const payload = normaliseProjectRecord(parseJsonBody(options.body));
        payload.id = projectId;
        updateLocalProject(payload);
        const stored = localProjectsStore && Array.isArray(localProjectsStore)
          ? localProjectsStore.find((project) => project && project.id === projectId)
          : null;
        return cloneProject(stored || payload);
      }
      if (method === 'DELETE') {
        if (!existing) {
          throw createHttpError(404, 'Projekt nicht gefunden.');
        }
        removeLocalProject(projectId);
        return { success: true };
      }
      throw createHttpError(405, 'Methode nicht erlaubt.');
    }

    throw createHttpError(404, 'Pfad nicht gefunden.');
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normaliseRetryStatuses(values) {
    if (!Array.isArray(values) || !values.length) {
      return null;
    }
    const normalised = values
      .map((value) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.trunc(number) : null;
      })
      .filter((value) => value !== null);
    return normalised.length ? normalised : null;
  }

  function isRetriableStatus(status, explicit) {
    if (explicit && explicit.includes(status)) {
      return true;
    }
    return status === 408 || status === 425 || status === 429 || (status >= 500 && status < 600);
  }

  function sanitiseApiBase(value) {
    if (value == null) return '';
    const trimmed = String(value).trim();
    if (!trimmed || trimmed.toLowerCase() === 'same-origin') {
      return '';
    }
    return trimmed.replace(/\/+$/, '');
  }

  function computeApiBase() {
    if (typeof window !== 'undefined' && window.MIRL_EDITOR_API) {
      return sanitiseApiBase(window.MIRL_EDITOR_API);
    }
    if (typeof document !== 'undefined' && document.documentElement) {
      const attr = document.documentElement.getAttribute('data-editor-api');
      if (attr) {
        return sanitiseApiBase(attr);
      }
    }
    if (typeof window !== 'undefined') {
      const origin = window.location && window.location.origin;
      if (origin && origin !== 'null' && !origin.startsWith('file:')) {
        return '';
      }
    }
    return sanitiseApiBase('http://localhost:3001');
  }

  const API_BASE = computeApiBase();
  const API_SAME_ORIGIN = API_BASE === '';

  function isTruthyFlag(value) {
    if (value == null) return true;
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return true;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return true;
  }

  function detectEditorEntryFlag() {
    if (typeof window === 'undefined') return false;
    const keys = ['editor', 'editor-entry', 'editorMode'];
    let hasFlag = false;
    try {
      const search = window.location && typeof window.location.search === 'string' ? window.location.search : '';
      if (search) {
        const params = new URLSearchParams(search);
        hasFlag = keys.some((key) => {
          if (!params.has(key)) return false;
          const raw = params.get(key);
          if (raw == null) return true;
          return isTruthyFlag(raw);
        });
      }
    } catch (err) {}
    if (hasFlag) return true;
    try {
      const hash = window.location && typeof window.location.hash === 'string' ? window.location.hash : '';
      if (hash) {
        const lowerHash = hash.toLowerCase();
        hasFlag = keys.some((key) => lowerHash.includes(key));
      }
    } catch (err) {}
    if (hasFlag) return true;
    try {
      if (typeof document !== 'undefined' && document.documentElement) {
        const attr = document.documentElement.getAttribute('data-editor-entry');
        if (attr) {
          return isTruthyFlag(attr);
        }
      }
    } catch (err) {}
    try {
      if (typeof document !== 'undefined') {
        const meta = document.querySelector('meta[name="editor-entry"]');
        if (meta) {
          return isTruthyFlag(meta.getAttribute('content'));
        }
      }
    } catch (err) {}
    return false;
  }

  function setElementVisibility(el, show) {
    if (!el) return;
    if (show) {
      el.hidden = false;
      el.removeAttribute('aria-hidden');
    } else {
      el.hidden = true;
      el.setAttribute('aria-hidden', 'true');
    }
  }

  function setButtonState(btn, enabled) {
    if (!btn) return;
    btn.disabled = !enabled;
    btn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  }

  const banner = document.getElementById('editor-banner');
  if (!banner) return;
  const bannerRequiresSession = banner.hasAttribute('data-require-session');
  const bannerSuppressed = banner.hasAttribute('data-hide-editor-ui');

  const loginBtn = document.getElementById('editor-login-button');
  const statusBox = document.getElementById('editor-status');
  const label = document.getElementById('editor-label');
  const userLabel = document.getElementById('editor-user-label');
  const toggleBtn = document.getElementById('editor-toggle');
  const addBtn = document.getElementById('editor-add');
  const logoutBtn = document.getElementById('editor-logout');

  const dpGrid = document.querySelector('#datapacks .itemgrid');
  const prGrid = document.querySelector('#printing .itemgrid');
  const dpCount = document.querySelector('#datapacks .count');
  const prCount = document.querySelector('#printing .count');

  // Editor modal
  const editorModal = document.getElementById('project-editor-modal');
  const editorForm = document.getElementById('project-editor-form');
  const editorTitleEl = document.getElementById('project-editor-title');
  const editorSubEl = document.getElementById('project-editor-sub');
  const editorErrorEl = document.getElementById('project-editor-error');

  const idInput = document.getElementById('pe-id');
  const typeInput = document.getElementById('pe-type');
  const titleInput = document.getElementById('pe-title');
  const mcVersionInput = document.getElementById('pe-mcversion');
  const statusInput = document.getElementById('pe-status');
  const categoryInput = document.getElementById('pe-category');
  const tagsInput = document.getElementById('pe-tags');
  const categorySelectedEl = document.getElementById('pe-category-selected');
  const categorySuggestionsEl = document.getElementById('pe-category-suggestions');
  const categoryAddBtn = document.getElementById('pe-category-add');
  const tagsSelectedEl = document.getElementById('pe-tags-selected');
  const tagsSuggestionsEl = document.getElementById('pe-tags-suggestions');
  const tagsAddBtn = document.getElementById('pe-tags-add');
  const shortInput = document.getElementById('pe-short');
  const modalBodyInput = document.getElementById('pe-modal-body');
  const modalDescriptionList = document.getElementById('pe-modal-description-list');
  const modalVersionsList = document.getElementById('pe-modal-versions-list');
  const modalGalleryList = document.getElementById('pe-modal-gallery-list');
  const versionChainListEl = document.querySelector('#pe-version-chain .editor-version-chain-list');
  const downloadInput = document.getElementById('pe-download');
  const imageInput = document.getElementById('pe-image');
  const deleteBtn = document.getElementById('project-editor-delete');

  let versionAutoNumber = 1;

  enhanceFilePickerTargets(document);
  handleVersionRowsMutated();

  function getCurrentTypeValue() {
    return normaliseType(typeInput ? typeInput.value : 'datapack');
  }

  const requiredFieldDefs = [
    { input: titleInput, label: 'Titel' },
    { input: shortInput, label: 'Kurzbeschreibung' },
    { input: statusInput, label: 'Status' },
    { input: categoryInput, label: 'Kategorie' },
    { input: downloadInput, label: 'Download-Datei' },
    { input: imageInput, label: 'Vorschaubild' },
    {
      input: mcVersionInput,
      label: 'Minecraft-Version',
      when: () => getCurrentTypeValue() === 'datapack',
    },
  ];

  const typeOnlyFields = editorForm ? Array.from(editorForm.querySelectorAll('[data-type-only]')) : [];
  const typeAwareLabelNodes = editorForm ? Array.from(editorForm.querySelectorAll('[data-label-datapack]')) : [];
  const typeAwarePlaceholderNodes = editorForm ? Array.from(editorForm.querySelectorAll('[data-placeholder-datapack]')) : [];
  const typeAwareHintNodes = editorForm ? Array.from(editorForm.querySelectorAll('[data-hint-datapack]')) : [];

  const entryAccessEnabled = detectEditorEntryFlag();
  let sessionActive = false;
  let autoLoginTriggered = false;

  function updateValidationSummary(missingLabels) {
    if (!editorErrorEl) {
      return;
    }
    if (!missingLabels || !missingLabels.length) {
      editorErrorEl.textContent = '';
      editorErrorEl.hidden = true;
      return;
    }
    const prefix = missingLabels.length > 1
      ? 'Bitte fülle folgende Pflichtfelder aus: '
      : 'Bitte fülle folgendes Pflichtfeld aus: ';
    editorErrorEl.textContent = prefix + missingLabels.join(', ') + '.';
    editorErrorEl.hidden = false;
  }

  function setFieldErrorState(input, hasError) {
    if (!input) return;
    if (hasError) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
    const field = input.closest('.field');
    if (field) {
      field.classList.toggle('field-error', !!hasError);
    }
  }

  function clearOptionalFieldErrors() {
    requiredFieldDefs.forEach((def) => {
      if (!def || !def.input) return;
      const required = typeof def.when === 'function' ? !!def.when() : true;
      if (!required) {
        setFieldErrorState(def.input, false);
      }
    });
  }

  function resetValidationState() {
    requiredFieldDefs.forEach((def) => {
      if (!def || !def.input) return;
      setFieldErrorState(def.input, false);
    });
    updateValidationSummary([]);
  }

  function validateRequiredFields() {
    const missing = [];
    let firstInvalid = null;
    requiredFieldDefs.forEach((def) => {
      if (!def || !def.input) return;
      const required = typeof def.when === 'function' ? !!def.when() : true;
      if (!required) {
        setFieldErrorState(def.input, false);
        return;
      }
      const value = (def.input.value || '').trim();
      const hasError = !value;
      setFieldErrorState(def.input, hasError);
      if (hasError) {
        missing.push(def.label);
        if (!firstInvalid) {
          firstInvalid = def.input;
        }
      }
    });
    return { missing, firstInvalid };
  }

  function focusFirstInvalidField(input) {
    if (!input) return;
    let target = input;
    if (input.type === 'hidden') {
      const field = input.closest ? input.closest('.field') : null;
      const focusable = field ? field.querySelector('[data-chip-focus]') : null;
      if (focusable) {
        target = focusable;
      }
    }
    try {
      if (target && typeof target.focus === 'function') {
        target.focus({ preventScroll: false });
      }
    } catch (err) {
      try { if (target && typeof target.focus === 'function') target.focus(); } catch (err2) {}
    }
    if (target && typeof target.scrollIntoView === 'function') {
      try {
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      } catch (err) {
        target.scrollIntoView(true);
      }
    }
  }

  function handleRequiredFieldInput(event) {
    const input = event && event.currentTarget ? event.currentTarget : null;
    if (!input) return;
    const summaryVisible = editorErrorEl && !editorErrorEl.hidden;
    const hadError = input.getAttribute && input.getAttribute('aria-invalid') === 'true';
    if (!summaryVisible && !hadError) {
      return;
    }
    const value = (input.value || '').trim();
    if (!summaryVisible && hadError) {
      if (value) {
        setFieldErrorState(input, false);
      }
      return;
    }
    const result = validateRequiredFields();
    updateValidationSummary(result.missing);
  }

  function createChipField(options) {
    const opts = Object.assign({
      multi: false,
      emptyLabel: 'Keine Auswahl',
      emptySuggestionsLabel: 'Keine Vorschläge vorhanden.',
      removeLabel: '„%s“ entfernen',
    }, options || {});
    const state = { values: [] };
    const input = opts.input || null;
    const selectedHost = opts.selected || null;
    const suggestionsHost = opts.suggestions || null;

    function cloneValues() {
      return state.values.slice();
    }

    function syncInput() {
      if (!input) {
        return;
      }
      if (opts.multi) {
        input.value = state.values.join(', ');
      } else {
        input.value = state.values[0] || '';
      }
    }

    function applyRemovalLabel(btn, value) {
      const label = (opts.removeLabel || '„%s“ entfernen').replace('%s', value);
      btn.title = label;
      btn.setAttribute('aria-label', label);
    }

    function renderSelected() {
      if (!selectedHost) {
        return;
      }
      selectedHost.innerHTML = '';
      if (!state.values.length) {
        const empty = document.createElement('span');
        empty.className = 'chip-input-empty';
        empty.textContent = opts.emptyLabel;
        selectedHost.appendChild(empty);
        return;
      }
      state.values.forEach((value) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chip-option';
        btn.setAttribute('data-removable', 'true');
        btn.textContent = value;
        applyRemovalLabel(btn, value);
        btn.addEventListener('click', () => {
          removeValue(value);
        });
        selectedHost.appendChild(btn);
      });
    }

    function updateSuggestionState() {
      if (!suggestionsHost) {
        return;
      }
      const buttons = suggestionsHost.querySelectorAll('button[data-chip-value]');
      buttons.forEach((btn) => {
        const value = btn.getAttribute('data-chip-value') || '';
        const normalised = normaliseLabelValue(value);
        const active = state.values.some((entry) => normaliseLabelValue(entry) === normalised);
        btn.classList.toggle('is-selected', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }

    function commit(nextValues) {
      state.values = nextValues;
      syncInput();
      renderSelected();
      updateSuggestionState();
      if (input) {
        handleRequiredFieldInput({ currentTarget: input });
      }
    }

    function normaliseList(values) {
      const arr = [];
      const source = Array.isArray(values)
        ? values
        : (values && typeof values === 'string')
          ? [values]
          : [];
      source.forEach((value) => {
        const trimmed = typeof value === 'string' ? value.trim() : '';
        if (!trimmed) {
          return;
        }
        const normalised = normaliseLabelValue(trimmed);
        if (!normalised) {
          return;
        }
        if (!opts.multi) {
          if (!arr.length) {
            arr.push(trimmed);
          }
          return;
        }
        const exists = arr.some((entry) => normaliseLabelValue(entry) === normalised);
        if (!exists) {
          arr.push(trimmed);
        }
      });
      return arr;
    }

    function setValues(values) {
      commit(normaliseList(values));
    }

    function addValue(value) {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      if (!trimmed) {
        return;
      }
      if (opts.multi) {
        const normalised = normaliseLabelValue(trimmed);
        const exists = state.values.some((entry) => normaliseLabelValue(entry) === normalised);
        if (exists) {
          return;
        }
        commit(state.values.concat(trimmed));
        return;
      }
      commit(trimmed ? [trimmed] : []);
    }

    function removeValue(value) {
      const normalised = normaliseLabelValue(value);
      const next = state.values.filter((entry) => normaliseLabelValue(entry) !== normalised);
      commit(next);
    }

    function toggleValue(value) {
      if (!opts.multi) {
        addValue(value);
        return;
      }
      const normalised = normaliseLabelValue(value);
      const exists = state.values.some((entry) => normaliseLabelValue(entry) === normalised);
      if (exists) {
        removeValue(value);
      } else {
        addValue(value);
      }
    }

    function renderSuggestions(values) {
      if (!suggestionsHost) {
        return;
      }
      suggestionsHost.innerHTML = '';
      const list = Array.isArray(values) ? values : [];
      if (!list.length) {
        const empty = document.createElement('span');
        empty.className = 'chip-input-empty';
        empty.textContent = opts.emptySuggestionsLabel;
        suggestionsHost.appendChild(empty);
        return;
      }
      list.forEach((value) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chip-option';
        btn.textContent = value;
        btn.setAttribute('data-chip-value', value);
        btn.addEventListener('click', () => {
          toggleValue(value);
        });
        suggestionsHost.appendChild(btn);
      });
      updateSuggestionState();
    }

    renderSelected();

    return {
      setValues,
      addValue,
      removeValue,
      toggleValue,
      getValues: cloneValues,
      renderSuggestions,
    };
  }

  function promptForLabel(kind) {
    const promptLabel = kind === 'category'
      ? 'Neue Kategorie eingeben:'
      : 'Neuen Tag eingeben:';
    if (typeof prompt !== 'function') {
      if (typeof alert === 'function') {
        alert('Eingabedialog nicht verfügbar.');
      }
      return '';
    }
    const value = prompt(promptLabel, '') || '';
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }
    addLabelToHistory(kind, trimmed);
    refreshLabelSuggestions(kind);
    return trimmed;
  }

  function handleChipAdd(kind) {
    const value = promptForLabel(kind);
    if (!value) {
      return;
    }
    const controller = getChipFieldController(kind);
    if (controller) {
      controller.addValue(value);
    } else if (kind === 'category' && categoryInput) {
      categoryInput.value = value;
      handleRequiredFieldInput({ currentTarget: categoryInput });
    } else if (kind === 'tags' && tagsInput) {
      const existing = normaliseTags(tagsInput.value || '');
      const hasValue = existing.some((entry) => normaliseLabelValue(entry) === normaliseLabelValue(value));
      if (!hasValue) {
        existing.push(value);
      }
      tagsInput.value = existing.join(', ');
      handleRequiredFieldInput({ currentTarget: tagsInput });
    }
  }

  if (categoryInput && categorySelectedEl && categorySuggestionsEl) {
    chipFieldControllers.category = createChipField({
      input: categoryInput,
      selected: categorySelectedEl,
      suggestions: categorySuggestionsEl,
      emptyLabel: 'Keine Kategorie ausgewählt.',
      emptySuggestionsLabel: 'Noch keine Kategorien verfügbar.',
      removeLabel: 'Kategorie „%s“ entfernen',
    });
    chipFieldControllers.category.setValues((categoryInput.value || '').trim() ? [categoryInput.value.trim()] : []);
  }

  if (tagsInput && tagsSelectedEl && tagsSuggestionsEl) {
    chipFieldControllers.tags = createChipField({
      input: tagsInput,
      selected: tagsSelectedEl,
      suggestions: tagsSuggestionsEl,
      multi: true,
      emptyLabel: 'Noch keine Tags ausgewählt.',
      emptySuggestionsLabel: 'Noch keine Tags verfügbar.',
      removeLabel: 'Tag „%s“ entfernen',
    });
    chipFieldControllers.tags.setValues(normaliseTags(tagsInput.value || ''));
  }

  if (categoryAddBtn) {
    categoryAddBtn.addEventListener('click', () => handleChipAdd('category'));
  }
  if (tagsAddBtn) {
    tagsAddBtn.addEventListener('click', () => handleChipAdd('tags'));
  }

  refreshLabelSuggestions();

  function beginLogin(options) {
    if (!loginBtn) return;
    const opts = (options && typeof options === 'object') ? options : {};
    const auto = !!opts.auto;
    const focus = 'focus' in opts ? !!opts.focus : true;
    if (auto) {
      if (autoLoginTriggered) {
        return;
      }
      autoLoginTriggered = true;
    }
    setElementVisibility(loginBtn, true);
    setButtonState(loginBtn, true);
    if (auto) {
      handleLogin();
      return;
    }
    if (focus && typeof loginBtn.focus === 'function') {
      try { loginBtn.focus(); } catch (err) {}
    }
  }

  if (typeof window !== 'undefined') {
    window.MIRL_beginEditorLogin = beginLogin;
  }

  function updateEditorUi() {
    const hasAccessFlag = entryAccessEnabled || sessionActive;
    let bannerVisible = editingSupported ? hasAccessFlag : false;
    if (bannerRequiresSession && !sessionActive) {
      bannerVisible = false;
    }
    if (bannerSuppressed) {
      bannerVisible = false;
    }
    setElementVisibility(banner, bannerVisible);

    if (!bannerVisible) {
      setElementVisibility(loginBtn, false);
      setButtonState(loginBtn, false);
      setElementVisibility(statusBox, false);
      if (statusBox) statusBox.classList.add('hidden');
      [toggleBtn, addBtn, logoutBtn].forEach((btn) => {
        setElementVisibility(btn, false);
        setButtonState(btn, false);
      });
      return;
    }

    if (!editingSupported) {
      setElementVisibility(loginBtn, false);
      setButtonState(loginBtn, false);
      setElementVisibility(statusBox, false);
      if (statusBox) statusBox.classList.add('hidden');
      [toggleBtn, addBtn, logoutBtn].forEach((btn) => {
        setElementVisibility(btn, false);
        setButtonState(btn, false);
      });
      return;
    }

    const showLogin = entryAccessEnabled && !sessionActive;
    setElementVisibility(loginBtn, showLogin);
    setButtonState(loginBtn, showLogin);

    const showControls = entryAccessEnabled && sessionActive;
    setElementVisibility(statusBox, showControls);
    if (statusBox) {
      statusBox.classList.toggle('hidden', !showControls);
    }
    [toggleBtn, addBtn, logoutBtn].forEach((btn) => {
      setElementVisibility(btn, showControls);
      setButtonState(btn, showControls);
    });
  }

  updateEditorUi();

  const LS_KEY = 'mirl.editor.token';
  let token = null;
  let editorOn = false;
  const modalDefaults = new Map();
  let dynamicModalHost = null;

  function getDynamicModalHost() {
    if (dynamicModalHost && document.body && document.body.contains(dynamicModalHost)) {
      return dynamicModalHost;
    }
    if (!document.body) {
      return null;
    }
    dynamicModalHost = document.getElementById('editor-generated-modals');
    if (!dynamicModalHost) {
      dynamicModalHost = document.createElement('div');
      dynamicModalHost.id = 'editor-generated-modals';
      dynamicModalHost.style.display = 'contents';
      document.body.appendChild(dynamicModalHost);
    }
    return dynamicModalHost;
  }
  let currentMode = 'create'; // 'create' | 'edit'
  let editingProject = null;
  let currentModalId = '';

  if (editorForm) {
    resetModalUi();
  }

  const SUB_COPY = {
    create: {
      datapack: 'Lege ein neues Datapack mit Version, Tags und Download an.',
      printing: 'Füge ein neues 3D-Druck-Projekt mit Druck-Setup und Download hinzu.'
    },
    edit: {
      datapack: 'Bearbeite die Angaben deines Datapacks.',
      printing: 'Bearbeite die Angaben deines 3D-Druck-Projekts.'
    }
  };

  function disableEditorFeatures(reason) {
    if (!editingSupported) return;
    editingSupported = false;
    sessionActive = false;
    editorDisabledReason = reason || DEFAULT_EDITOR_DISABLED_REASON;
    document.documentElement.classList.remove('editor-mode-on');
    if (label) {
      label.textContent = editorDisabledReason;
    }
    if (userLabel) {
      userLabel.textContent = '';
    }
    if (statusBox) {
      statusBox.classList.add('hidden');
    }
    [loginBtn, logoutBtn, toggleBtn, addBtn].forEach((btn) => {
      setElementVisibility(btn, false);
      setButtonState(btn, false);
    });
    if (banner) {
      banner.setAttribute('data-editor-disabled', 'true');
      let note = banner.querySelector('.editor-disabled-note');
      if (!note) {
        note = document.createElement('span');
        note.className = 'editor-disabled-note';
        banner.appendChild(note);
      }
      note.textContent = editorDisabledReason;
    }
    updateEditorUi();
  }

  function assertEditorAvailable(showAlert) {
    if (editingSupported) {
      return true;
    }
    if (showAlert && typeof alert === 'function') {
      alert(editorDisabledReason);
    }
    return false;
  }

  function loadToken() {
    try {
      const t = localStorage.getItem(LS_KEY);
      if (t) token = t;
    } catch(e){}
  }

  function saveToken(value) {
    token = value;
    try {
      if (value) localStorage.setItem(LS_KEY, value);
      else localStorage.removeItem(LS_KEY);
    } catch(e){}
  }

  function setLoggedOut() {
    sessionActive = false;
    if (!editingSupported) {
      if (label) label.textContent = editorDisabledReason;
      if (userLabel) userLabel.textContent = '';
      if (statusBox) statusBox.classList.add('hidden');
      updateEditorUi();
      return;
    }
    if (label) label.textContent = 'Nicht angemeldet';
    if (userLabel) userLabel.textContent = '';
    if (statusBox) statusBox.classList.add('hidden');
    editorOn = false;
    if (toggleBtn) toggleBtn.textContent = 'Editor-Modus: Aus';
    document.documentElement.classList.remove('editor-mode-on');
    if (entryAccessEnabled) {
      beginLogin({ focus: false });
    }
    updateEditorUi();
  }

  function setLoggedIn(username) {
    sessionActive = true;
    if (!editingSupported) {
      updateEditorUi();
      return;
    }
    if (label) label.textContent = 'Editor aktiviert';
    if (userLabel) userLabel.textContent = username ? ('Angemeldet als ' + username) : '';
    if (statusBox) statusBox.classList.remove('hidden');
    updateEditorUi();
  }

  async function api(path, options){
    const opts = options ? { ...options } : {};
    const retryAttemptsOption = Number.isFinite(opts.retryAttempts) ? Math.max(0, Math.floor(opts.retryAttempts)) : DEFAULT_API_RETRY_ATTEMPTS;
    const retryDelayOption = Number.isFinite(opts.retryDelay) ? Math.max(0, Math.floor(opts.retryDelay)) : DEFAULT_API_RETRY_DELAY;
    const retryStatuses = normaliseRetryStatuses(opts.retryOnStatuses);
    delete opts.retryAttempts;
    delete opts.retryDelay;
    delete opts.retryOnStatuses;
    const headers = { ...(opts.headers || {}) };
    if (!(opts.body instanceof FormData) && !('Content-Type' in headers)) {
      headers['Content-Type'] = 'application/json';
    }
    if (!('Accept' in headers)) {
      headers['Accept'] = 'application/json';
    }
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
    opts.headers = headers;
    opts.credentials = API_SAME_ORIGIN ? 'include' : 'omit';
    if (typeof path === 'string' && path.startsWith('/editor/')) {
      return handleLocalEditorRequest(path, opts);
    }
    const url = API_BASE ? API_BASE + path : path;
    let attempt = 0;
    while (attempt <= retryAttemptsOption) {
      let res;
      try {
        res = await fetch(url, opts);
      } catch (err) {
        const isAbort = err && typeof err === 'object' && err.name === 'AbortError';
        if (isAbort || attempt === retryAttemptsOption) {
          throw err;
        }
        attempt += 1;
        if (retryDelayOption > 0) {
          await delay(retryDelayOption * attempt);
        }
        continue;
      }
      if (!res.ok) {
        if (attempt < retryAttemptsOption && isRetriableStatus(res.status, retryStatuses)) {
          attempt += 1;
          if (retryDelayOption > 0) {
            await delay(retryDelayOption * attempt);
          }
          continue;
        }
        let err;
        try { err = await res.json(); } catch(e){}
        const msg = err && err.error ? err.error : ('HTTP ' + res.status);
        const error = new Error(msg);
        error.status = res.status;
        throw error;
      }
      const text = await res.text();
      try {
        return text ? JSON.parse(text) : null;
      } catch(e){
        return null;
      }
    }
    return null;
  }

  async function checkSession() {
    if (!editingSupported) {
      setLoggedOut();
      return;
    }
    if (!token) {
      setLoggedOut();
      return;
    }
    try {
      const data = await api('/editor/me', { method: 'GET' });
      if (data && data.authenticated && data.user) {
        setLoggedIn(data.user.username || 'admin');
      } else {
        saveToken(null);
        setLoggedOut();
      }
    } catch(e){
      saveToken(null);
      setLoggedOut();
    }
  }

  async function handleLogin(){
    if (!assertEditorAvailable(true)) {
      return;
    }
    const username = prompt('Admin-Benutzername', 'admin');
    if (!username) return;
    const password = prompt('Admin-Passwort');
    if (!password) return;
    try {
      const res = await api('/editor/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
        retryAttempts: 2,
        retryDelay: 500
      });
      if (res && res.token) {
        saveToken(res.token);
        setLoggedIn(username);
        alert('Login erfolgreich.');
      } else {
        alert('Login fehlgeschlagen.');
      }
    } catch(e){
      let message = e && typeof e.message === 'string' ? e.message : '';
      if (!message || message === 'Failed to fetch') {
        message = 'Netzwerkfehler. Bitte prüfe die Editor-API und versuche es erneut.';
      }
      alert('Login fehlgeschlagen: ' + message);
    }
  }

  async function handleLogout(){
    if (!editingSupported) {
      setLoggedOut();
      return;
    }
    if (!token) {
      setLoggedOut();
      return;
    }
    try {
      await api('/editor/logout', { method: 'POST', body: '{}' });
    } catch(e){}
    saveToken(null);
    setLoggedOut();
  }

  function toggleEditorMode(){
    if (!editingSupported) {
      assertEditorAvailable(true);
      return;
    }
    if (!entryAccessEnabled || !sessionActive) {
      return;
    }
    editorOn = !editorOn;
    if (toggleBtn) {
      toggleBtn.textContent = editorOn ? 'Editor-Modus: An' : 'Editor-Modus: Aus';
    }
    document.documentElement.classList.toggle('editor-mode-on', editorOn);
  }

  // ---------- Project loading & rendering ----------

  function normaliseType(type) {
    const t = String(type || 'datapack').toLowerCase();
    if (t.startsWith('print')) return 'printing';
    return 'datapack';
  }

  function resolveModalId(project, typeHint) {
    if (!project) return '';
    const explicit = (project.modalTarget || '').trim();
    if (explicit) return explicit;
    const id = (project.id || '').trim();
    if (!id) return '';
    const matchByData = document.querySelector(`.modal[data-project-id="${id}"]`);
    if (matchByData && matchByData.id) {
      return matchByData.id;
    }
    const direct = document.getElementById(id);
    if (direct && direct.classList && direct.classList.contains('modal')) {
      return direct.id;
    }
    const prefix = normaliseType(typeHint) === 'printing' ? 'pr-' : 'dp-';
    const guess = document.getElementById(prefix + id);
    if (guess && guess.classList && guess.classList.contains('modal')) {
      return guess.id;
    }
    return '';
  }

  function rememberModalDefaults(modalId, modal) {
    if (!modalId || !modal || modalDefaults.has(modalId)) return;
    const hero = modal.querySelector('.modal-hero .muted');
    const body = modal.querySelector('.modal-body');
    const badges = modal.querySelector('.modal-hero .badges');
    const heroActions = modal.querySelector('.modal-hero .hero-actions');
    const stats = modal.querySelector('.modal-hero .stats');
    modalDefaults.set(modalId, {
      hero: hero ? hero.textContent.trim() : '',
      body: body ? body.innerHTML.trim() : '',
      badges: badges ? badges.innerHTML.trim() : '',
      heroActions: heroActions ? heroActions.innerHTML.trim() : '',
      stats: stats ? stats.innerHTML.trim() : '',
    });
  }

  function getModalRef(project) {
    if (!project) {
      return { modalId: '', modal: null };
    }
    const type = normaliseType(project.type);
    const modalId = resolveModalId(project, type);
    const modal = modalId ? document.getElementById(modalId) : null;
    if (modal) {
      rememberModalDefaults(modalId, modal);
    }
    return { modalId, modal };
  }

  function ensureDynamicProjectModal(project) {
    if (!project || typeof document === 'undefined') {
      return { modalId: '', modal: null };
    }
    const ref = getModalRef(project);
    if (ref.modalId && ref.modal) {
      return ref;
    }
    const safeType = normaliseType(project.type);
    const fallbackId = (project.id && project.id.trim()) || slugifyId(project.title || 'project');
    if (!fallbackId) {
      return { modalId: '', modal: null };
    }
    const baseId = `${safeType === 'printing' ? 'pr' : 'dp'}-${fallbackId}`;
    let modalId = baseId;
    let counter = 1;
    while (document.getElementById(modalId)) {
      modalId = `${baseId}-${counter++}`;
    }
    const host = getDynamicModalHost();
    if (!host) {
      return { modalId: '', modal: null };
    }
    const titleId = `${modalId}-title`;
    const heroTitle = escapeHtml(project.title || 'Project');
    const heroSubtitle = escapeHtml(
      (typeof project.modalHero === 'string' && project.modalHero.trim())
        || (typeof project.shortDescription === 'string' ? project.shortDescription.trim() : ''),
    );
    const badgesHtml = (typeof project.modalBadges === 'string' && project.modalBadges.trim())
      ? project.modalBadges.trim()
      : buildAutoBadgesHtml(safeType, project.status, project.mcVersion, project.tags, project.category);
    let heroActionsHtml = (typeof project.modalHeroActions === 'string' && project.modalHeroActions.trim())
      ? project.modalHeroActions.trim()
      : '';
    let bodyHtml = (typeof project.modalBody === 'string' && project.modalBody.trim())
      ? project.modalBody
      : '';
    if (!bodyHtml) {
      const sidebar = buildAutoSidebarData(safeType, project.status, project.category, project.mcVersion, project.tags);
      const fallbackBody = {
        infoTitle: sidebar.infoTitle,
        infoItems: sidebar.infoItems,
        tagsTitle: sidebar.tagsTitle,
        tags: sidebar.tags,
        description: project.shortDescription ? [project.shortDescription] : [],
        steps: [],
        versions: [],
        gallery: [],
      };
      bodyHtml = buildModalBodyHtml(modalId, fallbackBody, fallbackId);
    }
    const parsedBody = parseModalBodyContent(bodyHtml || '');
    const latestParsedVersion = parsedBody && Array.isArray(parsedBody.versions) && parsedBody.versions.length
      ? parsedBody.versions[0]
      : null;
    const derivedDownload = project.downloadFile
      || (latestParsedVersion ? (latestParsedVersion.url || latestParsedVersion.downloadFile || '') : '');
    if (!heroActionsHtml) {
      heroActionsHtml = buildAutoHeroActionsHtml(derivedDownload, fallbackId);
    }
    const statsHtml = (typeof project.modalStats === 'string' && project.modalStats.trim())
      ? project.modalStats.trim()
      : buildAutoStatsHtml({
          latestVersion: latestParsedVersion ? latestParsedVersion.release : '',
          updatedAt: project.updatedAt || project.createdAt || new Date().toISOString(),
          projectId: fallbackId,
          downloadUrl: derivedDownload,
        });
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = modalId;
    modal.dataset.projectId = project.id || fallbackId;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-hidden', 'true');
    modal.setAttribute('aria-labelledby', titleId);
    modal.innerHTML =
      `<div class="modal-backdrop" data-close="${modalId}"></div>` +
      `<div class="modal-content" role="document">` +
      `<button aria-label="Close" class="modal-close" data-close="${modalId}">×</button>` +
      `<header class="modal-hero">` +
      `<div class="title" id="${titleId}">${heroTitle}</div>` +
      `<div class="muted">${heroSubtitle}</div>` +
      `<div class="badges">${badgesHtml}</div>` +
      `<div class="hero-actions">${heroActionsHtml}</div>` +
      `<div class="stats">${statsHtml}</div>` +
      `</header>` +
      `<div class="modal-body">${bodyHtml}</div>` +
      `</div>`;
    host.appendChild(modal);
    rememberModalDefaults(modalId, modal);
    initModalTabs(modal);
    const heroEl = modal.querySelector('.modal-hero .muted');
    if (heroEl) heroEl.hidden = !heroSubtitle;
    const badgesEl = modal.querySelector('.modal-hero .badges');
    if (badgesEl) badgesEl.hidden = !badgesHtml.trim();
    const actionsEl = modal.querySelector('.modal-hero .hero-actions');
    if (actionsEl) actionsEl.hidden = !heroActionsHtml.trim();
    const statsEl = modal.querySelector('.modal-hero .stats');
    if (statsEl) statsEl.hidden = !statsHtml.trim();
    return { modalId, modal };
  }

  function extractModalSectionHtml(project, selector) {
    const { modal } = getModalRef(project);
    if (!modal) return '';
    const section = modal.querySelector(selector);
    return section ? section.innerHTML.trim() : '';
  }

  function extractModalBadges(project) {
    return extractModalSectionHtml(project, '.modal-hero .badges');
  }

  function extractModalHeroActions(project) {
    return extractModalSectionHtml(project, '.modal-hero .hero-actions');
  }

  function extractModalStats(project) {
    return extractModalSectionHtml(project, '.modal-hero .stats');
  }

  function updateSubtitle(type, mode) {
    if (!editorSubEl) return;
    const safeType = normaliseType(type);
    const safeMode = mode === 'edit' ? 'edit' : 'create';
    const fallback = safeMode === 'edit' ? SUB_COPY.edit.datapack : SUB_COPY.create.datapack;
    editorSubEl.textContent = (SUB_COPY[safeMode] && SUB_COPY[safeMode][safeType]) || fallback;
  }

  function resolveLabelNode(node) {
    if (!node) return null;
    if (node.tagName === 'LABEL') return node;
    return node.querySelector('label');
  }

  function applyTypeUi(rawType) {
    const type = normaliseType(rawType);

    typeOnlyFields.forEach((field) => {
      const typesAttr = (field.getAttribute('data-type-only') || '').trim();
      if (!typesAttr) {
        field.hidden = false;
        return;
      }
      const allowed = typesAttr.split(',').map((t) => normaliseType(t.trim())).filter(Boolean);
      field.hidden = allowed.length > 0 && !allowed.includes(type);
    });

    typeAwareLabelNodes.forEach((node) => {
      const labelEl = resolveLabelNode(node);
      if (!labelEl) return;
      if (!labelEl.dataset.labelDefault) {
        labelEl.dataset.labelDefault = labelEl.textContent.trim();
      }
      const source = node;
      const attrValue = source.getAttribute('data-label-' + type);
      const value = attrValue || labelEl.dataset.labelDefault || '';
      if (value) {
        labelEl.textContent = value;
      }
    });

    typeAwarePlaceholderNodes.forEach((node) => {
      if (!node.dataset.placeholderDefault) {
        node.dataset.placeholderDefault = node.getAttribute('placeholder') || '';
      }
      const attrValue = node.getAttribute('data-placeholder-' + type);
      const value = attrValue || node.dataset.placeholderDefault;
      node.setAttribute('placeholder', value);
    });

    typeAwareHintNodes.forEach((node) => {
      if (!node.dataset.hintDefault) {
        node.dataset.hintDefault = node.textContent.trim();
      }
      const attrValue = node.getAttribute('data-hint-' + type);
      const value = attrValue != null ? attrValue : node.dataset.hintDefault || '';
      if (value) {
        node.textContent = value;
        node.hidden = false;
      } else {
        node.textContent = '';
        node.hidden = true;
      }
    });

    clearOptionalFieldErrors();
    if (editorErrorEl && !editorErrorEl.hidden) {
      const validation = validateRequiredFields();
      updateValidationSummary(validation.missing);
    }
  }

  function escapeHtml(str){
    return String(str == null ? '' : str)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  function escapeAttr(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function slugifyId(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      || 'project';
  }

  function formatFileSize(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) {
      return '';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    const fixed = unitIndex === 0 || size >= 10 ? Math.round(size) : Math.round(size * 10) / 10;
    return fixed + ' ' + units[unitIndex];
  }

  function sanitizeFilename(name) {
    const base = String(name == null ? '' : name).split(/[\\/]/).pop() || 'file';
    return base
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      || 'file';
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      if (typeof FileReader === 'undefined') {
        reject(new Error('file_reader_unavailable'));
        return;
      }
      try {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('file_read_failed'));
        reader.onload = () => {
          if (typeof reader.result !== 'string') {
            reject(new Error('file_read_failed'));
            return;
          }
          const dataUrl = reader.result;
          const comma = dataUrl.indexOf(',');
          resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
        };
        reader.readAsDataURL(file);
      } catch (err) {
        reject(err);
      }
    });
  }

  function registerFileLibrarySlot(slot) {
    if (!slot || !slot.grid) return;
    fileLibrarySlots.push(slot);
    renderFileLibrary(slot);
  }

  function refreshFileLibraries(prefix) {
    fileLibrarySlots.forEach((slot) => {
      if (!slot) return;
      if (!prefix || slot.prefix === prefix) {
        renderFileLibrary(slot);
      }
    });
  }

  function applyUploadSelection(upload, slot) {
    if (!upload || !slot || !slot.input) return;
    const value = upload.path || upload.filename || '';
    slot.input.value = value;
    try {
      slot.input.dispatchEvent(new Event('input', { bubbles: true }));
      slot.input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (err) {}
    if (slot.status) {
      const sizeLabel = formatFileSize(upload.size);
      slot.status.textContent = sizeLabel ? `${upload.filename} (${sizeLabel})` : upload.filename;
    }
  }

  async function exportUploadRecord(upload) {
    if (!upload) return;
    const blob = await getUploadBlobData(upload);
    if (!blob) {
      alert('Datei konnte nicht geladen werden.');
      return;
    }
    if (typeof URL === 'undefined' || typeof document === 'undefined') {
      alert('Export wird von diesem Browser nicht unterstützt.');
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = upload.filename || 'upload.bin';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      if (link.parentNode) link.parentNode.removeChild(link);
      try { URL.revokeObjectURL(url); } catch (err) {}
    }, 50);
  }

  async function loadUploadPreview(upload, thumb) {
    if (!upload || !thumb) return;
    if (!upload.type || upload.type.indexOf('image/') !== 0) {
      thumb.textContent = extractExtension(upload.filename);
      return;
    }
    const cacheKey = upload.id;
    if (cacheKey && uploadPreviewUrlCache.has(cacheKey)) {
      const url = uploadPreviewUrlCache.get(cacheKey);
      const img = document.createElement('img');
      img.alt = '';
      img.src = url;
      thumb.textContent = '';
      thumb.appendChild(img);
      return;
    }
    const blob = await getUploadBlobData(upload);
    if (!blob || typeof URL === 'undefined') {
      thumb.textContent = extractExtension(upload.filename);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    if (cacheKey) {
      uploadPreviewUrlCache.set(cacheKey, objectUrl);
    }
    const img = document.createElement('img');
    img.alt = '';
    img.src = objectUrl;
    thumb.textContent = '';
    thumb.appendChild(img);
  }

  function renderFileLibrary(slot) {
    if (!slot || !slot.grid || (typeof slot.grid.isConnected !== 'undefined' && !slot.grid.isConnected)) {
      return;
    }
    const uploads = listUploadsByPrefix(slot.prefix).sort((a, b) => {
      const aTime = a && a.uploadedAt ? (new Date(a.uploadedAt).getTime() || 0) : 0;
      const bTime = b && b.uploadedAt ? (new Date(b.uploadedAt).getTime() || 0) : 0;
      return bTime - aTime;
    });
    if (slot.empty) {
      slot.empty.hidden = uploads.length > 0;
    }
    clearContainer(slot.grid);
    uploads.forEach((upload) => {
      const card = document.createElement('div');
      card.className = 'editor-media-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.addEventListener('click', () => applyUploadSelection(upload, slot));
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          applyUploadSelection(upload, slot);
        }
      });

      const thumb = document.createElement('div');
      thumb.className = 'editor-media-thumb';
      thumb.textContent = extractExtension(upload.filename);
      loadUploadPreview(upload, thumb);
      card.appendChild(thumb);

      const title = document.createElement('div');
      title.className = 'editor-media-title';
      title.textContent = upload.filename;
      card.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'editor-media-meta';
      const sizeLabel = formatFileSize(upload.size);
      if (sizeLabel) {
        const sizeEl = document.createElement('span');
        sizeEl.textContent = sizeLabel;
        meta.appendChild(sizeEl);
      }
      const dateLabel = formatUploadTimestamp(upload.uploadedAt);
      if (dateLabel) {
        const dateEl = document.createElement('small');
        dateEl.textContent = dateLabel;
        meta.appendChild(dateEl);
      }
      card.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'editor-media-actions';
      const useBtn = document.createElement('button');
      useBtn.type = 'button';
      useBtn.className = 'editor-media-btn';
      useBtn.textContent = 'Übernehmen';
      useBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        applyUploadSelection(upload, slot);
      });
      const exportBtn = document.createElement('button');
      exportBtn.type = 'button';
      exportBtn.className = 'editor-media-btn secondary';
      exportBtn.textContent = 'Export';
      exportBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        exportUploadRecord(upload);
      });
      actions.appendChild(useBtn);
      actions.appendChild(exportBtn);
      card.appendChild(actions);

      slot.grid.appendChild(card);
    });
  }

  async function uploadEditorAsset(file, options) {
    if (!file) {
      throw new Error('missing_file');
    }
    const opts = options && typeof options === 'object' ? options : {};
    const prefix = typeof opts.prefix === 'string' ? opts.prefix : '';
    const filename = typeof opts.filename === 'string' && opts.filename.trim()
      ? opts.filename.trim()
      : sanitizeFilename(file.name);
    const record = {
      id: 'upload-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      prefix,
      filename,
      path: prefix ? prefix + filename : filename,
      type: file.type || guessContentType(filename, file.type),
      size: file.size || 0,
      uploadedAt: new Date().toISOString(),
      inlineData: '',
    };
    let stored = false;
    try {
      stored = await storeUploadBlob(record.id, file);
    } catch (err) {
      stored = false;
    }
    if (!stored) {
      try {
        record.inlineData = await readFileAsBase64(file);
        stored = !!record.inlineData;
      } catch (err) {
        stored = false;
      }
    }
    if (!stored) {
      throw new Error('upload_unavailable');
    }
    if (!record.inlineData) {
      delete record.inlineData;
    }
    persistUploadMeta(record);
    refreshFileLibraries(prefix);
    return { path: record.path, size: record.size, type: record.type, local: true };
  }

  function enhanceFilePickerTargets(root) {
    const scope = root || document;
    if (!scope || typeof scope.querySelectorAll !== 'function') {
      return;
    }
    const inputs = scope.querySelectorAll('input[data-file-prefix]:not([data-file-picker-ready="1"])');
    inputs.forEach((input) => {
      input.setAttribute('data-file-picker-ready', '1');
      const prefixAttr = input.getAttribute('data-file-prefix') || '';
      const prefix = prefixAttr && /\/$/.test(prefixAttr) ? prefixAttr : (prefixAttr ? prefixAttr + '/' : '');
      const buttonLabel = input.getAttribute('data-file-button') || 'Datei auswählen';
      const helper = input.getAttribute('data-file-helper') || '';
      const accept = input.getAttribute('data-file-accept') || '*/*';

      const actions = document.createElement('div');
      actions.className = 'editor-file-actions';

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'editor-file-button';
      trigger.textContent = buttonLabel;

      const status = document.createElement('span');
      status.className = 'editor-file-selected';
      status.textContent = helper || 'Kein Upload ausgewählt.';

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = accept;
      fileInput.hidden = true;

      trigger.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) {
          status.textContent = helper || 'Kein Upload ausgewählt.';
          input.value = '';
          return;
        }
        const sanitized = sanitizeFilename(file.name);
        const fallbackPath = prefix ? prefix + sanitized : sanitized;
        status.textContent = 'Upload läuft …';
        status.title = file.name;
        trigger.disabled = true;
        try {
          const result = await uploadEditorAsset(file, { prefix, filename: sanitized });
          const finalPath = result && result.path ? result.path : fallbackPath;
          input.value = finalPath;
          try {
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          } catch (err) {}
          const sizeSource = (result && Number.isFinite(result.size)) ? result.size : file.size;
          const sizeLabel = formatFileSize(sizeSource);
          status.textContent = sizeLabel ? `${sanitized} (${sizeLabel})` : sanitized;
          status.title = file.name;
        } catch (err) {
          console.warn('Upload fehlgeschlagen:', err);
          status.textContent = 'Upload fehlgeschlagen';
          status.title = (err && err.message) || 'Upload fehlgeschlagen';
          input.value = '';
        } finally {
          trigger.disabled = false;
        }
      });

      actions.appendChild(trigger);
      actions.appendChild(status);
      actions.appendChild(fileInput);
      input.insertAdjacentElement('afterend', actions);

      const library = document.createElement('div');
      library.className = 'editor-file-library';
      const head = document.createElement('div');
      head.className = 'editor-file-library-head';
      const headTitle = document.createElement('strong');
      headTitle.textContent = prefix ? `Uploads · ${prefix}` : 'Uploads';
      const headDesc = document.createElement('span');
      headDesc.textContent = 'Klicke auf ein Asset, um den Pfad zu übernehmen.';
      head.appendChild(headTitle);
      head.appendChild(headDesc);
      const grid = document.createElement('div');
      grid.className = 'editor-file-library-grid';
      const empty = document.createElement('p');
      empty.className = 'editor-file-library-empty';
      empty.textContent = 'Noch keine Uploads gespeichert.';
      const note = document.createElement('p');
      note.className = 'editor-file-library-note';
      note.textContent = 'Uploads werden lokal gespeichert – exportiere Dateien und füge sie deinem Repository hinzu.';
      library.appendChild(head);
      library.appendChild(grid);
      library.appendChild(empty);
      library.appendChild(note);
      actions.insertAdjacentElement('afterend', library);
      registerFileLibrarySlot({ prefix, input, status, grid, empty, note, wrapper: library });
    });
  }

  const htmlDecoder = typeof document !== 'undefined' ? document.createElement('textarea') : null;

  function decodeHtml(str) {
    if (!htmlDecoder) return String(str == null ? '' : str);
    htmlDecoder.innerHTML = str;
    return htmlDecoder.value;
  }

  function readInlineText(element) {
    if (!element) return '';
    let html = element.innerHTML || '';
    html = html.replace(/<br\s*\/?\s*>/gi, '\n');
    html = html.replace(/<(strong|b)>(.*?)<\/\1>/gi, '**$2**');
    html = html.replace(/<(em|i)>(.*?)<\/\1>/gi, '*$2*');
    html = html.replace(/<code>(.*?)<\/code>/gi, '`$1`');
    html = html.replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
    html = html.replace(/<[^>]+>/g, '');
    html = html.replace(/&nbsp;/gi, ' ');
    return decodeHtml(html).replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  }

  function formatInline(text) {
    if (!text) return '';
    let html = String(text);
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
      const safeLabel = escapeHtml(label);
      const safeUrl = escapeAttr(url);
      return `<a href="${safeUrl}" target="_blank" rel="noopener">${safeLabel}</a>`;
    });
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  function createEmptyModalBody() {
    return {
      infoTitle: '',
      infoItems: [],
      tagsTitle: '',
      tags: [],
      description: [],
      steps: [],
      versions: [],
      gallery: [],
    };
  }

  function parseBadgesHtml(html) {
    if (!html) return [];
    const container = document.createElement('div');
    container.innerHTML = html;
    const badges = [];
    container.querySelectorAll('.badge').forEach((badge) => {
      const text = badge.textContent.trim();
      if (!text) return;
      const hasDot = !!badge.querySelector('.dot');
      badges.push({ text, hasDot });
    });
    return badges;
  }

  function buildBadgeHtml(badges) {
    if (!Array.isArray(badges) || !badges.length) return '';
    return badges
      .map((badge) => {
        if (!badge || !badge.text) return '';
        const safeText = escapeHtml(badge.text);
        const dot = badge.hasDot ? '<span class="dot"></span>' : '';
        const spacer = badge.hasDot ? ' ' : '';
        return `<span class="badge">${dot}${spacer}${safeText}</span>`;
      })
      .filter(Boolean)
      .join('');
  }

  const DOWNLOAD_ICON_SVG = '<svg aria-hidden="true" focusable="false" height="18" viewBox="0 0 24 24" width="18"><path d="M12 3v10m0 0l4-4m-4 4l-4-4M5 21h14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>';

  function parseHeroActionsHtml(html) {
    if (!html) return [];
    const container = document.createElement('div');
    container.innerHTML = html;
    const actions = [];
    container.querySelectorAll('a').forEach((link) => {
      const labelEnNode = link.querySelector('.lang-en');
      const labelDeNode = link.querySelector('.lang-de');
      const labelEn = labelEnNode ? labelEnNode.textContent.trim() : '';
      const labelDe = labelDeNode ? labelDeNode.textContent.trim() : '';
      const fallback = (!labelEn && !labelDe) ? link.textContent.trim() : '';
      actions.push({
        labelEn: labelEn || fallback,
        labelDe,
        href: link.getAttribute('href') || '',
        downloadFile: link.getAttribute('data-download-file') || '',
        trackId: link.getAttribute('data-track-download') || '',
        hasIcon: !!link.querySelector('svg'),
      });
    });
    return actions;
  }

  function buildHeroActionsHtml(actions, trackFallback) {
    if (!Array.isArray(actions) || !actions.length) return '';
    const fallbackTrack = trackFallback || '';
    return actions
      .map((action) => {
        if (!action || !action.href) return '';
        const href = escapeAttr(action.href);
        const downloadFile = action.downloadFile ? escapeAttr(action.downloadFile) : '';
        const trackId = action.trackId ? escapeAttr(action.trackId) : (fallbackTrack ? escapeAttr(fallbackTrack) : '');
        const hasDownload = !!downloadFile;
        const classes = 'btn primary' + (hasDownload ? ' dl' : '');
        const downloadAttr = hasDownload ? ' download' : '';
        const downloadDataAttr = hasDownload ? ` data-download-file="${downloadFile}"` : '';
        const trackAttr = trackId ? ` data-track-download="${trackId}"` : '';
        const icon = action.hasIcon ? DOWNLOAD_ICON_SVG : '';
        const labelEn = action.labelEn ? escapeHtml(action.labelEn) : '';
        const labelDe = action.labelDe ? escapeHtml(action.labelDe) : '';
        let labelHtml;
        if (labelEn || labelDe) {
          const safeEn = labelEn || labelDe;
          const safeDe = labelDe || labelEn;
          labelHtml = `<span><span class="lang-en">${safeEn}</span><span class="lang-de">${safeDe}</span></span>`;
        } else {
          labelHtml = `<span>${escapeHtml(action.label || 'Download')}</span>`;
        }
        return `<a class="${classes}" href="${href}"${downloadAttr}${downloadDataAttr}${trackAttr}>${icon}${labelHtml}</a>`;
      })
      .filter(Boolean)
      .join('');
  }

  function formatStatusLabel(status) {
    const value = String(status == null ? '' : status).trim();
    if (!value) return '';
    const key = value.toLowerCase();
    if (key === 'released') return 'Stable';
    if (key === 'beta') return 'Beta';
    if (key === 'wip') return 'WIP';
    if (key === 'planned') return 'Planned';
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function deriveDownloadFileId(path) {
    if (!path) return '';
    const cleaned = String(path).split(/[?#]/)[0];
    const parts = cleaned.split('/').filter(Boolean);
    return parts.pop() || cleaned || 'download';
  }

  function buildAutoSidebarData(type, status, category, mcVersion, tags) {
    const safeType = type === 'printing' ? 'printing' : 'datapack';
    const infoItems = [];
    if (safeType === 'datapack') {
      infoItems.push({ key: 'Game', value: 'Minecraft Java' });
    }
    infoItems.push({ key: 'Type', value: safeType === 'printing' ? '3D Print' : 'Datapack' });
    if (category) {
      infoItems.push({ key: 'Category', value: category });
    }
    if (mcVersion) {
      const label = safeType === 'printing' ? 'Print setup' : 'Minecraft';
      infoItems.push({ key: label, value: mcVersion });
    }
    const statusLabel = formatStatusLabel(status);
    if (statusLabel) {
      infoItems.push({ key: 'Status', value: statusLabel });
    }
    infoItems.push({ key: 'License', value: 'MIT • CC BY-NC-SA', url: '#license' });
    const tagList = Array.isArray(tags) ? tags.filter((tag) => tag && tag.trim()) : [];
    return {
      infoTitle: 'Project info',
      infoItems,
      tagsTitle: tagList.length ? 'Tags' : '',
      tags: tagList,
    };
  }

  function buildAutoBadgesHtml(type, status, mcVersion, tags, category) {
    const safeType = type === 'printing' ? 'printing' : 'datapack';
    const badges = [];
    const statusLabel = formatStatusLabel(status);
    if (statusLabel) {
      badges.push({ text: statusLabel, hasDot: true });
    }
    if (mcVersion) {
      const label = safeType === 'printing' ? mcVersion : `Minecraft ${mcVersion}`;
      badges.push({ text: label, hasDot: false });
    }
    if (category) {
      badges.push({ text: category, hasDot: false });
    } else if (Array.isArray(tags) && tags.length) {
      badges.push({ text: tags[0], hasDot: false });
    }
    return buildBadgeHtml(badges);
  }

  function buildAutoHeroActionsHtml(downloadUrl, projectId) {
    const href = (downloadUrl || '').trim();
    if (!href) return '';
    const fallbackId = projectId || deriveDownloadFileId(href);
    const action = {
      href,
      downloadFile: deriveDownloadFileId(href),
      trackId: fallbackId,
      labelEn: 'Download',
      labelDe: 'Herunterladen',
      hasIcon: true,
    };
    return buildHeroActionsHtml([action], fallbackId);
  }

  function formatUpdatedLabel(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (!Number.isFinite(date.getTime())) {
      return '';
    }
    try {
      return date.toLocaleString('en-US', { month: 'short', year: 'numeric' });
    } catch (err) {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
    }
  }

  function buildAutoStatsHtml(options) {
    const opts = options || {};
    const versionValue = opts.latestVersion ? escapeHtml(opts.latestVersion) : '—';
    const updatedLabel = formatUpdatedLabel(opts.updatedAt) || '—';
    const projectAttr = opts.projectId ? ` data-download-count="${escapeAttr(opts.projectId)}"` : '';
    const sizeAttr = opts.downloadUrl ? ` data-download-size="${escapeAttr(opts.downloadUrl)}"` : '';
    const stats = [];
    stats.push(`<div class="stat"><div class="label">Version</div><div class="value">${versionValue}</div></div>`);
    stats.push(`<div class="stat"><div class="label">Last updated</div><div class="value">${escapeHtml(updatedLabel)}</div></div>`);
    stats.push(`<div class="stat"><div class="label"><span class="lang-en">Downloads</span><span class="lang-de">Downloads</span></div><div class="value"${projectAttr}>—</div></div>`);
    stats.push(`<div class="stat"><div class="label">Size</div><div class="value"${sizeAttr}>—</div></div>`);
    return stats.join('');
  }

  function parseStatsHtml(html) {
    if (!html) return [];
    const container = document.createElement('div');
    container.innerHTML = html;
    const stats = [];
    container.querySelectorAll('.stat').forEach((stat) => {
      const labelEl = stat.querySelector('.label');
      const valueEl = stat.querySelector('.value');
      const labelEnNode = labelEl ? labelEl.querySelector('.lang-en') : null;
      const labelDeNode = labelEl ? labelEl.querySelector('.lang-de') : null;
      const labelEn = labelEnNode ? labelEnNode.textContent.trim() : '';
      const labelDe = labelDeNode ? labelDeNode.textContent.trim() : '';
      const label = (!labelEn && !labelDe && labelEl) ? labelEl.textContent.trim() : '';
      const value = valueEl ? valueEl.textContent.trim() : '';
      stats.push({ labelEn, labelDe, label, value });
    });
    return stats;
  }

  function buildStatsHtml(stats) {
    if (!Array.isArray(stats) || !stats.length) return '';
    return stats
      .map((stat) => {
        if (!stat || !(stat.value || stat.label || stat.labelEn || stat.labelDe)) return '';
        const valueHtml = escapeHtml(stat.value || '');
        let labelHtml = '';
        const safeLabelEn = stat.labelEn ? escapeHtml(stat.labelEn) : '';
        const safeLabelDe = stat.labelDe ? escapeHtml(stat.labelDe) : '';
        if (safeLabelEn || safeLabelDe) {
          const en = safeLabelEn || safeLabelDe;
          const de = safeLabelDe || safeLabelEn;
          labelHtml = `<span class="lang-en">${en}</span><span class="lang-de">${de}</span>`;
        } else if (stat.label) {
          labelHtml = escapeHtml(stat.label);
        }
        return `<div class="stat">${labelHtml ? `<div class="label">${labelHtml}</div>` : ''}<div class="value">${valueHtml}</div></div>`;
      })
      .filter(Boolean)
      .join('');
  }

  function parseModalBodyContent(html) {
    const data = createEmptyModalBody();
    if (!html || !html.trim()) return data;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const sidebar = wrapper.querySelector('.sidebar');
    if (sidebar) {
      const infoCard = sidebar.querySelector('.info-card');
      if (infoCard) {
        const titleEl = infoCard.querySelector('h4');
        data.infoTitle = titleEl ? titleEl.textContent.trim() : '';
        const items = infoCard.querySelectorAll('.info-list li');
        items.forEach((li) => {
          const spans = li.querySelectorAll('span');
          if (!spans.length) return;
          const keyEl = li.querySelector('.k') || spans[0];
          const valueEl = spans[spans.length - 1];
          const link = valueEl ? valueEl.querySelector('a') : null;
          const key = keyEl ? keyEl.textContent.trim() : '';
          const value = link ? link.textContent.trim() : (valueEl ? valueEl.textContent.trim() : '');
          const url = link ? link.getAttribute('href') || '' : '';
          const newTab = link ? link.getAttribute('target') === '_blank' : false;
          if (!key && !value) return;
          data.infoItems.push({ key, value, url, newTab });
        });
      }
      const tagsWrap = sidebar.querySelector('.info-tags');
      if (tagsWrap) {
        const card = tagsWrap.closest('.info-card');
        if (card) {
          const titleEl = card.querySelector('h4');
          data.tagsTitle = titleEl ? titleEl.textContent.trim() : '';
        }
        tagsWrap.querySelectorAll('.chip').forEach((chip) => {
          const text = chip.textContent.trim();
          if (text) data.tags.push(text);
        });
      }
    }

    const descriptionPanel = wrapper.querySelector('[role="tabpanel"][id$="-description"]');
    if (descriptionPanel) {
      descriptionPanel.querySelectorAll('p').forEach((p) => {
        const text = readInlineText(p);
        if (text) data.description.push(text);
      });
    }

    const installationPanel = wrapper.querySelector('[role="tabpanel"][id$="-installation"]');
    if (installationPanel) {
      installationPanel.querySelectorAll('.step').forEach((step) => {
        const body = step.querySelector('div:last-child');
        const text = readInlineText(body || step);
        if (text) data.steps.push(text);
      });
    }

    const releaseEntries = wrapper.querySelectorAll('.release-log .release-log-entry');
    if (releaseEntries.length) {
      releaseEntries.forEach((entry) => {
        const release = readInlineText(entry.querySelector('.release-version'));
        const minecraft = readInlineText(entry.querySelector('.release-mc'));
        const date = readInlineText(entry.querySelector('.release-date'));
        const notes = readInlineText(entry.querySelector('.release-log-notes'));
        const link = entry.querySelector('a');
        const labelEnNode = link ? link.querySelector('.lang-en') : null;
        const labelDeNode = link ? link.querySelector('.lang-de') : null;
        const labelEn = labelEnNode ? labelEnNode.textContent.trim() : '';
        const labelDe = labelDeNode ? labelDeNode.textContent.trim() : '';
        const label = (!labelEn && !labelDe && link) ? link.textContent.trim() : '';
        const url = link ? link.getAttribute('href') || '' : '';
        const downloadFile = link ? link.getAttribute('data-download-file') || '' : '';
        const trackId = link ? link.getAttribute('data-track-download') || '' : '';
        if (!(release || minecraft || date || url || downloadFile || notes)) return;
        data.versions.push({ release, minecraft, date, url, labelEn, labelDe, label, downloadFile, trackId, notes });
      });
    }

    const legacyChangelog = [];

    const versionsPanel = wrapper.querySelector('[role="tabpanel"][id$="-versions"]');
    if (!data.versions.length && versionsPanel) {
      const rows = versionsPanel.querySelectorAll('tbody tr');
      rows.forEach((tr) => {
        const cells = tr.querySelectorAll('td');
        if (!cells.length) return;
        const release = cells[0] ? cells[0].textContent.trim() : '';
        const minecraft = cells[1] ? cells[1].textContent.trim() : '';
        const date = cells[2] ? cells[2].textContent.trim() : '';
        const notesEl = cells[3] ? cells[3].querySelector('.version-file-note') : null;
        const link = cells[3] ? cells[3].querySelector('a') : null;
        const labelEnNode = link ? link.querySelector('.lang-en') : null;
        const labelDeNode = link ? link.querySelector('.lang-de') : null;
        const labelEn = labelEnNode ? labelEnNode.textContent.trim() : '';
        const labelDe = labelDeNode ? labelDeNode.textContent.trim() : '';
        const label = (!labelEn && !labelDe && link) ? link.textContent.trim() : '';
        const url = link ? link.getAttribute('href') || '' : '';
        const downloadFile = link ? link.getAttribute('data-download-file') || '' : '';
        const trackId = link ? link.getAttribute('data-track-download') || '' : '';
        const notes = notesEl ? notesEl.textContent.trim() : '';
        if (!(release || minecraft || date || url || labelEn || labelDe || label || notes)) return;
        data.versions.push({ release, minecraft, date, url, labelEn, labelDe, label, downloadFile, trackId, notes });
      });
    }

    const changelogPanel = wrapper.querySelector('[role="tabpanel"][id$="-changelog"]');
    if (changelogPanel) {
      changelogPanel.querySelectorAll('p').forEach((p) => {
        const clone = p.cloneNode(true);
        const strong = clone.querySelector('strong, b');
        let title = '';
        if (strong) {
          title = strong.textContent.trim();
          strong.remove();
        }
        let text = readInlineText(clone);
        text = text.replace(/^[-–—]\s*/, '').trim();
        if (title || text) {
          legacyChangelog.push({ title, details: text });
        }
      });
    }

    if (!data.versions.length && legacyChangelog.length) {
      legacyChangelog.forEach((entry) => {
        data.versions.push({
          release: entry.title || '',
          minecraft: '',
          date: '',
          url: '',
          labelEn: '',
          labelDe: '',
          label: '',
          downloadFile: '',
          trackId: '',
          notes: entry.details || '',
        });
      });
    }

    const galleryPanel = wrapper.querySelector('[role="tabpanel"][id$="-gallery"]');
    if (galleryPanel) {
      galleryPanel.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src') || '';
        const alt = img.getAttribute('alt') || '';
        if (src) data.gallery.push({ src, alt });
      });
    }

    return data;
  }

  function buildModalBodyHtml(modalId, data, trackFallback) {
    const bodyData = data || createEmptyModalBody();
    const safeId = modalId || 'project-modal';

    const infoItemsHtml = (bodyData.infoItems || [])
      .map((item) => {
        if (!item || !(item.key || item.value)) return '';
        const key = escapeHtml(item.key || '');
        const valueText = escapeHtml(item.value || '');
        let valueHtml = valueText;
        if (item.url) {
          const url = escapeAttr(item.url);
          const newTab = item.newTab ? ' target="_blank" rel="noopener"' : '';
          valueHtml = `<a href="${url}"${newTab}>${valueText}</a>`;
        }
        return `<li><span class="k">${key}</span><span>${valueHtml}</span></li>`;
      })
      .filter(Boolean)
      .join('');

    const infoCardHtml = (bodyData.infoTitle || infoItemsHtml)
      ? `<div class="info-card">${bodyData.infoTitle ? `<h4>${escapeHtml(bodyData.infoTitle)}</h4>` : ''}${infoItemsHtml ? `<ul class="info-list">${infoItemsHtml}</ul>` : ''}</div>`
      : '';

    const tagsHtml = (bodyData.tags || [])
      .map((tag) => tag ? `<span class="chip">${escapeHtml(tag)}</span>` : '')
      .filter(Boolean)
      .join('');

    const tagsCardHtml = (bodyData.tagsTitle || tagsHtml)
      ? `<div class="info-card">${bodyData.tagsTitle ? `<h4>${escapeHtml(bodyData.tagsTitle)}</h4>` : ''}${tagsHtml ? `<div class="info-tags">${tagsHtml}</div>` : ''}</div>`
      : '';

    const asideHtml = (infoCardHtml || tagsCardHtml)
      ? `<aside class="sidebar">${infoCardHtml}${tagsCardHtml}</aside>`
      : '<aside class="sidebar"></aside>';

    const descriptionHtml = (bodyData.description || [])
      .map((paragraph) => paragraph ? `<p>${formatInline(paragraph)}</p>` : '')
      .filter(Boolean)
      .join('');

    const stepsHtml = (bodyData.steps || [])
      .map((step) => step ? `<div class="step"><div></div><div>${formatInline(step)}</div></div>` : '')
      .filter(Boolean)
      .join('');

    const releaseLogItems = (bodyData.versions || [])
      .map((entry) => {
        if (!entry || !(entry.release || entry.notes || entry.url || entry.downloadFile)) return '';
        const release = escapeHtml(entry.release || '');
        const mcLabel = entry.minecraft ? `<span class="release-mc">${escapeHtml(entry.minecraft)}</span>` : '';
        const dateLabel = entry.date ? `<span class="release-date">${escapeHtml(entry.date)}</span>` : '';
        const meta = (mcLabel || dateLabel) ? `<div class="release-meta">${mcLabel}${dateLabel}</div>` : '';
        const notes = entry.notes ? `<div class="release-log-notes">${formatInline(entry.notes)}</div>` : '';
        const downloadFileValue = entry.downloadFile ? String(entry.downloadFile) : '';
        const hrefSource = entry.url || downloadFileValue || '';
        let downloadHtml = '';
        if (hrefSource) {
          const href = escapeAttr(hrefSource);
          const downloadFile = downloadFileValue ? escapeAttr(downloadFileValue) : '';
          const trackId = entry.trackId ? escapeAttr(entry.trackId) : (trackFallback ? escapeAttr(trackFallback) : '');
          const labelEn = entry.labelEn ? escapeHtml(entry.labelEn) : '';
          const labelDe = entry.labelDe ? escapeHtml(entry.labelDe) : '';
          const fallbackLabel = entry.label ? escapeHtml(entry.label) : '';
          let labelHtml;
          if (labelEn || labelDe) {
            const en = labelEn || labelDe;
            const de = labelDe || labelEn;
            labelHtml = `<span class="lang-en">${en}</span><span class="lang-de">${de}</span>`;
          } else {
            labelHtml = fallbackLabel || '<span class="lang-en">Download</span><span class="lang-de">Herunterladen</span>';
          }
          const downloadAttr = downloadFile ? ' download' : '';
          const downloadData = downloadFile ? ` data-download-file="${downloadFile}"` : '';
          const trackAttr = trackId ? ` data-track-download="${trackId}"` : '';
          const fileNote = downloadFileValue ? `<span class="release-file-note">${escapeHtml(downloadFileValue)}</span>` : '';
          downloadHtml = `<div class="release-log-download"><a class="btn primary dl" href="${href}"${downloadAttr}${downloadData}${trackAttr}>${labelHtml}</a>${fileNote}</div>`;
        }
        return `<li class="release-log-entry"><div class="release-log-header"><div class="release-version">${release}</div>${meta}</div>${notes}${downloadHtml}</li>`;
      })
      .filter(Boolean)
      .join('');

    const galleryHtml = (bodyData.gallery || [])
      .map((image) => {
        if (!image || !image.src) return '';
        const src = escapeAttr(image.src);
        const alt = escapeAttr(image.alt || '');
        return `<img alt="${alt}" loading="lazy" src="${src}"/>`;
      })
      .filter(Boolean)
      .join('');

    const navButtons = [];
    navButtons.push(`<button aria-selected="true" class="active" data-tab="description" role="tab"><span class="lang-en">Description</span><span class="lang-de">Beschreibung</span></button>`);
    if (stepsHtml) {
      navButtons.push(`<button aria-selected="false" data-tab="installation" role="tab"><span class="lang-en">Installation</span><span class="lang-de">Installation</span></button>`);
    }
    if (galleryHtml) {
      navButtons.push(`<button aria-selected="false" data-tab="gallery" role="tab"><span class="lang-en">Gallery</span><span class="lang-de">Galerie</span></button>`);
    }
    if (releaseLogItems) {
      navButtons.push(`<button aria-selected="false" data-tab="releases" role="tab"><span class="lang-en">Release log</span><span class="lang-de">Versionsverlauf</span></button>`);
    }

    const navHtml = `<nav aria-label="Modal Tabs" class="tabs" role="tablist">${navButtons.join('')}</nav>`;

    const panels = [];
    panels.push(`<div class="active prose" id="${safeId}-description" role="tabpanel">${descriptionHtml || ''}</div>`);
    if (stepsHtml) {
      panels.push(`<div class="prose" id="${safeId}-installation" role="tabpanel"><div class="steps">${stepsHtml}</div></div>`);
    }
    if (releaseLogItems) {
      panels.push(`<div id="${safeId}-releases" role="tabpanel"><ol class="release-log">${releaseLogItems}</ol></div>`);
    }
    if (galleryHtml) {
      panels.push(`<div id="${safeId}-gallery" role="tabpanel"><div class="gallery">${galleryHtml}</div></div>`);
    }

    const hasContent = (infoCardHtml || tagsCardHtml || descriptionHtml || stepsHtml || releaseLogItems || galleryHtml);
    if (!hasContent) {
      return '';
    }

    const contentHtml = `<section class="content">${navHtml}<div class="tabpanels">${panels.join('')}</div></section>`;
    return `${asideHtml}${contentHtml}`;
  }

  function clearContainer(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function resetVersionSuggestionCounter(nextValue) {
    const safe = Number.isFinite(nextValue) ? nextValue : 1;
    versionAutoNumber = Math.max(1, safe);
  }

  function getNextVersionSuggestion() {
    const label = 'v' + String(versionAutoNumber).padStart(2, '0');
    versionAutoNumber += 1;
    return label;
  }

  function readVersionDrafts() {
    if (!modalVersionsList) return [];
    return Array.from(modalVersionsList.querySelectorAll('.editor-repeat-row'))
      .map((row) => {
        const release = (row.querySelector('[data-field="version-release"]') || {}).value || '';
        const minecraft = (row.querySelector('[data-field="version-mc"]') || {}).value || '';
        const date = (row.querySelector('[data-field="version-date"]') || {}).value || '';
        const notes = (row.querySelector('[data-field="version-notes"]') || {}).value || '';
        return {
          release: release.trim(),
          minecraft: minecraft.trim(),
          date: date.trim(),
          notes: notes.trim(),
        };
      })
      .filter((entry) => entry && (entry.release || entry.minecraft || entry.date || entry.notes));
  }

  function renderVersionChain() {
    if (!versionChainListEl) return;
    const drafts = readVersionDrafts();
    clearContainer(versionChainListEl);
    if (!drafts.length) {
      const empty = document.createElement('p');
      empty.className = 'editor-file-library-empty';
      empty.textContent = 'Noch keine Versionen erfasst.';
      versionChainListEl.appendChild(empty);
      return;
    }
    drafts.forEach((entry, index) => {
      const node = document.createElement('div');
      node.className = 'editor-version-node' + (index === 0 ? ' head' : '');
      const missingName = !entry.release;
      const missingNotes = !entry.notes;
      if (missingName || missingNotes) {
        node.classList.add('invalid');
      }
      const body = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = entry.release || 'Version ohne Namen';
      body.appendChild(title);
      const metaParts = [];
      if (entry.date) metaParts.push(entry.date);
      if (entry.minecraft) metaParts.push(entry.minecraft);
      if (metaParts.length) {
        const meta = document.createElement('small');
        meta.textContent = metaParts.join(' • ');
        body.appendChild(meta);
      }
      const note = document.createElement('p');
      note.textContent = entry.notes || 'Bitte kurzen Changelog eintragen.';
      body.appendChild(note);
      node.appendChild(body);
      versionChainListEl.appendChild(node);
    });
  }

  function handleVersionRowsMutated() {
    const count = modalVersionsList ? modalVersionsList.querySelectorAll('.editor-repeat-row').length : 0;
    resetVersionSuggestionCounter(count + 1);
    renderVersionChain();
  }

  function ensureRow(container, addFn) {
    if (!container) return;
    if (!container.querySelector('.editor-repeat-row')) {
      addFn({});
    }
  }

  function makeRemoveHandler(container, addFn) {
    return function handleRemove(row) {
      if (row && row.remove) row.remove();
      ensureRow(container, addFn);
      if (container === modalVersionsList) {
        handleVersionRowsMutated();
      }
    };
  }

  function addDescriptionRow(data = {}) {
    if (!modalDescriptionList) return;
    const row = document.createElement('div');
    row.className = 'editor-repeat-row';
    row.innerHTML = `
      <textarea data-field="text" placeholder="Absatz-Text"></textarea>
      <button type="button" class="editor-repeat-remove" title="Entfernen">×</button>
    `;
    const textarea = row.querySelector('[data-field="text"]');
    if (textarea) {
      const value = typeof data === 'string' ? data : (data.text || '');
      textarea.value = value;
    }
    row.querySelector('.editor-repeat-remove').addEventListener('click', () => makeRemoveHandler(modalDescriptionList, addDescriptionRow)(row));
    modalDescriptionList.appendChild(row);
  }

  function setDescriptionRows(items) {
    if (!modalDescriptionList) return;
    clearContainer(modalDescriptionList);
    const list = Array.isArray(items) && items.length ? items : [''];
    list.forEach((item) => addDescriptionRow(item));
  }

  function collectDescriptionRows() {
    if (!modalDescriptionList) return [];
    return Array.from(modalDescriptionList.querySelectorAll('.editor-repeat-row'))
      .map((row) => {
        const textarea = row.querySelector('[data-field="text"]');
        if (!textarea) return null;
        const value = (textarea.value || '').trim();
        return value ? value : null;
      })
      .filter(Boolean);
  }

  function addVersionRow(data = {}) {
    if (!modalVersionsList) return;
    const row = document.createElement('div');
    row.className = 'editor-repeat-row editor-version-row';
    row.innerHTML = `
      <div class="editor-version-grid">
        <label>Version
          <input type="text" data-field="version-release" placeholder="v1.0.0">
        </label>
        <label>Minecraft / Setup
          <input type="text" data-field="version-mc" placeholder="1.21.x oder PLA 0.2mm">
        </label>
        <label>Datum
          <input type="text" data-field="version-date" placeholder="2025-09-10">
        </label>
      </div>
      <div class="editor-version-downloads">
        <div>
          <label>Download-Datei (Upload)</label>
          <input type="text" data-field="version-file" placeholder="downloads/mein-projekt.zip">
          <small>Wähle eine ZIP/STL-Datei oder gib einen Pfad ein.</small>
        </div>
        <div>
          <label>Externe URL / Mirror</label>
          <input type="text" data-field="version-url" placeholder="https://...">
          <small>Optional – überschreibt die lokale Datei.</small>
        </div>
        <div>
          <label>Download-Text (EN)</label>
          <input type="text" data-field="version-label-en" placeholder="Download">
        </div>
        <div>
          <label>Download-Text (DE)</label>
          <input type="text" data-field="version-label-de" placeholder="Herunterladen">
        </div>
        <div>
          <label>Tracking-ID</label>
          <input type="text" data-field="version-track" placeholder="z. B. jetpack-datapack">
        </div>
      </div>
      <div>
        <label class="editor-version-notes-label">Änderungen / Highlights</label>
        <textarea class="editor-version-notes" data-field="version-notes" placeholder="Kurzbeschreibung der Version"></textarea>
      </div>
      <button type="button" class="editor-repeat-remove" title="Entfernen">×</button>
    `;
    const releaseInput = row.querySelector('[data-field="version-release"]');
    if (releaseInput) {
      releaseInput.value = data.release || getNextVersionSuggestion();
    }
    row.querySelector('[data-field="version-mc"]').value = data.minecraft || '';
    row.querySelector('[data-field="version-date"]').value = data.date || '';
    row.querySelector('[data-field="version-url"]').value = data.url || '';
    row.querySelector('[data-field="version-label-en"]').value = data.labelEn || '';
    row.querySelector('[data-field="version-label-de"]').value = data.labelDe || '';
    row.querySelector('[data-field="version-file"]').value = data.downloadFile || '';
    row.querySelector('[data-field="version-track"]').value = data.trackId || '';
    row.querySelector('[data-field="version-notes"]').value = data.notes || data.details || '';
    row.querySelector('.editor-repeat-remove').addEventListener('click', () => makeRemoveHandler(modalVersionsList, addVersionRow)(row));
    const versionFileInput = row.querySelector('[data-field="version-file"]');
    if (versionFileInput) {
      versionFileInput.setAttribute('data-file-prefix', 'downloads/');
      versionFileInput.setAttribute('data-file-accept', '.zip,.mcpack,.mcaddon,.rar,.stl,.obj,.gcode,.3mf,.zip');
      versionFileInput.setAttribute('data-file-button', 'Datei auswählen');
      versionFileInput.setAttribute('data-file-helper', 'Download-Datei auswählen oder Pfad einfügen.');
    }
    enhanceFilePickerTargets(row);
    modalVersionsList.appendChild(row);
    handleVersionRowsMutated();
  }

  function setVersionRows(items) {
    if (!modalVersionsList) return;
    clearContainer(modalVersionsList);
    const list = Array.isArray(items) && items.length ? items : [{}];
    resetVersionSuggestionCounter(list.length + 1);
    list.forEach((item) => addVersionRow(item));
  }

  function collectVersionRows() {
    if (!modalVersionsList) return [];
    return Array.from(modalVersionsList.querySelectorAll('.editor-repeat-row'))
      .map((row) => {
        const release = (row.querySelector('[data-field="version-release"]') || {}).value || '';
        const minecraft = (row.querySelector('[data-field="version-mc"]') || {}).value || '';
        const date = (row.querySelector('[data-field="version-date"]') || {}).value || '';
        const url = (row.querySelector('[data-field="version-url"]') || {}).value || '';
        const labelEn = (row.querySelector('[data-field="version-label-en"]') || {}).value || '';
        const labelDe = (row.querySelector('[data-field="version-label-de"]') || {}).value || '';
        const downloadFile = (row.querySelector('[data-field="version-file"]') || {}).value || '';
        const trackId = (row.querySelector('[data-field="version-track"]') || {}).value || '';
        const notes = (row.querySelector('[data-field="version-notes"]') || {}).value || '';
        if (!(release.trim() || minecraft.trim() || date.trim() || url.trim() || downloadFile.trim() || notes.trim())) return null;
        return {
          release: release.trim(),
          minecraft: minecraft.trim(),
          date: date.trim(),
          url: url.trim(),
          labelEn: labelEn.trim(),
          labelDe: labelDe.trim(),
          downloadFile: downloadFile.trim(),
          trackId: trackId.trim(),
          notes: notes.trim(),
        };
      })
      .filter(Boolean);
  }

  function validateVersionEntries(entries) {
    if (!Array.isArray(entries) || !entries.length) {
      return [];
    }
    const issues = [];
    entries.forEach((entry, index) => {
      if (!entry) return;
      if (!entry.release) {
        issues.push(`Version ${index + 1}: Name fehlt`);
      }
      if (!entry.notes) {
        issues.push(`Version ${index + 1}: Changelog fehlt`);
      }
    });
    return issues;
  }

  function addGalleryRow(data = {}) {
    if (!modalGalleryList) return;
    const row = document.createElement('div');
    row.className = 'editor-repeat-row';
    row.innerHTML = `
      <input type="text" data-field="gallery-src" placeholder="Bild-URL">
      <input type="text" data-field="gallery-alt" placeholder="Alt-Text">
      <button type="button" class="editor-repeat-remove" title="Entfernen">×</button>
    `;
    row.querySelector('[data-field="gallery-src"]').value = data.src || '';
    row.querySelector('[data-field="gallery-alt"]').value = data.alt || '';
    row.querySelector('.editor-repeat-remove').addEventListener('click', () => makeRemoveHandler(modalGalleryList, addGalleryRow)(row));
    const gallerySrcInput = row.querySelector('[data-field="gallery-src"]');
    if (gallerySrcInput) {
      gallerySrcInput.setAttribute('data-file-prefix', 'assets/img/gallery/');
      gallerySrcInput.setAttribute('data-file-accept', 'image/*');
      gallerySrcInput.setAttribute('data-file-button', 'Bild auswählen');
      gallerySrcInput.setAttribute('data-file-helper', 'Bilddatei auswählen oder URL einfügen.');
    }
    enhanceFilePickerTargets(row);
    modalGalleryList.appendChild(row);
  }

  function setGalleryRows(items) {
    if (!modalGalleryList) return;
    clearContainer(modalGalleryList);
    const list = Array.isArray(items) && items.length ? items : [{}];
    list.forEach((item) => addGalleryRow(item));
  }

  function collectGalleryRows() {
    if (!modalGalleryList) return [];
    return Array.from(modalGalleryList.querySelectorAll('.editor-repeat-row'))
      .map((row) => {
        const src = (row.querySelector('[data-field="gallery-src"]') || {}).value || '';
        const alt = (row.querySelector('[data-field="gallery-alt"]') || {}).value || '';
        if (!src.trim()) return null;
        return { src: src.trim(), alt: alt.trim() };
      })
      .filter(Boolean);
  }

  function resetModalUi() {
    setDescriptionRows([]);
    setVersionRows([]);
    setGalleryRows([]);
    if (modalBodyInput) modalBodyInput.value = '';
  }

  function applyModalBodyData(data) {
    const bodyData = data || createEmptyModalBody();
    setDescriptionRows(bodyData.description || []);
    setVersionRows(bodyData.versions || []);
    setGalleryRows(bodyData.gallery || []);
  }

  function buildFallbackModalBodyData(project) {
    const record = project || {};
    const safeType = normaliseType(record.type);
    const tags = Array.isArray(record.tags) ? record.tags : [];
    const sidebar = buildAutoSidebarData(safeType, record.status, record.category, record.mcVersion, tags);
    const pitch = typeof record.shortDescription === 'string' ? record.shortDescription.trim() : '';
    return {
      infoTitle: sidebar.infoTitle,
      infoItems: sidebar.infoItems,
      tagsTitle: sidebar.tagsTitle,
      tags: sidebar.tags,
      description: pitch ? [pitch] : [],
      steps: [],
      versions: [],
      gallery: [],
    };
  }

  function populateModalUi(project) {
    const { modalId } = getModalRef(project);
    currentModalId = modalId || '';
    const defaults = modalDefaults.get(modalId) || { hero: '', body: '' };
    const bodyHtml = (project && typeof project.modalBody === 'string' && project.modalBody.trim()) ? project.modalBody : defaults.body;
    const parsed = parseModalBodyContent(bodyHtml || '');
    const fallback = buildFallbackModalBodyData(project);
    const data = { ...fallback };
    if (parsed) {
      if (typeof parsed.infoTitle === 'string' && parsed.infoTitle.trim()) {
        data.infoTitle = parsed.infoTitle;
      }
      if (Array.isArray(parsed.infoItems) && parsed.infoItems.length) {
        data.infoItems = parsed.infoItems;
      }
      if (typeof parsed.tagsTitle === 'string' && parsed.tagsTitle.trim()) {
        data.tagsTitle = parsed.tagsTitle;
      }
      if (Array.isArray(parsed.tags) && parsed.tags.length) {
        data.tags = parsed.tags;
      }
      if (Array.isArray(parsed.description) && parsed.description.length) {
        data.description = parsed.description;
      }
      if (Array.isArray(parsed.steps) && parsed.steps.length) {
        data.steps = parsed.steps;
      }
      if (Array.isArray(parsed.versions) && parsed.versions.length) {
        data.versions = parsed.versions;
      }
      if (Array.isArray(parsed.gallery) && parsed.gallery.length) {
        data.gallery = parsed.gallery;
      }
    }
    if (modalBodyInput) modalBodyInput.value = bodyHtml || '';
    applyModalBodyData(data);
  }

  function collectModalBodyData() {
    return {
      description: collectDescriptionRows(),
      versions: collectVersionRows(),
      gallery: collectGalleryRows(),
    };
  }

  function serialiseModalUi(context) {
    const ctx = context && typeof context === 'object' ? context : {};
    const safeType = normaliseType(ctx.type || 'datapack');
    const fallbackId = ctx.projectId && ctx.projectId.trim() ? ctx.projectId.trim() : slugifyId(titleInput ? titleInput.value : '');
    const modalId = currentModalId || `${safeType === 'printing' ? 'pr' : 'dp'}-${fallbackId || 'project'}`;
    const tags = Array.isArray(ctx.tags) ? ctx.tags : [];
    const category = (ctx.category || '').trim();
    const status = ctx.status || '';
    const mcVersion = ctx.mcVersion || '';
    const downloadFile = (ctx.downloadFile || '').trim();
    const latestVersionEntry = Array.isArray(bodyData.versions) && bodyData.versions.length
      ? bodyData.versions[0]
      : null;
    const derivedDownload = downloadFile
      || (latestVersionEntry ? (latestVersionEntry.url || latestVersionEntry.downloadFile || '') : '');
    const shortDescription = typeof ctx.shortDescription === 'string'
      ? ctx.shortDescription.trim()
      : (shortInput ? (shortInput.value || '').trim() : '');
    const fallbackRecord = {
      type: safeType,
      status,
      category,
      mcVersion,
      tags,
      shortDescription,
    };
    const fallbackBody = buildFallbackModalBodyData(fallbackRecord);
    const contentData = collectModalBodyData();
    const bodyData = { ...fallbackBody };
    if (contentData) {
      if (Array.isArray(contentData.description) && contentData.description.length) {
        bodyData.description = contentData.description;
      }
      if (Array.isArray(contentData.versions) && contentData.versions.length) {
        bodyData.versions = contentData.versions;
      }
      if (Array.isArray(contentData.gallery) && contentData.gallery.length) {
        bodyData.gallery = contentData.gallery;
      }
    }
    const badgesHtml = buildAutoBadgesHtml(safeType, status, mcVersion, tags, category);
    const actionsHtml = buildAutoHeroActionsHtml(derivedDownload, fallbackId);
    const statsHtml = buildAutoStatsHtml({
      latestVersion: latestVersionEntry ? latestVersionEntry.release : '',
      updatedAt: new Date().toISOString(),
      projectId: fallbackId,
      downloadUrl: derivedDownload,
    });
    const bodyHtml = buildModalBodyHtml(modalId, bodyData, fallbackId);
    if (modalBodyInput) modalBodyInput.value = bodyHtml;
    return {
      body: bodyHtml,
      badges: badgesHtml,
      actions: actionsHtml,
      stats: statsHtml,
      modalId,
    };
  }

  function clearGrid(grid) {
    if (!grid) return;
    while (grid.firstChild) grid.removeChild(grid.firstChild);
  }

  function attachCardEditorTools(cardEl, project){
    const tools = document.createElement('div');
    tools.className = 'editor-card-tools';
    tools.innerHTML = '<button type="button" class="editor-card-btn editor-card-btn--edit" title="Bearbeiten">✏️</button>' +
                      '<button type="button" class="editor-card-btn editor-card-btn--delete" title="Löschen">🗑️</button>';
    cardEl.appendChild(tools);
    const editBtn = tools.querySelector('.editor-card-btn--edit');
    const delBtn = tools.querySelector('.editor-card-btn--delete');
    editBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      openEditorForEdit(project);
    });
    delBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      handleDeleteProject(project);
    });
  }

  function createAddCard(type){
    const isDatapack = type === 'datapack';
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'editor-add-card';
    card.setAttribute('data-editor-add-type', type);
    card.innerHTML =
      '<div class="thumb">＋</div>' +
      '<div class="meta">' +
        '<div class="title">' + (isDatapack ? 'Neues Datapack hinzufügen' : 'Neuen 3D-Print hinzufügen') + '</div>' +
        '<div class="quick">' + (isDatapack
          ? 'Lege ein neues Datapack mit Titel, Version und Download an.'
          : 'Füge ein neues 3D-Print-Projekt mit Vorschau hinzu.') + '</div>' +
      '</div>';
    card.addEventListener('click', ()=> {
      openEditorForCreate(type);
    });
    return card;
  }

  function renderProjectCard(project){
    const type = normaliseType(project.type);
    const isDatapack = type === 'datapack';
    const grid = isDatapack ? dpGrid : prGrid;
    if (!grid) return;

    const card = document.createElement('article');
    card.className = isDatapack ? 'item card dp-card' : 'item card pr-card';
    if (project.id) {
      card.setAttribute('data-project-id', project.id);
    }
    card.setAttribute('data-project-type', type);
    const category = project.category || '';
    const tags = Array.isArray(project.tags) ? project.tags : [];
    const subcats = category || (tags.join(',') || '');
    if (subcats) card.setAttribute('data-subcats', subcats);

    let modalInfo = getModalRef(project);
    if (!modalInfo.modalId || !modalInfo.modal) {
      modalInfo = ensureDynamicProjectModal(project);
    }
    const modalId = modalInfo.modalId;
    if (modalId) {
      card.dataset.modalTarget = modalId;
      card.setAttribute('aria-controls', modalId);
      card.setAttribute('aria-expanded', 'false');
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
    }

    const imgSrc = project.image || 'assets/img/logo.jpg';
    const chipA = project.mcVersion || (isDatapack ? '1.21.x' : '');
    const chipB = (tags && tags.length) ? tags[0] : (project.status || '');

    let chipsHtml = '';
    if (chipA) chipsHtml += '<span class="chip">' + escapeHtml(chipA) + '</span>';
    if (chipB) chipsHtml += '<span class="chip">' + escapeHtml(chipB) + '</span>';

    card.innerHTML =
      '<div class="thumb"><img alt="' + escapeHtml(project.title) + ' cover" src="' + escapeHtml(imgSrc) + '" loading="lazy"/></div>' +
      '<div class="meta">' +
        '<div class="title">' + escapeHtml(project.title) + '</div>' +
        (chipsHtml ? '<div class="chips">' + chipsHtml + '</div>' : '') +
        '<div class="quick">' + escapeHtml(project.shortDescription || '') + '</div>' +
      '</div>';

    attachCardEditorTools(card, project);
    grid.appendChild(card);
  }

  function initModalTabs(modal) {
    if (!modal) return;
    const tabs = Array.from(modal.querySelectorAll('.tabs [role="tab"]'));
    const panels = Array.from(modal.querySelectorAll('.tabpanels [role="tabpanel"]'));
    if (!tabs.length || !panels.length) return;

    function setTab(name) {
      tabs.forEach((tab) => {
        const on = tab.getAttribute('data-tab') === name;
        tab.classList.toggle('active', on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panels.forEach((panel) => {
        const on = panel.id.endsWith(name);
        panel.classList.toggle('active', on);
      });
    }

    tabs.forEach((tab) => {
      if (tab.dataset.mirlTabsBound === '1') return;
      tab.dataset.mirlTabsBound = '1';
      tab.addEventListener('click', () => setTab(tab.getAttribute('data-tab')));
    });

    const defaultTab = tabs.find((tab) => tab.classList.contains('active')) || tabs[0];
    const defaultName = defaultTab ? (defaultTab.getAttribute('data-tab') || 'description') : 'description';
    setTab(defaultName || 'description');
  }

  function applyProjectModalContent(project) {
    const { modalId, modal } = getModalRef(project);
    if (!modalId || !modal) return;
    const defaults = modalDefaults.get(modalId) || { hero: '', body: '', badges: '', heroActions: '', stats: '' };
    const rawBodyHtml = typeof project.modalBody === 'string' ? project.modalBody : '';
    const customBodyHtml = rawBodyHtml && rawBodyHtml.trim() ? rawBodyHtml : '';
    const effectiveBodyHtml = customBodyHtml || defaults.body || '';
    const parsedBody = parseModalBodyContent(effectiveBodyHtml || '');
    const latestVersionFromBody = parsedBody && Array.isArray(parsedBody.versions) && parsedBody.versions.length
      ? parsedBody.versions[0]
      : null;
    const fallbackDownloadPath = (project.downloadFile || '').trim()
      || (latestVersionFromBody ? (latestVersionFromBody.url || latestVersionFromBody.downloadFile || '') : '');

    const heroEl = modal.querySelector('.modal-hero .muted');
    if (heroEl) {
      const customHero = typeof project.modalHero === 'string' ? project.modalHero.trim() : '';
      const fallbackHero = customHero
        || (typeof project.shortDescription === 'string' ? project.shortDescription.trim() : '')
        || defaults.hero
        || '';
      heroEl.textContent = fallbackHero;
    }

    const badgesEl = modal.querySelector('.modal-hero .badges');
    if (badgesEl) {
      const customBadges = typeof project.modalBadges === 'string' ? project.modalBadges.trim() : '';
      const badgesHtml = customBadges || defaults.badges || '';
      badgesEl.innerHTML = badgesHtml;
      badgesEl.hidden = !badgesHtml.trim();
    }

    const actionsEl = modal.querySelector('.modal-hero .hero-actions');
    if (actionsEl) {
      const customActions = typeof project.modalHeroActions === 'string' ? project.modalHeroActions.trim() : '';
      const actionsHtml = customActions || defaults.heroActions || '';
      actionsEl.innerHTML = actionsHtml;
      actionsEl.hidden = !actionsHtml.trim();

      if (!customActions && fallbackDownloadPath) {
        const fileId = fallbackDownloadPath.split('/').pop() || fallbackDownloadPath;
        actionsEl.querySelectorAll('[data-download-file]').forEach((link) => {
          link.setAttribute('href', fallbackDownloadPath);
          link.setAttribute('data-download-file', fileId);
        });
      }
    }

    const statsEl = modal.querySelector('.modal-hero .stats');
    if (statsEl) {
      const customStats = typeof project.modalStats === 'string' ? project.modalStats.trim() : '';
      const statsHtml = customStats || defaults.stats || '';
      statsEl.innerHTML = statsHtml;
      statsEl.hidden = !statsHtml.trim();
    }

    const bodyEl = modal.querySelector('.modal-body');
    let bodyApplied = false;
    if (bodyEl) {
      if (customBodyHtml) {
        bodyEl.innerHTML = customBodyHtml;
        bodyApplied = true;
      } else if (defaults.body) {
        bodyEl.innerHTML = defaults.body;
        bodyApplied = true;
      }
    }

    if (bodyApplied) {
      initModalTabs(modal);
    }
  }

  function updateCounts(){
    if (dpCount && dpGrid) {
      const n = dpGrid.querySelectorAll('.card').length;
      dpCount.textContent = n + (n === 1 ? ' item' : ' items');
    }
    if (prCount && prGrid) {
      const n = prGrid.querySelectorAll('.card').length;
      prCount.textContent = n + (n === 1 ? ' item' : ' items');
    }
  }

  let staticProjectsCache = null;

  async function fetchStaticProjects() {
    if (staticProjectsCache) {
      return staticProjectsCache;
    }
    try {
      const response = await fetch(STATIC_PROJECTS_URL, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }
      const payload = await response.json();
      if (Array.isArray(payload)) {
        staticProjectsCache = payload;
        return payload;
      }
    } catch (err) {
      console.warn('Konnte statische Projektliste nicht laden:', err);
    }
    return null;
  }

  async function loadProjects(){
    if (!dpGrid && !prGrid) return;
    let data = null;
    if (editingSupported) {
      try {
        data = await api('/editor/projects', { method: 'GET' });
      } catch (e) {
        const status = e && typeof e === 'object' && typeof e.status === 'number' ? e.status : null;
        if (status === 401 || status === 403) {
          console.warn('Editor-Anmeldung erforderlich, verwende statische Projektliste.');
        } else {
          console.warn('Konnte Projektliste nicht vom Editor-Server laden:', e);
          disableEditorFeatures('Editorfunktionen stehen auf dieser Online-Version nicht zur Verfügung.');
        }
      }
    }
    if (!Array.isArray(data)) {
      data = await fetchStaticProjects();
    }
    if (!Array.isArray(data)) return;
    projectsById = Object.create(null);
    data.forEach(p => {
      if (p && p.id) projectsById[p.id] = p;
    });

    clearGrid(dpGrid);
    clearGrid(prGrid);
    data.forEach(renderProjectCard);
    data.forEach(applyProjectModalContent);

    // Add "add" cards for editor mode
    if (dpGrid) dpGrid.appendChild(createAddCard('datapack'));
    if (prGrid) prGrid.appendChild(createAddCard('printing'));

    updateCounts();
    refreshLabelSuggestions();
    try {
      const evt = typeof CustomEvent === 'function'
        ? new CustomEvent('projects:cards-refreshed')
        : null;
      if (evt) {
        document.dispatchEvent(evt);
      } else {
        const legacy = document.createEvent('Event');
        legacy.initEvent('projects:cards-refreshed', true, true);
        document.dispatchEvent(legacy);
      }
    } catch (err) {
      console.warn('Konnte Kartenaktualisierungsevent nicht senden:', err);
    }
  }

  // ---------- Editor modal helpers ----------

  function openEditorModal(mode){
    currentMode = mode;
    if (!editorModal) return;
    editorModal.hidden = false;
    editorModal.setAttribute('aria-hidden','false');
    setTimeout(() => {
      if (titleInput && typeof titleInput.focus === 'function') {
        titleInput.focus();
      }
    }, 50);
  }

  function closeEditorModal(){
    if (!editorModal) return;
    editorModal.hidden = true;
    editorModal.setAttribute('aria-hidden','true');
    editingProject = null;
    resetValidationState();
  }

  function fillFormFromProject(project){
    idInput.value = project.id || '';
    typeInput.value = normaliseType(project.type);
    titleInput.value = project.title || '';
    mcVersionInput.value = project.mcVersion || '';
    statusInput.value = project.status || 'released';
    const categoryController = getChipFieldController('category');
    if (categoryController) {
      categoryController.setValues(project.category ? [project.category] : []);
    } else {
      categoryInput.value = project.category || '';
    }
    const tagsController = getChipFieldController('tags');
    if (tagsController) {
      tagsController.setValues(normaliseTags(project.tags));
    } else {
      const tags = Array.isArray(project.tags) ? project.tags.join(', ') : (project.tags || '');
      tagsInput.value = tags;
    }
    shortInput.value = project.shortDescription || '';
    populateModalUi(project);
    downloadInput.value = project.downloadFile || '';
    imageInput.value = project.image || '';
  }

  function collectFormData(){
    const id = (idInput.value || '').trim();
    const type = normaliseType(typeInput.value);
    const title = (titleInput.value || '').trim();
    const mcVersion = (mcVersionInput.value || '').trim();
    const status = (statusInput.value || '').trim();
    const categoryController = getChipFieldController('category');
    const tagsController = getChipFieldController('tags');
    const category = categoryController
      ? (categoryController.getValues()[0] || '')
      : (categoryInput.value || '').trim();
    const tags = tagsController
      ? tagsController.getValues()
      : normaliseTags(tagsInput.value || '');
    const shortDescription = (shortInput.value || '').trim();
    const downloadFile = (downloadInput.value || '').trim();
    const serialised = serialiseModalUi({
      projectId: id || slugifyId(title),
      type,
      status,
      category,
      tags,
      mcVersion,
      downloadFile,
      shortDescription,
    });
    const modalBody = serialised.body;
    const image = (imageInput.value || '').trim();
    return { id, type, title, mcVersion, status, category, tags, shortDescription, modalBody, downloadFile, image };
  }

  function openEditorForCreate(type){
    if (!assertEditorAvailable(true)) {
      return;
    }
    resetValidationState();
    editingProject = null;
    if (deleteBtn) deleteBtn.hidden = true;
    const safeType = normaliseType(type || 'datapack');
    editorTitleEl.textContent = safeType === 'printing' ? 'Neues 3D-Print-Projekt' : 'Neues Datapack';
    idInput.value = '';
    typeInput.value = safeType;
    titleInput.value = '';
    mcVersionInput.value = '';
    statusInput.value = 'released';
    if (getChipFieldController('category')) {
      getChipFieldController('category').setValues([]);
    } else {
      categoryInput.value = '';
    }
    if (getChipFieldController('tags')) {
      getChipFieldController('tags').setValues([]);
    } else {
      tagsInput.value = '';
    }
    shortInput.value = '';
    resetModalUi();
    currentModalId = '';
    downloadInput.value = '';
    imageInput.value = 'assets/img/logo.jpg';
    applyTypeUi(safeType);
    updateSubtitle(safeType, 'create');
    openEditorModal('create');
  }

  function openEditorForEdit(project){
    if (!assertEditorAvailable(true)) {
      return;
    }
    resetValidationState();
    editingProject = project || null;
    if (deleteBtn) deleteBtn.hidden = !editingProject;
    editorTitleEl.textContent = 'Projekt bearbeiten';
    fillFormFromProject(project);
    const safeType = normaliseType(typeInput.value);
    applyTypeUi(safeType);
    updateSubtitle(safeType, 'edit');
    openEditorModal('edit');
  }

  async function handleDeleteProject(project){
    if (!assertEditorAvailable(true)) {
      return;
    }
    if (!editorOn || !token) {
      alert('Bitte zuerst einloggen und Editor-Modus aktivieren.');
      return;
    }
    const sure = confirm('Projekt "' + project.title + '" wirklich löschen?');
    if (!sure) return;
    try {
      await api('/editor/projects/' + encodeURIComponent(project.id), {
        method: 'DELETE',
        body: '{}'
      });
      delete projectsById[project.id];
      editingProject = null;
      await loadProjects();
      closeEditorModal();
    } catch(e){
      alert('Konnte Projekt nicht löschen: ' + e.message);
    }
  }

  async function handleFormSubmit(e){
    e.preventDefault();
    if (!assertEditorAvailable(true)) {
      return;
    }
    if (!editorOn || !token) {
      alert('Bitte zuerst einloggen und Editor-Modus aktivieren.');
      return;
    }
    const validation = validateRequiredFields();
    if (validation.missing.length) {
      updateValidationSummary(validation.missing);
      focusFirstInvalidField(validation.firstInvalid);
      return;
    }
    updateValidationSummary([]);
    const versionEntries = collectVersionRows();
    const versionIssues = validateVersionEntries(versionEntries);
    if (versionIssues.length) {
      updateValidationSummary(versionIssues);
      if (modalVersionsList) {
        const firstRelease = modalVersionsList.querySelector('[data-field="version-release"]');
        focusFirstInvalidField(firstRelease || modalVersionsList.querySelector('[data-field="version-notes"]'));
      }
      return;
    }
    const data = collectFormData();
    try {
      let result;
      if (currentMode === 'edit' && data.id) {
        result = await api('/editor/projects/' + encodeURIComponent(data.id), {
          method: 'PUT',
          body: JSON.stringify(data)
        });
      } else {
        result = await api('/editor/projects', {
          method: 'POST',
          body: JSON.stringify(data)
        });
      }
      if (result && result.id) {
        projectsById[result.id] = result;
        await loadProjects();
        closeEditorModal();
      } else {
        alert('Server hat keine gültige Antwort zurückgegeben.');
      }
    } catch(e){
      alert('Konnte Projekt nicht speichern: ' + e.message);
    }
  }

  // ---------- Wire up events ----------

  loginBtn.addEventListener('click', handleLogin);
  logoutBtn.addEventListener('click', handleLogout);
  toggleBtn.addEventListener('click', toggleEditorMode);
  addBtn.addEventListener('click', function(){
    let type = 'datapack';
    const activeTab = document.querySelector('.segment a.active');
    if (activeTab) {
      type = activeTab.dataset.key === '1' ? 'printing' : 'datapack';
    }
    openEditorForCreate(type);
  });

  if (editorForm) {
    const addHandlers = {
      description: () => addDescriptionRow({}),
      version: () => addVersionRow({}),
      gallery: () => addGalleryRow({}),
    };
    editorForm.querySelectorAll('.editor-repeat-add').forEach((btn) => {
      const type = btn.getAttribute('data-add');
      if (!type || !addHandlers[type]) return;
      btn.addEventListener('click', () => {
        addHandlers[type]();
      });
    });
  }

  if (editorModal) {
    editorModal.addEventListener('click', (e)=>{
      if (e.target && e.target.hasAttribute('data-editor-close')) {
        closeEditorModal();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !editorModal.hidden) {
        closeEditorModal();
      }
    });
  }

  if (modalVersionsList) {
    modalVersionsList.addEventListener('input', handleVersionRowsMutated);
    modalVersionsList.addEventListener('change', handleVersionRowsMutated);
    if (typeof MutationObserver !== 'undefined') {
      try {
        const observer = new MutationObserver(handleVersionRowsMutated);
        observer.observe(modalVersionsList, { childList: true });
      } catch (err) {}
    }
  }

  requiredFieldDefs.forEach((def) => {
    if (!def || !def.input) return;
    ['input', 'change'].forEach((eventName) => {
      def.input.addEventListener(eventName, handleRequiredFieldInput);
    });
  });

  if (editorForm) {
    editorForm.addEventListener('submit', handleFormSubmit);
  }
  if (typeInput) {
    typeInput.addEventListener('change', () => {
      const safeType = normaliseType(typeInput.value);
      applyTypeUi(safeType);
      updateSubtitle(safeType, currentMode);
    });
  }
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      if (editingProject) {
        handleDeleteProject(editingProject);
      }
    });
  }

  loadToken();
  const sessionPromise = checkSession();
  if (entryAccessEnabled) {
    const triggerAutoLogin = () => {
      if (entryAccessEnabled && !sessionActive) {
        beginLogin({ auto: true });
      }
    };
    if (sessionPromise && typeof sessionPromise.then === 'function') {
      sessionPromise.catch(() => {}).finally(triggerAutoLogin);
    } else {
      triggerAutoLogin();
    }
  }
  loadProjects();
  applyTypeUi(typeInput ? typeInput.value : 'datapack');
  updateSubtitle(typeInput ? typeInput.value : 'datapack', 'create');

})();
