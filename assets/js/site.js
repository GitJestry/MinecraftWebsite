
(function(){
  'use strict';

  const LS_LANG = 'mirl.lang';
  const LS_ALLOW = 'mirl.consent.allowlist';

  function sanitiseDownloadEndpoint(value) {
    if (value == null) return '';
    const trimmed = String(value).trim();
    if (!trimmed || trimmed.toLowerCase() === 'same-origin') {
      return '';
    }
    return trimmed;
  }

  function sanitiseDownloadCountsValue(value) {
    if (value == null) return null;
    const trimmed = String(value).trim();
    if (!trimmed) {
      return null;
    }
    const lowered = trimmed.toLowerCase();
    if (lowered === 'none' || lowered === 'disabled') {
      return false;
    }
    return trimmed;
  }

  function readHtmlConfigAttribute(attribute) {
    if (typeof document === 'undefined') {
      return '';
    }
    const html = document.documentElement;
    if (!html) {
      return '';
    }
    const value = html.getAttribute(attribute);
    return value ? value.trim() : '';
  }

  function readMetaConfig(name) {
    if (typeof document === 'undefined') {
      return '';
    }
    const meta = document.querySelector(`meta[name="${name}"]`);
    if (!meta) {
      return '';
    }
    const value = meta.getAttribute('content');
    return value ? value.trim() : '';
  }

  function resolveDownloadAnalyticsEndpoint() {
    const sources = [
      typeof window !== 'undefined' ? window.MIRL_DOWNLOADS_ENDPOINT : '',
      readHtmlConfigAttribute('data-download-analytics'),
      readMetaConfig('download-analytics'),
    ];
    for (const source of sources) {
      const normalised = sanitiseDownloadEndpoint(source);
      if (normalised) {
        return normalised;
      }
    }
    return '/analytics/downloads';
  }

  function resolveDownloadCountsUrl() {
    const sources = [
      typeof window !== 'undefined' ? window.MIRL_DOWNLOAD_COUNTS_URL : '',
      readHtmlConfigAttribute('data-download-counts'),
      readMetaConfig('download-counts-url'),
    ];
    for (const source of sources) {
      const normalised = sanitiseDownloadCountsValue(source);
      if (normalised === false) {
        return null;
      }
      if (typeof normalised === 'string' && normalised) {
        return normalised;
      }
    }
    return 'assets/data/download-counts.json';
  }

  function sanitiseEditorApiBase(value) {
    if (value == null) return '';
    const trimmed = String(value).trim();
    if (!trimmed || trimmed.toLowerCase() === 'same-origin') {
      return '';
    }
    return trimmed.replace(/\/+$/, '');
  }

  function computeEditorApiBase() {
    if (typeof window !== 'undefined' && window.MIRL_EDITOR_API) {
      return sanitiseEditorApiBase(window.MIRL_EDITOR_API);
    }
    if (typeof document !== 'undefined') {
      const html = document.documentElement;
      if (html) {
        const attr = html.getAttribute('data-editor-api');
        if (attr) {
          return sanitiseEditorApiBase(attr);
        }
      }
      const meta = document.querySelector('meta[name="editor-api"]');
      if (meta) {
        return sanitiseEditorApiBase(meta.getAttribute('content'));
      }
    }
    if (typeof window !== 'undefined') {
      const origin = window.location && window.location.origin;
      if (origin && origin !== 'null' && !origin.startsWith('file:')) {
        return '';
      }
    }
    return sanitiseEditorApiBase('http://localhost:3001');
  }

  let editorApiReachable = null;
  let editorApiCheckPromise = null;

  function checkEditorApiReachable() {
    if (editorApiReachable !== null) {
      return Promise.resolve(editorApiReachable);
    }
    if (editorApiCheckPromise) {
      return editorApiCheckPromise;
    }
    const base = computeEditorApiBase();
    if (!base) {
      editorApiReachable = true;
      editorApiCheckPromise = null;
      return Promise.resolve(true);
    }
    const sameOrigin = base === '';
    let url = '/editor/me';
    if (base) {
      url = base + '/editor/me';
    }
    editorApiCheckPromise = fetch(url, {
      method: 'GET',
      credentials: sameOrigin ? 'include' : 'omit',
    })
      .then((response) => {
        if (response.ok) {
          return true;
        }
        if (response.status === 401 || response.status === 403) {
          return true;
        }
        return false;
      })
      .catch(() => false)
      .then((ok) => {
        editorApiReachable = ok;
        editorApiCheckPromise = null;
        return ok;
      });
    return editorApiCheckPromise;
  }

  function shouldIgnoreEditorShortcutTarget(target) {
    if (!target || typeof target !== 'object') return false;
    const el = target;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function getLang() {
    try { return localStorage.getItem(LS_LANG) || 'en'; } catch(e){ return 'en'; }
  }
  function setLang(lang) {
    try { localStorage.setItem(LS_LANG, lang); } catch(e) {}
    document.documentElement.setAttribute('lang', lang || 'en');
    applyLang(lang);
    localizeCommonUI();
    updateLegalLinkLabels(lang);
    updateNavLabels(lang);
    updateDocTitles(lang);
    updateBannerTexts(lang);
    if (typeof window.CustomEvent === 'function') {
      document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
    } else {
      const evt = document.createEvent('Event');
      evt.initEvent('langchange', true, true);
      evt.detail = { lang };
      document.dispatchEvent(evt);
    }
  }
  
  // --- i18n strings for small UI bits ---
  const STRINGS = {
    en: {
      copy: "Copy",
      copy_link: "Copy link",
      copy_failed: "Copy failed",
      cancel: "Cancel",
      allow_once: "Allow once",
      language: "Language:"
    },
    de: {
      copy: "Kopieren",
      copy_link: "Link kopieren",
      copy_failed: "Kopieren fehlgeschlagen",
      cancel: "Abbrechen",
      allow_once: "Einmal erlauben",
      language: "Sprache:"
    }
  };
  function t(key){ const lang = getLang(); return (STRINGS[lang] && STRINGS[lang][key]) || (STRINGS.en[key]||key); }
  function localizeCommonUI(){
    // footer language label
    document.querySelectorAll('#pageend .f-right .lang-en, #pageend .f-right .lang-de').forEach(el => {
      // handled via .lang-* show/hide; no-op here
    });
    // copy buttons
    document.querySelectorAll('[data-copy]').forEach(btn => {
      if (btn.tagName === 'BUTTON') {
        // default label
        btn.textContent = t('copy_link');
      }
    });
    // consent modal buttons
    const allow = document.getElementById('consent-allow-once');
    const cancel = document.getElementById('consent-cancel');
    if (allow) allow.querySelector('.lang-en')?.replaceWith(Object.assign(document.createElement('span'),{className:'lang-en',textContent:t('allow_once')}));
    if (cancel) cancel.querySelector('.lang-en')?.replaceWith(Object.assign(document.createElement('span'),{className:'lang-en',textContent:t('cancel')}));
  }

  function applyLang(lang){
    document.querySelectorAll('.lang-en,.lang-de').forEach(el => {
      const isEN = el.classList.contains('lang-en');
      el.style.display = (isEN && lang==='en') || (!isEN && lang==='de') ? '' : 'none';
      el.setAttribute('aria-hidden', ((isEN && lang!=='en') || (!isEN && lang!=='de')).toString());
    });
  }

  function addLanguageButton(){
    if (document.querySelector('.lang-toggle')) return;
    const btn = document.createElement('button');
    btn.className = 'lang-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-label','Switch language');
    btn.textContent = getLang().toUpperCase();
    btn.addEventListener('click', ()=>{
      const next = getLang()==='en' ? 'de' : 'en';
      btn.textContent = next.toUpperCase();
      setLang(next);
    });
    document.body.appendChild(btn);
  }

  function updateNavLabels(lang){
    const map = {
      home: { en: 'Home', de: 'Start' },
      links: { en: 'Links', de: 'Links' },
      projects: { en: 'Projects', de: 'Projekte' },
      imprint: { en: 'Imprint', de: 'Impressum' },
      privacy: { en: 'Privacy', de: 'Datenschutz' }
    };
    const nav = document.querySelector('.navbar');
    if (nav){
      nav.querySelectorAll('a').forEach(a=>{
        const href = (a.getAttribute('href')||'').toLowerCase();
        let key = null;
        if (href.includes('index')) key='home';
        else if (href.includes('links')) key='links';
        else if (href.includes('projects')) key='projects';
        else if (href.includes('impressum')) key='imprint';
        else if (href.includes('datenschutz')) key='privacy';
        if (key && map[key]) {
          const labels = map[key];
          const enNodes = a.querySelectorAll('.lang-en');
          const deNodes = a.querySelectorAll('.lang-de');
          if (enNodes.length || deNodes.length) {
            enNodes.forEach(node => { node.textContent = labels.en; });
            deNodes.forEach(node => { node.textContent = labels.de; });
          } else {
            a.textContent = labels[lang] || labels.en;
          }
        }
      });
    }
  }

  function updateDocTitles(lang){
    const t = document.title || '';
    // basic replacements
    const replacements = [
      [/Imprint/gi, lang==='en' ? 'Imprint' : 'Impressum'],
      [/Privacy/gi, lang==='en' ? 'Privacy' : 'Datenschutz'],
      [/Projects/gi, lang==='en' ? 'Projects' : 'Projekte'],
      [/Links/gi, lang==='en' ? 'Links' : 'Links']
    ];
    let newTitle = t;
    replacements.forEach(([re, val]) => { newTitle = newTitle.replace(re, val); });
    document.title = newTitle;
  }

  function updateLegalLinkLabels(lang){
    const setLabel = (anchor, en, de) => {
      const enEl = anchor.querySelector('.lang-en');
      const deEl = anchor.querySelector('.lang-de');
      if (enEl || deEl) {
        if (enEl) enEl.textContent = en;
        if (deEl) deEl.textContent = de;
      } else {
        anchor.textContent = lang === 'en' ? en : de;
      }
    };
    document.querySelectorAll('a[href$="impressum.html"]').forEach(a=> setLabel(a, 'Imprint', 'Impressum'));
    document.querySelectorAll('a[href$="datenschutz.html"]').forEach(a=> setLabel(a, 'Privacy', 'Datenschutz'));
  }

  function updateBannerTexts(lang){
    // Disclaimer banner small labels if present
    const label = document.querySelector('.bn-label');
    if (label) label.textContent = lang==='en' ? 'Disclaimer' : 'Hinweis';
  }

  // ---------- Consent Manager for external links ----------

  function getAllowlist(){
    try { return JSON.parse(localStorage.getItem(LS_ALLOW) || '[]'); } catch(e){ return []; }
  }
  function setAllowlist(list){
    try { localStorage.setItem(LS_ALLOW, JSON.stringify(list)); } catch(e){}
  }
  function isWhitelisted(hostname){
    const allow = getAllowlist();
    return allow.some(dom => hostname.endsWith(dom));
  }
  function whitelistDomain(hostname){
    const base = hostname.split('.').slice(-2).join('.'); // e.g. youtube.com
    const allow = getAllowlist();
    if (!allow.includes(base)) { allow.push(base); setAllowlist(allow); }
  }

  function wantsConsent(url){
    try {
      const u = new URL(url, location.href);
      const host = u.hostname;
      const list = ['youtube.com','youtu.be','twitch.tv','discord.com','discord.gg','tiktok.com','instagram.com','facebook.com','x.com','twitter.com','patreon.com','kick.com'];
      if (location.hostname && host === location.hostname) return false;
      return list.some(dom => host.endsWith(dom)) && !isWhitelisted(host);
    } catch(e){
      return false;
    }
  }

  function ensureModal(){
    let modal = document.getElementById('consent-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'consent-modal';
    modal.className = 'consent-modal';
    modal.innerHTML = `
      <div class="consent-backdrop" data-close="true"></div>
      <div class="consent-dialog" role="dialog" aria-modal="true" aria-labelledby="consent-title">
        <div class="consent-head">
          <div id="consent-title" class="consent-title">
            <span class="lang-en">Open external link?</span>
            <span class="lang-de">Externer Link öffnen?</span>
          </div>
          <button class="consent-x" type="button" aria-label="Close">×</button>
        </div>
        <div class="consent-body">
          <p class="lang-en">This link opens a third‑party site (<span id="consent-host-en"></span>). Visiting it may share your data with that provider. Do you want to proceed?</p>
          <p class="lang-de">Dieser Link öffnet eine Seite eines Drittanbieters (<span id="consent-host-de"></span>). Beim Besuch können Daten an diesen Anbieter übertragen werden. Möchten Sie fortfahren?</p>
          <label class="consent-remember">
            <input type="checkbox" id="consent-remember-domain" />
            <span class="lang-en">Remember for this domain</span>
            <span class="lang-de">Für diese Domain merken</span>
          </label>
        </div>
        <div class="consent-actions">
          <button type="button" class="btn btn-primary" id="consent-allow-once">
            <span class="lang-en">Allow once</span><span class="lang-de">Einmal erlauben</span>
          </button>
          <button type="button" class="btn" id="consent-cancel">
            <span class="lang-en">Cancel</span><span class="lang-de">Abbrechen</span>
          </button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    applyLang(getLang());
    localizeCommonUI();
    // Close logic
    modal.querySelector('.consent-x').addEventListener('click', ()=> closeModal());
    modal.querySelector('.consent-backdrop').addEventListener('click', (e)=> { if (e.target.dataset.close) closeModal(); });
    return modal;
  }

  let pendingURL = null;
  function openModal(url){
    const modal = ensureModal();
    pendingURL = url;
    const host = (new URL(url, location.href)).hostname;
    modal.querySelector('#consent-host-en').textContent = host;
    modal.querySelector('#consent-host-de').textContent = host;
    modal.classList.add('show');
    const remember = modal.querySelector('#consent-remember-domain');
    remember.checked = false;
    const allowBtn = modal.querySelector('#consent-allow-once');
    const cancelBtn = modal.querySelector('#consent-cancel');
    const onAllow = ()=>{
      if (remember.checked) whitelistDomain(host);
      window.open(url, '_blank', 'noopener');
      closeModal();
    };
    const onCancel = ()=> closeModal();
    allowBtn.onclick = onAllow; cancelBtn.onclick = onCancel;
  }
  function closeModal(){
    const modal = document.getElementById('consent-modal');
    if (modal){ modal.classList.remove('show'); pendingURL = null; }
  }

  function handleAnchorClick(e){
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;
    const url = new URL(href, location.href).href;
    if (a.hasAttribute('data-noconsent')) return; // opt-out
    if (wantsConsent(url)){
      e.preventDefault();
      openModal(url);
    }
  }

  function patchLinkCards(){
    // Our pages may use .linkcard elements with data-href that call window.open directly.
    document.querySelectorAll('.linkcard[data-href]').forEach(card => {
      // Remove existing click handler by cloning
      const newCard = card.cloneNode(true);
      newCard.addEventListener('click', (e)=>{
        const isButton = e.target.closest('button, .btn');
        if (isButton) return;
        const url = newCard.getAttribute('data-href');
        if (url) {
          if (wantsConsent(url)) { e.preventDefault(); openModal(url); }
          else { window.open(url, '_blank', 'noopener'); }
        }
      });
      card.parentNode.replaceChild(newCard, card);
    });
  }

  function addFooter(){
    const foot = document.getElementById('pageend');
    if (!foot) return;
    foot.innerHTML = `
      <div class="container footer-grid">
        <div class="f-left footer-links">
          <a href="impressum.html">Imprint</a> · <a href="datenschutz.html">Privacy</a>
        </div>
        <div class="f-center">
          <p class="footer-note">
            <span class="lang-en">NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.</span>
            <span class="lang-de">KEIN OFFIZIELLES MINECRAFT‑PRODUKT. NICHT VON MOJANG ODER MICROSOFT GENEHMIGT ODER VERBUNDEN.</span>
          </p>
        </div>
        <div class="f-right">
          <span class="lang-en">Language:</span><span class="lang-de">Sprache:</span>
          <button type="button" class="btn-mini" id="footer-lang-btn">EN</button>
        </div>
      </div>`;
    const btn = foot.querySelector('#footer-lang-btn');
    btn.textContent = getLang().toUpperCase();
    btn.addEventListener('click', ()=>{
      const next = getLang()==='en' ? 'de' : 'en';
      setLang(next);
      btn.textContent = next.toUpperCase();
    });
  }

  document.addEventListener('click', handleAnchorClick, {capture:true});
  // Expose for debugging
  window.__MIRL = { setLang, getLang };

  const DOWNLOAD_ENDPOINT = resolveDownloadAnalyticsEndpoint();
  const STATIC_COUNTS_URL = resolveDownloadCountsUrl();
  const downloadRegistry = new Map();
  const trackedProjectIds = new Set();
  let downloadCountsCache = {};
  let refreshTimeout = null;

  function safeNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function formatDownloadValue(value) {
    if (!Number.isFinite(value)) return '—';
    const lang = getLang();
    const locale = lang === 'de' ? 'de-DE' : 'en-US';
    try {
      return new Intl.NumberFormat(locale).format(value);
    } catch (err) {
      return String(value);
    }
  }

  function markTrackedProject(projectId) {
    if (!projectId) return;
    trackedProjectIds.add(String(projectId));
  }

  function registerDownloadElement(projectId, el, fallbackValue) {
    if (!projectId) return;
    const key = String(projectId);
    markTrackedProject(key);
    let entry = downloadRegistry.get(key);
    if (!entry) {
      entry = { elements: new Set(), value: Number.isFinite(fallbackValue) ? fallbackValue : null };
      downloadRegistry.set(key, entry);
    }
    if (el) entry.elements.add(el);
    const knownValue = safeNumber(downloadCountsCache[key]);
    if (Number.isFinite(knownValue)) {
      entry.value = knownValue;
    } else if (Number.isFinite(fallbackValue) && !Number.isFinite(entry.value)) {
      entry.value = fallbackValue;
    }
    updateDownloadDisplay(key, entry.value);
  }

  function updateDownloadDisplay(projectId, value) {
    const entry = downloadRegistry.get(projectId);
    if (!entry) return;
    if (Number.isFinite(value)) {
      entry.value = value;
    }
    const displayValue = Number.isFinite(entry.value) ? entry.value : null;
    entry.elements.forEach(el => {
      el.textContent = displayValue === null ? '—' : formatDownloadValue(displayValue);
      if (displayValue === null) {
        el.removeAttribute('data-download-count-value');
      } else {
        el.setAttribute('data-download-count-value', String(displayValue));
      }
    });
  }

  async function loadDownloadFallbacks() {
    if (!STATIC_COUNTS_URL) {
      return {};
    }
    try {
      const res = await fetch(STATIC_COUNTS_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load fallback counts');
      const data = await res.json();
      if (data && typeof data === 'object' && data.counts) {
        return data.counts;
      }
    } catch (err) {
      console.warn('[downloads] Unable to load fallback counts:', err);
    }
    return {};
  }

  function fetchDownloadCounts(ids) {
    const cleanIds = Array.from(new Set(ids.filter(Boolean))).map((id) => id.trim()).filter(Boolean);
    if (!cleanIds.length) return Promise.resolve({});
    const joined = cleanIds.join(',');
    const url = buildDownloadCountsUrl(joined);
    return fetch(url, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) {
          throw new Error('download_stats_unavailable');
        }
        return response.json();
      })
      .then((payload) => payload?.counts || {});
  }

  function buildDownloadCountsUrl(idsValue) {
    const fallback = `${DOWNLOAD_ENDPOINT}${DOWNLOAD_ENDPOINT.includes('?') ? '&' : '?'}ids=${encodeURIComponent(idsValue)}`;
    if (typeof URL !== 'function') {
      return fallback;
    }
    try {
      const base = (typeof window !== 'undefined' && window.location && window.location.href)
        ? window.location.href
        : undefined;
      const endpointUrl = base ? new URL(DOWNLOAD_ENDPOINT, base) : new URL(DOWNLOAD_ENDPOINT);
      endpointUrl.searchParams.set('ids', idsValue);
      return endpointUrl.toString();
    } catch (err) {
      return fallback;
    }
  }

  function applyCounts(counts) {
    downloadCountsCache = counts || {};
    Object.keys(downloadCountsCache).forEach((projectId) => {
      const value = safeNumber(downloadCountsCache[projectId]);
      if (Number.isFinite(value)) {
        updateDownloadDisplay(projectId, value);
      }
    });
  }

  function scheduleDownloadCountRefresh() {
    if (refreshTimeout) return;
    refreshTimeout = setTimeout(() => {
      refreshTimeout = null;
      refreshDownloadCounts().catch((err) => {
        console.warn('[downloads] Scheduled refresh failed:', err);
      });
    }, 1000);
  }

  function refreshDownloadCounts() {
    const ids = Array.from(trackedProjectIds);
    if (!ids.length) return Promise.resolve();
    return fetchDownloadCounts(ids)
      .then((counts) => {
        if (counts && typeof counts === 'object') {
          applyCounts(counts);
        }
      });
  }

  function toPayload(link, projectId) {
    const payload = { projectId };
    if (!link) {
      return payload;
    }
    const fileId = (link.getAttribute('data-download-file') || '').trim();
    const href = (link.getAttribute('href') || '').trim();
    if (fileId) {
      payload.fileId = fileId;
    }
    if (href) {
      payload.path = href;
    }
    return payload;
  }

  function recordDownload(link, projectId) {
    if (!projectId) return;
    const payload = toPayload(link, projectId);
    const body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        const ok = navigator.sendBeacon(DOWNLOAD_ENDPOINT, blob);
        if (ok) {
          scheduleDownloadCountRefresh();
          return;
        }
      }
    } catch (err) {}
    fetch(DOWNLOAD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('download_record_failed');
        }
        return response.json();
      })
      .then((data) => {
        const count = Number(data?.count);
        if (Number.isFinite(count)) {
          downloadCountsCache[projectId] = count;
          updateDownloadDisplay(projectId, count);
        } else {
          scheduleDownloadCountRefresh();
        }
      })
      .catch((err) => {
        console.warn('[downloads] Failed to record download:', err);
      });
  }

  function handleDownloadEvent(projectId, link) {
    if (!projectId) return;
    registerDownloadElement(projectId);
    recordDownload(link, projectId);
  }

  function attachDownloadListeners(links) {
    links.forEach(link => {
      link.addEventListener('click', () => {
        const projectId = link.getAttribute('data-track-download');
        handleDownloadEvent(projectId, link);
      });
    });
  }

  function initDownloadTracking() {
    const countElements = Array.from(document.querySelectorAll('[data-download-count]'));
    const downloadLinks = Array.from(document.querySelectorAll('[data-track-download]'));
    if (!countElements.length && !downloadLinks.length) return;

    attachDownloadListeners(downloadLinks);

    (async () => {
      const fallbackCounts = await loadDownloadFallbacks();
      countElements.forEach(el => {
        const projectId = el.getAttribute('data-download-count');
        const fallback = safeNumber(fallbackCounts?.[projectId]);
        registerDownloadElement(projectId, el, fallback);
      });
      refreshDownloadCounts().catch(() => {
        if (fallbackCounts && typeof fallbackCounts === 'object') {
          applyCounts(fallbackCounts);
        }
      });
    })();
  }

  document.addEventListener('langchange', () => {
    downloadRegistry.forEach((entry, projectId) => {
      if (Number.isFinite(entry.value)) {
        updateDownloadDisplay(projectId, entry.value);
      }
    });
  });

  const downloadSizeCache = new Map();

  function formatFileSizeLabel(bytes) {
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
    const rounded = unitIndex === 0 ? Math.round(size) : Math.round(size * 10) / 10;
    return `${rounded} ${units[unitIndex]}`;
  }

  function fetchDownloadSize(path) {
    if (!path) return Promise.resolve(null);
    let pending = downloadSizeCache.get(path);
    if (!pending) {
      pending = (async () => {
        try {
          const response = await fetch(path, { method: 'HEAD' });
          if (!response.ok) throw new Error('HEAD failed');
          const length = Number(response.headers.get('content-length'));
          return Number.isFinite(length) ? length : null;
        } catch (err) {
          return null;
        }
      })();
      downloadSizeCache.set(path, pending);
    }
    return pending;
  }

  function initDownloadSizes() {
    const elements = Array.from(document.querySelectorAll('[data-download-size]'));
    if (!elements.length) return;
    const groups = new Map();
    elements.forEach((el) => {
      const path = el.getAttribute('data-download-size');
      if (!path) return;
      if (!groups.has(path)) {
        groups.set(path, []);
      }
      groups.get(path).push(el);
    });
    groups.forEach((els, path) => {
      fetchDownloadSize(path)
        .then((bytes) => {
          const label = Number.isFinite(bytes) ? formatFileSizeLabel(bytes) : '—';
          els.forEach((el) => {
            el.textContent = label || '—';
          });
        })
        .catch(() => {
          els.forEach((el) => {
            el.textContent = '—';
          });
        });
    });
  }

  document.addEventListener('keydown', (event) => {
    if (!event || typeof event.key !== 'string') return;
    if (!event.ctrlKey || !event.altKey) return;
    if (event.metaKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'e') return;
    if (shouldIgnoreEditorShortcutTarget(event.target)) return;
    event.preventDefault();
    checkEditorApiReachable().then((reachable) => {
      if (reachable) {
        window.location.href = '/editor/';
      }
    });
  });

  document.addEventListener('DOMContentLoaded', function(){
    const lang = getLang();
    document.documentElement.setAttribute('lang', lang);
// Footer might already be present in HTML; ensure language button in footer is wired
    if (!document.querySelector('#pageend .footer-grid')) { addFooter(); }
    const btn = document.querySelector('#pageend #footer-lang-btn');
    if (btn) {
      btn.textContent = lang.toUpperCase();
      btn.addEventListener('click', ()=>{
        const next = getLang()==='en' ? 'de' : 'en';
        setLang(next);
        btn.textContent = next.toUpperCase();
      });
    }
    applyLang(lang);
    localizeCommonUI();
    updateNavLabels(lang);
    updateLegalLinkLabels(lang);
    updateDocTitles(lang);
    updateBannerTexts(lang);
    patchLinkCards();
    initDownloadTracking();
    initDownloadSizes();
  });

  // Expose Netlify Identity on all pages so invite/recovery links work regardless of entry path
  (function initNetlifyIdentity() {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const existingScript = document.querySelector('script[data-netlify-identity-widget]');
    if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://identity.netlify.com/v1/netlify-identity-widget.js';
      script.async = true;
      script.setAttribute('data-netlify-identity-widget', 'true');
      script.onload = setupIdentity;
      document.head.appendChild(script);
    } else if (window.netlifyIdentity) {
      setupIdentity();
    } else {
      existingScript.addEventListener('load', setupIdentity, { once: true });
    }

    function setupIdentity() {
      const identity = window.netlifyIdentity;
      if (!identity || identity._mirlBound) return;
      identity._mirlBound = true;

      identity.on('init', (user) => {
        const hash = window.location && window.location.hash ? window.location.hash : '';
        const hasToken = hash.includes('invite_token=') || hash.includes('recovery_token=');
        if (!user && hasToken) {
          identity.open('login');
        } else if (hasToken && window.location && window.location.pathname !== '/admin/') {
          // If the widget is already authenticated, honour invite links by jumping to the CMS
          window.location.href = '/admin/';
        }
      });

      identity.on('login', () => {
        const target = '/admin/';
        if (window.location && window.location.pathname !== target) {
          window.location.href = target;
        }
      });

      identity.init();
    }
  })();

})();
