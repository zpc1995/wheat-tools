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
  Code16Regular,
  Copy16Regular,
  DocumentText16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { useCallback, useMemo, useState } from 'react';
import { MAPPING_NOTES, jsonToXml, xmlToJson } from './xmlJsonUtils';

type Direction = 'xml-to-json' | 'json-to-xml';

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:dc="http://purl.org/dc/elements/1.1/">
  <book id="bk101" available="true">
    <dc:title>小麦与面粉</dc:title>
    <author>张三</author>
    <price currency="CNY">39.5</price>
    <tags><tag>烘焙</tag><tag>实用</tag></tags>
    <!-- 库存数量见 ERP -->
    <desc><![CDATA[原文含 <em> 与 & 符号]]></desc>
  </book>
  <book id="bk102">
    <dc:title>面包科学</dc:title>
    <author>李四</author>
  </book>
</catalog>`;

const SAMPLE_JSON = `{
  "catalog": {
    "@version": "1.0",
    "book": [
      { "@id": "bk101", "#text": "库存充足", "title": "小麦与面粉", "price": "39.5" },
      { "@id": "bk102", "title": "面包科学", "note": null }
    ]
  }
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
  rootInput: {
    minWidth: '180px',
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
    // A denied clipboard must be reported, not silently swallowed: the button
    // would otherwise claim success for a copy that never happened.
    return false;
  }
}

export function XmlJsonTool() {
  const styles = useStyles();

  const [direction, setDirection] = useState<Direction>('xml-to-json');
  const [input, setInput] = useState('');
  const [indent, setIndent] = useState('2');
  const [keepComments, setKeepComments] = useState(false);
  const [trimText, setTrimText] = useState(true);
  const [wrapRoot, setWrapRoot] = useState(true);
  const [declaration, setDeclaration] = useState(true);
  const [nameFix, setNameFix] = useState<'error' | 'sanitize'>('error');
  const [rootName, setRootName] = useState('');
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => {
    const indentValue = Number.parseInt(indent, 10);
    if (direction === 'xml-to-json') {
      return xmlToJson(input, { trimText, keepComments, wrapRoot }, indentValue);
    }
    return jsonToXml(input, {
      indent: indentValue,
      declaration,
      nameFix,
      rootName: rootName.trim() === '' ? undefined : rootName.trim(),
    });
  }, [declaration, direction, indent, input, keepComments, nameFix, rootName, trimText, wrapRoot]);

  const output = result.ok ? result.text : '';
  const errorMessage = result.ok
    ? ''
    : result.line !== undefined && result.column !== undefined
      ? `第 ${result.line} 行第 ${result.column} 列：${result.error}`
      : result.error;

  const handleCopy = useCallback(async () => {
    if (!output) return;
    const ok = await copyToClipboard(output);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1400);
  }, [output]);

  const handleSwap = useCallback(() => {
    setInput(output);
    setDirection((current) => (current === 'xml-to-json' ? 'json-to-xml' : 'xml-to-json'));
    setCopied(false);
  }, [output]);

  const handleClear = useCallback(() => {
    setInput('');
    setCopied(false);
  }, []);

  const handleSample = useCallback(() => {
    setInput(direction === 'xml-to-json' ? SAMPLE_XML : SAMPLE_JSON);
  }, [direction]);

  return (
    <div className={styles.stack}>
      <TabList
        selectedValue={direction}
        onTabSelect={(_, data) => setDirection(data.value as Direction)}
      >
        <Tab value="xml-to-json">XML → JSON</Tab>
        <Tab value="json-to-xml">JSON → XML</Tab>
      </TabList>

      <div className={styles.toolbar}>
        <Dropdown
          className={styles.select}
          value={INDENT_LABELS[indent]}
          selectedOptions={[indent]}
          onOptionSelect={(_, data) => setIndent(data.optionValue ?? '2')}
          aria-label="缩进"
        >
          {Object.keys(INDENT_LABELS).map((value) => (
            <Option key={value} value={value} text={INDENT_LABELS[value]}>
              {INDENT_LABELS[value]}
            </Option>
          ))}
        </Dropdown>

        {direction === 'xml-to-json' ? (
          <>
            <Tooltip
              content="注释在 JSON 里没有对应物。默认丢弃，开启后写入 #comment（多个注释写成数组）。"
              relationship="description"
              withArrow
            >
              <Switch
                checked={keepComments}
                onChange={(_, data) => setKeepComments(Boolean(data.checked))}
                label="保留注释（#comment）"
              />
            </Tooltip>
            <Tooltip
              content="开启时顶层写成 { &quot;根元素名&quot;: { ... } }，JSON → XML 才知道根元素叫什么。关掉后输出是裸对象，根元素名会丢，转回 XML 时必须手动填写根元素名。"
              relationship="description"
              withArrow
            >
              <Switch
                checked={wrapRoot}
                onChange={(_, data) => setWrapRoot(Boolean(data.checked))}
                label="顶层保留根元素名"
              />
            </Tooltip>
            <Tooltip
              content="开启时，元素之间只由空白组成的文本节点会被丢掉，缩进过的 XML 才能转出干净的 JSON；文本两端的空白也会被去掉。关闭后每个换行与缩进都会进入 #text。"
              relationship="description"
              withArrow
            >
              <Switch
                checked={trimText}
                onChange={(_, data) => setTrimText(Boolean(data.checked))}
                label="修剪文本空白"
              />
            </Tooltip>
          </>
        ) : (
          <>
            <Tooltip
              content="XML 声明（<?xml version=...?>）。关掉后只输出根元素，便于把结果片段嵌进别的文档。"
              relationship="description"
              withArrow
            >
              <Switch
                checked={declaration}
                onChange={(_, data) => setDeclaration(Boolean(data.checked))}
                label="写入 XML 声明"
              />
            </Tooltip>
            <Tooltip
              content="键名不能以数字开头、不能含空格或 @ # 等字符。默认直接报错；开启后把非法字符换成下划线、数字开头补下划线，这会改变元素名。"
              relationship="description"
              withArrow
            >
              <Switch
                checked={nameFix === 'sanitize'}
                onChange={(_, data) => setNameFix(data.checked ? 'sanitize' : 'error')}
                label="自动清洗非法名称"
              />
            </Tooltip>
            <input
              className={`wt-inline-input ${styles.rootInput}`}
              value={rootName}
              onChange={(event) => setRootName(event.target.value)}
              placeholder="根元素名（可选）"
              aria-label="根元素名（可选）"
              spellCheck={false}
            />
          </>
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

      <MessageBar intent="warning">
        <MessageBarBody>
          <MessageBarTitle>映射约定（没有唯一正确的映射，且本约定有损）</MessageBarTitle>
          <ul className={styles.list}>
            {MAPPING_NOTES.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </MessageBarBody>
      </MessageBar>

      <Caption1 className={styles.hint}>
        安全：拒绝 <span className={styles.mono}>{'<!DOCTYPE'}</span> 与{' '}
        <span className={styles.mono}>{'<!ENTITY'}</span>，因为 DTD 能声明外部实体（XXE：读取本地文件或发起内网请求）。
        未定义的实体引用同样直接报错。不做 XSD/DTD 校验、不解析命名空间前缀、不做 XSLT，不联网。
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
                direction === 'xml-to-json'
                  ? '在此粘贴 XML，例如：\n<catalog><book id="1"><title>小麦</title></book></catalog>'
                  : '在此粘贴 JSON，例如：\n{ "catalog": { "book": { "@id": "1", "title": "小麦" } } }'
              }
              aria-label={direction === 'xml-to-json' ? '待转换的 XML' : '待转换的 JSON'}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
            />
          </div>
        </section>

        <section className="wt-surface" aria-label="输出">
          <div className="wt-surface__header">
            <Code16Regular />
            <Text as="h2" size={300} weight="semibold">
              输出
            </Text>
            <span className={styles.spacer} />
            {output && (
              <>
                <Badge appearance="tint" color="brand" size="small">
                  {direction === 'xml-to-json' ? 'JSON' : 'XML'}
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
                        <MessageBarTitle>这次转换丢掉了这些信息</MessageBarTitle>
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
                <Code16Regular />
                <Text weight="semibold">
                  {input.trim() ? '没有可显示的转换结果' : '等待输入'}
                </Text>
                <Caption1>
                  {direction === 'xml-to-json'
                    ? '粘贴 XML 后立即得到 JSON；属性成为 @name，文本成为 #text，重复子元素成为数组'
                    : '粘贴 JSON 后立即得到 XML；顶层只允许一个键作为根元素，null 会变成空元素'}
                </Caption1>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
