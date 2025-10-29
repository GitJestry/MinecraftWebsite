(function(){
  'use strict';

  const cms = window.MIRL_CMS || {};
  const FALLBACK_IMAGE = 'assets/img/logo.jpg';

  function deepClone(value){
    return JSON.parse(JSON.stringify(value || {}));
  }

  function loadProjects(){
    const defaults = deepClone(cms.DEFAULT_PROJECTS || { datapacks: [], printing: [] });
    const key = cms.PROJECTS_KEY;
    if (!key) return defaults;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      return {
        datapacks: Array.isArray(parsed.datapacks) ? parsed.datapacks : defaults.datapacks,
        printing: Array.isArray(parsed.printing) ? parsed.printing : defaults.printing
      };
    } catch(err){
      console.warn('Failed to read stored projects, falling back to defaults.', err);
      return defaults;
    }
  }

  function createTagElements(tags){
    const frag = document.createDocumentFragment();
    (tags || []).forEach(tag => {
      if (!tag) return;
      const span = document.createElement('span');
      span.className = 'chip';
      span.textContent = tag;
      frag.appendChild(span);
    });
    return frag;
  }

  function createLinkButtons(links){
    const container = document.createElement('div');
    container.className = 'btn-row';
    (links || []).forEach(link => {
      if (!link || !link.url) return;
      const anchor = document.createElement('a');
      anchor.className = 'btn';
      anchor.href = link.url;
      anchor.target = link.target || '_blank';
      anchor.rel = 'noopener';
      anchor.textContent = link.label || 'View';
      if (link.download) {
        anchor.setAttribute('download', '');
        anchor.target = '_self';
        anchor.rel = 'noopener';
      }
      container.appendChild(anchor);
    });
    if (!container.children.length) {
      container.hidden = true;
    }
    return container;
  }

  function formatDescription(text){
    const wrapper = document.createElement('div');
    wrapper.className = 'prose';
    if (!text) {
      wrapper.textContent = 'No additional details yet.';
      return wrapper;
    }
    const paragraphs = String(text).split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    if (!paragraphs.length) {
      wrapper.textContent = text;
      return wrapper;
    }
    paragraphs.forEach(p => {
      const para = document.createElement('p');
      para.textContent = p;
      wrapper.appendChild(para);
    });
    return wrapper;
  }

  function buildModal(project){
    const modal = document.createElement('dialog');
    modal.className = 'modal';
    modal.id = 'modal-' + project.id;
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = '';

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.setAttribute('data-close', '');

    const content = document.createElement('div');
    content.className = 'modal-content';
    content.setAttribute('role', 'document');

    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.setAttribute('data-close', '');
    closeBtn.textContent = '×';

    const hero = document.createElement('header');
    hero.className = 'modal-hero';

    const heroTitle = document.createElement('div');
    heroTitle.className = 'title';
    heroTitle.textContent = project.title;

    const heroSummary = document.createElement('div');
    heroSummary.className = 'muted';
    heroSummary.textContent = project.summary || '';

    const heroBadges = document.createElement('div');
    heroBadges.className = 'badges';
    const typeBadge = document.createElement('span');
    typeBadge.className = 'badge';
    typeBadge.textContent = project.type || 'Project';
    heroBadges.appendChild(typeBadge);
    (project.tags || []).slice(0, 3).forEach(tag => {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = tag;
      heroBadges.appendChild(badge);
    });

    const buttons = createLinkButtons(project.links || []);

    const body = document.createElement('div');
    body.className = 'modal-body';

    const sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';

    const infoCard = document.createElement('div');
    infoCard.className = 'info-card';
    const infoTitle = document.createElement('h4');
    infoTitle.textContent = 'Project info';
    const infoList = document.createElement('ul');
    infoList.className = 'info-list';

    const addInfoRow = (label, value) => {
      if (!value) return;
      const li = document.createElement('li');
      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = label;
      const v = document.createElement('span');
      v.textContent = value;
      li.append(k, v);
      infoList.appendChild(li);
    };

    addInfoRow('Category', project.type || 'Project');
    addInfoRow('Tags', (project.tags || []).join(', '));
    if (project.updatedAt) {
      addInfoRow('Updated', new Date(project.updatedAt).toLocaleDateString());
    }

    infoCard.append(infoTitle, infoList);
    sidebar.appendChild(infoCard);

    if (project.tags && project.tags.length > 3) {
      const tagCard = document.createElement('div');
      tagCard.className = 'info-card';
      const tagTitle = document.createElement('h4');
      tagTitle.textContent = 'More tags';
      const tagWrap = document.createElement('div');
      tagWrap.className = 'info-tags';
      tagWrap.appendChild(createTagElements(project.tags.slice(3)));
      tagCard.append(tagTitle, tagWrap);
      sidebar.appendChild(tagCard);
    }

    const contentSection = document.createElement('section');
    contentSection.className = 'content';
    const desc = formatDescription(project.description);
    contentSection.append(desc);
    const linkButtons = createLinkButtons(project.links || []);
    linkButtons.classList.add('modal-links');
    contentSection.appendChild(linkButtons);

    hero.append(heroTitle, heroSummary, heroBadges, buttons);
    body.append(sidebar, contentSection);
    content.append(closeBtn, hero, body);
    modal.append(backdrop, content);

    modal.addEventListener('cancel', evt => {
      evt.preventDefault();
      closeModal(modal);
    });

    modal.addEventListener('click', evt => {
      const target = evt.target;
      if (target && target.hasAttribute('data-close')) {
        evt.preventDefault();
        closeModal(modal);
      }
    });

    return modal;
  }

  function openModal(modal){
    if (!modal) return;
    if (typeof modal.showModal === 'function') {
      modal.showModal();
    } else {
      modal.setAttribute('open', '');
    }
    modal.setAttribute('aria-hidden', 'false');
    document.documentElement.style.overflow = 'hidden';
  }

  function closeModal(modal){
    if (!modal) return;
    if (typeof modal.close === 'function') {
      modal.close();
    } else {
      modal.removeAttribute('open');
    }
    modal.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
  }

  function createCard(project){
    const card = document.createElement('article');
    card.className = 'card dp-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.dataset.projectId = project.id;

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const img = document.createElement('img');
    img.alt = project.title + ' cover';
    img.loading = 'lazy';
    img.src = project.image || FALLBACK_IMAGE;
    thumb.appendChild(img);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = project.title;
    const chips = document.createElement('div');
    chips.className = 'chips';
    chips.appendChild(createTagElements(project.tags || []));
    const quick = document.createElement('div');
    quick.className = 'quick';
    quick.textContent = project.summary || '';

    meta.append(title, chips, quick);
    card.append(thumb, meta);

    return card;
  }

  function renderCategory(category, projects){
    const block = document.querySelector('.section-block#' + category);
    if (!block) return;
    const grid = block.querySelector('.itemgrid');
    const counter = block.querySelector('.count');
    const empty = block.querySelector('[data-empty]');

    grid.innerHTML = '';

    if (!projects.length) {
      if (counter) updateCounter(counter, 0);
      if (empty) empty.hidden = false;
      return;
    }

    if (counter) updateCounter(counter, projects.length);
    if (empty) empty.hidden = true;

    projects.forEach(project => {
      const card = createCard(project);
      grid.appendChild(card);
      const modal = buildModal(project);
      document.body.appendChild(modal);

      const open = () => openModal(modal);
      card.addEventListener('click', open);
      card.addEventListener('keydown', evt => {
        if (evt.key === 'Enter' || evt.key === ' ') {
          evt.preventDefault();
          open();
        }
      });
    });
  }

  function clearModals(){
    document.querySelectorAll('dialog.modal').forEach(modal => modal.remove());
  }

  function initModalEsc(){
    document.addEventListener('keydown', evt => {
      if (evt.key === 'Escape') {
        const openModalEl = document.querySelector('dialog.modal[open]');
        if (openModalEl) {
          evt.preventDefault();
          closeModal(openModalEl);
        }
      }
    });
  }

  function initTabs(){
    const seg = document.getElementById('seg');
    if (!seg) return;
    const pill = document.getElementById('pill');
    const links = Array.from(seg.querySelectorAll('a[role="tab"]'));
    const panels = Array.from(document.querySelectorAll('.section-block'));

    function setActive(id){
      panels.forEach(panel => {
        const isActive = panel.id === id;
        panel.hidden = !isActive;
        panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      });
      links.forEach(link => {
        const active = link.getAttribute('aria-controls') === id;
        link.classList.toggle('active', active);
        link.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      if (pill) {
        const activeLink = links.find(link => link.classList.contains('active'));
        if (activeLink) {
          const rect = activeLink.getBoundingClientRect();
          const parentRect = seg.getBoundingClientRect();
          pill.style.width = rect.width + 'px';
          pill.style.left = (rect.left - parentRect.left + seg.scrollLeft) + 'px';
        }
      }
      try {
        const url = new URL(window.location);
        url.hash = '#' + id;
        history.replaceState(null, '', url);
      } catch(err) {
        window.location.hash = id;
      }
    }

    links.forEach(link => {
      link.addEventListener('click', evt => {
        evt.preventDefault();
        setActive(link.getAttribute('aria-controls'));
      });
    });

    window.addEventListener('resize', () => {
      const activeLink = links.find(link => link.classList.contains('active'));
      if (activeLink) {
        const rect = activeLink.getBoundingClientRect();
        const parentRect = seg.getBoundingClientRect();
        pill.style.width = rect.width + 'px';
        pill.style.left = (rect.left - parentRect.left + seg.scrollLeft) + 'px';
      }
    });

    const initial = location.hash ? location.hash.replace('#', '') : null;
    const initialLink = links.find(link => link.getAttribute('aria-controls') === initial);
    setActive(initialLink ? initial : (links[0] && links[0].getAttribute('aria-controls')));
  }

  function render(){
    clearModals();
    const projects = loadProjects();
    ['datapacks', 'printing'].forEach(category => {
      const list = Array.isArray(projects[category]) ? projects[category] : [];
      renderCategory(category, list);
    });
  }

  function updateCounter(counter, count){
    const en = `${count} ${count === 1 ? 'item' : 'items'}`;
    const de = `${count} ${count === 1 ? 'Projekt' : 'Projekte'}`;
    counter.innerHTML = `<span class="lang-en">${en}</span><span class="lang-de">${de}</span>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initModalEsc();
    render();
    document.addEventListener('projects-updated', render);
  });
})();
