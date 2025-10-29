import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export class DownloadStore {
  constructor(fileLocation) {
    const filePath = typeof fileLocation === 'string'
      ? fileLocation
      : fileURLToPath(fileLocation);
    this.filePath = filePath;
    this._chain = Promise.resolve();
  }

  async init() {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await this._readAll();
    } catch (error) {
      if (error?.code === 'ENOENT') {
        await this._writeAll({});
      } else {
        throw error;
      }
    }
  }

  async getCounts(ids) {
    const data = await this._readAll();
    if (!ids || ids.length === 0) {
      return Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, value.count || 0]),
      );
    }
    const response = {};
    ids.forEach((id) => {
      const entry = data[id];
      response[id] = entry?.count ? Number(entry.count) : 0;
    });
    return response;
  }

  async record(projectId, metadata = {}) {
    if (!projectId) {
      throw new Error('projectId is required');
    }
    return this._enqueue(async () => {
      const data = await this._readAll();
      const entry = data[projectId] || {};
      const count = Number.isFinite(entry.count) ? Number(entry.count) : 0;
      const nextCount = count + 1;
      const now = new Date().toISOString();
      data[projectId] = {
        count: nextCount,
        updatedAt: now,
        lastFileId: metadata.fileId || entry.lastFileId,
        lastPath: metadata.path || entry.lastPath,
      };
      await this._writeAll(data);
      return data[projectId];
    });
  }

  async _readAll() {
    const raw = await readFile(this.filePath, 'utf8');
    return JSON.parse(raw);
  }

  async _writeAll(data) {
    await writeFile(this.filePath, JSON.stringify(data, null, 2));
  }

  _enqueue(task) {
    const run = this._chain.then(() => task());
    this._chain = run.catch(() => {});
    return run;
  }
}

export default DownloadStore;
