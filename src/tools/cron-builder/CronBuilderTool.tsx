import { useCallback, useEffect, useMemo, useState } from 'react';
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
  CalendarClock16Regular,
  Checkmark16Regular,
  Copy16Regular,
  Flash16Regular,
  Wrench16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  CRON_TEMPLATES,
  describeCron,
  formatDelta,
  formatRun,
  isImpossible,
  nextRuns,
  parseCron,
  type FieldKey,
} from './cronUtils';

/**
 * Builder state: one raw cron fragment per field. Keeping the fragments (not
 * the resolved numbers) means the builder can round-trip anything the user
 * types, including steps and lists.
 */
type BuilderState = Record<FieldKey, string>;

const DEFAULT_BUILDER: BuilderState = {
  second: '0',
  minute: '0',
  hour: '9',
  dayOfMonth: '*',
  month: '*',
  dayOfWeek: '1-5',
};

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  expressionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '14px',
    flexWrap: 'wrap',
  },
  expressionInput: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '17px',
    letterSpacing: '0.06em',
  },
  fieldGrid: {
    display: 'grid',
    gap: '12px',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    width: '100%',
    padding: '14px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  fieldLabel: {
    color: tokens.colorNeutralForeground3,
  },
  runs: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  runRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  runIndex: {
    flex: 'none',
    width: '26px',
    color: tokens.colorNeutralForeground4,
    fontVariantNumeric: 'tabular-nums',
  },
  runTime: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
  },
  runDelta: {
    color: tokens.colorNeutralForeground3,
  },
  templates: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    padding: '12px 14px',
  },
  describe: {
    padding: '0 14px 14px',
    color: tokens.colorNeutralForeground1,
  },
});

export function CronBuilderTool() {
  const styles = useStyles();
  const toasterId = useId('cron-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [expression, setExpression] = useState('0 9 * * 1-5');
  const [mode, setMode] = useState<'expression' | 'builder'>('expression');
  const [builder, setBuilder] = useState<BuilderState>(DEFAULT_BUILDER);
  const [includeSeconds, setIncludeSeconds] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Keep the preview fresh without recomputing on every render.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Builder fragments are joined in canonical order; seconds are optional.
  const builderExpression = useMemo(() => {
    const parts = [
      builder.minute,
      builder.hour,
      builder.dayOfMonth,
      builder.month,
      builder.dayOfWeek,
    ];
    return includeSeconds ? [builder.second, ...parts].join(' ') : parts.join(' ');
  }, [builder, includeSeconds]);

  const activeExpression = mode === 'builder' ? builderExpression : expression;
  const parsed = useMemo(() => parseCron(activeExpression), [activeExpression]);

  const runs = useMemo(() => {
    if (!parsed.ok) return [];
    return nextRuns(parsed.value, 8, now);
  }, [parsed, now]);

  const impossible = useMemo(
    () => (parsed.ok ? isImpossible(parsed.value) : false),
    [parsed],
  );

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

  const copyExpression = useCallback(async () => {
    const ok = await copyText(activeExpression);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
      notify('已复制表达式');
    } else {
      notify('复制失败');
    }
  }, [activeExpression, notify]);

  const applyTemplate = useCallback(
    (value: string) => {
      setExpression(value);
      setMode('expression');
      if (value.trim().split(/\s+/).length === 6) setIncludeSeconds(true);
    },
    [],
  );

  const setField = useCallback((key: FieldKey, value: string) => {
    setBuilder((previous) => ({ ...previous, [key]: value }));
  }, []);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <section className="wt-surface" aria-label="CRON 表达式">
          <div className="wt-surface__header">
            <CalendarClock16Regular />
            <Text size={300} weight="semibold">
              CRON 表达式
            </Text>
            {parsed.ok ? (
              <Badge appearance="tint" color={impossible ? 'warning' : 'success'} size="small">
                {impossible ? '永不触发' : `合法 · ${parsed.value.fields.length} 段`}
              </Badge>
            ) : (
              <Badge appearance="tint" color="danger" size="small">
                表达式无效
              </Badge>
            )}
            <span className={styles.spacer} />
            <TabList
              size="small"
              selectedValue={mode}
              onTabSelect={(_, data) =>
                setMode(data.value as 'expression' | 'builder')
              }
            >
              <Tab value="expression">表达式</Tab>
              <Tab value="builder">可视化构建</Tab>
            </TabList>
          </div>

          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            {mode === 'expression' ? (
              <div className={styles.expressionRow}>
                <input
                  className={`wt-inline-input ${styles.expressionInput}`}
                  value={expression}
                  onChange={(event) => setExpression(event.target.value)}
                  placeholder="分 时 日 月 周（可选前置秒），例如 0 9 * * 1-5"
                  aria-label="CRON 表达式"
                  spellCheck={false}
                />
                <Tooltip content="复制表达式" relationship="label" withArrow>
                  <Button
                    appearance="secondary"
                    icon={
                      copied ? <Checkmark16Regular /> : <Copy16Regular />
                    }
                    onClick={copyExpression}
                  >
                    复制
                  </Button>
                </Tooltip>
              </div>
            ) : (
              <div className={styles.fieldGrid}>
                {includeSeconds && (
                  <label className={styles.field}>
                    <Caption1 className={styles.fieldLabel}>秒 (0-59)</Caption1>
                    <input
                      className="wt-inline-input"
                      value={builder.second}
                      onChange={(event) => setField('second', event.target.value)}
                    />
                  </label>
                )}
                <label className={styles.field}>
                  <Caption1 className={styles.fieldLabel}>分钟 (0-59)</Caption1>
                  <input
                    className="wt-inline-input"
                    value={builder.minute}
                    onChange={(event) => setField('minute', event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <Caption1 className={styles.fieldLabel}>小时 (0-23)</Caption1>
                  <input
                    className="wt-inline-input"
                    value={builder.hour}
                    onChange={(event) => setField('hour', event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <Caption1 className={styles.fieldLabel}>日 (1-31)</Caption1>
                  <input
                    className="wt-inline-input"
                    value={builder.dayOfMonth}
                    onChange={(event) => setField('dayOfMonth', event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <Caption1 className={styles.fieldLabel}>月 (1-12)</Caption1>
                  <input
                    className="wt-inline-input"
                    value={builder.month}
                    onChange={(event) => setField('month', event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <Caption1 className={styles.fieldLabel}>星期 (0-6, 0=周日)</Caption1>
                  <input
                    className="wt-inline-input"
                    value={builder.dayOfWeek}
                    onChange={(event) => setField('dayOfWeek', event.target.value)}
                  />
                </label>
                <div className={styles.field}>
                  <Caption1 className={styles.fieldLabel}>精度</Caption1>
                  <Button
                    appearance={includeSeconds ? 'primary' : 'secondary'}
                    onClick={() => setIncludeSeconds((value) => !value)}
                    icon={<Wrench16Regular />}
                  >
                    {includeSeconds ? '含秒（6 段）' : '不含秒（5 段）'}
                  </Button>
                </div>
              </div>
            )}

            {mode === 'builder' && (
              <>
                <Divider />
                <div className={styles.expressionRow}>
                  <Caption1 className={styles.fieldLabel}>生成的表达式</Caption1>
                  <code className={styles.expressionInput}>{builderExpression}</code>
                </div>
              </>
            )}

            {parsed.ok && (
              <>
                <Divider />
                <div className={styles.describe}>
                  <Text size={400} weight="semibold">
                    {describeCron(parsed.value)}
                  </Text>
                </div>
              </>
            )}
          </div>
        </section>

        {!parsed.ok && (
          <MessageBar intent="error">
            <MessageBarBody>
              <MessageBarTitle>表达式无效</MessageBarTitle>
              {parsed.error}
            </MessageBarBody>
          </MessageBar>
        )}

        {parsed.ok && impossible && (
          <MessageBar intent="warning">
            <MessageBarBody>
              <MessageBarTitle>该表达式永远不会触发</MessageBarTitle>
              例如“2 月 30 日”这类不存在的日期组合，请检查「日」与「月」字段。
            </MessageBarBody>
          </MessageBar>
        )}

        <section className="wt-surface" aria-label="常用模板">
          <div className="wt-surface__header">
            <Flash16Regular />
            <Text size={300} weight="semibold">
              常用模板
            </Text>
            <span className={styles.spacer} />
            <Caption1>点击直接套用</Caption1>
          </div>
          <div className={styles.templates}>
            {CRON_TEMPLATES.map((template) => (
              <Tooltip
                key={template.expression}
                content={`${template.expression} · ${template.description}`}
                relationship="description"
                withArrow
              >
                <Button
                  appearance="secondary"
                  size="small"
                  onClick={() => applyTemplate(template.expression)}
                >
                  {template.label}
                </Button>
              </Tooltip>
            ))}
          </div>
        </section>

        {parsed.ok && !impossible && (
          <section className="wt-surface" aria-label="接下来 8 次执行">
            <div className="wt-surface__header">
              <CalendarClock16Regular />
              <Text size={300} weight="semibold">
                接下来 8 次执行
              </Text>
              <span className={styles.spacer} />
              <Caption1>按浏览器本地时区计算</Caption1>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.runs}>
                {runs.map((run, index) => (
                  <div key={run.date.getTime()} className={styles.runRow}>
                    <Caption1 className={styles.runIndex}>#{index + 1}</Caption1>
                    <span className={styles.runTime}>{formatRun(run.date)}</span>
                    <span className={styles.spacer} />
                    <Caption1 className={styles.runDelta}>
                      {formatDelta(run.deltaMs)}
                    </Caption1>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
