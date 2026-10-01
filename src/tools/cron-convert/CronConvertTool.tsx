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
  Checkmark16Regular,
  Clock16Regular,
  Copy16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
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

  const [expression, setExpression] = useState('*/5 * * * *');
  const [target, setTarget] = useState<Target>('systemd');
  const [copied, setCopied] = useState(false);

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

  const copy = useCallback(async () => {
    if ('error' in output) return;
    const ok = await copyText(output.code);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
      notify('已复制');
    } else {
      notify('复制失败');
    }
  }, [output, notify]);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
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
                  icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
                  onClick={() => void copy()}
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

        <Divider />
      </div>
    </>
  );
}
