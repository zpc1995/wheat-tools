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
  Tab,
  TabList,
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
  Table16Regular,
} from '@fluentui/react-icons';
import { useCallback, useMemo, useState } from 'react';
import {
  csvToJson,
  jsonToCsv,
  type CsvDelimiter,
  type LineEnding,
  type NestedMode,
} from './jsonCsvUtils';

type Direction = 'json-to-csv' | 'csv-to-json';

const DELIMITER_LABELS: Record<CsvDelimiter, string> = {
  ',': '逗号 ,',
  '\t': '制表符（TSV）',
  ';': '分号 ;',
  '|': '竖线 |',
};

const DELIMITER_ORDER: CsvDelimiter[] = [',', '\t', ';', '|'];

const LINE_ENDING_LABELS: Record<LineEnding, string> = {
  lf: 'LF（\\n，Unix）',
  crlf: 'CRLF（\\r\\n，RFC 4180 / Excel）',
};

const NESTED_LABELS: Record<NestedMode, string> = {
  flatten: '扁平化：点号路径（user.name）',
  json: 'JSON 文本：整段塞进单元格',
};

const NESTED_NOTES: Record<NestedMode, string> = {
  flatten:
    '默认。嵌套对象展开成 user.name 这样的列；数组没有可靠的展开方式（下标路径会和真实存在的 "0" 键混淆），因此写成 JSON 文本，例如 [1,2]。',
  json:
    '嵌套对象与数组都写成 JSON 文本放在一个单元格里，列名只有第一层的键，例如 user 列的值是 {"name":"小麦"}。',
};

const SAMPLE_JSON = `[
  { "id": 1, "name": "小麦", "user": { "name": "mai", "age": 3 }, "tags": ["a", "b"] },
  { "id": 2, "name": "带有,逗号", "user": { "name": "grain" }, "note": "换行\\n在这里" },
  { "id": 3, "name": "quote\\"inside" }
]`;

const SAMPLE_CSV = `id,name,note
1,小麦,"含逗号, 的字段"
2,"多行
字段",普通值
3,"他说 ""你好""",`;

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
    minWidth: '210px',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  stats: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  note: {
    lineHeight: 1.7,
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
  },
});

async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Clipboard access can be denied; reporting the failure is more honest
    // than flashing a "copied" state for a copy that did not happen.
    return false;
  }
}

export function JsonCsvTool() {
  const styles = useStyles();

  const [direction, setDirection] = useState<Direction>('json-to-csv');
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(',');
  const [hasHeader, setHasHeader] = useState(true);
  const [lineEnding, setLineEnding] = useState<LineEnding>('lf');
  const [bom, setBom] = useState(false);
  const [nested, setNested] = useState<NestedMode>('flatten');
  const [indent, setIndent] = useState(2);
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => {
    if (direction === 'json-to-csv') {
      return jsonToCsv(input, { delimiter, hasHeader, lineEnding, bom, nested });
    }
    return csvToJson(input, { delimiter, hasHeader, indent });
  }, [bom, delimiter, direction, hasHeader, indent, input, lineEnding, nested]);

  const output = result.error ? '' : result.text;

  const handleCopy = useCallback(async () => {
    if (!output) return;
    // Copy the exact text, BOM included: pasting it into a file is the main way
    // this tool is used, and a missing BOM is the bug it exists to prevent.
    const ok = await copyToClipboard(output);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1400);
  }, [output]);

  const handleSwap = useCallback(() => {
    setInput(output);
    setDirection((current) => (current === 'json-to-csv' ? 'csv-to-json' : 'json-to-csv'));
  }, [output]);

  const handleClear = useCallback(() => {
    setInput('');
    setCopied(false);
  }, []);

  const handleSample = useCallback(() => {
    setInput(direction === 'json-to-csv' ? SAMPLE_JSON : SAMPLE_CSV);
  }, [direction]);

  const rowLabel =
    direction === 'json-to-csv'
      ? `${result.rowCount} 条记录${hasHeader ? ` · ${result.columns.length} 列` : ''}`
      : `${result.rowCount} ${hasHeader ? '条记录' : '行'}`;

  return (
    <div className={styles.stack}>
      <TabList
        selectedValue={direction}
        onTabSelect={(_, data) => setDirection(data.value as Direction)}
      >
        <Tab value="json-to-csv">JSON → CSV</Tab>
        <Tab value="csv-to-json">CSV → JSON</Tab>
      </TabList>

      <div className={styles.toolbar}>
        <Dropdown
          className={styles.select}
          value={DELIMITER_LABELS[delimiter]}
          selectedOptions={[delimiter]}
          onOptionSelect={(_, data) => setDelimiter(data.optionValue as CsvDelimiter)}
          aria-label="字段分隔符"
        >
          {DELIMITER_ORDER.map((value) => (
            <Option key={value} value={value} text={DELIMITER_LABELS[value]}>
              {DELIMITER_LABELS[value]}
            </Option>
          ))}
        </Dropdown>

        <Switch
          checked={hasHeader}
          onChange={(_, data) => setHasHeader(Boolean(data.checked))}
          label={direction === 'json-to-csv' ? '输出表头行' : '首行是表头'}
        />

        {direction === 'json-to-csv' && (
          <>
            <Dropdown
              className={styles.select}
              value={NESTED_LABELS[nested]}
              selectedOptions={[nested]}
              onOptionSelect={(_, data) => setNested(data.optionValue as NestedMode)}
              aria-label="嵌套对象与数组的处理方式"
            >
              {(Object.keys(NESTED_LABELS) as NestedMode[]).map((value) => (
                <Option key={value} value={value} text={NESTED_LABELS[value]}>
                  {NESTED_LABELS[value]}
                </Option>
              ))}
            </Dropdown>

            <Dropdown
              className={styles.select}
              value={LINE_ENDING_LABELS[lineEnding]}
              selectedOptions={[lineEnding]}
              onOptionSelect={(_, data) => setLineEnding(data.optionValue as LineEnding)}
              aria-label="行尾"
            >
              {(Object.keys(LINE_ENDING_LABELS) as LineEnding[]).map((value) => (
                <Option key={value} value={value} text={LINE_ENDING_LABELS[value]}>
                  {LINE_ENDING_LABELS[value]}
                </Option>
              ))}
            </Dropdown>

            <Tooltip
              content="在文件开头写入 U+FEFF。Excel 打开没有 BOM 的 UTF-8 CSV 时会按本地代码页解码，「小麦」会变成乱码；加上 BOM 就不会。用不到 Excel 时不要加，某些命令行工具会把 BOM 当成第一个字段的一部分（本工具自己解析时会自动忽略它）。"
              relationship="description"
              withArrow
            >
              <Switch
                checked={bom}
                onChange={(_, data) => setBom(Boolean(data.checked))}
                label="写入 UTF-8 BOM"
              />
            </Tooltip>
          </>
        )}

        {direction === 'csv-to-json' && (
          <Switch
            checked={indent > 0}
            onChange={(_, data) => setIndent(data.checked ? 2 : 0)}
            label="格式化 JSON"
          />
        )}

        <span className={styles.spacer} />

        <Button
          appearance="secondary"
          icon={<ArrowSwap16Regular />}
          onClick={handleSwap}
          disabled={!output}
        >
          交换方向
        </Button>
        <Button appearance="subtle" icon={<Broom16Regular />} onClick={handleClear} disabled={!input}>
          清空
        </Button>
      </div>

      <MessageBar intent="info">
        <MessageBarBody>
          <MessageBarTitle>
            {direction === 'json-to-csv'
              ? `嵌套对象与数组：${nested === 'flatten' ? '扁平化（默认）' : 'JSON 文本'}`
              : 'CSV 解析规则（RFC 4180）'}
          </MessageBarTitle>
          <div className={styles.note}>
            {direction === 'json-to-csv'
              ? NESTED_NOTES[nested]
              : '字段含分隔符、双引号或换行时必须用双引号括起来，字段内的双引号写成两个（""）。两种行尾都会接受，末尾的换行不会多产生一条空记录。'}
          </div>
        </MessageBarBody>
      </MessageBar>

      <Caption1 className={styles.hint}>
        只处理 JSON 与 CSV 文本，不读写 Excel 的 .xlsx 文件（那是二进制格式，需要另外的解析器）。
      </Caption1>

      <div className="wt-split">
        <section className="wt-surface" aria-label="输入">
          <div className="wt-surface__header">
            <DocumentText16Regular />
            <Text as="h2" size={300} weight="semibold">
              输入
            </Text>
            <span className={styles.spacer} />
            <Button appearance="subtle" size="small" onClick={handleSample}>
              填入示例
            </Button>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <textarea
              className="wt-code-area"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={
                direction === 'json-to-csv'
                  ? '在此粘贴 JSON 数组，例如：\n[{"id":1,"user":{"name":"小麦"}},{"id":2}]'
                  : '在此粘贴 CSV，例如：\nid,name\n1,"含逗号, 的字段"'
              }
              aria-label={direction === 'json-to-csv' ? '待转换的 JSON' : '待转换的 CSV'}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
            />
          </div>
        </section>

        <section className="wt-surface" aria-label="输出">
          <div className="wt-surface__header">
            <Table16Regular />
            <Text as="h2" size={300} weight="semibold">
              输出
            </Text>
            <span className={styles.spacer} />
            {output && (
              <>
                <Badge appearance="tint" color="brand" size="small">
                  {rowLabel}
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
            {result.error ? (
              <div style={{ padding: '12px 14px' }}>
                <MessageBar intent="error" layout="multiline">
                  <MessageBarBody>
                    <MessageBarTitle>无法解析输入</MessageBarTitle>
                    <div className={`${styles.note} ${styles.mono}`}>{result.error}</div>
                  </MessageBarBody>
                </MessageBar>
              </div>
            ) : output ? (
              <textarea
                className="wt-code-area"
                value={output}
                readOnly
                aria-label="转换结果"
                spellCheck={false}
              />
            ) : (
              <div className="wt-empty">
                <Table16Regular />
                <Text weight="semibold">
                  {input.trim() ? '没有可显示的转换结果' : '等待输入'}
                </Text>
                <Caption1>
                  {input.trim()
                    ? '输入没有产生任何行；空数组与空对象都会得到空结果'
                    : direction === 'json-to-csv'
                      ? '粘贴 JSON 后即时生成 CSV，键取并集、缺失值留空'
                      : '粘贴 CSV 后即时生成 JSON，正确解析带引号的字段'}
                </Caption1>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
