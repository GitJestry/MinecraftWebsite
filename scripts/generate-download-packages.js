const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(REPO_ROOT, 'assets/data/projects.json');
const TEMPLATE_DIR = path.join(REPO_ROOT, 'assets/templates');
const AUTHOR = 'MC_IRL_OFFICIAL';

const TEMPLATES = {
  LICENSE_CODE: 'LICENSE_CODE.template',
  LICENSE_ASSETS: 'LICENSE_ASSETS.template',
  README_DATAPACK: 'README_DATAPACK.template',
  README_3DMODEL: 'README_3DMODEL.template',
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readTemplate(name) {
  const file = path.join(TEMPLATE_DIR, name);
  return fs.readFileSync(file, 'utf8');
}

function substitute(template, data) {
  return template.replace(/{{(\w+)}}/g, (match, key) => {
    const value = data[key];
    return value == null ? match : String(value);
  });
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function pickPrimaryVersion(project) {
  const versions = project?.modalContent?.versions;
  if (Array.isArray(versions) && versions.length) {
    const first = versions[0];
    return (first.release || first.label || '').trim() || '1.0.0';
  }
  return '1.0.0';
}

function pickDescription(project) {
  const short = (project.shortDescription || '').trim();
  if (short) return short;
  const description = project?.modalContent?.description;
  if (Array.isArray(description) && description.length) {
    const first = description[0];
    if (typeof first === 'string') return first.trim();
    if (first && typeof first.text === 'string') return first.text.trim();
  }
  return 'Project description coming soon.';
}

function buildTemplateData(project) {
  let year = new Date().getFullYear();
  if (project && typeof project.year === 'number') {
    year = project.year;
  } else if (project && typeof project.createdAt === 'string') {
    const parsed = new Date(project.createdAt);
    if (!isNaN(parsed.getTime())) {
      year = parsed.getFullYear();
    }
  }
  return {
    PROJECT_NAME: (project.title || project.id || 'Unnamed Project').trim(),
    PROJECT_TYPE: project.type === 'printing' ? '3D model' : 'datapack',
    VERSION: pickPrimaryVersion(project),
    DESCRIPTION: pickDescription(project),
    YEAR: year,
    AUTHOR,
  };
}

function requireBinary(command) {
  try {
    execFileSync(command, ['-h'], { stdio: 'ignore' });
    return true;
  } catch (err) {
    return false;
  }
}

function rebuildZip(zipPath, files) {
  const unzipAvailable = requireBinary('unzip');
  const zipAvailable = requireBinary('zip');
  if (!zipAvailable) {
    throw new Error('zip command not available');
  }

  // If a ZIP already exists but we cannot unzip it, do NOT destroy it.
  if (fs.existsSync(zipPath) && !unzipAvailable) {
    throw new Error(`Cannot update ${zipPath}: unzip command not available`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirl-zip-'));
  try {
    if (fs.existsSync(zipPath)) {
      try {
        execFileSync('unzip', ['-qq', zipPath, '-d', tmpDir], { stdio: 'ignore' });
      } catch (err) {
        console.warn(`[warn] Failed to extract ${zipPath}:`, err.message);
      }
    }

    Object.entries(files).forEach(([name, content]) => {
      if (!content) return;
      fs.writeFileSync(path.join(tmpDir, name), content, 'utf8');
    });

    const output = path.join(tmpDir, 'package.zip');
    execFileSync('zip', ['-qr', output, '.'], { cwd: tmpDir, stdio: 'ignore' });
    ensureDir(zipPath);
    fs.copyFileSync(output, zipPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function needsArtifacts(project) {
  const type = project.type === 'printing' ? 'printing' : 'datapack';
  return type;
}

function generateArtifacts(project) {
  const type = needsArtifacts(project);
  if (!type) return null;
  const data = buildTemplateData(project);
  const licenseAssets = substitute(readTemplate(TEMPLATES.LICENSE_ASSETS), data);
  const artifacts = { 'LICENSE_ASSETS.txt': licenseAssets };

  if (type === 'datapack') {
    artifacts['LICENSE_CODE.txt'] = substitute(readTemplate(TEMPLATES.LICENSE_CODE), data);
    artifacts['README.txt'] = substitute(readTemplate(TEMPLATES.README_DATAPACK), data);
  } else {
    artifacts['README.txt'] = substitute(readTemplate(TEMPLATES.README_3DMODEL), data);
  }

  return artifacts;
}

function processProjects() {
  const payload = readJson(DATA_PATH);
  const projects = Array.isArray(payload.projects) ? payload.projects : payload;
  const generated = [];

  projects.forEach((project) => {
    if (!project || !project.downloadFile) return;
    const zipPath = path.join(REPO_ROOT, project.downloadFile.replace(/^\/+/, ''));
    if (!/\.zip$/i.test(zipPath)) return;
    const artifacts = generateArtifacts(project);
    if (!artifacts) return;
    rebuildZip(zipPath, artifacts);
    generated.push({ project: project.title || project.id || 'Unbenannt', zip: zipPath });
  });

  return generated;
}

function main() {
  const results = processProjects();
  if (!results.length) {
    console.log('Keine Download-Pakete aktualisiert.');
    return;
  }
  console.log('Aktualisierte Download-Pakete:');
  results.forEach((item) => {
    console.log(`- ${item.project}: ${path.relative(REPO_ROOT, item.zip)}`);
  });
}

main();
