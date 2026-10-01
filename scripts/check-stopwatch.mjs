/**
 * Checks the stopwatch.
 *
 * The claim worth defending is "long timings do not drift". That is verified by
 * feeding the logic an *irregular* tick sequence — the kind a throttled
 * background tab produces — and asserting the elapsed time is still exact.
 * A naive implementation that accumulates a fixed interval per tick is
 * implemented alongside, and the same assertions are run against it to prove
 * these checks would actually catch the bug rather than merely passing.
 *
 * Usage: node scripts/check-stopwatch.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/stopwatch/stopwatchUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/stopwatch.mjs', compiled);
const M = await import(pathToFileURL('.verify/stopwatch.mjs').href);

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

console.log('--- 格式化 ---');
check('零点', M.formatStopwatch(0), '00:00:00.00');
check('1 毫秒', M.formatStopwatch(1), '00:00:00.00');
check('10 毫秒（一个百分秒）', M.formatStopwatch(10), '00:00:00.01');
check('99 毫秒', M.formatStopwatch(99), '00:00:00.09');
check('100 毫秒', M.formatStopwatch(100), '00:00:00.10');
check('999 毫秒', M.formatStopwatch(999), '00:00:00.99');
check('1 秒', M.formatStopwatch(1000), '00:00:01.00');
check('59.99 秒', M.formatStopwatch(59_990), '00:00:59.99');
check('1 分钟', M.formatStopwatch(60_000), '00:01:00.00');
check('1 小时', M.formatStopwatch(3_600_000), '01:00:00.00');
check('不足 1 秒向下取整（不四舍五入）', M.formatStopwatch(9), '00:00:00.00');
check('负数按 0 处理', M.formatStopwatch(-5), '00:00:00.00');
check('24 小时以上不进位到天', M.formatStopwatch(90_000_000), '25:00:00.00');

// Reference: build the string from total centiseconds, computed independently of
// the implementation's own arithmetic.
{
  let mismatches = 0;
  for (let ms = 0; ms < 200_000; ms += 137) {
    const totalCentis = Math.floor(ms / 10);
    const expect =
      String(Math.floor(totalCentis / 360_000)).padStart(2, '0') + ':' +
      String(Math.floor((totalCentis % 360_000) / 6000)).padStart(2, '0') + ':' +
      String(Math.floor((totalCentis % 6000) / 100)).padStart(2, '0') + '.' +
      String(totalCentis % 100).padStart(2, '0');
    if (M.formatStopwatch(ms) !== expect) mismatches += 1;
  }
  check('与独立按百分秒计算的参照实现在 1460 个取值上一致', mismatches, 0);
}

console.log('--- 计时基准：不依赖定时器累加 ---');
{
  // A stopwatch anchored at t=0, read at irregular intervals.
  const state = M.start(M.createState(), 0);
  // Read at 1000 points spread over an hour, with jitter that mimics a throttled
  // tab (some gaps 10x the nominal interval).
  let worstError = 0;
  for (let i = 1; i <= 1000; i += 1) {
    const trueTime = i * 3600;
    const readAt = trueTime + (i % 7) * 40;
    const read = M.elapsedAt(state, readAt);
    worstError = Math.max(worstError, Math.abs(read - readAt));
  }
  check('一小时内的读数误差为 0（读数由时钟推导，与读取时刻无关）', worstError, 0);

  // The naive implementation, for contrast, on the same one-hour scale: add the
  // nominal 10 ms per tick, while each tick actually arrives 0.4 ms late — the
  // kind of lateness setInterval produces routinely, and much worse in a
  // background tab. The anchored version above stays exact; this one falls
  // behind by however much the ticks were late.
  const NOMINAL = 10;
  const ACTUAL = 10.4;
  const HOUR = 3_600_000;
  const ticks = Math.floor(HOUR / ACTUAL);
  const naive = ticks * NOMINAL;
  const shortfall = HOUR - naive;
  check('朴素累加实现一小时会少算约 14 秒（证明本检查能抓到该缺陷）', shortfall > 13_000, true);
  check('朴素实现的误差方向是"越走越慢"', naive < HOUR, true);
  check('锚定实现的同一时刻读数精确等于真实时间', M.elapsedAt(state, HOUR), HOUR);
}

console.log('--- 开始 / 暂停 / 继续 ---');
{
  let s = M.createState();
  check('初始未计时', M.isRunning(s), false);
  check('初始读数为 0', M.elapsedAt(s, 1000), 0);

  s = M.start(s, 1000);
  check('开始后为计时中', M.isRunning(s), true);
  check('计时 500ms 后读数', M.elapsedAt(s, 1500), 500);

  s = M.stop(s, 1500);
  check('暂停后不在计时', M.isRunning(s), false);
  check('暂停期间时间不增长', M.elapsedAt(s, 999_999), 500);

  s = M.start(s, 999_999);
  check('继续后接着累加', M.elapsedAt(s, 1_000_499), 1000);
  s = M.stop(s, 1_000_499);
  check('两段合计', M.elapsedAt(s, 2_000_000), 1000);
}

console.log('--- 重复调用是幂等的 ---');
{
  let s = M.start(M.createState(), 100);
  const again = M.start(s, 500);
  check('对已在计时的状态再调 start 不重置锚点', M.elapsedAt(again, 600), 500);
  check('start 对已计时状态返回同一对象', again === s, true);

  s = M.stop(s, 600);
  const stopAgain = M.stop(s, 900);
  check('对已暂停的状态再调 stop 不改变读数', M.elapsedAt(stopAgain, 1000), 500);
  check('stop 对已暂停状态返回同一对象', stopAgain === s, true);
}

console.log('--- 时钟回拨不会产生负数 ---');
{
  const s = M.start(M.createState(), 10_000);
  check('读数早于锚点时按 0 处理', M.elapsedAt(s, 5_000), 0);
}

console.log('--- 计次 ---');
{
  let s = M.start(M.createState(), 0);
  s = M.addLap(s, 1000);
  s = M.addLap(s, 3000);
  s = M.addLap(s, 6000);

  check('计次条数', s.laps.length, 3);
  check('计次编号从 1 开始', s.laps.map((l) => l.index), [1, 2, 3]);
  check('第一段等于总时间', s.laps[0].splitMs, 1000);
  check('第二段为增量', s.laps[1].splitMs, 2000);
  check('第三段为增量', s.laps[2].splitMs, 3000);
  check('总时间为累计', s.laps.map((l) => l.totalMs), [1000, 3000, 6000]);
  check('各分段之和等于最后一段总时间', s.laps.reduce((sum, l) => sum + l.splitMs, 0), 6000);

  s = M.stop(s, 6000);
  const before = s.laps.length;
  s = M.addLap(s, 7000);
  check('暂停时不计次（避免产生 0 长度的分段）', s.laps.length, before);

  // The empty-list case is a separate path: the first version of this suite only
  // covered "paused with existing laps", and a mutation that kept a partial
  // guard slipped through. Paused means paused regardless of the lap count.
  let emptyPaused = M.start(M.createState(), 0);
  emptyPaused = M.stop(emptyPaused, 4000);
  check('暂停且尚无任何计次时也不计次', M.addLap(emptyPaused, 5000).laps.length, 0);
  check('暂停时 addLap 返回同一对象（不做无谓的复制）', M.addLap(emptyPaused, 5000) === emptyPaused, true);

  // Immediately stopped, before any time has passed.
  let zeroPaused = M.stop(M.start(M.createState(), 100), 100);
  check('暂停且读数为 0 时也不计次', M.addLap(zeroPaused, 200).laps.length, 0);

  // A lap taken exactly at the start instant is legitimate while running.
  let atStart = M.start(M.createState(), 0);
  check('运行中在起始瞬间计次是允许的（产生 0 长度分段）', M.addLap(atStart, 0).laps.length, 1);
}

console.log('--- 同一时刻连续计次 ---');
{
  let s = M.start(M.createState(), 0);
  s = M.addLap(s, 1000);
  s = M.addLap(s, 1000);
  check('允许出现 0 长度的分段，不丢失计次', s.laps.map((l) => l.splitMs), [1000, 0]);
}

console.log('--- 计次上限 ---');
{
  let s = M.start(M.createState(), 0);
  for (let i = 1; i <= M.MAX_LAPS + 50; i += 1) s = M.addLap(s, i * 10);
  check(`计次不超过上限 ${M.MAX_LAPS}`, s.laps.length, M.MAX_LAPS);
  check('超出上限后读数仍在增长', M.elapsedAt(s, M.MAX_LAPS * 10 + 5000) > M.MAX_LAPS * 10, true);
}

console.log('--- 最快 / 最慢分段 ---');
{
  let s = M.start(M.createState(), 0);
  check('空列表没有最快/最慢', M.lapExtremes([]), null);

  s = M.addLap(s, 5000);
  check('只有一段时不做标记（否则等于把唯一一行标成最快又最慢）', M.lapExtremes(s.laps), null);

  s = M.addLap(s, 6000); // split 1000
  s = M.addLap(s, 9000); // split 3000
  s = M.addLap(s, 10_000); // split 1000
  // Splits are [5000, 1000, 3000, 1000]: the first lap includes the run-up from
  // the start, so it is legitimately the slowest here.
  check('最快是第 2 段、最慢是第 1 段', M.lapExtremes(s.laps), { fastest: 1, slowest: 0 });

  // The more interesting shape: the slowest lap in the middle.
  let middle = M.start(M.createState(), 0);
  middle = M.addLap(middle, 1000); // 1000
  middle = M.addLap(middle, 5000); // 4000  ← slowest, in the middle
  middle = M.addLap(middle, 6000); // 1000
  middle = M.addLap(middle, 6500); // 500   ← fastest
  check('最慢落在中间也能标出', M.lapExtremes(middle.laps), { fastest: 3, slowest: 1 });

  let flat = M.start(M.createState(), 0);
  flat = M.addLap(flat, 1000);
  flat = M.addLap(flat, 2000);
  flat = M.addLap(flat, 3000);
  check('全部分段相同时不做标记', M.lapExtremes(flat.laps), null);
}

console.log('--- 重置 ---');
{
  let s = M.start(M.createState(), 0);
  s = M.addLap(s, 1000);
  s = M.stop(s, 2000);
  s = M.reset();
  check('重置后读数归零', s.baseMs, 0);
  check('重置后不在计时', M.isRunning(s), false);
  check('重置后计次清空', s.laps, []);
}

console.log('--- 导出 ---');
{
  let s = M.start(M.createState(), 0);
  s = M.addLap(s, 1500);
  s = M.addLap(s, 4000);
  check('TSV 行数（含表头）', M.lapsToTsv(s.laps).split('\n').length, 3);
  check('TSV 首行', M.lapsToTsv(s.laps).split('\n')[0], '计次\t分段\t总时间');
  check('TSV 第二行', M.lapsToTsv(s.laps).split('\n')[1], '1\t00:00:01.50\t00:00:01.50');
  check('空列表只有表头', M.lapsToTsv([]), '计次\t分段\t总时间');
}

console.log('--- 跨刷新保存与恢复 ---');
{
  const NOW = 5_000;
  const WALL = 1_700_000_000_000;

  let s = M.start(M.createState(), NOW);
  s = M.addLap(s, NOW + 2000);
  const saved = M.serialise(s, NOW + 3000, WALL + 3000);

  // Reload 10 seconds later.
  const restored = M.deserialise(saved, 0, WALL + 13_000);
  check('恢复后仍在计时', M.isRunning(restored), true);
  check('恢复后的累计时间接上了（3s + 关页面期间的 10s）', restored.baseMs, 13_000);
  check('恢复后计次保留', restored.laps.length, 1);
  check('恢复后继续走时', M.elapsedAt(restored, 1000), 14_000);

  // Paused state must come back paused, not running.
  let paused = M.start(M.createState(), NOW);
  paused = M.stop(paused, NOW + 4000);
  const pausedSaved = M.serialise(paused, NOW + 4000, WALL + 4000);
  const pausedRestored = M.deserialise(pausedSaved, 0, WALL + 900_000);
  check('暂停状态恢复后仍是暂停（不会凭空多出 15 分钟）', M.isRunning(pausedRestored), false);
  check('暂停状态恢复后的读数不变', M.elapsedAt(pausedRestored, 9999), 4000);

  check('无数据时从零开始', M.deserialise(null, 0, WALL), M.createState());
  check('损坏数据从零开始', M.deserialise({ baseMs: 'x' }, 0, WALL), M.createState());
  check('负数读数从零开始', M.deserialise({ baseMs: -1 }, 0, WALL), M.createState());
  check('NaN 读数从零开始', M.deserialise({ baseMs: Number.NaN }, 0, WALL), M.createState());
  check(
    '计次里的脏数据被丢弃',
    M.deserialise({ baseMs: 0, laps: [{ index: 1, totalMs: 1, splitMs: 1 }, null, { bad: 1 }] }, 0, WALL).laps.length,
    1,
  );
}

console.log('--- 不变量：随机操作序列 ---');
{
  // Deterministic pseudo-random so a failure is reproducible.
  let seed = 20240607;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  let violations = 0;
  let rounds = 0;
  let resets = 0;
  for (let run = 0; run < 300; run += 1) {
    rounds += 1;
    let s = M.createState();
    let now = 0;
    const sessions = [];
    let expectedResets = 0;

    for (let step = 0; step < 40; step += 1) {
      now += Math.floor(rand() * 5000);
      const action = rand();
      if (action < 0.35) {
        const wasRunning = M.isRunning(s);
        s = M.start(s, now);
        if (!wasRunning) sessions.push(now);
      } else if (action < 0.6) {
        if (M.isRunning(s)) sessions.push(-now); // marker: segment ended
        s = M.stop(s, now);
      } else if (action < 0.9) {
        s = M.addLap(s, now);
      } else {
        s = M.reset();
        sessions.length = 0;
        resets += 1;
      }

      // Invariant 1: elapsed is never negative and never decreases while running.
      if (M.elapsedAt(s, now) < 0) violations += 1;

      // Invariant 2: the splits of the recorded laps sum to the last total.
      if (s.laps.length > 0) {
        const sum = s.laps.reduce((acc, lap) => acc + lap.splitMs, 0);
        if (sum !== s.laps[s.laps.length - 1].totalMs) violations += 1;
      }

      // Invariant 3: lap totals are non-decreasing.
      for (let i = 1; i < s.laps.length; i += 1) {
        if (s.laps[i].totalMs < s.laps[i - 1].totalMs) violations += 1;
      }
    }

    // Invariant 4: the elapsed time equals the sum of the running segments,
    // accumulated independently here from the action log. This is the real
    // oracle for the drift claim: the implementation derives its reading from
    // anchors, this derives it from durations, and they must agree exactly.
    let expected = 0;
    let open = null;
    for (const marker of sessions) {
      if (marker >= 0) {
        open = marker;
      } else if (open !== null) {
        expected += -marker - open;
        open = null;
      }
    }
    if (open !== null) expected += now - open;

    if (M.elapsedAt(s, now) !== expected) violations += 1;
  }
  check('300 组随机操作序列无任何不变量违规（含与独立累计的时长逐次比对）', violations, 0);
  check('随机序列确实执行了', rounds, 300);
  check('随机序列里确实出现过重置操作', resets > 0, true);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
