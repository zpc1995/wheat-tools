import {
  Badge,
  Button,
  Caption1,
  Checkbox,
  Dropdown,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
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
  ArrowMinimizeRegular,
  Checkmark16Regular,
  CodeBlockRegular,
  Copy16Regular,
  DocumentText16Regular,
  Settings16Regular,
  TextAlignLeftRegular,
} from '@fluentui/react-icons';
import { useCallback, useMemo, useState } from 'react';
import { copyText } from '../json-formatter/jsonUtils';
import {
  SQL_SAMPLE,
  SQL_SAMPLE_DIALECTS,
  compactSql,
  formatSql,
} from './sqlFormatterUtils';

type Mode = 'pretty' | 'compact';
type Comma = 'trailing' | 'leading';

const INDENTS = [2, 4, 8];
const COMMA_LABEL: Record<Comma, string> = {
  trailing: '逗号在后（a,）',
  leading: '逗号在前（, a）',
};

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
  errorBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  snippet: {
    margin: 0,
    padding: '8px 10px',
    borderRadius: '4px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground1,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    fontSize: '12px',
    lineHeight: 1.6,
    overflowX: 'auto',
    whiteSpace: 'pre',
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  stats: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontVariantNumeric: 'tabular-nums',
  },
});

export function SqlFormatterTool() {
  const styles = useStyles();
  const toasterId = useId('sql-formatter-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [input, setInput] = useState(SQL_SAMPLE);
  const [mode, setMode] = useState<Mode>('pretty');
  const [indent, setIndent] = useState(2);
  const [comma, setComma] = useState<Comma>('trailing');
  const [keepComments, setKeepComments] = useState(false);
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => {
    if (!input.trim()) return null;
    return mode === 'compact'
      ? compactSql(input, keepComments)
      : formatSql(input, { indent, comma });
  }, [input, mode, indent, comma, keepComments]);

  const output = result !== null && result.ok ? result.sql : '';
  const error = result !== null && !result.ok ? result.error : null;

  const handleInput = useCallback((value: string) => {
    setInput(value);
    setCopied(false);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!output) return;
    const ok = await copyText(output);
    if (ok) setCopied(true);
    dispatchToast(
      <Toast>
        <ToastTitle>{ok ? '已复制到剪贴板' : '复制失败，请手动选择文本'}</ToastTitle>
      </Toast>,
      { intent: ok ? 'success' : 'error' },
    );
  }, [dispatchToast, output]);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <TabList
            selectedValue={mode}
            onTabSelect={(_, data) => setMode(data.value as Mode)}
            aria-label="输出模式"
          >
            <Tab value="pretty" icon={<TextAlignLeftRegular />}>
              美化
            </Tab>
            <Tab value="compact" icon={<ArrowMinimizeRegular />}>
              压缩成单行
            </Tab>
          </TabList>

          <span className={styles.spacer} />

          <Caption1 className={styles.hint}>缩进</Caption1>
          <Dropdown
            style={{ minWidth: 96 }}
            value={`${indent} 个空格`}
            selectedOptions={[String(indent)]}
            onOptionSelect={(_, data) => setIndent(Number(data.optionValue))}
            disabled={mode === 'compact'}
            aria-label="缩进宽度"
          >
            {INDENTS.map((value) => (
              <Option key={value} value={String(value)} text={`${value} 个空格`}>
                {value} 个空格
              </Option>
            ))}
          </Dropdown>

          <Caption1 className={styles.hint}>列表逗号</Caption1>
          <Dropdown
            style={{ minWidth: 170 }}
            value={COMMA_LABEL[comma]}
            selectedOptions={[comma]}
            onOptionSelect={(_, data) => setComma(data.optionValue as Comma)}
            disabled={mode === 'compact'}
            aria-label="逗号位置"
          >
            {(Object.keys(COMMA_LABEL) as Comma[]).map((value) => (
              <Option key={value} value={value} text={COMMA_LABEL[value]}>
                {COMMA_LABEL[value]}
              </Option>
            ))}
          </Dropdown>

          <Checkbox
            checked={keepComments}
            onChange={(_, data) => setKeepComments(Boolean(data.checked))}
            disabled={mode === 'pretty'}
            label="压缩时保留注释"
          />
        </div>

        <div className={styles.chips}>
          <Caption1 className={styles.hint}>示例：</Caption1>
          <Button appearance="subtle" size="small" onClick={() => handleInput(SQL_SAMPLE)}>
            综合查询
          </Button>
          {SQL_SAMPLE_DIALECTS.map((sample) => (
            <Button
              key={sample.label}
              appearance="subtle"
              size="small"
              onClick={() => handleInput(sample.sql)}
            >
              {sample.label}
            </Button>
          ))}
        </div>

        <div className="wt-split">
          <section className="wt-surface" aria-label="输入">
            <div className="wt-surface__header">
              <DocumentText16Regular />
              <Text as="h2" size={300} weight="semibold">
                输入 SQL
              </Text>
              <span className={styles.spacer} />
              <Button appearance="subtle" size="small" onClick={() => handleInput('')}>
                清空
              </Button>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <textarea
                className="wt-code-area"
                value={input}
                onChange={(event) => handleInput(event.target.value)}
                placeholder={
                  '在此粘贴 SQL，例如：\nselect id, name from users where id = 1;'
                }
                aria-label="待格式化的 SQL"
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
              />
            </div>
          </section>

          <section className="wt-surface" aria-label="输出">
            <div className="wt-surface__header">
              <CodeBlockRegular />
              <Text as="h2" size={300} weight="semibold">
                格式化结果
              </Text>
              <span className={styles.spacer} />
              {result !== null && result.ok && (
                <>
                  <span className={styles.stats}>
                    <Badge appearance="tint" color="brand" size="small">
                      {result.tokens} 个 token
                    </Badge>
                    <Badge appearance="tint" size="small">
                      {result.lines} 行
                    </Badge>
                  </span>
                  <Tooltip content="复制结果" relationship="label" withArrow>
                    <Button
                      appearance="subtle"
                      icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
                      onClick={handleCopy}
                      aria-label="复制结果"
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
                      <MessageBarTitle>
                        无法格式化：第 {error.line} 行第 {error.column} 列
                      </MessageBarTitle>
                      <div className={styles.errorBox}>
                        <div className={styles.note}>{error.message}</div>
                        {error.snippet !== undefined && (
                          <pre className={styles.snippet}>{error.snippet}</pre>
                        )}
                      </div>
                    </MessageBarBody>
                  </MessageBar>
                </div>
              ) : output ? (
                <textarea
                  className="wt-code-area"
                  value={output}
                  readOnly
                  aria-label="格式化结果"
                  spellCheck={false}
                />
              ) : (
                <div className="wt-empty">
                  <Settings16Regular />
                  <Text weight="semibold">{input.trim() ? '没有可显示的结果' : '等待输入'}</Text>
                  <Caption1>粘贴 SQL 后立即排版；字符串、引号标识符与注释原样保留</Caption1>
                </div>
              )}
            </div>
          </section>
        </div>

        <Caption1 className={styles.note}>
          只做词法层面的排版：关键字统一大写、子句换行、列表缩进。不执行 SQL、不连数据库、
          不做方言语义校验，也不重排表达式内部。字符串字面量、<code>&quot;引号&quot;</code>、
          反引号与方括号标识符、<code>--</code> 行注释与块注释、PostgreSQL 的美元引用
          在格式化前后逐字节不变；括号不配平或引号未闭合时会报错并给出行列位置。
        </Caption1>
      </div>
    </>
  );
}
