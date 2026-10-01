/**
 * Verifies the theme control.
 *
 * The default here was changed twice (dark, then follow-the-system), so the
 * behaviour is pinned by a check rather than left to manual inspection. The
 * important properties:
 *
 *   1. With no stored preference, the app follows the OS colour scheme — and
 *      keeps following it live when the OS preference changes.
 *   2. Choosing light or dark pins the choice, even against the OS.
 *   3. "Follow system" can be selected again after pinning.
 *   4. The choice survives a reload.
 *
 * `Emulation.setEmulatedMedia` supplies the OS preference, which is the only
 * honest way to test this without changing the machine's settings.
 *
 * Usage: node scripts/check-theme.mjs
 */
import { spawn } from 'node:child_process';
import { readdirSync, unlinkSync, writeFileSync } from 'node:fs';

const DIST = `${new URL('..', import.meta.url).pathname}dist/`;
const PORT = 9484;
const PAGE = `${DIST}__theme.html`;

const assets = readdirSync(`${DIST}assets`);
const entry = assets.find((f) => /^index-.*\.js$/.test(f));
const css = assets.find((f) => f.endsWith('.css'));
if (!entry) {
  console.error('dist/assets 中找不到入口，请先执行 vite build');
  process.exit(1);
}

writeFileSync(
  PAGE,
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">${
    css ? `<link rel="stylesheet" href="./assets/${css}">` : ''
  }</head><body><div id="root"></div>
<script type="module" src="./assets/${entry}"></script></body></html>`,
);
process.on('exit', () => {
  try {
    unlinkSync(PAGE);
  } catch {
    // Already removed.
  }
});

const chrome = spawn(
  'chromium',
  [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--allow-file-access-from-files', '--user-data-dir=/tmp/wheat-tools-theme-profile',
    `--remote-debugging-port=${PORT}`, 'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
let messageId = 0;
const pending = new Map();

function call(method, params = {}) {
  const id = ++messageId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 30000);
    pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.result?.exceptionDetails) {
    throw new Error(`evaluate 失败: ${response.result.exceptionDetails.text}`);
  }
  return response.result?.result?.value;
}

/** The rendered theme, read from the DOM rather than from React state. */
const RENDERED = `document.documentElement.dataset.theme`;
const PREFERENCE = `document.documentElement.dataset.themePreference`;

/** Sets the emulated OS colour scheme and waits for the app to react. */
async function setOsScheme(scheme) {
  await call('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: scheme }],
  });
  await sleep(500);
}

/**
 * Picks an option from the theme dropdown.
 *
 * Selected by position, not by label: the options are declared in the order
 * system / light / dark, and matching on translated text would make the check
 * depend on the interface language.
 */
const THEME_OPTION_INDEX = { system: 0, light: 1, dark: 2 };

async function chooseTheme(value) {
  const opened = await evaluate(`(() => {
    const button = document.querySelector('button[aria-label="主题"], button[aria-label="Theme"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!opened) return false;
  await sleep(600);

  const clicked = await evaluate(`(() => {
    const options = [...document.querySelectorAll('[role=option]')];
    if (options.length < 3) return false;
    options[${THEME_OPTION_INDEX[value]}].click();
    return true;
  })()`);
  await sleep(700);
  return clicked;
}

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1; else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`),
  );
}

try {
  let wsUrl = null;
  for (let attempt = 0; attempt < 60 && !wsUrl; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      wsUrl = (await response.json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null;
    } catch {
      // Not listening yet.
    }
    if (!wsUrl) await sleep(500);
  }
  if (!wsUrl) throw new Error('无法连接到 Chromium 调试端口');

  ws = new WebSocket(wsUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });

  await call('Page.enable');
  await call('Runtime.enable');

  // The interface language decides the dropdown's aria-label, so pin it. (The
  // browser's own language would otherwise leak into the check.)
  await evaluate(`try { localStorage.setItem('wheat-tools:locale', 'zh-CN'); } catch {} true`);

  console.log('--- 默认跟随系统 ---');
  await setOsScheme('light');
  await call('Page.navigate', { url: `file://${PAGE}` }).catch(() => undefined);
  await sleep(3200);
  // localStorage is per-origin, so the seed has to be written after the first
  // navigation to this page; the reload then picks it up.
  await evaluate(`try { localStorage.setItem('wheat-tools:locale', 'zh-CN'); } catch {} true`);
  await call('Page.reload', {}).catch(() => undefined);
  await sleep(2500);
  check('系统为浅色时渲染浅色', await evaluate(RENDERED), 'light');
  check('偏好为 system', await evaluate(PREFERENCE), 'system');

  await setOsScheme('dark');
  check('系统切到深色时跟随变化（无需刷新）', await evaluate(RENDERED), 'dark');

  await setOsScheme('light');
  check('系统切回浅色时也跟随', await evaluate(RENDERED), 'light');

  console.log('\n--- 显式选择会覆盖系统 ---');
  check('选择了「深色」', await chooseTheme('dark'), true);
  check('系统为浅色但渲染深色', await evaluate(RENDERED), 'dark');
  check('偏好记录为 dark', await evaluate(PREFERENCE), 'dark');

  await setOsScheme('dark');
  check('系统改为深色后仍保持显式选择', await evaluate(RENDERED), 'dark');

  check('选择了「浅色」', await chooseTheme('light'), true);
  check('系统为深色但渲染浅色', await evaluate(RENDERED), 'light');

  console.log('\n--- 可以退回跟随系统 ---');
  check('选择了「跟随系统」', await chooseTheme('system'), true);
  check('系统为深色则渲染深色', await evaluate(RENDERED), 'dark');
  check('偏好记录为 system', await evaluate(PREFERENCE), 'system');

  console.log('\n--- 选择会被记住 ---');
  await chooseTheme('light');
  await call('Page.reload', {}).catch(() => undefined);
  await sleep(3000);
  check('刷新后仍是浅色', await evaluate(RENDERED), 'light');
  check('刷新后偏好仍是 light', await evaluate(PREFERENCE), 'light');

  await setOsScheme('light');
  await chooseTheme('system');
  await call('Page.reload', {}).catch(() => undefined);
  await sleep(3000);
  check('刷新后跟随系统', await evaluate(PREFERENCE), 'system');
} finally {
  chrome.kill();
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
