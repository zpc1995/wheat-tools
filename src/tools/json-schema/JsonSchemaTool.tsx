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
  Warning16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import { JsonTree } from '../json-formatter/JsonTree';
import {
  DEFAULT_SCHEMA_OPTIONS,
  SCHEMA_NOTES,
  SCHEMA_SAMPLE,
  SCHEMA_SAMPLE_2,
  parseSamples,
  toJsonSchema,
  type SchemaOptions,
} from './schemaUtils';

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
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
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
  notes: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '14px',
    width: '100%',
  },
  note: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
  },
  tree: {
    padding: '12px 14px',
    maxHeight: '420px',
    overflow: 'auto',
    width: '100%',
  },
});

export function JsonSchemaTool() {
  const styles = useStyles();
  const toasterId = useId('js-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [input, setInput] = useState(SCHEMA_SAMPLE);
  const [options, setOptions] = useState<SchemaOptions>(DEFAULT_SCHEMA_OPTIONS);
  const [view, setView] = useState<'code' | 'tree'>('code');
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

  const result = useMemo(
    () => (samples.ok ? toJsonSchema(samples.values, options) : null),
    [samples, options],
  );

  const copy = useCallback(async () => {
    if (!result?.ok) return;
    const ok = await copyText(result.json);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
      notify('已复制 Schema');
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
          <Button appearance="secondary" onClick={() => setInput(SCHEMA_SAMPLE)}>
            载入示例
          </Button>
          <Tooltip
            content="再放一份字段不同的 JSON，用空行或 --- 分隔，用来推断哪些字段是必填的"
            relationship="description"
            withArrow
          >
            <Button
              appearance="outline"
              icon={<Stack16Regular />}
              onClick={() => setInput(`${SCHEMA_SAMPLE}\n\n${SCHEMA_SAMPLE_2}`)}
            >
              两个样本（推断必填字段）
            </Button>
          </Tooltip>
          <span className={styles.spacer} />
          {result?.ok && (
            <Caption1 className={styles.hint}>
              {result.stats.properties} 个属性 · {result.stats.required} 个必填
            </Caption1>
          )}
          <Tooltip content="复制 Schema" relationship="label" withArrow>
            <Button
              appearance="subtle"
              icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
              onClick={() => void copy()}
              disabled={!result?.ok}
              aria-label="复制 Schema"
            />
          </Tooltip>
        </div>

        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>必填字段是推断出来的，不是猜的</MessageBarTitle>
            只给一份样本时，没出现的字段无从判断是否必填。用空行或 <code>---</code>{' '}
            分隔多份 JSON，工具会把它们合并：只有在所有样本中都出现的字段
            才会进入 required。反过来，如果给一份样本就把所有字段都标成必填，
            下一份数据只要少一个字段就会被误判为无效。
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
          <section className="wt-surface" aria-label="JSON 样本">
            <div className="wt-surface__header">
              <Braces16Regular />
              <Text size={300} weight="semibold">
                JSON 样本
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
                aria-label="JSON 样本"
                spellCheck={false}
              />
            </div>
          </section>

          <section className="wt-surface" aria-label="生成的 Schema">
            <div className="wt-surface__header">
              <DocumentText16Regular />
              <Text size={300} weight="semibold">
                JSON Schema
              </Text>
              <Badge appearance="tint" color="informative" size="small">
                draft 2020-12
              </Badge>
              <span className={styles.spacer} />
              {result?.ok && (
                <TabList
                  size="small"
                  selectedValue={view}
                  onTabSelect={(_, data) => setView(data.value as 'code' | 'tree')}
                >
                  <Tab value="code">代码</Tab>
                  <Tab value="tree">结构</Tab>
                </TabList>
              )}
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              {result?.ok ? (
                view === 'code' ? (
                  <textarea
                    className="wt-code-area"
                    value={result.json}
                    readOnly
                    aria-label="生成的 JSON Schema"
                    spellCheck={false}
                  />
                ) : (
                  <div className={styles.tree}>
                    <JsonTree value={result.schema as never} defaultExpandDepth={5} />
                  </div>
                )
              ) : (
                <div className="wt-empty">
                  <Braces16Regular />
                  <Text weight="semibold">等待有效 JSON</Text>
                  <Caption1>粘贴一份或多份 JSON，这里会生成对应的 Schema</Caption1>
                </div>
              )}
            </div>
          </section>
        </div>

        <section className="wt-surface" aria-label="选项">
          <div className="wt-surface__header">
            <Text size={300} weight="semibold">
              选项
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>改动会立即重新生成</Caption1>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.options}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Caption1 className={styles.hint}>标题</Caption1>
                <Input
                  style={{ width: 160 }}
                  value={options.title}
                  onChange={(_, data) =>
                    setOptions((current) => ({ ...current, title: data.value }))
                  }
                  aria-label="Schema 标题"
                />
              </div>
              <Checkbox
                checked={options.detectFormats}
                onChange={(_, data) =>
                  setOptions((current) => ({ ...current, detectFormats: Boolean(data.checked) }))
                }
                label="推断 format（date-time / email / uuid 等）"
              />
              <Checkbox
                checked={options.includeExamples}
                onChange={(_, data) =>
                  setOptions((current) => ({ ...current, includeExamples: Boolean(data.checked) }))
                }
                label="包含 examples"
              />
              <Tooltip
                content="开启后额外字段会被判为无效。由少量样本推断出的封闭结构，往往在接口新增字段时就失败"
                relationship="description"
                withArrow
              >
                <Checkbox
                  checked={options.strictAdditionalProperties}
                  onChange={(_, data) =>
                    setOptions((current) => ({
                      ...current,
                      strictAdditionalProperties: Boolean(data.checked),
                    }))
                  }
                  label="严格模式（additionalProperties: false）"
                />
              </Tooltip>
              <Checkbox
                checked={options.includeSchemaKeyword}
                onChange={(_, data) =>
                  setOptions((current) => ({
                    ...current,
                    includeSchemaKeyword: Boolean(data.checked),
                  }))
                }
                label="包含 $schema"
              />
            </div>
          </div>
        </section>

        {result?.ok && (
          <section className="wt-surface" aria-label="统计">
            <div className={`wt-surface__body ${styles.stats}`}>
              {[
                ['对象', String(result.stats.objects)],
                ['属性', String(result.stats.properties)],
                ['必填', String(result.stats.required)],
                ['数组', String(result.stats.arrays)],
                ['联合类型', String(result.stats.unions)],
                ['format 标注', String(result.stats.formats)],
                ['最大深度', String(result.stats.maxDepth)],
              ].map(([label, value]) => (
                <div key={label} className={styles.stat}>
                  <Caption1 className={styles.hint}>{label}</Caption1>
                  <span className={styles.statValue}>{value}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="wt-surface" aria-label="使用说明">
          <div className="wt-surface__header">
            <Warning16Regular />
            <Text size={300} weight="semibold">
              使用前需要知道的几点
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>{SCHEMA_NOTES.length} 条</Caption1>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.notes}>
              {SCHEMA_NOTES.map((note) => (
                <div key={note} className={styles.note}>
                  <Warning16Regular
                    style={{ flex: 'none', marginTop: 2, color: tokens.colorPaletteMarigoldForeground1 }}
                  />
                  <Caption1 className={styles.hint}>{note}</Caption1>
                </div>
              ))}
            </div>
          </div>
        </section>

        <Divider />
      </div>
    </>
  );
}
