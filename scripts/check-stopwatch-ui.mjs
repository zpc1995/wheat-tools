/**
 * Verifies the stopwatch's interactive behaviour in a real browser.
 *
 * The logic suite covers the arithmetic; this covers everything the arithmetic
 * cannot: that the display actually ticks, that the lap table renders, that the
 * keyboard shortcuts are wired to the right actions, and that a running
 * stopwatch resumes after a reload. Those are exactly the parts a unit test on
 * pure functions is blind to.
 *
 * Usage: node scripts/check-stopwatch-ui.mjs
 */
import { spawn } from 'node:child_process';
import { readdirSync, unlinkSync, writeFileSync } from 'node:fs';

const DIST = `${new URL('..', import.meta.url).pathname}dist/`;
const PORT = 9494;
const PAGE = `${DIST}__stopwatch.html`;

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
    '--allow-file-access-from-files', '--user-data-dir=/tmp/wheat-tools-stopwatch-profile',
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

/** Presses a key through the browser, so React's handlers see a real event. */
async function pressKey(key, code, keyCode) {
  await call('Input.dispatchKeyEvent', {
    type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode,
  });
  await call('Input.dispatchKeyEvent', {
    type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode,
  });
  await sleep(250);
}

/** Real click on a button found by its text. */
async function clickButton(label) {
  const box = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((b) => b.textContent.trim() === ${JSON.stringify(label)});
    if (!button) return null;
    const r = button.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  if (!box) return false;
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await sleep(300);
  return true;
}

/** The displayed time, as text. */
const DISPLAY = `document.querySelector('[role=timer]')?.textContent ?? ''`;
/** The displayed time parsed to milliseconds, so it can be compared numerically. */
const DISPLAY_MS = `(() => {
  const text = document.querySelector('[role=timer]')?.textContent ?? '';
  const m = /^(\\d+):(\\d+):(\\d+)\\.(\\d+)$/.exec(text);
  if (!m) return null;
  return ((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000 + (+m[4]) * 10;
})()`;
const LAP_ROWS = `document.querySelectorAll('tbody tr').length`;

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
/** Asserts a relationship rather than an exact value (for live measurements). */
function checkThat(label, condition, detail) {
  if (condition) passed += 1; else failed += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${condition ? '' : `\n        ${detail}`}`);
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
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: `file://${PAGE}` }).catch(() => undefined);
  await sleep(3200);

  // Pin the interface language, then reload so it takes effect. The button
  // labels are translated, and the runner's browser is English, so without this
  // the check would look for「开始」and find "Start".
  await evaluate(`try { localStorage.setItem('wheat-tools:locale', 'zh-CN'); } catch {} true`);
  await evaluate(`try { localStorage.removeItem('wheat-tools:stopwatch'); } catch {} true`);
  await call('Page.reload', {}).catch(() => undefined);
  await sleep(3000);
  // Go straight to the tool rather than clicking through the launcher.
  await evaluate(`location.hash = '#/tools/stopwatch'`);
  await sleep(2200);

  // Guard: if the labels are not the expected ones, say so instead of reporting
  // a cascade of confusing failures.
  const labels = await evaluate(`[...document.querySelectorAll('button')].map((b) => b.textContent.trim()).join('|')`);
  if (!labels.includes('开始')) {
    throw new Error(`界面语言未固定为中文，当前按钮：${labels}`);
  }

  console.log('--- 初始状态 ---');
  check('停表显示为全零', await evaluate(DISPLAY), '00:00:00.00');
  check('尚无计次记录', await evaluate(LAP_ROWS), 0);
  check(
    '计次按钮在未开始时禁用',
    await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '计次')?.disabled`),
    true,
  );

  console.log('\n--- 开始计时：显示必须真的在走 ---');
  check('点击「开始」', await clickButton('开始'), true);
  await sleep(600);
  const t1 = await evaluate(DISPLAY_MS);
  await sleep(800);
  const t2 = await evaluate(DISPLAY_MS);
  checkThat('读数在推进', typeof t1 === 'number' && typeof t2 === 'number' && t2 > t1, `t1=${t1} t2=${t2}`);
  checkThat(
    '推进幅度与真实经过的时间相符（约 0.8 秒，允许 0.4 秒误差）',
    Math.abs(t2 - t1 - 800) < 400,
    `实际推进 ${t2 - t1}ms`,
  );
  check(
    '按钮变为「暂停」',
    await evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '暂停')`),
    true,
  );

  console.log('\n--- 计次 ---');
  await clickButton('计次');
  await sleep(500);
  await clickButton('计次');
  await sleep(500);
  check('产生了两条计次记录', await evaluate(LAP_ROWS), 2);
  check(
    '计次后仍在下限以上（读数继续推进）',
    (await evaluate(DISPLAY_MS)) > t2,
    true,
  );
  const splits = await evaluate(
    `[...document.querySelectorAll('tbody tr')].map((r) => r.children[1].textContent)`,
  );
  checkThat('分段列为时间格式', Array.isArray(splits) && splits.every((s) => /^\d\d:\d\d:\d\d\.\d\d$/.test(s)), JSON.stringify(splits));
  // Layout regression guard: the shared `wt-surface__body` class is a flex row,
  // so forgetting to override the direction silently places the heading beside
  // the table instead of above it. Nothing in the logic tests would notice.
  check(
    '「计次记录」标题在表格上方而非并排',
    await evaluate(`(() => {
      const heading = [...document.querySelectorAll('h2')].find((h) => /计次记录/.test(h.textContent));
      const table = document.querySelector('table');
      if (!heading || !table) return 'missing';
      return heading.getBoundingClientRect().bottom <= table.getBoundingClientRect().top + 1;
    })()`),
    true,
  );

  check(
    '总时间不早于分段之和（数值一致性）',
    await evaluate(`(() => {
      const parse = (t) => { const m = /^(\\d+):(\\d+):(\\d+)\\.(\\d+)$/.exec(t); return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 100; };
      const rows = [...document.querySelectorAll('tbody tr')];
      if (rows.length === 0) return false;
      const sum = rows.reduce((acc, r) => acc + parse(r.children[1].textContent), 0);
      const last = parse(rows[rows.length - 1].children[2].textContent);
      return Math.abs(sum - last) < 0.05;
    })()`),
    true,
  );

  console.log('\n--- 暂停：读数必须定住 ---');
  await clickButton('暂停');
  await sleep(400);
  const paused = await evaluate(DISPLAY_MS);
  await sleep(900);
  check('暂停后读数不再变化', await evaluate(DISPLAY_MS), paused);

  console.log('\n--- 键盘快捷键 ---');
  await pressKey(' ', 'Space', 32);
  await sleep(500);
  const resumed = await evaluate(DISPLAY_MS);
  checkThat('空格键恢复计时', resumed > paused, `暂停时 ${paused}，现在 ${resumed}`);

  await pressKey('l', 'KeyL', 76);
  await sleep(400);
  check('L 键计次', await evaluate(LAP_ROWS), 3);

  await pressKey('r', 'KeyR', 82);
  await sleep(400);
  check('R 键重置读数', await evaluate(DISPLAY), '00:00:00.00');
  check('R 键清空计次', await evaluate(LAP_ROWS), 0);

  console.log('\n--- 刷新后继续计时 ---');
  await clickButton('开始');
  await sleep(300);
  await clickButton('计次');
  await sleep(400);
  const beforeReload = await evaluate(DISPLAY_MS);
  await call('Page.reload', {}).catch(() => undefined);
  await sleep(3200);
  const afterReload = await evaluate(DISPLAY_MS);
  checkThat(
    '刷新后读数大于刷新前（关页面期间仍在走）',
    typeof afterReload === 'number' && afterReload > beforeReload,
    `刷新前 ${beforeReload}，刷新后 ${afterReload}`,
  );
  check('刷新后计次记录保留', await evaluate(LAP_ROWS), 1);
  await sleep(700);
  checkThat('刷新后仍在计时（读数继续推进）', (await evaluate(DISPLAY_MS)) > afterReload, '读数未推进');
} finally {
  chrome.kill();
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
