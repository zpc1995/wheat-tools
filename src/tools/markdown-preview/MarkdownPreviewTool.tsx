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
  Broom16Regular,
  Checkmark16Regular,
  Copy16Regular,
  DocumentText16Regular,
  Shield16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  SAMPLE_MARKDOWN,
  XSS_SAMPLE,
  parseMarkdown,
  renderMarkdown,
} from './markdownUtils';

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
  preview: {
    padding: '18px 20px',
    minHeight: '360px',
    maxHeight: '640px',
    overflow: 'auto',
    width: '100%',
  },
  toc: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    width: '100%',
    maxHeight: '260px',
    overflowY: 'auto',
    padding: '10px 8px',
  },
  tocItem: {
    display: 'block',
    width: '100%',
    padding: '4px 8px',
    border: 'none',
    borderRadius: '4px',
    background: 'transparent',
    color: tokens.colorNeutralForeground2,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '13px',
    textAlign: 'left',
    ':hover': {
      backgroundColor: tokens.colorSubtleBackgroundHover,
      color: tokens.colorNeutralForeground1,
    },
  },
});

export function MarkdownPreviewTool() {
  const styles = useStyles();
  const toasterId = useId('md-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [source, setSource] = useState(SAMPLE_MARKDOWN);
  const [showToc, setShowToc] = useState(true);
  const [copied, setCopied] = useState(false);

  const notify = useCallback(
    (message: string) => {
      dispatchToast(
        <Toast>
          <ToastTitle>{message}</ToastTitle>
        </Toast>,
        { timeout: 1600 },
      );
    },
    [dispatchToast],
  );

  // Parsing is debounced so a large document does not re-render on every key.
  const parsed = useMemo(() => parseMarkdown(source), [source]);
  const rendered = useMemo(() => renderMarkdown(parsed), [parsed]);

  const stats = useMemo(() => {
    const words = source.trim() ? source.trim().split(/\s+/).length : 0;
    return {
      chars: source.length,
      words,
      headings: parsed.headings.length,
      blocks: parsed.tokens.filter((token) => token.type !== 'space').length,
    };
  }, [source, parsed]);

  const copyPlain = useCallback(async () => {
    const ok = await copyText(source);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
      notify('已复制 Markdown 源码');
    } else {
      notify('复制失败');
    }
  }, [source, notify]);

  /** Scrolls the preview to a heading, using the anchor id. */
  const jumpTo = useCallback((id: string) => {
    const target = document.getElementById(id);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <Button
            appearance="secondary"
            onClick={() => setSource(SAMPLE_MARKDOWN)}
          >
            示例文档
          </Button>
          <Tooltip
            content="载入一段含 <script>、onerror 与 javascript: 链接的文本，用来验证它们不会被执行"
            relationship="description"
            withArrow
          >
            <Button
              appearance="outline"
              icon={<Shield16Regular />}
              onClick={() => setSource(XSS_SAMPLE)}
            >
              HTML 注入测试
            </Button>
          </Tooltip>
          <Switch
            checked={showToc}
            onChange={(_, data) => setShowToc(data.checked)}
            label="显示目录"
          />
          <span className={styles.spacer} />
          <Caption1 className={styles.hint}>
            {stats.blocks} 个块 · {stats.headings} 个标题 · {stats.words} 词 ·{' '}
            {stats.chars} 字符
          </Caption1>
          <Tooltip content="复制 Markdown 源码" relationship="label" withArrow>
            <Button
              appearance="subtle"
              icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
              onClick={copyPlain}
              aria-label="复制 Markdown 源码"
            />
          </Tooltip>
          <Tooltip content="清空" relationship="label" withArrow>
            <Button
              appearance="subtle"
              icon={<Broom16Regular />}
              onClick={() => setSource('')}
              disabled={!source}
              aria-label="清空"
            />
          </Tooltip>
        </div>

        {/* Stated plainly because "it renders my HTML" is the assumption people
            arrive with, and here it deliberately does not. */}
        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>安全渲染方式</MessageBarTitle>
            预览不是把 Markdown 转成 HTML 字符串再插入页面，而是解析成
            token 后逐节点渲染为 React 元素，因此所有文本都经过 React 转义。
            <code>&lt;script&gt;</code>、事件属性（如 onerror）与{' '}
            <code>javascript:</code> 链接都不会执行——前者按原样显示，
            后者会被阻止并标注原因。可以用上方「HTML 注入测试」自行验证。
          </MessageBarBody>
        </MessageBar>

        {parsed.error && (
          <MessageBar intent="error">
            <MessageBarBody>
              <MessageBarTitle>解析失败</MessageBarTitle>
              {parsed.error}
            </MessageBarBody>
          </MessageBar>
        )}

        <div className="wt-split">
          <section className="wt-surface" aria-label="Markdown 源码">
            <div className="wt-surface__header">
              <DocumentText16Regular />
              <Text as="h2" size={300} weight="semibold">
                Markdown 源码
              </Text>
              <span className={styles.spacer} />
              <Badge appearance="tint" color="brand" size="small">
                GFM
              </Badge>
            </div>
            <div className="wt-surface__body">
              <textarea
                className="wt-code-area"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="在此输入 Markdown…"
                aria-label="Markdown 源码"
                spellCheck={false}
              />
            </div>
          </section>

          <section className="wt-surface" aria-label="预览">
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                预览
              </Text>
              <span className={styles.spacer} />
              <Caption1 className={styles.hint}>实时渲染</Caption1>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={`${styles.preview} wt-md`}>{rendered}</div>
            </div>
          </section>
        </div>

        {showToc && parsed.headings.length > 0 && (
          <section className="wt-surface" aria-label="目录">
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                目录
              </Text>
              <span className={styles.spacer} />
              <Caption1 className={styles.hint}>
                {parsed.headings.length} 个标题
              </Caption1>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.toc}>
                {parsed.headings.map((heading) => (
                  <button
                    key={heading.id}
                    type="button"
                    className={styles.tocItem}
                    style={{ paddingLeft: 8 + (heading.depth - 1) * 14 }}
                    onClick={() => jumpTo(heading.id)}
                  >
                    {'#'.repeat(heading.depth)} {heading.text}
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        <Divider />
      </div>
    </>
  );
}
