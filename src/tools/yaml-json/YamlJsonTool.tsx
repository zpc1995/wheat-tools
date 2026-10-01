import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Switch,
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
  ArrowSwap16Regular,
  Checkmark16Regular,
  Copy16Regular,
  DocumentText16Regular,
  Table16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import { JsonTree } from '../json-formatter/JsonTree';
import {
  JSON_SAMPLE,
  MAX_INPUT_BYTES,
  YAML_GOTCHAS,
  YAML_SAMPLE,
  collectStats,
  jsonToYaml,
  yamlToJson,
  type YamlWarning,
} from './yamlUtils';

type Mode = 'yaml2json' | 'json2yaml';

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
  rows: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    padding: '7px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  rowLabel: {
    flex: 'none',
    width: '96px',
    color: tokens.colorNeutralForeground3,
  },
  rowValue: {
    flex: '1 1 auto',
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12.5px',
  },
  tree: {
    padding: '12px 14px',
    maxHeight: '340px',
    overflow: 'auto',
    width: '100%',
  },
  gotchas: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
});

export function YamlJsonTool() {
  const styles = useStyles();
  const toasterId = useId('yaml-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [mode, setMode] = useState<Mode>('yaml2json');
  const [input, setInput] = useState(YAML_SAMPLE);
  const [indent, setIndent] = useState(2);
  const [sortKeys, setSortKeys] = useState(false);
  const [tab, setTab] = useState<'text' | 'tree'>('text');
  const [copied, setCopied] = useState(false);

  const notify = useCallback(
    (message: string) => {
      dispatchToast(
        <Toast>
          <ToastTitle>{message}</ToastTitle>
        </Toast>,
        { timeout: 1500 },
      );
    },
    [dispatchToast],
  );

  const copy = useCallback(
    async (value: string) => {
      const ok = await copyText(value);
      if (ok) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
        notify('已复制');
      } else {
        notify('复制失败');
      }
    },
    [notify],
  );

  const converted = useMemo(() => {
    if (mode === 'yaml2json') {
      const result = yamlToJson(input, indent);
      return result.ok
        ? {
            ok: true as const,
            output: result.json,
            value: result.value as unknown,
            warnings: result.warnings,
          }
        : { ok: false as const, error: result.error, warnings: result.warnings };
    }
    const result = jsonToYaml(input, indent, sortKeys);
    return result.ok
      ? {
          ok: true as const,
          output: result.yaml,
          value: (() => {
            try {
              return JSON.parse(input) as unknown;
            } catch {
              return null;
            }
          })(),
          warnings: result.warnings,
        }
      : { ok: false as const, error: result.error, warnings: result.warnings };
  }, [mode, input, indent, sortKeys]);

  const stats = useMemo(
    () => (converted.ok ? collectStats(converted.value) : null),
    [converted],
  );

  const swap = useCallback(() => {
    if (!converted.ok) return;
    setInput(converted.output);
    setMode((current) => (current === 'yaml2json' ? 'json2yaml' : 'yaml2json'));
  }, [converted]);

  const loadSample = useCallback(() => {
    setInput(mode === 'yaml2json' ? YAML_SAMPLE : JSON_SAMPLE);
  }, [mode]);

  const inputLabel = mode === 'yaml2json' ? 'YAML 输入' : 'JSON 输入';
  const outputLabel = mode === 'yaml2json' ? 'JSON 输出' : 'YAML 输出';
  const sizeKb = Math.round(input.length / 1024);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <Switch
            checked={mode === 'json2yaml'}
            onChange={(_, data) =>
              setMode(data.checked ? 'json2yaml' : 'yaml2json')
            }
            label={mode === 'yaml2json' ? '当前：YAML → JSON' : '当前：JSON → YAML'}
          />
          <Button
            appearance="secondary"
            icon={<ArrowSwap16Regular />}
            onClick={swap}
            disabled={!converted.ok}
          >
            结果填回输入并反向
          </Button>
          <Button appearance="secondary" onClick={loadSample}>
            载入示例
          </Button>

          <Caption1 className={styles.hint}>缩进</Caption1>
          <TabList
            size="small"
            selectedValue={String(indent)}
            onTabSelect={(_, data) => setIndent(Number(data.value))}
          >
            <Tab value="2">2</Tab>
            <Tab value="4">4</Tab>
          </TabList>

          {mode === 'json2yaml' && (
            <Switch
              checked={sortKeys}
              onChange={(_, data) => setSortKeys(data.checked)}
              label="键排序"
            />
          )}

          <span className={styles.spacer} />
          <Caption1 className={styles.hint}>
            {sizeKb} KB / 上限 {Math.round(MAX_INPUT_BYTES / 1024)} KB
          </Caption1>
          <Tooltip content="清空输入" relationship="label" withArrow>
            <Button
              appearance="subtle"
              onClick={() => setInput('')}
              disabled={!input}
            >
              清空
            </Button>
          </Tooltip>
        </div>

        {/* These are the surprises worth stating up front. */}
        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>YAML 与 JSON 的差异</MessageBarTitle>
            使用 <code>core</code> schema 解析：<code>!!</code> 自定义标签（如
            <code>!!js/function</code>）不会被求值，只当作普通标量；
            重复键会被判为错误而不是静默取最后一个；别名展开有资源上限，
            遇到别名炸弹会明确报错。YAML 支持注释、锚点与多文档，JSON 都不支持。
          </MessageBarBody>
        </MessageBar>

        {!converted.ok && (
          <MessageBar intent="error">
            <MessageBarBody>
              <MessageBarTitle>转换失败</MessageBarTitle>
              {converted.error}
            </MessageBarBody>
          </MessageBar>
        )}

        {converted.warnings.length > 0 && (
          <MessageBar intent="warning">
            <MessageBarBody>
              <MessageBarTitle>
                <Warning16Regular /> {converted.warnings.length} 条提示
              </MessageBarTitle>
              {converted.warnings.map((warning: YamlWarning) => warning.message).join('；')}
            </MessageBarBody>
          </MessageBar>
        )}

        <div className="wt-split">
          <section className="wt-surface" aria-label={inputLabel}>
            <div className="wt-surface__header">
              <DocumentText16Regular />
              <Text as="h2" size={300} weight="semibold">
                {inputLabel}
              </Text>
              <span className={styles.spacer} />
              <Badge appearance="tint" color="brand" size="small">
                {mode === 'yaml2json' ? 'YAML' : 'JSON'}
              </Badge>
            </div>
            <div className="wt-surface__body">
              <textarea
                className="wt-code-area"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={
                  mode === 'yaml2json'
                    ? '在此粘贴 YAML…'
                    : '在此粘贴 JSON…'
                }
                aria-label={inputLabel}
                spellCheck={false}
              />
            </div>
          </section>

          <section className="wt-surface" aria-label={outputLabel}>
            <div className="wt-surface__header">
              <Table16Regular />
              <Text as="h2" size={300} weight="semibold">
                {outputLabel}
              </Text>
              <span className={styles.spacer} />
              {converted.ok && (
                <>
                  {stats && (
                    <Caption1 className={styles.hint}>
                      {stats.nodes} 个值 · {stats.keys} 个键 · 深度 {stats.depth}
                    </Caption1>
                  )}
                  <TabList
                    size="small"
                    selectedValue={tab}
                    onTabSelect={(_, data) =>
                      setTab(data.value as 'text' | 'tree')
                    }
                  >
                    <Tab value="text">文本</Tab>
                    <Tab value="tree">结构</Tab>
                  </TabList>
                  <Tooltip content="复制结果" relationship="label" withArrow>
                    <Button
                      appearance="subtle"
                      icon={
                        copied ? <Checkmark16Regular /> : <Copy16Regular />
                      }
                      onClick={() => copy(converted.output)}
                      aria-label="复制结果"
                    />
                  </Tooltip>
                </>
              )}
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              {!converted.ok ? (
                <div className="wt-empty">
                  <Text weight="semibold">等待有效输入</Text>
                  <Caption1>修正上方错误后这里会显示转换结果</Caption1>
                </div>
              ) : tab === 'text' ? (
                <textarea
                  className="wt-code-area"
                  value={converted.output}
                  readOnly
                  aria-label={outputLabel}
                  spellCheck={false}
                />
              ) : (
                <div className={styles.tree}>
                  <JsonTree value={converted.value as never} defaultExpandDepth={4} />
                </div>
              )}
            </div>
          </section>
        </div>

        {stats && (
          <section className="wt-surface" aria-label="结构统计">
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                结构统计
              </Text>
              <span className={styles.spacer} />
              <Caption1 className={styles.hint}>便于快速判断数据规模</Caption1>
            </div>
            <div className={`wt-surface__body ${styles.rows}`}>
              {[
                ['根类型', stats.kind],
                ['值总数', String(stats.nodes)],
                ['键总数', String(stats.keys)],
                ['数组数', String(stats.arrays)],
                ['最大深度', String(stats.depth)],
              ].map(([label, value]) => (
                <div key={label} className={styles.row}>
                  <Text className={styles.rowLabel} size={200}>
                    {label}
                  </Text>
                  <span className={styles.rowValue}>{value}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="wt-surface" aria-label="易踩的坑">
          <div className="wt-surface__header">
            <Text as="h2" size={300} weight="semibold">
              常见误解
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>转换时容易出错的地方</Caption1>
          </div>
          <div className={`wt-surface__body ${styles.rows}`}>
            <div className={styles.gotchas}>
              {YAML_GOTCHAS.map((item) => (
                <div key={item.yaml} className={styles.row}>
                  <span className={`${styles.rowLabel} ${styles.mono}`}>
                    {item.yaml}
                  </span>
                  <span className={styles.rowValue}>
                    <Caption1>{item.json}</Caption1>
                  </span>
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
