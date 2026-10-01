/**
 * End-to-end UI verification for the built bundle.
 *
 * Why `file://` instead of http://127.0.0.1: this sandbox's browser renderer is
 * killed when it navigates to an http URL, so the production bundle is inlined
 * into one self-contained page under .verify/ and driven via the DevTools
 * Protocol. Everything else (React, Fluent, routing, interactions) is the real
 * production code.
 *
 * Usage: npm run build && node scripts/verify-ui.mjs
 * Writes screenshots and report.json into .screenshots/.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = new URL('../', import.meta.url).pathname;
const OUT = `${ROOT}.screenshots/`;
const VERIFY_DIR = `${ROOT}.verify/`;
const PROFILE = '/tmp/wheat-tools-chrome-profile';
const PORT = 9333;

mkdirSync(OUT, { recursive: true });
mkdirSync(VERIFY_DIR, { recursive: true });

// ---- Write a self-contained page from the production assets ---------------
const assetsDir = `${ROOT}dist/assets/`;
const files = readdirSync(assetsDir);
const jsFile = files.find((f) => f.endsWith('.js'));
const cssFile = files.find((f) => f.endsWith('.css'));
if (!jsFile) throw new Error(`No JS bundle found in ${assetsDir}`);

const js = readFileSync(assetsDir + jsFile, 'utf8');
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
const pageUrl = `file://${pagePath}` + (process.env.WT_START_HASH ?? "");

// ---- Launch the browser and attach ---------------------------------------
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
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const targets = await response.json();
    const page = targets.find(
      (t) => t.type === 'page' && t.webSocketDebuggerUrl,
    );
    if (page) {
      wsUrl = page.webSocketDebuggerUrl;
      break;
    }
  } catch {
    // still starting
  }
  await sleep(500);
}
if (!wsUrl) {
  chrome.kill();
  throw new Error('Could not reach the DevTools page target');
}

const socket = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
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
  if (message.method === 'Runtime.consoleAPICalled') {
    const { type, args } = message.params;
    if (type === 'error' || type === 'warning') {
      consoleErrors.push(
        `[console.${type}] ${args
          .map((a) => a.value ?? a.description ?? a.type)
          .join(' ')
          .slice(0, 300)}`,
      );
    }
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails;
    consoleErrors.push(
      `[exception] ${details.exception?.description ?? details.text}`.slice(
        0,
        400,
      ),
    );
  }
});

function call(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 20000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
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
    throw new Error(
      `evaluate failed: ${
        result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text
      }`,
    );
  }
  return result.result.value;
}

/**
 * Captures the page. `full` temporarily grows the viewport so the whole page
 * is visible, which matters for panels that sit below the fold.
 */
async function shot(name, full = true) {
  let restore = false;
  if (full) {
    const height = await evaluate(
      'Math.min(Math.max(document.documentElement.scrollHeight, 900), 2600)',
    ).catch(() => 1000);
    await call('Emulation.setDeviceMetricsOverride', {
      width: 1400,
      height: Math.ceil(height),
      deviceScaleFactor: 1,
      mobile: false,
    });
    restore = true;
    await sleep(400);
  }
  const { data } = await call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}${name}.png`, Buffer.from(data, 'base64'));
  if (restore) {
    await call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(200);
  }
}

/** Loads the app fresh and waits for React to paint the tool cards. */
async function boot() {
  await call('Page.navigate', { url: pageUrl }).catch(() => {});
  await sleep(2000);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = await evaluate(
      `!!document.querySelector('.wt-tool-card')`,
    ).catch(() => false);
    if (ready) return true;
    await sleep(400);
  }
  return false;
}

/** Waits for a selector to appear. */
async function waitFor(selector, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    const ready = await evaluate(
      `!!document.querySelector(${JSON.stringify(selector)})`,
    ).catch(() => false);
    if (ready) return true;
    await sleep(300);
  }
  return false;
}

/** Opens a tool the way a user does: by clicking its launcher card. */
async function openTool(name, selector) {
  const clicked = await evaluate(`(() => {
    const card = [...document.querySelectorAll('.wt-tool-card')]
      .find(c => c.textContent.includes(${JSON.stringify(name)}));
    const link = card?.querySelector('.wt-tool-card__link') ?? card;
    link?.click(); return !!card;
  })()`);
  if (!clicked) return false;
  return waitFor(selector);
}

/** Returns to the launcher via the brand link in the header. */
async function goHome() {
  await evaluate(`(() => {
    const link = document.querySelector('.wt-header__brand');
    link?.click(); return !!link;
  })()`);
  return waitFor('.wt-tool-card');
}

/** Sets a controlled input/textarea value the way React expects. */
const setValue = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const proto = el.tagName === 'TEXTAREA'
    ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(
    value,
  )});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;

const report = {};

try {
  // ---- 1. Launcher -------------------------------------------------------
  report.booted = await boot();
  report.launcher = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.wt-tool-card')];
    return {
      cardCount: cards.length,
      cardTitles: cards.map(c => c.querySelector('.fui-Subtitle1')?.textContent),
      tokensPresent: !!getComputedStyle(document.documentElement)
        .getPropertyValue('--colorNeutralBackground1').trim(),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      theme: document.documentElement.dataset.theme,
      hasSearch: !!document.querySelector('input[type=search]'),
      headerTitle: document.querySelector('.wt-header__titles')?.innerText.replace(/\\n/g,' / '),
      brandMarkIsSvg: !!document.querySelector('.wt-header__brand svg'),
    };
  })()`);
  await shot('01-launcher-light');

  // search filtering
  await evaluate(setValue('input[type=search]', 'uuid'));
  await sleep(600);
  report.searchFilteredCount = await evaluate(
    `document.querySelectorAll('.wt-tool-card').length`,
  );
  await evaluate(setValue('input[type=search]', ''));
  await sleep(400);

  // ---- 2. Dark theme -----------------------------------------------------
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => (b.getAttribute('aria-label')||'').includes('深色'));
    btn?.click(); return !!btn;
  })()`);
  await sleep(700);
  report.darkTheme = await evaluate(`(() => ({
    theme: document.documentElement.dataset.theme,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    headerBg: getComputedStyle(document.querySelector('.wt-header')).backgroundColor,
  }))()`);
  await shot('02-launcher-dark');

  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => (b.getAttribute('aria-label')||'').includes('浅色'));
    btn?.click(); return true;
  })()`);
  await sleep(500);

  // ---- 3. JSON formatter -------------------------------------------------
  report.jsonMounted = await openTool('JSON 格式化', 'textarea');

  const SAMPLE = JSON.stringify(
    {
      name: 'wheat-tools',
      version: '0.1.0',
      nested: { deep: { deeper: { value: 42 } } },
      list: [1, 'two', true, null, { ok: true }],
      empty: {},
      nothing: null,
    },
    null,
    2,
  );

  await evaluate(setValue('textarea', SAMPLE));
  await sleep(1600);

  report.json = await evaluate(`(() => {
    const tree = document.querySelector('.wt-tree');
    return {
      hasTree: !!tree,
      treeText: tree ? tree.innerText.replace(/\\n/g, ' | ').slice(0, 260) : null,
      expandableToggles: [...document.querySelectorAll('.wt-node__toggle')]
        .filter(b => !b.classList.contains('wt-node__toggle--leaf')).length,
      errorBarVisible: !!document.querySelector('.fui-MessageBar'),
      badgeText: document.querySelector('.fui-Badge')?.textContent,
      outputHeader: document.querySelectorAll('.wt-surface__header')[1]?.innerText.replace(/\\n/g,' '),
      highlightClasses: [...new Set([...document.querySelectorAll('.wt-tree span')]
        .map(s => s.className).filter(c => c.startsWith('wt-')))],
    };
  })()`);
  await shot('03-json-formatted');

  // collapse the root node
  await evaluate(`(() => {
    const t = [...document.querySelectorAll('.wt-node__toggle')]
      .filter(b => !b.classList.contains('wt-node__toggle--leaf'))[0];
    t?.click(); return !!t;
  })()`);
  await sleep(500);
  report.jsonCollapsed = await evaluate(
    `document.querySelector('.wt-tree')?.innerText.replace(/\\n/g,' | ').slice(0,140)`,
  );
  await shot('04-json-collapsed');

  // invalid JSON -> error message bar
  await evaluate(setValue('textarea', '{"a": 1,}'));
  await sleep(1600);
  report.jsonError = await evaluate(`(() => {
    const bar = document.querySelector('.fui-MessageBar');
    return {
      present: !!bar,
      text: bar ? bar.innerText.replace(/\\n/g,' ').slice(0,180) : null,
    };
  })()`);
  await shot('05-json-error');

  // ---- 4. UUID generator -------------------------------------------------
  report.uuidMounted = await (async () => {
    await goHome();
    return openTool('UUID 生成器', '.wt-uuid-value');
  })();
  report.uuidInitial = await evaluate(`(() => ({
    value: document.querySelector('.wt-uuid-value')?.textContent?.trim(),
    rows: document.querySelectorAll('.wt-history__row').length,
  }))()`);

  for (let i = 0; i < 4; i += 1) {
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')]
        .find(x => x.textContent.includes('生成新 UUID'));
      b?.click(); return !!b;
    })()`);
    await sleep(400);
  }

  report.uuidAfter = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.wt-history__value')]
      .map(e => e.textContent.trim());
    return {
      current: document.querySelector('.wt-uuid-value')?.textContent?.trim(),
      rows: document.querySelectorAll('.wt-history__row').length,
      historyValues: rows,
      counterText: document.querySelector('.wt-uuid-display')?.innerText.replace(/\\n/g,' ').slice(0,120),
    };
  })()`);
  report.uuidChecks = {
    countIs5: report.uuidAfter.rows === 5,
    allDistinct:
      new Set(report.uuidAfter.historyValues).size ===
      report.uuidAfter.historyValues.length,
    allV4: report.uuidAfter.historyValues.every((v) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        v,
      ),
    ),
  };
  await shot('06-uuid-history');

  // format switch -> uppercase
  const openedMenu = await evaluate(`(() => {
    const dd = document.querySelector('[aria-label="UUID 显示格式"]');
    dd?.click(); return !!dd;
  })()`);
  await sleep(700);
  await shot('07-uuid-format-menu');
  const clickedUpper = await evaluate(`(() => {
    const opt = [...document.querySelectorAll('[role=option]')]
      .find(o => o.textContent.trim() === '大写');
    opt?.click(); return !!opt;
  })()`);
  await sleep(700);
  report.uuidUppercase = await evaluate(`(() => ({
    value: document.querySelector('.wt-uuid-value')?.textContent?.trim(),
    firstRow: document.querySelector('.wt-history__value')?.textContent?.trim(),
  }))()`);
  report.uuidUppercase.menuOpened = openedMenu;
  report.uuidUppercase.optionClicked = clickedUpper;
  await shot('08-uuid-uppercase');

  // ---- 5. Back navigation returns to the launcher ------------------------
  const backOk = await goHome();
  report.backNavigation = await evaluate(`(() => ({
    returnedToLauncher: document.querySelectorAll('.wt-tool-card').length,
    hasSidebar: !!document.querySelector('.wt-sidebar'),
    headerTitle: document.querySelector('.wt-header__titles')?.innerText.replace(/\\n/g,' / '),
  }))()`);
  report.backNavigation.waitedForCards = backOk;

  report.pageErrors = await evaluate(`window.__WT_ERRORS__ ?? []`);
} catch (error) {
  report.fatal = String(error?.stack ?? error);
} finally {
  report.consoleErrors = consoleErrors;
  writeFileSync(`${OUT}report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  socket.close();
  chrome.kill();
}
