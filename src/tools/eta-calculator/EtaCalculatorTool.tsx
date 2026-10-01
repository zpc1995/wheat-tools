import { useState } from 'react';
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
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  Clock16Regular,
  DataTrending16Regular,
  History16Regular,
  Hourglass16Regular,
} from '@fluentui/react-icons';
import {
  INPUT_UNITS,
  UNIT_LABEL,
  UNIT_MS,
  autoUnit,
  estimateEta,
  estimateFromPerItem,
  estimateFromTimes,
  formatDurationHuman,
  formatDurationIn,
  formatNumber,
  formatOffset,
  formatTimestamp,
  fromMs,
  parseLocalDateTime,
  toMs,
  type EtaEstimate,
  type EtaResult,
  type TimeUnit,
} from './etaUtils';

type Mode = 'progress' | 'start' | 'perItem' | 'format';

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
    gap: '8px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  fields: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    padding: '12px 14px',
    width: '100%',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: '0 1 190px',
    minWidth: '130px',
  },
  fieldWide: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: '0 1 300px',
    minWidth: '200px',
  },
  fieldLabel: {
    color: tokens.colorNeutralForeground3,
  },
  select: {
    width: '100%',
  },
  results: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '0 14px 14px',
    width: '100%',
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '12px',
    padding: '7px 0',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
    flexWrap: 'wrap',
  },
  rowLabel: {
    minWidth: '110px',
    color: tokens.colorNeutralForeground3,
  },
  rowValue: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    fontSize: '16px',
    userSelect: 'all',
    overflowWrap: 'anywhere',
  },
  bigValue: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    fontSize: 'clamp(20px, 3vw, 28px)',
    fontWeight: 600,
    userSelect: 'all',
    overflowWrap: 'anywhere',
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    userSelect: 'all',
  },
});

function toNumber(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? Number.NaN : Number(trimmed);
}

function NumberField({
  label,
  value,
  onChange,
  placeholder,
  wide,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  wide?: boolean;
}) {
  const styles = useStyles();
  return (
    <label className={wide ? styles.fieldWide : styles.field}>
      <Caption1 className={styles.fieldLabel}>{label}</Caption1>
      <input
        className="wt-inline-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode="decimal"
        aria-label={label}
        spellCheck={false}
      />
    </label>
  );
}

function UnitField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: TimeUnit;
  onChange: (unit: TimeUnit) => void;
}) {
  const styles = useStyles();
  return (
    <label className={styles.field}>
      <Caption1 className={styles.fieldLabel}>{label}</Caption1>
      <select
        className={`wt-inline-input ${styles.select}`}
        value={value}
        onChange={(event) => onChange(event.target.value as TimeUnit)}
        aria-label={label}
      >
        {INPUT_UNITS.map((unit) => (
          <option key={unit} value={unit}>
            {UNIT_LABEL[unit]}
          </option>
        ))}
      </select>
    </label>
  );
}

function DateTimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const styles = useStyles();
  return (
    <label className={styles.fieldWide}>
      <Caption1 className={styles.fieldLabel}>{label}</Caption1>
      <input
        className="wt-inline-input"
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
      />
    </label>
  );
}

function labelForLevel(level: 'low' | 'medium' | 'high'): string {
  return level === 'low' ? '不可靠' : level === 'medium' ? '大致可用' : '相对可靠';
}

function intentForLevel(level: 'low' | 'medium' | 'high') {
  return level === 'low' ? 'warning' : level === 'medium' ? 'info' : 'success';
}

/**
 * Picks the speed unit in which the rate reads as at least one item per unit.
 * 24 seconds per item is "2.5 项/分钟", not "0.042 项/秒" — the number is the
 * same, but only the first is readable at a glance.
 */
function speedUnitFor(ratePerMs: number): TimeUnit {
  for (const unit of ['second', 'minute', 'hour', 'day'] as TimeUnit[]) {
    if (ratePerMs * UNIT_MS[unit] >= 1) return unit;
  }
  return 'day';
}

function EstimatePanel({
  estimate,
  offsetMinutes,
}: {
  estimate: EtaEstimate;
  offsetMinutes: number;
}) {
  const styles = useStyles();
  const speedUnit = speedUnitFor(
    estimate.ratePerMs === null || estimate.ratePerMs === 0
      ? 0
      : estimate.ratePerMs,
  );
  const speed =
    estimate.ratePerMs === null
      ? null
      : estimate.ratePerMs * UNIT_MS[speedUnit];

  return (
    <>
      <div className={styles.rows}>
        <div className={styles.row}>
          <Caption1 className={styles.rowLabel}>剩余时间</Caption1>
          <span className={styles.bigValue}>{formatDurationHuman(estimate.remainingMs)}</span>
          <Caption1 className={styles.hint}>
            （{formatNumber(estimate.remainingMs, 0)} 毫秒；剩余{' '}
            {formatNumber(estimate.remainingItems, 0)} 项）
          </Caption1>
        </div>
        <div className={styles.row}>
          <Caption1 className={styles.rowLabel}>速度</Caption1>
          <span className={styles.rowValue}>
            {speed === null ? '无法计算（未完成任何项目）' : `${formatNumber(speed, 3)} 项 / ${UNIT_LABEL[speedUnit]}`}
          </span>
          {estimate.basis === 'assumed' && (
            <Badge appearance="tint" color="informative" size="small">
              按给定单价的假设
            </Badge>
          )}
        </div>
        <div className={styles.row}>
          <Caption1 className={styles.rowLabel}>开始后多久完成</Caption1>
          <span className={styles.rowValue}>
            {formatDurationHuman(estimate.elapsedMs + estimate.remainingMs)}
          </span>
        </div>
        <div className={styles.row}>
          <Caption1 className={styles.rowLabel}>预计完成时刻</Caption1>
          <span className={styles.rowValue}>
            {estimate.finishAtMs === null
              ? '未提供当前时刻，只给相对时间'
              : formatTimestamp(estimate.finishAtMs, offsetMinutes)}
          </span>
          {estimate.finishAtMs !== null && (
            <Caption1 className={styles.hint}>({formatOffset(offsetMinutes)})</Caption1>
          )}
        </div>
        <div className={styles.row}>
          <Caption1 className={styles.rowLabel}>不确定度</Caption1>
          <span className={styles.rowValue}>
            {estimate.confidence.spreadMs === null
              ? '无法量化'
              : `约 ±${formatDurationHuman(estimate.confidence.spreadMs)}`}
          </span>
          {estimate.confidence.spreadRatio !== null && (
            <Caption1 className={styles.hint}>
              （相对 ±{formatNumber(estimate.confidence.spreadRatio * 100, 0)}%）
            </Caption1>
          )}
        </div>
      </div>

      <MessageBar intent={intentForLevel(estimate.confidence.level)}>
        <MessageBarBody>
          <MessageBarTitle>
            预估可信度：{labelForLevel(estimate.confidence.level)}
          </MessageBarTitle>
          {estimate.confidence.reason}
          {estimate.confidence.level === 'low' &&
            '——已用时间或完成项数太少，这个时间是推算出来的，不要当成承诺。'}
        </MessageBarBody>
      </MessageBar>

      {estimate.notes.map((note) => (
        <Caption1 key={note} className={styles.hint}>
          · {note}
        </Caption1>
      ))}
    </>
  );
}

function ResultPanel({
  result,
  offsetMinutes,
}: {
  result: EtaResult;
  offsetMinutes: number;
}) {
  const styles = useStyles();
  if (!result.ok) {
    return (
      <div className={styles.row}>
        <Badge appearance="tint" color="danger" size="small">
          无法估计
        </Badge>
        <span className={styles.rowValue}>{result.error}</span>
      </div>
    );
  }
  return <EstimatePanel estimate={result.value} offsetMinutes={offsetMinutes} />;
}

export function EtaCalculatorTool() {
  const styles = useStyles();
  const [mode, setMode] = useState<Mode>('progress');

  const [total, setTotal] = useState('100');
  const [completed, setCompleted] = useState('25');
  const [elapsed, setElapsed] = useState('10');
  const [elapsedUnit, setElapsedUnit] = useState<TimeUnit>('minute');

  const [startText, setStartText] = useState('');
  const [nowText, setNowText] = useState('');

  const [remainingItems, setRemainingItems] = useState('12');
  const [perItem, setPerItem] = useState('5');
  const [perItemUnit, setPerItemUnit] = useState<TimeUnit>('minute');

  const [formatValue, setFormatValue] = useState('90');
  const [formatUnit, setFormatUnit] = useState<TimeUnit>('minute');

  // The offset and the "now" value are supplied by the environment here, at the
  // edge — the utils never read a clock, which is what makes them testable.
  const [offsetMinutes] = useState(() => -new Date().getTimezoneOffset());

  const fillNow = () => {
    setNowText(formatTimestamp(Date.now(), offsetMinutes).replace(' ', 'T').slice(0, 16));
  };

  const currentAtMs =
    nowText.trim() === '' ? null : parseLocalDateTime(nowText, offsetMinutes);

  const progressResult = estimateEta(
    {
      total: toNumber(total),
      completed: toNumber(completed),
      elapsedMs: toMs(toNumber(elapsed), elapsedUnit),
    },
    { currentAtMs },
  );

  const startAtMs =
    startText.trim() === '' ? null : parseLocalDateTime(startText, offsetMinutes);
  const startResult: EtaResult =
    startAtMs === null || currentAtMs === null
      ? {
          ok: false,
          code: 'invalid-input',
          error: '请填写「开始时间」与「当前时刻」（当前时刻可点右侧按钮填入）',
        }
      : estimateFromTimes(toNumber(total), toNumber(completed), startAtMs, currentAtMs);

  const perItemResult = estimateFromPerItem(
    toNumber(remainingItems),
    toMs(toNumber(perItem), perItemUnit),
    { currentAtMs },
  );

  const formatMs = toMs(toNumber(formatValue), formatUnit);
  const auto = autoUnit(formatMs);

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <TabList
          selectedValue={mode}
          onTabSelect={(_, data) => setMode(data.value as Mode)}
        >
          <Tab value="progress">按进度估算</Tab>
          <Tab value="start">按开始时间</Tab>
          <Tab value="perItem">每项耗时</Tab>
          <Tab value="format">时长格式化</Tab>
        </TabList>
        <span className={styles.spacer} />
        <Button appearance="secondary" size="small" onClick={fillNow}>
          当前时刻 = 现在
        </Button>
      </div>

      <MessageBar intent="info">
        <MessageBarBody>
          <MessageBarTitle>这只做算术，不读系统时钟</MessageBarTitle>
          估算用的时间基准全部来自输入框（「当前时刻 = 现在」按钮也只是把此刻填进输入框），
          因此同一组输入永远得到同一个结果。数据少的时候会明确标注「不可靠」并给出大致误差范围，
          而不是给出一个假装精确的时刻。
        </MessageBarBody>
      </MessageBar>

      {mode === 'progress' && (
        <>
          <section className="wt-surface" aria-label="按进度估算输入">
            <div className="wt-surface__header">
              <DataTrending16Regular />
              <Text as="h2" size={300} weight="semibold">
                总量、已完成、已用时间
              </Text>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.fields}>
                <NumberField label="总量（项）" value={total} onChange={setTotal} />
                <NumberField label="已完成（项）" value={completed} onChange={setCompleted} />
                <NumberField label="已用时间" value={elapsed} onChange={setElapsed} />
                <UnitField label="时间单位" value={elapsedUnit} onChange={setElapsedUnit} />
                <DateTimeField label="当前时刻（可选，用于算出绝对完成时刻）" value={nowText} onChange={setNowText} />
              </div>
            </div>
          </section>

          <section className="wt-surface" aria-label="按进度估算结果">
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                估算结果
              </Text>
              <span className={styles.spacer} />
              <Caption1 className={styles.hint}>
                剩余时间 = 剩余项数 × 已用时间 ÷ 已完成数
              </Caption1>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.results}>
                <ResultPanel result={progressResult} offsetMinutes={offsetMinutes} />
              </div>
            </div>
          </section>
        </>
      )}

      {mode === 'start' && (
        <>
          <section className="wt-surface" aria-label="按开始时间输入">
            <div className="wt-surface__header">
              <History16Regular />
              <Text as="h2" size={300} weight="semibold">
                开始时间与当前时刻
              </Text>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.fields}>
                <NumberField label="总量（项）" value={total} onChange={setTotal} />
                <NumberField label="已完成（项）" value={completed} onChange={setCompleted} />
                <DateTimeField label="开始时间" value={startText} onChange={setStartText} />
                <DateTimeField label="当前时刻" value={nowText} onChange={setNowText} />
              </div>
              <Caption1 className={styles.hint} style={{ padding: '0 14px 12px' }}>
                已用时间 = 当前时刻 − 开始时间，跨天、跨月由日历计算（{formatOffset(offsetMinutes)}）。
              </Caption1>
            </div>
          </section>

          <section className="wt-surface" aria-label="按开始时间估算结果">
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                估算结果
              </Text>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.results}>
                <ResultPanel result={startResult} offsetMinutes={offsetMinutes} />
              </div>
            </div>
          </section>
        </>
      )}

      {mode === 'perItem' && (
        <>
          <section className="wt-surface" aria-label="每项耗时输入">
            <div className="wt-surface__header">
              <Hourglass16Regular />
              <Text as="h2" size={300} weight="semibold">
                剩余项目数 × 每项耗时
              </Text>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.fields}>
                <NumberField label="剩余项目数" value={remainingItems} onChange={setRemainingItems} />
                <NumberField label="每项耗时" value={perItem} onChange={setPerItem} />
                <UnitField label="时间单位" value={perItemUnit} onChange={setPerItemUnit} />
                <DateTimeField label="当前时刻（可选）" value={nowText} onChange={setNowText} />
              </div>
            </div>
          </section>

          <section className="wt-surface" aria-label="每项耗时估算结果">
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                估算结果
              </Text>
              <span className={styles.spacer} />
              <Caption1 className={styles.hint}>剩余时间 = 剩余项目数 × 每项耗时</Caption1>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.results}>
                <ResultPanel result={perItemResult} offsetMinutes={offsetMinutes} />
              </div>
            </div>
          </section>
        </>
      )}

      {mode === 'format' && (
        <section className="wt-surface" aria-label="时长格式化">
          <div className="wt-surface__header">
            <Clock16Regular />
            <Text as="h2" size={300} weight="semibold">
              时长格式化与单位换算
            </Text>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.fields}>
              <NumberField label="数值" value={formatValue} onChange={setFormatValue} />
              <UnitField label="单位" value={formatUnit} onChange={setFormatUnit} />
            </div>
            <div className={styles.results}>
              <div className={styles.row}>
                <Caption1 className={styles.rowLabel}>自动选择单位</Caption1>
                <span className={styles.bigValue}>{formatDurationHuman(formatMs)}</span>
                <Caption1 className={styles.hint}>
                  （{formatNumber(formatMs, 0)} 毫秒，显示单位：{UNIT_LABEL[auto]}）
                </Caption1>
              </div>
              <div className={styles.rows}>
                {(['millisecond', 'second', 'minute', 'hour', 'day'] as TimeUnit[]).map((unit) => (
                  <div className={styles.row} key={unit}>
                    <Caption1 className={styles.rowLabel}>以{UNIT_LABEL[unit]}计</Caption1>
                    <span className={styles.rowValue}>
                      {formatDurationIn(formatMs, unit, 4)} {UNIT_LABEL[unit]}
                    </span>
                    <Caption1 className={styles.hint}>
                      （{formatNumber(fromMs(formatMs, unit), 4)}）
                    </Caption1>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      <MessageBar intent="warning">
        <MessageBarBody>
          <MessageBarTitle>明确不做的事</MessageBarTitle>
          不做进度持久化（刷新页面即清空）；不预测人的效率变化（只把当前的已测速度线性外推）；
          不读系统时钟（时间基准由输入提供）。已完成量为 0、已用时间为 0、已完成大于总量都会
          明确报错，而不是用 Infinity 或 NaN 凑一个数字。
        </MessageBarBody>
      </MessageBar>

      <Divider />
    </div>
  );
}
