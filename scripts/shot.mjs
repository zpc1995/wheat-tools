/**
 * Scratch helper: screenshot an arbitrary file:// page.
 *
 * Usage: node scripts/shot.mjs <file-url> <output-png> [height]
 *
 * Only used while developing the UI (e.g. eyeballing the wheat mark at large
 * sizes). Not part of the build or the test suite.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';

const url = process.argv[2];
const out = process.argv[3] ?? '.screenshots/scratch.png';
const height = Number(process.argv[4] ?? 340);
const PORT = 9270;

const chrome = spawn(
  'chromium',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--user-data-dir=/tmp/wt-shot-profile',
    `--remote-debugging-port=${PORT}`,
    `--window-size=1000,${height}`,
    url,
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
);

let page = null;
for (let i = 0; i < 40 && !page; i += 1) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    page = (await res.json()).find((t) => t.type === 'page');
  } catch {
    // still starting
  }
  if (!page) await sleep(500);
}
if (!page) {
  chrome.kill();
  throw new Error('no page target');
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pend = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) {
    pend.get(m.id)(m);
    pend.delete(m.id);
  }
});
const cmd = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    const t = setTimeout(() => rej(new Error(`timeout ${method}`)), 30000);
    pend.set(i, (m) => {
      clearTimeout(t);
      res(m);
    });
    ws.send(JSON.stringify({ id: i, method, params }));
  });

await cmd('Page.enable');
await sleep(2500);
const shot = await cmd('Page.captureScreenshot', { format: 'png' });
console.log('DEBUG shot keys:', JSON.stringify(Object.keys(shot)), 'err:', JSON.stringify(shot.error));
const data = shot.data ?? shot.result?.data;
writeFileSync(out, Buffer.from(data, 'base64'));
console.log(`wrote ${out}`);
chrome.kill();
process.exit(0);
