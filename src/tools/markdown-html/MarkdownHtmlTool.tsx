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
  BeakerRegular,
  BroomRegular,
  CheckmarkRegular,
  CodeBlockRegular,
  CopyRegular,
  DocumentTextRegular,
  WarningRegular,
} from '@fluentui/react-icons';
import { useCallback, useMemo, useState } from 'react';
import {
  SAMPLE_MARKDOWN,
  XSS_SAMPLE,
  renderMarkdownToHtml,
  type HtmlStyle,
} from './markdownHtmlUtils';

const STYLE_LABELS: Record<HtmlStyle, string> = {
  none: '不加样式（语义标签）',
  embedded: '内嵌样式表',
  tailwind: 'Tailwind 类名',
};

const TOC_DEPTH_LABELS: Record<string, string> = {
  '2': '到二级标题',
  '3': '到三级标题',
  '4': '到四级标题',
  '6': '全部标题',
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
    minWidth: '190px',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
    lineHeight: 1.7,
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
  },
  titleInput: {
    minWidth: '200px',
  },
  list: {
    margin: 0,
    paddingInlineStart: '22px',
    lineHeight: 1.8,
  },
  warnings: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
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
    // A denied clipboard is reported rather than swallowed: a button that
    // claims "已复制" for a copy that never happened is worse than no button.
    return false;
  }
}

export function MarkdownHtmlTool() {
  const styles = useStyles();

  const [input, setInput] = useState(SAMPLE_MARKDOWN);
  const [document, setDocument] = useState(false);
  const [style, setStyle] = useState<HtmlStyle>('none');
  const [minify, setMinify] = useState(false);
  const [toc, setToc] = useState(false);
  const [tocDepth, setTocDepth] = useState('3');
  const [allowHtml, setAllowHtml] = useState(false);
  const [breaks, setBreaks] = useState(false);
  const [title, setTitle] = useState('');
  const [lang, setLang] = useState('zh-CN');
  const [copied, setCopied] = useState(false);

  const result = useMemo(
    () =>
      renderMarkdownToHtml(input, {
        document,
        style,
        minify,
        toc,
        tocDepth: Number.parseInt(tocDepth, 10),
        allowHtml,
        breaks,
        title,
      }),
    [allowHtml, breaks, document, input, minify, style, title, toc, tocDepth],
  );

  const handleCopy = useCallback(async () => {
    if (result.html === '') return;
    const ok = await copyToClipboard(result.html);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1400);
  }, [result.html]);

  return (
    <div className="wt-surface">
      <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
        <div className={styles.stack} style={{ padding: '16px' }}>
          <div>
            <Text as="h2" size={300} weight="semibold">
              输出 HTML 源码
            </Text>
            <Caption1 className={styles.hint}>
              本工具产出的是<span className={styles.mono}>字符串</span>
              ，可以复制到博客、邮件模板或 CMS 里；它不做渲染预览。要看渲染效果请用「Markdown 预览」
              ——那个工具把 Markdown 渲染成页面上的元素，输出的是节点而不是源码。
            </Caption1>
          </div>

          <MessageBar intent="warning" layout="multiline">
            <MessageBarBody>
              <MessageBarTitle>安全：源码里的原始 HTML 默认只当文本</MessageBarTitle>
              <ul className={styles.list}>
                <li>
                  原始 HTML（<span className={styles.mono}>{'<script>'}</span>、
                  <span className={styles.mono}>{'<img onerror=…>'}</span>）默认被转义成纯文本，
                  不会生成可执行标签，也不会保留任何事件属性。
                </li>
                <li>
                  链接与图片地址只允许 <span className={styles.mono}>http:</span>、
                  <span className={styles.mono}>https:</span>、
                  <span className={styles.mono}>mailto:</span>、
                  <span className={styles.mono}>tel:</span> 以及相对路径；
                  <span className={styles.mono}>javascript:</span> 与{' '}
                  <span className={styles.mono}>data:</span> 会被拦掉，地址不会出现在输出里。
                </li>
                <li>
                  打开「允许内联 HTML」后不再有防护：输出会原样包含源码里的 HTML，只应粘贴到你自己信任的地方。
                </li>
              </ul>
            </MessageBarBody>
          </MessageBar>

          <div className={styles.toolbar}>
            <Dropdown
              className={styles.select}
              value={document ? '完整 HTML 文档' : 'HTML 片段'}
              selectedOptions={[document ? 'document' : 'fragment']}
              onOptionSelect={(_, data) => setDocument(data.optionValue === 'document')}
              aria-label="输出形态"
            >
              <Option value="fragment" text="HTML 片段">
                HTML 片段（直接嵌入页面）
              </Option>
              <Option value="document" text="完整 HTML 文档">
                完整 HTML 文档（含 doctype / head）
              </Option>
            </Dropdown>

            <Dropdown
              className={styles.select}
              value={STYLE_LABELS[style]}
              selectedOptions={[style]}
              onOptionSelect={(_, data) => setStyle((data.optionValue as HtmlStyle) ?? 'none')}
              aria-label="样式"
            >
              {(Object.keys(STYLE_LABELS) as HtmlStyle[]).map((value) => (
                <Option key={value} value={value} text={STYLE_LABELS[value]}>
                  {STYLE_LABELS[value]}
                </Option>
              ))}
            </Dropdown>

            <Tooltip
              content="只去掉块级元素之间的换行，不改任何文本内容；<pre> 里的换行属于内容，会原样保留。"
              relationship="description"
              withArrow
            >
              <Switch
                checked={minify}
                onChange={(_, data) => setMinify(Boolean(data.checked))}
                label="压缩输出"
              />
            </Tooltip>

            <Tooltip
              content="按标题生成嵌套的目录（<nav> + <ul>）；每个标题都会带一个 id 锚点，重复标题会自动编号。"
              relationship="description"
              withArrow
            >
              <Switch
                checked={toc}
                onChange={(_, data) => setToc(Boolean(data.checked))}
                label="生成目录"
              />
            </Tooltip>

            <Dropdown
              className={styles.select}
              value={TOC_DEPTH_LABELS[tocDepth]}
              selectedOptions={[tocDepth]}
              onOptionSelect={(_, data) => setTocDepth(data.optionValue ?? '3')}
              disabled={!toc}
              aria-label="目录深度"
            >
              {Object.keys(TOC_DEPTH_LABELS).map((value) => (
                <Option key={value} value={value} text={TOC_DEPTH_LABELS[value]}>
                  {TOC_DEPTH_LABELS[value]}
                </Option>
              ))}
            </Dropdown>

            <Tooltip
              content="CommonMark 默认把单个换行当空格；打开后单个换行变成 <br>，适合从聊天记录里粘过来的文本。"
              relationship="description"
              withArrow
            >
              <Switch
                checked={breaks}
                onChange={(_, data) => setBreaks(Boolean(data.checked))}
                label="单换行转 <br>"
              />
            </Tooltip>

            <Tooltip
              content="危险开关：打开后源码里的 HTML 会原样写进输出，<script> 也会。只在你完全信任这段 Markdown 时才打开。"
              relationship="description"
              withArrow
            >
              <Switch
                checked={allowHtml}
                onChange={(_, data) => setAllowHtml(Boolean(data.checked))}
                label="允许内联 HTML（有风险）"
                style={allowHtml ? { color: tokens.colorPaletteRedForeground1 } : undefined}
              />
            </Tooltip>

            {document && (
              <>
                <input
                  className={`wt-inline-input ${styles.titleInput}`}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="文档标题（默认取第一个一级标题）"
                  aria-label="文档标题"
                  spellCheck={false}
                />
                <input
                  className="wt-inline-input"
                  style={{ maxWidth: 110 }}
                  value={lang}
                  onChange={(event) => setLang(event.target.value)}
                  placeholder="zh-CN"
                  aria-label="文档语言"
                  spellCheck={false}
                />
              </>
            )}
          </div>

          {allowHtml && (
            <MessageBar intent="error">
              <MessageBarBody>
                「允许内联 HTML」已开启：原始 HTML 会原样输出，本工具不再提供任何 XSS 防护。
              </MessageBarBody>
            </MessageBar>
          )}

          <div className="wt-split">
            <section className="wt-surface" aria-label="Markdown 输入">
              <div className="wt-surface__header">
                <DocumentTextRegular />
                <Text as="h2" size={300} weight="semibold">
                  Markdown
                </Text>
                <span className={styles.spacer} />
                <Button
                  appearance="subtle"
                  size="small"
                  onClick={() => {
                    setInput(SAMPLE_MARKDOWN);
                    setCopied(false);
                  }}
                >
                  填入示例
                </Button>
                <Tooltip content="填入一段含 XSS 反例的样例，用来看防护效果" relationship="label" withArrow>
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<BeakerRegular />}
                    onClick={() => {
                      setInput(XSS_SAMPLE);
                      setCopied(false);
                    }}
                    aria-label="填入注入测试样例"
                  />
                </Tooltip>
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
              <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                <textarea
                  className="wt-code-area"
                  value={input}
                  onChange={(event) => {
                    setInput(event.target.value);
                    setCopied(false);
                  }}
                  placeholder={'在此粘贴 Markdown，例如：\n# 标题\n\n正文 **粗体** 与 `代码`。'}
                  aria-label="待转换的 Markdown"
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                />
              </div>
            </section>

            <section className="wt-surface" aria-label="HTML 输出">
              <div className="wt-surface__header">
                <CodeBlockRegular />
                <Text as="h2" size={300} weight="semibold">
                  HTML 源码
                </Text>
                <span className={styles.spacer} />
                {result.html !== '' && (
                  <>
                    <Badge appearance="tint" color="brand" size="small">
                      {document ? '完整文档' : '片段'} · {result.html.length} 字符
                    </Badge>
                    <Tooltip content="复制 HTML" relationship="label" withArrow>
                      <Button
                        appearance="subtle"
                        icon={copied ? <CheckmarkRegular /> : <CopyRegular />}
                        onClick={handleCopy}
                        aria-label="复制 HTML"
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
                        <MessageBarTitle>Markdown 解析失败</MessageBarTitle>
                        {result.error}
                      </MessageBarBody>
                    </MessageBar>
                  </div>
                ) : result.html === '' ? (
                  <div className="wt-empty">
                    <CodeBlockRegular />
                    <Text weight="semibold">等待输入</Text>
                    <Caption1>输入 Markdown 后立即得到对应的 HTML 源码</Caption1>
                  </div>
                ) : (
                  <>
                    {result.warnings.length > 0 && (
                      <div style={{ padding: '12px 14px 0' }}>
                        <MessageBar intent="warning" layout="multiline">
                          <MessageBarBody>
                            <MessageBarTitle>转换过程中的处理与拦截</MessageBarTitle>
                            <div className={styles.warnings}>
                              {result.warnings.map((warning) => (
                                <div key={warning} className={styles.note}>
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
                      value={result.html}
                      readOnly
                      aria-label="HTML 源码结果"
                      spellCheck={false}
                    />
                  </>
                )}
              </div>
            </section>
          </div>

          <Caption1 className={styles.hint}>
            明确不做：不做实时预览（已有「Markdown 预览」）、不做 Markdown 编辑器、不做语法高亮、
            不抓取远程图片、不生成 PDF 或富文本。标题锚点用与「Markdown 预览」相同的规则生成，
            因此同一篇文档在两个工具里的锚点一致。
            {result.headings.length > 0 ? ` 本文档共识别出 ${result.headings.length} 个标题。` : ''}
          </Caption1>
        </div>
      </div>
    </div>
  );
}
