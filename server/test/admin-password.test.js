import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Server did not start in time'));
    }, 5000);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (data) => {
      if (data.includes('Editor dev server listening on port')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    child.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited prematurely with code ${code} signal ${signal}`));
    });
  });
}

async function requestLogin(port, password) {
  const response = await fetch(`http://127.0.0.1:${port}/editor/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username: 'admin', password }),
  });
  return { status: response.status, body: await response.json() };
}

test('custom admin password overrides built-in default', async (t) => {
  const port = 3456;
  const serverDir = fileURLToPath(new URL('../', import.meta.url));

  const child = spawn('node', ['src/editor-server.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      ADMIN_PASSWORD: 'Admin123!',
      ADMIN_PASSWORD_HASH: '',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  t.after(() => {
    child.kill();
  });

  await waitForServer(child);

  const rejected = await requestLogin(port, 'change-me');
  assert.equal(rejected.status, 401);
  assert.deepEqual(rejected.body, { error: 'invalid_credentials' });

  const accepted = await requestLogin(port, 'Admin123!');
  assert.equal(accepted.status, 200);
  assert.ok(accepted.body.token, 'expected token in response');
  assert.deepEqual(accepted.body.user, { username: 'admin' });
});
