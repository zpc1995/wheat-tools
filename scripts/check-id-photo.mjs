/**
 * Checks the pure parts of the ID photo tool.
 *
 * Canvas drawing, JPEG encoding and pointer painting need a browser. Everything
 * asserted here runs in Node: the size arithmetic, the print layout, the matting
 * pipeline on synthetic images whose true mask is known by construction, and the
 * size-limited quality search driven by a fake renderer.
 *
 * The matting checks are the important ones. A naive global RGB distance is also
 * computed on the gradient image to show, with numbers, why the multi-cluster
 * estimate and the border flood are needed rather than being decoration.
 *
 * Usage: node scripts/check-id-photo.mjs
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

mkdirSync('.verify', { recursive: true });

/**
 * Transpiles one tool module and rewrites its relative imports.
 *
 * Each module is emitted to `.verify/id-photo-<name>.mjs`, so a plain
 * `from './mattingUtils'` inside a transpiled file would not resolve. Rewriting
 * the specifier keeps the check running against the real source rather than
 * against a copy with imports stripped.
 */
const MODULE_OUTPUT = {
  'photoSpecs.ts': 'specs',
  'mattingUtils.ts': 'matting',
  'aiMatting.ts': 'ai',
  'exportUtils.ts': 'export',
  'framingUtils.ts': 'framing',
};

const loadModule = async (file, name) => {
  const source = readFileSync(`src/tools/id-photo/${file}`, 'utf8');
  let compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [target, alias] of Object.entries(MODULE_OUTPUT)) {
    if (target === file) continue;
    const stem = target.replace(/\.ts$/, '');
    compiled = compiled.split(`'./${stem}'`).join(`'./id-photo-${alias}.mjs'`);
  }
  const output = `.verify/id-photo-${name}.mjs`;
  writeFileSync(output, compiled);
  return import(pathToFileURL(output).href);
};

const specs = await loadModule('photoSpecs.ts', 'specs');
const matting = await loadModule('mattingUtils.ts', 'matting');
const ai = await loadModule('aiMatting.ts', 'ai');
const framing = await loadModule('framingUtils.ts', 'framing');
const exporting = await loadModule('exportUtils.ts', 'export');

let passed = 0;
let failed = 0;

function record(ok, label, detail) {
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` + (ok ? '' : `\n        ${detail}`),
  );
}

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  record(
    ok,
    label,
    `got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`,
  );
}

function checkTrue(label, condition, detail = '') {
  record(condition === true, label, detail);
}

function checkClose(label, actual, expected, tolerance) {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
  record(
    ok,
    label,
    `got      ${actual}\n        expected ${expected} ± ${tolerance}`,
  );
}

function checkAtLeast(label, actual, minimum) {
  const ok = Number.isFinite(actual) && actual >= minimum;
  record(
    ok,
    label,
    `got      ${actual}\n        expected ≥ ${minimum}`,
  );
}

function checkAtMost(label, actual, maximum) {
  const ok = Number.isFinite(actual) && actual <= maximum;
  record(
    ok,
    label,
    `got      ${actual}\n        expected ≤ ${maximum}`,
  );
}

function checkThrows(label, run, fragment) {
  let message = null;
  try {
    run();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  const ok = typeof message === 'string' && message.includes(fragment);
  record(
    ok,
    label,
    `got      ${JSON.stringify(message)}\n        expected to include ${JSON.stringify(fragment)}`,
  );
}

console.log('--- 颜色空间参照值（CIE D65 / sRGB 标准原色）---');
{
  const red = matting.rgbToLab(255, 0, 0);
  checkClose('红色 L', red.L, 53.2408, 0.2);
  checkClose('红色 a', red.a, 80.0925, 0.2);
  checkClose('红色 b', red.b, 67.2032, 0.2);

  const green = matting.rgbToLab(0, 255, 0);
  checkClose('绿色 L', green.L, 87.7347, 0.2);
  checkClose('绿色 a', green.a, -86.1827, 0.2);
  checkClose('绿色 b', green.b, 83.1793, 0.2);

  const blue = matting.rgbToLab(0, 0, 255);
  checkClose('蓝色 L', blue.L, 32.297, 0.2);
  checkClose('蓝色 a', blue.a, 79.1875, 0.2);
  checkClose('蓝色 b', blue.b, -107.8602, 0.2);

  checkClose('白色 L', matting.rgbToLab(255, 255, 255).L, 100, 0.001);
  checkClose('白色 a', matting.rgbToLab(255, 255, 255).a, 0, 0.01);
  checkClose('黑色 L', matting.rgbToLab(0, 0, 0).L, 0, 0.001);
  checkClose(
    '同一颜色的 Lab 距离为 0',
    matting.labDistance(red, matting.rgbToLab(255, 0, 0)),
    0,
    1e-9,
  );
  checkClose(
    'Lab 距离对称',
    matting.labDistance(red, green),
    matting.labDistance(green, red),
    1e-9,
  );
}

console.log('--- 子函数：边框、软阈值、泛洪、连通域、形态学、羽化 ---');
{
  const ring = matting.borderPixelIndices(5, 5, 1);
  check('5×5 一圈边框的像素数', ring.length, 16);
  check('边框不含中心', Array.from(ring).includes(12), false);
  check(
    '边框包含四个角',
    [0, 4, 20, 24].every((index) => Array.from(ring).includes(index)),
    true,
  );
  check('边框厚度大于图片时取全图', matting.borderPixelIndices(5, 5, 3).length, 25);
}
{
  const alpha = matting.softThreshold(
    new Float32Array([0, 5, 10, 15, 20, 25]),
    10,
    20,
  );
  check('软阈值：低阈值以下为 0', Array.from(alpha.slice(0, 3)), [0, 0, 0]);
  check('软阈值：中点为 128', alpha[3], 128);
  check('软阈值：高阈值以上为 255', Array.from(alpha.slice(4)), [255, 255]);

  const hard = matting.softThreshold(new Float32Array([9, 10, 11]), 10, 10);
  check('高阈值不大于低阈值时退化为硬阈值', Array.from(hard), [0, 0, 255]);

  const candidate = matting.candidateBackground(
    new Float32Array([9, 10, 11]),
    10,
  );
  check('候选背景：距离等于低阈值算作背景', Array.from(candidate), [1, 1, 0]);
}
{
  const candidate = new Uint8Array(25);
  // A small connected region in the top-left corner plus an isolated interior.
  for (const index of [0, 1, 6, 18]) candidate[index] = 1;
  const flooded = matting.floodFillFromBorder(candidate, 5, 5);
  check('泛洪只保留连到边框的候选像素', Array.from(flooded.filter((v) => v === 1)).length, 3);
  check('内部孤立的候选像素不算背景', flooded[18], 0);

  const all = matting.floodFillFromBorder(new Uint8Array(25).fill(1), 5, 5);
  check('全图候选时整张都是背景', Array.from(all).every((v) => v === 1), true);

  const empty = matting.floodFillFromBorder(new Uint8Array(25), 5, 5);
  check('没有候选时背景为空', Array.from(empty).every((v) => v === 0), true);
}
{
  // Keeps significant components, drops specks.
  //
  // Keeping only the single largest blob was the first implementation, and it
  // silently amputated anything not connected to the main body — a head split
  // from the shoulders by one stray pixel, an arm cut by the crop. The defaults
  // now keep every component that reaches 2% of the largest, so a lone speck
  // still goes but a real second part stays.
  const binary = new Uint8Array(25);
  for (const index of [0, 1, 5, 6]) binary[index] = 1;
  binary[24] = 1;
  const largest = matting.largestComponentMask(binary, 5, 5);
  check('最大连通域保留较大的分量', largest.pixels, 4);
  check('最大连通域数量', largest.components, 2);
  check('孤立的单像素噪点被丢弃', largest.mask[24], 0);

  // A genuinely separate second part (>= the fraction bar) must survive.
  const twoParts = new Uint8Array(100);
  for (let index = 0; index < 40; index += 1) twoParts[index] = 1;
  for (let index = 60; index < 70; index += 1) twoParts[index] = 1;
  const both = matting.largestComponentMask(twoParts, 10, 10);
  check('达到比例的第二个分量被保留', both.pixels, 50);
  check('两个分量都在掩码里', [both.mask[0], both.mask[65]], [1, 1]);

  // Raising the bar restores the old behaviour for callers that want it.
  const strict = matting.largestComponentMask(twoParts, 10, 10, 1);
  check('比例设为 1 时只留最大分量', strict.pixels, 40);
  check('较大部分被保留', largest.mask[0], 1);

  const none = matting.largestComponentMask(new Uint8Array(25), 5, 5);
  check('没有前景时最大连通域为空', none.pixels, 0);
  check('没有前景时分量数为 0', none.components, 0);
}
{
  const single = new Uint8Array(25);
  single[12] = 1;
  const opened = matting.openBinary(single, 5, 5, 1);
  check('开运算去掉孤立单像素', Array.from(opened).some((v) => v === 1), false);

  const dilated = matting.dilateBinary(single, 5, 5, 1);
  check(
    '膨胀把单像素扩成 3×3',
    Array.from(dilated).filter((v) => v === 1).length,
    9,
  );

  const filled = new Uint8Array(25).fill(1);
  filled[12] = 0;
  const closed = matting.closeBinary(filled, 5, 5, 1);
  check('闭运算补上单像素小孔', closed[12], 1);

  const solid = new Uint8Array(25).fill(1);
  const eroded = matting.erodeBinary(solid, 5, 5, 1);
  check('边界按图片内像素计算，实心块不会被凭空削掉', Array.from(eroded).every((v) => v === 1), true);
}
{
  const feathered = matting.featherAlpha(
    new Uint8ClampedArray([0, 0, 255, 0, 0]),
    5,
    1,
    1,
  );
  check('羽化 5×1 的中间高亮', Array.from(feathered), [0, 85, 85, 85, 0]);

  const uniform = matting.featherAlpha(new Uint8ClampedArray(9).fill(128), 3, 3, 2);
  check('均匀区域的羽化不改变数值', Array.from(uniform).every((v) => v === 128), true);
}
{
  const original = new Uint8ClampedArray(49).fill(255);
  const erased = matting.applyBrushStrokes(original, 7, 7, [
    { x: 3, y: 3, radius: 2, mode: 'erase', hardness: 1 },
  ]);
  check('擦除画笔把中心变成透明', erased[3 * 7 + 3], 0);
  check('擦除画笔不影响远处', erased[0], 255);
  check('画笔不修改传入的掩码', original[3 * 7 + 3], 255);

  const restored = matting.applyBrushStrokes(
    new Uint8ClampedArray(49),
    7,
    7,
    [{ x: 3, y: 3, radius: 2, mode: 'restore', hardness: 1 }],
  );
  check('恢复画笔把中心补回前景', restored[3 * 7 + 3], 255);
}

console.log('\n--- AI 抠图：输入张量（手算像素值与 NCHW 排布）---');
{
  // Derived from the implementation rather than hardcoded: this used to say 256,
  // and when the model changed to a 512-input network every offset silently
  // pointed at the wrong pixels while the labels still claimed 256.
  const SIZE = ai.modelInputSize(2, 2);
  const PLANE = SIZE * SIZE;
  const rgba = (width, height, pixelAt) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const [r, g, b, a] = pixelAt(x, y);
        const offset = (y * width + x) * 4;
        data[offset] = r;
        data[offset + 1] = g;
        data[offset + 2] = b;
        data[offset + 3] = a;
      }
    }
    return data;
  };
  // The same arithmetic the implementation documents: RMBG-1.4 normalises with
  // mean 0.5 and std 1.0, so the range is [-0.5, 0.5] rather than [-1, 1].
  const shade = (value) => value / 255 - 0.5;

  const single = ai.buildInputTensor(rgba(1, 1, () => [10, 20, 30, 255]), 1, 1);
  check('输入张量长度为 3 × SIZE²', single.data.length, PLANE * 3);
  check('输入张量形状为 [1,3,SIZE,SIZE]', single.dims, [1, 3, SIZE, SIZE]);
  check('输入张量的宽高与 SIZE 一致', [single.width, single.height], [SIZE, SIZE]);

  const expected = [shade(10), shade(20), shade(30)];
  for (let channel = 0; channel < 3; channel += 1) {
    const slice = single.data.subarray(channel * PLANE, (channel + 1) * PLANE);
    checkTrue(
      `单像素输入的第 ${channel} 通道全是手算值`,
      slice.every((value) => Math.abs(value - expected[channel]) <= 1e-6),
      `first=${slice[0]}, expected=${expected[channel]}`,
    );
  }

  // Four colours in a 2x2 image. At this scale each source pixel occupies a
  // large block, so the corners are pure colours and can be checked exactly.
  const quadPixels = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [255, 255, 255, 255],
  ];
  const quad = ai.buildInputTensor(
    rgba(2, 2, (x, y) => quadPixels[y * 2 + x]),
    2,
    2,
  );
  const at = (channel, x, y) => quad.data[channel * PLANE + y * SIZE + x];
  const EDGE = Math.max(2, Math.round(SIZE * 0.04));
  const FAR = SIZE - EDGE - 1;
  check('2×2 左上角是纯红', [at(0, EDGE, EDGE), at(1, EDGE, EDGE), at(2, EDGE, EDGE)], [0.5, -0.5, -0.5]);
  check('2×2 右上角是纯绿', [at(0, FAR, EDGE), at(1, FAR, EDGE), at(2, FAR, EDGE)], [-0.5, 0.5, -0.5]);
  check('2×2 左下角是纯蓝', [at(0, EDGE, FAR), at(1, EDGE, FAR), at(2, EDGE, FAR)], [-0.5, -0.5, 0.5]);
  check('2×2 右下角是纯白', [at(0, FAR, FAR), at(1, FAR, FAR), at(2, FAR, FAR)], [0.5, 0.5, 0.5]);
  checkTrue(
    '所有输入值都落在 [-0.5,0.5]',
    quad.data.every((value) => value >= -0.5 && value <= 0.5),
    '出现越界值',
  );

  // Half-pixel centres, the convention the exported model expects. At x=128 on
  // the 2x2 image the red channel is 255*(1-t) with t = 128.5/128 - 0.5.
  // At the horizontal midpoint of a 2-pixel-wide source the red channel is the
  // average of red and green.
  const mid = Math.floor(SIZE / 2) - 1;
  checkClose(
    '2×2 中间位置的双线性插值与手算一致',
    at(0, mid, EDGE),
    (shade(255) + shade(0)) / 2,
    0.02,
  );

  const gray = ai.buildInputTensor(rgba(1, 1, () => [77, 77, 77, 255]), 1, 1);
  const grayValue = shade(77);
  checkTrue(
    '灰度图的三个通道相同',
    [0, 1, 2].every((channel) =>
      gray.data
        .subarray(channel * PLANE, (channel + 1) * PLANE)
        .every((value) => Math.abs(value - grayValue) <= 1e-6),
    ),
    `expected ${grayValue}`,
  );

  const black = ai.buildInputTensor(rgba(1, 1, () => [0, 0, 0, 255]), 1, 1);
  checkTrue('纯黑映射为 -0.5', black.data.every((value) => value === -0.5), 'not all -0.5');
  const white = ai.buildInputTensor(rgba(1, 1, () => [255, 255, 255, 255]), 1, 1);
  checkTrue('纯白映射为 0.5', white.data.every((value) => value === 0.5), 'not all 0.5');

  const withAlpha = (alpha) => rgba(2, 1, (x) => [x === 0 ? 200 : 40, 100, 50, alpha]);
  const opaque = ai.buildInputTensor(withAlpha(255), 2, 1);
  const transparent = ai.buildInputTensor(withAlpha(0), 2, 1);
  checkTrue(
    'alpha 通道被忽略',
    transparent.data.every((value, index) => value === opaque.data[index]),
    'alpha 影响了 RGB 结果',
  );

  checkThrows(
    '输入张量拒绝 0 宽',
    () => ai.buildInputTensor(new Uint8ClampedArray(4), 0, 1),
    '正整数',
  );
  checkThrows(
    '输入张量拒绝负数高',
    () => ai.buildInputTensor(new Uint8ClampedArray(4), 1, -2),
    '正整数',
  );
  checkThrows(
    '输入张量拒绝非整数尺寸',
    () => ai.buildInputTensor(new Uint8ClampedArray(4), 1.5, 1),
    '正整数',
  );
  checkThrows(
    '输入张量拒绝过短的 RGBA 数据',
    () => ai.buildInputTensor(new Uint8ClampedArray(3), 1, 1),
    '长度不足',
  );
}

console.log('\n--- AI 抠图：alpha 缩放（双线性、clamp、恒等）---');
{
  const SIZE = ai.modelInputSize(1024, 1024);
  const COUNT = SIZE * SIZE;
  const half = new Float32Array(COUNT).fill(0.5);
  const resized = ai.resizeAlpha(half, 37, 41);
  check('缩放输出的像素数', resized.length, 37 * 41);
  checkTrue(
    '常量 0.5 放大后仍是常量 128',
    resized.every((value) => value === 128),
    '出现了非 128 的值',
  );
  checkTrue(
    '常量 0 放大后仍是 0',
    ai.resizeAlpha(new Float32Array(COUNT), 73, 29).every((value) => value === 0),
    '出现了非 0 的值',
  );
  checkTrue(
    '常量 1 放大后仍是 255',
    ai
      .resizeAlpha(new Float32Array(COUNT).fill(1), 73, 29)
      .every((value) => value === 255),
    '出现了非 255 的值',
  );
  checkTrue(
    '大于 1 的 alpha 被 clamp 到 255',
    ai.resizeAlpha(new Float32Array(COUNT).fill(2), 5, 5).every((value) => value === 255),
    'clamp 失败',
  );
  checkTrue(
    '小于 0 的 alpha 被 clamp 到 0',
    ai
      .resizeAlpha(new Float32Array(COUNT).fill(-0.5), 5, 5)
      .every((value) => value === 0),
    'clamp 失败',
  );

  const identity = new Float32Array(COUNT);
  for (let index = 0; index < COUNT; index += 1) {
    identity[index] = (index % 257) / 256;
  }
  const same = ai.resizeAlpha(identity, SIZE, SIZE);
  let identityMismatches = 0;
  for (let index = 0; index < COUNT; index += 1) {
    if (same[index] !== Math.round(identity[index] * 255)) identityMismatches += 1;
  }
  check('尺寸不变时是恒等映射', identityMismatches, 0);
  check('缩放到 1×1 时取中心值', Array.from(ai.resizeAlpha(half, 1, 1)), [128]);

  checkThrows('缩放拒绝 0 宽', () => ai.resizeAlpha(half, 0, 10), '正整数');
  checkThrows('缩放拒绝负数高', () => ai.resizeAlpha(half, 10, -1), '正整数');
  checkThrows('缩放拒绝非整数尺寸', () => ai.resizeAlpha(half, 10.5, 10), '正整数');
  checkThrows(
    '缩放拒绝长度不对的 alpha',
    () => ai.resizeAlpha(new Float32Array(10), 10, 10),
    'alpha 掩码长度',
  );
  checkThrows(
    '缩放拒绝空 alpha',
    () => ai.resizeAlpha(new Float32Array(0), 10, 10),
    'alpha 掩码长度',
  );
}

console.log('\n--- AI 抠图：加载失败时回退到传统算法（注入假加载器）---');
{
  const classic = { engine: 'classic' };
  let calls = 0;
  const failed = await ai.matteWithFallback({
    useAi: true,
    supported: true,
    runClassic: () => classic,
    runAi: async () => {
      calls += 1;
      throw new Error('模拟：模型下载失败。');
    },
  });
  check('回退结果来自传统算法', failed.result, classic);
  check('回退时 usedAi 为 false', failed.usedAi, false);
  checkTrue(
    '回退说明写明已改用本地算法',
    failed.notice.includes('已改用本地算法'),
    failed.notice,
  );
  checkTrue(
    '回退说明保留可读原因',
    failed.notice.includes('模拟：模型下载失败。'),
    failed.notice,
  );
  check('确实调用了会失败的 AI 加载器', calls, 1);

  let unsupportedCalls = 0;
  const unsupported = await ai.matteWithFallback({
    useAi: true,
    supported: false,
    runClassic: () => classic,
    runAi: async () => {
      unsupportedCalls += 1;
      return { engine: 'ai' };
    },
  });
  check('不支持时使用传统算法结果', unsupported.result, classic);
  check('不支持时不尝试加载模型', unsupportedCalls, 0);
  checkTrue(
    '不支持说明提到 WebAssembly',
    unsupported.notice.includes('WebAssembly'),
    unsupported.notice,
  );

  let offCalls = 0;
  const off = await ai.matteWithFallback({
    useAi: false,
    supported: true,
    runClassic: () => classic,
    runAi: async () => {
      offCalls += 1;
      return { engine: 'ai' };
    },
  });
  check('未勾选时不调用 AI', offCalls, 0);
  check('未勾选时没有提示', off.notice, null);
  check('未勾选时结果来自传统算法', off.result, classic);

  const aiResult = { engine: 'ai' };
  const success = await ai.matteWithFallback({
    useAi: true,
    supported: true,
    runClassic: () => classic,
    runAi: async () => aiResult,
  });
  check('AI 成功时使用 AI 结果', success.result, aiResult);
  check('AI 成功时 usedAi 为 true', success.usedAi, true);
  check('AI 成功时没有回退提示', success.notice, null);

  const thrownString = await ai.matteWithFallback({
    useAi: true,
    supported: true,
    runClassic: () => classic,
    runAi: async () => {
      throw '模型文件缺失';
    },
  });
  checkTrue(
    '非 Error 的异常也能转成可读说明',
    thrownString.notice.includes('模型文件缺失'),
    thrownString.notice,
  );

  check(
    'describeAiFailure 保留 Error 消息',
    ai.describeAiFailure(new Error('具体原因。')),
    '具体原因。',
  );
  check('describeAiFailure 去掉首尾空白', ai.describeAiFailure('  磁盘错误  '), '磁盘错误');
  check('describeAiFailure 的未知兜底', ai.describeAiFailure(null), '未知错误。');
  check('当前运行环境支持 WebAssembly 探测', ai.isAiMattingSupported(), true);
}

// Synthetic image helpers.
function makeImage(width, height, colorAt) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = colorAt(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

function fillRect(image, x0, y0, x1, y1, color) {
  for (let y = Math.max(0, y0); y < Math.min(image.height, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(image.width, x1); x += 1) {
      const offset = (y * image.width + x) * 4;
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
      image.data[offset + 3] = 255;
    }
  }
}

function rectMask(width, height, x0, y0, x1, y1) {
  const mask = new Uint8Array(width * height);
  for (let y = Math.max(0, y0); y < Math.min(height, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(width, x1); x += 1) {
      mask[y * width + x] = 1;
    }
  }
  return mask;
}

function evaluateMask(alpha, truth) {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;
  for (let index = 0; index < truth.length; index += 1) {
    const predicted = alpha[index] >= 128;
    if (predicted && truth[index] === 1) truePositive += 1;
    else if (predicted) falsePositive += 1;
    else if (truth[index] === 1) falseNegative += 1;
    else trueNegative += 1;
  }
  const union = truePositive + falsePositive + falseNegative;
  return {
    iou: union === 0 ? 1 : truePositive / union,
    falsePositiveRate:
      falsePositive + trueNegative === 0
        ? 0
        : falsePositive / (falsePositive + trueNegative),
    falseNegativeRate:
      falseNegative + truePositive === 0
        ? 0
        : falseNegative / (falseNegative + truePositive),
    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,
  };
}

function gradientColor(width) {
  return (x) => {
    const t = x / (width - 1);
    return [
      Math.round(40 + (225 - 40) * t),
      Math.round(55 + (235 - 55) * t),
      Math.round(85 + (248 - 85) * t),
    ];
  };
}

console.log('\n--- 抠图：合成图 ground truth ---');
let gradientScenario = null;
{
  const width = 160;
  const height = 200;
  const image = makeImage(width, height, () => [205, 208, 212]);
  fillRect(image, 40, 30, 120, 170, [92, 58, 38]);
  const truth = rectMask(width, height, 40, 30, 120, 170);
  const result = matting.mattePortrait(image);
  const evaluated = evaluateMask(result.alpha, truth);
  console.log(`  纯色背景 + 矩形主体：IoU ${evaluated.iou.toFixed(4)}`);
  checkAtLeast('纯色背景 IoU', evaluated.iou, 0.97);
  check('纯色背景检测到主体', result.stats.subjectFound, true);
  check('纯色背景一角为透明', result.alpha[0], 0);
  check('纯色背景主体中心为不透明', result.alpha[100 * width + 80], 255);
}
{
  const width = 160;
  const height = 200;
  const image = makeImage(width, height, gradientColor(width));
  fillRect(image, 45, 35, 120, 175, [150, 35, 40]);
  const truth = rectMask(width, height, 45, 35, 120, 175);
  const result = matting.mattePortrait(image);
  const evaluated = evaluateMask(result.alpha, truth);
  gradientScenario = { image, truth, result, evaluated };
  console.log(
    `  渐变背景 + 矩形主体：IoU ${evaluated.iou.toFixed(4)}，` +
      `背景簇 ${result.stats.clusters}，低阈值 ${result.stats.lowThreshold.toFixed(1)}`,
  );
  checkAtLeast('渐变背景 IoU', evaluated.iou, 0.95);
  checkAtLeast('渐变背景用上了多个簇', result.stats.clusters, 2);
  check('渐变背景检测到主体', result.stats.subjectFound, true);
}
{
  const width = 160;
  const height = 200;
  let seed = 12345;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const image = makeImage(width, height, () => {
    const jitter = () => Math.round((random() * 2 - 1) * 14);
    return [152 + jitter(), 162 + jitter(), 172 + jitter()];
  });
  fillRect(image, 40, 30, 120, 170, [40, 110, 65]);
  const truth = rectMask(width, height, 40, 30, 120, 170);
  const result = matting.mattePortrait(image);
  const evaluated = evaluateMask(result.alpha, truth);
  console.log(`  带噪点背景：IoU ${evaluated.iou.toFixed(4)}`);
  checkAtLeast('带噪点背景 IoU', evaluated.iou, 0.95);
  check('带噪点背景检测到主体', result.stats.subjectFound, true);
}
{
  const width = 160;
  const height = 200;
  const image = makeImage(width, height, () => [232, 234, 238]);
  fillRect(image, 65, 120, 95, 200, [28, 52, 96]);
  const truth = rectMask(width, height, 65, 120, 95, 200);
  const result = matting.mattePortrait(image);
  const evaluated = evaluateMask(result.alpha, truth);
  console.log(
    `  主体接触图片边缘：IoU ${evaluated.iou.toFixed(4)}，` +
      `保留主体像素 ${result.stats.subjectPixels}`,
  );
  checkAtLeast('主体接触边缘时的 IoU', evaluated.iou, 0.9);
  check('主体接触边缘时没有被整体删掉', result.stats.subjectPixels >= 2300, true);
  check('主体接触边缘时仍检测到主体', result.stats.subjectFound, true);
  check('主体接触边缘的下边缘仍有前景', result.alpha[199 * width + 80], 255);
}
{
  const width = 180;
  const height = 200;
  const image = makeImage(width, height, () => [245, 245, 245]);
  fillRect(image, 40, 30, 140, 170, [25, 58, 122]);
  fillRect(image, 70, 80, 110, 130, [245, 245, 245]);
  const truth = rectMask(width, height, 40, 30, 140, 170);
  const result = matting.mattePortrait(image);
  const evaluated = evaluateMask(result.alpha, truth);
  const center = 105 * width + 90;
  console.log(
    `  主体内部与背景同色（白衣服）：IoU ${evaluated.iou.toFixed(4)}，` +
      `内部 alpha ${result.alpha[center]}`,
  );
  checkAtLeast('主体内部同色区域的 IoU', evaluated.iou, 0.9);
  check('主体内部同色区域没有被挖空', result.alpha[center] >= 200, true);
  check('主体外部的同色背景仍然被去掉', result.alpha[10 * width + 10], 0);

  // The enclosed region really is within the low threshold, so a plain global
  // threshold would have erased it. Only the border flood protects it.
  const estimate = matting.estimateBackground(image);
  const distance = matting.distanceField(image, estimate.clusters);
  checkTrue(
    '同色区域的 Lab 距离确实低于低阈值（朴素阈值会挖空）',
    distance[center] <= estimate.low,
    `distance=${distance[center].toFixed(3)}, low=${estimate.low.toFixed(3)}`,
  );
}
{
  const width = 160;
  const height = 200;
  const image = makeImage(width, height, gradientColor(width));
  const result = matting.mattePortrait(image);
  check(
    '全背景图的所有 alpha 都为 0',
    Array.from(result.alpha).every((value) => value === 0),
    true,
  );
  check('全背景图没有主体', result.stats.subjectFound, false);
  check('全背景图的 foregroundRatio 为 0', result.stats.foregroundRatio, 0);
  check('全背景图的主体像素为 0', result.stats.subjectPixels, 0);
  checkClose('全背景图的背景占比为 1', result.stats.backgroundRatio, 1, 1e-9);
}
{
  const width = 160;
  const height = 200;
  let seed = 99;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const image = makeImage(width, height, () => {
    const jitter = () => Math.round((random() * 2 - 1) * 14);
    return [152 + jitter(), 162 + jitter(), 172 + jitter()];
  });
  const result = matting.mattePortrait(image);
  console.log(
    `  全是噪点背景：foregroundRatio ${result.stats.foregroundRatio.toFixed(4)}`,
  );
  check('噪点全背景图没有主体', result.stats.subjectFound, false);
  checkAtMost('噪点全背景图的前景占比可忽略', result.stats.foregroundRatio, 0.01);
}
{
  // Tolerance is applied to both thresholds, and the effect is observable.
  const base = matting.mattePortrait(gradientScenario.image, { tolerance: 1 });
  const looser = matting.mattePortrait(gradientScenario.image, { tolerance: 1.5 });
  checkClose(
    '容差乘在低阈值上',
    looser.stats.lowThreshold,
    base.stats.lowThreshold * 1.5,
    1e-9,
  );
  checkAtLeast(
    '调大容差后背景占比上升',
    looser.stats.backgroundRatio,
    base.stats.backgroundRatio,
  );
}

console.log('\n--- 反证：朴素全局 RGB 距离阈值在渐变背景上失效 ---');
{
  const { image, truth, evaluated } = gradientScenario;
  const width = image.width;
  const height = image.height;

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let samples = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) {
        const offset = (y * width + x) * 4;
        sumR += image.data[offset];
        sumG += image.data[offset + 1];
        sumB += image.data[offset + 2];
        samples += 1;
      }
    }
  }
  const mean = [sumR / samples, sumG / samples, sumB / samples];

  // A typical naive baseline: one mean border colour, a fixed RGB distance of
  // 40, no soft ramp and no connectivity.
  let naiveFalsePositive = 0;
  let naiveFalseNegative = 0;
  let backgroundPixels = 0;
  let subjectPixels = 0;
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const distance = Math.hypot(
      image.data[offset] - mean[0],
      image.data[offset + 1] - mean[1],
      image.data[offset + 2] - mean[2],
    );
    const predicted = distance > 40;
    if (truth[index] === 0) {
      backgroundPixels += 1;
      if (predicted) naiveFalsePositive += 1;
    } else {
      subjectPixels += 1;
      if (!predicted) naiveFalseNegative += 1;
    }
  }
  const naiveFpr = naiveFalsePositive / backgroundPixels;
  const naiveFnr = naiveFalseNegative / subjectPixels;

  console.log(
    `  朴素阈值（单一均值 + RGB 距离 40）：背景误判为前景 ` +
      `${(naiveFpr * 100).toFixed(1)}%，前景漏判 ${(naiveFnr * 100).toFixed(1)}%`,
  );
  console.log(
    `  本实现：背景误判为前景 ${(evaluated.falsePositiveRate * 100).toFixed(2)}%，` +
      `IoU ${evaluated.iou.toFixed(4)}`,
  );
  checkAtLeast('朴素阈值在渐变背景上的背景误判率', naiveFpr, 0.5);
  checkAtMost('本实现在同一张图上的背景误判率', evaluated.falsePositiveRate, 0.01);
}

console.log('\n--- 规格表算术 ---');
{
  const expectedIds = [
    'one-inch',
    'two-inch',
    'small-one-inch',
    'large-one-inch',
    'small-two-inch',
    'large-two-inch',
    'passport',
    'us-visa',
    'schengen-visa',
    'driver-license',
    'social-security-card',
    'graduation',
  ];
  check('规格数量', specs.PHOTO_SPECS.length, 12);
  check('规格 id 与顺序', specs.PHOTO_SPECS.map((item) => item.id), expectedIds);

  const confirmed = {
    'one-inch': [295, 413],
    'small-one-inch': [260, 378],
    'large-one-inch': [390, 567],
    'two-inch': [413, 579],
    'small-two-inch': [413, 531],
    'large-two-inch': [413, 626],
    'us-visa': [600, 600],
  };
  for (const [id, [widthPx, heightPx]] of Object.entries(confirmed)) {
    const spec = specs.findSpec(id);
    check(`${id} 的像素宽度来自独立来源`, spec.widthPx, widthPx);
    check(`${id} 的像素高度来自独立来源`, spec.heightPx, heightPx);
  }
  check(
    '已独立核对的规格集合',
    specs.PHOTO_SPECS.filter((item) => item.confidence === 'verified')
      .map((item) => item.id)
      .sort(),
    Object.keys(confirmed).sort(),
  );
  check('驾驶证被标记为尺寸有分歧', specs.requireSpec('driver-license').confidence, 'disputed');
  checkTrue(
    '驾驶证的说明写明了两种候选尺寸',
    specs.requireSpec('driver-license').note.includes('35 × 45'),
    specs.requireSpec('driver-license').note,
  );
  check('毕业照被标记为常见但未核对', specs.requireSpec('graduation').confidence, 'common');
  checkTrue(
    '毕业照说明提到各校要求不同',
    specs.requireSpec('graduation').note.includes('各校'),
    specs.requireSpec('graduation').note,
  );
  check('社保卡使用 350dpi', specs.requireSpec('social-security-card').dpi, 350);

  for (const spec of specs.PHOTO_SPECS) {
    const widthByDivision = Math.round((spec.widthMm / 25.4) * spec.dpi);
    const widthByFactor = Math.round(spec.widthMm * (spec.dpi / 25.4));
    const heightByDivision = Math.round((spec.heightMm / 25.4) * spec.dpi);
    const heightByFactor = Math.round(spec.heightMm * (spec.dpi / 25.4));
    check(`${spec.id} 宽度与两种独立写法一致`, [
      specs.mmToPx(spec.widthMm, spec.dpi),
      widthByDivision,
      widthByFactor,
      spec.widthPx,
    ], [spec.widthPx, spec.widthPx, spec.widthPx, spec.widthPx]);
    check(`${spec.id} 高度与两种独立写法一致`, [
      specs.mmToPx(spec.heightMm, spec.dpi),
      heightByDivision,
      heightByFactor,
      spec.heightPx,
    ], [spec.heightPx, spec.heightPx, spec.heightPx, spec.heightPx]);
    const pxRatio = spec.widthPx / spec.heightPx;
    const mmRatio = spec.widthMm / spec.heightMm;
    checkClose(`${spec.id} 像素宽高比与毫米比一致`, pxRatio, mmRatio, 0.002);
    checkTrue(`${spec.id} 有中文名`, spec.name.length > 0, spec.name);
  }

  check('mmToPx 25mm@300', specs.mmToPx(25, 300), 295);
  check('mmToPx 35mm@300', specs.mmToPx(35, 300), 413);
  check('mmToPx 49mm@300', specs.mmToPx(49, 300), 579);
  check('mmToPx 152mm@300', specs.mmToPx(152, 300), 1795);
  check('mmToPx 102mm@300', specs.mmToPx(102, 300), 1205);
  check('mmToPx 0mm 返回 0', specs.mmToPx(0, 300), 0);
  check('mmToPx dpi 为 0 返回 0', specs.mmToPx(25, 0), 0);
  check('mmToPx 负数返回 0', specs.mmToPx(-1, 300), 0);
  check('mmToPx NaN 返回 0', specs.mmToPx(Number.NaN, 300), 0);
  check('inchToPx 2 英寸@300', specs.inchToPx(2, 300), 600);
  check('inchToPx 1 英寸@96', specs.inchToPx(1, 96), 96);
  check('inchToPx 无效值返回 0', specs.inchToPx(0, 300), 0);

  const pairs = [
    [22, 300],
    [25, 350],
    [33, 600],
    [35, 300],
    [45, 350],
    [50.8, 300],
    [102, 300],
    [152, 300],
  ];
  check(
    'mmToPx 与 inchToPx(mm/25.4) 交叉一致',
    pairs.map(([mm, dpi]) => specs.mmToPx(mm, dpi)),
    pairs.map(([mm, dpi]) => specs.inchToPx(mm / 25.4, dpi)),
  );

  check('美国签证以英寸定义，2×2 英寸 = 50.8mm', specs.requireSpec('us-visa').widthMm, 50.8);
  check('美国签证像素为 600', specs.inchToPx(2, 300), 600);
  checkTrue(
    '美国签证说明解释了 51×51 的写法',
    specs.requireSpec('us-visa').note.includes('51 × 51'),
    specs.requireSpec('us-visa').note,
  );

  check('未知规格返回 undefined', specs.findSpec('nope'), undefined);
  check('未知规格回退到一寸', specs.requireSpec('nope').id, 'one-inch');
  checkTrue(
    'describeSpec 同时给出毫米、像素与 DPI',
    ['25', '35', '295', '413', '300'].every((token) =>
      specs.describeSpec(specs.requireSpec('one-inch')).includes(token),
    ),
    specs.describeSpec(specs.requireSpec('one-inch')),
  );
}

console.log('\n--- 背景色表 ---');
{
  check('背景色数量', specs.PHOTO_BACKGROUNDS.length, 5);
  check('白色 hex', specs.requireBackground('white').hex, '#FFFFFF');
  check('标准蓝 hex', specs.requireBackground('blue').hex, '#438EDB');
  check('红色 hex', specs.requireBackground('red').hex, '#FF0000');
  check('灰色存在', specs.findBackground('gray') !== undefined, true);
  check('渐变蓝白起点', specs.requireBackground('blue-white').gradientFrom, '#438EDB');
  check('渐变蓝白终点', specs.requireBackground('blue-white').gradientTo, '#FFFFFF');
  check('纯色背景的两个停止点相同', specs.backgroundStops(specs.requireBackground('blue')), ['#438EDB', '#438EDB']);
  check('渐变背景的两个停止点不同', specs.backgroundStops(specs.requireBackground('blue-white')), ['#438EDB', '#FFFFFF']);
  check(
    '所有背景色都是合法 hex',
    specs.PHOTO_BACKGROUNDS.every((item) => /^#[0-9A-F]{6}$/.test(item.hex)),
    true,
  );
  check('未知背景色回退到白色', specs.requireBackground('nope').id, 'white');
}

console.log('\n--- 人脸参考线 ---');
{
  const guide = specs.FACE_GUIDE;
  check('头顶参考线', guide.headTop, 0.1);
  check('眼睛参考线', guide.eyeLine, 0.45);
  check('下巴参考线', guide.chin, 0.8);
  checkClose('头顶到下巴占 70% 高度', specs.headHeightRatio(guide), 0.7, 1e-9);
  checkTrue('三条线从上到下有序', guide.headTop < guide.eyeLine && guide.eyeLine < guide.chin, true);
  const lines = specs.faceGuideLines(guide);
  check('参考线数量', lines.length, 3);
  check('参考线是按高度归一化的坐标', lines.map((line) => line.y), [0.1, 0.45, 0.8]);
  check('按规格取参考线（一寸）', specs.faceGuideForSpec(specs.requireSpec('one-inch')).chin, 0.8);
  check('按规格取参考线（美国签证）', specs.faceGuideForSpec(specs.requireSpec('us-visa')).headTop, 0.1);
}

console.log('\n--- 6 寸拼版：固定期望值与独立排布核对 ---');
{
  const sheet = specs.SHEET_6IN;
  const oneInch = specs.requireSpec('one-inch');
  check('相纸短边 102mm 放在水平方向', [sheet.widthMm, sheet.heightMm], [102, 152]);
  check('相纸像素宽高随方向交换', [sheet.widthPx, sheet.heightPx], [1205, 1795]);
  check('相纸 102mm 边对应 1205px', specs.mmToPx(102, 300), 1205);
  check('相纸 152mm 边对应 1795px', specs.mmToPx(152, 300), 1795);
  check('默认边距 2mm', sheet.marginMm, 2);
  check('默认间距 2mm', sheet.gapMm, 2);

  const layout = specs.layoutSheet(oneInch, sheet);
  console.log(
    `  一寸照在 6 寸相纸上：${layout.columns} 列 × ${layout.rows} 行 = ${layout.count} 张`,
  );
  check('一寸照排成 3 列', layout.columns, 3);
  check('一寸照排成 4 行', layout.rows, 4);
  check('一寸照容量为 12 张', layout.capacity, 12);
  check('默认排满 12 张', layout.count, 12);
  check('槽位数量为 12', layout.slots.length, 12);
  check('默认不限制数量', layout.requestedCount, null);

  const limited = specs.layoutSheet(oneInch, sheet, { limit: 13 });
  check('要求 13 张时也只排下 12 张', limited.slots.length, 12);
  check('要求 13 张时 count 仍为 12', limited.count, 12);
  check('要求 13 张时记录了请求数', limited.requestedCount, 13);
  check('容量封顶为 12', limited.capacity, 12);
  checkTrue(
    '第 4 列在 2mm 边距下放不下',
    4 * oneInch.widthPx + 3 * layout.gapPx > sheet.widthPx - 2 * layout.marginPx,
    `4*${oneInch.widthPx}+3*${layout.gapPx} > ${sheet.widthPx - 2 * layout.marginPx}`,
  );
  checkTrue(
    '第 5 行在 2mm 边距下放不下',
    5 * oneInch.heightPx + 4 * layout.gapPx > sheet.heightPx - 2 * layout.marginPx,
    `5*${oneInch.heightPx}+4*${layout.gapPx} > ${sheet.heightPx - 2 * layout.marginPx}`,
  );

  // Second, independent placement: all arithmetic in millimetres, with its own
  // conversion and its own accumulation loop, then compared with the tool.
  function naiveLayout(photo, template, marginMm, gapMm) {
    const usableWidth = template.widthMm - 2 * marginMm;
    const usableHeight = template.heightMm - 2 * marginMm;
    let columns = 0;
    while ((columns + 1) * photo.widthMm + columns * gapMm <= usableWidth) {
      columns += 1;
    }
    let rows = 0;
    while ((rows + 1) * photo.heightMm + rows * gapMm <= usableHeight) {
      rows += 1;
    }
    const gridWidth = columns * photo.widthMm + Math.max(0, columns - 1) * gapMm;
    const gridHeight = rows * photo.heightMm + Math.max(0, rows - 1) * gapMm;
    const startX = (template.widthMm - gridWidth) / 2;
    const startY = (template.heightMm - gridHeight) / 2;
    const toPx = (mm) => Math.round((mm * template.dpi) / 25.4);
    const slots = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        slots.push({
          row,
          column,
          x: toPx(startX + column * (photo.widthMm + gapMm)),
          y: toPx(startY + row * (photo.heightMm + gapMm)),
        });
      }
    }
    return { columns, rows, slots };
  }

  const naive = naiveLayout(oneInch, sheet, 2, 2);
  check('独立实现的列数', naive.columns, layout.columns);
  check('独立实现的行数', naive.rows, layout.rows);
  check('独立实现的槽位数量', naive.slots.length, layout.slots.length);
  const mismatches = layout.slots.filter((slot, index) => {
    const expected = naive.slots[index];
    return (
      Math.abs(slot.x - expected.x) > 1 ||
      Math.abs(slot.y - expected.y) > 1 ||
      slot.row !== expected.row ||
      slot.column !== expected.column
    );
  });
  check('每一个槽位与独立实现的位置一致（±1px）', mismatches, []);

  let outside = 0;
  let wrongSize = 0;
  let overlaps = 0;
  for (let index = 0; index < layout.slots.length; index += 1) {
    const slot = layout.slots[index];
    if (
      slot.x < 0 ||
      slot.y < 0 ||
      slot.x + slot.width > sheet.widthPx ||
      slot.y + slot.height > sheet.heightPx
    ) {
      outside += 1;
    }
    if (slot.width !== oneInch.widthPx || slot.height !== oneInch.heightPx) {
      wrongSize += 1;
    }
    for (let other = index + 1; other < layout.slots.length; other += 1) {
      const peer = layout.slots[other];
      const overlapX = Math.max(0, Math.min(slot.x + slot.width, peer.x + peer.width) - Math.max(slot.x, peer.x));
      const overlapY = Math.max(0, Math.min(slot.y + slot.height, peer.y + peer.height) - Math.max(slot.y, peer.y));
      if (overlapX > 0 && overlapY > 0) overlaps += 1;
    }
  }
  check('所有槽位都在纸张内', outside, 0);
  check('所有槽位都是目标规格尺寸', wrongSize, 0);
  check('槽位之间不重叠', overlaps, 0);

  const minX = Math.min(...layout.slots.map((slot) => slot.x));
  const minY = Math.min(...layout.slots.map((slot) => slot.y));
  const maxRight = Math.max(...layout.slots.map((slot) => slot.x + slot.width));
  const maxBottom = Math.max(...layout.slots.map((slot) => slot.y + slot.height));
  checkTrue('左边距不小于 2mm', minX >= layout.marginPx, `${minX} >= ${layout.marginPx}`);
  checkTrue('上边距不小于 2mm', minY >= layout.marginPx, `${minY} >= ${layout.marginPx}`);
  checkTrue(
    '左右留白对称（±1px）',
    Math.abs(minX - (sheet.widthPx - maxRight)) <= 1,
    `${minX} vs ${sheet.widthPx - maxRight}`,
  );
  checkTrue(
    '上下留白对称（±1px）',
    Math.abs(minY - (sheet.heightPx - maxBottom)) <= 1,
    `${minY} vs ${sheet.heightPx - maxBottom}`,
  );

  check('裁切线条数（4 条竖线 + 5 条横线）', layout.cutLines.length, 9);
  const verticals = layout.cutLines.filter((line) => line.x1 === line.x2);
  const horizontals = layout.cutLines.filter((line) => line.y1 === line.y2);
  check('竖裁切线数量', verticals.length, 4);
  check('横裁切线数量', horizontals.length, 5);
  check('第一条竖线在网格左边界', verticals[0].x1, layout.gridX);
  check('最后一条竖线在网格右边界', verticals[verticals.length - 1].x1, layout.gridX + layout.gridWidth);
  check('第一条横线在网格上边界', horizontals[0].y1, layout.gridY);
  check('最后一条横线在网格下边界', horizontals[horizontals.length - 1].y1, layout.gridY + layout.gridHeight);

  const twoInch = specs.requireSpec('two-inch');
  const twoInchLayout = specs.layoutSheet(twoInch, sheet);
  console.log(
    `  二寸照在 6 寸相纸上：${twoInchLayout.columns} 列 × ${twoInchLayout.rows} 行 = ${twoInchLayout.count} 张`,
  );
  check('二寸照 2 列', twoInchLayout.columns, 2);
  check('二寸照 2 行', twoInchLayout.rows, 2);
  check('二寸照 4 张', twoInchLayout.count, 4);

  const threeTwoInch = specs.layoutSheet(twoInch, sheet, { limit: 3 });
  check('限制 3 张时槽位数为 3', threeTwoInch.slots.length, 3);
  check('限制 3 张时 count 为 3', threeTwoInch.count, 3);

  const oversized = {
    ...oneInch,
    widthPx: 2000,
    heightPx: 3000,
  };
  const tooBig = specs.layoutSheet(oversized, sheet);
  check('超大照片排不下时容量为 0', tooBig.capacity, 0);
  check('超大照片排不下时没有槽位', tooBig.slots.length, 0);
  check('超大照片排不下时没有裁切线', tooBig.cutLines.length, 0);
}

console.log('\n--- 目标大小二分搜索（受控渲染函数）---');
{
  // Monotonic fake encoder: bytes scale with area and with quality squared.
  const modelBytes = (quality, scale) =>
    Math.round(240000 * scale * scale * (0.12 + 0.88 * quality * quality));
  const render = async (quality, scale) => ({
    quality,
    scale,
    bytes: modelBytes(quality, scale),
  });
  const measure = (payload) => payload.bytes;

  const target = 100000;
  const result = await exporting.encodeWithinTarget(render, measure, {
    targetBytes: target,
  });
  let bruteForceQuality = 0;
  for (let step = 0; step <= 20000; step += 1) {
    const quality = 0.4 + (0.55 * step) / 20000;
    if (modelBytes(quality, 1) <= target) bruteForceQuality = quality;
  }
  console.log(
    `  目标 100KB：得到 ${result.bytes} 字节，质量 ${result.quality.toFixed(4)}，` +
      `暴力搜索 ${bruteForceQuality.toFixed(4)}，共尝试 ${result.attempts.length} 次`,
  );
  check('二分结果不超过目标', result.bytes <= target, true);
  check('二分结果尽量接近目标', result.bytes >= target * 0.9, true);
  check('二分质量与暴力搜索结果一致', Math.abs(result.quality - bruteForceQuality) <= 0.01, true);
  check('在原始尺寸上完成压缩', result.scale, 1);
  check('二分确实达成目标', result.achieved, true);
  check('二分尝试次数（2 次端点 + 8 次二分）', result.attempts.length, 10);

  const huge = await exporting.encodeWithinTarget(render, measure, {
    targetBytes: 1_000_000_000,
  });
  check('目标极大时直接使用最高质量', huge.quality, 0.95);
  check('目标极大时只有 1 次尝试', huge.attempts.length, 1);
  check('目标极大时达成', huge.achieved, true);

  const shrinkTarget = 50000;
  const shrunk = await exporting.encodeWithinTarget(render, measure, {
    targetBytes: shrinkTarget,
  });
  let bruteForceShrunk = 0;
  for (let step = 0; step <= 20000; step += 1) {
    const quality = 0.4 + (0.55 * step) / 20000;
    if (modelBytes(quality, 0.85) <= shrinkTarget) bruteForceShrunk = quality;
  }
  console.log(
    `  目标 50KB：缩放 ${shrunk.scale}，质量 ${shrunk.quality.toFixed(4)}，` +
      `${shrunk.bytes} 字节`,
  );
  check('需要缩小时取第一个能放下的缩放比例', shrunk.scale, 0.85);
  check('缩小后质量与暴力搜索一致', Math.abs(shrunk.quality - bruteForceShrunk) <= 0.01, true);
  check('缩小后不超过目标', shrunk.bytes <= shrinkTarget, true);

  const impossible = await exporting.encodeWithinTarget(render, measure, {
    targetBytes: 1000,
  });
  check('目标过小时明确标记未达成', impossible.achieved, false);
  check('目标过小时返回最小的质量', impossible.quality, 0.4);
  check('目标过小时返回最小的尺寸', impossible.scale, 0.55);
  check('目标过小时返回最小的尝试', impossible.bytes, modelBytes(0.4, 0.55));

  const zero = await exporting.encodeWithinTarget(render, measure, {
    targetBytes: 0,
  });
  check('目标为 0 时未达成', zero.achieved, false);
  check('目标为 0 时不进行无意义的缩放循环', zero.attempts.length, 1);
  check('目标为 0 时仍返回可用的载荷', zero.bytes > 0, true);

  const notANumber = await exporting.encodeWithinTarget(render, measure, {
    targetBytes: Number.NaN,
  });
  check('目标为 NaN 时未达成', notANumber.achieved, false);

  check(
    '缩放比例去重、排序并剔除非法值',
    exporting.normalizeScaleSteps([0.5, 1, 0.75, 1.2, -1, Number.NaN]),
    [1, 0.75, 0.5],
  );
  check('空缩放列表回退为 1', exporting.normalizeScaleSteps([]), [1]);
  check(
    '缩放比例重复项被去掉',
    exporting.normalizeScaleSteps([0.8, 0.8, 1]),
    [1, 0.8],
  );
}

console.log('\n--- 文件大小辅助函数 ---');
{
  check('50KB 换算为字节', exporting.targetBytesFromKb('50'), 51200);
  check('200KB 换算为字节', exporting.targetBytesFromKb('200'), 204800);
  check('非法输入回退到 50KB', exporting.targetBytesFromKb('abc'), 51200);
  check('0 回退到 50KB', exporting.targetBytesFromKb('0'), 51200);
  check('负数回退到 50KB', exporting.targetBytesFromKb('-5'), 51200);
  check('小于 1KB 的目标被抬到 1KB', exporting.targetBytesFromKb('0.5'), 1024);
  check('格式化字节', exporting.formatFileSize(512), '512 B');
  check('格式化 KB', exporting.formatFileSize(2048), '2.0 KB');
  check('格式化 MB', exporting.formatFileSize(1536000), '1.46 MB');
  check('格式化 0', exporting.formatFileSize(0), '0 B');
}

console.log('\n--- 「不发送到服务器」：源码扫描与文案检查 ---');
{
  const files = [
    'IdPhotoTool.tsx',
    'manifest.ts',
    'photoSpecs.ts',
    'mattingUtils.ts',
    'aiMatting.ts',
    'exportUtils.ts',
    'index.ts',
  ];
  const forbidden = [
    'fetch',
    'XMLHttpRequest',
    'sendBeacon',
    'WebSocket',
    'EventSource',
    'FormData',
  ];
  for (const file of files) {
    const raw = readFileSync(`src/tools/id-photo/${file}`, 'utf8');
    // Scan identifiers rather than raw text. A string literal such as the
    // runtime's "failed to fetch" error is not a network call, while a real
    // call site always appears as an identifier. The scanner already skips
    // comments, so documentation cannot trip the check either.
    const identifiers = new Set();
    const scanner = ts.createScanner(
      ts.ScriptTarget.Latest,
      false,
      ts.LanguageVariant.Standard,
      raw,
    );
    let token = scanner.scan();
    while (token !== ts.SyntaxKind.EndOfFileToken) {
      if (
        token === ts.SyntaxKind.Identifier ||
        token === ts.SyntaxKind.PrivateIdentifier
      ) {
        identifiers.add(scanner.getTokenText());
      }
      token = scanner.scan();
    }
    for (const name of forbidden) {
      checkTrue(
        `${file} 去注释后不含 ${name}`,
        !identifiers.has(name),
        '发现网络 API 标识符',
      );
    }
    checkTrue(
      `${file} 不含「上传」字样`,
      !raw.includes('上传'),
      '源码里出现了「上传」',
    );
    checkTrue(
      `${file} 不含「登录」字样`,
      !raw.includes('登录'),
      '源码里出现了「登录」',
    );
  }

  const component = readFileSync('src/tools/id-photo/IdPhotoTool.tsx', 'utf8');
  const manifest = readFileSync('src/tools/id-photo/manifest.ts', 'utf8');
  const requiredCopy = [
    '自动抠图适合背景相对干净的照片（纯色墙、幕布）。复杂背景（杂乱室内、户外）请用画笔手工修整。',
    '图片只在你的浏览器内存里处理，不发送到任何服务器。',
    '本工具不做人脸美化、不改变五官。',
    '常用规格，具体以受理机构要求为准。',
  ];
  for (const text of requiredCopy) {
    checkTrue(`界面文案存在：${text.slice(0, 18)}…`, component.includes(text), '缺少必需文案');
  }
  checkTrue(
    'manifest 也写明常用规格以受理机构要求为准',
    manifest.includes('常用规格，具体以受理机构要求为准'),
    'manifest 缺少尺寸免责声明',
  );
  checkTrue(
    '界面包含驾驶证尺寸不确定的警告',
    component.includes('这个规格的尺寸不确定'),
    '缺少不确定警告',
  );
  checkTrue('页面没有自己的 h1', !component.includes('<h1'), '出现了 h1');
  checkTrue(
    '使用 wt-surface 与纵向 surface body',
    component.includes('className="wt-surface"') &&
      component.includes("flexDirection: 'column'"),
    '缺少 wt-surface 或纵向布局',
  );
  checkTrue(
    '分节标题使用 Text as h2',
    (component.match(/as="h2"/g) ?? []).length >= 4,
    'h2 分节标题不足',
  );
}

console.log('\n--- 体积守卫：onnxruntime 只能由 aiMatting 动态加载 ---');
{
  const ORT_PACKAGE = 'onnxruntime-web';
  // The runtime also exposes backend subpaths such as onnxruntime-web/wasm.
  // Any specifier under the package name counts, so a static import of a
  // subpath cannot slip past the guard.
  const isOrtModule = (specifier) =>
    specifier === ORT_PACKAGE || specifier.startsWith(`${ORT_PACKAGE}/`);
  const collectSources = (dir) => {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) found.push(...collectSources(full));
      else if (/\.tsx?$/.test(entry.name)) found.push(full);
    }
    return found;
  };

  const enclosingFunction = (node) => {
    let current = node.parent;
    while (current) {
      if (
        (ts.isFunctionDeclaration(current) ||
          ts.isFunctionExpression(current) ||
          ts.isMethodDeclaration(current)) &&
        current.name &&
        ts.isIdentifier(current.name)
      ) {
        return current.name.text;
      }
      if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
        return current.name.text;
      }
      current = current.parent;
    }
    return null;
  };

  const sourceFiles = collectSources('src');
  const staticallyImported = [];
  const dynamicallyImported = [];

  for (const file of sourceFiles) {
    const source = readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const visit = (node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        isOrtModule(node.moduleSpecifier.text)
      ) {
        staticallyImported.push(file);
      }
      if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        ts.isStringLiteral(node.moduleReference.expression) &&
        isOrtModule(node.moduleReference.expression.text)
      ) {
        staticallyImported.push(file);
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require' &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0]) &&
        isOrtModule(node.arguments[0].text)
      ) {
        staticallyImported.push(file);
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0]) &&
        isOrtModule(node.arguments[0].text)
      ) {
        dynamicallyImported.push({
          file,
          specifier: node.arguments[0].text,
          enclosing: enclosingFunction(node),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  console.log(
    `  扫描 ${sourceFiles.length} 个源文件：静态 import ${staticallyImported.length} 处，` +
      `动态 import ${dynamicallyImported.length} 处（` +
      dynamicallyImported
        .map((item) => `${item.file} -> ${item.specifier}#${item.enclosing ?? '?'}`)
        .join(', ') +
      '）',
  );

  check('src 里没有静态 import onnxruntime-web', staticallyImported, []);
  check(
    'onnxruntime-web 的动态 import 只出现在 aiMatting.ts',
    [...new Set(dynamicallyImported.map((item) => item.file))],
    ['src/tools/id-photo/aiMatting.ts'],
  );
  check(
    '动态 import 位于具名函数内部，保证按需加载',
    dynamicallyImported.map((item) => item.enclosing),
    ['loadRuntime'],
  );
  checkTrue(
    'IdPhotoTool.tsx 完全不提 onnxruntime-web',
    !readFileSync('src/tools/id-photo/IdPhotoTool.tsx', 'utf8').includes(ORT_PACKAGE),
    '组件里出现了包名，可能被静态打包',
  );
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  check(
    'package.json 声明了 onnxruntime-web 依赖',
    Object.prototype.hasOwnProperty.call(
      packageJson.dependencies ?? {},
      ORT_PACKAGE,
    ),
    true,
  );
}

/* ------------------------------------------------------------------ *
 * JFIF print resolution
 * ------------------------------------------------------------------ */
{
  // A minimal JFIF JPEG: SOI, APP0 with no density, then a fake segment so the
  // rest of the stream has something worth preserving.
  const jfif = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9,
  ]);

  const stamped = exporting.withJpegDensity(jfif, 300);
  const readBack = exporting.readJpegDensity(stamped);
  check('写入后 units 是 dpi（1）', readBack?.units, 1);
  check('写入后 X 密度是 300', readBack?.x, 300);
  check('写入后 Y 密度是 300', readBack?.y, 300);
  check('除头部外字节完全保留', Array.from(stamped.subarray(20)), Array.from(jfif.subarray(20)));
  check('长度不变（只改头部）', stamped.length, jfif.length);
  check('原数组未被就地修改', jfif[13], 0);

  // Idempotent: stamping an already-stamped file changes nothing.
  const twice = exporting.withJpegDensity(stamped, 300);
  check('重复写入结果相同', Array.from(twice), Array.from(stamped));

  // A JPEG with no APP0 gets one spliced in after SOI.
  const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9]);
  const spliced = exporting.withJpegDensity(bare, 350);
  const splicedRead = exporting.readJpegDensity(spliced);
  check('没有 APP0 时插入 JFIF 头', splicedRead ? [splicedRead.units, splicedRead.x] : null, [1, 350]);
  check('插入后原始数据接在头部之后', Array.from(spliced.subarray(20)), Array.from(bare.subarray(2)));
  check('原 SOI 仍在最前', [spliced[0], spliced[1]], [0xff, 0xd8]);

  // Non-JPEG input comes back untouched rather than corrupted.
  const notJpeg = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
  check('非 JPEG 原样返回', Array.from(exporting.withJpegDensity(notJpeg, 300)), Array.from(notJpeg));
  check('非 JPEG 读不到密度', exporting.readJpegDensity(notJpeg), null);

  // Clamping, so a caller cannot write a nonsense density.
  check('密度 0 被抬到 1', exporting.readJpegDensity(exporting.withJpegDensity(jfif, 0))?.x, 1);
  check('密度超上限被截到 65535', exporting.readJpegDensity(exporting.withJpegDensity(jfif, 999999))?.x, 65535);
}


/* ------------------------------------------------------------------ *
 * AI failure messages
 * ------------------------------------------------------------------ */
{
  const cases = [
    ['no available backend found. ERR: [wasm] RuntimeError: Aborted(both async and sync fetching of the wasm failed). Build with -sASSERTIONS for more info.',
     '推理运行时加载失败，可能是网络中断或浏览器不支持 WebAssembly。'],
    ['TypeError: Failed to fetch', '模型文件下载失败，请检查网络后重试。'],
    ['RangeError: out of memory', '内存不足，无法加载模型。可以换一张更小的图片再试。'],
    ['Error: 404 Not Found', '模型文件没有随站点一起部署。'],
  ];
  const wrong = [];
  for (const [input, expected] of cases) {
    const actual = ai.describeAiFailure(new Error(input));
    if (actual !== expected) wrong.push({ input: input.slice(0, 30), actual, expected });
  }
  check('已知的运行时错误映射为简短中文提示', wrong, []);

  // The message must never leak the raw English dump, which is what the UI
  // showed before this mapping existed.
  const raw = ai.describeAiFailure(new Error('no available backend found. ERR: [wasm] thing broke'));
  check('提示里不含内部英文报错', /no available backend|RuntimeError|sASSERTIONS/.test(raw), false);
  check('提示是单句且不太长', raw.length <= 60, true);

  // Unknown errors still produce something usable rather than an empty string.
  const unknown = ai.describeAiFailure(new Error('something odd happened on a very long line that keeps going and going past any reasonable width limit'));
  check('未知错误被截断而不是整段回显', unknown.length <= 81, true);
  check('空错误有兜底文案', ai.describeAiFailure(new Error('   ')), '未知错误。');
  check('非 Error 输入也能处理', ai.describeAiFailure('plain string'), 'plain string');
}


{
  // Model input resolution adapts to the working image: never below 256 (the
  // exporter's own default) and never above 768, where the extra detail stopped
  // being worth the inference cost.
  check('小图不被放大到上限以上', ai.modelInputSize(300, 200), 512);
  check('超小图取下限 512', ai.modelInputSize(120, 90), 512);
  check('中等图按长边给尺寸', ai.modelInputSize(700, 594), 700);
  check('大图被截到上限 1024', ai.modelInputSize(1600, 1486), 1024);
  check('长边是高度时同样成立', ai.modelInputSize(500, 900), 900);

  // The tensor must follow whatever size the helper chose.
  const px = new Uint8ClampedArray(640 * 594 * 4).fill(200);
  const tensor = ai.buildInputTensor(px, 640, 594);
  check('张量尺寸与选择一致', [tensor.width, tensor.height], [640, 640]);
  check('张量数据长度 = 3 * 边长²', tensor.data.length, 3 * 640 * 640);
  check('dims 与边长一致', tensor.dims, [1, 3, 640, 640]);

  // resizeAlpha no longer assumes one fixed resolution.
  const at640 = new Float32Array(640 * 640).fill(0.5);
  check('640 的 alpha 能缩放到任意目标', ai.resizeAlpha(at640, 4, 4).length, 16);
  const at768 = new Float32Array(768 * 768).fill(1);
  check('768 的 alpha 同样可缩放', Array.from(ai.resizeAlpha(at768, 2, 2)), [255, 255, 255, 255]);
}


/* ------------------------------------------------------------------ *
 * Colour decontamination
 * ------------------------------------------------------------------ */
{
  // A pixel that is half subject and half white wall reads, say, (140,140,140)
  // when the true foreground is dark. Un-mixing must move it towards the
  // foreground so the seam stops showing the old backdrop.
  const make = (rgb, a) => {
    const px = new Uint8ClampedArray(4 * rgb.length);
    const al = new Uint8ClampedArray(rgb.length);
    rgb.forEach((c, i) => { px[i*4] = c[0]; px[i*4+1] = c[1]; px[i*4+2] = c[2]; px[i*4+3] = a[i]; al[i] = a[i]; });
    return { px, al };
  };

  // index 0: pure background (alpha 0), index 1: half subject, index 2: solid subject
  const { px, al } = make([[255,255,255],[140,140,140],[20,20,20]], [0, 128, 255]);
  const result = matting.decontaminateEdges(px, al);
  check('背景色从全透明像素估计出来', result.background, [255, 255, 255]);
  check('只处理部分透明的像素', result.touched, 2);
  check('实心像素的颜色没有变', [px[8], px[9], px[10]], [20, 20, 20]);
  // t = 0.502, so F = (140 - 0.498*255)/0.502 ≈ 26 and the weight is (1-t) ≈ 0.498,
  // giving 140 -> 83. Assert the direction and magnitude rather than a guess.
  check('半透明像素被拉向真实前景色', px[4] >= 70 && px[4] < 110, true);
  check('alpha 通道未被改动', [px[3], px[7], px[11]], [0, 128, 255]);

  // No transparent pixels at all: nothing can be estimated, so nothing changes.
  const solid = make([[10,20,30],[40,50,60]], [200, 255]);
  const before = Array.from(solid.px);
  const none = matting.decontaminateEdges(solid.px, solid.al);
  check('没有背景样本时不做任何修改', Array.from(solid.px), before);
  check('没有背景样本时报告 0', none.touched, 0);

  // A dark backdrop must darken, not brighten, the seam (no fixed assumption).
  const dark = make([[10,10,10],[60,60,60],[200,200,200]], [0, 100, 255]);
  matting.decontaminateEdges(dark.px, dark.al);
  check('深色背景时半透明像素变暗', dark.px[4] > 60, true);

  // Fully transparent pixels keep an updated colour so that downscaling does not
  // pull the halo back in.
  const edge = make([[255,255,255],[255,255,255]], [0, 250]);
  matting.decontaminateEdges(edge.px, edge.al);
  check('接近不透明的像素基本不动', Math.abs(edge.px[4] - 255) <= 6, true);
}


/* ------------------------------------------------------------------ *
 * Foreground colour propagation and matte tightening
 * ------------------------------------------------------------------ */
{
  // 4x4 image: the left half is solid foreground, the right half is backdrop
  // colour that must be replaced by the nearby foreground colour.
  const W = 4, H = 4;
  const px = new Uint8ClampedArray(W * H * 4);
  const al = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const solid = x < 2;
      px[i*4] = solid ? 30 : 240;
      px[i*4+1] = solid ? 20 : 240;
      px[i*4+2] = solid ? 10 : 240;
      al[i] = solid ? 255 : 12;
    }
  }
  const prop = matting.propagateForegroundColors(px, al, W, H, { maxDistance: 4 });
  check('扩散填充了非实心像素', prop.filled > 0, true);
  check('扩散后右侧被染成前景色', [px[(2)*4], px[(2)*4+1], px[(2)*4+2]], [30, 20, 10]);
  check('最右侧也被染到（距离足够）', px[(3)*4], 30);
  check('alpha 不被扩散改动', [al[2], al[3]], [12, 12]);

  // Non-square geometry must be honoured: a width guessed from sqrt() would walk
  // the wrong neighbours and this row would stay backdrop-coloured.
  const W2 = 6, H2 = 2;
  const px2 = new Uint8ClampedArray(W2 * H2 * 4);
  const al2 = new Uint8ClampedArray(W2 * H2);
  for (let i = 0; i < W2 * H2; i++) {
    const solid = i === 0;
    px2[i*4] = solid ? 10 : 250; px2[i*4+1] = solid ? 10 : 250; px2[i*4+2] = solid ? 10 : 250;
    al2[i] = solid ? 255 : 20;
  }
  matting.propagateForegroundColors(px2, al2, W2, H2, { maxDistance: 6 });
  check('非正方形图按真实宽度扩散', px2[(W2-1)*4], 10);

  // No solid pixels: nothing to propagate from, nothing changes.
  const flat = new Uint8ClampedArray(16);
  const flatAlpha = new Uint8ClampedArray(4).fill(10);
  const none = matting.propagateForegroundColors(flat, flatAlpha, 2, 2);
  check('没有实心像素时不做扩散', none.filled, 0);

  // Tightening: 1 is identity, higher pulls the tails to the ends, 0.5 stays 0.5.
  const ramp = new Uint8ClampedArray([0, 64, 128, 192, 255]);
  check('strength 1 是恒等', Array.from(matting.tightenAlpha(ramp, 1)), [0, 64, 128, 192, 255]);
  const tight = Array.from(matting.tightenAlpha(ramp, 2.4));
  check('收紧后两端仍是 0 与 255', [tight[0], tight[4]], [0, 255]);
  // 128/255 is not exactly 0.5, so the midpoint may land one step away.
  check('收紧后中点基本不动', Math.abs(tight[2] - 128) <= 1, true);
  check('收紧后低值被压得更低', tight[1] < 64, true);
  check('收紧后高值被抬得更高', tight[3] > 192, true);
  check('收紧不改变长度', matting.tightenAlpha(ramp, 2.4).length, ramp.length);

  // The default must actually do something (a silent 1 would disable the fix).
  check('默认收紧强度大于 1', ai.DEFAULT_TIGHTEN > 1, true);

  // On the synthetic hard image, tightening plus propagation must reduce the
  // number of "brighter than the backdrop" edge pixels. This ties the two
  // helpers to the defect they exist for.
  const hardW = 40, hardH = 40;
  const hp = new Uint8ClampedArray(hardW * hardH * 4);
  const ha = new Uint8ClampedArray(hardW * hardH);
  for (let y = 0; y < hardH; y++) {
    for (let x = 0; x < hardW; x++) {
      const i = y * hardW + x;
      const inside = (x - 20) ** 2 + (y - 20) ** 2 < 100;
      // A soft ring: partial alpha carrying the light backdrop colour.
      const t = ((x - 20) ** 2 + (y - 20) ** 2) ** 0.5;
      const a = inside ? 255 : t < 12 ? Math.round(255 * (1 - (t - 10) / 2)) : 0;
      hp[i*4] = inside ? 40 : 235; hp[i*4+1] = inside ? 30 : 235; hp[i*4+2] = inside ? 25 : 235;
      ha[i] = Math.max(0, Math.min(255, a));
    }
  }
  const before = Array.from(ha);
  matting.propagateForegroundColors(hp, ha, hardW, hardH, { maxDistance: 6 });
  const tightened = matting.tightenAlpha(ha, 2.4);
  let bandBefore = 0, bandAfter = 0;
  for (let i = 0; i < ha.length; i++) {
    if (before[i] > 8 && before[i] < 247) bandBefore++;
    if (tightened[i] > 8 && tightened[i] < 247) bandAfter++;
  }
  check('收紧确实缩窄了过渡带', bandAfter < bandBefore, true);
  check('扩散把边缘像素染成前景色', hp[(20*hardW + 12)*4] < 100, true);
}


/* ------------------------------------------------------------------ *
 * Automatic head framing
 * ------------------------------------------------------------------ */
{
  const W = 400, H = 600;
  // A bust: head, neck, shoulders — connected, like a real portrait.
  const a = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const head = ((x - 200) / 70) ** 2 + ((y - 170) / 95) ** 2 <= 1;      // 95..265
      const neck = x > 180 && x < 220 && y >= 250 && y < 320;
      const shoulders = ((x - 200) / 190) ** 2 + ((y - 520) / 210) ** 2 <= 1 && y >= 320;
      if (head || neck || shoulders) a[y * W + x] = 255;
    }
  }
  const head = framing.measureHead(a, W, H);
  check('检测到头顶', head && head.crown, 75);
  check('检测到脖子最窄处（在肩线之上）', head.neck > 250 && head.neck < 330, true);
  check('头高落在合理范围', head.headHeight > 120 && head.headHeight < 260, true);
  check('水平中心在人物中线上', Math.abs(head.centreX - 200) < 12, true);
  check('检测到肩线', head.shoulder !== null, true);

  // The frame must put the head at the requested share of its height.
  const frame = framing.computeAutoFraming(head, W, H, 295 / 413, { headFraction: 0.62, topMargin: 0.09 });
  const share = (head.headHeight / frame.height) * 100;
  check('头高占画幅约 62%', Math.abs(share - 62) < 1, true);
  check('顶部留白约 9%', Math.abs(((head.crown - frame.y) / frame.height) * 100 - 9) < 1, true);
  check('画幅宽高比正确', Math.abs(frame.width / frame.height - 295 / 413) < 0.01, true);
  check('画幅不越界（左）', frame.x >= 0, true);
  check('画幅不越界（上）', frame.y >= 0, true);

  // The transform must actually map the crop onto the canvas, not merely be a
  // finite number. Recreate drawCover's arithmetic and check where the crop's
  // corners and centre land.
  const t = framing.framingToTransform(frame, W, H, 295, 413);
  const tw = 295, th = 413;
  const cover = Math.max(tw / W, th / H) * t.zoom;
  const drawW = W * cover;
  const drawH = H * cover;
  const originX = (tw - drawW) / 2 + t.offsetX * tw;
  const originY = (th - drawH) / 2 + t.offsetY * th;
  const project = (ix, iy) => [originX + ix * cover, originY + iy * cover];

  const centre = project(frame.x + frame.width / 2, frame.y + frame.height / 2);
  check('裁切中心落在画布中心（x）', Math.abs(centre[0] - tw / 2) < 0.5, true);
  check('裁切中心落在画布中心（y）', Math.abs(centre[1] - th / 2) < 0.5, true);
  const topLeft = project(frame.x, frame.y);
  check('裁切左上角落在画布左上角（x）', Math.abs(topLeft[0]) < 0.5, true);
  check('裁切左上角落在画布左上角（y）', Math.abs(topLeft[1]) < 0.5, true);
  const bottomRight = project(frame.x + frame.width, frame.y + frame.height);
  check('裁切右下角落在画布右下角', Math.abs(bottomRight[0] - tw) < 0.5 && Math.abs(bottomRight[1] - th) < 0.5, true);

  // The measured head must end up where the frame intended, in canvas pixels.
  const crownOnCanvas = project(head.centreX, head.crown)[1];
  const neckOnCanvas = project(head.centreX, head.crown + head.headHeight)[1];
  check('头顶在画布内的位置符合留白比例', Math.abs(crownOnCanvas - 0.09 * th) < 1.5, true);
  check('头高在画布内符合比例', Math.abs((neckOnCanvas - crownOnCanvas) - 0.62 * th) < 2, true);

  // A portrait that already fills the frame must not be zoomed wildly.
  const full = new Uint8ClampedArray(W * H).fill(255);
  const fullHead = framing.measureHead(full, W, H);
  const fullFrame = framing.computeAutoFraming(fullHead, W, H, 295 / 413);
  const fullT = framing.framingToTransform(fullFrame, W, H, 295, 413);
  check('主体占满画面时缩放仍有限', Number.isFinite(fullT.zoom) && fullT.zoom <= 8, true);

  // Empty mask: no guess, no change.
  check('空掩码不返回测量结果', framing.measureHead(new Uint8ClampedArray(W * H), W, H), null);

  // Degenerate inputs must not throw.
  check('零尺寸返回 null', framing.measureHead(new Uint8ClampedArray(0), 0, 0), null);
  check('非法宽高比回退到源图比例', Math.abs(
    framing.computeAutoFraming(head, W, H, 0).width / framing.computeAutoFraming(head, W, H, 0).height - W / H,
  ) < 0.01, true);
}


/* ------------------------------------------------------------------ *
 * Edge cleanup (trim + specks)
 * ------------------------------------------------------------------ */
{
  const W = 40, H = 40;
  // A filled disc, a thin 1px spike, and an isolated speck.
  const a = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if ((x - 20) ** 2 + (y - 20) ** 2 <= 100) a[y * W + x] = 255;
  }
  a[5 * W + 5] = 255;                 // isolated speck
  a[2 * W + 20] = 255;                // thin spike above the disc

  const count = (arr) => arr.reduce((n, v) => n + (v > 8 ? 1 : 0), 0);
  const before = count(a);

  const trimmed2 = matting.cleanMatteEdges(a, W, H, { trim: 2, minSpeck: 0 });
  check('清理后像素变少', count(trimmed2.alpha) < before, true);
  check('trim 为 0 时保持原样', count(matting.cleanMatteEdges(a, W, H, { trim: 0, minSpeck: 0 }).alpha), before);
  check('trim 报告回传', trimmed2.trimmed, 2);

  const speckless = matting.cleanMatteEdges(a, W, H, { trim: 0, minSpeck: 8 });
  check('孤立浮点被去掉', speckless.alpha[5 * W + 5], 0);
  check('细尖刺也被当作浮点去掉', speckless.alpha[2 * W + 20], 0);
  check('主区域保留', speckless.alpha[20 * W + 20], 255);

  // More trim must never increase the area.
  let previous = before;
  let monotonic = true;
  for (const trim of [1, 2, 3, 4]) {
    const n = count(matting.cleanMatteEdges(a, W, H, { trim, minSpeck: 0 }).alpha);
    if (n > previous) monotonic = false;
    previous = n;
  }
  check('trim 越大面积单调不增', monotonic, true);

  // The default must actually trim: a no-op default would hide the fix.
  check('默认 trim 大于 0', ai.DEFAULT_TRIM > 0, true);
  check('默认浮点阈值合理', ai.DEFAULT_MIN_SPECK > 0 && ai.DEFAULT_MIN_SPECK < 200, true);

  // Partial alpha must survive as partial, not be rounded to binary.
  const soft = new Uint8ClampedArray(W * H).fill(128);
  const softOut = matting.cleanMatteEdges(soft, W, H, { trim: 1, minSpeck: 0 }).alpha;
  check('部分透明的像素保持部分透明', softOut[20 * W + 20] > 0 && softOut[20 * W + 20] < 255, true);

  // Degenerate input must not throw.
  check('零尺寸安全', matting.cleanMatteEdges(new Uint8ClampedArray(0), 0, 0).alpha.length, 0);
}

console.log(
  '\n未在 Node 中验证：画布绘制与 JPEG 编码、指针画笔事件、' +
    '浏览器中的最终成像与打印效果。这些需要真实浏览器。',
);
console.log(
  `\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`,
);
process.exit(failed === 0 ? 0 : 1);
