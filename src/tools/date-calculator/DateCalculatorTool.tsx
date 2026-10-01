import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Tab,
  TabList,
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
  Add16Regular,
  CalendarLtr16Regular,
  Checkmark16Regular,
  Copy16Regular,
  Subtract16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  QUICK_OFFSETS,
  ZERO_ADD,
  addBusinessDays,
  addToDate,
  ageFrom,
  describeDate,
  difference,
  formatDurationZh,
  parseDate,
  toDateString,
  toDateTimeString,
  todayString,
  type AddOptions,
} from './dateUtils';

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
  dateRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    padding: '12px 14px',
    flexWrap: 'wrap',
    width: '100%',
  },
  dateInput: {
    flex: '1 1 220px',
    minWidth: '180px',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '14px',
  },
  offsets: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    alignItems: 'center',
    padding: '0 14px 14px',
    width: '100%',
  },
  offsetField: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  offsetInput: {
    width: '72px',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
  },
  hero: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    padding: '20px',
    width: '100%',
  },
  big: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: 'clamp(22px, 4vw, 34px)',
    fontWeight: 600,
    userSelect: 'all',
    textAlign: 'center',
    overflowWrap: 'anywhere',
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    padding: '8px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  rowLabel: {
    flex: 'none',
    width: '150px',
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
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    width: '100%',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '10px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  statValue: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '16px',
    fontVariantNumeric: 'tabular-nums',
  },
});

export function DateCalculatorTool() {
  const styles = useStyles();
  const toasterId = useId('date-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [mode, setMode] = useState<'diff' | 'add' | 'age'>('diff');
  const [fromText, setFromText] = useState('2026-01-31');
  const [toText, setToText] = useState(todayString());
  const [offsets, setOffsets] = useState<AddOptions>({ ...ZERO_ADD, months: 1 });
  const [businessDays, setBusinessDays] = useState(5);
  const [copied, setCopied] = useState<string | null>(null);

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
        notify('复制失败');
      }
    },
    [notify],
  );

  const from = useMemo(() => parseDate(fromText), [fromText]);
  const to = useMemo(() => parseDate(toText), [toText]);

  const diff = useMemo(
    () => (from.ok && to.ok ? difference(from.date, to.date) : null),
    [from, to],
  );

  const added = useMemo(
    () => (from.ok ? addToDate(from.date, offsets) : null),
    [from, offsets],
  );

  const business = useMemo(
    () => (from.ok ? addBusinessDays(from.date, businessDays) : null),
    [from, businessDays],
  );

  const age = useMemo(
    () => (from.ok && to.ok ? ageFrom(from.date, to.date) : null),
    [from, to],
  );

  const info = useMemo(() => (from.ok ? describeDate(from.date) : null), [from]);

  const setOffset = (key: keyof AddOptions, value: string) => {
    const parsed = Number(value);
    setOffsets((current) => ({
      ...current,
      [key]: Number.isFinite(parsed) ? parsed : 0,
    }));
  };

  const renderRow = (label: string, value: string, copyKey?: string) => (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{value}</span>
      {copyKey && (
        <Tooltip content="复制" relationship="label" withArrow>
          <Button
            appearance="subtle"
            size="small"
            icon={copied === copyKey ? <Checkmark16Regular /> : <Copy16Regular />}
            onClick={() => copy(value, copyKey)}
            aria-label="复制"
          />
        </Tooltip>
      )}
    </div>
  );

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <TabList
            selectedValue={mode}
            onTabSelect={(_, data) => setMode(data.value as 'diff' | 'add' | 'age')}
          >
            <Tab value="diff">两日期相差</Tab>
            <Tab value="add">日期加减</Tab>
            <Tab value="age">年龄 / 生日</Tab>
          </TabList>
          <span className={styles.spacer} />
          <Button
            appearance="subtle"
            size="small"
            onClick={() => {
              setFromText('2026-01-31');
              setToText(todayString());
            }}
          >
            重置
          </Button>
        </div>

        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>这里的「一个月」是日历月，不是 30 天</MessageBarTitle>
            1 月 31 日加 1 个月会得到 2 月 28 日（闰年 29 日）——即<b>截断到目标月的最后一天</b>，
            而不是溢出到 3 月。天数、周数、月数、年数都按日历推进，因此跨夏令时仍然是
            「加一天」而非「加 24 小时」；只有小时与分钟是精确时长。
          </MessageBarBody>
        </MessageBar>

        <section className="wt-surface" aria-label="日期输入">
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.dateRow}>
              <CalendarLtr16Regular style={{ color: tokens.colorBrandForeground1 }} />
              <input
                className={`wt-inline-input ${styles.dateInput}`}
                value={fromText}
                onChange={(event) => setFromText(event.target.value)}
                placeholder="YYYY-MM-DD"
                aria-label={mode === 'age' ? '出生日期' : '起始日期'}
                spellCheck={false}
              />
              {mode !== 'add' && (
                <>
                  <Caption1 className={styles.hint}>
                    {mode === 'age' ? '参考日期' : '结束日期'}
                  </Caption1>
                  <input
                    className={`wt-inline-input ${styles.dateInput}`}
                    value={toText}
                    onChange={(event) => setToText(event.target.value)}
                    placeholder="YYYY-MM-DD"
                    aria-label="结束日期"
                    spellCheck={false}
                  />
                  <Button
                    appearance="secondary"
                    size="small"
                    onClick={() => setToText(todayString())}
                  >
                    今天
                  </Button>
                </>
              )}
            </div>

            {(from.ok || to.ok) && (
              <div className={styles.dateRow} style={{ paddingTop: 0 }}>
                {!from.ok && (
                  <Badge appearance="tint" color="danger" size="small">
                    {from.error}
                  </Badge>
                )}
                {mode !== 'add' && !to.ok && (
                  <Badge appearance="tint" color="danger" size="small">
                    {to.error}
                  </Badge>
                )}
                {from.ok && (
                  <Caption1 className={styles.hint}>
                    已识别为 {toDateTimeString(from.date)}（
                    {from.source === 'timestamp'
                      ? '时间戳'
                      : from.source === 'date-only'
                        ? '仅日期，按本地零点'
                        : '日期时间'}
                    ）
                  </Caption1>
                )}
              </div>
            )}
          </div>
        </section>

        {mode === 'diff' && diff && (
          <>
            <section className="wt-surface" aria-label="相差结果">
              <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                <div className={styles.hero}>
                  <Text className={styles.big}>
                    {diff.negative ? '−' : ''}
                    {diff.years > 0 && `${diff.years} 年 `}
                    {diff.months > 0 && `${diff.months} 个月 `}
                    {diff.days} 天
                  </Text>
                  <Caption1 className={styles.hint}>
                    {formatDurationZh(diff.totalMs)} · 共 {Math.abs(diff.calendarDays)} 天
                  </Caption1>
                  {diff.negative && (
                    <Badge appearance="tint" color="warning" size="small">
                      结束日期早于起始日期，结果按绝对值展示并标为负
                    </Badge>
                  )}
                </div>
                <Divider />
                <div className={styles.rows}>
                  {renderRow('日历天数', String(diff.calendarDays))}
                  {renderRow('完整周数', `${diff.totalWeeks} 周`)}
                  {renderRow('总小时数', diff.totalHours.toLocaleString())}
                  {renderRow('总分钟数', diff.totalMinutes.toLocaleString())}
                  {renderRow('工作日数', `${diff.businessDays} 天（周一至周五）`)}
                  {renderRow(
                    '时分秒余数',
                    `${diff.hours} 小时 ${diff.minutes} 分 ${diff.seconds} 秒`,
                  )}
                </div>
              </div>
            </section>

            <MessageBar intent="warning">
              <MessageBarBody>
                「工作日数」只排除周六周日。各国法定节假日无法自动推断，
                如需精确的工作日请自行扣除节假日。
              </MessageBarBody>
            </MessageBar>
          </>
        )}

        {mode === 'add' && added && (
          <>
            <section className="wt-surface" aria-label="偏移设置">
              <div className="wt-surface__header">
                <Text size={300} weight="semibold">
                  偏移
                </Text>
                <span className={styles.spacer} />
                <Caption1 className={styles.hint}>
                  正数为向后，负数为向前
                </Caption1>
              </div>
              <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                <div className={styles.dateRow}>
                  {(
                    [
                      ['years', '年'],
                      ['months', '月'],
                      ['weeks', '周'],
                      ['days', '天'],
                      ['hours', '小时'],
                      ['minutes', '分钟'],
                    ] as const
                  ).map(([key, label]) => (
                    <span key={key} className={styles.offsetField}>
                      <input
                        className={`wt-inline-input ${styles.offsetInput}`}
                        value={String(offsets[key])}
                        onChange={(event) => setOffset(key, event.target.value)}
                        aria-label={label}
                        spellCheck={false}
                      />
                      <Caption1 className={styles.hint}>{label}</Caption1>
                    </span>
                  ))}
                </div>

                <div className={styles.offsets}>
                  {QUICK_OFFSETS.map((quick) => (
                    <Button
                      key={quick.label}
                      appearance="secondary"
                      size="small"
                      icon={
                        quick.label.startsWith('−') ? (
                          <Subtract16Regular />
                        ) : (
                          <Add16Regular />
                        )
                      }
                      onClick={() =>
                        setOffsets((current) => {
                          const next = { ...current };
                          for (const [key, value] of Object.entries(quick.options)) {
                            next[key as keyof AddOptions] += value as number;
                          }
                          return next;
                        })
                      }
                    >
                      {quick.label}
                    </Button>
                  ))}
                  <Button appearance="subtle" size="small" onClick={() => setOffsets(ZERO_ADD)}>
                    清零
                  </Button>
                </div>
              </div>
            </section>

            <section className="wt-surface" aria-label="计算结果">
              <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                <div className={styles.hero}>
                  <Text className={styles.big}>{toDateString(added)}</Text>
                  <Caption1 className={styles.hint}>
                    {toDateTimeString(added)} · {describeDate(added).weekday}
                  </Caption1>
                  <Button
                    appearance="secondary"
                    size="small"
                    icon={copied === 'added' ? <Checkmark16Regular /> : <Copy16Regular />}
                    onClick={() => copy(toDateString(added), 'added')}
                  >
                    复制日期
                  </Button>
                </div>
              </div>
            </section>

            <section className="wt-surface" aria-label="工作日推算">
              <div className="wt-surface__header">
                <Text size={300} weight="semibold">
                  按工作日推算
                </Text>
                <span className={styles.spacer} />
                <Caption1 className={styles.hint}>跳过周六周日</Caption1>
              </div>
              <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                <div className={styles.dateRow}>
                  <input
                    className={`wt-inline-input ${styles.offsetInput}`}
                    value={String(businessDays)}
                    onChange={(event) => setBusinessDays(Number(event.target.value) || 0)}
                    aria-label="工作日数量"
                    spellCheck={false}
                  />
                  <Caption1 className={styles.hint}>个工作日之后</Caption1>
                  {business && (
                    <Badge appearance="tint" color="brand" size="medium">
                      {toDateString(business)} · {describeDate(business).weekday}
                    </Badge>
                  )}
                </div>
                <Caption1 className={styles.hint} style={{ padding: '0 14px 12px' }}>
                  只排除周末；法定节假日需要自行调整。
                </Caption1>
              </div>
            </section>
          </>
        )}

        {mode === 'age' && age && (
          <>
            <section className="wt-surface" aria-label="年龄">
              <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                <div className={styles.hero}>
                  <Text className={styles.big}>
                    {age.years} 岁 {age.months} 个月 {age.days} 天
                  </Text>
                  <Caption1 className={styles.hint}>
                    共 {age.totalDays.toLocaleString()} 天
                  </Caption1>
                </div>
                <Divider />
                <div className={styles.rows}>
                  {renderRow('下次生日', toDateString(age.nextBirthday))}
                  {renderRow('距下次生日', `${age.daysToNextBirthday} 天`)}
                  {renderRow('下次生日是', age.nextBirthdayWeekday)}
                  {renderRow(
                    '总周数',
                    `${Math.floor(age.totalDays / 7).toLocaleString()} 周`,
                  )}
                </div>
              </div>
            </section>
          </>
        )}

        {info && (
          <section className="wt-surface" aria-label="日期信息">
            <div className="wt-surface__header">
              <Text size={300} weight="semibold">
                起始日期的信息
              </Text>
              <span className={styles.spacer} />
              <Caption1 className={styles.hint}>{info.timeZone}</Caption1>
            </div>
            <div className={`wt-surface__body ${styles.stats}`}>
              {[
                ['星期', info.weekday],
                ['ISO 周', `第 ${info.isoWeek} 周`],
                ['年内第几天', String(info.dayOfYear)],
                ['当月天数', String(info.daysInMonth)],
                ['季度', `Q${info.quarter}`],
                ['闰年', info.isLeapYear ? '是' : '否'],
                ['时区偏移', `${info.offsetMinutes >= 0 ? '+' : ''}${info.offsetMinutes / 60} 小时`],
              ].map(([label, value]) => (
                <div key={label} className={styles.stat}>
                  <Caption1 className={styles.hint}>{label}</Caption1>
                  <span className={styles.statValue}>{value}</span>
                </div>
              ))}
            </div>
            <Divider />
            <div className={styles.rows}>
              {renderRow('时间戳（秒）', String(info.timestampSeconds), 'ts')}
              {renderRow('时间戳（毫秒）', String(info.timestampMs))}
              {renderRow('ISO 8601', info.iso)}
              {renderRow('UTC 字符串', info.utc)}
            </div>
          </section>
        )}

        <Caption1 className={styles.hint} style={{ padding: '0 4px' }}>
          所有计算都在本地完成。日期按你所在时区（{info?.timeZone ?? '本机'}）解释，
          仅当输入带 Z 或时区偏移时才按绝对时刻处理。
        </Caption1>

        <Divider />
      </div>
    </>
  );
}
