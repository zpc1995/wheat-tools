/**
 * Stopwatch arithmetic.
 *
 * Kept free of React and of any clock of its own: every function takes the
 * current timestamp as an argument. That is what makes the logic testable —
 * a stopwatch that reads the clock internally cannot be verified without
 * waiting in real time, which in practice means it never gets verified at all.
 *
 * ## Why the time source matters
 *
 * Elapsed time is `baseMs + (now - anchor)` rather than a running total
 * incremented on each tick. The naive version — adding a fixed 10 ms every
 * `setInterval` — drifts, because timers fire late and the browser throttles
 * background tabs; a "10 second" interval can easily average 10.4. Anchoring to
 * a timestamp means the displayed value is derived from the clock, so late or
 * missed ticks change nothing but the refresh rate.
 *
 * The caller supplies `performance.now()` (monotonic) rather than `Date.now()`:
 * the wall clock can jump backwards or forwards when the system syncs its time,
 * which would make a stopwatch show negative or wildly wrong elapsed values.
 */

/** One recorded lap. */
export interface Lap {
  /** 1-based lap number, as a real stopwatch labels them. */
  index: number;
  /** Total elapsed time when the lap was taken. */
  totalMs: number;
  /** Time since the previous lap (or since the start, for lap 1). */
  splitMs: number;
}

export interface StopwatchState {
  /** Elapsed milliseconds accumulated before the current running segment. */
  baseMs: number;
  /**
   * Timestamp at which the current running segment began, or `null` when paused.
   *
   * `null` is what "paused" means — there is no separate boolean to fall out of
   * sync with it.
   */
  anchor: number | null;
  laps: Lap[];
}

/**
 * Upper bound on recorded laps.
 *
 * A real stopwatch has finite lap memory and this one is a browser tab, so the
 * cap is stated rather than letting a runaway keyboard shortcut grow an array
 * until the tab dies. At the cap, lap taking stops and the UI says so.
 */
export const MAX_LAPS = 1000;

export function createState(): StopwatchState {
  return { baseMs: 0, anchor: null, laps: [] };
}

/** Whether the stopwatch is currently counting. */
export function isRunning(state: StopwatchState): boolean {
  return state.anchor !== null;
}

/** Elapsed time at `now`, regardless of whether the stopwatch is running. */
export function elapsedAt(state: StopwatchState, now: number): number {
  if (state.anchor === null) return state.baseMs;
  // Clamped: a caller passing a timestamp from before the anchor (which can
  // happen if the anchor was restored from storage and the clock moved back)
  // must not produce a negative reading.
  return state.baseMs + Math.max(0, now - state.anchor);
}

/** Starts counting. Already running is a no-op, not a restart. */
export function start(state: StopwatchState, now: number): StopwatchState {
  if (state.anchor !== null) return state;
  return { ...state, anchor: now };
}

/** Stops counting, folding the current segment into `baseMs`. */
export function stop(state: StopwatchState, now: number): StopwatchState {
  if (state.anchor === null) return state;
  return { baseMs: elapsedAt(state, now), anchor: null, laps: state.laps };
}

/** Starts or stops, whichever applies. */
export function toggle(state: StopwatchState, now: number): StopwatchState {
  return state.anchor === null ? start(state, now) : stop(state, now);
}

/** Clears the elapsed time and every lap. */
export function reset(): StopwatchState {
  return createState();
}

/**
 * Records a lap.
 *
 * Only meaningful while running: a lap taken while paused would have the same
 * total as the previous one and produce a zero-length split, which reads as a
 * bug rather than as data. The UI disables the button in that state; this guard
 * exists so the logic is correct on its own.
 */
export function addLap(state: StopwatchState, now: number): StopwatchState {
  if (state.anchor === null) return state;
  if (state.laps.length >= MAX_LAPS) return state;

  const totalMs = elapsedAt(state, now);
  const previous = state.laps[state.laps.length - 1];

  return {
    ...state,
    laps: [
      ...state.laps,
      {
        index: state.laps.length + 1,
        totalMs,
        splitMs: totalMs - (previous?.totalMs ?? 0),
      },
    ],
  };
}

/**
 * Indices of the fastest and slowest laps, or `null` when that distinction
 * carries no information.
 *
 * Marking a "fastest lap" out of a single lap, or when every split is identical,
 * highlights everything and therefore means nothing. Returning `null` keeps the
 * UI from decorating rows with an empty claim.
 */
export function lapExtremes(laps: Lap[]): { fastest: number; slowest: number } | null {
  if (laps.length < 2) return null;

  let fastest = 0;
  let slowest = 0;
  for (let index = 1; index < laps.length; index += 1) {
    if (laps[index].splitMs < laps[fastest].splitMs) fastest = index;
    if (laps[index].splitMs > laps[slowest].splitMs) slowest = index;
  }

  return laps[fastest].splitMs === laps[slowest].splitMs ? null : { fastest, slowest };
}

/** Formats a duration as `HH:MM:SS.cc`. */
export function formatStopwatch(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const centis = Math.floor((clamped % 1000) / 10);
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');

  // Hours are always shown, even at zero. A display that redraws every frame
  // must not change width: the layout would jitter as each unit appears.
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(centis)}`;
}

/** The lap table as TSV, for pasting into a spreadsheet. */
export function lapsToTsv(laps: Lap[]): string {
  const header = ['计次', '分段', '总时间'].join('\t');
  const rows = laps.map((lap) =>
    [lap.index, formatStopwatch(lap.splitMs), formatStopwatch(lap.totalMs)].join('\t'),
  );
  return [header, ...rows].join('\n');
}

/**
 * Serialises the stopwatch for storage.
 *
 * `anchor` is a `performance.now()` reading, which is relative to page load and
 * therefore meaningless after a reload. It is converted to a wall-clock instant
 * here so a running stopwatch can be resumed in a later page load; the cost is
 * that a system clock change *while the page was closed* shifts the result. That
 * trade is deliberate: losing an in-progress timing to an accidental refresh is
 * the more likely annoyance, and the in-session reading stays monotonic.
 */
export function serialise(state: StopwatchState, now: number, wallClock: number) {
  return {
    baseMs: state.baseMs,
    laps: state.laps,
    // The wall-clock instant this segment started, or null when paused.
    wallAnchor: state.anchor === null ? null : wallClock - (now - state.anchor),
  };
}

interface Serialised {
  baseMs: number;
  laps: Lap[];
  wallAnchor: number | null;
}

/** Validates whatever was in storage; unreadable data restarts from zero. */
export function deserialise(raw: unknown, now: number, wallClock: number): StopwatchState {
  if (!raw || typeof raw !== 'object') return createState();
  const value = raw as Partial<Serialised>;

  if (typeof value.baseMs !== 'number' || !Number.isFinite(value.baseMs) || value.baseMs < 0) {
    return createState();
  }

  const laps: Lap[] = Array.isArray(value.laps)
    ? value.laps
        .filter(
          (lap): lap is Lap =>
            Boolean(lap) &&
            typeof lap.index === 'number' &&
            typeof lap.totalMs === 'number' &&
            typeof lap.splitMs === 'number',
        )
        .slice(0, MAX_LAPS)
    : [];

  if (typeof value.wallAnchor !== 'number' || !Number.isFinite(value.wallAnchor)) {
    return { baseMs: value.baseMs, anchor: null, laps };
  }

  // Resume from wherever the elapsed time would have reached by now, then anchor
  // to the monotonic clock again for the rest of this session.
  const carried = value.baseMs + Math.max(0, wallClock - value.wallAnchor);
  return { baseMs: carried, anchor: now, laps };
}
