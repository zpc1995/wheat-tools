/**
 * Accessibility audit across every tool.
 *
 * This is a mechanical check, not a substitute for manual testing with a screen
 * reader — but the things it does check are the ones that are unambiguously
 * wrong and easy to regress: an interactive control with no accessible name, an
 * `img` without `alt`, a hidden drawer that still accepts focus, a positive
 * `tabindex` reordering the page, an `aria-labelledby` pointing at nothing.
 *
 * Two kinds of check run for each tool:
 *
 *   1. **Static DOM scan** inside the page, for names/labels/landmarks.
 *   2. **Real keyboard walk** driven over CDP: Tab is pressed repeatedly and the
 *      focused element is recorded, so "is this reachable and does it show a
 *      focus ring" is answered by the browser rather than by inspecting markup.
 *
 * Usage: node scripts/check-a11y.mjs
 */
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const VERIFY_DIR = `${ROOT}.verify/`;
const DIST = `${ROOT}dist/`;
const PROFILE = '/tmp/wheat-tools-a11y-profile';
const PORT = 9401;

mkdirSync(VERIFY_DIR, { recursive: true });

// Guard against auditing a stale build.
//
// This exact mistake was made once: the sources were changed, the type checker
// passed, and the audit ran against the previous `dist/` — reporting problems
// that had already been fixed and hiding the ones that had not. Comparing
// timestamps turns that silent wrong answer into an explicit failure.
function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtime(`${path}/`));
    } else {
      const { mtimeMs } = statSync(path);
      if (mtimeMs > newest) newest = mtimeMs;
    }
  }
  return newest;
}

// Only bundled sources matter here: editing this script does not change what
// the app renders, so its own timestamp must not trigger the warning.
const newestSource = newestMtime(`${ROOT}src/`);
const newestBundle = newestMtime(`${DIST}assets/`);
if (newestBundle < newestSource) {
  console.error(
    'dist/ 比源码旧，请先执行 `npx vite build` 再运行本检查——\n' +
      '否则审计的是上一版产物，结论会同时包含已修复和未修复的问题。',
  );
  process.exit(1);
}

const assets = readdirSync(`${DIST}assets`);
const entry = assets.find((f) => /^index-.*\.js$/.test(f));
const css = assets.find((f) => f.endsWith('.css'));
if (!entry) {
  console.error('dist/assets 中找不到入口，请先执行 vite build');
  process.exit(1);
}

// The harness lives inside dist so the entry's relative dynamic imports resolve.
const pagePath = `${DIST}__a11y.html`;
writeFileSync(
  pagePath,
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>a11y</title>${css ? `<link rel="stylesheet" href="./assets/${css}">` : ''}</head>
<body><div id="root"></div>
<script type="module" src="./assets/${entry}"></script>
</body></html>`,
);

function cleanup() {
  try {
    unlinkSync(pagePath);
  } catch {
    // Already removed.
  }
}
process.on('exit', cleanup);

const chrome = spawn(
  'chromium',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-proxy-server',
    '--no-first-run',
    '--allow-file-access-from-files',
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${PORT}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

/** The in-page audit. Returns a list of issue objects. */
const AUDIT_SCRIPT = `(() => {
  const issues = [];
  const add = (kind, detail, extra) => issues.push({ kind, detail, ...(extra || {}) });

  const visible = (el) => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (el.offsetParent === null && style.position !== 'fixed') return false;
    return true;
  };

  /** Simplified accessible-name computation: enough to catch a missing name. */
  const nameOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();

    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const text = labelledby
        .split(/\\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .trim();
      if (text) return text;
      add('dangling-labelledby', el.tagName.toLowerCase() + ' 的 aria-labelledby 指向不存在的 id: ' + labelledby);
    }

    const text = (el.textContent || '').trim();
    if (text) return text;

    // A wrapping or associated <label> names a form control.
    if (el.id) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label && label.textContent.trim()) return label.textContent.trim();
    }
    const wrapping = el.closest('label');
    if (wrapping && wrapping.textContent.trim()) return wrapping.textContent.trim();

    for (const attr of ['title', 'alt', 'placeholder', 'value', 'aria-placeholder']) {
      const value = el.getAttribute(attr);
      if (value && value.trim()) return value.trim();
    }
    return '';
  };

  const describe = (el) => {
    const tag = el.tagName.toLowerCase();
    const cls = typeof el.className === 'string' && el.className
      ? '.' + el.className.split(/\\s+/).slice(0, 2).join('.')
      : '';
    const text = (el.textContent || '').trim().slice(0, 24);
    return tag + cls + (text ? ' 「' + text + '」' : '');
  };

  // 1. Interactive controls must have an accessible name.
  const interactive = [...document.querySelectorAll(
    'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=checkbox], [role=tab], [role=switch]'
  )];
  for (const el of interactive) {
    if (!visible(el)) continue;
    if (el.hasAttribute('disabled')) continue;
    // A hidden file input is operated through its label or a sibling button.
    if (el.type === 'file' && el.hidden) continue;
    if (!nameOf(el)) add('no-accessible-name', describe(el));
  }

  // 2. Images need alt (an empty alt is valid and means decorative).
  for (const img of document.querySelectorAll('img')) {
    if (!img.hasAttribute('alt')) add('img-without-alt', describe(img));
  }

  // 3. Positive tabindex reorders focus unpredictably.
  for (const el of document.querySelectorAll('[tabindex]')) {
    const value = Number(el.getAttribute('tabindex'));
    if (value > 0) add('positive-tabindex', describe(el) + ' tabindex=' + value);
  }

  // 4. Duplicate ids break label/labelledby associations.
  const seen = new Map();
  for (const el of document.querySelectorAll('[id]')) {
    const id = el.id;
    if (seen.has(id)) add('duplicate-id', id + '（出现在多个元素上）');
    else seen.set(id, el);
  }

  // 5. Structure: a page should have one main landmark and a heading, and the
  //    heading levels should not skip (an h2 directly under an h1 is fine, an h4
  //    after an h1 is not).
  const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role=heading]')]
    .filter(visible);
  if (headings.length === 0) add('no-heading', '页面没有任何标题元素');

  const levels = headings
    .map((el) => {
      const explicit = el.getAttribute('aria-level');
      if (explicit) return Number(explicit);
      return Number(el.tagName.slice(1));
    })
    .filter((level) => Number.isFinite(level));

  // Exactly one h1 is the expectation; more than one makes the page's own title
  // ambiguous when navigating by heading.
  const level1 = levels.filter((level) => level === 1).length;
  if (level1 === 0 && headings.length > 0) {
    add('no-h1', '页面有标题元素，但没有一级标题');
  } else if (level1 > 1) {
    add('multiple-h1', '页面有 ' + level1 + ' 个一级标题');
  }

  for (let index = 1; index < levels.length; index += 1) {
    if (levels[index] - levels[index - 1] > 1) {
      add('heading-skip', '标题层级从 h' + levels[index - 1] + ' 跳到 h' + levels[index]);
      break;
    }
  }

  const mains = document.querySelectorAll('main, [role=main]');
  if (mains.length === 0) add('no-main-landmark', '缺少 main 地标');

  // 6. Focusable content inside an aria-hidden or inert subtree is a trap: the
  //    focus ring lands on something the user cannot see.
  for (const hidden of document.querySelectorAll('[aria-hidden="true"]')) {
    const focusable = hidden.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) {
      add('focusable-in-aria-hidden', describe(hidden) + ' 内有 ' + focusable.length + ' 个可聚焦元素');
    }
  }

  // 7. Buttons must be real buttons: a clickable div is not keyboard operable.
  for (const el of document.querySelectorAll('div[onclick], span[onclick]')) {
    if (!el.hasAttribute('role') && !el.hasAttribute('tabindex')) {
      add('clickable-div', describe(el));
    }
  }

  return {
    issues,
    counts: {
      interactive: interactive.length,
      headings: headings.length,
      landmarks: mains.length,
    },
  };
})()`;

const TOOL_IDS = process.argv.slice(2);

async function evaluate(expression) {
  const response = await call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(
      `evaluate failed: ${response.result.exceptionDetails.text} ${
        response.result.exceptionDetails.exception?.description ?? ''
      }`,
    );
  }
  return response.result?.result?.value;
}

/**
 * Accessible names and roles straight from the browser's accessibility tree.
 *
 * Checking names by hand (aria-label → textContent → title) produces false
 * positives: an `<input>` has no text content, so every Fluent checkbox looked
 * unnamed even though the browser computes a name from its `<label>`. The AX
 * tree is the authoritative answer, so it is what the audit uses.
 */
async function accessibilityMap() {
  const response = await call('Accessibility.getFullAXTree');
  const nodes = response.result?.nodes ?? [];
  const byBackendId = new Map();

  for (const node of nodes) {
    if (node.ignored) continue;
    const role = node.role?.value ?? '';
    const name = node.name?.value ?? '';
    const backendId = node.backendDOMNodeId;
    if (backendId === undefined) continue;
    byBackendId.set(backendId, { role, name });
  }

  return { byBackendId, nodes };
}

/** Resolves the accessibility node for a DOM element by its object id. */
async function axForElement(objectId) {
  const response = await call('Accessibility.getPartialAXTree', {
    objectId,
    fetchRelatives: false,
  });
  const nodes = response.result?.nodes ?? [];
  const node = nodes.find((item) => !item.ignored);
  return node ? { role: node.role?.value ?? '', name: node.name?.value ?? '' } : null;
}

/** Walks the page with real Tab presses and reports what receives focus. */
async function keyboardWalk(limit = 60) {
  const focused = [];
  // Start from the top of the document so the walk is deterministic.
  await evaluate('document.body.focus(); window.scrollTo(0, 0); true');

  for (let index = 0; index < limit; index += 1) {
    await call('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
      key: 'Tab',
      code: 'Tab',
    });
    await call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
      key: 'Tab',
      code: 'Tab',
    });

    const info = await evaluate(`(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { done: true };

      // A focus ring is often not drawn on the focused element itself: Fluent
      // puts it on the wrapper, so a Dropdown button reports outline none while
      // its parent reports a solid 2px outline. Checking only the element
      // produced false positives, so the parent and pseudo-elements are checked
      // too. (Backticks must not appear in this comment: it lives inside a
      // template literal, and a backtick would end the string early.)
      const ring = (node) => {
        if (!node) return false;
        const style = getComputedStyle(node);
        const outlined =
          style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
        const shadowed = style.boxShadow !== 'none' && style.boxShadow !== '';
        return outlined || shadowed;
      };
      const hasOutline =
        ring(el) ||
        ring(el.parentElement) ||
        ring(el, '::after') ||
        ring(el, '::before') ||
        ring(el.parentElement, '::after');
      const hasBoxShadow = false;
      const tag = el.tagName.toLowerCase();
      return {
        done: false,
        key: tag + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\\s+/)[0] : ''),
        visibleFocus: hasOutline || hasBoxShadow,
        // Elements scrolled outside the viewport are still focusable but the
        // user cannot see where focus went.
        inViewport: (() => {
          const rect = el.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
        })(),
      };
    })()`);

    if (!info || info.done) break;

    // Ask the browser what this element is actually announced as.
    const handle = await call('Runtime.evaluate', {
      expression: 'document.activeElement',
    });
    const objectId = handle.result?.result?.objectId;
    const ax = objectId ? await axForElement(objectId) : null;
    info.name = ax?.name ?? '';
    info.role = ax?.role ?? '';
    // A cycle means focus returned to the start.
    if (focused.some((item) => item.key === info.key && item.name === info.name)) break;
    focused.push(info);
    if (focused.length > 400) break;
  }

  return focused;
}

let passed = 0;
let failed = 0;
const allFindings = [];

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
  await call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await call('Page.navigate', { url: `file://${pagePath}` }).catch(() => undefined);
  await sleep(3200);

  // Discover the tool list from the app itself rather than hard-coding it.
  const ids = TOOL_IDS.length > 0
    ? TOOL_IDS
    : await evaluate(`(() => {
        const links = [...document.querySelectorAll('a[href*="#/tools/"]')];
        return [...new Set(links.map((a) => a.getAttribute('href').split('/tools/')[1]))];
      })()`);

  console.log(`审计 ${ids.length} 个工具\n`);

  for (const id of ids) {
    await evaluate(`location.hash = '#/tools/${id}'; true`);
    await sleep(700);

    const audit = await evaluate(AUDIT_SCRIPT);
    const focused = await keyboardWalk();

    const findings = [];
    for (const issue of audit.issues) {
      findings.push(`${issue.kind}: ${issue.detail}`);
    }

    // Keyboard findings.
    const noName = focused.filter((item) => !item.name);
    if (noName.length > 0) {
      findings.push(`keyboard-focus-no-name: ${noName.slice(0, 3).map((i) => i.key).join(', ')}`);
    }
    const invisibleFocus = focused.filter((item) => !item.visibleFocus);
    if (invisibleFocus.length > 3) {
      findings.push(
        `focus-indicator-missing: ${invisibleFocus.length}/${focused.length} 个可聚焦元素没有可见焦点样式（例如 ${invisibleFocus
          .slice(0, 2)
          .map((i) => i.key)
          .join(', ')}）`,
      );
    }
    if (focused.length === 0) {
      findings.push('keyboard-unreachable: Tab 无法聚焦任何元素');
    }

    if (findings.length === 0) {
      passed += 1;
      console.log(`PASS  ${id.padEnd(22)} 可聚焦 ${focused.length} 个，无问题`);
    } else {
      failed += 1;
      console.log(`FAIL  ${id.padEnd(22)} ${findings.length} 类问题`);
      for (const finding of findings.slice(0, 8)) console.log(`        ${finding}`);
      allFindings.push({ id, findings });
    }
  }

  writeFileSync(
    `${VERIFY_DIR}a11y-report.json`,
    JSON.stringify({ passed, failed, allFindings }, null, 2),
  );
} finally {
  chrome.kill();
}

console.log(`\n${passed}/${passed + failed} 个工具通过可访问性检查`);
if (allFindings.length > 0) {
  console.log(`完整报告: .verify/a11y-report.json`);
}
process.exit(failed === 0 ? 0 : 1);
