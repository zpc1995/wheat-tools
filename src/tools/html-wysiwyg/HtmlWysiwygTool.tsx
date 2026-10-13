import {
  Button,
  Caption1,
  Checkbox,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowCounterclockwiseRegular,
  CodeRegular,
  CopyRegular,
  LinkRegular,
  ListRegular,
  TextBoldRegular,
  TextClearFormattingRegular,
  TextHeader1Regular,
  TextHeader2Regular,
  TextHeader3Regular,
  TextItalicRegular,
  TextNumberListLtrRegular,
  TextQuoteRegular,
  TextStrikethroughRegular,
  TextUnderlineRegular,
} from '@fluentui/react-icons';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent, DragEvent, ReactElement } from 'react';
import {
  describeReport,
  escapeAll,
  escapeAttributeValue,
  isSafeUrl,
  plainTextToHtml,
  sanitizeHtmlDetailed,
  stripInlineStyles,
} from './htmlSanitizerUtils';

const useStyles = makeStyles({
  column: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    minWidth: 0,
    gap: '10px',
    padding: '12px 14px 4px',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '4px',
    width: '100%',
  },
  optionRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '16px',
    width: '100%',
  },
  linkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    maxWidth: '560px',
  },
  pane: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minWidth: 0,
    minHeight: 0,
  },
  paneHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    minHeight: '28px',
  },
  editor: {
    minHeight: '320px',
    maxHeight: '520px',
    overflowY: 'auto',
    padding: '12px 14px',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: '6px',
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    lineHeight: 1.7,
    outline: 'none',
    // The outline is replaced rather than removed so keyboard focus stays
    // visible on a control that the accessibility audit tab-walks to.
    ':focus-visible': {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: '-2px',
    },
  },
  notes: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    width: '100%',
    paddingBottom: '4px',
  },
  muted: {
    color: tokens.colorNeutralForeground3,
  },
});

/** A toolbar button: one formatting command, with a tooltip naming it. */
function FormatButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactElement;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label} relationship="label" withArrow>
      <Button appearance="subtle" size="small" icon={icon} onClick={onClick} aria-label={label} />
    </Tooltip>
  );
}

export function HtmlWysiwygTool() {
  const styles = useStyles();
  const editorRef = useRef<HTMLDivElement>(null);

  const [editorHtml, setEditorHtml] = useState('');
  const [includeInlineStyles, setIncludeInlineStyles] = useState(true);
  const [keepPastedStyles, setKeepPastedStyles] = useState(false);
  const [plainTextOnly, setPlainTextOnly] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [pasteReport, setPasteReport] = useState<string | null>(null);
  const [commandWarning, setCommandWarning] = useState(false);
  const [copied, setCopied] = useState(false);

  const sourceHtml = useMemo(
    () => (includeInlineStyles ? editorHtml : stripInlineStyles(editorHtml)),
    [editorHtml, includeInlineStyles],
  );

  const syncEditor = useCallback(() => {
    const node = editorRef.current;
    if (node) setEditorHtml(node.innerHTML);
  }, []);

  /**
   * Runs a formatting command.
   *
   * `document.execCommand` is formally deprecated — it is not on a standards
   * track, and browsers keep it only for backwards compatibility. It is used
   * here anyway, and that is a deliberate trade rather than an oversight:
   *
   *   - The alternative is hand-rolling selection handling with `Range` and
   *     `Selection`, plus per-browser normalisation of how bold, lists and
   *     block formats are applied. That is a large amount of code whose bugs
   *     are exactly the ones users notice, and it would need its own test
   *     suite against real browsers.
   *   - What is *not* delegated to execCommand is the security-relevant part.
   *     Pasting is intercepted and sanitised by our own code, because
   *     execCommand's own paste path is precisely the injection vector.
   *
   * So the deprecated API does cosmetic work and our code does the part that
   * matters. If a browser ever drops execCommand the toolbar stops working
   * (hence the warning below when it reports failure) while pasted content
   * stays sanitised.
   */
  const runCommand = useCallback(
    (command: string, value?: string) => {
      let ok = false;
      try {
        ok = document.execCommand(command, false, value);
      } catch {
        ok = false;
      }
      if (!ok) setCommandWarning(true);
      syncEditor();
    },
    [syncEditor],
  );

  /** Inserts literal text, falling back to escaped HTML when needed. */
  const insertPlainText = useCallback(
    (text: string) => {
      if (text === '') return;
      let ok = false;
      try {
        ok = document.execCommand('insertText', false, text);
      } catch {
        ok = false;
      }
      if (!ok) {
        // The fallback is escaped, so newlines survive as <br> without any of
        // the text being interpreted as markup.
        document.execCommand('insertHTML', false, plainTextToHtml(text));
      } else {
        setCommandWarning(false);
      }
      syncEditor();
    },
    [syncEditor],
  );

  /**
   * Sanitises a paste before it reaches the document.
   *
   * This is the reason this tool exists rather than a bare contentEditable box.
   * `preventDefault` is essential: without it the browser inserts the clipboard
   * markup itself, and cleaning up afterwards would already have executed any
   * event handler the clipboard carried.
   */
  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const data = event.clipboardData;
      if (!data) return;
      event.preventDefault();

      if (plainTextOnly) {
        insertPlainText(data.getData('text/plain'));
        setPasteReport('按纯文本粘贴：已忽略剪贴板中的 HTML');
        return;
      }

      const html = data.getData('text/html');
      if (html === '') {
        insertPlainText(data.getData('text/plain'));
        setPasteReport('剪贴板只有纯文本');
        return;
      }

      const result = sanitizeHtmlDetailed(html, { keepInlineStyles: keepPastedStyles });
      document.execCommand('insertHTML', false, result.html);
      syncEditor();

      const summary = describeReport(result.report);
      setPasteReport(
        summary === null
          ? `粘贴内容已清理，未发现需要移除的内容（${result.html.length} 字符）`
          : `粘贴内容已清理 —— ${summary}`,
      );
    },
    [insertPlainText, keepPastedStyles, plainTextOnly, syncEditor],
  );

  /**
   * Handles dropped content the same way as a paste.
   *
   * A drag-and-drop carries the same markup a paste does, so leaving it to the
   * browser would reopen the hole that `handlePaste` closes.
   */
  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const data = event.dataTransfer;
      if (!data) return;
      event.preventDefault();

      const html = data.getData('text/html');
      const text = data.getData('text/plain');
      if (!plainTextOnly && html !== '') {
        const result = sanitizeHtmlDetailed(html, { keepInlineStyles: keepPastedStyles });
        document.execCommand('insertHTML', false, result.html);
        const summary = describeReport(result.report);
        setPasteReport(summary === null ? '拖入内容已清理' : `拖入内容已清理 —— ${summary}`);
      } else {
        insertPlainText(text);
        setPasteReport('拖入内容按纯文本插入');
      }
      syncEditor();
    },
    [insertPlainText, keepPastedStyles, plainTextOnly, syncEditor],
  );

  const applyLink = useCallback(() => {
    const url = linkUrl.trim();
    if (url === '') return;

    // The same check the sanitiser uses. A link typed into the toolbar is not
    // trustier than a pasted one: `javascript:` here would be just as live.
    if (!isSafeUrl(url)) {
      setLinkError('只接受 http、https、mailto、tel 或站内相对地址；该地址的协议被拒绝。');
      return;
    }

    setLinkError(null);
    const selection = window.getSelection();
    if (selection !== null && selection.toString().length > 0) {
      runCommand('createLink', url);
    } else {
      const safeHref = escapeAttributeValue(url);
      runCommand('insertHTML', `<a href="${safeHref}">${escapeAll(url)}</a>`);
    }
  }, [linkUrl, runCommand]);

  const copySource = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(sourceHtml);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; the button stays unflipped rather than
      // claiming a copy that did not happen.
      setCopied(false);
    }
  }, [sourceHtml]);

  const clearEditor = useCallback(() => {
    if (editorRef.current) editorRef.current.innerHTML = '';
    setEditorHtml('');
    setPasteReport(null);
    setCommandWarning(false);
  }, []);

  return (
    <div className="wt-surface">
      <div className={styles.column}>
        <div className={styles.toolbar} role="toolbar" aria-label="文本格式工具栏">
          <FormatButton label="粗体" icon={<TextBoldRegular />} onClick={() => runCommand('bold')} />
          <FormatButton label="斜体" icon={<TextItalicRegular />} onClick={() => runCommand('italic')} />
          <FormatButton
            label="下划线"
            icon={<TextUnderlineRegular />}
            onClick={() => runCommand('underline')}
          />
          <FormatButton
            label="删除线"
            icon={<TextStrikethroughRegular />}
            onClick={() => runCommand('strikeThrough')}
          />
          <Divider vertical style={{ height: 22, margin: '0 4px' }} />
          <FormatButton
            label="一级标题"
            icon={<TextHeader1Regular />}
            onClick={() => runCommand('formatBlock', 'h1')}
          />
          <FormatButton
            label="二级标题"
            icon={<TextHeader2Regular />}
            onClick={() => runCommand('formatBlock', 'h2')}
          />
          <FormatButton
            label="三级标题"
            icon={<TextHeader3Regular />}
            onClick={() => runCommand('formatBlock', 'h3')}
          />
          <Button appearance="subtle" size="small" onClick={() => runCommand('formatBlock', 'p')}>
            正文
          </Button>
          <Divider vertical style={{ height: 22, margin: '0 4px' }} />
          <FormatButton
            label="无序列表"
            icon={<ListRegular />}
            onClick={() => runCommand('insertUnorderedList')}
          />
          <FormatButton
            label="有序列表"
            icon={<TextNumberListLtrRegular />}
            onClick={() => runCommand('insertOrderedList')}
          />
          <FormatButton
            label="引用"
            icon={<TextQuoteRegular />}
            onClick={() => runCommand('formatBlock', 'blockquote')}
          />
          <FormatButton
            label="代码块"
            icon={<CodeRegular />}
            onClick={() => runCommand('formatBlock', 'pre')}
          />
          <FormatButton
            label="清除格式"
            icon={<TextClearFormattingRegular />}
            onClick={() => runCommand('removeFormat')}
          />
          <Divider vertical style={{ height: 22, margin: '0 4px' }} />
          <Button
            appearance="subtle"
            size="small"
            icon={<ArrowCounterclockwiseRegular />}
            onClick={clearEditor}
          >
            清空
          </Button>
        </div>

        <div className={styles.linkRow}>
          <input
            className="wt-inline-input"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            placeholder="https://example.com"
            aria-label="链接地址"
            spellCheck={false}
            autoComplete="off"
            onKeyDown={(event) => {
              if (event.key === 'Enter') applyLink();
            }}
          />
          <Button icon={<LinkRegular />} onClick={applyLink}>
            加链接
          </Button>
        </div>

        {linkError !== null && (
          <MessageBar intent="error">
            <MessageBarBody>{linkError}</MessageBarBody>
          </MessageBar>
        )}

        <div className={styles.optionRow}>
          <Checkbox
            checked={keepPastedStyles}
            onChange={(_, data) => setKeepPastedStyles(data.checked === true)}
            label="粘贴时保留样式（仍会过滤 CSS）"
          />
          <Checkbox
            checked={plainTextOnly}
            onChange={(_, data) => setPlainTextOnly(data.checked === true)}
            label="粘贴为纯文本"
          />
          <Checkbox
            checked={includeInlineStyles}
            onChange={(_, data) => setIncludeInlineStyles(data.checked === true)}
            label="输出包含内联样式"
          />
        </div>

        {pasteReport !== null && (
          <MessageBar intent="warning">
            <MessageBarBody>{pasteReport}</MessageBarBody>
          </MessageBar>
        )}

        {commandWarning && (
          <MessageBar intent="warning">
            <MessageBarTitle>浏览器未执行该格式命令</MessageBarTitle>
            <MessageBarBody>
              工具栏依赖已废弃的 document.execCommand，此浏览器可能已移除它。编辑与粘贴清理不受影响，
              可以继续输入文本，或改用浏览器的快捷键（如 Ctrl+B）。
            </MessageBarBody>
          </MessageBar>
        )}
      </div>

      <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
        <div className="wt-split" style={{ padding: '0 14px 14px' }}>
          <div className={styles.pane}>
            <div className={styles.paneHeader}>
              <Text as="h2" size={300} weight="semibold">
                富文本编辑区
              </Text>
              <Caption1 className={styles.muted}>
                {editorHtml.length > 0 ? `${editorHtml.length} 字符` : '可直接输入'}
              </Caption1>
            </div>
            <div
              ref={editorRef}
              className={styles.editor}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label="富文本编辑区"
              onInput={syncEditor}
              onPaste={handlePaste}
              onDrop={handleDrop}
            />
            <Caption1 className={styles.muted}>
              粘贴与拖入都会被强制清理：script、on* 事件属性、javascript: 协议一律移除。
            </Caption1>
          </div>

          <div className={styles.pane}>
            <div className={styles.paneHeader}>
              <Text as="h2" size={300} weight="semibold">
                HTML 源码
              </Text>
              <Button
                appearance="subtle"
                size="small"
                icon={<CopyRegular />}
                onClick={copySource}
                disabled={sourceHtml === ''}
              >
                {copied ? '已复制' : '复制'}
              </Button>
            </div>
            <textarea
              className="wt-code-area"
              readOnly
              value={sourceHtml}
              aria-label="生成的 HTML 源码"
              spellCheck={false}
            />
          </div>
        </div>

        <div className={styles.notes}>
          <Text as="h2" size={300} weight="semibold">
            关于取舍与边界
          </Text>
          <Caption1 className={styles.muted}>
            工具栏基于已废弃的 document.execCommand。它不在标准轨道上，浏览器仅为兼容而保留；自己实现
            选区与格式处理可以摆脱它，但需要为每个浏览器的 Range 行为写并维护大量代码。因此这里把它
            限制在“改格式”这一件事上，而安全相关的粘贴路径完全由本工具的清理器处理，不经过它的粘贴逻辑。
          </Caption1>
          <Caption1 className={styles.muted}>
            明确的边界：没有协作编辑、没有撤销栈管理（依赖浏览器自身的撤销）、没有图片上传，也不做
            完整的 HTML 文档或下载。清理器是面向粘贴内容的允许列表，不是通用浏览器级净化库。
          </Caption1>
        </div>
      </div>
    </div>
  );
}
