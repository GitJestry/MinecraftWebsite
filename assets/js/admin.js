(function(){
  'use strict';

  const cms = window.MIRL_CMS || {};
  const PROJECTS_KEY = cms.PROJECTS_KEY || 'mirl.projects.v1';
  const PASSWORD_KEY = cms.PASSWORD_KEY || 'mirl.admin.password.v1';
  const DEFAULT_HASH = cms.DEFAULT_PASSWORD_HASH || '';
  const SESSION_KEY = 'mirl.admin.session.v1';
  const FALLBACK_PROJECTS = JSON.parse(JSON.stringify(cms.DEFAULT_PROJECTS || { datapacks: [], printing: [] }));

  const loginCard = document.getElementById('login-card');
  const loginForm = document.getElementById('login-form');
  const editorCard = document.getElementById('editor-card');
  const statusBanner = document.getElementById('admin-status');
  const projectGroups = document.getElementById('project-groups');
  const projectForm = document.getElementById('project-form');
  const formTitle = document.getElementById('form-title');
  const newProjectBtn = document.getElementById('new-project');
  const resetProjectsBtn = document.getElementById('reset-projects');
  const exportBtn = document.getElementById('export-projects');
  const importInput = document.getElementById('import-projects');
  const logoutBtn = document.getElementById('logout-btn');
  const categorySelect = document.getElementById('project-category');
  const typeInput = document.getElementById('project-type');
  const cancelEditBtn = document.getElementById('cancel-edit');
  const idInput = document.getElementById('project-id');
  const titleInput = document.getElementById('project-title');
  const summaryInput = document.getElementById('project-summary');
  const descriptionInput = document.getElementById('project-description');
  const imageInput = document.getElementById('project-image');
  const tagsInput = document.getElementById('project-tags');
  const linksInput = document.getElementById('project-links');
  const backupDownload = document.getElementById('download-backup');
  const backupRestore = document.getElementById('restore-backup');
  const passwordForm = document.getElementById('password-form');

  if (!loginForm || !projectForm) {
    return; // Not on admin page
  }

  function sessionGet(key){
    try { return sessionStorage.getItem(key); } catch(err){ return null; }
  }
  function sessionSet(key, value){
    try { sessionStorage.setItem(key, value); } catch(err){}
  }
  function sessionRemove(key){
    try { sessionStorage.removeItem(key); } catch(err){}
  }

  function showStatus(message, tone){
    if (!statusBanner) return;
    statusBanner.textContent = message;
    statusBanner.dataset.visible = message ? 'true' : 'false';
    statusBanner.dataset.tone = tone || 'info';
    if (message) {
      clearTimeout(showStatus._timer);
      showStatus._timer = setTimeout(() => {
        statusBanner.dataset.visible = 'false';
      }, 4000);
    }
  }

  function setLoggedIn(isLoggedIn){
    if (isLoggedIn) {
      loginCard?.setAttribute('hidden', '');
      editorCard?.removeAttribute('hidden');
      sessionSet(SESSION_KEY, '1');
    } else {
      editorCard?.setAttribute('hidden', '');
      loginCard?.removeAttribute('hidden');
      sessionRemove(SESSION_KEY);
    }
  }

  function deepClone(value){
    return JSON.parse(JSON.stringify(value || {}));
  }

  function getDefaultProjects(){
    return deepClone(FALLBACK_PROJECTS);
  }

  function loadProjects(){
    const defaults = getDefaultProjects();
    try {
      const raw = localStorage.getItem(PROJECTS_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      return {
        datapacks: Array.isArray(parsed.datapacks) ? parsed.datapacks : defaults.datapacks,
        printing: Array.isArray(parsed.printing) ? parsed.printing : defaults.printing
      };
    } catch(err){
      console.warn('Failed to load saved projects:', err);
      return defaults;
    }
  }

  function saveProjects(data){
    const safe = {
      datapacks: Array.isArray(data.datapacks) ? data.datapacks : [],
      printing: Array.isArray(data.printing) ? data.printing : []
    };
    try {
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(safe));
      document.dispatchEvent(new CustomEvent('projects-updated'));
    } catch(err){
      console.error('Unable to save projects:', err);
      showStatus('Could not save projects. Storage may be disabled.', 'warn');
    }
  }

  function slugify(text){
    return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  }

  function parseTags(text){
    if (!text) return [];
    return text.split(',').map(tag => tag.trim()).filter(Boolean);
  }

  function parseLinks(text){
    if (!text) return [];
    return text.split(/\n+/).map(line => line.trim()).filter(Boolean).map(line => {
      const parts = line.split('|').map(p => p.trim());
      return {
        label: parts[0] || 'Link',
        url: parts[1] || '',
        download: (parts[2] || '').toLowerCase() === 'download' || (parts[2] || '').toLowerCase() === 'true'
      };
    }).filter(link => !!link.url);
  }

  function formatLinks(links){
    if (!Array.isArray(links) || !links.length) return '';
    return links.map(link => {
      const flag = link.download ? 'download' : '';
      return [link.label || 'Link', link.url || '', flag].filter(Boolean).join(' | ');
    }).join('\n');
  }

  async function hashString(str){
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      const buffer = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback (not cryptographically strong)
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return String(hash);
  }

  async function verifyPassword(password){
    let stored = null;
    try { stored = localStorage.getItem(PASSWORD_KEY); } catch(err){ stored = null; }
    const hash = await hashString(password);
    if (stored) {
      return hash === stored;
    }
    if (DEFAULT_HASH) {
      return hash === DEFAULT_HASH;
    }
    return false;
  }

  async function setPassword(password){
    const hash = await hashString(password);
    try {
      localStorage.setItem(PASSWORD_KEY, hash);
    } catch(err){
      console.error('Unable to save password:', err);
      showStatus('Could not update password. Storage may be disabled.', 'warn');
      throw err;
    }
  }

  function resetForm(){
    projectForm.reset();
    if (idInput) idInput.value = '';
    categorySelect.value = 'datapacks';
    if (titleInput) titleInput.value = '';
    if (summaryInput) summaryInput.value = '';
    if (descriptionInput) descriptionInput.value = '';
    if (imageInput) imageInput.value = '';
    if (tagsInput) tagsInput.value = '';
    if (linksInput) linksInput.value = '';
    updateTypePlaceholder();
    updateFormTitle(false);
  }

  function updateFormTitle(isEditing){
    if (!formTitle) return;
    formTitle.querySelector('.lang-en').textContent = isEditing ? 'Edit project' : 'Add project';
    formTitle.querySelector('.lang-de').textContent = isEditing ? 'Projekt bearbeiten' : 'Projekt hinzufügen';
  }

  function updateTypePlaceholder(){
    const map = {
      datapacks: 'Datapack',
      printing: '3D Print'
    };
    const placeholder = map[categorySelect.value] || 'Project';
    typeInput.placeholder = placeholder;
    if (!typeInput.value) {
      typeInput.value = placeholder;
    }
  }

  function renderProjects(){
    const data = loadProjects();
    projectGroups.innerHTML = '';
    const categories = [
      { key: 'datapacks', labelEN: 'Datapacks', labelDE: 'Datapacks' },
      { key: 'printing', labelEN: '3D Printing', labelDE: '3D-Druck' }
    ];
    categories.forEach(cat => {
      const list = Array.isArray(data[cat.key]) ? data[cat.key] : [];
      const details = document.createElement('details');
      details.open = true;
      const summary = document.createElement('summary');
      summary.innerHTML = `<span class="lang-en">${cat.labelEN}</span><span class="lang-de">${cat.labelDE}</span>`;
      details.appendChild(summary);
      const ul = document.createElement('ul');
      ul.className = 'project-list';
      if (!list.length) {
        const empty = document.createElement('li');
        empty.className = 'project-empty';
        empty.innerHTML = '<span class="lang-en">No projects yet.</span><span class="lang-de">Noch keine Projekte.</span>';
        ul.appendChild(empty);
      } else {
        list.forEach(project => {
          const li = document.createElement('li');
          const meta = document.createElement('div');
          meta.className = 'meta';
          const title = document.createElement('div');
          title.className = 'title';
          title.textContent = project.title || 'Untitled project';
          const summaryText = document.createElement('div');
          summaryText.className = 'summary';
          summaryText.textContent = project.summary || '';
          meta.append(title, summaryText);
          const actions = document.createElement('div');
          actions.className = 'actions';
          const editBtn = document.createElement('button');
          editBtn.className = 'edit';
          editBtn.type = 'button';
          editBtn.innerHTML = '<span class="lang-en">Edit</span><span class="lang-de">Bearbeiten</span>';
          editBtn.addEventListener('click', () => startEdit(cat.key, project));
          const deleteBtn = document.createElement('button');
          deleteBtn.className = 'delete';
          deleteBtn.type = 'button';
          deleteBtn.innerHTML = '<span class="lang-en">Delete</span><span class="lang-de">Löschen</span>';
          deleteBtn.addEventListener('click', () => removeProject(cat.key, project.id));
          actions.append(editBtn, deleteBtn);
          li.append(meta, actions);
          ul.appendChild(li);
        });
      }
      details.appendChild(ul);
      projectGroups.appendChild(details);
    });
  }

  function startEdit(category, project){
    if (idInput) idInput.value = project.id;
    categorySelect.value = category;
    typeInput.value = project.type || '';
    updateTypePlaceholder();
    if (titleInput) titleInput.value = project.title || '';
    if (summaryInput) summaryInput.value = project.summary || '';
    if (descriptionInput) descriptionInput.value = project.description || '';
    if (imageInput) imageInput.value = project.image || '';
    if (tagsInput) tagsInput.value = (project.tags || []).join(', ');
    if (linksInput) linksInput.value = formatLinks(project.links);
    updateFormTitle(true);
    showStatus('Loaded project for editing.', 'info');
    window.scrollTo({ top: projectForm.offsetTop - 80, behavior: 'smooth' });
  }

  function removeProject(category, id){
    if (!confirm('Delete this project? This cannot be undone.')) return;
    const data = loadProjects();
    const list = Array.isArray(data[category]) ? data[category] : [];
    const next = list.filter(item => item.id !== id);
    data[category] = next;
    saveProjects(data);
    renderProjects();
    showStatus('Project deleted.', 'warn');
  }

  function handleProjectSubmit(evt){
    evt.preventDefault();
    const formData = new FormData(projectForm);
    const category = formData.get('category');
    const idField = formData.get('id');
    const title = (formData.get('title') || '').toString().trim();
    if (!title) {
      showStatus('Title is required.', 'warn');
      return;
    }
    const projects = loadProjects();
    const list = Array.isArray(projects[category]) ? projects[category] : [];
    let id = (idField || '').toString();
    if (!id) {
      const base = slugify(title);
      id = base;
      let suffix = 1;
      while (list.some(item => item.id === id)) {
        id = `${base}-${suffix++}`;
      }
    }
    const project = {
      id,
      title,
      summary: (formData.get('summary') || '').toString(),
      description: (formData.get('description') || '').toString(),
      image: (formData.get('image') || '').toString() || 'assets/img/logo.jpg',
      tags: parseTags(formData.get('tags') || ''),
      type: (formData.get('type') || '').toString() || (category === 'printing' ? '3D Print' : 'Datapack'),
      links: parseLinks(formData.get('links') || ''),
      updatedAt: new Date().toISOString()
    };

    const existingIndex = list.findIndex(item => item.id === id);
    if (existingIndex >= 0) {
      list.splice(existingIndex, 1, project);
    } else {
      list.push(project);
    }
    projects[category] = list;
    saveProjects(projects);
    renderProjects();
    resetForm();
    showStatus('Project saved.', 'success');
  }

  function handleExport(){
    const data = loadProjects();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mirl-projects.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showStatus('Backup downloaded.', 'success');
  }

  function handleImport(file){
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed !== 'object') throw new Error('Invalid file');
        saveProjects(parsed);
        renderProjects();
        showStatus('Projects imported.', 'success');
      } catch(err){
        console.error(err);
        showStatus('Import failed. Please check the file.', 'warn');
      }
    };
    reader.readAsText(file);
  }

  function handleReset(){
    if (!confirm('Reset to the built-in defaults? This removes all custom projects.')) return;
    saveProjects(getDefaultProjects());
    renderProjects();
    resetForm();
    showStatus('Projects reset to defaults.', 'info');
  }

  async function handlePasswordSubmit(evt){
    evt.preventDefault();
    const formData = new FormData(passwordForm);
    const current = (formData.get('current') || '').toString();
    const next = (formData.get('next') || '').toString();
    const confirmNext = (formData.get('confirm') || '').toString();
    if (!next || next !== confirmNext) {
      showStatus('New passwords do not match.', 'warn');
      return;
    }
    const ok = await verifyPassword(current);
    if (!ok) {
      showStatus('Current password is incorrect.', 'warn');
      return;
    }
    try {
      await setPassword(next);
      passwordForm.reset();
      showStatus('Password updated.', 'success');
    } catch(err) {
      // showStatus already handled inside setPassword
    }
  }

  async function attemptAutoLogin(){
    if (sessionGet(SESSION_KEY)) {
      setLoggedIn(true);
      renderProjects();
    }
  }

  loginForm.addEventListener('submit', async evt => {
    evt.preventDefault();
    const password = loginForm.password.value;
    const ok = await verifyPassword(password);
    if (ok) {
      setLoggedIn(true);
      renderProjects();
      showStatus('Signed in successfully.', 'success');
      loginForm.reset();
    } else {
      showStatus('Invalid password.', 'warn');
    }
  });

  logoutBtn.addEventListener('click', () => {
    setLoggedIn(false);
    resetForm();
    showStatus('Logged out.', 'info');
  });

  projectForm.addEventListener('submit', handleProjectSubmit);
  cancelEditBtn.addEventListener('click', () => {
    resetForm();
    showStatus('Editing cancelled.', 'info');
  });
  newProjectBtn.addEventListener('click', () => {
    resetForm();
    showStatus('Ready to add a new project.', 'info');
  });
  resetProjectsBtn.addEventListener('click', handleReset);
  exportBtn.addEventListener('click', handleExport);
  backupDownload.addEventListener('click', handleExport);
  importInput.addEventListener('change', evt => {
    handleImport(evt.target.files[0]);
    evt.target.value = '';
  });
  backupRestore.addEventListener('change', evt => {
    handleImport(evt.target.files[0]);
    evt.target.value = '';
  });
  passwordForm.addEventListener('submit', handlePasswordSubmit);
  categorySelect.addEventListener('change', updateTypePlaceholder);

  attemptAutoLogin();
  updateTypePlaceholder();
})();
