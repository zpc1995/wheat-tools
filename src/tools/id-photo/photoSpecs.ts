/**
 * Size tables and geometry for the ID photo maker.
 *
 * Honesty note, repeated in the UI and in the manifest: the millimetre sizes
 * below are common values collected from general references. They were not
 * checked against an official standard document offline, so nothing here claims
 * to be the authoritative rule of any issuing authority. The checks assert only
 * internal arithmetic consistency: pixels equal millimetres times DPI divided by
 * 25.4, and the pixel aspect ratio equals the millimetre aspect ratio.
 *
 * Provenance of the entries:
 *
 *   - one-inch, small one-inch, large one-inch, two-inch, small two-inch,
 *     large two-inch and the US visa size were confirmed against an independent
 *     size table.
 *   - passport, Schengen visa, social security card and graduation photo are
 *     common values that have not been independently confirmed here.
 *   - the driver licence entry has conflicting sources (22 x 32 mm versus
 *     35 x 45 mm), so it is marked `disputed` and the UI warns about it rather
 *     than showing it as settled.
 *
 * The 6-inch sheet is modelled with its 102 mm edge horizontal. A sheet is
 * physically 152 x 102 mm and can be fed either way round, so this is a layout
 * orientation, not a different paper size. It is the orientation in which
 * twelve one-inch photos fit as 3 columns by 4 rows with a 2 mm margin.
 */

/** How much confidence the interface should show for a size. */
export type SpecConfidence = 'verified' | 'common' | 'disputed';

export interface PhotoSpec {
  /** Stable id used by the UI and by the checks. */
  id: string;
  /** Simplified Chinese display name. */
  name: string;
  widthMm: number;
  heightMm: number;
  dpi: number;
  widthPx: number;
  heightPx: number;
  confidence: SpecConfidence;
  /** Caveat shown under the size, especially for unresolved entries. */
  note?: string;
}

/** International definition: one inch is exactly 25.4 millimetres. */
export const MM_PER_INCH = 25.4;

/**
 * Converts millimetres to whole pixels at a given DPI.
 *
 * Invalid or non-positive input yields 0 instead of NaN so callers can render a
 * size without a special case.
 */
export function mmToPx(mm: number, dpi: number): number {
  if (!Number.isFinite(mm) || !Number.isFinite(dpi) || mm <= 0 || dpi <= 0) {
    return 0;
  }
  return Math.round((mm * dpi) / MM_PER_INCH);
}

/** Converts inches to whole pixels at a given DPI. */
export function inchToPx(inch: number, dpi: number): number {
  if (!Number.isFinite(inch) || !Number.isFinite(dpi) || inch <= 0 || dpi <= 0) {
    return 0;
  }
  return Math.round(inch * dpi);
}

/**
 * The pixel sizes are written out rather than derived at run time so a typo in
 * either the millimetres or the pixels is visible in the checks. They do match
 * the formula; the check script proves it for every entry.
 */
export const PHOTO_SPECS: PhotoSpec[] = [
  {
    id: 'one-inch',
    name: '一寸',
    widthMm: 25,
    heightMm: 35,
    dpi: 300,
    widthPx: 295,
    heightPx: 413,
    confidence: 'verified',
  },
  {
    id: 'two-inch',
    name: '二寸',
    widthMm: 35,
    heightMm: 49,
    dpi: 300,
    widthPx: 413,
    heightPx: 579,
    confidence: 'verified',
  },
  {
    id: 'small-one-inch',
    name: '小一寸',
    widthMm: 22,
    heightMm: 32,
    dpi: 300,
    widthPx: 260,
    heightPx: 378,
    confidence: 'verified',
  },
  {
    id: 'large-one-inch',
    name: '大一寸',
    widthMm: 33,
    heightMm: 48,
    dpi: 300,
    widthPx: 390,
    heightPx: 567,
    confidence: 'verified',
  },
  {
    id: 'small-two-inch',
    name: '小二寸',
    widthMm: 35,
    heightMm: 45,
    dpi: 300,
    widthPx: 413,
    heightPx: 531,
    confidence: 'verified',
  },
  {
    id: 'large-two-inch',
    name: '大二寸',
    widthMm: 35,
    heightMm: 53,
    dpi: 300,
    widthPx: 413,
    heightPx: 626,
    confidence: 'verified',
  },
  {
    id: 'passport',
    name: '护照',
    widthMm: 33,
    heightMm: 48,
    dpi: 300,
    widthPx: 390,
    heightPx: 567,
    confidence: 'common',
    note: '常见 33 × 48mm，以出入境管理机构要求为准。',
  },
  {
    id: 'us-visa',
    name: '美国签证',
    widthMm: 50.8,
    heightMm: 50.8,
    dpi: 300,
    widthPx: 600,
    heightPx: 600,
    confidence: 'verified',
    note: '2 × 2 英寸；2 英寸 = 50.8mm，资料里常写作约 51 × 51mm。',
  },
  {
    id: 'schengen-visa',
    name: '申根签证',
    widthMm: 35,
    heightMm: 45,
    dpi: 300,
    widthPx: 413,
    heightPx: 531,
    confidence: 'common',
    note: '常见 35 × 45mm，以使领馆要求为准。',
  },
  {
    id: 'driver-license',
    name: '驾驶证',
    widthMm: 22,
    heightMm: 32,
    dpi: 300,
    widthPx: 260,
    heightPx: 378,
    confidence: 'disputed',
    note: '不同来源给出 22 × 32mm 与 35 × 45mm 两种说法，本工具暂按 22 × 32mm 显示，请先向受理机构确认。',
  },
  {
    id: 'social-security-card',
    name: '社保卡',
    widthMm: 26,
    heightMm: 32,
    dpi: 350,
    widthPx: 358,
    heightPx: 441,
    confidence: 'common',
    note: '常见 26 × 32mm @ 350dpi，各地要求可能不同。',
  },
  {
    id: 'graduation',
    name: '毕业照',
    widthMm: 33,
    heightMm: 48,
    dpi: 300,
    widthPx: 390,
    heightPx: 567,
    confidence: 'common',
    note: '各校要求不同，本项只是常见的 33 × 48mm。',
  },
];

export const SPEC_CONFIDENCE_LABEL: Record<SpecConfidence, string> = {
  verified: '已核对',
  common: '常见规格（未独立核对）',
  disputed: '尺寸有分歧（请先确认）',
};

export function findSpec(id: string): PhotoSpec | undefined {
  return PHOTO_SPECS.find((spec) => spec.id === id);
}

/** Falls back to the most common size so a stale id cannot break the UI. */
export function requireSpec(id: string): PhotoSpec {
  return findSpec(id) ?? PHOTO_SPECS[0];
}

/** One-line description such as "25 × 35 mm · 295 × 413 px · 300 dpi". */
export function describeSpec(spec: PhotoSpec): string {
  return (
    `${spec.widthMm} × ${spec.heightMm} mm · ` +
    `${spec.widthPx} × ${spec.heightPx} px · ${spec.dpi} dpi`
  );
}

export interface PhotoBackground {
  id: string;
  name: string;
  hex: string;
  /** Present only for gradient backgrounds. */
  gradientFrom?: string;
  gradientTo?: string;
}

/**
 * Background colours requested for ID photos. The white, blue and red hex
 * values were confirmed against the same independent table as the sizes.
 */
export const PHOTO_BACKGROUNDS: PhotoBackground[] = [
  { id: 'white', name: '白色', hex: '#FFFFFF' },
  { id: 'blue', name: '标准蓝', hex: '#438EDB' },
  { id: 'red', name: '红色', hex: '#FF0000' },
  { id: 'gray', name: '灰色', hex: '#D9D9D9' },
  {
    id: 'blue-white',
    name: '蓝白渐变',
    hex: '#438EDB',
    gradientFrom: '#438EDB',
    gradientTo: '#FFFFFF',
  },
];

export function findBackground(id: string): PhotoBackground | undefined {
  return PHOTO_BACKGROUNDS.find((background) => background.id === id);
}

export function requireBackground(id: string): PhotoBackground {
  return findBackground(id) ?? PHOTO_BACKGROUNDS[0];
}

/** Two stops used for a linear gradient; both are the same for solid fills. */
export function backgroundStops(background: PhotoBackground): [string, string] {
  return [
    background.gradientFrom ?? background.hex,
    background.gradientTo ?? background.hex,
  ];
}

export interface SheetTemplate {
  id: string;
  name: string;
  /** Horizontal edge. For the 6-inch sheet this is the short 102 mm edge. */
  widthMm: number;
  heightMm: number;
  dpi: number;
  widthPx: number;
  heightPx: number;
  marginMm: number;
  gapMm: number;
}

/**
 * Common 6-inch photo paper, 152 x 102 mm, with the short edge horizontal.
 *
 * Pixel count is 1205 x 1795 because the 102 mm edge is horizontal here; a
 * 152 x 102 mm sheet has the same area either way round and photo paper is fed
 * in whichever orientation the printer uses.
 */
export const SHEET_6IN: SheetTemplate = {
  id: 'sheet-6in',
  name: '6 寸相纸（152 × 102 mm，短边横向）',
  widthMm: 102,
  heightMm: 152,
  dpi: 300,
  widthPx: 1205,
  heightPx: 1795,
  marginMm: 2,
  gapMm: 2,
};

export interface SheetOptions {
  /** Overrides the template's margin, in millimetres. */
  marginMm?: number;
  /** Overrides the template's gap, in millimetres. */
  gapMm?: number;
  /** Requests at most this many photos; capacity still caps the result. */
  limit?: number;
}

export interface SheetSlot {
  index: number;
  row: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CutLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SheetLayout {
  sheetWidthPx: number;
  sheetHeightPx: number;
  photoWidthPx: number;
  photoHeightPx: number;
  marginPx: number;
  gapPx: number;
  columns: number;
  rows: number;
  capacity: number;
  count: number;
  /** The requested limit before capacity clamping, or null when unlimited. */
  requestedCount: number | null;
  gridX: number;
  gridY: number;
  gridWidth: number;
  gridHeight: number;
  slots: SheetSlot[];
  cutLines: CutLine[];
}

function toPx(value: number, dpi: number): number {
  return mmToPx(value, dpi);
}

/**
 * Arranges identical photos on a sheet with a margin, a gap between photos and
 * cut lines in the middle of each gap.
 *
 * The grid is centred, so the leftover space is split evenly instead of piling
 * up on the right and bottom edges. Capacity is computed from the usable area
 * first; `limit` can only reduce the number printed, never exceed capacity.
 */
export function layoutSheet(
  photo: PhotoSpec,
  sheet: SheetTemplate = SHEET_6IN,
  options: SheetOptions = {},
): SheetLayout {
  const marginMm =
    options.marginMm !== undefined && Number.isFinite(options.marginMm)
      ? Math.max(0, options.marginMm)
      : sheet.marginMm;
  const gapMm =
    options.gapMm !== undefined && Number.isFinite(options.gapMm)
      ? Math.max(0, options.gapMm)
      : sheet.gapMm;

  const marginPx = toPx(marginMm, sheet.dpi);
  const gapPx = toPx(gapMm, sheet.dpi);
  const photoWidthPx = photo.widthPx;
  const photoHeightPx = photo.heightPx;
  const usableWidth = sheet.widthPx - marginPx * 2;
  const usableHeight = sheet.heightPx - marginPx * 2;

  const columns =
    usableWidth >= photoWidthPx
      ? Math.floor((usableWidth + gapPx) / (photoWidthPx + gapPx))
      : 0;
  const rows =
    usableHeight >= photoHeightPx
      ? Math.floor((usableHeight + gapPx) / (photoHeightPx + gapPx))
      : 0;

  const capacity = Math.max(0, columns) * Math.max(0, rows);
  const gridWidth =
    columns > 0 ? columns * photoWidthPx + (columns - 1) * gapPx : 0;
  const gridHeight = rows > 0 ? rows * photoHeightPx + (rows - 1) * gapPx : 0;
  const gridX = columns > 0 ? Math.round((sheet.widthPx - gridWidth) / 2) : 0;
  const gridY = rows > 0 ? Math.round((sheet.heightPx - gridHeight) / 2) : 0;

  const requestedRaw =
    options.limit !== undefined && Number.isFinite(options.limit)
      ? Math.max(0, Math.floor(options.limit))
      : null;
  const requestedCount = requestedRaw;
  const count = requestedCount === null ? capacity : Math.min(capacity, requestedCount);

  const slots: SheetSlot[] = [];
  if (count > 0) {
    for (let row = 0; row < rows && slots.length < count; row += 1) {
      for (let column = 0; column < columns && slots.length < count; column += 1) {
        const x = gridX + column * (photoWidthPx + gapPx);
        const y = gridY + row * (photoHeightPx + gapPx);
        slots.push({
          index: slots.length,
          row,
          column,
          x,
          y,
          width: photoWidthPx,
          height: photoHeightPx,
        });
      }
    }
  }

  const cutLines: CutLine[] = [];
  if (count > 0) {
    const usedRows = Math.ceil(count / columns);
    const usedColumns = Math.min(columns, count);
    const usedGridWidth = usedColumns * photoWidthPx + (usedColumns - 1) * gapPx;
    const usedGridHeight = usedRows * photoHeightPx + (usedRows - 1) * gapPx;

    const verticals: number[] = [gridX];
    for (let column = 1; column < usedColumns; column += 1) {
      const previousRight = gridX + column * photoWidthPx + (column - 1) * gapPx;
      verticals.push(Math.round(previousRight + gapPx / 2));
    }
    verticals.push(gridX + usedGridWidth);

    const horizontals: number[] = [gridY];
    for (let row = 1; row < usedRows; row += 1) {
      const previousBottom = gridY + row * photoHeightPx + (row - 1) * gapPx;
      horizontals.push(Math.round(previousBottom + gapPx / 2));
    }
    horizontals.push(gridY + usedGridHeight);

    for (const x of verticals) {
      cutLines.push({ x1: x, y1: gridY, x2: x, y2: gridY + usedGridHeight });
    }
    for (const y of horizontals) {
      cutLines.push({ x1: gridX, y1: y, x2: gridX + usedGridWidth, y2: y });
    }
  }

  return {
    sheetWidthPx: sheet.widthPx,
    sheetHeightPx: sheet.heightPx,
    photoWidthPx,
    photoHeightPx,
    marginPx,
    gapPx,
    columns,
    rows,
    capacity,
    count,
    requestedCount,
    gridX,
    gridY,
    gridWidth,
    gridHeight,
    slots,
    cutLines,
  };
}

/**
 * Normalised reference lines for the head.
 *
 * These follow the usual portrait framing convention: the head occupies about
 * seven tenths of the frame, from just below the top edge to about four fifths
 * of the way down, with the eye line slightly above the middle. They are
 * drawing guides, not measured requirements, and the UI labels them as such.
 */
export interface FaceGuide {
  /** Top of the head, as a fraction of the photo height. */
  headTop: number;
  /** Eye line, as a fraction of the photo height. */
  eyeLine: number;
  /** Chin, as a fraction of the photo height. */
  chin: number;
  /** Horizontal centre of the face, as a fraction of the photo width. */
  centerX: number;
}

export const FACE_GUIDE: FaceGuide = {
  headTop: 0.1,
  eyeLine: 0.45,
  chin: 0.8,
  centerX: 0.5,
};

/** The same conventional framing is applied to every size. */
export function faceGuideForSpec(_spec: PhotoSpec): FaceGuide {
  return { ...FACE_GUIDE };
}

/** Height of the head from the top of the head to the chin, as a fraction. */
export function headHeightRatio(guide: FaceGuide = FACE_GUIDE): number {
  return guide.chin - guide.headTop;
}

export interface FaceGuideLine {
  key: string;
  label: string;
  /** Fraction of the photo height, 0 at the top. */
  y: number;
}

export function faceGuideLines(guide: FaceGuide = FACE_GUIDE): FaceGuideLine[] {
  return [
    { key: 'head-top', label: '头顶参考线', y: guide.headTop },
    { key: 'eye-line', label: '眼睛参考线', y: guide.eyeLine },
    { key: 'chin', label: '下巴参考线', y: guide.chin },
  ];
}
