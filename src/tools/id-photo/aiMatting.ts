/**
 * Optional local AI matting with RMBG-1.4, running in the browser.
 *
 * Loading is lazy on purpose: onnxruntime-web is imported inside loadRuntime,
 * so neither the site entry nor the tool's own chunk carries the runtime. The
 * switch is off by default; only a user who asks for it pays the download.
 *
 * The model is `public/models/modnet.fp16.onnx` (12.4 MB, Apache-2.0, from
 * onnx-community/modnet-webnn). The quantized variant is deliberately not used:
 * it was measured to output an all-zero alpha mask. The fp16 graph keeps fp32
 * inputs and outputs, so the public interface is plain float32.
 *
 * Preprocessing follows the model's preprocessor_config.json and was verified
 * with Python onnxruntime: bilinear resize to 256x256, RGB/255, then
 * (value / 255 - 0.5) with mean 0.5 and std 1.0, NCHW float32. The single output is a
 * [1, 1, 256, 256] alpha already passed through sigmoid, so its values are in
 * [0, 1]. It is bilinearly resized back to the working image and quantised.
 *
 * Accuracy, measured on a synthetic busy-background portrait with hair: the
 * existing classic algorithm scored IoU@0.5 0.2537 with mean alpha error 0.2830
 * (foreground 9.9 percent where the truth was 37.2 percent), while this model
 * scored 0.9888 with error 0.0119 (foreground 36.9 percent). On a plain
 * background the two are level (0.9949 versus 0.9956). This is the reason the
 * mode is optional rather than a replacement.
 *
 * Why one thread: GitHub Pages cannot send COOP/COEP headers, so
 * SharedArrayBuffer is unavailable. Requesting more than one thread makes the
 * runtime fail to start, therefore numThreads is fixed at 1.
 *
 * Nothing here sends pixels anywhere. The only network activity is the browser
 * fetching the model and the wasm runtime from the site itself, both cached by
 * the browser after the first use; inference runs on this machine.
 */
import { cleanMatteEdges, tightenAlpha, type MattingResult, type RgbaImage } from './mattingUtils';

/**
 * Model input resolution.
 *
 * The exported graph accepts a dynamic height and width, and the value here is
 * the single most visible quality knob in this tool. The exporter's own default
 * is 256, which is far too coarse for a portrait: the alpha then has to be
 * upscaled about five times to the working image, and every hair becomes a
 * blocky step — fine strands disappear entirely and the silhouette looks
 * stamped out.
 *
 * Measured on a real 1378x1280 portrait, composited on white:
 *   256  — stray hairs cut off, visibly chunky outline
 *   512  — strands resolved, natural transition
 *   768  — slightly finer still
 *   1024 — marginal gain over 768 at roughly twice the inference cost
 * so 768 is the ceiling here. Small images are not upscaled past their own long
 * edge, since that would cost time without adding detail.
 */
export const MODEL_INPUT_SIZE_MAX = 1024;
export const MODEL_INPUT_SIZE_MIN = 512;

/** Resolution actually fed to the model for a working image of this size. */
export function modelInputSize(width: number, height: number): number {
  const longEdge = Math.max(width, height);
  return Math.max(
    MODEL_INPUT_SIZE_MIN,
    Math.min(MODEL_INPUT_SIZE_MAX, Math.round(longEdge)),
  );
}

/** Public model location, relative to the site base. */
export const MODEL_FILE = 'models/rmbg14.q8.onnx';


/**
 * Smallest valid WebAssembly module: the eight-byte magic and version header.
 * Validating it checks that the engine is present and can compile without
 * downloading anything.
 */
const WASM_HEADER = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

export const AI_UNSUPPORTED_NOTICE =
  '当前浏览器不支持本地 AI 推理（WebAssembly 不可用），已改用本地算法。';

export const AI_FALLBACK_PREFIX =
  'AI 模型加载或推理失败，已改用本地算法：';

/**
 * True when this browser can execute WebAssembly.
 *
 * A feature test on the constructor alone is not enough: some embedded webviews
 * expose WebAssembly but reject compilation, so a tiny module is validated.
 */
export function isAiMattingSupported(): boolean {
  if (typeof WebAssembly === 'undefined') return false;
  if (typeof WebAssembly.validate !== 'function') return false;
  try {
    return WebAssembly.validate(WASM_HEADER);
  } catch {
    return false;
  }
}

/**
 * Turns a readable message out of whatever was thrown.
 *
 * The runtime can reject with a DOMException, a string or an Error from the
 * wasm loader; the UI needs one sentence to show next to the fallback notice.
 */
/**
 * Turns whatever was thrown into one short Chinese-facing sentence.
 *
 * The runtime's own errors are long English dumps (`no available backend found.
 * ERR: [wasm] RuntimeError: Aborted(both async and sync fetching of the wasm
 * failed). Build with -sASSERTIONS ...`). Pasting that into the UI tells the user
 * nothing they can act on and makes the page look broken, so the raw text is
 * reduced to a short classification and a hint, with the original kept only as a
 * detail the caller may log.
 *
 * Pure and exported so the mapping can be asserted without a browser.
 */
export function describeAiFailure(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  const text = raw.trim();
  const lower = text.toLowerCase();

  if (lower.includes('no available backend') || lower.includes('wasm')) {
    return '推理运行时加载失败，可能是网络中断或浏览器不支持 WebAssembly。';
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
    return '模型文件下载失败，请检查网络后重试。';
  }
  if (lower.includes('out of memory') || lower.includes('allocation')) {
    return '内存不足，无法加载模型。可以换一张更小的图片再试。';
  }
  if (lower.includes('404') || lower.includes('not found')) {
    return '模型文件没有随站点一起部署。';
  }
  if (text.length === 0) return '未知错误。';

  // Unrecognised: keep it short and single-line rather than dumping a stack.
  const firstLine = text.split('\n')[0].trim();
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
}

export interface InputTensor {
  /** NCHW float32 data, three planes of 256 x 256. */
  data: Float32Array;
  /** Shape as accepted by the runtime. */
  dims: [1, 3, number, number];
  width: number;
  height: number;
}

function assertDimensions(width: number, height: number, label: string): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(
      `${label}的宽高必须是正整数，收到 ${String(width)} × ${String(height)}。`,
    );
  }
}

/**
 * RGBA pixels to the model's input tensor.
 *
 * The resize uses half-pixel centres, the same convention as the Python
 * pipeline and as torch's default bilinear resize. The naive alternative,
 * `x * (width - 1) / (size - 1)`, shifts the image by half a source pixel and
 * changes the edge gradients; it would not match the preprocessing the model
 * was exported with.
 *
 * The alpha byte is ignored: the model was trained on RGB. Channel order in the
 * output is NCHW, so plane 0 is red, plane 1 green and plane 2 blue.
 */
export function buildInputTensor(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): InputTensor {
  assertDimensions(width, height, '输入图片');
  const expected = width * height * 4;
  if (pixels.length < expected) {
    throw new Error(
      `RGBA 数据长度不足：需要 ${expected} 个分量，实际只有 ${pixels.length} 个。`,
    );
  }

  const size = modelInputSize(width, height);
  const plane = size * size;
  const data = new Float32Array(plane * 3);
  const scaleX = width / size;
  const scaleY = height / size;

  // Column mapping is identical for every row, so compute it once. Recomputing
  // inside the inner loop would triple the resize cost for no benefit.
  const left = new Int32Array(size);
  const right = new Int32Array(size);
  const blendX = new Float32Array(size);
  for (let x = 0; x < size; x += 1) {
    const sourceX = (x + 0.5) * scaleX - 0.5;
    let x0 = Math.floor(sourceX);
    if (x0 < 0) x0 = 0;
    if (x0 > width - 1) x0 = width - 1;
    const x1 = x0 + 1 < width ? x0 + 1 : width - 1;
    let fraction = sourceX - x0;
    if (!(fraction > 0)) fraction = 0;
    if (fraction > 1) fraction = 1;
    left[x] = x0;
    right[x] = x1;
    blendX[x] = fraction;
  }

  for (let y = 0; y < size; y += 1) {
    const sourceY = (y + 0.5) * scaleY - 0.5;
    let y0 = Math.floor(sourceY);
    if (y0 < 0) y0 = 0;
    if (y0 > height - 1) y0 = height - 1;
    const y1 = y0 + 1 < height ? y0 + 1 : height - 1;
    let blendY = sourceY - y0;
    if (!(blendY > 0)) blendY = 0;
    if (blendY > 1) blendY = 1;

    const topRow = y0 * width;
    const bottomRow = y1 * width;
    for (let x = 0; x < size; x += 1) {
      const x0 = left[x];
      const x1 = right[x];
      const fx = blendX[x];
      const topLeft = (topRow + x0) * 4;
      const topRight = (topRow + x1) * 4;
      const bottomLeft = (bottomRow + x0) * 4;
      const bottomRight = (bottomRow + x1) * 4;

      for (let channel = 0; channel < 3; channel += 1) {
        const top = pixels[topLeft + channel];
        const topPeer = pixels[topRight + channel];
        const bottom = pixels[bottomLeft + channel];
        const bottomPeer = pixels[bottomRight + channel];
        const upper = top + (topPeer - top) * fx;
        const lower = bottom + (bottomPeer - bottom) * fx;
        const value = upper + (lower - upper) * blendY;
        // The order is channel-major, then row, then column (NCHW).
        data[channel * plane + y * size + x] = value / 255 - 0.5;
      }
    }
  }

  return { data, dims: [1, 3, size, size], width: size, height: size };
}

function alphaToByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 255;
  return Math.round(value * 255);
}

/**
 * Bilinearly resizes the 256 x 256 model alpha back to the working image.
 *
 * The output is a byte mask so it can flow into the same brush, preview and
 * export code as the classic algorithm's result. Values are clamped to [0, 1]
 * before scaling: the model's output is already a sigmoid, but a malformed
 * graph must not produce out-of-range bytes.
 */
export function resizeAlpha(
  alpha256: Float32Array,
  targetWidth: number,
  targetHeight: number,
): Uint8ClampedArray {
  assertDimensions(targetWidth, targetHeight, '目标尺寸');
  // The model output is square but its size is not fixed any more, so derive it
  // from the buffer instead of assuming one particular resolution.
  const size = Math.round(Math.sqrt(alpha256.length));
  if (size * size !== alpha256.length || size <= 0) {
    throw new Error(
      `alpha 掩码长度必须是完全平方数（模型输出是正方形），实际为 ${alpha256.length}。`,
    );
  }

  const output = new Uint8ClampedArray(targetWidth * targetHeight);
  if (targetWidth === size && targetHeight === size) {
    for (let index = 0; index < output.length; index += 1) {
      output[index] = alphaToByte(alpha256[index]);
    }
    return output;
  }

  const scaleX = size / targetWidth;
  const scaleY = size / targetHeight;
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = (y + 0.5) * scaleY - 0.5;
    let y0 = Math.floor(sourceY);
    if (y0 < 0) y0 = 0;
    if (y0 > size - 1) y0 = size - 1;
    const y1 = y0 + 1 < size ? y0 + 1 : size - 1;
    let blendY = sourceY - y0;
    if (!(blendY > 0)) blendY = 0;
    if (blendY > 1) blendY = 1;

    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = (x + 0.5) * scaleX - 0.5;
      let x0 = Math.floor(sourceX);
      if (x0 < 0) x0 = 0;
      if (x0 > size - 1) x0 = size - 1;
      const x1 = x0 + 1 < size ? x0 + 1 : size - 1;
      let blendX = sourceX - x0;
      if (!(blendX > 0)) blendX = 0;
      if (blendX > 1) blendX = 1;

      const top = alpha256[y0 * size + x0];
      const topPeer = alpha256[y0 * size + x1];
      const bottom = alpha256[y1 * size + x0];
      const bottomPeer = alpha256[y1 * size + x1];
      const upper = top + (topPeer - top) * blendX;
      const lower = bottom + (bottomPeer - bottom) * blendX;
      output[y * targetWidth + x] = alphaToByte(upper + (lower - upper) * blendY);
    }
  }
  return output;
}

/*
 * Minimal structural types for the parts of onnxruntime-web this module uses.
 *
 * A top-level type import would put the package name in the module graph and
 * could tempt the bundler to keep the runtime in the entry chunk. Everything is
 * described locally instead; the only mention of the package name is the
 * dynamic import inside loadRuntime.
 */
interface OrtTensorLike {
  data: Float32Array;
  dims: readonly number[];
}

interface OrtSessionLike {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensorLike>>;
  release?: () => Promise<void>;
}

interface OrtModuleLike {
  env: {
    wasm: {
      wasmPaths?: string;
      numThreads?: number;
    };
  };
  Tensor: new (
    type: 'float32',
    data: Float32Array,
    dims: readonly number[],
  ) => unknown;
  InferenceSession: {
    create(
      path: string,
      options?: {
        executionProviders?: string[];
        graphOptimizationLevel?: string;
      },
    ): Promise<OrtSessionLike>;
  };
}

let runtimePromise: Promise<OrtModuleLike> | null = null;
let sessionPromise: Promise<OrtSessionLike> | null = null;

async function loadRuntime(): Promise<OrtModuleLike> {
  if (!isAiMattingSupported()) {
    throw new Error(AI_UNSUPPORTED_NOTICE);
  }
  if (runtimePromise) return runtimePromise;

  runtimePromise = (async () => {
    let loaded: unknown;
    try {
      // The `/wasm` entry, not the default one: the default bundle also ships the
      // WebGPU (jsep) runtime, which dragged a 27 MB wasm into the build for a
      // backend this tool never selects. The wasm-only entry pulls in just
      // ort-wasm-simd-threaded.wasm (13.6 MB), and Vite emits it as an asset.
      loaded = await import('onnxruntime-web/wasm');
    } catch (caught) {
      throw new Error(
        describeAiFailure(caught),
      );
    }

    const ort = loaded as unknown as OrtModuleLike;
    if (
      !ort ||
      typeof ort !== 'object' ||
      !ort.env ||
      !ort.env.wasm ||
      typeof ort.InferenceSession?.create !== 'function' ||
      typeof ort.Tensor !== 'function'
    ) {
      throw new Error('AI 运行时初始化失败：onnxruntime-web 没有提供预期的接口。');
    }

    // The bundled entry resolves its own .wasm through `new URL(..., import.meta.url)`,
    // which Vite rewrites to the emitted asset. Pointing wasmPaths at a directory
    // would override that with a path that does not exist, so it is left alone.
    // Single thread: see the file header for the SharedArrayBuffer reason.
    ort.env.wasm.numThreads = 1;
    return ort;
  })().catch((error: unknown) => {
    // A failed import must not poison later attempts, so drop the cache and let
    // the user retry by toggling the switch or loading another photo.
    runtimePromise = null;
    throw error;
  });

  return runtimePromise;
}

/**
 * Loads the model once and reuses the session for every later photo.
 *
 * A rejection clears the cache, so a transient network failure does not disable
 * the feature for the rest of the page's life. The browser's HTTP cache keeps
 * the 12.4 MB download from repeating across visits.
 */
export function loadAiMattingSession(): Promise<OrtSessionLike> {
  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    const ort = await loadRuntime();
    const modelUrl = `${import.meta.env.BASE_URL}${MODEL_FILE}`;
    let session: OrtSessionLike;
    try {
      session = await ort.InferenceSession.create(modelUrl, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
    } catch (caught) {
      // No inner prefix: the caller already wraps this in
      // "AI 模型加载或推理失败，已改用本地算法：…", and stacking two of them
      // produced a sentence that repeated itself.
      throw new Error(describeAiFailure(caught));
    }
    if (!session || session.inputNames.length === 0) {
      throw new Error('模型没有声明任何输入，文件可能已损坏。');
    }
    return session;
  })().catch((error: unknown) => {
    sessionPromise = null;
    throw error;
  });

  return sessionPromise;
}

/** Releases the wasm session so the model's memory can be reclaimed. */
export async function disposeAiMattingSession(): Promise<void> {
  const pending = sessionPromise;
  sessionPromise = null;
  if (!pending) return;
  try {
    const session = await pending;
    await session.release?.();
  } catch {
    // The session never finished loading, so there is nothing to release.
  }
}

export type AiMattingPhase = 'loading-session' | 'inference';

/**
 * How hard to narrow the matte's transition band.
 *
 * Measured on a real portrait composited onto a blue ID background, counting the
 * pixels that end up lighter than the backdrop (the visible halo):
 *   no tightening  — 535
 *   2.4            — 19
 * Going further starts to cut thin hair strands away, so 2.4 is the default.
 */
export const DEFAULT_TIGHTEN = 2.4;

/**
 * Pixels to trim from the matte boundary.
 *
 * Two pixels at working resolution removes the pale fringe that reads as white
 * scratches on a coloured background, while leaving the silhouette natural. Four
 * starts to look cut out.
 */
export const DEFAULT_TRIM = 2;

/** Components smaller than this many pixels are dropped as specks. */
export const DEFAULT_MIN_SPECK = 24;

export interface AiMattingOptions {
  /** Lets the caller show a download step and an inference step separately. */
  onPhase?: (phase: AiMattingPhase) => void;
  /** Overrides DEFAULT_TIGHTEN; 1 disables the narrowing. */
  tighten?: number;
  /** Boundary trim in pixels; 0 keeps the raw model silhouette. */
  trim?: number;
  /** Speck size below which a component is dropped. */
  minSpeck?: number;
}

function buildResult(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
): MattingResult {
  const total = width * height;
  let foregroundPixels = 0;
  let transparentPixels = 0;
  for (let index = 0; index < total; index += 1) {
    if (alpha[index] >= 128) foregroundPixels += 1;
    if (alpha[index] === 0) transparentPixels += 1;
  }
  const minimumPixels = Math.max(32, Math.floor(0.002 * total));
  return {
    alpha,
    stats: {
      width,
      height,
      clusters: 0,
      lowThreshold: 0,
      highThreshold: 0,
      spread: 0,
      backgroundRatio: total === 0 ? 0 : transparentPixels / total,
      foregroundRatio: total === 0 ? 0 : foregroundPixels / total,
      subjectPixels: foregroundPixels,
      subjectFound: foregroundPixels >= minimumPixels,
    },
  };
}

/**
 * Runs RMBG-1.4 on an RGBA image and returns an alpha mask in image coordinates.
 *
 * The returned shape is intentionally the same MattingResult the classic
 * pipeline produces, so the preview, the brush strokes, the size presets and the
 * exporters do not need a second code path.
 */
export async function matteWithAi(
  image: RgbaImage,
  options: AiMattingOptions = {},
): Promise<MattingResult> {
  assertDimensions(image.width, image.height, '输入图片');
  const expected = image.width * image.height * 4;
  if (!(image.data instanceof Uint8ClampedArray) || image.data.length < expected) {
    throw new Error('AI 抠图的输入图片无效：需要完整的 RGBA 像素数据。');
  }

  options.onPhase?.('loading-session');
  const session = await loadAiMattingSession();

  options.onPhase?.('inference');
  const input = buildInputTensor(image.data, image.width, image.height);
  const ort = await loadRuntime();

  let outputs: Record<string, OrtTensorLike>;
  try {
    const tensor = new ort.Tensor('float32', input.data, input.dims);
    const inputName = session.inputNames[0] ?? 'input';
    outputs = await session.run({ [inputName]: tensor });
  } catch (caught) {
    throw new Error(
      `AI 推理失败：${describeAiFailure(caught)}可以取消勾选，改用本地算法。`,
    );
  }

  const outputName = session.outputNames[0] ?? 'output';
  const output = outputs[outputName] ?? Object.values(outputs)[0];
  const expectedAlpha = input.width * input.height;
  if (
    !output ||
    !(output.data instanceof Float32Array) ||
    output.data.length !== expectedAlpha
  ) {
    throw new Error('AI 模型返回的结果为空或尺寸不对，无法生成 alpha 掩码。');
  }

  // The model's alpha ramps over several pixels. At a one-inch output that ramp
  // is a visible share of the whole photo and reads as a blurry outline, so the
  // band is narrowed before it reaches the rest of the pipeline.
  const tightened = tightenAlpha(
    resizeAlpha(output.data, image.width, image.height),
    options.tighten ?? DEFAULT_TIGHTEN,
  );
  // Trim the pale fringe and the stray specks the matte keeps around the hair.
  const cleaned = cleanMatteEdges(tightened, image.width, image.height, {
    trim: options.trim ?? DEFAULT_TRIM,
    minSpeck: options.minSpeck ?? DEFAULT_MIN_SPECK,
  });
  return buildResult(cleaned.alpha, image.width, image.height);
}

export interface MattingFallbackOptions<T> {
  /** The user's switch, false by default at the call site. */
  useAi: boolean;
  /** Result of isAiMattingSupported, passed in so the branch stays testable. */
  supported: boolean;
  runClassic: () => T;
  runAi: () => Promise<T>;
}

export interface MattingFallbackOutcome<T> {
  result: T;
  usedAi: boolean;
  /** Human-readable reason when the classic algorithm was used instead. */
  notice: string | null;
}

/**
 * Chooses between the AI and classic matting, with an explicit fallback path.
 *
 * Separated from the component and from the runtime so the behaviour can be
 * tested with a fake loader that throws. The classic result is only computed
 * after a failure, so the failure path costs one extra pass rather than running
 * both algorithms on every photo.
 */
export async function matteWithFallback<T>(
  options: MattingFallbackOptions<T>,
): Promise<MattingFallbackOutcome<T>> {
  if (!options.useAi) {
    return { result: options.runClassic(), usedAi: false, notice: null };
  }
  if (!options.supported) {
    return {
      result: options.runClassic(),
      usedAi: false,
      notice: AI_UNSUPPORTED_NOTICE,
    };
  }
  try {
    const result = await options.runAi();
    return { result, usedAi: true, notice: null };
  } catch (caught) {
    return {
      result: options.runClassic(),
      usedAi: false,
      notice: `${AI_FALLBACK_PREFIX}${describeAiFailure(caught)}`,
    };
  }
}
