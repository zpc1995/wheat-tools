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
  CheckmarkCircleRegular,
  CheckmarkRegular,
  CodeRegular,
  CopyRegular,
  DocumentTextRegular,
  WarningRegular,
  BroomRegular,
} from '@fluentui/react-icons';
import { useCallback, useMemo, useState } from 'react';
import {
  SAMPLE_XML,
  formatXml,
  lineExcerpt,
  validateXml,
  type XmlFormatResult,
} from './xmlFormatterUtils';

type Mode = 'pretty' | 'compact' | 'validate';

const INDENT_LABELS: Record<string, string> = {
  '2': '2 空格',
  '4': '4 空格',
  '8': '8 空格',
  tab: '制表符',
};

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
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
    lineHeight: 1.7,
    display: 'block',
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
  },
  warnings: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  report: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '16px',
  },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
    gap: '10px',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '8px 12px',
    borderRadius: '6px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  statValue: {
    fontVariantNumeric: 'tabular-nums',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '16px',
    fontWeight: 600,
  },
  snippet: {
    margin: 0,
    padding: '10px 12px',
    borderRadius: '6px',
    backgroundColor: tokens.colorNeutralBackground3,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
    whiteSpace: 'pre',
    overflowX: 'auto',
  },
});

async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // A denied clipboard must be reported rather than swallowed: a button that
    // claims success for a copy that never happened is worse than no button.
    return false;
  }
}

interface StatProps {
  label: string;
  value: string;
}

function Stat({ label, value }: StatProps) {
  const styles = useStyles();
  return (
    <div className={styles.stat}>
      <Caption1>{label}</Caption1>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}

export function XmlFormatterTool() {
  const styles = useStyles();

  const [mode, setMode] = useState<Mode>('pretty');
  const [indent, setIndent] = useState('2');
  const [attributesOnNewLine, setAttributesOnNewLine] = useState(false);
  const [preserveComments, setPreserveComments] = useState(true);
  const [input, setInput] = useState(SAMPLE_XML);
  const [copied, setCopied] = useState(false);

  const formatResult: XmlFormatResult | null = useMemo(() => {
    if (mode === 'validate') return null;
    return formatXml(input, {
      mode,
      indent: indent === 'tab' ? 1 : Number.parseInt(indent, 10),
      indentUnit: indent === 'tab' ? 'tab' : 'space',
      attributesOnNewLine,
      preserveComments,
    });
  }, [attributesOnNewLine, indent, input, mode, preserveComments]);

  const validation = useMemo(() => (mode === 'validate' ? validateXml(input) : null), [input, mode]);

  const output = formatResult?.ok ? formatResult.text : '';

  const handleCopy = useCallback(async () => {
    if (output === '') return;
    const ok = await copyToClipboard(output);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1400);
  }, [output]);

  const error = formatResult?.ok === false ? formatResult : validation?.ok === false ? validation : null;
  const excerpt = error ? lineExcerpt(input, error.line, error.column) : null;

  const formatWarnings = formatResult?.ok ? formatResult.warnings : [];
  const validationWarnings = validation?.ok ? validation.warnings : [];

  return (
    <div className="wt-surface">
      <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
        <div className={styles.stack} style={{ padding: '16px' }}>
          <div>
            <Text as="h2" size={300} weight="semibold">
              XML 格式化 · 压缩 · 校验
            </Text>
            <Caption1 className={styles.hint}>
              解析器不是新写的：它**复用**了「XML 转 JSON」工具里那套自写解析器
              （同一个文件，本工具只读取、不修改）。因此两个工具对「什么是合法 XML」的判断完全一致，
              而且格式化的正确性有明确的定义——只改空白，不改结构：元素、属性、文本内容与 CDATA
              都逐字节保留，只有元素之间的缩进空白会被重排。
            </Caption1>
          </div>

          <TabList selectedValue={mode} onTabSelect={(_, data) => setMode(data.value as Mode)}>
            <Tab value="pretty">格式化</Tab>
            <Tab value="compact">压缩</Tab>
            <Tab value="validate">校验</Tab>
          </TabList>

          <div className={styles.toolbar}>
            {mode === 'validate' ? (
              <Caption1 className={styles.hint}>
                校验 XML 1.0 良构性（well-formedness）：标签配平、属性引号、非法字符、重复属性、
                未定义实体、多个根元素。给出出错的行、列与代码片段。
              </Caption1>
            ) : (
              <>
                <Dropdown
                  className={styles.select}
                  value={indent === 'tab' ? INDENT_LABELS.tab : INDENT_LABELS[indent]}
                  selectedOptions={[indent]}
                  onOptionSelect={(_, data) => setIndent(data.optionValue ?? '2')}
                  disabled={mode === 'compact'}
                  aria-label="缩进"
                >
                  {Object.keys(INDENT_LABELS).map((value) => (
                    <Option key={value} value={value} text={INDENT_LABELS[value]}>
                      {INDENT_LABELS[value]}
                    </Option>
                  ))}
                </Dropdown>

                <Tooltip
                  content="每个属性单独占一行，适合属性很多、行长到需要横向滚动的文档。压缩模式下这个选项无效。"
                  relationship="description"
                  withArrow
                >
                  <Switch
                    checked={attributesOnNewLine}
                    onChange={(_, data) => setAttributesOnNewLine(Boolean(data.checked))}
                    label="属性各占一行"
                    disabled={mode === 'compact'}
                  />
                </Tooltip>

                <Tooltip
                  content="关闭后注释会被删掉，这是有损操作（注释里可能写着业务规则）。"
                  relationship="description"
                  withArrow
                >
                  <Switch
                    checked={preserveComments}
                    onChange={(_, data) => setPreserveComments(Boolean(data.checked))}
                    label="保留注释"
                  />
                </Tooltip>
              </>
            )}

            <span className={styles.spacer} />

            <Button
              appearance="subtle"
              size="small"
              onClick={() => {
                setInput(SAMPLE_XML);
                setCopied(false);
              }}
            >
              填入示例
            </Button>
            <Button
              appearance="subtle"
              size="small"
              icon={<BroomRegular />}
              onClick={() => {
                setInput('');
                setCopied(false);
              }}
              disabled={input === ''}
              aria-label="清空输入"
            />
          </div>

          <div className="wt-split">
            <section className="wt-surface" aria-label="XML 输入">
              <div className="wt-surface__header">
                <DocumentTextRegular />
                <Text as="h2" size={300} weight="semibold">
                  XML
                </Text>
              </div>
              <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                <textarea
                  className="wt-code-area"
                  value={input}
                  onChange={(event) => {
                    setInput(event.target.value);
                    setCopied(false);
                  }}
                  placeholder={'在此粘贴 XML，例如：\n<catalog><book id="1"><title>小麦</title></book></catalog>'}
                  aria-label="待处理的 XML"
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                />
              </div>
            </section>

            <section className="wt-surface" aria-label="结果">
              <div className="wt-surface__header">
                {mode === 'validate' ? <CheckmarkCircleRegular /> : <CodeRegular />}
                <Text as="h2" size={300} weight="semibold">
                  {mode === 'validate' ? '校验结果' : mode === 'compact' ? '压缩结果' : '格式化结果'}
                </Text>
                <span className={styles.spacer} />
                {output !== '' && (
                  <>
                    <Badge appearance="tint" color="brand" size="small">
                      {output.length} 字符
                    </Badge>
                    <Tooltip content="复制结果" relationship="label" withArrow>
                      <Button
                        appearance="subtle"
                        icon={copied ? <CheckmarkRegular /> : <CopyRegular />}
                        onClick={handleCopy}
                        aria-label="复制结果"
                      />
                    </Tooltip>
                  </>
                )}
              </div>
              <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                {mode === 'validate' && validation ? (
                  <div className={styles.report}>
                    {validation.ok ? (
                      <>
                        <MessageBar intent="success">
                          <MessageBarBody>
                            <MessageBarTitle>语法正确（XML 1.0 良构）</MessageBarTitle>
                            标签配平、属性引号、实体引用与字符都在规范允许的范围内。
                          </MessageBarBody>
                        </MessageBar>
                        <div className={styles.stats}>
                          <Stat label="根元素" value={validation.stats.root} />
                          <Stat label="元素" value={String(validation.stats.elements)} />
                          <Stat label="属性" value={String(validation.stats.attributes)} />
                          <Stat label="最大深度" value={String(validation.stats.maxDepth)} />
                          <Stat label="注释" value={String(validation.stats.comments)} />
                          <Stat label="CDATA 段" value={String(validation.stats.cdata)} />
                          <Stat
                            label="处理指令"
                            value={String(validation.stats.processingInstructions)}
                          />
                          <Stat label="文本字符数" value={String(validation.stats.textLength)} />
                        </div>
                        <Caption1 className={styles.hint}>
                          这里只判断「是不是良构的 XML」，不是 XSD/DTD 模式校验，也不校验元素顺序、
                          取值类型或必填属性——那些都需要一份 schema，本工具明确不做。
                        </Caption1>
                      </>
                    ) : (
                      <>
                        <MessageBar intent="error" layout="multiline">
                          <MessageBarBody>
                            <MessageBarTitle>
                              第 {validation.line} 行第 {validation.column} 列：{validation.error}
                            </MessageBarTitle>
                            <pre className={styles.snippet}>
                              {excerpt ? `${excerpt.text}\n${excerpt.caret}` : ''}
                            </pre>
                          </MessageBarBody>
                        </MessageBar>
                        <Caption1 className={styles.hint}>
                          行列位置对应上面输入框里的原文。常见原因：结束标签与开始标签不匹配、
                          属性值没有引号、出现了未定义的实体引用、同一元素上重复的属性名。
                        </Caption1>
                      </>
                    )}

                    {validationWarnings.length > 0 && (
                      <MessageBar intent="warning" layout="multiline">
                        <MessageBarBody>
                          <MessageBarTitle>能解析，但值得注意</MessageBarTitle>
                          <div className={styles.warnings}>
                            {validationWarnings.map((warning) => (
                              <div key={warning}>
                                <WarningRegular /> {warning}
                              </div>
                            ))}
                          </div>
                        </MessageBarBody>
                      </MessageBar>
                    )}
                  </div>
                ) : error ? (
                  <div style={{ padding: '12px 14px' }}>
                    <MessageBar intent="error" layout="multiline">
                      <MessageBarBody>
                        <MessageBarTitle>
                          无法处理：第 {error.line} 行第 {error.column} 列
                        </MessageBarTitle>
                        {error.error}
                        {excerpt && (
                          <pre className={styles.snippet}>
                            {`${excerpt.text}\n${excerpt.caret}`}
                          </pre>
                        )}
                      </MessageBarBody>
                    </MessageBar>
                  </div>
                ) : output === '' ? (
                  <div className="wt-empty">
                    <CodeRegular />
                    <Text weight="semibold">等待输入</Text>
                    <Caption1>输入 XML 后立即得到结果</Caption1>
                  </div>
                ) : (
                  <>
                    {formatWarnings.length > 0 && (
                      <div style={{ padding: '12px 14px 0' }}>
                        <MessageBar intent="warning" layout="multiline">
                          <MessageBarBody>
                            <MessageBarTitle>本次处理的副作用</MessageBarTitle>
                            <div className={styles.warnings}>
                              {formatWarnings.map((warning) => (
                                <div key={warning}>
                                  <WarningRegular /> {warning}
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
                      aria-label="处理结果"
                      spellCheck={false}
                    />
                  </>
                )}
              </div>
            </section>
          </div>

          <Caption1 className={styles.hint}>
            明确不做：不做 XSD / DTD / Relax NG 模式校验，不做 XSLT 转换，不做命名空间前缀重写，
            不联网。
            <span className={styles.mono}> xml:space=&quot;preserve&quot; </span>
            的子树会整体原样保留（包括它的换行与缩进），这是唯一一处缩进看起来「没对齐」的地方，
            因为改动它就等于改动内容。含
            <span className={styles.mono}> &lt;!DOCTYPE </span>
            的文档会被拒绝：这是「XML 转 JSON」那套解析器的 XXE 防护策略（DTD 能声明外部实体），
            属于策略性拒绝而不是语法错误——需要处理带 DTD 的文档请换别的工具。
          </Caption1>
        </div>
      </div>
    </div>
  );
}
