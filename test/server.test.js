import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST_PORT = 39990;
const ADDON_PORT = 39991;
const SECRET = 'test-secret';
const BASE = `http://127.0.0.1:${ADDON_PORT}`;

let hostServer;
let addon;
let workDir;

// Web anfitriona falsa: el addon clona su header/footer
const HOST_HTML = `<html><head><link rel="stylesheet" href="/theme.css"></head><body>
<header><nav>Demo</nav><div class="lang-switcher"><a hreflang="es">ES</a><a hreflang="en">EN</a></div></header>
<main></main><footer>Pie de la web</footer></body></html>`;

async function waitForHealth() {
  for (let i = 0; i < 200; i++) {
    try {
      const res = await fetch(`${BASE}/ticket/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('El addon no arrancó a tiempo');
}

function webhook(body, secret = SECRET) {
  return fetch(`${BASE}/webhook/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-Webhook-Secret': secret } : {}) },
    body: JSON.stringify(body),
  });
}

function claim(body) {
  return fetch(`${BASE}/ticket/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

before(async () => {
  hostServer = http.createServer((req, res) => res.end(HOST_HTML)).listen(HOST_PORT, '127.0.0.1');

  // Copia aislada para no tocar data/ ni cache/ del proyecto
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-test-'));
  for (const entry of ['server.js', 'lib', 'package.json']) {
    fs.cpSync(path.join(ROOT, entry), path.join(workDir, entry), { recursive: true });
  }
  fs.mkdirSync(path.join(workDir, 'data'));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(workDir, 'node_modules'), 'junction');

  addon = spawn(process.execPath, ['server.js'], {
    cwd: workDir,
    env: {
      ...process.env,
      PORT: String(ADDON_PORT),
      TARGET_ORIGIN: `http://127.0.0.1:${HOST_PORT}`,
      TOKEN_SECRET: SECRET,
      HUBSPOT_PORTAL_ID: '',
      HUBSPOT_FORM_ID: '',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await waitForHealth();
});

after(() => {
  addon?.kill();
  hostServer?.close();
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {}
});

test('el webhook rechaza peticiones sin secreto o con secreto incorrecto', async () => {
  assert.equal((await webhook({}, null)).status, 401);
  assert.equal((await webhook({}, 'otro')).status, 401);
});

test('el webhook solo acepta enlaces https de Google Drive', async () => {
  const res = await webhook({ url: 'https://evil.example/x', correo: 'a@b.c', localizador: 'T1' });
  assert.equal(res.status, 400);
});

test('el webhook crea y luego actualiza por localizador', async () => {
  const created = await webhook({ url: 'https://drive.google.com/uc?id=abc', correo: 'a@b.c', localizador: 'T1' });
  assert.equal(created.status, 201);
  const updated = await webhook({ url: 'https://drive.google.com/uc?id=def', correo: 'a@b.c', localizador: 'T1' });
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), { ok: true, updated: true });
});

test('el claim exige que correo y localizador coincidan', async () => {
  assert.equal((await claim({ email: 'otro@b.c', localizador: 'T1' })).status, 404);
  const ok = await claim({ email: 'a@b.c', localizador: 'T1' });
  assert.equal(ok.status, 200);
  const { token } = await ok.json();
  assert.match(token, /^[0-9a-f]{48}$/);
});

test('un token de descarga desconocido devuelve 410', async () => {
  const res = await fetch(`${BASE}/ticket/download/no-existe`);
  assert.equal(res.status, 410);
});

test('la página del formulario clona header/footer y sustituye el selector de idioma', async () => {
  const html = await (await fetch(`${BASE}/ticket?lang=en`)).text();
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Pie de la web/);
  assert.match(html, /theme\.css/);
  assert.match(html, /tk-lang-switch/);
  assert.doesNotMatch(html, /class="lang-switcher"/);
  assert.doesNotMatch(html, /hubspot|hs-scripts/i);
});
