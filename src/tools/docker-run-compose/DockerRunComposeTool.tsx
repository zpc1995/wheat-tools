import {
  Badge,
  Button,
  Caption1,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
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
  Copy16Regular,
  CubeMultipleRegular,
  DocumentText16Regular,
  Settings16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { useCallback, useMemo, useState } from 'react';
import { copyText } from '../json-formatter/jsonUtils';
import { DOCKER_RUN_SAMPLE, dockerRunToCompose } from './dockerRunComposeUtils';

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    width: '100%',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px 14px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  note: {
    lineHeight: 1.7,
  },
  warnings: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  warningRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    lineHeight: 1.7,
  },
  stats: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontVariantNumeric: 'tabular-nums',
  },
  snippet: {
    margin: 0,
    padding: '8px 10px',
    borderRadius: '4px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground3,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12px',
    lineHeight: 1.6,
    overflowX: 'auto',
    whiteSpace: 'pre-wrap',
  },
});

export function DockerRunComposeTool() {
  const styles = useStyles();
  const toasterId = useId('docker-run-compose-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [input, setInput] = useState(DOCKER_RUN_SAMPLE);
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => {
    if (!input.trim()) return null;
    return dockerRunToCompose(input);
  }, [input]);

  const yaml = result !== null && result.ok ? result.yaml : '';
  const error = result !== null && !result.ok ? result.error : null;

  const handleInput = useCallback((value: string) => {
    setInput(value);
    setCopied(false);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!yaml) return;
    const ok = await copyText(yaml);
    if (ok) setCopied(true);
    dispatchToast(
      <Toast>
        <ToastTitle>{ok ? '已复制到剪贴板' : '复制失败，请手动选择文本'}</ToastTitle>
      </Toast>,
      { intent: ok ? 'success' : 'error' },
    );
  }, [dispatchToast, yaml]);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <Caption1 className={styles.hint}>
            支持 <code>docker run</code>、<code>docker container run</code> 与{' '}
            <code>podman run</code>
          </Caption1>
          <span className={styles.spacer} />
          <Button appearance="subtle" size="small" onClick={() => handleInput(DOCKER_RUN_SAMPLE)}>
            填入示例
          </Button>
          <Button appearance="subtle" size="small" onClick={() => handleInput('')}>
            清空
          </Button>
        </div>

        <div className="wt-split">
          <section className="wt-surface" aria-label="输入">
            <div className="wt-surface__header">
              <DocumentText16Regular />
              <Text as="h2" size={300} weight="semibold">
                docker run 命令
              </Text>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <textarea
                className="wt-code-area"
                value={input}
                onChange={(event) => handleInput(event.target.value)}
                placeholder={'docker run -d --name web -p 8080:80 -e "TZ=Asia/Shanghai" nginx:1.25'}
                aria-label="待转换的 docker run 命令"
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
              />
            </div>
          </section>

          <section className="wt-surface" aria-label="输出">
            <div className="wt-surface__header">
              <CubeMultipleRegular />
              <Text as="h2" size={300} weight="semibold">
                docker-compose.yml
              </Text>
              <span className={styles.spacer} />
              {result !== null && result.ok && (
                <>
                  <span className={styles.stats}>
                    <Badge appearance="tint" color="brand" size="small">
                      服务 {result.serviceName}
                    </Badge>
                    <Badge appearance="tint" size="small">
                      {result.image}
                    </Badge>
                    {result.command.length > 0 && (
                      <Badge appearance="tint" size="small">
                        command {result.command.length} 段
                      </Badge>
                    )}
                  </span>
                  <Tooltip content="复制 YAML" relationship="label" withArrow>
                    <Button
                      appearance="subtle"
                      icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
                      onClick={handleCopy}
                      aria-label="复制 YAML"
                    />
                  </Tooltip>
                </>
              )}
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              {error !== null ? (
                <div style={{ padding: '12px 14px' }}>
                  <MessageBar intent="error" layout="multiline">
                    <MessageBarBody>
                      <MessageBarTitle>无法转换</MessageBarTitle>
                      <div className={styles.note}>{error.message}</div>
                      {error.token !== undefined && error.token !== '' && (
                        <pre className={styles.snippet}>出错的词：{error.token}</pre>
                      )}
                      {error.hint !== undefined && <div className={styles.note}>{error.hint}</div>}
                    </MessageBarBody>
                  </MessageBar>
                </div>
              ) : yaml ? (
                <>
                  {result !== null && result.ok && result.warnings.length > 0 && (
                    <div style={{ padding: '12px 14px 0' }}>
                      <MessageBar intent="warning" layout="multiline">
                        <MessageBarBody>
                          <MessageBarTitle>
                            有 {result.warnings.length} 处需要注意
                          </MessageBarTitle>
                          <div className={styles.warnings}>
                            {result.warnings.map((warning) => (
                              <div key={warning} className={styles.warningRow}>
                                <Warning16Regular />
                                <span>{warning}</span>
                              </div>
                            ))}
                          </div>
                        </MessageBarBody>
                      </MessageBar>
                    </div>
                  )}
                  <textarea
                    className="wt-code-area"
                    value={yaml}
                    readOnly
                    aria-label="生成的 docker-compose.yml"
                    spellCheck={false}
                  />
                </>
              ) : (
                <div className="wt-empty">
                  <Settings16Regular />
                  <Text weight="semibold">{input.trim() ? '没有可显示的结果' : '等待输入'}</Text>
                  <Caption1>粘贴一条 docker run 命令，立刻得到对应的 compose 服务定义</Caption1>
                </div>
              )}
            </div>
          </section>
        </div>

        <Caption1 className={styles.note}>
          只做命令行到 YAML 的文本转换：不连 Docker daemon、不校验镜像是否存在、不解析
          Dockerfile，也不执行生成的 compose 文件。quote 按 shell 规则处理（<code>-e &quot;A=b c&quot;</code>{' '}
          是一个参数），镜像之后的全部内容原样写进 <code>command</code> 列表。
          开关类选项（如 <code>-d</code>、<code>--rm</code>）在 compose 里没有对应字段的，
          会在上方明确列出而不是悄悄丢掉；命名卷与自定义网络会自动补上顶层的{' '}
          <code>volumes</code> / <code>networks</code> 声明。
        </Caption1>
      </div>
    </>
  );
}
