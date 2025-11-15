(function(){
  'use strict';

  const API_BASE = 'http://localhost:3001'; // server/src/editor-server.js

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
    const opts = options || {};
    const headers = opts.headers || {};
    if (!(opts.body instanceof FormData) && !('Content-Type' in headers)) {
      headers['Content-Type'] = 'application/json';
    }
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
    opts.headers = headers;
    opts.credentials = 'omit';
    const res = await fetch(API_BASE + path, opts);
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
    card.className = isDatapack ? 'card dp-card' : 'card pr-card';
    card.setAttribute('data-project-id', project.id);
    card.setAttribute('data-project-type', type);
    const category = project.category || '';
    const tags = Array.isArray(project.tags) ? project.tags : [];
    const subcats = category || (tags.join(',') || '');
    if (subcats) card.setAttribute('data-subcats', subcats);

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
      const res = await fetch(API_BASE + '/editor/projects', { method: 'GET' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
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

    // Add "add" cards for editor mode
    if (dpGrid) dpGrid.appendChild(createAddCard('datapack'));
    if (prGrid) prGrid.appendChild(createAddCard('printing'));

    updateCounts();
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
    const downloadFile = (downloadInput.value || '').trim();
    const image = (imageInput.value || '').trim();
    return { id, type, title, mcVersion, status, category, tags, shortDescription, downloadFile, image };
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
