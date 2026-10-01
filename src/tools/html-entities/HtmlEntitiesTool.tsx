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
  Switch,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowSwap16Regular,
  Checkmark16Regular,
  Code16Regular,
  Copy16Regular,
  Table16Regular,
} from '@fluentui/react-icons';
import { useCallback, useMemo, useState } from 'react';
import {
  decodeHtml,
  escapeHtml,
  formatCodePoint,
  scanEntities,
  type EntityKind,
  type EntityNote,
  type EscapeMode,
} from './htmlEntitiesUtils';

const MODES: Array<{ value: EscapeMode; label: string; note: string }> = [
  {
    value: 'sensitive',
    label: '只转义 HTML 敏感字符',
    note: '只处理 & < > " 与撇号，中文、emoji 等原样保留。绝大多数场景用这个。',
  },
  {
    value: 'nonAscii',
    label: '转义全部非 ASCII',
    note: '在敏感字符之外，把 U+007F 以上的每个码位写成数字实体，输出是纯 ASCII，可以安全穿过只认 ASCII 的管道。',
  },
];

const KIND_LABEL: Record<EntityKind, string> = {
  named: '命名',
  decimal: '十进制',
  hex: '十六进制',
};

const NOTE_LABEL: Record<EntityNote, string> = {
  'windows-1252-remap': '按 HTML 标准映射到 Windows-1252 字符',
  'unknown-name': '未知实体名，原样保留',
  'out-of-range': '码位超过 U+10FFFF，原样保留',
  surrogate: '代理区码位不是字符，原样保留',
};

/** Shown in the entity table; invisible characters need a visible stand-in. */
function displayChar(char: string): string {
  if (char === '\u00a0') return '␣ 不换行空格';
  if (/^[\u0000-\u001f\u007f-\u009f]$/.test(char)) {
    return `␀ ${formatCodePoint(char.codePointAt(0) as number)}`;
  }
  return char;
}

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    minWidth: 0,
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
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  headCell: {
    textAlign: 'left',
    padding: '8px 12px',
    color: tokens.colorNeutralForeground3,
    fontWeight: 600,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    whiteSpace: 'nowrap',
  },
  cell: {
    padding: '6px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    verticalAlign: 'top',
  },
  scroll: {
    maxHeight: '360px',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  notes: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    margin: 0,
    paddingLeft: '22px',
  },
  note: {
    color: tokens.colorNeutralForeground2,
    lineHeight: 1.7,
  },
  code: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: '4px',
    padding: '1px 4px',
  },
});

/**
 * Renders a literal token such as `&amp;lt;`.
 *
 * The value is passed as a child *expression* on purpose. JSX decodes HTML
 * entities in its text, so writing the reference directly in the markup would
 * display the decoded character instead of the reference — this whole page is
 * about that difference, so the tokens must be printed exactly as typed.
 */
function Token({ value }: { value: string }) {
  const styles = useStyles();
  return <code className={styles.code}>{value}</code>;
}

export function HtmlEntitiesTool() {
  const styles = useStyles();

  const [decode, setDecode] = useState(false);
  const [mode, setMode] = useState<EscapeMode>('sensitive');
  const [skipExisting, setSkipExisting] = useState(false);
  const [hexNumeric, setHexNumeric] = useState(false);
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);

  const output = useMemo(
    () =>
      decode
        ? decodeHtml(input)
        : escapeHtml(input, {
            mode,
            skipExistingEntities: skipExisting,
            hexNumeric,
          }),
    [decode, hexNumeric, input, mode, skipExisting],
  );

  const entries = useMemo(() => scanEntities(input), [input]);
  const unresolved = useMemo(() => entries.filter((entry) => !entry.resolved).length, [entries]);

  // Escaping text that already contains references is the most likely way to
  // mangle it, so it gets a warning rather than a silent result. The warning is
  // driven by the same scanner as the table below, so the two cannot disagree.
  const doubleEscapeRisk = !decode && !skipExisting && entries.length > 0;
  const activeMode = MODES.find((item) => item.value === mode) ?? MODES[0];

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard access can be denied; unflipping the icon is the honest result.
      setCopied(false);
    }
  }, [output]);

  const swap = useCallback(() => {
    // Carrying the output back into the input is what makes a
    // decode-escape-decode round trip bearable without copy-paste.
    setInput(output);
    setDecode((current) => !current);
  }, [output]);

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <Switch
          checked={decode}
          onChange={(_, data) => setDecode(data.checked)}
          label={decode ? '当前：反转义 → 字符' : '当前：转义 → 实体'}
        />

        {!decode && (
          <>
            <Dropdown
              style={{ minWidth: 220 }}
              value={activeMode.label}
              selectedOptions={[mode]}
              onOptionSelect={(_, data) => setMode(data.optionValue as EscapeMode)}
              aria-label="转义范围"
            >
              {MODES.map((item) => (
                <Option key={item.value} value={item.value} text={item.label}>
                  {item.label}
                </Option>
              ))}
            </Dropdown>
            <Checkbox
              checked={skipExisting}
              onChange={(_, data) => setSkipExisting(Boolean(data.checked))}
              label="避免二次转义（保留已有的实体引用）"
            />
            <Checkbox
              checked={hexNumeric}
              onChange={(_, data) => setHexNumeric(Boolean(data.checked))}
              label={'数字实体用十六进制（&#x27; 而不是 &#39;）'}
            />
          </>
        )}

        <span className={styles.spacer} />
        <Button
          appearance="secondary"
          icon={<ArrowSwap16Regular />}
          onClick={swap}
          disabled={!input}
        >
          结果换到输入并切换方向
        </Button>
        <Button appearance="subtle" onClick={() => setInput('')} disabled={!input}>
          清空
        </Button>
      </div>

      <div className="wt-split">
        <section className="wt-surface" aria-label="输入">
          <div className="wt-surface__header">
            <Code16Regular />
            <Text as="h2" size={300} weight="semibold">
              输入
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              {decode ? '包含实体引用的文本' : '原始文本 / HTML 片段'}
            </Caption1>
          </div>
          <div className="wt-surface__body">
            <textarea
              className="wt-code-area"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              aria-label="HTML 实体输入"
              spellCheck={false}
              placeholder={
                decode
                  ? '例如：&lt;p&gt;Tom &amp; Jerry&nbsp;&mdash; &#169; 2024&lt;/p&gt;'
                  : '例如：<p>Tom & Jerry\'s "note" © 2024</p>'
              }
            />
          </div>
        </section>

        <section className="wt-surface" aria-label="输出">
          <div className="wt-surface__header">
            <Code16Regular />
            <Text as="h2" size={300} weight="semibold">
              {decode ? '反转义结果' : '转义结果'}
            </Text>
            <span className={styles.spacer} />
            {output && (
              <Tooltip content="复制结果" relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
                  onClick={copy}
                  aria-label="复制结果"
                />
              </Tooltip>
            )}
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            {output ? (
              <textarea
                className="wt-code-area"
                value={output}
                readOnly
                aria-label="HTML 实体输出"
                spellCheck={false}
              />
            ) : (
              <div className="wt-empty">
                <Code16Regular />
                <Text weight="semibold">等待输入</Text>
                <Caption1>输入内容后即时转换，支持中文与 emoji</Caption1>
              </div>
            )}
          </div>
        </section>
      </div>

      {doubleEscapeRisk && (
        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>
              {`输入里已经有 ${entries.length} 个实体引用`}
            </MessageBarTitle>
            {'按当前设置它们会被再次转义：'}
            <Token value={'&amp;'} />
            {' 会变成 '}
            <Token value={'&amp;amp;'} />
            {'，页面上显示成字面量 “&amp;”。如果这些引用本来就该保留，请勾选「避免二次转义」；'}
            {'如果它们只是恰好长得像实体的正文，保持现状即可。'}
          </MessageBarBody>
        </MessageBar>
      )}

      {!decode && (
        <MessageBar intent="info">
          <MessageBarBody>
            <Badge appearance="tint" color="brand" size="small">
              当前范围
            </Badge>{' '}
            {activeMode.note}
          </MessageBarBody>
        </MessageBar>
      )}

      {entries.length > 0 && (
        <section className="wt-surface" aria-label="实体清单">
          <div className="wt-surface__header">
            <Table16Regular />
            <Text as="h2" size={300} weight="semibold">
              识别到的实体引用
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              {decode
                ? `共 ${entries.length} 个，其中 ${unresolved} 个无法解析、原样保留`
                : `共 ${entries.length} 个${skipExisting ? '（保留，不再转义）' : '（会被再次转义）'}`}
            </Caption1>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.headCell}>原文</th>
                    <th className={styles.headCell}>写法</th>
                    <th className={styles.headCell}>名称 / 码位</th>
                    <th className={styles.headCell}>字符</th>
                    <th className={styles.headCell}>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.slice(0, 300).map((entry, index) => (
                    <tr key={`${entry.raw}-${index}`}>
                      <td className={`${styles.cell} ${styles.mono}`}>{entry.raw}</td>
                      <td className={styles.cell}>{KIND_LABEL[entry.kind]}</td>
                      <td className={`${styles.cell} ${styles.mono}`}>
                        {entry.name ??
                          (entry.codePoint === null ? '—' : formatCodePoint(entry.codePoint))}
                      </td>
                      <td className={`${styles.cell} ${styles.mono}`}>
                        {entry.char === null ? '—' : displayChar(entry.char)}
                      </td>
                      <td className={styles.cell}>
                        {entry.note === null
                          ? entry.resolved
                            ? '可解析'
                            : '—'
                          : NOTE_LABEL[entry.note]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {entries.length > 300 && (
              <Caption1 className={styles.hint} style={{ padding: '8px 12px' }}>
                只显示前 300 条，共 {entries.length} 条
              </Caption1>
            )}
          </div>
        </section>
      )}

      <section className="wt-surface" aria-label="转换说明">
        <div className="wt-surface__header">
          <Code16Regular />
          <Text as="h2" size={300} weight="semibold">
            这里是怎样转换的
          </Text>
        </div>
        <div
          className="wt-surface__body"
          style={{ flexDirection: 'column', padding: '14px 16px' }}
        >
          <ul className={styles.notes}>
            <li className={styles.note}>
              <strong>{'& 必须最先替换。'}</strong>
              {'如果先把 '}
              <Token value={'<'} />
              {' 换成 '}
              <Token value={'&lt;'} />
              {'，再整体跑一遍 '}
              <Token value={'&'} />
              {' → '}
              <Token value={'&amp;'} />
              {'，刚生成的实体就会被再破坏一次，得到 '}
              <Token value={'&amp;lt;'} />
              {'，页面上显示成字面量 “&lt;”。本工具单次扫描、逐字符查表，不存在可踩的顺序。'}
            </li>
            <li className={styles.note}>
              <strong>重复转义要自己决定。</strong>
              <Token value={'&amp;'} />
              {' 本身是合法实体，再转义一次得到 '}
              <Token value={'&amp;amp;'} />
              {'。工具无法猜出输入的来历，所以勾选「避免二次转义」后，输入里已经写好的 '}
              <Token value={'&name;'} />
              {'、'}
              <Token value={'&#169;'} />
              {'、'}
              <Token value={'&#xA9;'} />
              {' 都会原样保留。缺少分号的 '}
              <Token value={'&amp'} />
              {' 不算实体，因为 '}
              <Token value={'AT&T'} />
              {' 和它无法区分。'}
            </li>
            <li className={styles.note}>
              <strong>未知实体原样保留。</strong>
              <Token value={'&notreal;'} />
              {' 不是实体，这里原样输出，不会变成空、也不会变成问号。浏览器反而更激进：'}
              <Token value={'&not'} />
              {' 是可以省略分号的历史遗留实体，所以浏览器把 '}
              <Token value={'&notreal;'} />
              {' 解析成 '}
              <Token value={'¬real;'} />
              {'。对转换工具来说那是静默损坏，因此这里选择不猜。'}
            </li>
            <li className={styles.note}>
              <strong>反转义只解一层。</strong>
              <Token value={'&amp;lt;'} />
              {' 得到 '}
              <Token value={'&lt;'} />
              {'，而不是 '}
              <Token value={'<'} />
              {'。反复解码直到文本不再变化是常见的错误写法：它会误解输入，也会被构造出来的嵌套实体拖垮。'}
            </li>
            <li className={styles.note}>
              <strong>数字实体是码位。</strong>
              <Token value={'&#169;'} />
              {' 与 '}
              <Token value={'&#xA9;'} />
              {' 都得到 ©；'}
              <Token value={'&#x1F600;'} />
              {' 得到一个 emoji，而不是两个代理项。代理区码位（'}
              <Token value={'&#xD800;'} />
              {'）和超过 U+10FFFF 的值不是字符，这里原样保留（浏览器会替换成 U+FFFD）；'}
              {'0x80–0x9F 区间按 HTML 标准的 Windows-1252 映射处理，所以 '}
              <Token value={'&#128;'} />
              {' 是 €。'}
            </li>
            <li className={styles.note}>
              <strong>覆盖范围与边界。</strong>
              {'命名实体表来自 WHATWG HTML 标准公布的实体清单，包含全部 2125 个以分号结尾的名字，'}
              {'其中包括会展开成多个码位的 '}
              <Token value={'&nvlt;'} />
              {' 这类。'}
              <Token value={'&apos;'} />
              {' 属于 XML，HTML 4 没有它，因此撇号一律写成数字实体。'}
              {'本工具只做文本与实体之间的转换：'}
              <strong>不做 HTML 净化、不解析或过滤标签、不发起任何网络请求</strong>
              {'；转义结果也不等于安全的 HTML —— 安全与否取决于你把结果放进什么上下文。'}
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
