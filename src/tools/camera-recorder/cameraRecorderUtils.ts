/**
 * Camera recorder arithmetic and formatting.
 *
 * Everything the recorder can get wrong without touching a browser API lives
 * here: the elapsed-time clock, the remaining-time calculation, file naming,
 * byte formatting and MIME selection. `getUserMedia` and `MediaRecorder` stay in
 * the component, because they cannot be called in Node and therefore cannot be
 * checked; keeping them out means the part that *is* checked has no untested
 * dependencies hiding inside it.
 *
 * ## Why the elapsed clock is anchored rather than accumulated
 *
 * A recorder that adds a nominal 100 ms per `setInterval` tick drifts: timers
 * fire late, and a background tab throttles them to once a second or worse. The
 * displayed elapsed time would then disagree with the actual recording length,
 * which is the one number a user relies on to decide when to stop. Anchoring to
 * a monotonic timestamp — `performance.now()`, supplied by the caller — makes
 * the reading a subtraction, so a late or missed tick changes only how often the
 * number is redrawn.
 */

/** Tracks elapsed recording time without accumulating timer ticks. */
export interface RecorderClock {
  /** Milliseconds accumulated in previous running segments. */
  baseMs: number;
  /** Timestamp the current segment started, or null while paused. */
  anchor: number | null;
}

export function createClock(): RecorderClock {
  return { baseMs: 0, anchor: null };
}

export function clockIsRunning(clock: RecorderClock): boolean {
  return clock.anchor !== null;
}

/** Starts or resumes. Calling it while running is a no-op, not a restart. */
export function clockStart(clock: RecorderClock, now: number): RecorderClock {
  if (clock.anchor !== null) return clock;
  return { baseMs: clock.baseMs, anchor: now };
}

/** Pauses, folding the current segment into `baseMs`. */
export function clockPause(clock: RecorderClock, now: number): RecorderClock {
  if (clock.anchor === null) return clock;
  return { baseMs: clockElapsed(clock, now), anchor: null };
}

/**
 * Elapsed time at `now`.
 *
 * Clamped at zero: a caller that passes a timestamp from before the anchor — a
 * restored clock, or a monotonic reading that wrapped — must not produce a
 * negative duration.
 */
export function clockElapsed(clock: RecorderClock, now: number): number {
  if (clock.anchor === null) return clock.baseMs;
  return clock.baseMs + Math.max(0, now - clock.anchor);
}

/** Resets to zero and stops. */
export function clockReset(): RecorderClock {
  return createClock();
}

/**
 * Formats a duration as `MM:SS`, gaining an hours field only when needed.
 *
 * Two digits are kept in the minutes field even past 99 minutes, so the
 * display only changes width once — when the hour appears — rather than on
 * every ten-minute boundary.
 */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Parses `SS`, `MM:SS` or `HH:MM:SS` into milliseconds.
 *
 * Returns null rather than a best guess for anything malformed, because the
 * value feeds a recording limit: silently turning `1:60` into 120 seconds would
 * record for longer than the user asked for.
 *
 * A single number is read as seconds, which is what someone typing "90" into a
 * duration field means.
 */
export function parseDurationText(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  const parts = trimmed.split(':');
  if (parts.length > 3) return null;

  const groups: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,7}$/.test(part)) return null;
    groups.push(Number(part));
  }

  // The seconds field, and the minutes field of an HH:MM:SS value, must be a
  // real clock field. The hours field is free to exceed 23.
  if (groups.length >= 2 && groups[groups.length - 1] >= 60) return null;
  if (groups.length === 3 && groups[1] >= 60) return null;

  let seconds: number;
  if (groups.length === 1) seconds = groups[0];
  else if (groups.length === 2) seconds = groups[0] * 60 + groups[1];
  else seconds = groups[0] * 3600 + groups[1] * 60 + groups[2];

  const ms = seconds * 1000;
  return Number.isSafeInteger(ms) ? ms : null;
}

/**
 * Reads the limit field.
 *
 * An empty field means "no limit" rather than zero, which is what an empty box
 * reads as to a person. `ok: false` means the text could not be understood at
 * all, and the caller should keep the previous limit instead of guessing.
 */
export function limitMsFromText(text: string): { ok: true; limitMs: number | null } | { ok: false } {
  if (text.trim() === '') return { ok: true, limitMs: null };
  const parsed = parseDurationText(text);
  if (parsed === null) return { ok: false };
  return { ok: true, limitMs: parsed === 0 ? null : parsed };
}

/**
 * Time left before the limit stops the recording, or null when unlimited.
 *
 * A limit of zero or less is treated as "no limit": a zero-second cap would
 * otherwise start and immediately stop every recording.
 */
export function remainingMs(limitMs: number | null, elapsedMs: number): number | null {
  if (limitMs === null || !Number.isFinite(limitMs) || limitMs <= 0) return null;
  return Math.max(0, limitMs - Math.max(0, elapsedMs));
}

/** Whether the limit has been reached. Unlimited never auto-stops. */
export function shouldAutoStop(limitMs: number | null, elapsedMs: number): boolean {
  const remaining = remainingMs(limitMs, elapsedMs);
  return remaining !== null && remaining <= 0;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * `Intl.NumberFormat` is used rather than `toFixed` so the separator and the
 * rounding follow the platform's own rules; `scripts/check-camera-recorder.mjs`
 * cross-checks the result against a `Math.round` computation, which is a
 * genuinely different code path.
 */
const BYTE_NUMBER_FORMAT = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  // No thousands separators: this is a compact status label, and the check
  // script compares it against plain arithmetic.
  useGrouping: false,
});

/** Formats a byte count with binary units (1 KB = 1024 B). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  let unit = 0;
  while (unit < BYTE_UNITS.length - 1 && bytes >= 1024 ** (unit + 1)) unit += 1;

  const value = bytes / 1024 ** unit;
  if (unit === 0) return `${Math.round(value)} B`;
  return `${BYTE_NUMBER_FORMAT.format(value)} ${BYTE_UNITS[unit]}`;
}

/**
 * Codec candidates in preference order.
 *
 * VP9 first because it is the better codec where it exists, then VP8, then the
 * plain container, then H.264 in MP4 for Safari — which does not produce WebM
 * and only records MP4 in recent versions. The order is a preference, not a
 * claim; the browser is asked about each one in turn.
 */
export const MIME_CANDIDATES: readonly string[] = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
];

/**
 * Picks the first supported MIME type, or an empty string when none is.
 *
 * The empty string is the important return value: passing an unsupported
 * `mimeType` to the `MediaRecorder` constructor throws `NotSupportedError`, so
 * "I could not confirm any of these" must become "let the browser choose its
 * own default" rather than a guess.
 */
export function chooseMimeType(isSupported: (mime: string) => boolean): string {
  for (const candidate of MIME_CANDIDATES) {
    try {
      if (isSupported(candidate)) return candidate;
    } catch {
      // A predicate that throws counts as "not supported" for that candidate.
    }
  }
  return '';
}

/**
 * Whether a candidate is worth offering for the requested audio setting.
 *
 * A silent recording must not ask for Opus: some implementations treat a codec
 * that has no matching track as an unsatisfiable constraint. This is separate
 * from `chooseMimeType` so the filter itself is testable.
 */
export function isMimeAllowedFor(mime: string, withAudio: boolean): boolean {
  if (withAudio) return true;
  return !/opus/i.test(mime);
}

/** File extension for a recorded MIME type, defaulting to `webm`. */export function extensionForMime(mime: string): string {
  const base = mime.split(';')[0].trim().toLowerCase();
  if (base === 'video/webm' || base === 'audio/webm') return 'webm';
  if (base === 'video/mp4' || base === 'audio/mp4') return 'mp4';
  if (base === 'video/x-matroska' || base === 'audio/x-matroska') return 'mkv';
  if (base === 'video/ogg' || base === 'audio/ogg') return 'ogv';
  // Unknown or absent type: WebM is what Chromium and Firefox produce by
  // default, and a slightly wrong extension is better than no file at all.
  return 'webm';
}

/** Strips characters that are illegal or awkward in a file name. */
export function sanitizeFileNamePart(text: string, fallback = 'recording'): string {
  const cleaned = text
    // Reserved on Windows and/or used as separators, plus control characters.
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^[.\-\s]+/, '')
    .replace(/[.\-\s]+$/, '')
    .slice(0, 60);
  return cleaned === '' ? fallback : cleaned;
}

/**
 * Builds a download file name.
 *
 * The timestamp is rendered in ISO form with the colons and dots replaced,
 * because a colon cannot appear in a Windows file name and a name that silently
 * fails to save is worse than an uglier one. An unusable timestamp becomes
 * `unknown-time` rather than throwing out of `new Date(...).toISOString()`.
 */
export function buildFileName(prefix: string, timestamp: number, extension: string): string {
  const safePrefix = sanitizeFileNamePart(prefix, 'recording');
  const safeExtension = /^[a-z0-9]{1,8}$/.test(extension) ? extension : 'webm';
  const stamp = Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString().replace(/[:.]/g, '-')
    : 'unknown-time';
  return `${safePrefix}-${stamp}.${safeExtension}`;
}

/** Whether the permission and API situation allows recording at all. */
export type ContextStatus = 'ok' | 'insecure' | 'unsupported';

/**
 * Classifies the page's ability to reach the camera.
 *
 * The secure-context test comes first on purpose. On plain `http://` (anything
 * other than localhost) Chromium leaves `navigator.mediaDevices` undefined, so
 * checking the API first would report "your browser does not support this"
 * when the real, fixable cause is the transport.
 */
export function describeContextStatus(
  isSecureContext: boolean,
  hasMediaDevices: boolean,
): ContextStatus {
  if (!isSecureContext) return 'insecure';
  if (!hasMediaDevices) return 'unsupported';
  return 'ok';
}

export type MediaErrorKind =
  | 'denied'
  | 'not-found'
  | 'busy'
  | 'constraints'
  | 'insecure'
  | 'unsupported'
  | 'unknown';

export interface MediaErrorExplanation {
  kind: MediaErrorKind;
  title: string;
  detail: string;
  retry: string;
}

/**
 * Turns a `getUserMedia` failure into something a person can act on.
 *
 * `DOMException.name` is the only stable part across browsers; the message is
 * browser-specific and sometimes empty, so it is used as supporting text only.
 */
export function explainMediaError(name: string, message: string): MediaErrorExplanation {
  const suffix = message.trim() === '' ? '' : `（浏览器原文：${message.trim()}）`;

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return {
        kind: 'denied',
        title: '权限被拒绝',
        detail:
          '浏览器或系统拒绝了摄像头/麦克风权限。授权提示通常只出现一次，被拒绝后需要手动恢复。' + suffix,
        retry:
          '点击地址栏左侧的权限图标（或站点的“网站设置”），把摄像头和麦克风改为“允许”，然后回到本页重新点击“开启预览”。',
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return {
        kind: 'not-found',
        title: '没有找到设备',
        detail: '系统没有报告可用的摄像头或麦克风，设备可能未连接、被禁用，或已被虚拟机/远程桌面隐藏。' + suffix,
        retry: '接入设备后重新点击“刷新设备”，再点击“开启预览”。',
      };
    case 'NotReadableError':
    case 'TrackStartError':
      return {
        kind: 'busy',
        title: '设备被占用或无法读取',
        detail: '另一个程序或标签页正在使用摄像头，或操作系统拒绝了这次访问。' + suffix,
        retry: '关闭其它正在使用摄像头的程序与标签页，然后重新点击“开启预览”。',
      };
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return {
        kind: 'constraints',
        title: '所选分辨率或设备不可用',
        detail: '摄像头不支持所选的分辨率，或所选设备已经不在列表中。' + suffix,
        retry: '换一个较低的分辨率，或点击“刷新设备”后重新选择设备。',
      };
    case 'SecurityError':
      return {
        kind: 'insecure',
        title: '安全上下文要求未满足',
        detail: '浏览器只在 HTTPS 或 localhost 下提供摄像头访问。' + suffix,
        retry: '通过 https:// 或 http://localhost 打开本页后重试。',
      };
    case 'TypeError':
      return {
        kind: 'unsupported',
        title: '浏览器不提供该 API',
        detail: '浏览器没有提供摄像头/麦克风访问接口，可能是版本过旧，或页面不在安全上下文中。' + suffix,
        retry: '改用较新的 Chrome、Edge、Firefox 或 Safari，并通过 HTTPS 或 localhost 打开。',
      };
    default:
      return {
        kind: 'unknown',
        title: '无法访问设备',
        detail: `发生了未预期的错误${name === '' ? '' : `（${name}）`}。` + suffix,
        retry: '重新点击“开启预览”；若持续失败，检查系统隐私设置里的摄像头与麦克风权限。',
      };
  }
}

/** A readable label for a device in a dropdown. */
export function deviceOptionLabel(
  label: string | null | undefined,
  kind: 'video' | 'audio',
  index: number,
): string {
  const trimmed = (label ?? '').trim();
  if (trimmed !== '' && trimmed.toLowerCase() !== 'default') return trimmed;
  return kind === 'video' ? `摄像头 ${index + 1}` : `麦克风 ${index + 1}`;
}
