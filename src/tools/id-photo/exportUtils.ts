/**
 * Size-limited encoding helpers.
 *
 * A JPEG encoder needs a canvas, but *choosing* the JPEG quality does not: the
 * search below takes a render function and a way to measure its payload, so it
 * runs and is tested in Node with a fake renderer.
 *
 * The search only ever returns a payload that was actually measured at or below
 * the target, so the usual monotonicity assumption (higher quality means more
 * bytes) can make the result suboptimal but cannot make it exceed the target.
 * When the target is impossibly small, the smallest attempt is returned with
 * `achieved: false` rather than silently producing a file over the limit.
 */

export const DEFAULT_QUALITY_FLOOR = 0.4;
export const DEFAULT_QUALITY_CEILING = 0.95;
export const DEFAULT_SCALE_STEPS: readonly number[] = [1, 0.85, 0.7, 0.55];
export const DEFAULT_QUALITY_ITERATIONS = 8;

export interface SizeTargetOptions {
  /** Hard upper bound in bytes. Values below 1 are treated as impossible. */
  targetBytes: number;
  /** Lowest quality the search will try. */
  minQuality?: number;
  /** Highest quality the search will try. */
  maxQuality?: number;
  /** Rendered sizes to try, largest first. Each is a scale of the full size. */
  scaleSteps?: readonly number[];
  /** Number of bisection steps per scale. */
  qualityIterations?: number;
}

export interface EncodingAttempt {
  quality: number;
  scale: number;
  bytes: number;
}

export interface TargetSizeResult<T> {
  /** The smallest fitting payload, or the smallest attempt when none fits. */
  payload: T;
  quality: number;
  scale: number;
  bytes: number;
  /** True when the payload is at or below the requested target. */
  achieved: boolean;
  /** Every render performed, for display and for tests. */
  attempts: EncodingAttempt[];
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Drops invalid entries, sorts largest first and always returns something. */
export function normalizeScaleSteps(steps: readonly number[] | undefined): number[] {
  const cleaned = (steps ?? DEFAULT_SCALE_STEPS)
    .filter((step) => Number.isFinite(step) && step > 0 && step <= 1)
    .sort((left, right) => right - left);
  if (cleaned.length === 0) return [1];
  // Exact duplicates would double the work for no benefit.
  return cleaned.filter(
    (step, index) => index === 0 || Math.abs(step - cleaned[index - 1]) > 1e-6,
  );
}

/**
 * Renders at decreasing sizes until one fits, bisecting quality at that size.
 *
 * The first fitting size is returned, which keeps the largest dimensions the
 * target allows; within that size the bisection finds the highest quality that
 * still fits.
 */
export async function encodeWithinTarget<T>(
  render: (quality: number, scale: number) => Promise<T>,
  measure: (payload: T) => number,
  options: SizeTargetOptions,
): Promise<TargetSizeResult<T>> {
  const floor = clamp(
    Number.isFinite(options.minQuality ?? NaN)
      ? (options.minQuality as number)
      : DEFAULT_QUALITY_FLOOR,
    0.01,
    1,
  );
  const ceiling = Math.max(
    floor,
    clamp(
      Number.isFinite(options.maxQuality ?? NaN)
        ? (options.maxQuality as number)
        : DEFAULT_QUALITY_CEILING,
      0.01,
      1,
    ),
  );
  const scales = normalizeScaleSteps(options.scaleSteps);
  const iterations = clamp(
    Math.floor(options.qualityIterations ?? DEFAULT_QUALITY_ITERATIONS),
    1,
    20,
  );
  const target = options.targetBytes;

  const attempts: EncodingAttempt[] = [];
  // A holder object rather than a bare variable: the assignment happens inside
  // the async attempt closure, which control-flow analysis cannot follow.
  const smallest: {
    value: { payload: T; quality: number; scale: number; bytes: number } | null;
  } = { value: null };

  const attempt = async (
    quality: number,
    scale: number,
  ): Promise<{ payload: T; bytes: number }> => {
    const payload = await render(quality, scale);
    const bytes = measure(payload);
    attempts.push({ quality, scale, bytes });
    if (smallest.value === null || bytes < smallest.value.bytes) {
      smallest.value = { payload, quality, scale, bytes };
    }
    return { payload, bytes };
  };

  // An impossible target cannot be met; still render the smallest candidate so
  // the caller can show what the limit would cost, and say it did not fit.
  if (!Number.isFinite(target) || target < 1) {
    const smallestScale = scales[scales.length - 1];
    const result = await attempt(floor, smallestScale);
    return {
      payload: result.payload,
      quality: floor,
      scale: smallestScale,
      bytes: result.bytes,
      achieved: false,
      attempts,
    };
  }

  for (const scale of scales) {
    const top = await attempt(ceiling, scale);
    if (top.bytes <= target) {
      return {
        payload: top.payload,
        quality: ceiling,
        scale,
        bytes: top.bytes,
        achieved: true,
        attempts,
      };
    }

    if (ceiling <= floor + 1e-9) continue;

    const bottom = await attempt(floor, scale);
    if (bottom.bytes > target) continue;

    let best = { payload: bottom.payload, quality: floor, bytes: bottom.bytes };
    let low = floor;
    let high = ceiling;
    for (let step = 0; step < iterations; step += 1) {
      const mid = (low + high) / 2;
      const probe = await attempt(mid, scale);
      if (probe.bytes <= target) {
        low = mid;
        best = { payload: probe.payload, quality: mid, bytes: probe.bytes };
      } else {
        high = mid;
      }
    }

    return {
      payload: best.payload,
      quality: best.quality,
      scale,
      bytes: best.bytes,
      achieved: true,
      attempts,
    };
  }

  // Nothing fit. The smallest measured attempt is the most useful answer.
  const fallback = smallest.value;
  if (fallback === null) {
    // render must have been called at least once above, so this is unreachable
    // in practice; it keeps the return type honest without a non-null assertion.
    const result = await attempt(floor, scales[scales.length - 1]);
    return {
      payload: result.payload,
      quality: floor,
      scale: scales[scales.length - 1],
      bytes: result.bytes,
      achieved: false,
      attempts,
    };
  }

  return {
    payload: fallback.payload,
    quality: fallback.quality,
    scale: fallback.scale,
    bytes: fallback.bytes,
    achieved: false,
    attempts,
  };
}

/** Human-readable byte count for the tiny files ID photos produce. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Parses the target-size field.
 *
 * A non-positive or non-numeric entry falls back to the default rather than
 * producing a zero-byte target, which would make every export "fail".
 */
export function targetBytesFromKb(text: string, fallbackKb = 50): number {
  const kb = Number.parseFloat(text);
  if (!Number.isFinite(kb) || kb <= 0) {
    return Math.max(1024, Math.round(fallbackKb * 1024));
  }
  return Math.max(1024, Math.round(kb * 1024));
}

/* ------------------------------------------------------------------ *
 * Print resolution
 * ------------------------------------------------------------------ */

/**
 * Writes the print resolution into a JPEG's JFIF header.
 *
 * `canvas.toBlob('image/jpeg')` produces a JFIF stream with the density fields
 * set to 1:1 aspect with no resolution (`units = 0`), which means the file
 * carries no physical size. Print dialogs then fall back to their own default —
 * commonly 72 or 96 dpi — so a 295 px wide ID photo comes out around 10 cm
 * instead of 25 mm unless the user remembers to set "100%".
 *
 * With `units = 1` and a 300 dpi density the physical size travels with the
 * file, so the photo prints at the size it was measured for. This edits the
 * header in place rather than re-encoding: re-encoding would either change the
 * pixels or need a second lossy pass.
 *
 * Returns the input unchanged (as a copy) when the bytes are not a JPEG, so the
 * caller can apply it unconditionally.
 */
export function withJpegDensity(bytes: Uint8Array, dpi: number): Uint8Array {
  const copy = new Uint8Array(bytes);
  if (copy.length < 4 || copy[0] !== 0xff || copy[1] !== 0xd8) return copy;

  const density = Math.max(1, Math.min(65535, Math.round(dpi)));

  // Locate an existing APP0/JFIF segment: FF E0 <len:2> 'JFIF\0'.
  const isJfifAt = (offset: number): boolean =>
    copy[offset] === 0xff &&
    copy[offset + 1] === 0xe0 &&
    copy[offset + 4] === 0x4a && // J
    copy[offset + 5] === 0x46 && // F
    copy[offset + 6] === 0x49 && // I
    copy[offset + 7] === 0x46; // F

  if (isJfifAt(2)) {
    // Offsets are relative to the APP0 marker, which starts right after the
    // two-byte SOI: marker 2, length 2, 'JFIF\0' 5, version 2, then units.
    const base = 2;
    copy[base + 11] = 1; // units: dots per inch
    copy[base + 12] = (density >> 8) & 0xff;
    copy[base + 13] = density & 0xff;
    copy[base + 14] = (density >> 8) & 0xff;
    copy[base + 15] = density & 0xff;
    return copy;
  }

  // No JFIF header: build one and splice it in after SOI. Length counts itself
  // and the 12 bytes of payload, and the thumbnail dimensions are 0x00.
  const segment = new Uint8Array([
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00, // 'JFIF' 0
    0x01, 0x01, // version 1.01
    0x01, // units: dots per inch
    (density >> 8) & 0xff, density & 0xff,
    (density >> 8) & 0xff, density & 0xff,
    0x00, 0x00, // no thumbnail
  ]);
  const output = new Uint8Array(copy.length + segment.length);
  output.set(copy.subarray(0, 2), 0);
  output.set(segment, 2);
  output.set(copy.subarray(2), 2 + segment.length);
  return output;
}

/** Reads the JFIF density back out, for checks and for the UI. */
export function readJpegDensity(bytes: Uint8Array): {
  units: number;
  x: number;
  y: number;
} | null {
  if (bytes.length < 18 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  // The APP0 marker sits at offset 2 (right after SOI), so 'JFIF' starts at 6.
  if (
    bytes[2] !== 0xff ||
    bytes[3] !== 0xe0 ||
    bytes[6] !== 0x4a ||
    bytes[7] !== 0x46 ||
    bytes[8] !== 0x49 ||
    bytes[9] !== 0x46
  ) {
    return null;
  }
  // Same offsets the writer uses: relative to the APP0 marker at offset 2.
  const base = 2;
  return {
    units: bytes[base + 11],
    x: (bytes[base + 12] << 8) | bytes[base + 13],
    y: (bytes[base + 14] << 8) | bytes[base + 15],
  };
}
