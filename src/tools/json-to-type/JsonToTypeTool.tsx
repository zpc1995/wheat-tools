import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Checkbox,
  Divider,
  Input,
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
  Braces16Regular,
  Checkmark16Regular,
  Copy16Regular,
  DocumentText16Regular,
  Stack16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  DEFAULT_INFER_OPTIONS,
  JSON_TYPE_SAMPLE,
  JSON_TYPE_SAMPLE_2,
  parseSamples,
  toGo,
  toTypeScript,
  type InferOptions,
} from './inferUtils';

type Language = 'ts' | 'go';

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
  options: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '14px',
    alignItems: 'center',
    padding: '12px 14px',
    width: '100%',
  },
  types: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '12px 14px',
    width: '100%',
    maxHeight: '420px',
    overflow: 'auto',
  },
  typeBlock: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '6px',
    overflow: 'hidden',
  },
  typeHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    backgroundColor: tokens.colorNeutralBackground3,
  },
  typeName: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12.5px',
    fontWeight: 600,
  },
  typeBody: {
    margin: 0,
    padding: '10px',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12px',
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    overflowX: 'auto',
  },
});

export function JsonToTypeTool() {
  const styles = useStyles();
  const toasterId = useId('jt-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [input, setInput] = useState('');
  const [language, setLanguage] = useState<Language>('ts');
  const [options, setOptions] = useState<InferOptions>(DEFAULT_INFER_OPTIONS);
  const [view, setView] = useState<'code' | 'types'>('code');
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

  const samples = useMemo(() => parseSamples(input), [input]);

  const result = useMemo(() => {
    if (!samples.ok) return null;
    return language === 'ts' ? toTypeScript(samples.values, options) : toGo(samples.values, options);
  }, [samples, language, options]);

  const copy = useCallback(async () => {
    if (!result?.ok) return;
    const ok = await copyText(result.code);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
      notify('已复制');
    } else {
      notify('复制失败');
    }
  }, [result, notify]);

  const sampleCount = samples.ok ? samples.values.length : 0;

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <Button
            appearance="secondary"
            onClick={() => setInput(JSON_TYPE_SAMPLE)}
          >
            载入示例
          </Button>
          <Tooltip
            content="再放一份字段不同的 JSON，用空行或 --- 分隔，用来推断哪些字段是可选的"
            relationship="description"
            withArrow
          >
            <Button
              appearance="outline"
              icon={<Stack16Regular />}
              onClick={() =>
                setInput(`${JSON_TYPE_SAMPLE}\n\n${JSON_TYPE_SAMPLE_2}`)
              }
            >
              两个样本（推断可选字段）
            </Button>
          </Tooltip>

          <TabList
            selectedValue={language}
            onTabSelect={(_, data) => setLanguage(data.value as Language)}
          >
            <Tab value="ts">TypeScript</Tab>
            <Tab value="go">Go</Tab>
          </TabList>

          <span className={styles.spacer} />
          {result?.ok && (
            <Caption1 className={styles.hint}>
              {result.typeCount} 个类型 · {result.fieldCount} 个字段
            </Caption1>
          )}
          <Tooltip content="复制结果" relationship="label" withArrow>
            <Button
              appearance="subtle"
              icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
              onClick={() => void copy()}
              disabled={!result?.ok}
              aria-label="复制结果"
            />
          </Tooltip>
        </div>

        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>为什么可以放多个样本</MessageBarTitle>
            只给一个样本时，没出现的字段就无从得知是可选的。用空行或 <code>---</code>{' '}
            分隔多份 JSON，工具会把它们合并：只出现在部分样本中的字段标记为可选
            （TS 用 <code>?</code>，Go 用 <code>omitempty</code>），
            同一个字段出现不同类型则生成联合类型而不是 <code>any</code>。
          </MessageBarBody>
        </MessageBar>

        {!samples.ok && input.trim() && (
          <MessageBar intent="error">
            <MessageBarBody>{samples.error}</MessageBarBody>
          </MessageBar>
        )}

        {samples.ok && result && !result.ok && (
          <MessageBar intent="warning">
            <MessageBarBody>{result.error}</MessageBarBody>
          </MessageBar>
        )}

        <div className="wt-split">
          <section className="wt-surface" aria-label="JSON 输入">
            <div className="wt-surface__header">
              <Braces16Regular />
              <Text size={300} weight="semibold">
                JSON 输入
              </Text>
              <span className={styles.spacer} />
              {sampleCount > 1 && (
                <Badge appearance="tint" color="brand" size="small">
                  {sampleCount} 个样本
                </Badge>
              )}
            </div>
            <div className="wt-surface__body">
              <textarea
                className="wt-code-area"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={'粘贴 JSON…\n\n多个样本用空行分隔'}
                aria-label="JSON 输入"
                spellCheck={false}
              />
            </div>
          </section>

          <section className="wt-surface" aria-label="生成结果">
            <div className="wt-surface__header">
              <DocumentText16Regular />
              <Text size={300} weight="semibold">
                {language === 'ts' ? 'TypeScript' : 'Go'} 声明
              </Text>
              <span className={styles.spacer} />
              {result?.ok && (
                <TabList
                  size="small"
                  selectedValue={view}
                  onTabSelect={(_, data) =>
                    setView(data.value as 'code' | 'types')
                  }
                >
                  <Tab value="code">完整代码</Tab>
                  <Tab value="types">分个查看</Tab>
                </TabList>
              )}
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              {result?.ok ? (
                view === 'code' ? (
                  <textarea
                    className="wt-code-area"
                    value={result.code}
                    readOnly
                    aria-label="生成的代码"
                    spellCheck={false}
                  />
                ) : (
                  <div className={styles.types}>
                    {result.types.map((item) => (
                      <div key={item.name} className={styles.typeBlock}>
                        <div className={styles.typeHead}>
                          <span className={styles.typeName}>{item.name}</span>
                          <span className={styles.spacer} />
                          <Tooltip content="复制该类型" relationship="label" withArrow>
                            <Button
                              appearance="subtle"
                              size="small"
                              icon={<Copy16Regular />}
                              onClick={() => void copyText(item.body)}
                              aria-label={`复制 ${item.name}`}
                            />
                          </Tooltip>
                        </div>
                        <pre className={styles.typeBody}>{item.body}</pre>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <div className="wt-empty">
                  <Braces16Regular />
                  <Text weight="semibold">等待有效 JSON</Text>
                  <Caption1>粘贴一份或多份 JSON，这里会生成类型声明</Caption1>
                </div>
              )}
            </div>
          </section>
        </div>

        <section className="wt-surface" aria-label="生成选项">
          <div className="wt-surface__header">
            <Text size={300} weight="semibold">
              生成选项
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              改动会立即重新生成
            </Caption1>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.options}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Caption1 className={styles.hint}>根类型名</Caption1>
                <Input
                  style={{ width: 180 }}
                  value={options.rootName}
                  onChange={(_, data) =>
                    setOptions((current) => ({ ...current, rootName: data.value }))
                  }
                  aria-label="根类型名"
                />
              </div>

              <Checkbox
                checked={options.sortKeys}
                onChange={(_, data) =>
                  setOptions((current) => ({ ...current, sortKeys: Boolean(data.checked) }))
                }
                label="字段按字母排序"
              />

              {language === 'ts' && (
                <>
                  <Checkbox
                    checked={options.readonly}
                    onChange={(_, data) =>
                      setOptions((current) => ({
                        ...current,
                        readonly: Boolean(data.checked),
                      }))
                    }
                    label="字段加 readonly"
                  />
                  <Tooltip
                    content="关闭后，可空字段会改为可选（?）而不是生成 `| null`"
                    relationship="description"
                    withArrow
                  >
                    <Checkbox
                      checked={options.includeNull}
                      onChange={(_, data) =>
                        setOptions((current) => ({
                          ...current,
                          includeNull: Boolean(data.checked),
                        }))
                      }
                      label="在联合类型中保留 null"
                    />
                  </Tooltip>
                </>
              )}
            </div>
          </div>
        </section>

        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>推断结果需要复核，不要直接当契约</MessageBarTitle>
            类型是从你给的样本反推出来的：样本没覆盖到的字段不会出现，取值格式
            （如日期字符串、枚举）也无法区分。Go 的数字统一推断为{' '}
            <code>float64</code>，因为 JSON 只有一种数字类型——如果你的接口确实是整数，
            请手工改为 <code>int</code>。生成的 TypeScript 会经过编译校验（语法与类型引用），
            但语义正确性仍需你确认。
          </MessageBarBody>
        </MessageBar>

        <Divider />
      </div>
    </>
  );
}
