const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const dataPath = path.join(repoRoot, 'assets/data/projects.json');

function isRemotePath(value) {
  if (!value) return false;
  const trimmed = String(value).trim();
  if (!trimmed) return false;
  if (/^\/\//.test(trimmed)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return true;
  return false;
}

function normaliseLocalPath(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed || isRemotePath(trimmed)) return '';
  return trimmed.replace(/^\/+/, '');
}

function loadProjects() {
  const raw = fs.readFileSync(dataPath, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.projects) ? parsed.projects : [];
}

function collectVersionEntries(project) {
  const modal = project && project.modalContent;
  if (!modal || !Array.isArray(modal.versions)) return [];
  return modal.versions.filter(Boolean);
}

function checkFilePresence(label, rawPath, missing) {
  const localPath = normaliseLocalPath(rawPath);
  if (!localPath) return;
  const absolute = path.join(repoRoot, localPath);
  if (!fs.existsSync(absolute)) {
    missing.push({ label, rawPath, absolute });
  }
}

function main() {
  const projects = loadProjects();
  const missing = [];

  projects.forEach((project) => {
    const title = project.title || project.id || 'Unbenanntes Projekt';
    checkFilePresence(`${title} – Primärdownload`, project.downloadFile, missing);

    collectVersionEntries(project).forEach((entry, idx) => {
      const labelBase = `${title} – Version ${idx + 1}`;
      checkFilePresence(`${labelBase} (downloadFile)`, entry.downloadFile, missing);
      checkFilePresence(`${labelBase} (url)`, entry.url, missing);
    });
  });

  if (missing.length) {
    console.error('Fehlende Download-Dateien erkannt:');
    missing.forEach((item) => {
      console.error(`- ${item.label}: ${item.rawPath} -> ${item.absolute}`);
    });
    process.exit(1);
  }

  console.log('Alle referenzierten Downloads sind vorhanden.');
}

main();
