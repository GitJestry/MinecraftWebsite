
(function(){
  'use strict';

  const LS_LANG = 'mirl.lang';
  const LS_ALLOW = 'mirl.consent.allowlist';

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

  const DL_LS_KEY = 'mirl.download.tracked.v1';
  const DL_COUNTS_KEY = 'mirl.download.counts.v1';
  const DL_THROTTLE_MS = 4 * 60 * 60 * 1000; // 4 hours per download/file combo
  const downloadRegistry = new Map();
  let downloadStoreCache = undefined;
  let downloadCountsCache = undefined;
  let downloadFallbacks = {};

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

  function readDownloadStore() {
    if (downloadStoreCache !== undefined) return downloadStoreCache;
    try {
      const raw = localStorage.getItem(DL_LS_KEY);
      downloadStoreCache = raw ? JSON.parse(raw) : {};
    } catch (err) {
      downloadStoreCache = null;
    }
    return downloadStoreCache;
  }

  function writeDownloadStore(store) {
    downloadStoreCache = store;
    if (store === null) return;
    try {
      localStorage.setItem(DL_LS_KEY, JSON.stringify(store));
    } catch (err) {
      downloadStoreCache = null;
    }
  }

  function shouldRecordDownload(projectId, fileId) {
    const store = readDownloadStore();
    if (store === null) return true;
    const key = `${projectId}::${fileId || ''}`;
    const now = Date.now();
    const last = Number(store[key]) || 0;
    if (now - last < DL_THROTTLE_MS) return false;
    store[key] = now;
    writeDownloadStore(store);
    return true;
  }

  function readDownloadCounts() {
    if (downloadCountsCache !== undefined) return downloadCountsCache;
    try {
      const raw = localStorage.getItem(DL_COUNTS_KEY);
      downloadCountsCache = raw ? JSON.parse(raw) : {};
    } catch (err) {
      downloadCountsCache = {};
    }
    return downloadCountsCache;
  }

  function writeDownloadCounts(counts) {
    downloadCountsCache = counts || {};
    try {
      if (!counts || Object.keys(counts).length === 0) {
        localStorage.removeItem(DL_COUNTS_KEY);
      } else {
        localStorage.setItem(DL_COUNTS_KEY, JSON.stringify(downloadCountsCache));
      }
    } catch (err) {}
  }

  function getStoredDownloadCount(projectId, fallbackValue) {
    const counts = readDownloadCounts();
    if (!counts || typeof counts !== 'object') {
      return Number.isFinite(fallbackValue) ? fallbackValue : null;
    }
    const override = safeNumber(counts[projectId]);
    if (Number.isFinite(override)) {
      return override;
    }
    return Number.isFinite(fallbackValue) ? fallbackValue : null;
  }

  function ensureStoredCount(projectId, fallbackValue) {
    const value = getStoredDownloadCount(projectId, fallbackValue);
    updateDownloadDisplay(projectId, value);
    return value;
  }

  function incrementStoredCount(projectId) {
    const counts = { ...(readDownloadCounts() || {}) };
    const fallback = safeNumber(downloadFallbacks?.[projectId]);
    const current = safeNumber(counts[projectId]);
    const base = Number.isFinite(current)
      ? current
      : Number.isFinite(fallback)
        ? fallback
        : 0;
    const next = base + 1;
    counts[projectId] = next;
    writeDownloadCounts(counts);
    updateDownloadDisplay(projectId, next);
    return next;
  }

  function registerDownloadElement(projectId, el, fallbackValue) {
    if (!projectId) return;
    const key = String(projectId);
    let entry = downloadRegistry.get(key);
    if (!entry) {
      entry = { elements: new Set(), value: Number.isFinite(fallbackValue) ? fallbackValue : null };
      downloadRegistry.set(key, entry);
    }
    if (el) entry.elements.add(el);
    if (Number.isFinite(fallbackValue)) {
      entry.value = Number.isFinite(entry.value) ? entry.value : fallbackValue;
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
    try {
      const res = await fetch('assets/data/download-counts.json', { cache: 'no-store' });
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

  function handleDownloadEvent(projectId, fileId) {
    if (!projectId) return;
    registerDownloadElement(projectId);
    if (!shouldRecordDownload(projectId, fileId)) return;
    incrementStoredCount(projectId);
  }

  function attachDownloadListeners(links) {
    links.forEach(link => {
      link.addEventListener('click', () => {
        const projectId = link.getAttribute('data-track-download');
        const fileId = link.getAttribute('data-download-file') || link.getAttribute('href') || '';
        handleDownloadEvent(projectId, fileId);
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
      downloadFallbacks = fallbackCounts || {};
      countElements.forEach(el => {
        const projectId = el.getAttribute('data-download-count');
        const fallback = safeNumber(fallbackCounts?.[projectId]);
        registerDownloadElement(projectId, el, fallback);
      });
      Array.from(downloadRegistry.keys()).forEach((id) => {
        const fallback = safeNumber(fallbackCounts?.[id]);
        ensureStoredCount(id, fallback);
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
  });

})();
