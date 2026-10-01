/**
 * Smoke test: opens every tool through the launcher UI and asserts that the
 * route renders something without throwing.
 *
 * This complements verify-ui.mjs (which covers two tools in depth): as tools
 * are added, "does it mount at all" is the check most likely to catch a broken
 * registration, a bad import or a render-time crash.
 *
 * Usage: npm run build && node scripts/check-tools.mjs
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = new URL('../', import.meta.url).pathname;
const VERIFY_DIR = `${ROOT}.verify/`;
const PROFILE = '/tmp/wheat-tools-smoke-profile';
const PORT = 9340;

mkdirSync(VERIFY_DIR, { recursive: true });

const assetsDir = `${ROOT}dist/assets/`;
const files = readdirSync(assetsDir);
const js = readFileSync(
  assetsDir + files.find((f) => f.endsWith('.js')),
  'utf8',
);
const cssFile = files.find((f) => f.endsWith('.css'));
const css = cssFile ? readFileSync(assetsDir + cssFile, 'utf8') : '';

const pageHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>smoke</title><style>${css}</style></head><body><div id="root"></div>
<script>
  window.__ERRORS__ = [];
  window.addEventListener('error', function (e) { window.__ERRORS__.push(String(e.message)); });
  window.addEventListener('unhandledrejection', function (e) {
    window.__ERRORS__.push('unhandledrejection: ' + String(e.reason));
  });
  var blob = new Blob([${JSON.stringify(js)}], { type: 'text/javascript' });
  var s = document.createElement('script');
  s.src = URL.createObjectURL(blob);
  document.body.appendChild(s);
</script></body></html>`;

const pagePath = `${VERIFY_DIR}smoke.html`;
writeFileSync(pagePath, pageHtml);

const chrome = spawn(
  'chromium',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-proxy-server',
    '--no-first-run',
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${PORT}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
);

let wsUrl = null;
for (let i = 0; i < 60 && !wsUrl; i += 1) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const page = (await res.json()).find(
      (t) => t.type === 'page' && t.webSocketDebuggerUrl,
    );
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch {
    // starting up
  }
  if (!wsUrl) await sleep(500);
}
if (!wsUrl) {
  chrome.kill();
  throw new Error('no devtools target');
}

const socket = new WebSocket(wsUrl);
await new Promise((res, rej) => {
  socket.addEventListener('open', res, { once: true });
  socket.addEventListener('error', rej, { once: true });
});

let nextId = 1;
const pending = new Map();
const consoleErrors = [];

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const d = message.params.exceptionDetails;
    consoleErrors.push(`[exception] ${d.exception?.description ?? d.text}`.slice(0, 300));
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(
      `[console.error] ${message.params.args
        .map((a) => a.value ?? a.description)
        .join(' ')}`.slice(0, 300),
    );
  }
});

function call(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout ${method}`));
    }, 20000);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

await call('Page.enable');
await call('Runtime.enable');

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'eval failed');
  }
  return result.result.value;
}

const results = [];

try {
  await call('Page.navigate', { url: `file://${pagePath}` }).catch(() => {});
  await sleep(1800);

  for (let i = 0; i < 40; i += 1) {
    if (await evaluate(`!!document.querySelector('.wt-tool-card')`).catch(() => false)) break;
    await sleep(300);
  }

  const cards = await evaluate(
    `[...document.querySelectorAll('.wt-tool-card')].map(c => c.textContent)`,
  );
  console.log(`发现 ${cards.length} 个工具卡片\n`);

  for (let index = 0; index < cards.length; index += 1) {
    const before = consoleErrors.length;

    // Re-render the launcher, then click the nth card.
    await evaluate(`(() => {
      const back = document.querySelector('button[aria-label="返回工具箱"]');
      if (back) back.click();
      return true;
    })()`);
    await sleep(400);

    const name = await evaluate(`(() => {
      const cards = [...document.querySelectorAll('.wt-tool-card')];
      const card = cards[${index}];
      if (!card) return null;
      const title = card.querySelector('.fui-Subtitle1')?.textContent ?? '';
      card.click();
      return title;
    })()`);

    await sleep(1200);

    const state = await evaluate(`(() => {
      const surfaces = document.querySelectorAll('.wt-surface').length;
      const hero = document.querySelector('.wt-hero')?.innerText ?? '';
      const missing = document.body.innerText.includes('未找到工具');
      return {
        surfaces,
        heroLen: hero.length,
        missing,
        hash: location.hash,
        buttons: document.querySelectorAll('button').length,
        textLen: document.body.innerText.length,
      };
    })()`);

    const newErrors = consoleErrors.slice(before);
    const ok =
      name !== null &&
      !state.missing &&
      state.surfaces > 0 &&
      state.textLen > 60 &&
      newErrors.length === 0;

    results.push({ name, ok, state, errors: newErrors });
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${String(name).padEnd(16)} 面板=${state.surfaces} 文案=${state.textLen} 按钮=${state.buttons}` +
        (newErrors.length ? `\n        errors: ${newErrors.join(' | ')}` : '') +
        (state.missing ? '\n        路由落到「未找到工具」' : ''),
    );
  }
} catch (error) {
  results.push({ name: '(harness)', ok: false, state: {}, errors: [String(error)] });
  console.log('HARNESS ERROR:', String(error));
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} 工具通过` +
      (failed.length ? `，失败：${failed.map((f) => f.name).join(', ')}` : ''),
  );
  writeFileSync(
    `${VERIFY_DIR}smoke-report.json`,
    JSON.stringify({ results, consoleErrors }, null, 2),
  );
  socket.close();
  chrome.kill();
  process.exit(failed.length === 0 ? 0 : 1);
}
