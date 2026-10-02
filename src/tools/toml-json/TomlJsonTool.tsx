import {
  Badge,
  Button,
  Caption1,
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
} from '@fluentui/react-components';
import {
  ArrowSwap16Regular,
  Broom16Regular,
  Checkmark16Regular,
  Copy16Regular,
  DocumentText16Regular,
  Settings16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { useCallback, useMemo, useState } from 'react';
import { MAPPING_NOTES, jsonToToml, tomlToJson } from './tomlJsonUtils';

type Direction = 'toml-to-json' | 'json-to-toml';

const SAMPLE_TOML = `# 一个覆盖主要类型的 TOML 文档
title = "小麦的工具站"
enabled = true
port = 8_080
ratio = 1.5
hex = 0xDEAD_BEEF
big = 9_223_372_036_854_775_807
limit = inf

[owner]
name = "张三"
"weird key.with.dots" = "键里有空格和点号"
born = 1979-05-27T07:32:00Z
local = 1979-05-27 07:32:00.999
day = 1979-05-27
alarm = 07:32:00

[owner.address]
city = "上海"
tags = ["烘焙", "实用"]

[[books]]
id = "bk101"
title = """多行
文本，反斜杠续行 \\ 
    会被合并"""

[[books]]
id = "bk102"
title = '字面量 \\n 不转义'
inline = { a = 1, b = { c = 2 } }
`;

const SAMPLE_JSON = `{
  "title": "小麦的工具站",
  "port": 8080,
  "born": { "$type": "toml-offset-date-time", "$value": "1979-05-27T07:32:00Z" },
  "limit": { "$type": "toml-float", "$value": "inf" },
  "owner": {
    "name": "张三",
    "address": { "city": "上海", "tags": ["烘焙", "实用"] }
  },
  "books": [
    { "id": "bk101", "title": "面包科学" },
    { "id": "bk102", "title": "小麦与面粉" }
  ]
}`;

const INDENT_LABELS: Record<string, string> = {
  '2': '2 空格',
  '4': '4 空格',
  '0': '不缩进（紧凑）',
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
  select: {
    minWidth: '170px',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  note: {
    lineHeight: 1.7,
  },
  list: {
    margin: 0,
    paddingInlineStart: '22px',
    lineHeight: 1.8,
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
  },
  warnings: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
});

async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Reporting the failure is more honest than flashing a "copied" state for
    // a copy that never happened.
    return false;
  }
}

export function TomlJsonTool() {
  const styles = useStyles();

  const [direction, setDirection] = useState<Direction>('toml-to-json');
  const [input, setInput] = useState('');
  const [indent, setIndent] = useState('2');
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => {
    const indentValue = Number.parseInt(indent, 10);
    if (direction === 'toml-to-json') return tomlToJson(input, indentValue);
    return jsonToToml(input);
  }, [direction, indent, input]);

  const output = result.ok ? result.text : '';
  const errorMessage = result.ok ? '' : (result.error ?? '转换失败');

  const handleCopy = useCallback(async () => {
    if (!output) return;
    const ok = await copyToClipboard(output);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1400);
  }, [output]);

  const handleSwap = useCallback(() => {
    setInput(output);
    setDirection((current) => (current === 'toml-to-json' ? 'json-to-toml' : 'toml-to-json'));
    setCopied(false);
  }, [output]);

  const handleClear = useCallback(() => {
    setInput('');
    setCopied(false);
  }, []);

  const handleSample = useCallback(() => {
    setInput(direction === 'toml-to-json' ? SAMPLE_TOML : SAMPLE_JSON);
  }, [direction]);

  return (
    <div className={styles.stack}>
      <TabList
        selectedValue={direction}
        onTabSelect={(_, data) => setDirection(data.value as Direction)}
      >
        <Tab value="toml-to-json">TOML → JSON</Tab>
        <Tab value="json-to-toml">JSON → TOML</Tab>
      </TabList>

      <div className={styles.toolbar}>
        <Dropdown
          className={styles.select}
          value={INDENT_LABELS[indent]}
          selectedOptions={[indent]}
          onOptionSelect={(_, data) => setIndent(data.optionValue ?? '2')}
          aria-label="缩进"
          disabled={direction === 'json-to-toml'}
        >
          {Object.keys(INDENT_LABELS).map((value) => (
            <Option key={value} value={value} text={INDENT_LABELS[value]}>
              {INDENT_LABELS[value]}
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
        <Button appearance="subtle" icon={<Broom16Regular />} onClick={handleClear} disabled={!input}>
          清空
        </Button>
      </div>

      <MessageBar intent="warning">
        <MessageBarBody>
          <MessageBarTitle>映射约定（JSON 与 TOML 不同构，约定不唯一）</MessageBarTitle>
          <ul className={styles.list}>
            {MAPPING_NOTES.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </MessageBarBody>
      </MessageBar>

      <Caption1 className={styles.hint}>
        解析器按 TOML v1.0.0 自己实现：表、数组表、点号键、内联表、数组、基本/多行/字面量字符串、
        各进制整数（支持下划线）、浮点与 inf/nan、四种日期时间。不做：不校验语义（例如不信
        <span className={styles.mono}>$type</span> 之外的业务规则）、不读文件、不联网、不保留注释与原始格式。
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
              onChange={(event) => {
                setInput(event.target.value);
                setCopied(false);
              }}
              placeholder={
                direction === 'toml-to-json'
                  ? '在此粘贴 TOML，例如：\ntitle = "小麦"\n[owner]\nborn = 1979-05-27T07:32:00Z'
                  : '在此粘贴 JSON，例如：\n{ "title": "小麦", "owner": { "name": "张三" } }'
              }
              aria-label={direction === 'toml-to-json' ? '待转换的 TOML' : '待转换的 JSON'}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
            />
          </div>
        </section>

        <section className="wt-surface" aria-label="输出">
          <div className="wt-surface__header">
            <Settings16Regular />
            <Text as="h2" size={300} weight="semibold">
              输出
            </Text>
            <span className={styles.spacer} />
            {output && (
              <>
                <Badge appearance="tint" color="brand" size="small">
                  {direction === 'toml-to-json' ? 'JSON' : 'TOML'}
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
            {errorMessage ? (
              <div style={{ padding: '12px 14px' }}>
                <MessageBar intent="error" layout="multiline">
                  <MessageBarBody>
                    <MessageBarTitle>无法转换</MessageBarTitle>
                    <div className={`${styles.note} ${styles.mono}`}>{errorMessage}</div>
                  </MessageBarBody>
                </MessageBar>
              </div>
            ) : output ? (
              <>
                {result.warnings.length > 0 && (
                  <div style={{ padding: '12px 14px 0' }}>
                    <MessageBar intent="warning" layout="multiline">
                      <MessageBarBody>
                        <MessageBarTitle>精度提醒</MessageBarTitle>
                        <div className={styles.warnings}>
                          {result.warnings.map((warning) => (
                            <div key={warning} className={styles.note}>
                              <Warning16Regular /> {warning}
                            </div>
                          ))}
                        </div>
                      </MessageBarBody>
                    </MessageBar>
                  </div>
                )}
                <textarea
                  className="wt-code-area"
                  value={output}
                  readOnly
                  aria-label="转换结果"
                  spellCheck={false}
                />
              </>
            ) : (
              <div className="wt-empty">
                <Settings16Regular />
                <Text weight="semibold">
                  {input.trim() ? '没有可显示的转换结果' : '等待输入'}
                </Text>
                <Caption1>
                  {direction === 'toml-to-json'
                    ? '粘贴 TOML 后立即得到 JSON；日期时间与 inf/nan 会变成 $type 标签对象'
                    : '粘贴 JSON 后立即得到 TOML；值是对象的键写成 [表]，元素全是对象的数组写成 [[数组表]]'}
                </Caption1>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
