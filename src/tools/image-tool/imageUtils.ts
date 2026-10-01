/**
 * Image compression and Base64 conversion.
 *
 * All work happens on a canvas in the browser — the file never leaves the page,
 * which matters because images people compress are often screenshots containing
 * private content.
 *
 * Two things are worth being careful about:
 *
 * 1. **Resizing must preserve aspect ratio unless explicitly overridden**, and
 *    the "fit inside a box" behaviour is what people expect from a max-width
 *    setting, not a forced stretch.
 * 2. **JPEG has no alpha channel.** Exporting a transparent PNG as JPEG silently
 *    composites onto black (or white, depending on the encoder), so transparency
 *    is detected and the background is filled deliberately with a chosen colour.
 */

export type OutputFormat = 'image/jpeg' | 'image/png' | 'image/webp';

export interface CompressOptions {
  /** Quality 0–1; ignored for PNG. */
  quality: number;
  /** Longest-edge cap in pixels; null keeps the original size. */
  maxDimension: number | null;
  format: OutputFormat;
  /** Background used when flattening transparency for JPEG. */
  background: string;
}

export const DEFAULT_COMPRESS_OPTIONS: CompressOptions = {
  quality: 0.8,
  maxDimension: 1920,
  format: 'image/jpeg',
  background: '#ffffff',
};

export interface ResizedDimensions {
  width: number;
  height: number;
  scale: number;
}

/**
 * Computes target dimensions for a "fit inside a square of `max`" rule.
 *
 * Aspect ratio is always preserved; images already within the box are returned
 * unchanged (`scale` 1) rather than being upscaled, which would only inflate the
 * file.
 */
export function fitDimensions(
  width: number,
  height: number,
  max: number | null,
): ResizedDimensions {
  if (!max || max <= 0 || (width <= max && height <= max)) {
    return { width, height, scale: 1 };
  }
  const scale = max / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/** Formats a byte count for display. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export interface Savings {
  before: number;
  after: number;
  /** Positive means smaller. */
  savedBytes: number;
  /** Percentage saved, rounded to one decimal. */
  savedPercent: number;
}

export function computeSavings(before: number, after: number): Savings {
  const savedBytes = before - after;
  return {
    before,
    after,
    savedBytes,
    savedPercent: before === 0 ? 0 : Math.round((savedBytes / before) * 1000) / 10,
  };
}

export interface DataUrlInfo {
  mime: string;
  /** Base64 payload length in characters. */
  base64Length: number;
  /** Decoded byte length. */
  bytes: number;
}

/** Parses a data URL, reporting null for anything that is not one. */
export function parseDataUrl(url: string): DataUrlInfo | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url.trim());
  if (!match) return null;

  const mime = match[1] || 'text/plain';
  const isBase64 = Boolean(match[2]);
  const payload = match[3];

  if (!isBase64) {
    return { mime, base64Length: 0, bytes: decodeURIComponent(payload).length };
  }

  // Padding characters are not part of the decoded data.
  const padding = (payload.match(/=+$/) ?? [''])[0].length;
  return {
    mime,
    base64Length: payload.length,
    bytes: Math.floor((payload.length * 3) / 4) - padding,
  };
}

/** Renders bytes as a human-readable size ratio, e.g. "2.4×". */
export function ratioLabel(before: number, after: number): string {
  if (after === 0) return '—';
  const ratio = before / after;
  if (ratio >= 1) return `${ratio.toFixed(2)}× 更小`;
  return `${(1 / ratio).toFixed(2)}× 更大`;
}

/** Estimated Base64 size for a byte count (4 chars per 3 bytes, plus padding). */
export function base64Size(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

/** True when the file type is one the browser can decode and draw. */
export function isSupportedImage(type: string): boolean {
  return /^image\/(jpeg|png|webp|gif|bmp|avif)$/.test(type);
}

export interface LoadedImage {
  element: HTMLImageElement;
  width: number;
  height: number;
  /** Browser-reported size of the original file. */
  bytes: number;
  type: string;
  name: string;
}

/** Decodes a file into an image element. */
export async function loadImage(file: File): Promise<LoadedImage> {
  const url = URL.createObjectURL(file);
  try {
    const element = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('无法解码该图片（格式可能不受浏览器支持）'));
      image.src = url;
    });
    return {
      element,
      // `naturalWidth` is the real pixel size; `width` would reflect CSS.
      width: element.naturalWidth,
      height: element.naturalHeight,
      bytes: file.size,
      type: file.type,
      name: file.name,
    };
  } finally {
    // The image is decoded by now, so the object URL can be released.
    URL.revokeObjectURL(url);
  }
}

export interface CompressResult {
  blob: Blob;
  width: number;
  height: number;
  /** Data URL, for embedding. */
  dataUrl: string;
}

/**
 * Draws the image at the target size and re-encodes it.
 *
 * Note on transparency: JPEG cannot store an alpha channel, so transparent
 * pixels would come out black on most encoders. The canvas is therefore filled
 * with the chosen background first whenever the output format has no alpha.
 */
export async function compressImage(
  image: LoadedImage,
  options: CompressOptions,
): Promise<CompressResult> {
  const { width, height } = fitDimensions(
    image.width,
    image.height,
    options.maxDimension,
  );

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建 2D 画布上下文');

  const opaque = options.format === 'image/jpeg';
  if (opaque) {
    context.fillStyle = options.background;
    context.fillRect(0, 0, width, height);
  }

  // Better downscaling quality than the default nearest-ish behaviour.
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image.element, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, options.format, options.quality);
  });
  if (!blob) throw new Error('导出失败（可能是画布尺寸过大或格式不支持）');

  return {
    blob,
    width,
    height,
    dataUrl: canvas.toDataURL(options.format, options.quality),
  };
}

/** Converts a blob to a data URL without re-encoding. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取失败'));
    reader.readAsDataURL(blob);
  });
}

/** Suggested file name for the compressed output. */
export function outputFileName(name: string, format: OutputFormat): string {
  const extension =
    format === 'image/jpeg' ? 'jpg' : format === 'image/png' ? 'png' : 'webp';
  const base = name.replace(/\.[^.]+$/, '') || 'image';
  return `${base}-compressed.${extension}`;
}

/** CSS snippets for embedding the result, offered for convenience. */
export function embedSnippets(dataUrl: string, width: number, height: number): Array<{ label: string; code: string }> {
  // Long data URLs make the snippets unreadable; elide the middle for display
  // while keeping the copyable value complete.
  const brief =
    dataUrl.length > 120
      ? `${dataUrl.slice(0, 60)}…（共 ${dataUrl.length} 字符）…${dataUrl.slice(-20)}`
      : dataUrl;

  return [
    { label: 'HTML <img>', code: `<img src="${brief}" width="${width}" height="${height}" alt="" />` },
    { label: 'CSS background', code: `background-image: url("${brief}");` },
    { label: 'Markdown', code: `![图片](${brief})` },
  ];
}

/** Quality presets that map to real-world use. */
export const QUALITY_PRESETS = [
  { label: '高清（0.9）', value: 0.9, note: '几乎看不出损失，体积较大' },
  { label: '推荐（0.8）', value: 0.8, note: '常规网页图片的平衡点' },
  { label: '较小（0.6）', value: 0.6, note: '明显减小，细看有损失' },
  { label: '很小（0.4）', value: 0.4, note: '仅适合缩略图' },
];

export const DIMENSION_PRESETS = [
  { label: '不缩放', value: null },
  { label: '3840（4K）', value: 3840 },
  { label: '1920（1080p）', value: 1920 },
  { label: '1280', value: 1280 },
  { label: '800', value: 800 },
  { label: '512', value: 512 },
];
