import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  Dropdown,
  Input,
  Option,
  Switch,
  Text,
  Tooltip,
  makeStyles,
  tokens,
  Toast,
  ToastTitle,
  Toaster,
  useId,
  useToastController,
} from '@fluentui/react-components';
import {
  ArrowSync16Regular,
  Clock16Regular,
  Pause16Regular,
  Play16Regular,
  Timer16Regular,
} from '@fluentui/react-icons';
import {
  TIMER_PRESETS,
  ZONE_OPTIONS,
  dayOfYear,
  formatDateZh,
  formatDuration,
  formatInZone,
  isoWeek,
  localZone,
  parseDuration,
  weekdayZh,
  zoneLabel,
} from './clockUtils';

/** How often the display refreshes; 200 ms keeps the seconds feeling live. */
const TICK_MS = 200;
/** Extra zones shown in the world-time grid by default. */
const DEFAULT_WORLD = ['UTC', 'Asia/Tokyo', 'Europe/London', 'America/New_York'];

const TIMER_STORAGE_KEY = 'wheat-tools:clock-timer';

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  hero: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    padding: '24px 20px 18px',
  },
  clock: {
    fontFamily: "'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif",
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 600,
    fontSize: 'clamp(44px, 9vw, 96px)',
    lineHeight: 1.05,
    letterSpacing: '0.01em',
    color: tokens.colorBrandForeground1,
    userSelect: 'all',
  },
  meridiem: {
    fontSize: '0.32em',
    marginLeft: '0.2em',
    color: tokens.colorNeutralForeground3,
  },
  sub: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px',
    justifyContent: 'center',
    alignItems: 'center',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
    width: '100%',
  },
  cell: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '12px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  zoneName: {
    color: tokens.colorNeutralForeground3,
  },
  zoneTime: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '19px',
    fontVariantNumeric: 'tabular-nums',
  },
  zoneMeta: {
    color: tokens.colorNeutralForeground4,
  },
  timer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    padding: '22px 20px',
  },
  timerDisplay: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 600,
    fontSize: 'clamp(34px, 6vw, 60px)',
    lineHeight: 1.1,
  },
  timerDone: {
    color: tokens.colorPaletteRedForeground1,
  },
  presets: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    justifyContent: 'center',
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '9px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  rowLabel: {
    flex: 'none',
    width: '110px',
    color: tokens.colorNeutralForeground3,
  },
  rowValue: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '14px',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
});

interface TimerState {
  /** Epoch millis when the timer should fire; null when idle. */
  endsAt: number | null;
  /** Remaining millis when paused; null when not paused. */
  pausedRemaining: number | null;
}

function readTimer(): TimerState {
  try {
    const raw = window.localStorage.getItem(TIMER_STORAGE_KEY);
    if (!raw) return { endsAt: null, pausedRemaining: null };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { endsAt: null, pausedRemaining: null };
    const record = parsed as Record<string, unknown>;
    return {
      endsAt: typeof record.endsAt === 'number' ? record.endsAt : null,
      pausedRemaining:
        typeof record.pausedRemaining === 'number' ? record.pausedRemaining : null,
    };
  } catch {
    return { endsAt: null, pausedRemaining: null };
  }
}

function writeTimer(state: TimerState): void {
  try {
    window.localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Best effort; the in-memory state still works.
  }
}

export function OnlineClockTool() {
  const styles = useStyles();
  const toasterId = useId('clock-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [now, setNow] = useState(() => new Date());
  const [hour12, setHour12] = useState(false);
  const [zone, setZone] = useState(() => localZone());
  const [showSeconds, setShowSeconds] = useState(true);

  const [timer, setTimer] = useState<TimerState>(readTimer);
  const [timerInput, setTimerInput] = useState('5:00');
  const [remaining, setRemaining] = useState(0);
  /** True after a countdown reached zero, until the next start/reset. */
  const [finished, setFinished] = useState(false);

  // A single interval drives both the clock and the countdown.
  useEffect(() => {
    const tick = () => {
      const current = new Date();
      setNow(current);
      setTimer((state) => {
        if (state.endsAt === null) {
          setRemaining(state.pausedRemaining ?? 0);
          return state;
        }
        const left = state.endsAt - current.getTime();
        setRemaining(left);
        if (left <= 0) {
          // Persist the cleared state so a refresh does not resurrect a
          // finished countdown.
          writeTimer({ endsAt: null, pausedRemaining: null });
          setFinished(true);
          return { endsAt: null, pausedRemaining: null };
        }
        return state;
      });
    };

    tick();
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const notify = useCallback(
    (message: string) => {
      dispatchToast(
        <Toast>
          <ToastTitle>{message}</ToastTitle>
        </Toast>,
        { timeout: 2200 },
      );
    },
    [dispatchToast],
  );

  // Announce completion once, and beep so it is noticeable even when the tab is
  // in the background.
  useEffect(() => {
    if (!finished) return;
    notify('计时结束');
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (Ctor) {
        const context = new Ctor();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = 880;
        gain.gain.value = 0.08;
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.35);
        oscillator.onended = () => void context.close();
      }
    } catch {
      // Sound is a nicety; a blocked AudioContext must not break the timer.
    }
    setFinished(false);
  }, [finished, notify]);

  const zoneTime = useMemo(
    () => formatInZone(now, zone, hour12),
    [now, zone, hour12],
  );

  // The 12-hour clock renders its own meridiem, so split it off the formatted
  // string rather than reformatting with a second Intl call.
  const [clockMain, clockSuffix] = useMemo(() => {
    if (!hour12) return [zoneTime.time, ''];
    const match = /^(.*?)\s*(am|pm)$/i.exec(zoneTime.time);
    return match ? [match[1], match[2].toUpperCase()] : [zoneTime.time, ''];
  }, [zoneTime.time, hour12]);

  const worldZones = useMemo(() => {
    const own = zone;
    const extras = DEFAULT_WORLD.filter((item) => item !== own);
    return [own, ...extras].slice(0, 6);
  }, [zone]);

  const startTimer = useCallback(
    (ms: number) => {
      if (ms <= 0) return;
      setFinished(false);
      const state: TimerState = { endsAt: Date.now() + ms, pausedRemaining: null };
      setTimer(state);
      writeTimer(state);
      setRemaining(ms);
      notify(`计时开始：${formatDuration(ms)}`);
    },
    [notify],
  );

  const pause = useCallback(() => {
    setTimer((state) => {
      if (state.endsAt === null) return state;
      const left = Math.max(0, state.endsAt - Date.now());
      const next: TimerState = { endsAt: null, pausedRemaining: left };
      writeTimer(next);
      return next;
    });
  }, []);

  const resume = useCallback(() => {
    setTimer((state) => {
      if (state.pausedRemaining === null || state.pausedRemaining <= 0) return state;
      setFinished(false);
      const next: TimerState = {
        endsAt: Date.now() + state.pausedRemaining,
        pausedRemaining: null,
      };
      writeTimer(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setFinished(false);
    const next: TimerState = { endsAt: null, pausedRemaining: null };
    setTimer(next);
    writeTimer(next);
    setRemaining(0);
  }, []);

  const applyInput = useCallback(() => {
    const ms = parseDuration(timerInput);
    if (ms === null) {
      notify('时间格式无法解析，可用 5（分钟）、5:00 或 1:30:00');
      return;
    }
    startTimer(ms);
  }, [timerInput, startTimer, notify]);

  const running = timer.endsAt !== null;
  const paused = timer.pausedRemaining !== null && timer.pausedRemaining > 0;

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <section className="wt-surface" aria-label="当前时间">
          <div className="wt-surface__header">
            <Clock16Regular />
            <Text size={300} weight="semibold">
              当前时间
            </Text>
            <span className={styles.spacer} />
            <Switch
              checked={hour12}
              onChange={(_, data) => setHour12(data.checked)}
              label="12 小时制"
            />
            <Switch
              checked={showSeconds}
              onChange={(_, data) => setShowSeconds(data.checked)}
              label="显示秒"
            />
            <Dropdown
              style={{ minWidth: 180 }}
              value={zone === localZone() ? `本机（${zoneLabel(zone)}）` : zoneLabel(zone)}
              selectedOptions={[zone]}
              onOptionSelect={(_, data) => setZone(data.optionValue ?? 'UTC')}
              aria-label="时区"
            >
              <Option value={localZone()} text={`本机（${zoneLabel(localZone())}）`}>
                本机（{zoneLabel(localZone())}）
              </Option>
              {ZONE_OPTIONS.filter((item) => item.id !== localZone()).map((item) => (
                <Option key={item.id} value={item.id} text={item.label}>
                  {item.label}
                </Option>
              ))}
            </Dropdown>
          </div>

          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.hero}>
              <Text className={styles.clock} aria-live="off">
                {showSeconds
                  ? clockMain
                  : clockMain.split(':').slice(0, 2).join(':')}
                {hour12 && clockSuffix && (
                  <span className={styles.meridiem}>{clockSuffix}</span>
                )}
              </Text>
              <div className={styles.sub}>
                <Text size={400}>{formatDateZh(now)}</Text>
                <Badge appearance="tint" color="brand" size="medium">
                  {weekdayZh(now)}
                </Badge>
                <Caption1 className={styles.hint}>
                  第 {isoWeek(now)} 周 · 年内第 {dayOfYear(now)} 天 ·{' '}
                  {zoneLabel(zone)}
                </Caption1>
              </div>
              <Caption1 className={styles.hint}>
                {zoneTime.offset}
                {zoneTime.isDst && ' · 当前处于夏令时'}
              </Caption1>
            </div>
          </div>
        </section>

        <section className="wt-surface" aria-label="世界时间">
          <div className="wt-surface__header">
            <Text size={300} weight="semibold">
              世界时间
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              同一瞬间，各时区换算
            </Caption1>
          </div>
          <div className="wt-surface__body">
            <div className={styles.grid}>
              {worldZones.map((item) => {
                const time = formatInZone(now, item, hour12);
                return (
                  <div key={item} className={styles.cell}>
                    <Caption1 className={styles.zoneName}>
                      {zoneLabel(item)}
                      {item === zone && ' · 已选'}
                    </Caption1>
                    <span className={styles.zoneTime}>{time.time}</span>
                    <Caption1 className={styles.zoneMeta}>
                      {time.date} {time.weekday} · {time.offset}
                      {time.isDst ? ' · 夏令时' : ''}
                    </Caption1>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="wt-surface" aria-label="计时器">
          <div className="wt-surface__header">
            <Timer16Regular />
            <Text size={300} weight="semibold">
              倒计时
            </Text>
            {running && (
              <Badge appearance="tint" color="success" size="small">
                运行中
              </Badge>
            )}
            {paused && (
              <Badge appearance="tint" color="warning" size="small">
                已暂停
              </Badge>
            )}
            {remaining <= 0 && !running && !paused && (
              <Badge appearance="tint" color="informative" size="small">
                未启动
              </Badge>
            )}
            <span className={styles.spacer} />
            <Tooltip
              content="刷新页面后计时仍会继续（基于结束时间而非计数）"
              relationship="description"
              withArrow
            >
              <Caption1 className={styles.hint}>状态本地保存</Caption1>
            </Tooltip>
          </div>

          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.timer}>
              <Text
                className={`${styles.timerDisplay} ${
                  finished ? styles.timerDone : ''
                }`}
                aria-live="polite"
              >
                {formatDuration(Math.max(0, remaining), true)}
              </Text>

              <div className={styles.toolbar} style={{ justifyContent: 'center' }}>
                {running ? (
                  <Button
                    appearance="primary"
                    icon={<Pause16Regular />}
                    onClick={pause}
                  >
                    暂停
                  </Button>
                ) : paused ? (
                  <Button
                    appearance="primary"
                    icon={<Play16Regular />}
                    onClick={resume}
                  >
                    继续
                  </Button>
                ) : (
                  <Button
                    appearance="primary"
                    icon={<Play16Regular />}
                    onClick={applyInput}
                  >
                    开始
                  </Button>
                )}
                <Button
                  appearance="secondary"
                  icon={<ArrowSync16Regular />}
                  onClick={reset}
                  disabled={!running && !paused}
                >
                  重置
                </Button>
                <Input
                  style={{ width: 140 }}
                  value={timerInput}
                  onChange={(_, data) => setTimerInput(data.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') applyInput();
                  }}
                  aria-label="倒计时时长"
                  placeholder="5 / 5:00 / 1:30:00"
                />
                <Caption1 className={styles.hint}>
                  纯数字表示分钟
                </Caption1>
              </div>

              <div className={styles.presets}>
                {TIMER_PRESETS.map((preset) => (
                  <Button
                    key={preset.label}
                    appearance="secondary"
                    size="small"
                    onClick={() => {
                      setTimerInput(preset.label.replace(/\s/g, ''));
                      startTimer(preset.ms);
                    }}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>

            <Divider />

            <div className={styles.rows}>
              <div className={styles.row}>
                <Text className={styles.rowLabel} size={200}>
                  结束时刻
                </Text>
                <span className={styles.rowValue}>
                  {timer.endsAt
                    ? formatInZone(new Date(timer.endsAt), zone, hour12).time
                    : '—'}
                </span>
              </div>
              <div className={styles.row}>
                <Text className={styles.rowLabel} size={200}>
                  时间戳
                </Text>
                <span className={styles.rowValue}>
                  {Math.floor(now.getTime() / 1000)}
                </span>
              </div>
            </div>
          </div>
        </section>

        <Caption1 className={styles.hint} style={{ padding: '0 4px' }}>
          时间取自浏览器本地时钟；时区换算由系统时区数据库（Intl）完成，
          会自动处理夏令时与半小时偏移。整个过程不需要联网。
        </Caption1>
      </div>
    </>
  );
}
