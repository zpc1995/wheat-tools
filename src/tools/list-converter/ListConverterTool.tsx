import {
  Badge,
  Button,
  Caption1,
  Dropdown,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  Switch,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowSwap16Regular,
  Broom16Regular,
  Checkmark16Regular,
  Copy16Regular,
  DocumentText16Regular,
  TextBulletList16Regular,
} from '@fluentui/react-icons';
import { useCallback, useMemo, useState } from 'react';
import {
  detectFormat,
  normalizeItems,
  parseList,
  serializeList,
  type ListFormat,
  type SerializeOptions,
} from './listConverterUtils';

const FORMAT_LABELS: Record<ListFormat, string> = {
  lines: '每行一项',
  comma: '逗号分隔（a, b, c）',
  semicolon: '分号分隔（a; b; c）',
  space: '空格分隔（a b c）',
  tab: '制表符分隔（TSV）',
  json: 'JSON 数组（["a","b"]）',
  sql: 'SQL IN 列表（(\'a\',\'b\')）',
  markdown: 'Markdown 列表（- item）',
  ordered: '有序列表（1. item）',
  html: 'HTML 列表（<ul><li>）',
  yaml: 'YAML 列表（- item）',
};

const OUTPUT_FORMATS: ListFormat[] = [
  'lines',
  'comma',
  'semicolon',
  'space',
  'tab',
  'json',
  'sql',
  'markdown',
  'ordered',
  'html',
  'yaml',
];

/** What the escaping of the *output* format guarantees. */
const FORMAT_NOTES: Record<ListFormat, string> = {
  lines:
    '每行一项没有转义约定：项内的换行会被写成多行，项内的 \\r 会被归一化为 \\n。需要表达换行时请改用 Markdown、JSON、YAML 或 HTML。',
  comma: '含逗号、双引号、换行或首尾空白的项会用双引号括起来，内部的双引号写成两个。',
  semicolon: '含分号、双引号、换行或首尾空白的项会用双引号括起来，内部的双引号写成两个。',
  space:
    '含空格、双引号、换行或首尾空白的项会用双引号括起来。连续空格会被当作多个分隔符，空项写成 ""。',
  tab: '含制表符、双引号、换行或首尾空白的项会用双引号括起来，内部的双引号写成两个。',
  json: '字符串按 JSON 规则转义，任何字符（换行、引号、emoji）都能表示，输出可用 JSON.parse 校验。',
  sql: '按 SQL 标准把单引号写成两个（两个单引号），不使用 MySQL 的反斜杠转义，因此 PostgreSQL、SQLite、Oracle 也能用。',
  markdown:
    '多行的项用缩进续行表示；首尾空白原样保留。Markdown 没有引号转义，含换行的项渲染时可能折行。',
  ordered: '与 Markdown 列表相同的续行规则，编号按顺序生成（1. 2. 3.）。',
  html: '& < > " \' 转义成实体，\\r 写成 &#13; 以免被 HTML 解析器的换行归一化破坏。',
  yaml: '看起来像数字、布尔、null、含冒号或井号的项会自动加双引号，避免被 YAML 解析成别的类型；解析用标准 yaml 库。',
};

const SAMPLE_INPUT = `["苹果", "香蕉", "含,逗号", "含\\"引号\\"", "小麦 😀"]`;

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
  select: {
    minWidth: '230px',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  note: {
    lineHeight: 1.7,
  },
});

async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Clipboard access can be denied; do not claim a copy that did not happen.
    return false;
  }
}

export function ListConverterTool() {
  const styles = useStyles();

  const [inputFormat, setInputFormat] = useState<'auto' | ListFormat>('auto');
  const [outputFormat, setOutputFormat] = useState<ListFormat>('json');
  const [trim, setTrim] = useState(false);
  const [dropEmpty, setDropEmpty] = useState(true);
  const [dedupe, setDedupe] = useState(false);
  const [sort, setSort] = useState(false);
  const [sqlQuoting, setSqlQuoting] = useState<SerializeOptions['sqlQuoting']>('string');
  const [htmlOrdered, setHtmlOrdered] = useState(false);
  const [pretty, setPretty] = useState(false);
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);

  const detected = useMemo(() => detectFormat(input), [input]);
  const effectiveInputFormat: ListFormat = inputFormat === 'auto' ? detected : inputFormat;

  const parsed = useMemo(
    () => parseList(input, effectiveInputFormat),
    [effectiveInputFormat, input],
  );

  const items = useMemo(
    () => normalizeItems(parsed.items, { trim, dropEmpty, dedupe, sort }),
    [dedupe, dropEmpty, parsed.items, sort, trim],
  );

  const output = useMemo(() => {
    if (parsed.error) return '';
    return serializeList(items, outputFormat, {
      sqlQuoting,
      htmlOrdered,
      indent: pretty ? 2 : 0,
    });
  }, [htmlOrdered, items, outputFormat, parsed.error, pretty, sqlQuoting]);

  const handleCopy = useCallback(async () => {
    if (!output) return;
    const ok = await copyToClipboard(output);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1400);
  }, [output]);

  const handleSwap = useCallback(() => {
    setInput(output);
    setInputFormat(outputFormat);
    setOutputFormat(effectiveInputFormat);
    setCopied(false);
  }, [effectiveInputFormat, output, outputFormat]);

  const handleClear = useCallback(() => {
    setInput('');
    setCopied(false);
  }, []);

  const inputValue = inputFormat === 'auto' ? `自动识别 · ${FORMAT_LABELS[detected]}` : FORMAT_LABELS[inputFormat];

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <Dropdown
          className={styles.select}
          value={inputValue}
          selectedOptions={[inputFormat]}
          onOptionSelect={(_, data) => setInputFormat(data.optionValue as 'auto' | ListFormat)}
          aria-label="输入格式"
        >
          <Option value="auto" text={`自动识别 · ${FORMAT_LABELS[detected]}`}>
            {`自动识别 · ${FORMAT_LABELS[detected]}`}
          </Option>
          {OUTPUT_FORMATS.map((format) => (
            <Option key={format} value={format} text={FORMAT_LABELS[format]}>
              {FORMAT_LABELS[format]}
            </Option>
          ))}
        </Dropdown>

        <Text className={styles.hint}>→</Text>

        <Dropdown
          className={styles.select}
          value={FORMAT_LABELS[outputFormat]}
          selectedOptions={[outputFormat]}
          onOptionSelect={(_, data) => setOutputFormat(data.optionValue as ListFormat)}
          aria-label="输出格式"
        >
          {OUTPUT_FORMATS.map((format) => (
            <Option key={format} value={format} text={FORMAT_LABELS[format]}>
              {FORMAT_LABELS[format]}
            </Option>
          ))}
        </Dropdown>

        <span className={styles.spacer} />

        <Button
          appearance="secondary"
          icon={<ArrowSwap16Regular />}
          onClick={handleSwap}
          disabled={!output}
        >
          交换方向
        </Button>
        <Button
          appearance="subtle"
          icon={<Broom16Regular />}
          onClick={handleClear}
          disabled={!input}
        >
          清空
        </Button>
      </div>

      <div className={styles.toolbar}>
        <Switch
          checked={trim}
          onChange={(_, data) => setTrim(Boolean(data.checked))}
          label="去空白"
        />
        <Switch
          checked={dropEmpty}
          onChange={(_, data) => setDropEmpty(Boolean(data.checked))}
          label="忽略空项"
        />
        <Switch
          checked={dedupe}
          onChange={(_, data) => setDedupe(Boolean(data.checked))}
          label="去重"
        />
        <Switch
          checked={sort}
          onChange={(_, data) => setSort(Boolean(data.checked))}
          label="排序"
        />

        {outputFormat === 'sql' && (
          <Dropdown
            className={styles.select}
            value={sqlQuoting === 'string' ? '全部加单引号' : '数字不加引号'}
            selectedOptions={[sqlQuoting]}
            onOptionSelect={(_, data) => setSqlQuoting(data.optionValue as SerializeOptions['sqlQuoting'])}
            aria-label="SQL 引号方式"
          >
            <Option value="string" text="全部加单引号">
              全部加单引号
            </Option>
            <Option value="auto" text="数字不加引号">
              数字不加引号
            </Option>
          </Dropdown>
        )}

        {outputFormat === 'html' && (
          <Switch
            checked={htmlOrdered}
            onChange={(_, data) => setHtmlOrdered(Boolean(data.checked))}
            label="用有序列表 ol"
          />
        )}

        {outputFormat === 'json' && (
          <Switch
            checked={pretty}
            onChange={(_, data) => setPretty(Boolean(data.checked))}
            label="格式化 JSON"
          />
        )}
      </div>

      <MessageBar intent="info">
        <MessageBarBody>
          <MessageBarTitle>转义规则：{FORMAT_LABELS[outputFormat]}</MessageBarTitle>
          <div className={styles.note}>{FORMAT_NOTES[outputFormat]}</div>
        </MessageBarBody>
      </MessageBar>

      <div className="wt-split">
        <section className="wt-surface" aria-label="输入">
          <div className="wt-surface__header">
            <DocumentText16Regular />
            <Text as="h2" size={300} weight="semibold">
              输入
            </Text>
            <span className={styles.spacer} />
            <Button appearance="subtle" size="small" onClick={() => setInput(SAMPLE_INPUT)}>
              填入示例
            </Button>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <textarea
              className="wt-code-area"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={'在此粘贴列表，例如：\n["苹果", "香蕉", "含,逗号"]\n或：\n苹果\n香蕉'}
              aria-label="待转换的列表"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
            />
          </div>
        </section>

        <section className="wt-surface" aria-label="输出">
          <div className="wt-surface__header">
            <TextBulletList16Regular />
            <Text as="h2" size={300} weight="semibold">
              输出
            </Text>
            <span className={styles.spacer} />
            {output && (
              <>
                <Badge appearance="tint" color="brand" size="small">
                  {items.length} 项
                </Badge>
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
            {parsed.error ? (
              <div style={{ padding: '12px 14px' }}>
                <MessageBar intent="error" layout="multiline">
                  <MessageBarBody>
                    <MessageBarTitle>无法解析输入</MessageBarTitle>
                    <div className={styles.note}>{parsed.error}</div>
                  </MessageBarBody>
                </MessageBar>
              </div>
            ) : input.trim() && output ? (
              <textarea
                className="wt-code-area"
                value={output}
                readOnly
                aria-label="转换结果"
                spellCheck={false}
              />
            ) : (
              <div className="wt-empty">
                <TextBulletList16Regular />
                <Text weight="semibold">
                  {input.trim() ? '没有可显示的结果' : '等待输入'}
                </Text>
                <Caption1>
                  {input.trim()
                    ? '输入没有解析出任何列表项（空项会被忽略，可用“忽略空项”开关控制）'
                    : `输入格式默认自动识别（当前：${FORMAT_LABELS[detected]}），也可以手动指定`}
                </Caption1>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
