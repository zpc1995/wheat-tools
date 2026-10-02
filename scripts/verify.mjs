/**
 * Runs every logic check and reports a single pass/fail.
 *
 * Written as a script rather than an npm-script shell loop so it behaves the
 * same on Windows, and so the browser-dependent checks can be skipped with an
 * explicit reason instead of silently passing.
 *
 * Usage:
 *   node scripts/verify.mjs            # logic checks only
 *   node scripts/verify.mjs --all      # include the browser-driven checks
 *
 * Exit code is non-zero if any check fails.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

/**
 * Checks that drive a real browser.
 *
 * They are excluded by default because CI and a fresh clone have no Chromium,
 * and a check that cannot run must not look like one that passed. `--all` runs
 * them for local use.
 */
const BROWSER_CHECKS = new Set([
  'check-tools.mjs',
  'check-a11y.mjs',
  'check-sidebar.mjs',
  'check-theme.mjs',
  'check-stopwatch-ui.mjs',
  'verify-ui.mjs',
]);

/** Checks that need an external binary, and what happens without it. */
const EXTERNAL_REQUIREMENTS = {
  'check-oncalendar.mjs': 'systemd-analyze（缺失时该检查会自行跳过交叉验证部分）',
  'check-chmod-calculator.mjs': 'chmod 与 stat（GNU coreutils；缺失时该检查会自行跳过系统比对部分）',
};

const includeBrowser = process.argv.includes('--all');
const scriptsDir = new URL('.', import.meta.url).pathname;

const checks = readdirSync(scriptsDir)
  .filter((name) => /^check-.*\.mjs$/.test(name))
  .sort();

const toRun = checks.filter(
  (name) => includeBrowser || !BROWSER_CHECKS.has(name),
);
const skipped = checks.filter((name) => !toRun.includes(name));

let totalAssertions = 0;
const failures = [];

console.log(`运行 ${toRun.length} 项检查${includeBrowser ? '（含浏览器检查）' : ''}\n`);

for (const name of toRun) {
  const started = Date.now();
  const result = spawnSync('node', [`${scriptsDir}${name}`], {
    encoding: 'utf8',
    // Browser checks can take minutes; the rest are seconds.
    timeout: BROWSER_CHECKS.has(name) ? 900_000 : 300_000,
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const lines = output.trim().split('\n');

  // Find the count anywhere in the output rather than assuming it is the last
  // line: some checks print a note about their reference source afterwards, and
  // reading only the final line silently reported those as "0 assertions".
  let countMatch = null;
  for (const line of lines) {
    const match = /(\d+)\/(\d+) passed/.exec(line);
    if (match) countMatch = match;
  }
  const summary = countMatch ? countMatch[0] : (lines[lines.length - 1] ?? '');
  const assertions = countMatch ? Number(countMatch[1]) : 0;
  totalAssertions += assertions;

  const label = name.replace(/^check-/, '').replace(/\.mjs$/, '');
  const elapsed = `${((Date.now() - started) / 1000).toFixed(1)}s`;

  if (result.status === 0) {
    console.log(`PASS  ${label.padEnd(14)} ${String(assertions).padStart(4)} 项  ${elapsed}`);
  } else {
    failures.push({ name, output });
    console.log(`FAIL  ${label.padEnd(14)} ${summary || `退出码 ${result.status}`}  ${elapsed}`);
    // Surface the failing lines so the CI log is actionable without digging.
    for (const line of lines.filter((l) => l.startsWith('FAIL'))) {
      console.log(`        ${line}`);
    }
  }
}

if (skipped.length > 0) {
  console.log(
    `\n跳过 ${skipped.length} 项（需要浏览器，用 --all 运行）：${skipped.join(', ')}`,
  );
}

const requirements = Object.entries(EXTERNAL_REQUIREMENTS).filter(([name]) =>
  toRun.includes(name),
);
for (const [name, note] of requirements) {
  console.log(`注意：${name} 需要 ${note}`);
}

console.log(`\n合计 ${totalAssertions} 项断言，${toRun.length - failures.length}/${toRun.length} 项检查通过`);

if (failures.length > 0) {
  console.log('\n失败详情：');
  for (const failure of failures) {
    console.log(`\n--- ${failure.name} ---`);
    console.log(failure.output.trim().split('\n').slice(-25).join('\n'));
  }
  process.exit(1);
}
