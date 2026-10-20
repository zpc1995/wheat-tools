/**
 * Portrait matting with classic computer vision, in plain arrays.
 *
 * No model and no canvas: the input is an RGBA buffer and the output is a
 * single-channel alpha mask, so the whole pipeline can be exercised in Node
 * against synthetic images whose true mask is known by construction. The UI
 * only converts the mask into a canvas.
 *
 * The pipeline is deliberately split into separately callable stages:
 *
 *   1. estimate the background colour from the border ring, allowing up to a
 *      few clusters so a gradient wall is described by several centres rather
 *      than one wrong average;
 *   2. convert every pixel to CIE Lab and measure the distance to the nearest
 *      background centre. Lab is used because a plain RGB distance treats a
 *      dark blue and a dark red as closer than they look;
 *   3. turn the distance into alpha with a soft threshold, so edges keep a
 *      ramp instead of a staircase;
 *   4. flood from the border through low-distance pixels. Only background
 *      reachable from the edge is removed. This is what keeps a white shirt
 *      from being punched out just because its colour matches the wall;
 *   5. keep the largest connected foreground region plus any secondary region
 *      that is a meaningful fraction of it, dropping specks;
 *   6. open and close the binary mask, force the interior opaque, then feather
 *      the rim slightly.
 *
 * Limitations are real and are stated in the UI: a busy background, a subject
 * whose clothes are the same colour as the wall with no separating edge, or a
 * subject that dominates the border ring can defeat the estimate. The brush in
 * the UI exists for exactly those cases.
 */

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface LabColor {
  L: number;
  a: number;
  b: number;
}

/** Standard D65 reference white, used for the sRGB to Lab conversion. */
const D65_X = 0.95047;
const D65_Z = 1.08883;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function srgbToLinear(channel: number): number {
  const value = clamp(channel, 0, 255) / 255;
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

/**
 * sRGB (0-255 channels) to CIE Lab under D65.
 *
 * The published reference values used by the checks are the standard sRGB
 * primaries, for example red is approximately L 53.24, a 80.09, b 67.20.
 */
export function rgbToLab(r: number, g: number, b: number): LabColor {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const x = (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / D65_X;
  const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175;
  const z = (lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041) / D65_Z;

  const delta = 6 / 29;
  const threshold = delta * delta * delta;
  const f = (value: number): number =>
    value > threshold
      ? Math.cbrt(value)
      : value / (3 * delta * delta) + 4 / 29;

  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/** Euclidean distance in Lab (the CIE76 difference). */
export function labDistance(left: LabColor, right: LabColor): number {
  const dL = left.L - right.L;
  const da = left.a - right.a;
  const db = left.b - right.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

/**
 * Indices of the pixels in a band of the given thickness along all four edges.
 *
 * A single pass over the image is simpler than four loops and cannot emit a
 * duplicate when the image is smaller than the band.
 */
export function borderPixelIndices(
  width: number,
  height: number,
  ring = 2,
): Uint32Array {
  const thickness = Math.max(1, Math.floor(ring));
  const indices: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (
        x < thickness ||
        y < thickness ||
        x >= width - thickness ||
        y >= height - thickness
      ) {
        indices.push(y * width + x);
      }
    }
  }
  return Uint32Array.from(indices);
}

export interface BackgroundOptions {
  /** Border band thickness in pixels. */
  ring?: number;
  /** Maximum number of colour clusters used to describe the background. */
  maxClusters?: number;
  /** Clusters covering less of the ring than this are treated as subject. */
  minClusterSupport?: number;
  /**
   * How many sides of the frame a cluster must appear on to be accepted as
   * background.
   *
   * Support alone is not enough. A subject that runs off the bottom of the
   * frame puts its own colour on that edge, and if it is broad enough it clears
   * the support threshold and gets learned as "background" — which is how a
   * white shirt against a pale wall disappears entirely. A real backdrop is
   * visible above and beside the subject, so it shows up on two or more sides,
   * while a subject entering from one edge shows up on one.
   */
  minClusterSides?: number;
  /**
   * Support at which a cluster is accepted even on a single side, for frames
   * where the backdrop genuinely fills only one edge.
   */
  dominantSupport?: number;
}

export interface BackgroundEstimate {
  clusters: LabColor[];
  /** Fraction of the ring samples assigned to each retained cluster. */
  supports: number[];
  /** 95th percentile of within-cluster Lab distance. */
  spread: number;
  /** Distance at or below which a pixel is confidently background. */
  low: number;
  /** Distance at or above which a pixel is confidently foreground. */
  high: number;
}

interface ClusterAccumulator {
  L: number;
  a: number;
  b: number;
  count: number;
}

function nearestCluster(
  L: number,
  a: number,
  b: number,
  centers: LabColor[],
): { index: number; distance: number } {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < centers.length; index += 1) {
    const center = centers[index];
    const dL = L - center.L;
    const da = a - center.a;
    const db = b - center.b;
    const distance = Math.sqrt(dL * dL + da * da + db * db);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return { index: bestIndex, distance: bestDistance };
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = clamp(Math.ceil(fraction * sorted.length) - 1, 0, sorted.length - 1);
  return sorted[index];
}

/**
 * Estimates the background from the border ring.
 *
 * Seeds are chosen farthest-first (a cheap deterministic approximation of k
 * means), then refined. Starting from one average would smear a gradient into a
 * colour that appears nowhere in the photo; farthest-first gives the gradient
 * two or three centres that together cover it.
 */
export function estimateBackground(
  image: RgbaImage,
  options: BackgroundOptions = {},
): BackgroundEstimate {
  const { width, height, data } = image;
  const ring = options.ring ?? 2;
  const maxClusters = clamp(Math.floor(options.maxClusters ?? 3), 1, 8);
  const minSupport = clamp(options.minClusterSupport ?? 0.12, 0, 0.9);
  const minSides = clamp(Math.floor(options.minClusterSides ?? 2), 1, 4);
  const dominantSupport = clamp(options.dominantSupport ?? 0.6, 0, 1);

  const indices = borderPixelIndices(width, height, ring);
  if (indices.length === 0) {
    const fallback: LabColor = { L: 0, a: 0, b: 0 };
    return {
      clusters: [fallback],
      supports: [1],
      spread: 0,
      low: 8,
      high: 18,
    };
  }

  const samples = new Float32Array(indices.length * 3);
  for (let sample = 0; sample < indices.length; sample += 1) {
    const offset = indices[sample] * 4;
    const lab = rgbToLab(data[offset], data[offset + 1], data[offset + 2]);
    samples[sample * 3] = lab.L;
    samples[sample * 3 + 1] = lab.a;
    samples[sample * 3 + 2] = lab.b;
  }

  // Seed 0 is the mean colour of the ring, then each further seed is the sample
  // farthest from every existing seed.
  let sumL = 0;
  let sumA = 0;
  let sumB = 0;
  for (let sample = 0; sample < indices.length; sample += 1) {
    sumL += samples[sample * 3];
    sumA += samples[sample * 3 + 1];
    sumB += samples[sample * 3 + 2];
  }
  const seeds: LabColor[] = [
    {
      L: sumL / indices.length,
      a: sumA / indices.length,
      b: sumB / indices.length,
    },
  ];

  const targetClusters = Math.min(maxClusters, indices.length);
  const splitDistance = 10;
  while (seeds.length < targetClusters) {
    let bestDistance = -1;
    let bestSample = -1;
    for (let sample = 0; sample < indices.length; sample += 1) {
      const L = samples[sample * 3];
      const a = samples[sample * 3 + 1];
      const b = samples[sample * 3 + 2];
      const nearest = nearestCluster(L, a, b, seeds);
      if (nearest.distance > bestDistance) {
        bestDistance = nearest.distance;
        bestSample = sample;
      }
    }
    if (bestSample < 0 || bestDistance < splitDistance) break;
    seeds.push({
      L: samples[bestSample * 3],
      a: samples[bestSample * 3 + 1],
      b: samples[bestSample * 3 + 2],
    });
  }

  let centers = seeds;
  const assignments = new Int32Array(indices.length);

  for (let iteration = 0; iteration < 6; iteration += 1) {
    const sums: ClusterAccumulator[] = centers.map(() => ({
      L: 0,
      a: 0,
      b: 0,
      count: 0,
    }));
    for (let sample = 0; sample < indices.length; sample += 1) {
      const L = samples[sample * 3];
      const a = samples[sample * 3 + 1];
      const b = samples[sample * 3 + 2];
      const nearest = nearestCluster(L, a, b, centers);
      assignments[sample] = nearest.index;
      const accumulator = sums[nearest.index];
      accumulator.L += L;
      accumulator.a += a;
      accumulator.b += b;
      accumulator.count += 1;
    }

    let shift = 0;
    // An empty cluster keeps its previous centre rather than collapsing to
    // black, which would otherwise attract pixels on the next iteration.
    const next: LabColor[] = centers.map((center, index) => {
      const accumulator = sums[index];
      if (accumulator.count === 0) return center;
      const updated = {
        L: accumulator.L / accumulator.count,
        a: accumulator.a / accumulator.count,
        b: accumulator.b / accumulator.count,
      };
      shift = Math.max(shift, labDistance(updated, center));
      return updated;
    });
    centers = next;
    if (shift < 0.01) break;
  }

  // One final assignment against the converged centres gives the support of
  // each cluster and the cluster membership used by the spread below.
  const counts = new Array<number>(centers.length).fill(0);
  // Bitmask per cluster: 1 top, 2 bottom, 4 left, 8 right.
  const sideMasks = new Array<number>(centers.length).fill(0);
  for (let sample = 0; sample < indices.length; sample += 1) {
    const L = samples[sample * 3];
    const a = samples[sample * 3 + 1];
    const b = samples[sample * 3 + 2];
    const nearest = nearestCluster(L, a, b, centers);
    assignments[sample] = nearest.index;
    counts[nearest.index] += 1;

    const pixel = indices[sample];
    const x = pixel % width;
    const y = (pixel - x) / width;
    let side = 0;
    if (y < ring) side |= 1;
    if (y >= height - ring) side |= 2;
    if (x < ring) side |= 4;
    if (x >= width - ring) side |= 8;
    sideMasks[nearest.index] |= side;
  }

  const sideCount = (mask: number): number => {
    let total = 0;
    for (let bit = 0; bit < 4; bit += 1) if (mask & (1 << bit)) total += 1;
    return total;
  };

  // Support filtering treats a colour that only touches a small part of the
  // ring as subject. Without it, a head or a shoulder cropped by the frame
  // would be learned as "background" and erased.
  //
  // Side coverage is the second half of the same argument: a colour confined to
  // one edge is far more likely to be the subject running out of frame than the
  // backdrop, even when it covers a decent share of the ring.
  let retained: number[] = [];
  for (let index = 0; index < centers.length; index += 1) {
    if (counts[index] === 0) continue;
    const support = counts[index] / indices.length;
    const sides = sideCount(sideMasks[index]);
    if (support < minSupport) continue;
    if (sides >= minSides || support >= dominantSupport) retained.push(index);
  }
  if (retained.length === 0) {
    let largest = 0;
    for (let index = 1; index < counts.length; index += 1) {
      if (counts[index] > counts[largest]) largest = index;
    }
    retained = [largest];
  }
  const retainedSet = new Set(retained);
  const finalCenters = retained.map((index) => centers[index]);
  const finalCounts = retained.map((index) => counts[index]);

  // Only samples assigned to a retained cluster contribute to the spread.
  // Including the rejected subject cluster would inflate the threshold until
  // the subject itself looked like background.
  const within: number[] = [];
  for (let sample = 0; sample < indices.length; sample += 1) {
    const cluster = assignments[sample];
    if (!retainedSet.has(cluster)) continue;
    const center = centers[cluster];
    const dL = samples[sample * 3] - center.L;
    const da = samples[sample * 3 + 1] - center.a;
    const db = samples[sample * 3 + 2] - center.b;
    within.push(Math.sqrt(dL * dL + da * da + db * db));
  }

  const spread = percentile(within, 0.95);
  // The thresholds sit just above the observed background variation. The
  // multiplier was tuned against real portrait shapes: it has to cover a
  // gradient, whose per-cluster spread understates the total range, while
  // staying below skin and clothing colours. Otherwise the subject comes out
  // semi-transparent. The high threshold leaves only a narrow soft band.
  const low = Math.max(7, spread * 1.35 + 2);
  const high = low + Math.max(6, spread * 0.5 + 4);

  return {
    clusters: finalCenters,
    supports: finalCounts.map((count) => count / indices.length),
    spread,
    low,
    high,
  };
}

/** Per-pixel Lab distance to the nearest background cluster. */
export function distanceField(
  image: RgbaImage,
  clusters: LabColor[],
): Float32Array {
  const { width, height, data } = image;
  const total = width * height;
  const distances = new Float32Array(total);
  if (clusters.length === 0) {
    distances.fill(Infinity);
    return distances;
  }

  for (let pixel = 0; pixel < total; pixel += 1) {
    const offset = pixel * 4;
    const lab = rgbToLab(data[offset], data[offset + 1], data[offset + 2]);
    distances[pixel] = nearestCluster(lab.L, lab.a, lab.b, clusters).distance;
  }
  return distances;
}

/**
 * Soft threshold: 0 at or below `low`, 255 at or above `high`, linear between.
 *
 * The ramp is what keeps an anti-aliased edge from turning into a jagged one.
 */
export function softThreshold(
  distances: Float32Array,
  low: number,
  high: number,
): Uint8ClampedArray {
  const alpha = new Uint8ClampedArray(distances.length);
  const span = high - low;
  if (!(span > 0)) {
    for (let index = 0; index < distances.length; index += 1) {
      alpha[index] = distances[index] <= low ? 0 : 255;
    }
    return alpha;
  }
  for (let index = 0; index < distances.length; index += 1) {
    const fraction = (distances[index] - low) / span;
    alpha[index] = Math.round(clamp(fraction, 0, 1) * 255);
  }
  return alpha;
}

/** Pixels that are close enough to a background cluster to be a candidate. */
export function candidateBackground(
  distances: Float32Array,
  low: number,
): Uint8Array {
  const candidate = new Uint8Array(distances.length);
  for (let index = 0; index < distances.length; index += 1) {
    candidate[index] = distances[index] <= low ? 1 : 0;
  }
  return candidate;
}

/**
 * Marks candidate pixels connected to the border with a four-neighbour flood.
 *
 * Connectivity is the whole point: a light-coloured shirt enclosed by a dark
 * jacket is not reachable from the edge and therefore survives, while the wall
 * behind the subject is reachable and is removed.
 */
export function floodFillFromBorder(
  candidate: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const total = width * height;
  const background = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const push = (index: number): void => {
    if (candidate[index] === 1 && background[index] === 0) {
      background[index] = 1;
      queue[tail] = index;
      tail += 1;
    }
  };

  for (let x = 0; x < width; x += 1) {
    push(x);
    if (height > 1) push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    if (width > 1) push(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) push(index - 1);
    if (x + 1 < width) push(index + 1);
    if (y > 0) push(index - width);
    if (y + 1 < height) push(index + width);
  }

  return background;
}

export interface ComponentResult {
  mask: Uint8Array;
  /** Pixels kept: the largest component plus significant secondary ones. */
  pixels: number;
  /** Number of connected components found. */
  components: number;
}

/**
 * Keeps the significant four-connected components of a binary mask.
 *
 * Keeping only the single largest component is too aggressive: a subject is not
 * always one blob. Long hair can be separated from the shoulders by a stray
 * background pixel, an arm can be cut off by the crop, and a photo of someone
 * in a chair has genuinely disjoint parts. Deleting everything but the largest
 * blob silently amputates those, and the failure is easy to miss because the
 * preview still looks like a person.
 *
 * `minFractionOfLargest` sets the bar: a component is kept when it reaches that
 * share of the largest one, and always above an absolute floor so the rule does
 * not collapse on tiny masks (2% of a four-pixel blob is a fraction of a pixel,
 * which would let every speck through). The largest component is always kept.
 */
export function largestComponentMask(
  binary: Uint8Array,
  width: number,
  height: number,
  minFractionOfLargest = 0.02,
  minAbsolutePixels = 8,
): ComponentResult {
  const total = width * height;
  const labels = new Int32Array(total).fill(-1);
  const queue = new Int32Array(total);
  let nextLabel = 0;
  let bestLabel = -1;
  let bestPixels = 0;

  for (let start = 0; start < total; start += 1) {
    if (binary[start] !== 1 || labels[start] !== -1) continue;
    const label = nextLabel;
    nextLabel += 1;
    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    labels[start] = label;
    let pixels = 0;

    while (head < tail) {
      const index = queue[head];
      head += 1;
      pixels += 1;
      const x = index % width;
      const y = (index - x) / width;
      const neighbours = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ];
      for (const neighbour of neighbours) {
        if (
          neighbour >= 0 &&
          binary[neighbour] === 1 &&
          labels[neighbour] === -1
        ) {
          labels[neighbour] = label;
          queue[tail] = neighbour;
          tail += 1;
        }
      }
    }

    if (pixels > bestPixels) {
      bestPixels = pixels;
      bestLabel = label;
    }
  }

  // Second pass: keep every component that clears the fraction bar. The
  // component sizes are already known from the labelling above, so this only
  // needs the per-label totals rather than another flood fill.
  const sizes = new Array<number>(nextLabel).fill(0);
  for (let index = 0; index < total; index += 1) {
    const label = labels[index];
    if (label >= 0) sizes[label] += 1;
  }

  const threshold = Math.max(
    Math.max(1, Math.floor(minAbsolutePixels)),
    bestPixels * clamp(minFractionOfLargest, 0, 1),
  );
  const keep = new Uint8Array(total);
  let keptPixels = 0;
  if (bestLabel >= 0) {
    for (let index = 0; index < total; index += 1) {
      const label = labels[index];
      if (label >= 0 && (label === bestLabel || sizes[label] >= threshold)) {
        keep[index] = 1;
        keptPixels += 1;
      }
    }
  }
  return { mask: keep, pixels: keptPixels, components: nextLabel };
}

type MorphMode = 'min' | 'max';

function morphPass(
  source: Uint8Array,
  width: number,
  height: number,
  radius: number,
  mode: MorphMode,
  horizontal: boolean,
): Uint8Array {
  const output = new Uint8Array(source.length);
  const outer = horizontal ? height : width;
  const inner = horizontal ? width : height;

  for (let line = 0; line < outer; line += 1) {
    for (let position = 0; position < inner; position += 1) {
      const start = Math.max(0, position - radius);
      const end = Math.min(inner - 1, position + radius);
      let value = mode === 'min' ? 1 : 0;
      for (let offset = start; offset <= end; offset += 1) {
        const index = horizontal
          ? line * width + offset
          : offset * width + line;
        const sample = source[index];
        if (mode === 'min') {
          if (sample === 0) {
            value = 0;
            break;
          }
        } else if (sample === 1) {
          value = 1;
          break;
        }
      }
      const target = horizontal
        ? line * width + position
        : position * width + line;
      output[target] = value;
    }
  }
  return output;
}

function morphology(
  binary: Uint8Array,
  width: number,
  height: number,
  radius: number,
  mode: MorphMode,
): Uint8Array {
  if (radius <= 0) return binary.slice();
  const horizontal = morphPass(binary, width, height, radius, mode, true);
  return morphPass(horizontal, width, height, radius, mode, false);
}

export function erodeBinary(
  binary: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  return morphology(binary, width, height, radius, 'min');
}

export function dilateBinary(
  binary: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  return morphology(binary, width, height, radius, 'max');
}

/** Opening removes thin specks; it is erosion followed by dilation. */
export function openBinary(
  binary: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  return dilateBinary(
    erodeBinary(binary, width, height, radius),
    width,
    height,
    radius,
  );
}

/** Closing fills pinholes; it is dilation followed by erosion. */
export function closeBinary(
  binary: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  return erodeBinary(
    dilateBinary(binary, width, height, radius),
    width,
    height,
    radius,
  );
}

/** Separable box blur, clipped at the borders. */
export function featherAlpha(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  const r = Math.max(0, Math.floor(radius));
  if (r === 0) return new Uint8ClampedArray(alpha);
  const total = width * height;
  const horizontal = new Float32Array(total);
  const output = new Uint8ClampedArray(total);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = Math.max(0, x - r);
      const end = Math.min(width - 1, x + r);
      let sum = 0;
      for (let offset = start; offset <= end; offset += 1) {
        sum += alpha[y * width + offset];
      }
      horizontal[y * width + x] = sum / (end - start + 1);
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = Math.max(0, y - r);
      const end = Math.min(height - 1, y + r);
      let sum = 0;
      for (let offset = start; offset <= end; offset += 1) {
        sum += horizontal[offset * width + x];
      }
      output[y * width + x] = Math.round(sum / (end - start + 1));
    }
  }
  return output;
}

export type BrushMode = 'erase' | 'restore';

export interface BrushStroke {
  /** Centre in working-image pixels. */
  x: number;
  y: number;
  /** Radius in working-image pixels. */
  radius: number;
  mode: BrushMode;
  /** Fraction of the radius that is fully affected, 0-1. */
  hardness?: number;
}

/**
 * Applies manual brush strokes to a copy of the alpha mask.
 *
 * Strokes are kept as data rather than painted into the mask directly, so the
 * UI can re-apply them after a tolerance change and can undo the last one.
 */
export function applyBrushStrokes(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  strokes: BrushStroke[],
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(alpha);
  for (const stroke of strokes) {
    const radius = Math.max(1, stroke.radius);
    const hardness = clamp(stroke.hardness ?? 0.6, 0, 1);
    const minX = Math.max(0, Math.floor(stroke.x - radius));
    const maxX = Math.min(width - 1, Math.ceil(stroke.x + radius));
    const minY = Math.max(0, Math.floor(stroke.y - radius));
    const maxY = Math.min(height - 1, Math.ceil(stroke.y + radius));
    const radiusSquared = radius * radius;

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x - stroke.x;
        const dy = y - stroke.y;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared > radiusSquared) continue;
        const distance = Math.sqrt(distanceSquared) / radius;
        const strength =
          distance <= hardness
            ? 1
            : clamp((1 - distance) / Math.max(1e-6, 1 - hardness), 0, 1);
        if (strength <= 0) continue;
        const index = y * width + x;
        const current = output[index];
        const next =
          stroke.mode === 'erase'
            ? current * (1 - strength)
            : current + (255 - current) * strength;
        output[index] = Math.round(clamp(next, 0, 255));
      }
    }
  }
  return output;
}

export interface MattingOptions {
  /** Multiplies both thresholds; above 1 keeps more as background. */
  tolerance?: number;
  /** Feather radius in pixels. */
  feather?: number;
  ring?: number;
  maxClusters?: number;
  minClusterSupport?: number;
  /** Radius used for the opening and closing steps. */
  morphologyRadius?: number;
  /** A subject must cover at least this fraction of the image. */
  minSubjectArea?: number;
}

export interface MattingStats {
  width: number;
  height: number;
  clusters: number;
  lowThreshold: number;
  highThreshold: number;
  spread: number;
  backgroundRatio: number;
  foregroundRatio: number;
  subjectPixels: number;
  subjectFound: boolean;
}

export interface MattingResult {
  /** One value per pixel, 0 = background, 255 = foreground. */
  alpha: Uint8ClampedArray;
  stats: MattingStats;
}

/**
 * Full matting pipeline.
 *
 * Behaviour with no subject: every pixel is background, the alpha mask is all
 * zeroes and `subjectFound` is false. The UI uses that flag to say so instead of
 * showing an empty preview without explanation.
 */
export function mattePortrait(
  image: RgbaImage,
  options: MattingOptions = {},
): MattingResult {
  const { width, height } = image;
  const total = width * height;
  const tolerance =
    options.tolerance !== undefined && Number.isFinite(options.tolerance)
      ? Math.max(0.1, options.tolerance)
      : 1;
  const feather = Math.max(0, Math.floor(options.feather ?? 1));
  const morphologyRadius = Math.max(
    0,
    Math.floor(options.morphologyRadius ?? 1),
  );
  const minSubjectArea = Math.max(0, options.minSubjectArea ?? 0.002);

  const estimate = estimateBackground(image, {
    ring: options.ring,
    maxClusters: options.maxClusters,
    minClusterSupport: options.minClusterSupport,
  });
  const low = estimate.low * tolerance;
  const high = estimate.high * tolerance;

  const distances = distanceField(image, estimate.clusters);
  const alpha = softThreshold(distances, low, high);
  const candidates = candidateBackground(distances, low);
  const background = floodFillFromBorder(candidates, width, height);

  const foreground = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) {
    if (background[index] === 1) {
      alpha[index] = 0;
      foreground[index] = 0;
    } else if (distances[index] <= low) {
      // Enclosed and close to the background colour: a white shirt inside a
      // darker jacket, for example. It is not reachable from the border, so it
      // belongs to the subject rather than to the background.
      alpha[index] = 255;
      foreground[index] = 1;
    } else {
      foreground[index] = alpha[index] > 0 ? 1 : 0;
    }
  }

  const opened = openBinary(foreground, width, height, morphologyRadius);
  const closed = closeBinary(opened, width, height, morphologyRadius);
  const largest = largestComponentMask(closed, width, height);
  const minimumPixels = Math.max(32, Math.floor(minSubjectArea * total));
  const subjectFound = largest.pixels > 0 && largest.pixels >= minimumPixels;

  let result: Uint8ClampedArray;
  if (!subjectFound) {
    result = new Uint8ClampedArray(total);
  } else {
    // Only the rim should keep the soft ramp. A distance-based alpha alone
    // leaves large interior areas semi-transparent whenever the subject colour
    // is moderately far from the background (skin and dark clothing do this on
    // a gradient wall). Eroding the subject by one pixel and forcing the
    // interior opaque fixes that while leaving a soft one-pixel edge.
    const interior = erodeBinary(largest.mask, width, height, 1);
    result = new Uint8ClampedArray(total);
    for (let index = 0; index < total; index += 1) {
      if (largest.mask[index] !== 1) continue;
      result[index] = interior[index] === 1 ? 255 : alpha[index];
    }
  }

  if (feather > 0) {
    result = featherAlpha(result, width, height, feather);
  }

  let foregroundPixels = 0;
  let backgroundPixels = 0;
  for (let index = 0; index < total; index += 1) {
    if (result[index] > 127) foregroundPixels += 1;
    if (background[index] === 1) backgroundPixels += 1;
  }

  return {
    alpha: result,
    stats: {
      width,
      height,
      clusters: estimate.clusters.length,
      lowThreshold: low,
      highThreshold: high,
      spread: estimate.spread,
      backgroundRatio: total === 0 ? 0 : backgroundPixels / total,
      foregroundRatio: total === 0 ? 0 : foregroundPixels / total,
      subjectPixels: largest.pixels,
      subjectFound,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Colour decontamination
 * ------------------------------------------------------------------ */

/**
 * Removes the background colour that mixed into the edge pixels.
 *
 * A matte's alpha says *how much* subject is in a pixel, but the pixel's colour
 * is still a blend of subject and background. Compositing that blend onto a new
 * background double-counts the old one: the seam keeps a rim of the original
 * backdrop. With a pale wall behind dark hair the rim is a bright halo, which is
 * the single most visible defect when a portrait is dropped onto a coloured ID
 * background — and raising the matting resolution alone does not remove it,
 * because the contamination is in the colour, not the mask.
 *
 * The fix is the standard un-mixing step: for a pixel that is `t` percent
 * subject, the observed colour is `C = t*F + (1-t)*B` for unknown foreground
 * `F` and known background `B`, so `F = (C - (1-t)*B) / t`. The background is
 * estimated from the fully transparent pixels.
 *
 * Only partly transparent pixels are touched. Fully opaque pixels are left
 * exactly as they are, so the face and clothing cannot shift, and the division
 * is stabilised by clamping `t` away from zero.
 *
 * Pure and exported for testing: it mutates the RGB of `pixels` in place and
 * never touches the alpha channel.
 */
export function decontaminateEdges(
  pixels: Uint8ClampedArray,
  alpha: Uint8ClampedArray,
): { background: [number, number, number]; touched: number } {
  const total = Math.min(alpha.length, Math.floor(pixels.length / 4));

  // Estimate the original backdrop from the pixels the matte calls background.
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let samples = 0;
  for (let index = 0; index < total; index += 1) {
    if (alpha[index] > 2) continue;
    const offset = index * 4;
    sumR += pixels[offset];
    sumG += pixels[offset + 1];
    sumB += pixels[offset + 2];
    samples += 1;
  }
  if (samples === 0) {
    // Nothing was fully transparent: there is no background to estimate, and
    // guessing one would shift colours on a correct matte.
    return { background: [0, 0, 0], touched: 0 };
  }
  const background: [number, number, number] = [
    sumR / samples,
    sumG / samples,
    sumB / samples,
  ];

  let touched = 0;
  for (let index = 0; index < total; index += 1) {
    const a = alpha[index];
    if (a >= 250) continue; // solid subject: leave it alone
    const t = a / 255;
    const stable = Math.max(t, 0.1);
    const weight = 1 - t; // reaches 1 at fully transparent, 0 at fully opaque
    const offset = index * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const observed = pixels[offset + channel];
      const unmixed =
        (observed - (1 - stable) * background[channel]) / stable;
      const value = observed + (clamp(unmixed, 0, 255) - observed) * weight;
      pixels[offset + channel] = Math.round(value);
    }
    touched += 1;
  }
  return { background: background.map(Math.round) as [number, number, number], touched };
}

/* ------------------------------------------------------------------ *
 * Edge colour propagation and matte tightening
 * ------------------------------------------------------------------ */

/**
 * Replaces the colour of non-solid pixels with the nearest solid foreground
 * colour, working outward from the subject.
 *
 * Un-mixing alone cannot fix a seam when the model overestimates alpha: a pixel
 * that is really 30% hair but is reported as 50% yields an un-mixed colour that
 * is still pale, and compositing that over a coloured background leaves a light
 * rim. Where there is little or no subject in a pixel there is no foreground
 * colour to recover, so the only honest answer is the nearby one that is
 * definitely foreground — hair colour next to hair.
 *
 * Breadth-first from the solid pixels, so the cost is linear in the number of
 * edge pixels rather than in image area times distance. Pixels the propagation
 * never reaches keep their original colour.
 */
export function propagateForegroundColors(
  pixels: Uint8ClampedArray,
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  options: { solidAlpha?: number; maxDistance?: number } = {},
): { filled: number; distance: number } {
  const total = Math.min(alpha.length, Math.floor(pixels.length / 4), width * height);
  if (total === 0 || width <= 0 || height <= 0) {
    return { filled: 0, distance: 0 };
  }
  const solid = clamp(options.solidAlpha ?? 0.85, 0, 1) * 255;
  const maxDistance = Math.max(1, Math.floor(options.maxDistance ?? 24));

  const visited = new Uint8Array(total);
  let frontier: number[] = [];
  for (let index = 0; index < total; index += 1) {
    if (alpha[index] >= solid) {
      visited[index] = 1;
      frontier.push(index);
    }
  }
  if (frontier.length === 0) return { filled: 0, distance: 0 };

  // Width and height are parameters, not derived: inferring the width from
  // `sqrt(pixelCount)` happens to work on a square test fixture and silently
  // walks the wrong neighbours on a real 1378x1280 photo.
  let filled = 0;
  let distance = 0;
  for (let step = 0; step < maxDistance && frontier.length > 0; step += 1) {
    const next: number[] = [];
    for (const index of frontier) {
      const x = index % width;
      const y = (index - x) / width;
      const neighbours = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ];
      for (const neighbour of neighbours) {
        if (neighbour < 0 || visited[neighbour] === 1) continue;
        visited[neighbour] = 1;
        const from = index * 4;
        const to = neighbour * 4;
        pixels[to] = pixels[from];
        pixels[to + 1] = pixels[from + 1];
        pixels[to + 2] = pixels[from + 2];
        next.push(neighbour);
        filled += 1;
      }
    }
    if (next.length > 0) distance = step + 1;
    frontier = next;
  }
  return { filled, distance };
}

/**
 * Narrows the matte's transition band.
 *
 * The model's alpha ramps over several pixels. At a one-inch output (295 px
 * wide) that ramp is a visible fraction of the whole photo and reads as a blurry
 * outline no matter what colour it carries. A contrast curve around 0.5 keeps the
 * softness where it belongs — a pixel that is nearly half subject stays half —
 * while pulling the long tail of small values towards zero.
 *
 * A strength of 1 is a no-op; higher values tighten further.
 */
export function tightenAlpha(
  alpha: Uint8ClampedArray,
  strength = 2.4,
): Uint8ClampedArray {
  const amount = Math.max(0, Number.isFinite(strength) ? strength : 1);
  const output = new Uint8ClampedArray(alpha.length);
  if (amount === 1) {
    output.set(alpha);
    return output;
  }
  for (let index = 0; index < alpha.length; index += 1) {
    const t = alpha[index] / 255;
    const tightened = (t - 0.5) * amount + 0.5;
    output[index] = Math.round(clamp(tightened, 0, 1) * 255);
  }
  return output;
}

/* ------------------------------------------------------------------ *
 * Edge cleanup
 * ------------------------------------------------------------------ */

/**
 * Pulls the matte boundary inward and drops isolated specks.
 *
 * A model matte keeps the wispy hair it believes in, and around a light
 * background those wisps arrive as *light* pixels with a high alpha: the source
 * photo's hair-and-wall boundary is itself blurred, so a pixel can honestly be
 * 90% hair and still be pale grey. Composited onto blue, those pixels read as
 * white scratches along the silhouette — the strongest remaining "this was
 * pasted" cue.
 *
 * There is no way to recover structure the source does not contain, so an ID
 * photo is cleaned the way a studio does it: trim the silhouette to solid hair
 * and drop the specks. A two-pixel trim at working resolution removes the pale
 * fringe while leaving the outline natural; more starts to look cut out.
 *
 * Implemented as a grey erosion (minimum over a square window) so partial alpha
 * is handled rather than rounded to a binary mask first.
 */
export function cleanMatteEdges(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  options: { trim?: number; minSpeck?: number } = {},
): { alpha: Uint8ClampedArray<ArrayBuffer>; trimmed: number } {
  const trim = Math.max(0, Math.floor(options.trim ?? 0));
  const minSpeck = Math.max(0, Math.floor(options.minSpeck ?? 0));
  const total = Math.min(alpha.length, width * height);
  if (total === 0 || width <= 0 || height <= 0) {
    return { alpha: new Uint8ClampedArray(alpha), trimmed: 0 };
  }

  let work: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(alpha.subarray(0, total));

  // Grey erosion: each pixel takes the minimum of its (2r+1)² neighbourhood, so
  // the boundary moves inward by about r pixels and thin protrusions vanish.
  for (let step = 0; step < trim; step += 1) {
    const next = new Uint8ClampedArray(total);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let value = 255;
        for (let dy = -1; dy <= 1; dy += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const sample = work[ny * width + nx];
            if (sample < value) value = sample;
          }
        }
        next[y * width + x] = value;
      }
    }
    work = next;
  }

  if (minSpeck > 0) {
    work = dropSpecks(work, width, height, minSpeck);
  }
  return { alpha: work, trimmed: trim };
}

/** Zeroes out four-connected components smaller than `minSpeck` pixels. */
function dropSpecks(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  minSpeck: number,
): Uint8ClampedArray<ArrayBuffer> {
  const total = width * height;
  const threshold = 8;
  const label = new Int32Array(total).fill(-1);
  const queue = new Int32Array(total);
  const output = new Uint8ClampedArray(alpha);
  let next = 0;

  for (let start = 0; start < total; start += 1) {
    if (alpha[start] <= threshold || label[start] !== -1) continue;
    const id = next;
    next += 1;
    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    label[start] = id;
    const members: number[] = [];
    while (head < tail) {
      const index = queue[head];
      head += 1;
      members.push(index);
      const x = index % width;
      const y = (index - x) / width;
      const neighbours = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ];
      for (const neighbour of neighbours) {
        if (neighbour < 0) continue;
        if (alpha[neighbour] <= threshold || label[neighbour] !== -1) continue;
        label[neighbour] = id;
        queue[tail] = neighbour;
        tail += 1;
      }
    }
    if (members.length < minSpeck) {
      for (const index of members) output[index] = 0;
    }
  }
  return output;
}
