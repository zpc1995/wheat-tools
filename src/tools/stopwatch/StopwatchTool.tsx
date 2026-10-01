import {
  Button,
  Caption1,
  MessageBar,
  MessageBarBody,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  AddRegular,
  ArrowCounterclockwiseRegular,
  CopyRegular,
  PauseRegular,
  PlayRegular,
  StarFilled,
} from '@fluentui/react-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import {
  MAX_LAPS,
  addLap,
  createState,
  deserialise,
  elapsedAt,
  formatStopwatch,
  isRunning,
  lapExtremes,
  lapsToTsv,
  reset,
  serialise,
  toggle,
  type StopwatchState,
} from './stopwatchUtils';

const STORAGE_KEY = 'wheat-tools:stopwatch';

const useStyles = makeStyles({
  display: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    padding: '28px 16px 20px',
  },
  time: {
    // Tabular figures plus a monospace stack: without them the digits change
    // width as they tick and the whole display shivers.
    fontFamily: 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace',
    fontVariantNumeric: 'tabular-nums',
    fontSize: 'clamp(38px, 9vw, 68px)',
    fontWeight: 600,
    letterSpacing: '0.01em',
    lineHeight: 1.1,
  },
  state: {
    color: tokens.colorNeutralForeground3,
    minHeight: '20px',
  },
  controls: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px',
    justifyContent: 'center',
    padding: '0 16px 20px',
  },
  lapHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap',
    marginTop: '8px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontVariantNumeric: 'tabular-nums',
  },
  headCell: {
    textAlign: 'left',
    padding: '8px 12px',
    color: tokens.colorNeutralForeground3,
    fontWeight: 600,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    whiteSpace: 'nowrap',
  },
  cell: {
    padding: '6px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    whiteSpace: 'nowrap',
  },
  numeric: {
    fontFamily: 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace',
    textAlign: 'right',
  },
  fastest: {
    color: tokens.colorPaletteGreenForeground1,
    fontWeight: 600,
  },
  slowest: {
    color: tokens.colorPaletteRedForeground1,
    fontWeight: 600,
  },
  lapScroll: {
    maxHeight: '320px',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
});

/**
 * The ticking display.
 *
 * Split into its own component on purpose: the elapsed time changes on every
 * animation frame, so whatever renders it re-renders ~60 times a second. Keeping
 * that inside this component means the lap table beside it is untouched by the
 * tick — with a few hundred laps, re-rendering the table at that rate is exactly
 * the kind of thing that makes a stopwatch stutter.
 */
function ElapsedDisplay({ state }: { state: StopwatchState }) {
  const styles = useStyles();
  const { t } = useI18n();
  const [elapsed, setElapsed] = useState(() => elapsedAt(state, performance.now()));

  useEffect(() => {
    // Recompute once immediately: otherwise pausing leaves the last animated
    // frame on screen, which can read a few centiseconds ahead of the truth.
    setElapsed(elapsedAt(state, performance.now()));
    if (!isRunning(state)) return undefined;

    let frame = requestAnimationFrame(function tick() {
      setElapsed(elapsedAt(state, performance.now()));
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [state]);

  const running = isRunning(state);

  return (
    <div className={styles.display}>
      <Text
        className={styles.time}
        // `role="timer"` carries an implicit aria-live of "off", which is what
        // is wanted: announcing a value that changes 60 times a second would
        // make the page unusable with a screen reader. The state line below
        // carries the changes that are worth announcing.
        role="timer"
        aria-live="off"
        aria-label={`${t('stopwatch.elapsed')} ${formatStopwatch(elapsed)}`}
      >
        {formatStopwatch(elapsed)}
      </Text>
      <Caption1 className={styles.state} aria-live="polite">
        {running
          ? t('stopwatch.running')
          : elapsed > 0
            ? t('stopwatch.paused')
            : t('stopwatch.ready')}
      </Caption1>
    </div>
  );
}

/** Reads the persisted stopwatch, if there is a usable one. */
function readStored(): StopwatchState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createState();
    return deserialise(JSON.parse(raw), performance.now(), Date.now());
  } catch {
    return createState();
  }
}

export function StopwatchTool() {
  const styles = useStyles();
  const { t } = useI18n();
  const [state, setState] = useState<StopwatchState>(readStored);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(serialise(state, performance.now(), Date.now())),
      );
    } catch {
      // Persistence is best effort; the stopwatch works without it.
    }
  }, [state]);

  const running = isRunning(state);
  const elapsed = elapsedAt(state, performance.now());
  const extremes = useMemo(() => lapExtremes(state.laps), [state.laps]);

  const onToggle = useCallback(() => {
    setState((current) => toggle(current, performance.now()));
  }, []);

  const onLap = useCallback(() => {
    setState((current) => addLap(current, performance.now()));
  }, []);

  const onReset = useCallback(() => {
    setState(reset());
    setCopied(false);
  }, []);

  // Keyboard shortcuts, matching the physical controls people expect. Modifier
  // combinations are left alone so browser shortcuts (Ctrl+R, Cmd+L) still work,
  // and typing in a field is never intercepted.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        onToggle();
      } else if (event.key === 'l' || event.key === 'L') {
        event.preventDefault();
        onLap();
      } else if (event.key === 'r' || event.key === 'R') {
        event.preventDefault();
        onReset();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onToggle, onLap, onReset]);

  const copyLaps = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(lapsToTsv(state.laps));
      setCopied(true);
    } catch {
      // Clipboard access can be denied; leaving the button unflipped is the
      // honest outcome rather than claiming a copy that did not happen.
      setCopied(false);
    }
  }, [state.laps]);

  // Ticks the surrounding chrome (button labels, elapsed readouts) once a
  // second rather than every frame — this component does not need 60 fps, and
  // the display above has its own loop.
  const [, forceTick] = useState(0);
  useRef<number>(0);
  useEffect(() => {
    if (!running) return undefined;
    const id = window.setInterval(() => forceTick((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const lapFull = state.laps.length >= MAX_LAPS;

  return (
    <div className="wt-surface">
      <ElapsedDisplay state={state} />

      <div className={styles.controls}>
        <Button
          appearance="primary"
          size="large"
          icon={running ? <PauseRegular /> : <PlayRegular />}
          onClick={onToggle}
        >
          {running ? t('stopwatch.pause') : elapsed > 0 ? t('stopwatch.resume') : t('stopwatch.start')}
        </Button>
        <Button
          size="large"
          icon={<AddRegular />}
          onClick={onLap}
          // A lap while paused would duplicate the previous total, so it is
          // disabled rather than producing a meaningless zero split.
          disabled={!running || lapFull}
          title={lapFull ? t('stopwatch.lapFull') : t('stopwatch.lapHint')}
        >
          {t('stopwatch.lap')}
        </Button>
        <Button
          size="large"
          icon={<ArrowCounterclockwiseRegular />}
          onClick={onReset}
          disabled={elapsed === 0 && state.laps.length === 0}
        >
          {t('stopwatch.reset')}
        </Button>
      </div>

      {/* `wt-surface__body` is a flex row by default; the shared class is used
          for its spacing and background, so the direction has to be set here or
          the heading and the table lay out side by side. */}
      <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
        <div className={styles.lapHeader}>
          <Text as="h2" size={300} weight="semibold">
            {t('stopwatch.laps')}
            {state.laps.length > 0 ? ` · ${state.laps.length}` : ''}
          </Text>
          <Button
            appearance="subtle"
            size="small"
            icon={<CopyRegular />}
            onClick={copyLaps}
            disabled={state.laps.length === 0}
          >
            {copied ? t('common.copied') : t('stopwatch.copyLaps')}
          </Button>
        </div>

        {lapFull && (
          <MessageBar intent="warning" style={{ marginTop: 8 }}>
            <MessageBarBody>{t('stopwatch.lapFull')}</MessageBarBody>
          </MessageBar>
        )}

        {state.laps.length === 0 ? (
          <Caption1
            style={{ display: 'block', padding: '16px 0', color: tokens.colorNeutralForeground3 }}
          >
            {t('stopwatch.noLaps')}
          </Caption1>
        ) : (
          <div className={styles.lapScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.headCell}>{t('stopwatch.lapNumber')}</th>
                  <th className={styles.headCell} style={{ textAlign: 'right' }}>
                    {t('stopwatch.split')}
                  </th>
                  <th className={styles.headCell} style={{ textAlign: 'right' }}>
                    {t('stopwatch.total')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.laps.map((lap, index) => {
                  const isFastest = extremes?.fastest === index;
                  const isSlowest = extremes?.slowest === index;
                  return (
                    <tr key={lap.index}>
                      <td className={styles.cell}>
                        {lap.index}
                        {isFastest && (
                          <Tooltip content={t('stopwatch.fastest')} relationship="label" withArrow>
                            <StarFilled
                              className={styles.fastest}
                              style={{ marginLeft: 6, verticalAlign: 'middle' }}
                              aria-label={t('stopwatch.fastest')}
                            />
                          </Tooltip>
                        )}
                        {isSlowest && (
                          <Tooltip content={t('stopwatch.slowest')} relationship="label" withArrow>
                            <StarFilled
                              className={styles.slowest}
                              style={{ marginLeft: 6, verticalAlign: 'middle' }}
                              aria-label={t('stopwatch.slowest')}
                            />
                          </Tooltip>
                        )}
                      </td>
                      <td
                        className={`${styles.cell} ${styles.numeric} ${
                          isFastest ? styles.fastest : isSlowest ? styles.slowest : ''
                        }`}
                      >
                        {formatStopwatch(lap.splitMs)}
                      </td>
                      <td className={`${styles.cell} ${styles.numeric}`}>
                        {formatStopwatch(lap.totalMs)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
