/**
 * Verifies that the sidebar toggle actually changes the layout.
 *
 * This exists because of a real bug: the toggle button was meant to be hidden
 * above the drawer breakpoint, but Fluent's runtime-injected Button styles were
 * appended after global.css and won on equal specificity, so `display: none`
 * silently did nothing. The button stayed visible on desktop and clicking it
 * only set a flag that no rule at that width responded to — a control that
 * looked interactive and did nothing.
 *
 * Two properties are asserted, using **real mouse events** rather than
 * programmatic `.click()`: the latter bypasses hit-testing, so it would have
 * passed against the broken build.
 *
 *   1. Wide screen: clicking the toggle hides/shows the rail, and the content
 *      pane actually gets wider when it is hidden.
 *   2. Narrow screen: clicking the toggle opens/closes the overlay drawer.
 *
 * Usage: node scripts/check-sidebar.mjs
 */
import { spawn } from 'node:child_process';
import { readdirSync, unlinkSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = `${ROOT}dist/`;
const PROFILE = '/tmp/wheat-tools-sidebar-profile';
const PORT = 9476;

const assets = readdirSync(`${DIST}assets`);
const entry = assets.find((f) => /^index-.*\.js$/.test(f));
const css = assets.find((f) => f.endsWith('.css'));
if (!entry) {
  console.error('dist/assets 中找不到入口，请先执行 vite build');
  process.exit(1);
}

const pagePath = `${DIST}__sidebar.html`;
writeFileSync(
  pagePath,
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">${
    css ? `<link rel="stylesheet" href="./assets/${css}">` : ''
  }</head><body><div id="root"></div>
<script type="module" src="./assets/${entry}"></script></body></html>`,
);
process.on('exit', () => {
  try {
    unlinkSync(pagePath);
  } catch {
    // Already removed.
  }
});

const chrome = spawn(
  'chromium',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${PORT}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let ws;
let messageId = 0;
const pending = new Map();

function call(method, params = {}) {
  const id = ++messageId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 30000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(`evaluate 失败: ${response.result.exceptionDetails.text}`);
  }
  return response.result?.result?.value;
}

/** A real click, so hit-testing and overlays are exercised. */
async function clickAt(x, y) {
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

/**
 * Whether the rail is actually visible.
 *
 * The hidden state is implemented with `display: none`, which keeps the element
 * in the DOM — so asserting on `querySelector` would pass either way.
 */
const RAIL_HIDDEN = `(() => {
  const el = document.querySelector('.wt-sidebar');
  if (!el) return 'missing';
  return getComputedStyle(el).display === 'none' || el.getBoundingClientRect().width === 0;
})()`;

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`),
  );
}

/** Clicks the rail toggle and returns its centre coordinates. */
async function toggleCentre() {
  const box = await evaluate(`(() => {
    const b = document.querySelector('.wt-nav-toggle');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: r.width, h: r.height };
  })()`);
  return box;
}

try {
  let wsUrl = null;
  for (let attempt = 0; attempt < 60 && !wsUrl; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await response.json();
      wsUrl = targets.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null;
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

  console.log('--- 宽屏：收起侧边栏应真正改变布局 ---');
  await call('Emulation.setDeviceMetricsOverride', {
    width: 1400,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await call('Page.navigate', { url: `file://${pagePath}` }).catch(() => undefined);
  await sleep(3200);

  // Pin the interface language so the report is deterministic regardless of the
  // runner's browser language. This has to happen *after* the first navigation:
  // localStorage is per-origin, so writing it while still on about:blank would
  // target the wrong origin. The reload then picks it up.
  await evaluate(`try { localStorage.setItem('wheat-tools:locale', 'zh-CN'); } catch {} true`);
  await call('Page.reload', {}).catch(() => undefined);
  await sleep(1800);

  const box = await toggleCentre();
  check('切换按钮存在且可见', box !== null && box.w > 0, true);
  check('按钮可被真实点击命中（无元素遮挡）', await evaluate(`(() => {
    const el = document.elementFromPoint(${box.x}, ${box.y});
    return !!(el && el.closest('.wt-nav-toggle'));
  })()`), true);

  const wideWidthBefore = await evaluate(`document.querySelector('.wt-content').getBoundingClientRect().width`);
  await clickAt(box.x, box.y);
  await sleep(500);
  check('点击后侧边栏隐藏', await evaluate(RAIL_HIDDEN), true);
  const wideWidthAfter = await evaluate(`document.querySelector('.wt-content').getBoundingClientRect().width`);
  check('内容区变宽（说明布局真的变了）', wideWidthAfter > wideWidthBefore, true);
  check('按钮状态同步为收起', await evaluate(`document.querySelector('.wt-nav-toggle').getAttribute('aria-expanded')`), 'false');

  await clickAt(box.x, box.y);
  await sleep(500);
  check('再次点击后侧边栏恢复', await evaluate(RAIL_HIDDEN), false);
  check('内容区宽度恢复', await evaluate(`Math.round(document.querySelector('.wt-content').getBoundingClientRect().width)`), Math.round(wideWidthBefore));

  console.log('\n--- 宽屏：收起状态应被记住 ---');
  await clickAt(box.x, box.y);
  await sleep(400);
  await call('Page.reload', {}).catch(() => undefined);
  await sleep(3000);
  check('刷新后仍保持收起', await evaluate(RAIL_HIDDEN), true);
  await clickAt(box.x, box.y);
  await sleep(400);
  await call('Page.reload', {}).catch(() => undefined);
  await sleep(3000);
  check('恢复展开后刷新也记住', await evaluate(RAIL_HIDDEN), false);

  console.log('\n--- 窄屏：抽屉开合 ---');
  await call('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await call('Page.reload', {}).catch(() => undefined);
  await sleep(3000);

  const narrowBox = await toggleCentre();
  check('窄屏下切换按钮可用', narrowBox !== null && narrowBox.w > 0, true);
  check('窄屏下抽屉默认关闭（平移到屏幕外）', await evaluate(`(() => {
    const style = getComputedStyle(document.querySelector('.wt-sidebar'));
    return style.transform !== 'none';
  })()`), true);

  await clickAt(narrowBox.x, narrowBox.y);
  await sleep(500);
  check('点击后抽屉滑入', await evaluate(`getComputedStyle(document.querySelector('.wt-sidebar')).transform`), 'none');
  check('遮罩出现', await evaluate(`!!document.querySelector('.wt-scrim')`), true);

  await clickAt(Math.round(1400 * 0.8) > 900 ? 700 : 700, 500);
  await sleep(500);
  check('点击遮罩关闭抽屉', await evaluate(`!document.querySelector('.wt-scrim')`), true);
} finally {
  chrome.kill();
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
