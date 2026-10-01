import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  Dropdown,
  MessageBar,
  MessageBarBody,
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
  Checkmark16Regular,
  Clock16Regular,
  Copy16Regular,
  Flash16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  candidateTimeZones,
  formatDateTime,
  formatInZone,
  formatOffset,
  isoWeek,
  parseStamp,
  localTimeZone,
  relativeToNow,
  toLocalInputValue,
  weekday,
} from './timeUtils';

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
  liveValue: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: 'clamp(26px, 4vw, 40px)',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.5px',
    color: tokens.colorBrandForeground1,
    userSelect: 'all',
  },
  stage: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
    padding: '22px 20px 8px',
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '9px 8px 9px 16px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  rowLabel: {
    flex: 'none',
    width: '132px',
    color: tokens.colorNeutralForeground3,
  },
  rowValue: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  zoneSelect: {
    minWidth: '190px',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
});

interface DisplayRow {
  label: string;
  value: string;
  copyable?: boolean;
}

export function TimestampConverterTool() {
  const styles = useStyles();
  const toasterId = useId('ts-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [input, setInput] = useState('');
  const [live, setLive] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [zone, setZone] = useState(() => localTimeZone());
  const [copied, setCopied] = useState<string | null>(null);

  // Live clock. Only ticks while enabled, so the page is idle when not needed.
  useEffect(() => {
    if (!live) return undefined;
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [live]);

  const parsed = useMemo(() => parseStamp(input), [input]);
  const active = parsed.ok ? parsed.value.date : null;

  /** Seconds value currently being displayed: parsed input, else live clock. */
  const seconds = active
    ? Math.floor(active.getTime() / 1000)
    : Math.floor(now.getTime() / 1000);

  const notify = useCallback(
    (message: string) => {
      dispatchToast(
        <Toast>
          <ToastTitle>{message}</ToastTitle>
        </Toast>,
        { timeout: 1400 },
      );
    },
    [dispatchToast],
  );

  const copy = useCallback(
    async (value: string, key: string) => {
      const ok = await copyText(value);
      if (ok) {
        setCopied(key);
        window.setTimeout(() => setCopied(null), 1400);
        notify('已复制');
      } else {
        notify('复制失败，请手动选择');
      }
    },
    [notify],
  );

  const rows = useMemo<DisplayRow[]>(() => {
    if (!active) return [];
    const zoneFormatted = formatInZone(active, zone);

    const list: DisplayRow[] = [
      { label: '时间戳（秒）', value: String(Math.floor(active.getTime() / 1000)) },
      { label: '时间戳（毫秒）', value: String(active.getTime()) },
      { label: 'ISO 8601', value: active.toISOString() },
      { label: '本地时间', value: `${formatDateTime(active)} ${formatOffset(active)}` },
      {
        label: 'UTC',
        value: `${formatInZone(active, 'UTC') ?? ''} UTC`,
      },
      { label: `${zone}`, value: zoneFormatted ?? '该时区不受支持' },
      {
        label: '日期信息',
        value: `${weekday(active)} · 第 ${isoWeek(active)} 周 · ${
          relativeToNow(active, now)
        }`,
      },
    ];
    return list;
  }, [active, zone, now]);

  const applyNow = useCallback(() => {
    const current = new Date();
    setNow(current);
    setInput(String(Math.floor(current.getTime() / 1000)));
  }, []);

  const applyLocalInput = useCallback((value: string) => {
    // `datetime-local` yields a zone-less string; `new Date` reads it as local.
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return;
    setInput(String(Math.floor(date.getTime() / 1000)));
  }, []);

  const errorText = !parsed.ok && input.trim() ? parsed.error : null;

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <section className="wt-surface" aria-label="时间戳转换">
          <div className="wt-surface__header">
            <Clock16Regular />
            <Text as="h2" size={300} weight="semibold">
              时间戳 ↔ 日期
            </Text>
            <Badge appearance="tint" color="brand" size="small">
              {parsed.ok ? `按${parsed.value.unit === 'seconds' ? '秒' : '毫秒'}解析` : '待输入'}
            </Badge>
            <span className={styles.spacer} />
            <Switch
              checked={live}
              onChange={(_, data) => setLive(data.checked)}
              label="实时时钟"
            />
          </div>

          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.stage}>
              <Caption1 className={styles.hint}>
                {active ? '当前解析结果' : '当前时间（每秒刷新）'}
              </Caption1>
              <Text as="p" className={styles.liveValue} aria-live="off">
                {seconds}
              </Text>
              <div className={styles.toolbar} style={{ justifyContent: 'center' }}>
                <Button
                  appearance="primary"
                  icon={<Flash16Regular />}
                  onClick={applyNow}
                >
                  使用当前时间
                </Button>
                <Button
                  appearance="secondary"
                  icon={
                    copied === 'seconds' ? (
                      <Checkmark16Regular />
                    ) : (
                      <Copy16Regular />
                    )
                  }
                  onClick={() => copy(String(seconds), 'seconds')}
                >
                  复制秒级
                </Button>
                <Button
                  appearance="secondary"
                  icon={
                    copied === 'millis' ? (
                      <Checkmark16Regular />
                    ) : (
                      <Copy16Regular />
                    )
                  }
                  onClick={() => copy(String(seconds * 1000), 'millis')}
                >
                  复制毫秒级
                </Button>
              </div>
            </div>

            <Divider />

            <div className={styles.row}>
              <Text className={styles.rowLabel} size={200}>
                时间戳 / 日期
              </Text>
              <input
                className="wt-inline-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="粘贴时间戳（1759257600）或日期（2025-10-01T04:00:00Z）"
                aria-label="时间戳或日期输入"
                spellCheck={false}
              />
              <Tooltip content="清空，回到实时时钟" relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  icon={<ArrowSync16Regular />}
                  onClick={() => setInput('')}
                  disabled={!input}
                  aria-label="清空输入"
                />
              </Tooltip>
            </div>

            <div className={styles.row}>
              <Text className={styles.rowLabel} size={200}>
                反向输入（本地时间）
              </Text>
              <input
                className="wt-inline-input"
                type="datetime-local"
                value={active ? toLocalInputValue(active) : ''}
                onChange={(event) => applyLocalInput(event.target.value)}
                aria-label="选择本地日期时间"
              />
            </div>

            <div className={styles.row}>
              <Text className={styles.rowLabel} size={200}>
                对比时区
              </Text>
              <Dropdown
                className={styles.zoneSelect}
                value={zone}
                selectedOptions={[zone]}
                onOptionSelect={(_, data) => setZone(data.optionValue ?? 'UTC')}
                aria-label="选择对比时区"
              >
                {candidateTimeZones().map((item) => (
                  <Option key={item} value={item} text={item}>
                    {item}
                  </Option>
                ))}
              </Dropdown>
            </div>
          </div>
        </section>

        {errorText && (
          <MessageBar intent="warning">
            <MessageBarBody>{errorText}</MessageBarBody>
          </MessageBar>
        )}

        {active && (
          <section className="wt-surface" aria-label="转换结果">
            <div className="wt-surface__header">
              <ArrowSync16Regular />
              <Text as="h2" size={300} weight="semibold">
                转换结果
              </Text>
              <span className={styles.spacer} />
              <Caption1 className={styles.hint}>
                {weekday(active)} · {relativeToNow(active, now)}
              </Caption1>
            </div>
            <div className={`wt-surface__body ${styles.rows}`}>
              {rows.map((row) => (
                <div key={row.label} className={styles.row}>
                  <Text className={styles.rowLabel} size={200}>
                    {row.label}
                  </Text>
                  <span className={styles.rowValue}>{row.value}</span>
                  <Tooltip content="复制" relationship="label" withArrow>
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={
                        copied === row.label ? (
                          <Checkmark16Regular />
                        ) : (
                          <Copy16Regular />
                        )
                      }
                      onClick={() => copy(row.value, row.label)}
                      aria-label={`复制 ${row.label}`}
                    />
                  </Tooltip>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
