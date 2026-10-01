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
import { readFileSync, readdirSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
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

const entryFile = files.find((f) => /^index-.*\.js$/.test(f));
if (!entryFile) {
  console.error('dist/assets 中找不到入口 index-*.js，请先执行 vite build');
  process.exit(1);
}

/**
 * The harness lives *inside* dist/ on purpose.
 *
 * After code splitting, the entry uses dynamic `import("./tool-...js")`, which
 * resolves relative to the importing module. A Blob URL (what this script used
 * before) has no filesystem base, so every tool chunk would fail to load. Writing
 * the page next to the assets keeps the relative paths valid. `vite build`
 * empties dist/, so this file never survives into a deployment.
 */
const pageHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>smoke</title><style>${css}</style></head><body><div id="root"></div>
<script>
  window.__ERRORS__ = [];
  window.addEventListener('error', function (e) { window.__ERRORS__.push(String(e.message)); });
  window.addEventListener('unhandledrejection', function (e) {
    window.__ERRORS__.push('unhandledrejection: ' + String(e.reason));
  });
</script>
<script type="module" src="./assets/${entryFile}"></script>
</body></html>`;

const pagePath = `${ROOT}dist/__smoke.html`;
writeFileSync(pagePath, pageHtml);

/**
 * Removes the harness page from dist on the way out.
 *
 * `vite build` empties dist/, so this file cannot survive a rebuild — but a
 * manual `rsync dist/` right after running the checks would otherwise ship it.
 */
function cleanupHarness() {
  try {
    unlinkSync(pagePath);
  } catch {
    // Already gone; nothing to do.
  }
}
process.on('exit', cleanupHarness);

const chrome = spawn(
  'chromium',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    // Lets the page load ES modules straight from disk. Module scripts are
    // subject to CORS even on file://, and this harness has to run the real
    // built entry point (with its relative dynamic imports) rather than an
    // inlined bundle, so the restriction has to be lifted for the check only.
    '--allow-file-access-from-files',
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

    // Return to the launcher through the sidebar's home link.
    await evaluate(`(() => {
      const home = document.querySelector('.wt-header__brand');
      if (home) home.click();
      return true;
    })()`);
    await sleep(500);

    const name = await evaluate(`(() => {
      const cards = [...document.querySelectorAll('.wt-tool-card')];
      const card = cards[${index}];
      if (!card) return null;
      const title = card.querySelector('.fui-Subtitle1')?.textContent ?? '';
      (card.querySelector('.wt-tool-card__link') ?? card).click();
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
