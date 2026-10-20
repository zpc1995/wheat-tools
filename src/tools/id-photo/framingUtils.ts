/**
 * Automatic head placement.
 *
 * An ID photo has a conventional composition: the head occupies roughly 60-70%
 * of the frame height, sits centred horizontally, and leaves a small margin
 * above the crown. A portrait shot at talking distance leaves the head at 35-45%
 * instead, which wastes most of the output pixels on shoulders — a one-inch
 * print is only 295 px wide, so a head at 40% has about a third of the detail it
 * could have. That is what reads as "not sharp", not the matting.
 *
 * Detecting the head without a face detector is done from the alpha mask's width
 * profile: the row width grows through the head, dips at the neck, then jumps at
 * the shoulders. The crown and the neck dip bracket the head.
 *
 * Everything here is pure and operates on the alpha mask, so it can be checked
 * against synthetic silhouettes of known geometry.
 */

export interface AutoFramingOptions {
  /** Head height as a share of the frame height. */
  headFraction?: number;
  /** Empty space above the crown, as a share of the frame height. */
  topMargin?: number;
  /** Subject alpha above which a pixel counts as subject. */
  threshold?: number;
}

export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HeadMeasurement {
  /** Row of the topmost subject pixel. */
  crown: number;
  /** Row of the narrowest point between the head and the shoulders. */
  neck: number;
  /** Estimated head height in source pixels. */
  headHeight: number;
  /** Horizontal centre of the head. */
  centreX: number;
  /** Row where the shoulders start widening, or null when not found. */
  shoulder: number | null;
}

const DEFAULT_HEAD_FRACTION = 0.62;
const DEFAULT_TOP_MARGIN = 0.09;

/**
 * Locates the head from the alpha mask.
 *
 * Returns null when the mask has no usable subject, so callers can leave the
 * user's own framing alone rather than inventing one.
 */
export function measureHead(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 128,
): HeadMeasurement | null {
  if (width <= 0 || height <= 0) return null;
  const total = Math.min(alpha.length, width * height);

  const rowWidth = new Int32Array(height);
  const rowMinX = new Int32Array(height).fill(Number.MAX_SAFE_INTEGER);
  const rowMaxX = new Int32Array(height).fill(-1);
  for (let y = 0; y < height; y += 1) {
    let count = 0;
    let minX = Number.MAX_SAFE_INTEGER;
    let maxX = -1;
    const base = y * width;
    for (let x = 0; x < width; x += 1) {
      const index = base + x;
      if (index >= total) break;
      if (alpha[index] < threshold) continue;
      count += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    rowWidth[y] = count;
    if (count > 0) {
      rowMinX[y] = minX;
      rowMaxX[y] = maxX;
    }
  }

  let crown = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    if (rowWidth[y] > 0) {
      if (crown < 0) crown = y;
      bottom = y;
    }
  }
  if (crown < 0 || bottom <= crown) return null;

  const subjectHeight = bottom - crown + 1;
  const headBand = crown + Math.max(1, Math.floor(subjectHeight * 0.35));

  // Typical head width: median of the occupied rows in the top third.
  const widths: number[] = [];
  for (let y = crown; y <= Math.min(headBand, bottom); y += 1) {
    if (rowWidth[y] > 0) widths.push(rowWidth[y]);
  }
  if (widths.length === 0) return null;
  widths.sort((a, b) => a - b);
  const medianWidth = widths[Math.floor(widths.length / 2)];

  // Widest row of the head, then the first row below it that clearly exceeds the
  // head width — that is where the shoulders begin.
  let peak = crown;
  for (let y = crown; y <= Math.min(crown + Math.floor(subjectHeight * 0.4), bottom); y += 1) {
    if (rowWidth[y] > rowWidth[peak]) peak = y;
  }
  const shoulderLimit = medianWidth * 1.45;
  let shoulder: number | null = null;
  for (let y = peak; y <= bottom; y += 1) {
    if (rowWidth[y] > shoulderLimit) {
      shoulder = y;
      break;
    }
  }

  // The neck is the narrowest row between the widest part of the head and the
  // shoulders. Without a shoulder row there is nothing to bracket it, so fall
  // back to a conventional proportion of the subject height.
  let neck = -1;
  if (shoulder !== null && shoulder > peak) {
    let narrowest = rowWidth[peak];
    neck = peak;
    for (let y = peak; y <= shoulder; y += 1) {
      if (rowWidth[y] > 0 && rowWidth[y] < narrowest) {
        narrowest = rowWidth[y];
        neck = y;
      }
    }
  }
  const headHeight =
    neck > crown ? neck - crown : Math.round(subjectHeight * 0.45);

  // Horizontal centre taken from the head rows, not the shoulders, which are
  // often wider on one side.
  let sumMin = 0;
  let sumMax = 0;
  let rows = 0;
  const centreEnd = Math.min(crown + Math.floor(subjectHeight * 0.45), bottom);
  for (let y = crown; y <= centreEnd; y += 1) {
    if (rowMaxX[y] < 0) continue;
    sumMin += rowMinX[y];
    sumMax += rowMaxX[y];
    rows += 1;
  }
  const centreX = rows > 0 ? (sumMin + sumMax) / 2 / rows : width / 2;

  return { crown, neck, headHeight, centreX, shoulder };
}

/**
 * Turns a head measurement into the crop rectangle for a frame of the given
 * aspect ratio.
 *
 * `headFraction` is the share of the frame height the head should occupy.
 */
export function computeAutoFraming(
  measurement: HeadMeasurement,
  sourceWidth: number,
  sourceHeight: number,
  aspect: number,
  options: AutoFramingOptions = {},
): FrameRect {
  const headFraction = clamp01(options.headFraction ?? DEFAULT_HEAD_FRACTION, 0.3, 0.9);
  const topMargin = clamp01(options.topMargin ?? DEFAULT_TOP_MARGIN, 0, 0.4);
  const ratio = aspect > 0 ? aspect : sourceWidth / sourceHeight;

  const frameHeight = Math.max(1, measurement.headHeight / headFraction);
  const frameWidth = frameHeight * ratio;

  let y = measurement.crown - topMargin * frameHeight;
  let x = measurement.centreX - frameWidth / 2;

  // Keep the frame inside the image where the photo allows it, but never at the
  // cost of shifting the head out of its intended position: if the source is
  // smaller than the frame, the frame simply extends past the edge and the
  // caller fills the remainder with the background.
  y = Math.min(y, sourceHeight - frameHeight);
  x = Math.min(x, sourceWidth - frameWidth);
  y = Math.max(y, 0);
  x = Math.max(x, 0);

  return { x, y, width: frameWidth, height: frameHeight };
}

/**
 * Converts a crop rectangle into the zoom / offset the canvas transform uses.
 *
 * `drawCover` scales the cutout to cover the target and then applies a zoom
 * multiplier and offsets expressed as fractions of the target size. Deriving
 * those from the desired crop keeps one code path for manual and automatic
 * framing.
 */
export function framingToTransform(
  frame: FrameRect,
  imageWidth: number,
  imageHeight: number,
  targetWidth: number,
  targetHeight: number,
): { zoom: number; offsetX: number; offsetY: number } {
  const safeFrameWidth = Math.max(1, frame.width);
  const cover =
    Math.max(targetWidth / imageWidth, targetHeight / imageHeight) || 1;
  const scale = targetWidth / safeFrameWidth;
  const zoom = scale / cover;

  const centreX = frame.x + frame.width / 2;
  const centreY = frame.y + frame.height / 2;
  const drawnWidth = imageWidth * scale;
  const drawnHeight = imageHeight * scale;

  // drawCover places the image at (targetW - drawnWidth) / 2 + offsetX*targetW
  // and the crop centre has to land on the canvas centre, so
  //   (targetW - drawnWidth)/2 + offsetX*targetW + centreX*scale = targetW/2
  // which reduces to the expression below. Subtracting an extra targetW/2 here
  // shifts the whole frame by half a canvas — that mistake cropped the export
  // down to a shoulder.
  const offsetX = (drawnWidth / 2 - centreX * scale) / targetWidth;
  const offsetY = (drawnHeight / 2 - centreY * scale) / targetHeight;
  return { zoom, offsetX, offsetY };
}

function clamp01(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
