import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Dropdown,
  Option,
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
  Checkmark16Regular,
  Clock16Regular,
  Copy16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  ONCALENDAR_SAMPLES,
  onCalendarToCron,
} from './onCalendarUtils';
import {
  WORKFLOW_SAMPLES,
  analyseWorkflow,
  type WorkflowAnalysis,
} from './actionsUtils';
import {
  CRONTAB_SAMPLES,
  parseCrontab,
  type CrontabAnalysis,
  type CrontabDialect,
} from './crontabUtils';
import {
  CRON_CONVERT_SAMPLES,
  parseCron,
  toCrontab,
  toGithubActions,
  toHuman,
  toSystemd,
  type ConversionOutput,
} from './cronConvertUtils';

type Target = 'systemd' | 'github-actions' | 'crontab' | 'human';

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
  output: {
    padding: '14px',
    width: '100%',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '15px',
    letterSpacing: '0.02em',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 14px',
    width: '100%',
  },
  cell: {
    flex: '1 1 0',
    minWidth: 0,
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  presets: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    padding: '12px 14px',
    width: '100%',
  },
  input: {
    width: '100%',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '17px',
    letterSpacing: '0.03em',
  },
  notes: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '14px',
    width: '100%',
  },
  note: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
  },
});

export function CronConvertTool() {
  const styles = useStyles();
  const toasterId = useId('cronc-toaster');
  const { dispatchToast } = useToastController(toasterId);

  type Direction = 'cron-to' | 'oncalendar-to-cron' | 'actions-to-cron' | 'crontab-parse';
  const [direction, setDirection] = useState<Direction>('cron-to');
  const [expression, setExpression] = useState('*/5 * * * *');
  /** Separate input for the reverse direction so switching does not clobber it. */
  const [onCalendar, setOnCalendar] = useState('Mon..Fri *-*-* 09:00:00');
  const [workflow, setWorkflow] = useState(WORKFLOW_SAMPLES[0].yaml);
  const [crontab, setCrontab] = useState(CRONTAB_SAMPLES[0].text);
  const [crontabDialect, setCrontabDialect] = useState<CrontabDialect>('auto');
  const [target, setTarget] = useState<Target>('systemd');
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

  const parsed = useMemo(() => parseCron(expression), [expression]);

  const reverse = useMemo(() => onCalendarToCron(onCalendar), [onCalendar]);
  const actions = useMemo(() => analyseWorkflow(workflow), [workflow]);
  const parsedCrontab = useMemo(
    () => parseCrontab(crontab, { dialect: crontabDialect }),
    [crontab, crontabDialect],
  );

  const output: ConversionOutput | { error: string } = useMemo(() => {
    switch (target) {
      case 'systemd':
        return toSystemd(expression);
      case 'github-actions':
        return toGithubActions(expression);
      case 'crontab':
        return toCrontab(expression);
      case 'human':
        return toHuman(expression);
    }
  }, [expression, target]);

  /**
   * Copies text and flashes feedback on the control identified by `key`.
   *
   * Takes the text as an argument rather than reading `output` so the reverse
   * panel can reuse it for its own result.
   */
  const copy = useCallback(
    async (text: string, key: string) => {
      const ok = await copyText(text);
      if (ok) {
        setCopied(key);
        window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1400);
        notify('已复制');
      } else {
        notify('复制失败');
      }
    },
    [notify],
  );

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <TabList
            selectedValue={direction}
            onTabSelect={(_, data) => {
              setDirection(data.value as Direction);
              setCopied(null);
            }}
          >
            <Tab value="cron-to">cron → 其它格式</Tab>
            <Tab value="oncalendar-to-cron">systemd OnCalendar → cron</Tab>
            <Tab value="actions-to-cron">Actions workflow → 计划</Tab>
            <Tab value="crontab-parse">crontab → 计划</Tab>
          </TabList>
          <span className={styles.spacer} />
          <Caption1 className={styles.hint}>
            {direction === 'cron-to'
              ? 'cron 表达式转换为 systemd / Actions / crontab'
              : direction === 'oncalendar-to-cron'
                ? '把 systemd 的 OnCalendar 翻译回 cron'
                : direction === 'actions-to-cron'
                  ? '分析 workflow 里的定时计划（含 UTC 与本地时间对照）'
                  : '解析 crontab 内容，逐个任务说明计划与注意事项'}
          </Caption1>
        </div>

        {direction === 'oncalendar-to-cron' && (
          <OnCalendarSection
            value={onCalendar}
            onChange={setOnCalendar}
            result={reverse}
            copied={copied}
            onCopy={copy}
          />
        )}

        {direction === 'crontab-parse' && (
          <CrontabSection
            value={crontab}
            onChange={setCrontab}
            dialect={crontabDialect}
            onDialectChange={setCrontabDialect}
            result={parsedCrontab}
            copied={copied}
            onCopy={copy}
          />
        )}

        {direction === 'actions-to-cron' && (
          <ActionsSection
            value={workflow}
            onChange={setWorkflow}
            result={actions}
            copied={copied}
            onCopy={copy}
          />
        )}

        {direction === 'cron-to' && (
          <>
        <section className="wt-surface" aria-label="cron 表达式">
          <div className="wt-surface__header">
            <Clock16Regular />
            <Text size={300} weight="semibold">
              cron 表达式
            </Text>
            {parsed.ok ? (
              <Badge appearance="tint" color="success" size="small">
                语法有效
              </Badge>
            ) : (
              <Badge appearance="tint" color="danger" size="small">
                语法错误
              </Badge>
            )}
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              分 时 日 月 周（可加一段秒，共 6 段）
            </Caption1>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div style={{ padding: '12px 14px', width: '100%' }}>
              <input
                className={`wt-inline-input ${styles.input}`}
                value={expression}
                onChange={(event) => setExpression(event.target.value)}
                placeholder="*/5 * * * *"
                aria-label="cron 表达式"
                spellCheck={false}
              />
            </div>
            <div className={styles.presets}>
              {CRON_CONVERT_SAMPLES.map((sample) => (
                <Button
                  key={sample.expression}
                  appearance="secondary"
                  size="small"
                  onClick={() => setExpression(sample.expression)}
                >
                  {sample.label}
                </Button>
              ))}
            </div>
          </div>
        </section>

        {!parsed.ok && (
          <MessageBar intent="error">
            <MessageBarBody>{parsed.error}</MessageBarBody>
          </MessageBar>
        )}

        {/* The reason this tool exists: the targets disagree semantically. */}
        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>转换会明确标出语义差异</MessageBarTitle>
            最典型的一处：<strong>cron 的「日」与「星期」是并集</strong>
            （任一满足即触发），而 <strong>systemd 是交集</strong>（必须同时满足）。
            这类无法一一对应的表达式不会被悄悄近似，而是在结果里标注出来。
            另外 GitHub Actions 只接受 5 段表达式且按 UTC 执行，无法表达秒级调度。
          </MessageBarBody>
        </MessageBar>

        {parsed.ok && (
          <section className="wt-surface" aria-label="转换结果">
            <div className="wt-surface__header">
              <TabList
                selectedValue={target}
                onTabSelect={(_, data) => setTarget(data.value as Target)}
              >
                <Tab value="systemd">systemd timer</Tab>
                <Tab value="github-actions">GitHub Actions</Tab>
                <Tab value="crontab">crontab</Tab>
                <Tab value="human">中文说明</Tab>
              </TabList>
              <span className={styles.spacer} />
              {'lossy' in output && output.lossy && (
                <Tooltip
                  content="存在无法一一对应的语义，结果中已标注具体差异"
                  relationship="description"
                  withArrow
                >
                  <Badge appearance="tint" color="warning" size="small">
                    <Warning16Regular /> 有语义差异
                  </Badge>
                </Tooltip>
              )}
              <Tooltip content="复制结果" relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  icon={copied === 'cron' ? <Checkmark16Regular /> : <Copy16Regular />}
                  onClick={() =>
                    void copy('error' in output ? '' : output.code, 'cron')
                  }
                  aria-label="复制结果"
                />
              </Tooltip>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              {'error' in output ? (
                <div style={{ padding: '14px' }}>
                  <Caption1 className={styles.hint}>{output.error}</Caption1>
                </div>
              ) : target === 'human' ? (
                <div style={{ padding: '18px 14px' }}>
                  <Text size={400} weight="semibold">
                    {output.code}
                  </Text>
                </div>
              ) : (
                <textarea
                  className="wt-code-area"
                  value={output.code}
                  readOnly
                  aria-label={`${output.label} 结果`}
                  spellCheck={false}
                />
              )}
            </div>
          </section>
        )}

        {parsed.ok && !('error' in output) && output.notes.length > 0 && (
          <section className="wt-surface" aria-label="注意事项">
            <div className="wt-surface__header">
              <Warning16Regular />
              <Text size={300} weight="semibold">
                注意事项
              </Text>
              <span className={styles.spacer} />
              <Caption1 className={styles.hint}>
                {output.notes.length} 条
              </Caption1>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.notes}>
                {output.notes.map((note) => (
                  <div key={note} className={styles.note}>
                    <Warning16Regular
                      style={{
                        flex: 'none',
                        marginTop: 2,
                        color: tokens.colorPaletteMarigoldForeground1,
                      }}
                    />
                    <Caption1 className={styles.hint}>{note}</Caption1>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {parsed.ok && (
          <section className="wt-surface" aria-label="解析明细">
            <div className="wt-surface__header">
              <Text size={300} weight="semibold">
                各字段解析
              </Text>
              <span className={styles.spacer} />
              <Caption1 className={styles.hint}>
                展开后的实际取值
              </Caption1>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.notes}>
                {(
                  [
                    ['秒', parsed.cron.second],
                    ['分钟', parsed.cron.minute],
                    ['小时', parsed.cron.hour],
                    ['日', parsed.cron.dayOfMonth],
                    ['月', parsed.cron.month],
                    ['星期', parsed.cron.dayOfWeek],
                  ] as const
                )
                  .filter(([, field]) => field !== null)
                  .map(([label, field]) => (
                    <div key={label} className={styles.note}>
                      <Text
                        style={{ flex: 'none', width: 48 }}
                        className={styles.hint}
                        size={200}
                      >
                        {label}
                      </Text>
                      <Caption1 style={{ color: tokens.colorNeutralForeground2 }}>
                        <code>{field?.raw}</code> →{' '}
                        {field && field.values.length > 20
                          ? `${field.values.length} 个取值（每 ${field.step} 一次）`
                          : field?.values.join(', ')}
                      </Caption1>
                    </div>
                  ))}
              </div>
            </div>
          </section>
        )}

        </>
        )}

        <Divider />
      </div>
    </>
  );
}

/** The systemd OnCalendar → cron panel. */
function OnCalendarSection({
  value,
  onChange,
  result,
  copied,
  onCopy,
}: {
  value: string;
  onChange: (next: string) => void;
  result: ReturnType<typeof onCalendarToCron>;
  copied: string | null;
  onCopy: (text: string, key: string) => Promise<void>;
}) {
  const styles = useStyles();
  const ok = result.ok;

  return (
    <>
      <section className="wt-surface" aria-label="OnCalendar 输入">
        <div className="wt-surface__header">
          <Clock16Regular />
          <Text size={300} weight="semibold">
            systemd OnCalendar
          </Text>
          {ok ? (
            <Badge appearance="tint" color="success" size="small">
              语法有效
            </Badge>
          ) : (
            <Badge appearance="tint" color="danger" size="small">
              语法错误
            </Badge>
          )}
          <span className={styles.spacer} />
          <Caption1 className={styles.hint}>
            形如 <code>Mon..Fri *-*-* 09:00:00</code>，也可用 hourly / daily 等关键字
          </Caption1>
        </div>
        <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
          <div style={{ padding: '12px 14px', width: '100%' }}>
            <input
              className={`wt-inline-input ${styles.input}`}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder="Mon..Fri *-*-* 09:00:00"
              aria-label="OnCalendar 表达式"
              spellCheck={false}
            />
          </div>
          <div className={styles.presets}>
            {ONCALENDAR_SAMPLES.map((sample) => (
              <Tooltip
                key={sample.label}
                content={sample.note}
                relationship="description"
                withArrow
              >
                <Button
                  appearance="secondary"
                  size="small"
                  onClick={() => onChange(sample.expression)}
                >
                  {sample.label}
                </Button>
              </Tooltip>
            ))}
          </div>
        </div>
      </section>

      {!ok && (
        <MessageBar intent="error">
          <MessageBarBody>{result.error}</MessageBarBody>
        </MessageBar>
      )}

      {ok && (
        <>
          {result.impossible && (
            <MessageBar intent="warning">
              <MessageBarBody>
                <MessageBarTitle>
                  <Warning16Regular /> cron 无法等价表达这个表达式
                </MessageBarTitle>
                这里不会给出「翻译结果」，因为不存在与它等价的 cron 表达式。
                下方列出的是按 cron 自身语义（并集）写出来的近似版本，
                触发次数会明显更多，请勿直接当作等价替换。
              </MessageBarBody>
            </MessageBar>
          )}

          <section className="wt-surface" aria-label="cron 结果">
            <div className="wt-surface__header">
              <Text size={300} weight="semibold">
                cron 表达式
              </Text>
              {result.lossy && (
                <Badge appearance="tint" color="warning" size="small">
                  有语义差异
                </Badge>
              )}
              <span className={styles.spacer} />
              {result.cron && (
                <Tooltip content="复制" relationship="label" withArrow>
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={copied === 'oc' ? <Checkmark16Regular /> : <Copy16Regular />}
                    onClick={() => void onCopy(result.cron as string, 'oc')}
                    aria-label="复制 cron"
                  />
                </Tooltip>
              )}
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.output}>
                {result.cron ?? (
                  <Caption1 className={styles.hint}>
                    无等价 cron。近似写法：{result.approximateCron}
                  </Caption1>
                )}
              </div>
              {result.cronWithSeconds && (
                <>
                  <Divider />
                  <div className={styles.row}>
                    <Caption1 className={styles.hint} style={{ width: 110 }}>
                      含秒的 6 段写法
                    </Caption1>
                    <span className={`${styles.cell} ${styles.mono}`}>
                      {result.cronWithSeconds}
                    </span>
                    <Tooltip content="复制" relationship="label" withArrow>
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={
                          copied === 'oc6' ? <Checkmark16Regular /> : <Copy16Regular />
                        }
                        onClick={() => void onCopy(result.cronWithSeconds as string, 'oc6')}
                        aria-label="复制 6 段表达式"
                      />
                    </Tooltip>
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="wt-surface" aria-label="注意事项">
            <div className="wt-surface__header">
              <Warning16Regular />
              <Text size={300} weight="semibold">
                转换说明
              </Text>
              <span className={styles.spacer} />
              <Caption1 className={styles.hint}>{result.notes.length} 条</Caption1>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.notes}>
                {result.notes.map((note) => (
                  <div key={note} className={styles.note}>
                    <Warning16Regular
                      style={{
                        flex: 'none',
                        marginTop: 2,
                        color: result.lossy
                          ? tokens.colorPaletteMarigoldForeground1
                          : tokens.colorPaletteGreenForeground1,
                      }}
                    />
                    <Caption1 className={styles.hint}>{note}</Caption1>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}

      <MessageBar intent="info">
        <MessageBarBody>
          <MessageBarTitle>为什么有些表达式无法翻译</MessageBarTitle>
          systemd 把「星期」与「日期」取<strong>交集</strong>，cron 取<strong>并集</strong>。
          例如 <code>Mon..Fri *-*-01 09:00</code> 只在「1 号且是工作日」时触发，
          而 cron 的 <code>0 9 1 * 1-5</code> 在每个工作日和每个 1 号都会触发。
          这类表达式会被明确拒绝而不是给出一个看起来对的错误答案。
        </MessageBarBody>
      </MessageBar>
    </>
  );
}

/** The GitHub Actions workflow → schedule panel. */
function ActionsSection({
  value,
  onChange,
  result,
  copied,
  onCopy,
}: {
  value: string;
  onChange: (next: string) => void;
  result: ReturnType<typeof analyseWorkflow>;
  copied: string | null;
  onCopy: (text: string, key: string) => Promise<void>;
}) {
  const styles = useStyles();
  const ok = result.ok;
  const analysis: WorkflowAnalysis | null = ok ? result : null;

  return (
    <>
      <section className="wt-surface" aria-label="workflow 内容">
        <div className="wt-surface__header">
          <Text size={300} weight="semibold">
            workflow 内容
          </Text>
          {ok ? (
            <Badge appearance="tint" color="success" size="small">
              YAML 有效
            </Badge>
          ) : (
            <Badge appearance="tint" color="danger" size="small">
              YAML 错误
            </Badge>
          )}
          <span className={styles.spacer} />
          <Caption1 className={styles.hint}>
            粘贴 .github/workflows/*.yml 的内容
          </Caption1>
        </div>
        <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
          <div style={{ padding: '12px 14px', width: '100%' }}>
            <textarea
              className="wt-code-area"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder={'on:\n  schedule:\n    - cron: "0 9 * * *"'}
              aria-label="workflow YAML"
              spellCheck={false}
            />
          </div>
          <div className={styles.presets}>
            {WORKFLOW_SAMPLES.map((sample) => (
              <Tooltip
                key={sample.label}
                content={sample.note}
                relationship="description"
                withArrow
              >
                <Button
                  appearance="secondary"
                  size="small"
                  onClick={() => onChange(sample.yaml)}
                >
                  {sample.label}
                </Button>
              </Tooltip>
            ))}
          </div>
        </div>
      </section>

      {!ok && (
        <MessageBar intent="error">
          <MessageBarBody>{result.error}</MessageBarBody>
        </MessageBar>
      )}

      {analysis && (
        <>
          {analysis.name && (
            <Caption1 className={styles.hint} style={{ padding: '0 4px' }}>
              workflow 名称：{analysis.name}
              {analysis.hasWorkflowDispatch && ' · 支持手动触发（workflow_dispatch）'}
              {analysis.otherTriggers.length > 0 &&
                ` · 其他触发：${analysis.otherTriggers.join('、')}`}
            </Caption1>
          )}

          {analysis.warnings.map((warning) => (
            <MessageBar key={warning} intent="warning">
              <MessageBarBody>
                <Warning16Regular /> {warning}
              </MessageBarBody>
            </MessageBar>
          ))}

          {analysis.schedules.map((schedule) => (
            <section
              key={schedule.index}
              className="wt-surface"
              aria-label={`计划 ${schedule.index}`}
            >
              <div className="wt-surface__header">
                <Text size={300} weight="semibold">
                  计划 #{schedule.index}
                </Text>
                {schedule.ok ? (
                  <Badge appearance="tint" color="success" size="small">
                    {schedule.description}
                  </Badge>
                ) : (
                  <Badge appearance="tint" color="danger" size="small">
                    无法解析
                  </Badge>
                )}
                <span className={styles.spacer} />
                {schedule.minIntervalMinutes !== undefined && (
                  <Tooltip
                    content="GitHub 的最小间隔是 5 分钟，更短会被拒绝"
                    relationship="description"
                    withArrow
                  >
                    <Badge
                      appearance="tint"
                      size="small"
                      color={schedule.minIntervalMinutes < 5 ? 'danger' : 'informative'}
                    >
                      最小间隔 {schedule.minIntervalMinutes} 分钟
                    </Badge>
                  </Tooltip>
                )}
                {schedule.ok && (
                  <Tooltip content="复制 cron" relationship="label" withArrow>
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={
                        copied === `wf${schedule.index}` ? (
                          <Checkmark16Regular />
                        ) : (
                          <Copy16Regular />
                        )
                      }
                      onClick={() => void onCopy(schedule.cron, `wf${schedule.index}`)}
                      aria-label="复制 cron"
                    />
                  </Tooltip>
                )}
              </div>

              <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                <div className={styles.output}>{schedule.cron || '（缺少 cron）'}</div>

                {!schedule.ok && (
                  <>
                    <Divider />
                    <div className={styles.row}>
                      <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>
                        {schedule.error}
                      </Caption1>
                    </div>
                  </>
                )}

                {schedule.ok && schedule.nextUtc && schedule.nextLocal && (
                  <>
                    <Divider />
                    <div className={styles.stack}>
                      {schedule.nextUtc.map((utc, index) => (
                        <div key={utc} className={styles.row}>
                          <Caption1 className={styles.hint} style={{ width: 56 }}>
                            第 {index + 1} 次
                          </Caption1>
                          <span className={`${styles.cell} ${styles.mono}`}>
                            {utc} UTC
                          </span>
                          <span className={`${styles.cell} ${styles.mono}`}>
                            本地 {schedule.nextLocal?.[index]}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {schedule.minIntervalMinutes !== undefined &&
                  schedule.minIntervalMinutes < 5 && (
                    <>
                      <Divider />
                      <div className={styles.row}>
                        <Warning16Regular
                          style={{ color: tokens.colorPaletteRedForeground1 }}
                        />
                        <Caption1>
                          最小间隔只有 {schedule.minIntervalMinutes} 分钟，低于 GitHub 的 5 分钟下限，
                          该 schedule 会被拒绝。
                        </Caption1>
                      </div>
                    </>
                  )}
              </div>
            </section>
          ))}

          {analysis.schedules.length === 0 && (
            <MessageBar intent="info">
              <MessageBarBody>
                这个 workflow 没有定时计划，因此没有可分析的时间表。
              </MessageBarBody>
            </MessageBar>
          )}
        </>
      )}

      <MessageBar intent="info">
        <MessageBarBody>
          <MessageBarTitle>为什么需要单独看这一眼</MessageBarTitle>
          Actions 的 <code>schedule</code> 一律按 <strong>UTC</strong> 解释，
          与仓库所在地和你的本地时区都无关——所以上面每一条计划都同时列出了
          UTC 与本地时间。另外定时 workflow 会在仓库连续 60 天无活动后被自动停用，
          高负载时段的实际触发也可能延迟。
        </MessageBarBody>
      </MessageBar>
    </>
  );
}

/** The crontab parser panel. */
function CrontabSection({
  value,
  onChange,
  dialect,
  onDialectChange,
  result,
  copied,
  onCopy,
}: {
  value: string;
  onChange: (next: string) => void;
  dialect: CrontabDialect;
  onDialectChange: (next: CrontabDialect) => void;
  result: ReturnType<typeof parseCrontab>;
  copied: string | null;
  onCopy: (text: string, key: string) => Promise<void>;
}) {
  const styles = useStyles();
  const ok = result.ok;
  const analysis: CrontabAnalysis | null = ok ? result : null;

  return (
    <>
      <section className="wt-surface" aria-label="crontab 内容">
        <div className="wt-surface__header">
          <Text size={300} weight="semibold">
            crontab 内容
          </Text>
          {ok && (
            <Badge appearance="tint" color="brand" size="small">
              {analysis?.dialect === 'system-crontab' ? '系统 crontab' : '用户 crontab'}
              {analysis?.dialectSource === 'inferred' ? '（自动判断）' : '（手动指定）'}
            </Badge>
          )}
          <span className={styles.spacer} />
          <Caption1 className={styles.hint}>格式</Caption1>
          <Dropdown
            style={{ minWidth: 160 }}
            value={
              dialect === 'auto'
                ? '自动判断'
                : dialect === 'user'
                  ? '用户 crontab'
                  : '系统 crontab（cron.d）'
            }
            selectedOptions={[dialect]}
            onOptionSelect={(_, data) => onDialectChange(data.optionValue as CrontabDialect)}
            aria-label="crontab 格式"
          >
            <Option value="auto" text="自动判断">
              自动判断
            </Option>
            <Option value="user" text="用户 crontab">
              用户 crontab
            </Option>
            <Option value="system" text="系统 crontab（cron.d）">
              系统 crontab（cron.d）
            </Option>
          </Dropdown>
        </div>
        <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
          <div style={{ padding: '12px 14px', width: '100%' }}>
            <textarea
              className="wt-code-area"
              style={{ minHeight: '150px' }}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder={'# 注释\nPATH=/usr/bin\n30 2 * * * /opt/backup.sh\n'}
              aria-label="crontab 内容"
              spellCheck={false}
            />
          </div>
          <div className={styles.presets}>
            {CRONTAB_SAMPLES.map((sample) => (
              <Tooltip
                key={sample.label}
                content={sample.note}
                relationship="description"
                withArrow
              >
                <Button
                  appearance="secondary"
                  size="small"
                  onClick={() => onChange(sample.text)}
                >
                  {sample.label}
                </Button>
              </Tooltip>
            ))}
          </div>
        </div>
      </section>

      {!ok && (
        <MessageBar intent="error">
          <MessageBarBody>{(result as { error: string }).error}</MessageBarBody>
        </MessageBar>
      )}

      {analysis && (
        <>
          {analysis.warnings.map((warning) => (
            <MessageBar key={warning} intent="warning">
              <MessageBarBody>
                <Warning16Regular /> {warning}
              </MessageBarBody>
            </MessageBar>
          ))}

          {analysis.stats.jobs === 0 ? (
            <MessageBar intent="info">
              <MessageBarBody>
                这份内容里没有任务，只有 {analysis.stats.envVars} 个环境变量和{' '}
                {analysis.stats.comments} 条注释。
              </MessageBarBody>
            </MessageBar>
          ) : (
            analysis.jobs.map((job) => (
              <section key={job.line} className="wt-surface" aria-label={`第 ${job.line} 行任务`}>
                <div className="wt-surface__header">
                  <Badge appearance="tint" color="informative" size="small">
                    第 {job.line} 行
                  </Badge>
                  {job.parseable ? (
                    <Text size={300} weight="semibold">
                      {job.description}
                    </Text>
                  ) : (
                    <Badge appearance="tint" color="danger" size="small">
                      无法解析
                    </Badge>
                  )}
                  <span className={styles.spacer} />
                  {job.user && (
                    <Badge appearance="tint" color="warning" size="small">
                      用户 {job.user}
                    </Badge>
                  )}
                  {job.parseable && (
                    <Tooltip content="复制时间表达式" relationship="label" withArrow>
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={
                          copied === `ct${job.line}` ? (
                            <Checkmark16Regular />
                          ) : (
                            <Copy16Regular />
                          )
                        }
                        onClick={() => void onCopy(job.schedule, `ct${job.line}`)}
                        aria-label="复制时间表达式"
                      />
                    </Tooltip>
                  )}
                </div>

                <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                  <div className={styles.output}>{job.schedule}</div>

                  {job.warnings.length > 0 && (
                    <>
                      <Divider />
                      <div className={styles.notes}>
                        {job.warnings.map((warning) => (
                          <div key={warning} className={styles.note}>
                            <Warning16Regular
                              style={{
                                flex: 'none',
                                marginTop: 2,
                                color: tokens.colorPaletteMarigoldForeground1,
                              }}
                            />
                            <Caption1 className={styles.hint}>{warning}</Caption1>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {!job.parseable && (
                    <>
                      <Divider />
                      <div className={styles.row}>
                        <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>
                          {job.error}
                        </Caption1>
                      </div>
                    </>
                  )}

                  <Divider />

                  <div className={styles.stack}>
                    <div className={styles.row}>
                      <Caption1 className={styles.hint} style={{ width: 90 }}>
                        命令
                      </Caption1>
                      <span className={`${styles.cell} ${styles.mono}`}>{job.command || '（空）'}</span>
                    </div>
                    {job.stdin && (
                      <div className={styles.row}>
                        <Caption1 className={styles.hint} style={{ width: 90 }}>
                          标准输入
                        </Caption1>
                        <span className={`${styles.cell} ${styles.mono}`}>
                          {job.stdin.join(' ⏎ ')}
                        </span>
                      </div>
                    )}
                    {job.nextRuns && (
                      <div className={styles.row}>
                        <Caption1 className={styles.hint} style={{ width: 90 }}>
                          下次执行
                        </Caption1>
                        <span className={`${styles.cell} ${styles.mono}`}>
                          {job.nextRuns.join(' · ')}
                        </span>
                      </div>
                    )}
                    {job.systemdNote && (
                      <div className={styles.row}>
                        <Caption1 className={styles.hint} style={{ width: 90 }}>
                          systemd
                        </Caption1>
                        <Caption1 className={styles.cell}>{job.systemdNote}</Caption1>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            ))
          )}

          {analysis.env.length > 0 && (
            <section className="wt-surface" aria-label="环境变量">
              <div className="wt-surface__header">
                <Text size={300} weight="semibold">
                  环境变量
                </Text>
                <span className={styles.spacer} />
                <Caption1 className={styles.hint}>
                  作用于该行之后的所有任务
                </Caption1>
              </div>
              <div className={`wt-surface__body ${styles.stack}`}>
                {analysis.env.map((item) => (
                  <div key={`${item.line}-${item.name}`} className={styles.row}>
                    <Caption1 className={styles.hint} style={{ width: 60 }}>
                      第 {item.line} 行
                    </Caption1>
                    <span className={`${styles.mono}`} style={{ width: 150 }}>
                      {item.name}={item.value || '（空）'}
                    </span>
                    <Caption1 className={styles.cell}>{item.note ?? '—'}</Caption1>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <MessageBar intent="info">
        <MessageBarBody>
          <MessageBarTitle>为什么用户与系统 crontab 必须分开看</MessageBarTitle>
          两者的字段含义不同：<code>/etc/crontab</code> 与 <code>/etc/cron.d/</code> 里，
          时间字段之后还有<strong>一个用户字段</strong>，普通用户 crontab 没有。
          同一行文字在两种格式下的解释完全不同，因此这里把「格式」做成显式选项，
          自动判断只作为默认值，并在有歧义时明确提示。
        </MessageBarBody>
      </MessageBar>
    </>
  );
}
