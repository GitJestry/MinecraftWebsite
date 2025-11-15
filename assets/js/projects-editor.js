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
  const modalInfoInput = document.getElementById('pe-modal-info');
  const modalDescriptionInput = document.getElementById('pe-modal-description');
  const modalInstallInput = document.getElementById('pe-modal-install');
  const modalVersionsInput = document.getElementById('pe-modal-versions');
  const modalChangelogInput = document.getElementById('pe-modal-changelog');
  const modalGalleryInput = document.getElementById('pe-modal-gallery');
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
    modalDefaults.set(modalId, {
      hero: hero ? hero.textContent.trim() : '',
      body: body ? body.innerHTML.trim() : '',
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

  function getModalBodySource(project) {
    const { modal } = getModalRef(project);
    if (modal) {
      const existing = modal.querySelector('.modal-body');
      if (existing) return existing;
    }
    if (project && typeof project.modalBody === 'string' && project.modalBody.trim()) {
      const temp = document.createElement('div');
      temp.innerHTML = project.modalBody;
      return temp;
    }
    return null;
  }

  function extractInfoPairs(project) {
    const source = getModalBodySource(project);
    if (!source) return [];
    const list = [];
    const items = source.querySelectorAll('.info-list li');
    items.forEach((li) => {
      const spans = li.querySelectorAll('span');
      if (!spans.length) return;
      const label = spans[0] ? spans[0].textContent.trim() : '';
      let value = '';
      if (spans.length > 1) {
        value = spans[spans.length - 1].textContent.trim();
      } else {
        const clone = li.cloneNode(true);
        const first = clone.querySelector('span');
        if (first) first.remove();
        value = clone.textContent.trim();
      }
      if (label || value) {
        list.push({ label, value });
      }
    });
    return list;
  }

  function findPanelBySuffix(source, suffix) {
    if (!source) return null;
    return source.querySelector('[role="tabpanel"][id$="-' + suffix + '"]');
  }

  function extractDescriptionHtml(project) {
    const source = getModalBodySource(project);
    if (!source) return '';
    const panel = findPanelBySuffix(source, 'description');
    if (!panel) return '';
    return panel.innerHTML.trim();
  }

  function extractChangelogHtml(project) {
    const source = getModalBodySource(project);
    if (!source) return '';
    const panel = findPanelBySuffix(source, 'changelog');
    if (!panel) return '';
    return panel.innerHTML.trim();
  }

  function extractInstallationSteps(project) {
    const source = getModalBodySource(project);
    if (!source) return [];
    const panel = findPanelBySuffix(source, 'installation');
    if (!panel) return [];
    const steps = [];
    const stepNodes = panel.querySelectorAll('.step');
    if (stepNodes.length) {
      stepNodes.forEach((step) => {
        const textEl = step.querySelector('div:last-child');
        const text = textEl ? textEl.textContent.trim() : step.textContent.trim();
        if (text) steps.push(text);
      });
    } else {
      const text = panel.textContent.trim();
      if (text) steps.push(text);
    }
    return steps;
  }

  function extractVersionRows(project) {
    const source = getModalBodySource(project);
    if (!source) return [];
    const panel = findPanelBySuffix(source, 'versions');
    if (!panel) return [];
    const table = panel.querySelector('table');
    if (!table) return [];
    const rows = [];
    const trNodes = table.querySelectorAll('tbody tr');
    trNodes.forEach((tr) => {
      const cells = tr.querySelectorAll('td');
      if (cells.length < 4) return;
      const release = cells[0].textContent.trim();
      const minecraft = cells[1].textContent.trim();
      const date = cells[2].textContent.trim();
      let download = cells[3].textContent.trim();
      const link = cells[3].querySelector('a');
      if (link) {
        download = link.getAttribute('href') || download;
      }
      rows.push({ release, minecraft, date, download });
    });
    return rows;
  }

  function extractGalleryItems(project) {
    const source = getModalBodySource(project);
    if (!source) return [];
    const panel = findPanelBySuffix(source, 'gallery');
    if (!panel) return [];
    const images = [];
    const imgNodes = panel.querySelectorAll('img');
    imgNodes.forEach((img) => {
      const src = img.getAttribute('src') || '';
      const alt = img.getAttribute('alt') || '';
      if (src) images.push({ src, alt });
    });
    return images;
  }

  function formatPairsForInput(pairs) {
    if (!pairs || !pairs.length) return '';
    return pairs.map((pair) => {
      const label = pair.label || '';
      const value = pair.value || '';
      return label + '|' + value;
    }).join('\n');
  }

  function formatListForInput(list) {
    if (!list || !list.length) return '';
    return list.join('\n');
  }

  function formatVersionsForInput(rows) {
    if (!rows || !rows.length) return '';
    return rows.map((row) => {
      const release = row.release || '';
      const minecraft = row.minecraft || '';
      const date = row.date || '';
      const download = row.download || '';
      return [release, minecraft, date, download].join('|');
    }).join('\n');
  }

  function formatGalleryForInput(items) {
    if (!items || !items.length) return '';
    return items.map((item) => {
      const src = item.src || '';
      const alt = item.alt || '';
      return src + '|' + alt;
    }).join('\n');
  }

  function parsePairsInput(value) {
    if (!value) return [];
    return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [labelRaw, ...rest] = line.split('|');
      const label = (labelRaw || '').trim();
      const valuePart = rest.join('|').trim();
      return { label, value: valuePart };
    }).filter((pair) => pair.label || pair.value);
  }

  function parseListInput(value) {
    if (!value) return [];
    return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  function parseVersionsInput(value) {
    if (!value) return [];
    return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const parts = line.split('|');
      const release = (parts[0] || '').trim();
      const minecraft = (parts[1] || '').trim();
      const date = (parts[2] || '').trim();
      const download = parts.slice(3).join('|').trim();
      return { release, minecraft, date, download };
    }).filter((row) => row.release || row.minecraft || row.date || row.download);
  }

  function parseGalleryInput(value) {
    if (!value) return [];
    return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [srcRaw, ...altParts] = line.split('|');
      const src = (srcRaw || '').trim();
      const alt = altParts.join('|').trim();
      return { src, alt };
    }).filter((item) => item.src);
  }

  function normaliseModalBaseId(modalId, projectId, type) {
    let base = (modalId || '').trim();
    if (!base && projectId) {
      base = projectId.trim();
    }
    if (!base) {
      base = type === 'printing' ? 'pr-project' : 'dp-project';
    }
    base = base.replace(/[^a-zA-Z0-9\-_]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
    if (!base) {
      base = type === 'printing' ? 'pr-project' : 'dp-project';
    }
    return base;
  }

  function buildInfoCardHtml(pairs) {
    if (!pairs || !pairs.length) return '';
    const items = pairs.map((pair) => {
      const label = escapeHtml(pair.label || '');
      const value = escapeHtml(pair.value || '');
      return '<li><span class="k">' + label + '</span><span>' + value + '</span></li>';
    }).join('');
    return '<div class="info-card"><h4>Project info</h4><ul class="info-list">' + items + '</ul></div>';
  }

  function buildTagsCardHtml(tags) {
    if (!tags || !tags.length) return '';
    const items = tags.map((tag) => '<span class="chip">' + escapeHtml(tag) + '</span>').join('');
    return '<div class="info-card"><h4>Tags</h4><div class="info-tags">' + items + '</div></div>';
  }

  function buildInstallationHtml(steps) {
    if (!steps || !steps.length) return '';
    const items = steps.map((step) => '<div class="step"><div></div><div>' + escapeHtml(step) + '</div></div>').join('');
    return '<div class="steps">' + items + '</div>';
  }

  function buildVersionsHtml(rows) {
    if (!rows || !rows.length) return '';
    const bodyRows = rows.map((row) => {
      const release = escapeHtml(row.release || '');
      const minecraft = escapeHtml(row.minecraft || '');
      const date = escapeHtml(row.date || '');
      const downloadRaw = row.download || '';
      const downloadEsc = downloadRaw ? escapeHtml(downloadRaw) : '';
      const downloadFile = downloadRaw.split('/').pop() || downloadRaw;
      const downloadFileEsc = downloadFile ? escapeHtml(downloadFile) : '';
      let link = '';
      if (downloadEsc) {
        link = '<a data-download-file="' + downloadFileEsc + '" data-track-download="' + downloadFileEsc + '" download href="' + downloadEsc + '"><span class="lang-en">Download</span><span class="lang-de">Herunterladen</span></a>';
      }
      return '<tr><td>' + release + '</td><td>' + minecraft + '</td><td>' + date + '</td><td>' + link + '</td></tr>';
    }).join('');
    return '<table class="versions-table"><thead><tr><th>Release</th><th>Minecraft</th><th>Date</th><th>File</th></tr></thead><tbody>' + bodyRows + '</tbody></table>';
  }

  function buildGalleryHtml(items) {
    if (!items || !items.length) return '';
    const imgs = items.map((item) => {
      const src = escapeHtml(item.src || '');
      const alt = escapeHtml(item.alt || '');
      return '<img alt="' + alt + '" loading="lazy" src="' + src + '"/>';
    }).join('');
    return '<div class="gallery">' + imgs + '</div>';
  }

  function buildTabLabel(key) {
    switch (key) {
      case 'changelog':
        return '<span class="lang-en">Changelog</span><span class="lang-de">Änderungsprotokoll</span>';
      case 'gallery':
        return 'Gallery';
      case 'versions':
        return 'Versions';
      case 'installation':
        return 'Installation';
      default:
        return 'Description';
    }
  }

  function buildModalBodyHtml(opts) {
    const { modalId, id, type, infoPairs, tags, descriptionHtml, installationSteps, versions, changelogHtml, gallery } = opts;
    const baseId = normaliseModalBaseId(modalId, id, type);
    const ids = {
      description: baseId + '-description',
      installation: baseId + '-installation',
      versions: baseId + '-versions',
      changelog: baseId + '-changelog',
      gallery: baseId + '-gallery',
    };

    const sidebarParts = [];
    const infoCard = buildInfoCardHtml(infoPairs);
    if (infoCard) sidebarParts.push(infoCard);
    const tagsCard = buildTagsCardHtml(tags);
    if (tagsCard) sidebarParts.push(tagsCard);
    const sidebarHtml = sidebarParts.length ? '<aside class="sidebar">' + sidebarParts.join('') + '</aside>' : '';

    const panels = [];
    if (descriptionHtml) {
      panels.push({
        key: 'description',
        id: ids.description,
        className: 'prose',
        html: descriptionHtml,
      });
    }
    if (gallery && gallery.length) {
      panels.push({
        key: 'gallery',
        id: ids.gallery,
        className: '',
        html: buildGalleryHtml(gallery),
      });
    }
    if (installationSteps && installationSteps.length) {
      panels.push({
        key: 'installation',
        id: ids.installation,
        className: 'prose',
        html: buildInstallationHtml(installationSteps),
      });
    }
    if (versions && versions.length) {
      panels.push({
        key: 'versions',
        id: ids.versions,
        className: '',
        html: buildVersionsHtml(versions),
      });
    }
    if (changelogHtml) {
      panels.push({
        key: 'changelog',
        id: ids.changelog,
        className: 'prose',
        html: changelogHtml,
      });
    }

    let contentHtml = '<section class="content">';
    if (panels.length) {
      const navButtons = panels.map((panel, index) => {
        const active = index === 0;
        return '<button aria-selected="' + (active ? 'true' : 'false') + '" class="' + (active ? 'active' : '') + '" data-tab="' + panel.key + '" role="tab">' + buildTabLabel(panel.key) + '</button>';
      }).join('');
      const panelsHtml = panels.map((panel, index) => {
        const classes = [panel.className || ''];
        if (index === 0) classes.push('active');
        const classAttr = classes.filter(Boolean).join(' ');
        return '<div class="' + classAttr + '" id="' + panel.id + '" role="tabpanel">' + panel.html + '</div>';
      }).join('');
      contentHtml += '<nav aria-label="' + escapeHtml('Project Tabs') + '" class="tabs" role="tablist">' + navButtons + '</nav>';
      contentHtml += '<div class="tabpanels">' + panelsHtml + '</div>';
    } else {
      contentHtml += '<div class="prose"><p><span class="lang-en">No additional content available.</span><span class="lang-de">Keine weiteren Inhalte hinterlegt.</span></p></div>';
    }
    contentHtml += '</section>';

    return sidebarHtml + contentHtml;
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
    const defaults = modalDefaults.get(modalId) || { hero: '', body: '' };

    const heroEl = modal.querySelector('.modal-hero .muted');
    if (heroEl) {
      const customHero = typeof project.modalHero === 'string' ? project.modalHero.trim() : '';
      const fallbackHero = customHero
        || (typeof project.shortDescription === 'string' ? project.shortDescription.trim() : '')
        || defaults.hero
        || '';
      heroEl.textContent = fallbackHero;
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
    if (modalBodyInput) {
      if (typeof project.modalBody === 'string' && project.modalBody.trim()) {
        modalBodyInput.value = project.modalBody;
      } else {
        modalBodyInput.value = extractModalBody(project);
      }
    }
    if (modalInfoInput) {
      modalInfoInput.value = formatPairsForInput(extractInfoPairs(project));
    }
    if (modalDescriptionInput) {
      modalDescriptionInput.value = extractDescriptionHtml(project);
    }
    if (modalInstallInput) {
      modalInstallInput.value = formatListForInput(extractInstallationSteps(project));
    }
    if (modalVersionsInput) {
      modalVersionsInput.value = formatVersionsForInput(extractVersionRows(project));
    }
    if (modalChangelogInput) {
      modalChangelogInput.value = extractChangelogHtml(project);
    }
    if (modalGalleryInput) {
      modalGalleryInput.value = formatGalleryForInput(extractGalleryItems(project));
    }
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
    const infoPairs = modalInfoInput ? parsePairsInput(modalInfoInput.value) : [];
    const descriptionHtml = modalDescriptionInput ? modalDescriptionInput.value.trim() : '';
    const installationSteps = modalInstallInput ? parseListInput(modalInstallInput.value) : [];
    const versionRows = modalVersionsInput ? parseVersionsInput(modalVersionsInput.value) : [];
    const changelogHtml = modalChangelogInput ? modalChangelogInput.value.trim() : '';
    const galleryItems = modalGalleryInput ? parseGalleryInput(modalGalleryInput.value) : [];
    let modalId = '';
    if (editingProject) {
      const ref = getModalRef(editingProject);
      modalId = ref.modalId || '';
    }
    const modalBody = buildModalBodyHtml({
      modalId,
      id,
      type,
      infoPairs,
      tags,
      descriptionHtml,
      installationSteps,
      versions: versionRows,
      changelogHtml,
      gallery: galleryItems,
    }).trim();
    if (modalBodyInput) {
      modalBodyInput.value = modalBody;
    }
    const downloadFile = (downloadInput.value || '').trim();
    const image = (imageInput.value || '').trim();
    return { id, type, title, mcVersion, status, category, tags, shortDescription, modalHero, modalBody, downloadFile, image };
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
    if (modalBodyInput) modalBodyInput.value = '';
    if (modalInfoInput) modalInfoInput.value = '';
    if (modalDescriptionInput) modalDescriptionInput.value = '';
    if (modalInstallInput) modalInstallInput.value = '';
    if (modalVersionsInput) modalVersionsInput.value = '';
    if (modalChangelogInput) modalChangelogInput.value = '';
    if (modalGalleryInput) modalGalleryInput.value = '';
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
