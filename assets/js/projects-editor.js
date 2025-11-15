(function(){
  'use strict';

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

  const banner = document.getElementById('editor-banner');
  if (!banner) return;

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

  const idInput = document.getElementById('pe-id');
  const typeInput = document.getElementById('pe-type');
  const titleInput = document.getElementById('pe-title');
  const mcVersionInput = document.getElementById('pe-mcversion');
  const statusInput = document.getElementById('pe-status');
  const categoryInput = document.getElementById('pe-category');
  const tagsInput = document.getElementById('pe-tags');
  const shortInput = document.getElementById('pe-short');
  const modalHeroInput = document.getElementById('pe-modal-hero');
  const modalBodyInput = document.getElementById('pe-modal-body');
  const modalBadgesInput = document.getElementById('pe-modal-badges');
  const modalActionsInput = document.getElementById('pe-modal-actions');
  const modalStatsInput = document.getElementById('pe-modal-stats');
  const modalBadgesList = document.getElementById('pe-modal-badges-list');
  const modalActionsList = document.getElementById('pe-modal-actions-list');
  const modalStatsList = document.getElementById('pe-modal-stats-list');
  const modalInfoTitleInput = document.getElementById('pe-modal-info-title');
  const modalTagsTitleInput = document.getElementById('pe-modal-tags-title');
  const modalInfoList = document.getElementById('pe-modal-info-list');
  const modalTagsList = document.getElementById('pe-modal-tags-list');
  const modalDescriptionList = document.getElementById('pe-modal-description-list');
  const modalStepsList = document.getElementById('pe-modal-steps-list');
  const modalVersionsList = document.getElementById('pe-modal-versions-list');
  const modalChangelogList = document.getElementById('pe-modal-changelog-list');
  const modalGalleryList = document.getElementById('pe-modal-gallery-list');
  const downloadInput = document.getElementById('pe-download');
  const imageInput = document.getElementById('pe-image');
  const deleteBtn = document.getElementById('project-editor-delete');

  const typeOnlyFields = editorForm ? Array.from(editorForm.querySelectorAll('[data-type-only]')) : [];
  const typeAwareLabelNodes = editorForm ? Array.from(editorForm.querySelectorAll('[data-label-datapack]')) : [];
  const typeAwarePlaceholderNodes = editorForm ? Array.from(editorForm.querySelectorAll('[data-placeholder-datapack]')) : [];
  const typeAwareHintNodes = editorForm ? Array.from(editorForm.querySelectorAll('[data-hint-datapack]')) : [];

  const LS_KEY = 'mirl.editor.token';
  let token = null;
  let editorOn = false;
  let projectsById = Object.create(null);
  const modalDefaults = new Map();
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
    label.textContent = 'Nicht angemeldet';
    userLabel.textContent = '';
    statusBox.classList.add('hidden');
    loginBtn.style.display = 'inline-block';
    editorOn = false;
    toggleBtn.textContent = 'Editor-Modus: Aus';
    document.documentElement.classList.remove('editor-mode-on');
  }

  function setLoggedIn(username) {
    label.textContent = 'Editor aktiviert';
    userLabel.textContent = username ? ('Angemeldet als ' + username) : '';
    statusBox.classList.remove('hidden');
    loginBtn.style.display = 'none';
  }

  async function api(path, options){
    const opts = options ? { ...options } : {};
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
    const url = API_BASE ? API_BASE + path : path;
    const res = await fetch(url, opts);
    if (!res.ok) {
      let err;
      try { err = await res.json(); } catch(e){}
      const msg = err && err.error ? err.error : ('HTTP ' + res.status);
      throw new Error(msg);
    }
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch(e){
      return null;
    }
  }

  async function checkSession() {
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
    const username = prompt('Admin-Benutzername', 'admin');
    if (!username) return;
    const password = prompt('Admin-Passwort');
    if (!password) return;
    try {
      const res = await api('/editor/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      if (res && res.token) {
        saveToken(res.token);
        setLoggedIn(username);
        alert('Login erfolgreich.');
      } else {
        alert('Login fehlgeschlagen.');
      }
    } catch(e){
      alert('Login fehlgeschlagen: ' + e.message);
    }
  }

  async function handleLogout(){
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
    editorOn = !editorOn;
    toggleBtn.textContent = editorOn ? 'Editor-Modus: An' : 'Editor-Modus: Aus';
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

  function extractModalHero(project) {
    const { modal } = getModalRef(project);
    if (!modal) return '';
    const hero = modal.querySelector('.modal-hero .muted');
    return hero ? hero.textContent.trim() : '';
  }

  function extractModalBody(project) {
    const { modal } = getModalRef(project);
    if (!modal) return '';
    const body = modal.querySelector('.modal-body');
    return body ? body.innerHTML.trim() : '';
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
      changelog: [],
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

    const versionsPanel = wrapper.querySelector('[role="tabpanel"][id$="-versions"]');
    if (versionsPanel) {
      const rows = versionsPanel.querySelectorAll('tbody tr');
      rows.forEach((tr) => {
        const cells = tr.querySelectorAll('td');
        if (!cells.length) return;
        const release = cells[0] ? cells[0].textContent.trim() : '';
        const minecraft = cells[1] ? cells[1].textContent.trim() : '';
        const date = cells[2] ? cells[2].textContent.trim() : '';
        const link = cells[3] ? cells[3].querySelector('a') : null;
        const labelEnNode = link ? link.querySelector('.lang-en') : null;
        const labelDeNode = link ? link.querySelector('.lang-de') : null;
        const labelEn = labelEnNode ? labelEnNode.textContent.trim() : '';
        const labelDe = labelDeNode ? labelDeNode.textContent.trim() : '';
        const label = (!labelEn && !labelDe && link) ? link.textContent.trim() : '';
        const url = link ? link.getAttribute('href') || '' : '';
        const downloadFile = link ? link.getAttribute('data-download-file') || '' : '';
        const trackId = link ? link.getAttribute('data-track-download') || '' : '';
        if (!(release || minecraft || date || url || labelEn || labelDe || label)) return;
        data.versions.push({ release, minecraft, date, url, labelEn, labelDe, label, downloadFile, trackId });
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
          data.changelog.push({ title, details: text });
        }
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

    const versionsRows = (bodyData.versions || [])
      .map((entry) => {
        if (!entry || !(entry.release || entry.minecraft || entry.date || entry.url)) return '';
        const release = escapeHtml(entry.release || '');
        const minecraft = escapeHtml(entry.minecraft || '');
        const date = escapeHtml(entry.date || '');
        let linkHtml = '';
        if (entry.url) {
          const href = escapeAttr(entry.url);
          const downloadFile = entry.downloadFile ? escapeAttr(entry.downloadFile) : '';
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
          linkHtml = `<a href="${href}"${downloadAttr}${downloadData}${trackAttr}>${labelHtml}</a>`;
        } else {
          linkHtml = escapeHtml(entry.label || '');
        }
        return `<tr><td>${release}</td><td>${minecraft}</td><td>${date}</td><td>${linkHtml}</td></tr>`;
      })
      .filter(Boolean)
      .join('');

    const changelogHtml = (bodyData.changelog || [])
      .map((entry) => {
        if (!entry || !(entry.title || entry.details)) return '';
        const title = entry.title ? `<strong>${escapeHtml(entry.title)}</strong>` : '';
        const details = entry.details ? formatInline(entry.details) : '';
        if (title && details) {
          return `<p>${title} – ${details}</p>`;
        }
        return `<p>${title || details}</p>`;
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
    if (changelogHtml) {
      navButtons.push(`<button aria-selected="false" data-tab="changelog" role="tab"><span class="lang-en">Changelog</span><span class="lang-de">Änderungsprotokoll</span></button>`);
    }
    if (versionsRows) {
      navButtons.push(`<button aria-selected="false" data-tab="versions" role="tab"><span class="lang-en">Versions</span><span class="lang-de">Versionen</span></button>`);
    }

    const navHtml = `<nav aria-label="Modal Tabs" class="tabs" role="tablist">${navButtons.join('')}</nav>`;

    const panels = [];
    panels.push(`<div class="active prose" id="${safeId}-description" role="tabpanel">${descriptionHtml || ''}</div>`);
    if (stepsHtml) {
      panels.push(`<div class="prose" id="${safeId}-installation" role="tabpanel"><div class="steps">${stepsHtml}</div></div>`);
    }
    if (versionsRows) {
      panels.push(`<div id="${safeId}-versions" role="tabpanel"><table class="versions-table"><thead><tr><th>Release</th><th>Minecraft</th><th>Date</th><th>File</th></tr></thead><tbody>${versionsRows}</tbody></table></div>`);
    }
    if (changelogHtml) {
      panels.push(`<div class="prose" id="${safeId}-changelog" role="tabpanel">${changelogHtml}</div>`);
    }
    if (galleryHtml) {
      panels.push(`<div id="${safeId}-gallery" role="tabpanel"><div class="gallery">${galleryHtml}</div></div>`);
    }

    const hasContent = (infoCardHtml || tagsCardHtml || descriptionHtml || stepsHtml || versionsRows || changelogHtml || galleryHtml);
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
    };
  }

  function addBadgeRow(data = {}) {
    if (!modalBadgesList) return;
    const row = document.createElement('div');
    row.className = 'editor-repeat-row';
    row.innerHTML = `
      <input type="text" data-field="badge-text" placeholder="Badge-Text">
      <label class="editor-inline-checkbox"><input type="checkbox" data-field="badge-dot"> Punkt anzeigen</label>
      <button type="button" class="editor-repeat-remove" title="Entfernen">×</button>
    `;
    const textInput = row.querySelector('[data-field="badge-text"]');
    const dotInput = row.querySelector('[data-field="badge-dot"]');
    textInput.value = data.text || '';
    dotInput.checked = !!data.hasDot;
    row.querySelector('.editor-repeat-remove').addEventListener('click', () => makeRemoveHandler(modalBadgesList, addBadgeRow)(row));
    modalBadgesList.appendChild(row);
  }

  function setBadgeRows(items) {
    if (!modalBadgesList) return;
    clearContainer(modalBadgesList);
    const list = Array.isArray(items) && items.length ? items : [{}];
    list.forEach((item) => addBadgeRow(item));
  }

  function collectBadges() {
    if (!modalBadgesList) return [];
    return Array.from(modalBadgesList.querySelectorAll('.editor-repeat-row'))
      .map((row) => {
        const text = (row.querySelector('[data-field="badge-text"]') || {}).value || '';
        if (!text.trim()) return null;
        const hasDot = !!(row.querySelector('[data-field="badge-dot"]') || {}).checked;
        return { text: text.trim(), hasDot };
      })
      .filter(Boolean);
  }

  function addActionRow(data = {}) {
    if (!modalActionsList) return;
    const row = document.createElement('div');
    row.className = 'editor-repeat-row';
    row.innerHTML = `
      <input type="text" data-field="action-label-en" placeholder="Label (EN)">
      <input type="text" data-field="action-label-de" placeholder="Label (DE)">
      <input type="text" data-field="action-href" placeholder="https://...">
      <input type="text" data-field="action-download" placeholder="Download-Dateiname (optional)">
      <input type="text" data-field="action-track" placeholder="Tracking-ID (optional)">
      <label class="editor-inline-checkbox"><input type="checkbox" data-field="action-icon"> Download-Icon anzeigen</label>
      <button type="button" class="editor-repeat-remove" title="Entfernen">×</button>
    `;
    row.querySelector('[data-field="action-label-en"]').value = data.labelEn || '';
    row.querySelector('[data-field="action-label-de"]').value = data.labelDe || '';
    row.querySelector('[data-field="action-href"]').value = data.href || '';
    row.querySelector('[data-field="action-download"]').value = data.downloadFile || '';
    row.querySelector('[data-field="action-track"]').value = data.trackId || '';
    row.querySelector('[data-field="action-icon"]').checked = !!data.hasIcon;
    row.querySelector('.editor-repeat-remove').addEventListener('click', () => makeRemoveHandler(modalActionsList, addActionRow)(row));
    modalActionsList.appendChild(row);
  }

  function setActionRows(items) {
    if (!modalActionsList) return;
    clearContainer(modalActionsList);
    const list = Array.isArray(items) && items.length ? items : [{}];
    list.forEach((item) => addActionRow(item));
  }

  function collectActions() {
    if (!modalActionsList) return [];
    return Array.from(modalActionsList.querySelectorAll('.editor-repeat-row'))
      .map((row) => {
        const href = (row.querySelector('[data-field="action-href"]') || {}).value || '';
        const labelEn = (row.querySelector('[data-field="action-label-en"]') || {}).value || '';
        const labelDe = (row.querySelector('[data-field="action-label-de"]') || {}).value || '';
        const downloadFile = (row.querySelector('[data-field="action-download"]') || {}).value || '';
        const trackId = (row.querySelector('[data-field="action-track"]') || {}).value || '';
        const hasIcon = !!(row.querySelector('[data-field="action-icon"]') || {}).checked;
        if (!href.trim()) return null;
        return { href: href.trim(), labelEn: labelEn.trim(), labelDe: labelDe.trim(), downloadFile: downloadFile.trim(), trackId: trackId.trim(), hasIcon };
      })
      .filter(Boolean);
  }

  function addStatRow(data = {}) {
    if (!modalStatsList) return;
    const row = document.createElement('div');
    row.className = 'editor-repeat-row';
    row.innerHTML = `
      <input type="text" data-field="stat-label-en" placeholder="Label (EN)">
      <input type="text" data-field="stat-label-de" placeholder="Label (DE)">
      <input type="text" data-field="stat-value" placeholder="Wert">
      <button type="button" class="editor-repeat-remove" title="Entfernen">×</button>
    `;
    row.dataset.labelFallback = data.label || '';
    row.querySelector('[data-field="stat-label-en"]').value = data.labelEn || '';
    row.querySelector('[data-field="stat-label-de"]').value = data.labelDe || '';
    row.querySelector('[data-field="stat-value"]').value = data.value || '';
    row.querySelector('.editor-repeat-remove').addEventListener('click', () => makeRemoveHandler(modalStatsList, addStatRow)(row));
    modalStatsList.appendChild(row);
  }

  function setStatRows(items) {
    if (!modalStatsList) return;
    clearContainer(modalStatsList);
    const list = Array.isArray(items) && items.length ? items : [{}];
    list.forEach((item) => addStatRow(item));
  }

  function collectStats() {
    if (!modalStatsList) return [];
    return Array.from(modalStatsList.querySelectorAll('.editor-repeat-row'))
      .map((row) => {
        const value = (row.querySelector('[data-field="stat-value"]') || {}).value || '';
        const labelEn = (row.querySelector('[data-field="stat-label-en"]') || {}).value || '';
        const labelDe = (row.querySelector('[data-field="stat-label-de"]') || {}).value || '';
        const fallback = row.dataset.labelFallback || '';
        if (!(value.trim() || labelEn.trim() || labelDe.trim() || fallback.trim())) return null;
        return { value: value.trim(), labelEn: labelEn.trim(), labelDe: labelDe.trim(), label: fallback.trim() };
      })
      .filter(Boolean);
  }

  function addInfoRow(data = {}) {
    if (!modalInfoList) return;
    const row = document.createElement('div');
    row.className = 'editor-repeat-row';
    row.innerHTML = `
      <input type="text" data-field="info-key" placeholder="Bezeichnung">
      <input type="text" data-field="info-value" placeholder="Wert">
      <input type="text" data-field="info-url" placeholder="Link (optional)">
      <label class="editor-inline-checkbox"><input type="checkbox" data-field="info-new-tab"> In neuem Tab öffnen</label>
      <button type="button" class="editor-repeat-remove" title="Entfernen">×</button>
    `;
    row.querySelector('[data-field="info-key"]').value = data.key || '';
    row.querySelector('[data-field="info-value"]').value = data.value || '';
    row.querySelector('[data-field="info-url"]').value = data.url || '';
    row.querySelector('[data-field="info-new-tab"]').checked = !!data.newTab;
    row.querySelector('.editor-repeat-remove').addEventListener('click', () => makeRemoveHandler(modalInfoList, addInfoRow)(row));
    modalInfoList.appendChild(row);
  }

  function setInfoRows(items) {
    if (!modalInfoList) return;
    clearContainer(modalInfoList);
    const list = Array.isArray(items) && items.length ? items : [{}];
    list.forEach((item) => addInfoRow(item));
  }

  function collectInfoRows() {
    if (!modalInfoList) return [];
    return Array.from(modalInfoList.querySelectorAll('.editor-repeat-row'))
      .map((row) => {
        const key = (row.querySelector('[data-field="info-key"]') || {}).value || '';
        const value = (row.querySelector('[data-field="info-value"]') || {}).value || '';
        const url = (row.querySelector('[data-field="info-url"]') || {}).value || '';
        const newTab = !!(row.querySelector('[data-field="info-new-tab"]') || {}).checked;
        if (!(key.trim() || value.trim())) return null;
        return { key: key.trim(), value: value.trim(), url: url.trim(), newTab };
      })
      .filter(Boolean);
  }

  function addTagRow(data = {}) {
    if (!modalTagsList) return;
    const row = document.createElement('div');
    row.className = 'editor-repeat-row';
    row.innerHTML = `
      <input type="text" data-field="tag-text" placeholder="Tag">
      <button type="button" class="editor-repeat-remove" title="Entfernen">×</button>
    `;
    const value = typeof data === 'string' ? data : (data.text || '');
    row.querySelector('[data-field="tag-text"]').value = value;
    row.querySelector('.editor-repeat-remove').addEventListener('click', () => makeRemoveHandler(modalTagsList, addTagRow)(row));
    modalTagsList.appendChild(row);
  }

  function setTagRows(items) {
    if (!modalTagsList) return;
    clearContainer(modalTagsList);
    const list = Array.isArray(items) && items.length ? items : [{}];
    list.forEach((item) => addTagRow(item));
  }

  function collectTags() {
    if (!modalTagsList) return [];
    return Array.from(modalTagsList.querySelectorAll('.editor-repeat-row'))
      .map((row) => {
        const text = (row.querySelector('[data-field="tag-text"]') || {}).value || '';
        return text.trim() ? text.trim() : null;
      })
      .filter(Boolean);
  }

  function addTextRow(container, data = {}, field = 'text', placeholder = '') {
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'editor-repeat-row';
    row.innerHTML = `
      <textarea data-field="${field}" placeholder="${placeholder}"></textarea>
      <button type="button" class="editor-repeat-remove" title="Entfernen">×</button>
    `;
    row.querySelector(`[data-field="${field}"]`).value = data[field] || data.text || '';
    row.querySelector('.editor-repeat-remove').addEventListener('click', () => makeRemoveHandler(container, (d) => addTextRow(container, d, field, placeholder))(row));
    container.appendChild(row);
  }

  function addDescriptionRow(data = {}) {
    addTextRow(modalDescriptionList, data, 'text', 'Absatz-Text');
  }

  function addStepRow(data = {}) {
    addTextRow(modalStepsList, data, 'text', 'Schritt');
  }

  function setDescriptionRows(items) {
    if (!modalDescriptionList) return;
    clearContainer(modalDescriptionList);
    const list = Array.isArray(items) && items.length ? items.map((text) => ({ text })) : [{}];
    list.forEach((item) => addDescriptionRow(item));
  }

  function collectDescriptionRows() {
    if (!modalDescriptionList) return [];
    return Array.from(modalDescriptionList.querySelectorAll('[data-field="text"]'))
      .map((textarea) => (textarea.value || '').trim())
      .filter(Boolean);
  }

  function setStepRows(items) {
    if (!modalStepsList) return;
    clearContainer(modalStepsList);
    const list = Array.isArray(items) && items.length ? items.map((text) => ({ text })) : [{}];
    list.forEach((item) => addStepRow(item));
  }

  function collectStepRows() {
    if (!modalStepsList) return [];
    return Array.from(modalStepsList.querySelectorAll('[data-field="text"]'))
      .map((textarea) => (textarea.value || '').trim())
      .filter(Boolean);
  }

  function addVersionRow(data = {}) {
    if (!modalVersionsList) return;
    const row = document.createElement('div');
    row.className = 'editor-repeat-row';
    row.innerHTML = `
      <input type="text" data-field="version-release" placeholder="Release">
      <input type="text" data-field="version-mc" placeholder="Minecraft">
      <input type="text" data-field="version-date" placeholder="Datum">
      <input type="text" data-field="version-url" placeholder="Download-URL">
      <input type="text" data-field="version-label-en" placeholder="Download-Text (EN)">
      <input type="text" data-field="version-label-de" placeholder="Download-Text (DE)">
      <input type="text" data-field="version-file" placeholder="Download-Dateiname (optional)">
      <input type="text" data-field="version-track" placeholder="Tracking-ID (optional)">
      <button type="button" class="editor-repeat-remove" title="Entfernen">×</button>
    `;
    row.querySelector('[data-field="version-release"]').value = data.release || '';
    row.querySelector('[data-field="version-mc"]').value = data.minecraft || '';
    row.querySelector('[data-field="version-date"]').value = data.date || '';
    row.querySelector('[data-field="version-url"]').value = data.url || '';
    row.querySelector('[data-field="version-label-en"]').value = data.labelEn || '';
    row.querySelector('[data-field="version-label-de"]').value = data.labelDe || '';
    row.querySelector('[data-field="version-file"]').value = data.downloadFile || '';
    row.querySelector('[data-field="version-track"]').value = data.trackId || '';
    row.querySelector('.editor-repeat-remove').addEventListener('click', () => makeRemoveHandler(modalVersionsList, addVersionRow)(row));
    modalVersionsList.appendChild(row);
  }

  function setVersionRows(items) {
    if (!modalVersionsList) return;
    clearContainer(modalVersionsList);
    const list = Array.isArray(items) && items.length ? items : [{}];
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
        if (!(release.trim() || minecraft.trim() || date.trim() || url.trim())) return null;
        return {
          release: release.trim(),
          minecraft: minecraft.trim(),
          date: date.trim(),
          url: url.trim(),
          labelEn: labelEn.trim(),
          labelDe: labelDe.trim(),
          downloadFile: downloadFile.trim(),
          trackId: trackId.trim(),
        };
      })
      .filter(Boolean);
  }

  function addChangelogRow(data = {}) {
    if (!modalChangelogList) return;
    const row = document.createElement('div');
    row.className = 'editor-repeat-row';
    row.innerHTML = `
      <input type="text" data-field="changelog-title" placeholder="Titel / Version">
      <textarea data-field="changelog-details" placeholder="Änderungen"></textarea>
      <button type="button" class="editor-repeat-remove" title="Entfernen">×</button>
    `;
    row.querySelector('[data-field="changelog-title"]').value = data.title || '';
    row.querySelector('[data-field="changelog-details"]').value = data.details || '';
    row.querySelector('.editor-repeat-remove').addEventListener('click', () => makeRemoveHandler(modalChangelogList, addChangelogRow)(row));
    modalChangelogList.appendChild(row);
  }

  function setChangelogRows(items) {
    if (!modalChangelogList) return;
    clearContainer(modalChangelogList);
    const list = Array.isArray(items) && items.length ? items : [{}];
    list.forEach((item) => addChangelogRow(item));
  }

  function collectChangelogRows() {
    if (!modalChangelogList) return [];
    return Array.from(modalChangelogList.querySelectorAll('.editor-repeat-row'))
      .map((row) => {
        const title = (row.querySelector('[data-field="changelog-title"]') || {}).value || '';
        const details = (row.querySelector('[data-field="changelog-details"]') || {}).value || '';
        if (!(title.trim() || details.trim())) return null;
        return { title: title.trim(), details: details.trim() };
      })
      .filter(Boolean);
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
    setBadgeRows([]);
    setActionRows([]);
    setStatRows([]);
    setInfoRows([]);
    setTagRows([]);
    setDescriptionRows([]);
    setStepRows([]);
    setVersionRows([]);
    setChangelogRows([]);
    setGalleryRows([]);
    if (modalInfoTitleInput) modalInfoTitleInput.value = '';
    if (modalTagsTitleInput) modalTagsTitleInput.value = '';
    if (modalBodyInput) modalBodyInput.value = '';
    if (modalBadgesInput) modalBadgesInput.value = '';
    if (modalActionsInput) modalActionsInput.value = '';
    if (modalStatsInput) modalStatsInput.value = '';
  }

  function applyModalBodyData(data) {
    const bodyData = data || createEmptyModalBody();
    if (modalInfoTitleInput) modalInfoTitleInput.value = bodyData.infoTitle || '';
    if (modalTagsTitleInput) modalTagsTitleInput.value = bodyData.tagsTitle || '';
    setInfoRows(bodyData.infoItems || []);
    setTagRows(bodyData.tags || []);
    setDescriptionRows(bodyData.description || []);
    setStepRows(bodyData.steps || []);
    setVersionRows(bodyData.versions || []);
    setChangelogRows(bodyData.changelog || []);
    setGalleryRows(bodyData.gallery || []);
  }

  function populateModalUi(project) {
    const { modalId } = getModalRef(project);
    currentModalId = modalId || '';
    const defaults = modalDefaults.get(modalId) || { hero: '', body: '', badges: '', heroActions: '', stats: '' };
    const badgesHtml = (project && typeof project.modalBadges === 'string' && project.modalBadges.trim()) ? project.modalBadges : defaults.badges;
    const actionsHtml = (project && typeof project.modalHeroActions === 'string' && project.modalHeroActions.trim()) ? project.modalHeroActions : defaults.heroActions;
    const statsHtml = (project && typeof project.modalStats === 'string' && project.modalStats.trim()) ? project.modalStats : defaults.stats;
    const bodyHtml = (project && typeof project.modalBody === 'string' && project.modalBody.trim()) ? project.modalBody : defaults.body;
    if (modalBadgesInput) modalBadgesInput.value = badgesHtml || '';
    if (modalActionsInput) modalActionsInput.value = actionsHtml || '';
    if (modalStatsInput) modalStatsInput.value = statsHtml || '';
    if (modalBodyInput) modalBodyInput.value = bodyHtml || '';
    setBadgeRows(parseBadgesHtml(badgesHtml || ''));
    setActionRows(parseHeroActionsHtml(actionsHtml || ''));
    setStatRows(parseStatsHtml(statsHtml || ''));
    applyModalBodyData(parseModalBodyContent(bodyHtml || ''));
  }

  function collectModalBodyData() {
    return {
      infoTitle: modalInfoTitleInput ? modalInfoTitleInput.value.trim() : '',
      infoItems: collectInfoRows(),
      tagsTitle: modalTagsTitleInput ? modalTagsTitleInput.value.trim() : '',
      tags: collectTags(),
      description: collectDescriptionRows(),
      steps: collectStepRows(),
      versions: collectVersionRows(),
      changelog: collectChangelogRows(),
      gallery: collectGalleryRows(),
    };
  }

  function serialiseModalUi(projectId, type) {
    const safeType = normaliseType(type || 'datapack');
    const fallbackId = projectId && projectId.trim() ? projectId.trim() : slugifyId(titleInput ? titleInput.value : '');
    const modalId = currentModalId || `${safeType === 'printing' ? 'pr' : 'dp'}-${fallbackId || 'project'}`;
    const badgesHtml = buildBadgeHtml(collectBadges());
    const actionsHtml = buildHeroActionsHtml(collectActions(), fallbackId);
    const statsHtml = buildStatsHtml(collectStats());
    const bodyData = collectModalBodyData();
    const bodyHtml = buildModalBodyHtml(modalId, bodyData, fallbackId);
    if (modalBadgesInput) modalBadgesInput.value = badgesHtml;
    if (modalActionsInput) modalActionsInput.value = actionsHtml;
    if (modalStatsInput) modalStatsInput.value = statsHtml;
    if (modalBodyInput) modalBodyInput.value = bodyHtml;
    return {
      badges: badgesHtml,
      actions: actionsHtml,
      stats: statsHtml,
      body: bodyHtml,
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

    const modalInfo = getModalRef(project);
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

      if (!customActions) {
        const downloadPath = (project.downloadFile || '').trim();
        if (downloadPath) {
          const fileId = downloadPath.split('/').pop() || downloadPath;
          actionsEl.querySelectorAll('[data-download-file]').forEach((link) => {
            link.setAttribute('href', downloadPath);
            link.setAttribute('data-download-file', fileId);
          });
        }
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
      if (typeof project.modalBody === 'string' && project.modalBody.trim()) {
        bodyEl.innerHTML = project.modalBody;
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

  async function loadProjects(){
    if (!dpGrid && !prGrid) return;
    let data;
    try {
      data = await api('/editor/projects', { method: 'GET' });
    } catch (e) {
      console.warn('Konnte Projektliste nicht laden:', e);
      return;
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
  }

  function fillFormFromProject(project){
    idInput.value = project.id || '';
    typeInput.value = normaliseType(project.type);
    titleInput.value = project.title || '';
    mcVersionInput.value = project.mcVersion || '';
    statusInput.value = project.status || 'released';
    categoryInput.value = project.category || '';
    const tags = Array.isArray(project.tags) ? project.tags.join(', ') : (project.tags || '');
    tagsInput.value = tags;
    shortInput.value = project.shortDescription || '';
    if (modalHeroInput) {
      if (typeof project.modalHero === 'string') {
        modalHeroInput.value = project.modalHero;
      } else {
        modalHeroInput.value = extractModalHero(project);
      }
    }
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
    const category = (categoryInput.value || '').trim();
    const tagsRaw = (tagsInput.value || '').trim();
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
    const shortDescription = (shortInput.value || '').trim();
    const modalHero = modalHeroInput ? (modalHeroInput.value || '').trim() : '';
    const serialised = serialiseModalUi(id || slugifyId(title), type);
    const modalBody = serialised.body;
    const modalBadges = serialised.badges;
    const modalHeroActions = serialised.actions;
    const modalStats = serialised.stats;
    const downloadFile = (downloadInput.value || '').trim();
    const image = (imageInput.value || '').trim();
    return { id, type, title, mcVersion, status, category, tags, shortDescription, modalHero, modalBody, modalBadges, modalHeroActions, modalStats, downloadFile, image };
  }

  function openEditorForCreate(type){
    editingProject = null;
    if (deleteBtn) deleteBtn.hidden = true;
    const safeType = normaliseType(type || 'datapack');
    editorTitleEl.textContent = safeType === 'printing' ? 'Neues 3D-Print-Projekt' : 'Neues Datapack';
    idInput.value = '';
    typeInput.value = safeType;
    titleInput.value = '';
    mcVersionInput.value = '';
    statusInput.value = 'released';
    categoryInput.value = '';
    tagsInput.value = '';
    shortInput.value = '';
    if (modalHeroInput) modalHeroInput.value = '';
    resetModalUi();
    currentModalId = '';
    downloadInput.value = '';
    imageInput.value = 'assets/img/logo.jpg';
    applyTypeUi(safeType);
    updateSubtitle(safeType, 'create');
    openEditorModal('create');
  }

  function openEditorForEdit(project){
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
    if (!editorOn || !token) {
      alert('Bitte zuerst einloggen und Editor-Modus aktivieren.');
      return;
    }
    const data = collectFormData();
    if (!data.title) {
      alert('Titel darf nicht leer sein.');
      return;
    }
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
      badge: () => addBadgeRow({}),
      action: () => addActionRow({}),
      stat: () => addStatRow({}),
      info: () => addInfoRow({}),
      tag: () => addTagRow({}),
      description: () => addDescriptionRow({}),
      step: () => addStepRow({}),
      version: () => addVersionRow({}),
      changelog: () => addChangelogRow({}),
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
  checkSession();
  loadProjects();
  applyTypeUi(typeInput ? typeInput.value : 'datapack');
  updateSubtitle(typeInput ? typeInput.value : 'datapack', 'create');

})();
