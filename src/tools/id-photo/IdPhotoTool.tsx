import {
  Badge,
  Button,
  Caption1,
  Checkbox,
  Dropdown,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  OptionGroup,
  ProgressBar,
  Slider,
  Tab,
  TabList,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowDownloadRegular,
  ArrowResetRegular,
  ArrowUndoRegular,
  CutRegular,
  EraserRegular,
  ImageAddRegular,
  PaintBrushRegular,
  PersonSquareRegular,
} from '@fluentui/react-icons';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  PHOTO_BACKGROUNDS,
  PHOTO_SPECS,
  SHEET_6IN,
  SPEC_CONFIDENCE_LABEL,
  backgroundStops,
  describeSpec,
  faceGuideForSpec,
  faceGuideLines,
  layoutSheet,
  requireBackground,
  requireSpec,
  type PhotoBackground,
} from './photoSpecs';
import {
  computeAutoFraming,
  framingToTransform,
  measureHead,
} from './framingUtils';
import {
  applyBrushStrokes,
  decontaminateEdges,
  mattePortrait,
  propagateForegroundColors,
  type BrushMode,
  type BrushStroke,
  type MattingResult,
} from './mattingUtils';
import {
  disposeAiMattingSession,
  isAiMattingSupported,
  matteWithAi,
  matteWithFallback,
} from './aiMatting';
import {
  encodeWithinTarget,
  formatFileSize,
  targetBytesFromKb,
  withJpegDensity,
} from './exportUtils';

/** Matting runs at this longest edge; the export target is much smaller. */
/**
 * Longest edge of the image the tool actually works on.
 *
 * This used to be 640, which capped matting quality before the model even ran:
 * a 1378 px portrait was reduced to 640 first, so the finest hair detail was
 * discarded and the model's alpha then had to be stretched back up. Measured on
 * a real portrait, raising it to 1600 keeps the strands the 640 version lost.
 *
 * The cost is memory and time in the classic pipeline (roughly linear in pixel
 * count) and a larger texture for the AI path. 1600 still leaves a 300 dpi
 * two-inch photo with more than 2x headroom, so it is not the export that
 * benefits but the edge quality of the mask.
 */
const MAX_WORK_EDGE = 1600;
const PREVIEW_HEIGHT = 380;
const MAX_STROKES = 400;

const CAPABILITY_NOTE =
  '自动抠图适合背景相对干净的照片（纯色墙、幕布）。复杂背景（杂乱室内、户外）请用画笔手工修整。';
const PRIVACY_NOTE =
  '图片只在你的浏览器内存里处理，不发送到任何服务器。';
const NO_RETOUCH_NOTE = '本工具不做人脸美化、不改变五官。';
const SIZE_DISCLAIMER = '常用规格，具体以受理机构要求为准。';

type PreviewMode = 'background' | 'checker' | 'alpha';

/**
 * `ready` means the AI mask is on screen; `fallback` means the switch is on but
 * the classic algorithm produced the current mask because the model could not
 * be used. Keeping those two apart is what lets the UI explain itself instead
 * of silently changing the output.
 */
type AiModeStatus = 'off' | 'loading' | 'inferencing' | 'ready' | 'fallback';

interface SourceImage {
  name: string;
  bytes: number;
  originalWidth: number;
  originalHeight: number;
  workWidth: number;
  workHeight: number;
  imageData: ImageData;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function paintBackground(
  context: CanvasRenderingContext2D,
  background: PhotoBackground,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const [from, to] = backgroundStops(background);
  if (from === to) {
    context.fillStyle = from;
    context.fillRect(x, y, width, height);
    return;
  }
  const gradient = context.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, from);
  gradient.addColorStop(1, to);
  context.fillStyle = gradient;
  context.fillRect(x, y, width, height);
}

/**
 * Draws the cut-out with a cover fit, then applies the user's zoom and offsets.
 * The same transform is used by the preview, the single export and each sheet
 * slot, so what the user aligns is what gets printed.
 */
function drawCover(
  context: CanvasRenderingContext2D,
  targetWidth: number,
  targetHeight: number,
  image: HTMLCanvasElement,
  zoom: number,
  offsetX: number,
  offsetY: number,
): void {
  const cover =
    Math.max(targetWidth / image.width, targetHeight / image.height) * zoom;
  const drawWidth = image.width * cover;
  const drawHeight = image.height * cover;
  const x = (targetWidth - drawWidth) / 2 + offsetX * targetWidth;
  const y = (targetHeight - drawHeight) / 2 + offsetY * targetHeight;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, x, y, drawWidth, drawHeight);
}

function buildCutout(
  source: SourceImage,
  alpha: Uint8ClampedArray,
): HTMLCanvasElement {
  const canvas = createCanvas(source.workWidth, source.workHeight);
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const pixels = new Uint8ClampedArray(source.imageData.data);
  const limit = Math.min(alpha.length, source.workWidth * source.workHeight);
  // Repair the edge colours before the alpha is applied, in two steps:
  //   1. copy the nearest solid foreground colour outward, because where a pixel
  //      is mostly backdrop there is no foreground colour to un-mix;
  //   2. un-mix the backdrop from the pixels that are genuinely a blend.
  // Skipping either step leaves a rim of the old background, which is visible as
  // a light halo the moment the cutout sits on a coloured ID background.
  propagateForegroundColors(pixels, alpha, source.workWidth, source.workHeight);
  decontaminateEdges(pixels, alpha);
  for (let index = 0; index < limit; index += 1) {
    const alphaOffset = index * 4 + 3;
    pixels[alphaOffset] = Math.round((pixels[alphaOffset] * alpha[index]) / 255);
  }
  context.putImageData(
    new ImageData(pixels, source.workWidth, source.workHeight),
    0,
    0,
  );
  return canvas;
}

/** White subject on black, for the alpha mask view. */
function buildMaskCanvas(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const value = alpha[index];
    const offset = index * 4;
    pixels[offset] = value;
    pixels[offset + 1] = value;
    pixels[offset + 2] = value;
    pixels[offset + 3] = 255;
  }
  context.putImageData(new ImageData(pixels, width, height), 0, 0);
  return canvas;
}

function renderPhotoCanvas(
  width: number,
  height: number,
  cutout: HTMLCanvasElement,
  background: PhotoBackground,
  zoom: number,
  offsetX: number,
  offsetY: number,
): HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法创建 2D 画布。');
  paintBackground(context, background, 0, 0, canvas.width, canvas.height);
  drawCover(context, canvas.width, canvas.height, cutout, zoom, offsetX, offsetY);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('导出失败：画布过大或浏览器不支持 JPEG 编码。'));
      },
      'image/jpeg',
      quality,
    );
  });
}

const useStyles = makeStyles({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    width: '100%',
    minWidth: 0,
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
  },
  spacer: {
    flex: '1 1 auto',
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '14px',
    alignItems: 'start',
    width: '100%',
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    minWidth: 0,
  },
  surfaceBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '14px',
    width: '100%',
    minWidth: 0,
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  notes: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  noteList: {
    margin: 0,
    paddingLeft: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  dropZone: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    padding: '22px 14px',
    textAlign: 'center',
    border: `1px dashed ${tokens.colorNeutralStroke1}`,
    borderRadius: '8px',
    backgroundColor: tokens.colorNeutralBackground2,
    width: '100%',
    boxSizing: 'border-box',
  },
  sourceSummary: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    padding: '10px 12px',
    borderRadius: '8px',
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    boxSizing: 'border-box',
    minWidth: 0,
  },
  sourceMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minWidth: 0,
    flex: '1 1 auto',
  },
  sourceName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  stageFrame: {
    position: 'relative',
    alignSelf: 'center',
    maxWidth: '100%',
    lineHeight: 0,
    borderRadius: '6px',
    overflow: 'hidden',
    backgroundColor: tokens.colorNeutralBackground1,
    backgroundImage:
      'linear-gradient(45deg, var(--colorNeutralBackground3) 25%, transparent 25%, transparent 75%, var(--colorNeutralBackground3) 75%), linear-gradient(45deg, var(--colorNeutralBackground3) 25%, transparent 25%, transparent 75%, var(--colorNeutralBackground3) 75%)',
    backgroundSize: '16px 16px',
    backgroundPosition: '0 0, 8px 8px',
  },
  previewCanvas: {
    display: 'block',
    maxWidth: '100%',
    height: 'auto',
    cursor: 'crosshair',
    touchAction: 'none',
  },
  guideLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTop: `1px dashed ${tokens.colorPaletteRedBorder2}`,
    pointerEvents: 'none',
  },
  guideCenter: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderLeft: `1px dashed ${tokens.colorPaletteRedBorder2}`,
    opacity: 0.7,
    pointerEvents: 'none',
  },
  guideLabel: {
    position: 'absolute',
    left: '4px',
    top: 0,
    transform: 'translateY(-100%)',
    padding: '0 3px',
    borderRadius: '3px',
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground3,
    fontSize: '10px',
    lineHeight: '14px',
    whiteSpace: 'nowrap',
  },
  controls: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    width: '100%',
  },
  aiBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: '100%',
  },
  aiStatus: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    width: '100%',
  },
  controlRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
  },
  controlLabel: {
    color: tokens.colorNeutralForeground3,
    flex: '0 0 92px',
    minWidth: '92px',
  },
  sliderWrap: {
    flex: '1 1 140px',
    minWidth: '120px',
  },
  valueText: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    minWidth: '58px',
    textAlign: 'right',
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
  },
  swatches: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px',
    alignItems: 'center',
  },
  swatch: {
    width: '36px',
    height: '36px',
    padding: 0,
    borderRadius: '50%',
    border: `2px solid ${tokens.colorNeutralStroke1}`,
    cursor: 'pointer',
    outline: 'none',
    boxSizing: 'border-box',
    ':focus-visible': {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: '2px',
    },
  },
  swatchSelected: {
    outline: `2px solid ${tokens.colorStrokeFocus2}`,
    outlineOffset: '2px',
  },
  exportRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
  },
  targetInput: {
    width: '96px',
  },
  inlineNote: {
    color: tokens.colorNeutralForeground3,
  },
});

export function IdPhotoTool() {
  const styles = useStyles();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const paintingRef = useRef(false);
  const lastPaintRef = useRef<{ x: number; y: number } | null>(null);

  const [source, setSource] = useState<SourceImage | null>(null);
  const [specId, setSpecId] = useState(PHOTO_SPECS[0].id);
  const [backgroundId, setBackgroundId] = useState(PHOTO_BACKGROUNDS[0].id);
  const [tolerance, setTolerance] = useState(1);
  const [feather, setFeather] = useState(1);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('checker');
  const [showGuides, setShowGuides] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [brushMode, setBrushMode] = useState<BrushMode>('erase');
  const [brushSize, setBrushSize] = useState(28);
  const [strokes, setStrokes] = useState<BrushStroke[]>([]);
  const [matte, setMatte] = useState<MattingResult | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiModeStatus>('off');

  /**
   * Places the head where an ID photo expects it.
   *
   * Applied automatically after each matte. The default cover framing of a
   * portrait shot at talking distance leaves the head at about 40% of the frame
   * height; at a one-inch output (295 px wide) that throws away most of the
   * detail the source actually has, which reads as a soft photo. The user can
   * still adjust zoom and position afterwards — this only sets a sane start.
   */
  const applyAutoFraming = useCallback(
    (alpha: Uint8ClampedArray, width: number, height: number, aspect: number) => {
      const head = measureHead(alpha, width, height);
      if (!head) return false;
      const frame = computeAutoFraming(head, width, height, aspect);
      const transform = framingToTransform(frame, width, height, 295, 413);
      // Guard against a degenerate mask producing an absurd zoom.
      if (!Number.isFinite(transform.zoom) || transform.zoom <= 0) return false;
      setZoom(Number(Math.min(8, transform.zoom).toFixed(3)));
      setOffsetX(Number((transform.offsetX * 100).toFixed(1)));
      setOffsetY(Number((transform.offsetY * 100).toFixed(1)));
      return true;
    },
    [],
  );

  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState('');
  const [targetKb, setTargetKb] = useState('50');

  const spec = requireSpec(specId);
  const background = requireBackground(backgroundId);
  const guide = faceGuideForSpec(spec);
  const guideLines = faceGuideLines(guide);
  const sheetLayout = useMemo(() => layoutSheet(spec), [spec]);
  const usingAi = aiEnabled && aiStatus === 'ready';
  // The two sliders only steer the classic pipeline. While the AI mask is being
  // prepared or is in use they would do nothing, so they are disabled instead
  // of silently changing a value that the current result ignores.
  const aiControlsLocked =
    aiEnabled &&
    (aiStatus === 'loading' || aiStatus === 'inferencing' || aiStatus === 'ready');

  const loadFile = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      if (!file.type.startsWith('image/')) {
        throw new Error('这不是图片文件，请选择 JPEG、PNG 或 WebP。');
      }
      const bitmap = await createImageBitmap(file);
      const originalWidth = bitmap.width;
      const originalHeight = bitmap.height;
      const scale = Math.min(
        1,
        MAX_WORK_EDGE / Math.max(originalWidth, originalHeight),
      );
      const workWidth = Math.max(1, Math.round(originalWidth * scale));
      const workHeight = Math.max(1, Math.round(originalHeight * scale));
      const canvas = createCanvas(workWidth, workHeight);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器无法创建 2D 画布。');
      context.drawImage(bitmap, 0, 0, workWidth, workHeight);
      const imageData = context.getImageData(0, 0, workWidth, workHeight);
      bitmap.close();
      setSource({
        name: file.name || '粘贴的图片',
        bytes: file.size,
        originalWidth,
        originalHeight,
        workWidth,
        workHeight,
        imageData,
      });
      setStrokes([]);
      setZoom(1);
      setOffsetX(0);
      setOffsetY(0);
      setLastExport('');
    } catch (caught) {
      setSource(null);
      setMatte(null);
      setError(caught instanceof Error ? caught.message : '无法读取该图片。');
    } finally {
      setBusy(false);
    }
  }, []);

  // The image is read from the clipboard, never sent anywhere.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (!item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (!file) continue;
        event.preventDefault();
        void loadFile(file);
        return;
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [loadFile]);

  useEffect(() => {
    if (!source) {
      setMatte(null);
      setAiStatus('off');
      setAiNotice(null);
      return;
    }
    let cancelled = false;
    const image = {
      data: source.imageData.data,
      width: source.workWidth,
      height: source.workHeight,
    };
    const runClassic = () =>
      mattePortrait(image, { tolerance, feather });

    if (!aiEnabled) {
      setMatte(runClassic());
      setAiStatus('off');
      setAiNotice(null);
      return;
    }

    setAiStatus('loading');
    setAiNotice(null);
    // Show the classic mask while the model loads. It keeps the preview
    // coherent when the photo just changed, and it is exactly what the fallback
    // would show, so it is computed once and reused on failure instead of being
    // thrown away.
    const classicResult = runClassic();
    setMatte(classicResult);
    void (async () => {
      try {
        const outcome = await matteWithFallback({
          useAi: true,
          supported: isAiMattingSupported(),
          runClassic: () => classicResult,
          runAi: () =>
            matteWithAi(image, {
              onPhase: (phase) => {
                if (cancelled) return;
                setAiStatus(phase === 'inference' ? 'inferencing' : 'loading');
              },
            }),
        });
        if (cancelled) return;
        setMatte(outcome.result);
        setAiStatus(outcome.usedAi ? 'ready' : 'fallback');
        setAiNotice(outcome.notice);
      } catch (caught) {
        if (cancelled) return;
        // Reaching this branch means even the classic pass threw, which is a
        // real error rather than a reason to fall back silently.
        setMatte(null);
        setAiStatus('fallback');
        setAiNotice(null);
        setError(caught instanceof Error ? caught.message : '抠图失败。');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, tolerance, feather, aiEnabled]);

  // Frame the head automatically the first time a matte appears, and again
  // whenever a new one is produced. Guarded by a ref rather than by dependencies
  // so that a spec change or a manual zoom does not silently undo the user's
  // adjustment.
  const framedMatteRef = useRef<MattingResult | null>(null);
  useEffect(() => {
    if (!source || !matte) return;
    if (framedMatteRef.current === matte) return;
    framedMatteRef.current = matte;
    applyAutoFraming(
      matte.alpha,
      source.workWidth,
      source.workHeight,
      spec.widthPx / spec.heightPx,
    );
  }, [source, matte, spec, applyAutoFraming]);

  // Release the wasm session when the tool is closed. Toggling the switch off
  // keeps it, so turning AI back on does not download the model again.
  useEffect(
    () => () => {
      void disposeAiMattingSession();
    },
    [],
  );

  const alpha = useMemo(() => {
    if (!source || !matte) return null;
    if (strokes.length === 0) return matte.alpha;
    return applyBrushStrokes(
      matte.alpha,
      source.workWidth,
      source.workHeight,
      strokes,
    );
  }, [source, matte, strokes]);

  const cutout = useMemo(
    () => (source && alpha ? buildCutout(source, alpha) : null),
    [source, alpha],
  );

  const maskCanvas = useMemo(
    () =>
      previewMode === 'alpha' && alpha && source
        ? buildMaskCanvas(alpha, source.workWidth, source.workHeight)
        : null,
    [previewMode, alpha, source],
  );

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !source || !cutout) return;
    const width = Math.max(
      120,
      Math.round((PREVIEW_HEIGHT * spec.widthPx) / spec.heightPx),
    );
    const height = PREVIEW_HEIGHT;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);

    if (previewMode === 'alpha') {
      context.fillStyle = '#000000';
      context.fillRect(0, 0, width, height);
      if (maskCanvas) {
        drawCover(
          context,
          width,
          height,
          maskCanvas,
          zoom,
          offsetX / 100,
          offsetY / 100,
        );
      }
      return;
    }

    if (previewMode === 'background') {
      paintBackground(context, background, 0, 0, width, height);
    }
    drawCover(context, width, height, cutout, zoom, offsetX / 100, offsetY / 100);
  }, [
    source,
    cutout,
    maskCanvas,
    previewMode,
    spec,
    background,
    zoom,
    offsetX,
    offsetY,
  ]);

  const paintAt = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = previewRef.current;
      if (!canvas || !source) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const canvasX = ((clientX - rect.left) / rect.width) * canvas.width;
      const canvasY = ((clientY - rect.top) / rect.height) * canvas.height;
      const cover =
        Math.max(canvas.width / source.workWidth, canvas.height / source.workHeight) *
        zoom;
      const drawWidth = source.workWidth * cover;
      const drawHeight = source.workHeight * cover;
      const originX =
        (canvas.width - drawWidth) / 2 + (offsetX / 100) * canvas.width;
      const originY =
        (canvas.height - drawHeight) / 2 + (offsetY / 100) * canvas.height;
      const workX = (canvasX - originX) / cover;
      const workY = (canvasY - originY) / cover;
      if (
        workX < 0 ||
        workY < 0 ||
        workX >= source.workWidth ||
        workY >= source.workHeight
      ) {
        return;
      }

      const cssPerCanvas = canvas.width / rect.width;
      const radius = (brushSize * cssPerCanvas) / cover;
      const point = { x: workX, y: workY };
      const previous = lastPaintRef.current;
      lastPaintRef.current = point;

      setStrokes((current) => {
        if (current.length >= MAX_STROKES) return current;
        const additions: BrushStroke[] = [];
        if (previous) {
          const step = Math.max(1, radius * 0.35);
          const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
          const count = Math.min(10, Math.max(1, Math.ceil(distance / step)));
          for (let index = 1; index <= count; index += 1) {
            additions.push({
              x: previous.x + ((point.x - previous.x) * index) / count,
              y: previous.y + ((point.y - previous.y) * index) / count,
              radius,
              mode: brushMode,
              hardness: 0.5,
            });
          }
        } else {
          additions.push({
            x: point.x,
            y: point.y,
            radius,
            mode: brushMode,
            hardness: 0.5,
          });
        }
        const room = MAX_STROKES - current.length;
        return [...current, ...additions.slice(0, room)];
      });
    },
    [source, zoom, offsetX, offsetY, brushSize, brushMode],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!source || !alpha) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      paintingRef.current = true;
      lastPaintRef.current = null;
      paintAt(event.clientX, event.clientY);
    },
    [source, alpha, paintAt],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!paintingRef.current) return;
      paintAt(event.clientX, event.clientY);
    },
    [paintAt],
  );

  const handlePointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      paintingRef.current = false;
      lastPaintRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [],
  );

  const resetAdjustments = useCallback(() => {
    setStrokes([]);
    setTolerance(1);
    setFeather(1);
    setZoom(1);
    setOffsetX(0);
    setOffsetY(0);
    setBackgroundId(PHOTO_BACKGROUNDS[0].id);
    setLastExport('');
  }, []);

  const download = useCallback(async (blob: Blob, name: string, dpi: number) => {
    // Stamp the print resolution before handing the file to the browser. The
    // encoder leaves it empty, and without it a printing app has no idea how
    // large the photo should be — it falls back to ~72 dpi and prints a 25 mm
    // photo at about 10 cm.
    let out = blob;
    try {
      const patched = withJpegDensity(new Uint8Array(await blob.arrayBuffer()), dpi);
      // `patched` owns a fresh, exactly-sized buffer, but TS 5.7 types
      // `Uint8Array` as `ArrayBufferLike`, which `BlobPart` will not accept.
      out = new Blob([patched.buffer as ArrayBuffer], { type: blob.type || 'image/jpeg' });
    } catch {
      // A failed header patch must not cost the user the export: fall back to
      // the original bytes, which are still a valid JPEG.
      out = blob;
    }
    const url = URL.createObjectURL(out);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const exportSingle = useCallback(async () => {
    if (!source || !cutout) return;
    setBusy(true);
    setError(null);
    try {
      const targetBytes = targetBytesFromKb(targetKb);
      const result = await encodeWithinTarget(
        async (quality, scale) => {
          const width = Math.max(16, Math.round(spec.widthPx * scale));
          const height = Math.max(16, Math.round(spec.heightPx * scale));
          const canvas = renderPhotoCanvas(
            width,
            height,
            cutout,
            background,
            zoom,
            offsetX / 100,
            offsetY / 100,
          );
          const blob = await canvasToBlob(canvas, quality);
          return { blob, width, height };
        },
        (payload) => payload.blob.size,
        { targetBytes },
      );
      await download(
        result.payload.blob,
        `证件照-${spec.name}-${result.payload.width}x${result.payload.height}.jpg`,
        spec.dpi,
      );
      setLastExport(
        `单张：${formatFileSize(result.bytes)}，质量 ${Math.round(result.quality * 100)}%，` +
          `尺寸 ${result.payload.width} × ${result.payload.height} px` +
          (result.achieved
            ? '。'
            : '。未能压到目标大小以内，已给出最小结果。'),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '导出失败。');
    } finally {
      setBusy(false);
    }
  }, [
    source,
    cutout,
    spec,
    background,
    zoom,
    offsetX,
    offsetY,
    targetKb,
    download,
  ]);

  const exportSheet = useCallback(async () => {
    if (!source || !cutout) return;
    setBusy(true);
    setError(null);
    try {
      const layout = layoutSheet(spec);
      if (layout.count === 0) {
        throw new Error('这个规格在 6 寸相纸上排不下（留出边距后空间不足）。');
      }
      const canvas = createCanvas(layout.sheetWidthPx, layout.sheetHeightPx);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器无法创建 2D 画布。');
      context.fillStyle = '#FFFFFF';
      context.fillRect(0, 0, canvas.width, canvas.height);

      for (const slot of layout.slots) {
        context.save();
        context.beginPath();
        context.rect(slot.x, slot.y, slot.width, slot.height);
        context.clip();
        context.translate(slot.x, slot.y);
        paintBackground(context, background, 0, 0, slot.width, slot.height);
        drawCover(
          context,
          slot.width,
          slot.height,
          cutout,
          zoom,
          offsetX / 100,
          offsetY / 100,
        );
        context.restore();
      }

      context.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      context.lineWidth = 1;
      context.setLineDash([6, 4]);
      for (const line of layout.cutLines) {
        context.beginPath();
        context.moveTo(line.x1, line.y1);
        context.lineTo(line.x2, line.y2);
        context.stroke();
      }
      context.setLineDash([]);

      const blob = await canvasToBlob(canvas, 0.92);
      await download(
        blob,
        `证件照-${spec.name}-6寸拼版-${layout.count}张.jpg`,
        spec.dpi,
      );
      setLastExport(
        `拼版：${layout.count} 张（${layout.columns} 列 × ${layout.rows} 行），` +
          `相纸 ${layout.sheetWidthPx} × ${layout.sheetHeightPx} px，` +
          `${formatFileSize(blob.size)}。`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '导出失败。');
    } finally {
      setBusy(false);
    }
  }, [source, cutout, spec, background, zoom, offsetX, offsetY, download]);

  const confidenceColor: 'success' | 'warning' | 'danger' =
    spec.confidence === 'verified'
      ? 'success'
      : spec.confidence === 'common'
        ? 'warning'
        : 'danger';

  const groups = useMemo(
    () => ({
      verified: PHOTO_SPECS.filter((item) => item.confidence === 'verified'),
      common: PHOTO_SPECS.filter((item) => item.confidence === 'common'),
      disputed: PHOTO_SPECS.filter((item) => item.confidence === 'disputed'),
    }),
    [],
  );

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void loadFile(file);
          event.target.value = '';
        }}
      />

      <div className={styles.page}>
        <div className={styles.toolbar}>
          <Button
            appearance="primary"
            icon={<ImageAddRegular />}
            onClick={() => fileInputRef.current?.click()}
          >
            选择图片
          </Button>
          {source && (
            <>
              <Badge appearance="tint" color="brand">
                {source.name}
              </Badge>
              <Caption1 className={styles.hint}>
                {source.originalWidth} × {source.originalHeight} px ·{' '}
                {formatFileSize(source.bytes)}
              </Caption1>
            </>
          )}
          <span className={styles.spacer} />
          {busy && <Caption1 className={styles.hint}>处理中…</Caption1>}
          <Button
            appearance="subtle"
            icon={<PersonSquareRegular />}
            onClick={() => {
              if (!alpha || !source) return;
              applyAutoFraming(
                alpha,
                source.workWidth,
                source.workHeight,
                spec.widthPx / spec.heightPx,
              );
            }}
            disabled={!source || !alpha}
          >
            自动构图
          </Button>
          <Button
            appearance="secondary"
            icon={<ArrowResetRegular />}
            onClick={resetAdjustments}
            disabled={!source}
          >
            重置调整
          </Button>
        </div>

        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>能力边界与隐私</MessageBarTitle>
            <div className={styles.notes}>
              <span>{CAPABILITY_NOTE}</span>
              <span>{PRIVACY_NOTE}</span>
              <span>{NO_RETOUCH_NOTE}</span>
              <span>{SIZE_DISCLAIMER}</span>
            </div>
          </MessageBarBody>
        </MessageBar>

        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}

        <div className={styles.layout}>
          <div className={styles.column}>
            <section className="wt-surface" aria-label="图片输入">
              <div className="wt-surface__header">
                <Text as="h2" size={300} weight="semibold">
                  图片
                </Text>
              </div>
              <div
                className="wt-surface__body"
                style={{ flexDirection: 'column' }}
              >
                <div className={styles.surfaceBody}>
                  {source ? (
                    <div className={styles.sourceSummary}>
                      <PersonSquareRegular />
                      <div className={styles.sourceMeta}>
                        <Text weight="semibold" className={styles.sourceName}>
                          {source.name}
                        </Text>
                        <Caption1 className={styles.hint}>
                          原始 {source.originalWidth} × {source.originalHeight} px，
                          抠图按最长边 {MAX_WORK_EDGE} px 计算
                        </Caption1>
                      </div>
                      <Button
                        appearance="secondary"
                        size="small"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        更换
                      </Button>
                    </div>
                  ) : (
                    <div
                      className={styles.dropZone}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const file = event.dataTransfer.files?.[0];
                        if (file) void loadFile(file);
                      }}
                    >
                      <PersonSquareRegular
                        style={{ fontSize: '32px', color: 'var(--colorNeutralForeground3)' }}
                      />
                      <Text weight="semibold">选择或拖入一张人像照片</Text>
                      <Caption1 className={styles.hint}>
                        支持 JPEG / PNG / WebP；也可以直接按 Ctrl + V 粘贴。
                      </Caption1>
                      <Button
                        appearance="primary"
                        icon={<ImageAddRegular />}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        选择图片
                      </Button>
                    </div>
                  )}
                  {source && (
                    <Caption1 className={styles.hint}>
                      想换一张？把图片拖到这里，或按 Ctrl + V 粘贴即可。
                    </Caption1>
                  )}
                </div>
              </div>
            </section>

            <section className="wt-surface" aria-label="使用提示">
              <div className="wt-surface__header">
                <Text as="h2" size={300} weight="semibold">
                  使用提示
                </Text>
              </div>
              <div
                className="wt-surface__body"
                style={{ flexDirection: 'column' }}
              >
                <div className={styles.surfaceBody}>
                  <ul className={styles.noteList}>
                    <li>
                      <Caption1 className={styles.hint}>
                        背景越干净越省事：纯色墙、幕布、阴影少的室内墙面效果最好。
                      </Caption1>
                    </li>
                    <li>
                      <Caption1 className={styles.hint}>
                        头发边缘、半透明衣物、与背景同色的衣服是传统算法的难点；
                        复杂背景可以打开 AI 抠图，仍有残留时用「恢复」画笔补回来。
                      </Caption1>
                    </li>
                    <li>
                      <Caption1 className={styles.hint}>
                        参考线和常见规格都只是辅助，头部比例、背景色、文件大小
                        最终以受理机构的要求为准。
                      </Caption1>
                    </li>
                    <li>
                      <Caption1 className={styles.hint}>
                        导出的 JPEG 已写入 <strong>{spec.dpi} dpi</strong> 的打印分辨率，
                        打印对话框里应显示对应物理尺寸（{spec.widthMm} × {spec.heightMm} mm）；
                        仍要选「实际大小 / 100%」，不要选「适应纸张」。
                      </Caption1>
                    </li>
                  </ul>
                </div>
              </div>
            </section>
          </div>

          <div className={styles.column}>
            <section className="wt-surface" aria-label="抠图预览">
              <div className="wt-surface__header">
                <Text as="h2" size={300} weight="semibold">
                  抠图预览
                </Text>
                <span className={styles.spacer} />
                <TabList
                  size="small"
                  selectedValue={previewMode}
                  onTabSelect={(_, data) =>
                    setPreviewMode(data.value as PreviewMode)
                  }
                >
                  <Tab value="background">背景色</Tab>
                  <Tab value="checker">透明</Tab>
                  <Tab value="alpha">蒙版</Tab>
                </TabList>
              </div>
              <div
                className="wt-surface__body"
                style={{ flexDirection: 'column' }}
              >
                <div className={styles.surfaceBody}>
                  {source && cutout ? (
                    <>
                      <div className={styles.stageFrame}>
                        <canvas
                          ref={previewRef}
                          className={styles.previewCanvas}
                          aria-label="证件照抠图预览，可用画笔涂抹修整"
                          onPointerDown={handlePointerDown}
                          onPointerMove={handlePointerMove}
                          onPointerUp={handlePointerEnd}
                          onPointerCancel={handlePointerEnd}
                        />
                        {showGuides && (
                          <>
                            <div
                              className={styles.guideCenter}
                              style={{ left: `${guide.centerX * 100}%` }}
                            />
                            {guideLines.map((line) => (
                              <div
                                key={line.key}
                                className={styles.guideLine}
                                style={{ top: `${line.y * 100}%` }}
                              >
                                <span className={styles.guideLabel}>
                                  {line.label}
                                </span>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                      <Caption1 className={styles.hint}>
                        棋盘格表示透明区域；切到「蒙版」可以看黑白的 alpha 结果。
                        在预览上涂抹即可修整，画笔大小以屏幕像素为准。
                      </Caption1>
                      {matte && (
                        <Caption1 className={styles.mono}>
                          {usingAi ? (
                            <>
                              MODNet 本地模型 · 前景{' '}
                              {Math.round(matte.stats.foregroundRatio * 100)}% ·
                              可用画笔继续修整
                            </>
                          ) : (
                            <>
                              背景簇 {matte.stats.clusters} · 阈值{' '}
                              {matte.stats.lowThreshold.toFixed(1)} –{' '}
                              {matte.stats.highThreshold.toFixed(1)} · 前景{' '}
                              {Math.round(matte.stats.foregroundRatio * 100)}%
                            </>
                          )}
                        </Caption1>
                      )}
                      {matte && !matte.stats.subjectFound && (
                        <MessageBar intent="warning">
                          <MessageBarBody>
                            {usingAi ? (
                              <>
                                本地 AI 模型没有在这个画面里找到明确的人像：
                                可能是纯背景图，或者人物离镜头太远。可以换一张照片，
                                或者直接用「恢复」画笔手工补出人物。
                              </>
                            ) : (
                              <>
                                没有检测到明确的主体：画面可能整张都是背景，或者
                                主体和背景的颜色太接近。可以调大容差、换一张照片，
                                或者直接用「恢复」画笔手工补出人物。
                              </>
                            )}
                          </MessageBarBody>
                        </MessageBar>
                      )}
                    </>
                  ) : (
                    <div className="wt-empty">
                      <PersonSquareRegular />
                      <Text weight="semibold">还没有照片</Text>
                      <Caption1>
                        在左侧选择或拖入图片，也可以按 Ctrl + V 粘贴。
                      </Caption1>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="wt-surface" aria-label="修整工具">
              <div className="wt-surface__header">
                <Text as="h2" size={300} weight="semibold">
                  修整工具
                </Text>
              </div>
              <div
                className="wt-surface__body"
                style={{ flexDirection: 'column' }}
              >
                <div className={styles.surfaceBody}>
                  <div className={styles.controls}>
                    <div className={styles.aiBlock}>
                      <Checkbox
                        checked={aiEnabled}
                        label="AI 抠图（本地模型，首次约 12 MB）"
                        aria-label="AI 抠图（本地模型）"
                        onChange={(_event, data) =>
                          setAiEnabled(data.checked === true)
                        }
                      />
                      <Caption1 className={styles.hint}>
                        使用 MODNet 模型在浏览器内完成推理。模型下载后由浏览器缓存；
                        推理全部在本机完成，图片不会离开这台设备。
                        复杂背景与发丝边缘的效果明显好于本地算法。
                      </Caption1>
                      {aiEnabled &&
                        (aiStatus === 'loading' ||
                          aiStatus === 'inferencing') && (
                          <div className={styles.aiStatus}>
                            <ProgressBar />
                            <Caption1 className={styles.hint}>
                              {aiStatus === 'loading'
                                ? '正在准备 AI 模型（约 12 MB，首次较慢，下载后由浏览器缓存）…'
                                : 'AI 正在本机推理…'}
                            </Caption1>
                          </div>
                        )}
                      {usingAi && (
                        <Caption1 className={styles.hint}>
                          AI 抠图已生效；下面的画笔仍可擦除或恢复，导出流程与本地算法完全相同。
                        </Caption1>
                      )}
                      {aiEnabled && aiStatus === 'fallback' && aiNotice && (
                        <MessageBar intent="warning">
                          <MessageBarBody>{aiNotice}</MessageBarBody>
                        </MessageBar>
                      )}
                    </div>

                    <div className={styles.controlRow}>
                      <Caption1 className={styles.controlLabel}>
                        容差 ×{tolerance.toFixed(2)}
                      </Caption1>
                      <div className={styles.sliderWrap}>
                        <Slider
                          min={50}
                          max={200}
                          step={5}
                          value={Math.round(tolerance * 100)}
                          onChange={(_, data) => setTolerance(data.value / 100)}
                          aria-label="容差，数值越大越多颜色被当作背景"
                          disabled={!source || aiControlsLocked}
                        />
                      </div>
                      <Caption1 className={styles.hint}>
                        {usingAi ? 'AI 模式下由模型决定' : '调大＝背景判定更宽松'}
                      </Caption1>
                    </div>

                    <div className={styles.controlRow}>
                      <Caption1 className={styles.controlLabel}>
                        边缘羽化 {feather} px
                      </Caption1>
                      <div className={styles.sliderWrap}>
                        <Slider
                          min={0}
                          max={4}
                          step={1}
                          value={feather}
                          onChange={(_, data) => setFeather(data.value)}
                          aria-label="边缘羽化半径（像素）"
                          disabled={!source || aiControlsLocked}
                        />
                      </div>
                      <Caption1 className={styles.hint}>
                        {usingAi ? 'AI 模式下由模型决定' : '让边缘过渡更柔和'}
                      </Caption1>
                    </div>

                    <div className={styles.controlRow}>
                      <Caption1 className={styles.controlLabel}>画笔模式</Caption1>
                      <Button
                        size="small"
                        appearance={brushMode === 'erase' ? 'primary' : 'secondary'}
                        icon={<EraserRegular />}
                        onClick={() => setBrushMode('erase')}
                      >
                        擦除
                      </Button>
                      <Button
                        size="small"
                        appearance={brushMode === 'restore' ? 'primary' : 'secondary'}
                        icon={<PaintBrushRegular />}
                        onClick={() => setBrushMode('restore')}
                      >
                        恢复
                      </Button>
                      <Caption1 className={styles.hint}>
                        擦除＝涂成透明，恢复＝补回前景
                      </Caption1>
                    </div>

                    <div className={styles.controlRow}>
                      <Caption1 className={styles.controlLabel}>
                        画笔大小 {brushSize} px
                      </Caption1>
                      <div className={styles.sliderWrap}>
                        <Slider
                          min={6}
                          max={80}
                          step={2}
                          value={brushSize}
                          onChange={(_, data) => setBrushSize(data.value)}
                          aria-label="画笔大小（屏幕像素）"
                          disabled={!source}
                        />
                      </div>
                    </div>

                    <div className={styles.controlRow}>
                      <Button
                        size="small"
                        icon={<ArrowUndoRegular />}
                        onClick={() => setStrokes((current) => current.slice(0, -1))}
                        disabled={strokes.length === 0}
                      >
                        撤销一笔
                      </Button>
                      <Button
                        size="small"
                        icon={<ArrowResetRegular />}
                        onClick={() => setStrokes([])}
                        disabled={strokes.length === 0}
                      >
                        清除画笔痕迹
                      </Button>
                      <Caption1 className={styles.hint}>
                        已记录 {strokes.length} 笔（上限 {MAX_STROKES}）
                      </Caption1>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className={styles.column}>
            <section className="wt-surface" aria-label="规格与背景">
              <div className="wt-surface__header">
                <Text as="h2" size={300} weight="semibold">
                  规格与背景
                </Text>
              </div>
              <div
                className="wt-surface__body"
                style={{ flexDirection: 'column' }}
              >
                <div className={styles.surfaceBody}>
                  <div className={styles.controlRow}>
                    <Caption1 className={styles.controlLabel}>规格</Caption1>
                    <Dropdown
                      style={{ flex: '1 1 180px', minWidth: 0 }}
                      value={`${spec.name} · ${spec.widthMm} × ${spec.heightMm} mm`}
                      selectedOptions={[spec.id]}
                      onOptionSelect={(_, data) => {
                        if (data.optionValue) setSpecId(data.optionValue);
                      }}
                      aria-label="证件照规格"
                    >
                      {groups.verified.length > 0 && (
                        <OptionGroup label={SPEC_CONFIDENCE_LABEL.verified}>
                          {groups.verified.map((item) => (
                            <Option
                              key={item.id}
                              value={item.id}
                              text={`${item.name} · ${item.widthMm} × ${item.heightMm} mm`}
                            >
                              {item.name} · {item.widthMm} × {item.heightMm} mm
                            </Option>
                          ))}
                        </OptionGroup>
                      )}
                      {groups.common.length > 0 && (
                        <OptionGroup label={SPEC_CONFIDENCE_LABEL.common}>
                          {groups.common.map((item) => (
                            <Option
                              key={item.id}
                              value={item.id}
                              text={`${item.name} · ${item.widthMm} × ${item.heightMm} mm`}
                            >
                              {item.name} · {item.widthMm} × {item.heightMm} mm
                            </Option>
                          ))}
                        </OptionGroup>
                      )}
                      {groups.disputed.length > 0 && (
                        <OptionGroup label={SPEC_CONFIDENCE_LABEL.disputed}>
                          {groups.disputed.map((item) => (
                            <Option
                              key={item.id}
                              value={item.id}
                              text={`${item.name} · 尺寸不确定`}
                            >
                              {item.name} · 尺寸不确定
                            </Option>
                          ))}
                        </OptionGroup>
                      )}
                    </Dropdown>
                  </div>

                  <Caption1 className={styles.mono}>
                    {describeSpec(spec)}
                  </Caption1>

                  <div className={styles.controlRow}>
                    <Badge appearance="tint" color={confidenceColor} size="small">
                      {SPEC_CONFIDENCE_LABEL[spec.confidence]}
                    </Badge>
                    <Caption1 className={styles.hint}>
                      像素宽高按 毫米 × DPI ÷ 25.4 取整
                    </Caption1>
                  </div>

                  {spec.note && (
                    <Caption1 className={styles.hint}>{spec.note}</Caption1>
                  )}

                  {spec.confidence === 'disputed' && (
                    <MessageBar intent="warning">
                      <MessageBarBody>
                        <MessageBarTitle>这个规格的尺寸不确定</MessageBarTitle>
                        不同来源对驾驶证照片尺寸说法不一致，本工具暂按当前
                        数值显示，不等于受理机构的要求。请先向受理机构确认，
                        再决定是否使用。
                      </MessageBarBody>
                    </MessageBar>
                  )}

                  <div className={styles.controlRow}>
                    <Caption1 className={styles.controlLabel}>背景色</Caption1>
                    <div className={styles.swatches}>
                      {PHOTO_BACKGROUNDS.map((item) => {
                        const selected = item.id === backgroundId;
                        const gradient =
                          item.gradientFrom && item.gradientTo
                            ? `linear-gradient(135deg, ${item.gradientFrom}, ${item.gradientTo})`
                            : item.hex;
                        return (
                          <Tooltip
                            key={item.id}
                            content={item.name}
                            relationship="label"
                            withArrow
                          >
                            <button
                              type="button"
                              className={`${styles.swatch} ${selected ? styles.swatchSelected : ''}`}
                              style={{ background: gradient }}
                              onClick={() => {
                                setBackgroundId(item.id);
                                setPreviewMode('background');
                              }}
                              aria-label={`背景色：${item.name}`}
                              aria-pressed={selected}
                            />
                          </Tooltip>
                        );
                      })}
                    </div>
                  </div>

                  <div className={styles.controls}>
                    <div className={styles.controlRow}>
                      <Caption1 className={styles.controlLabel}>缩放</Caption1>
                      <div className={styles.sliderWrap}>
                        <Slider
                          min={50}
                          max={200}
                          step={1}
                          value={Math.round(zoom * 100)}
                          onChange={(_, data) => setZoom(data.value / 100)}
                          aria-label="缩放比例（百分比）"
                          disabled={!source}
                        />
                      </div>
                      <Caption1 className={styles.valueText}>
                        {Math.round(zoom * 100)}%
                      </Caption1>
                    </div>

                    <div className={styles.controlRow}>
                      <Caption1 className={styles.controlLabel}>水平位置</Caption1>
                      <div className={styles.sliderWrap}>
                        <Slider
                          min={-30}
                          max={30}
                          step={1}
                          value={offsetX}
                          onChange={(_, data) => setOffsetX(data.value)}
                          aria-label="水平位置偏移（百分比）"
                          disabled={!source}
                        />
                      </div>
                      <Caption1 className={styles.valueText}>{offsetX}%</Caption1>
                    </div>

                    <div className={styles.controlRow}>
                      <Caption1 className={styles.controlLabel}>垂直位置</Caption1>
                      <div className={styles.sliderWrap}>
                        <Slider
                          min={-30}
                          max={30}
                          step={1}
                          value={offsetY}
                          onChange={(_, data) => setOffsetY(data.value)}
                          aria-label="垂直位置偏移（百分比）"
                          disabled={!source}
                        />
                      </div>
                      <Caption1 className={styles.valueText}>{offsetY}%</Caption1>
                    </div>
                  </div>

                  <Checkbox
                    checked={showGuides}
                    label="显示人脸参考线（头顶、眼睛、下巴）"
                    aria-label="显示人脸参考线"
                    onChange={(_event, data) => setShowGuides(data.checked === true)}
                  />
                  <Caption1 className={styles.hint}>
                    参考线只是绘制辅助：默认头顶约在 10% 高度、眼睛约 45%、
                    下巴约 80%，不代表任何机构的硬性规定。
                  </Caption1>
                </div>
              </div>
            </section>
          </div>
        </div>

        <section className="wt-surface" aria-label="导出">
          <div className="wt-surface__header">
            <Text as="h2" size={300} weight="semibold">
              导出
            </Text>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.surfaceBody}>
              <div className={styles.exportRow}>
                <Caption1 className={styles.controlLabel}>
                  目标文件大小
                </Caption1>
                <input
                  className="wt-inline-input"
                  style={{ width: 96 }}
                  type="number"
                  min={5}
                  max={5000}
                  step={5}
                  value={targetKb}
                  onChange={(event) => setTargetKb(event.target.value)}
                  aria-label="目标文件大小（KB）"
                />
                <Caption1 className={styles.hint}>KB</Caption1>
                {[20, 50, 100, 200].map((preset) => (
                  <Button
                    key={preset}
                    size="small"
                    appearance={targetKb === String(preset) ? 'primary' : 'secondary'}
                    onClick={() => setTargetKb(String(preset))}
                  >
                    {preset} KB
                  </Button>
                ))}
              </div>

              <div className={styles.exportRow}>
                <Button
                  appearance="primary"
                  icon={<ArrowDownloadRegular />}
                  onClick={() => void exportSingle()}
                  disabled={!source || !cutout || busy}
                >
                  导出单张 JPEG
                </Button>
                <Button
                  appearance="secondary"
                  icon={<CutRegular />}
                  onClick={() => void exportSheet()}
                  disabled={!source || !cutout || busy}
                >
                  导出 6 寸拼版
                </Button>
                <Caption1 className={styles.hint}>
                  6 寸相纸可排 {sheetLayout.count} 张（{sheetLayout.columns} 列 ×{' '}
                  {sheetLayout.rows} 行）
                </Caption1>
              </div>

              <Caption1 className={styles.mono}>
                {SHEET_6IN.name} · 相纸 {sheetLayout.sheetWidthPx} ×{' '}
                {sheetLayout.sheetHeightPx} px · 单张 {spec.widthPx} ×{' '}
                {spec.heightPx} px · 边距 {sheetLayout.marginPx} px · 间距{' '}
                {sheetLayout.gapPx} px
              </Caption1>

              {lastExport && (
                <MessageBar intent="success">
                  <MessageBarBody>{lastExport}</MessageBarBody>
                </MessageBar>
              )}

              <Caption1 className={styles.hint}>
                单张导出会在不超过目标大小的前提下自动降低 JPEG 质量；质量降到
                下限仍超出时，会再缩小像素尺寸。拼版按打印用途以较高质量导出，
                不受目标大小限制。
              </Caption1>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
