import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  useToastController,
  Toast,
  ToastTitle,
  Toaster,
  useId,
} from '@fluentui/react-components';
import {
  ArrowDownload16Regular,
  ArrowSync16Regular,
  Broom16Regular,
  Checkmark16Regular,
  ClipboardPaste16Regular,
  Copy16Regular,
  DocumentText16Regular,
  SubtractCircle16Regular,
  Wand16Regular,
} from '@fluentui/react-icons';
import { JsonTree, type JsonValue } from './JsonTree';
import {
  collectStats,
  copyText,
  describeKind,
  formatBytes,
  parseJson,
  type JsonIssue,
} from './jsonUtils';

const INDENT_OPTIONS = [2, 4] as const;

const SAMPLE_JSON = `{
  "name": "wheat-tools",
  "version": "0.1.0",
  "private": true,
  "toolbox": {
    "framework": "React + Vite",
    "design": "Fluent 2",
    "tools": [
      { "id": "json-formatter", "name": "JSON 格式化", "ready": true },
      { "id": "uuid-generator", "name": "UUID 生成器", "ready": true }
    ]
  },
  "metrics": { "stars": 128, "downloads": 20480, "rating": 4.9 },
  "deprecated": false,
  "maintainers": ["wheet"],
  "notes": null
}`;

const useStyles = makeStyles({
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
  },
  toolbarSpacer: {
    flex: '1 1 auto',
  },
  panelTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minWidth: 0,
  },
  panelActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
  },
  indent: {
    minWidth: '132px',
  },
  errorBar: {
    borderRadius: '8px',
  },
  errorDetail: {
    fontFamily: "'Cascadia Code', Consolas, monospace",
    fontSize: '12px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: tokens.colorNeutralForeground3,
  },
  placeholder: {
    gap: '6px',
  },
});

type Status =
  | { state: 'idle' }
  | { state: 'ok'; value: JsonValue; issue?: undefined }
  | { state: 'error'; issue: JsonIssue };

export function JsonFormatterTool() {
  const styles = useStyles();
  const toasterId = useId('json-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [input, setInput] = useState('');
  const [indent, setIndent] = useState<number>(2);
  const [autoFormat, setAutoFormat] = useState(true);
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const [expandedDepth, setExpandedDepth] = useState(3);
  const [copied, setCopied] = useState(false);

  // Tracks which input snapshot the tree was built from, so typing while
  // auto-format is off does not silently mutate the output panel.
  const lastFormatted = useRef('');

  const applyFormat = useCallback(
    (text: string) => {
      lastFormatted.current = text;
      if (!text.trim()) {
        setStatus({ state: 'idle' });
        return;
      }
      const result = parseJson(text);
      setStatus(
        result.ok
          ? { state: 'ok', value: result.value }
          : { state: 'error', issue: result.issue },
      );
      setExpandedDepth(3);
    },
    [],
  );

  // Debounced auto-format: parsing is cheap, but re-rendering a large tree on
  // every keystroke is not.
  useEffect(() => {
    if (!autoFormat) return undefined;
    if (input === lastFormatted.current) return undefined;

    const timer = window.setTimeout(() => applyFormat(input), 300);
    return () => window.clearTimeout(timer);
  }, [input, autoFormat, applyFormat]);

  const formatted = useMemo(() => {
    if (status.state !== 'ok') return '';
    return JSON.stringify(status.value, null, indent) ?? '';
  }, [status, indent]);

  const stats = useMemo(
    () => (status.state === 'ok' ? collectStats(status.value, indent) : null),
    [status, indent],
  );

  const notify = useCallback(
    (title: string, intent: 'success' | 'error' = 'success') => {
      dispatchToast(
        <Toast>
          <ToastTitle>{title}</ToastTitle>
        </Toast>,
        { intent, timeout: 1600 },
      );
    },
    [dispatchToast],
  );

  const handleCopyOutput = useCallback(async () => {
    if (!formatted) return;
    const ok = await copyText(formatted);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
      notify('已复制格式化结果');
    } else {
      notify('复制失败，请手动选择文本', 'error');
    }
  }, [formatted, notify]);

  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setInput(text);
      applyFormat(text);
      notify('已从剪贴板粘贴');
    } catch {
      notify('浏览器拒绝了剪贴板读取，请手动粘贴', 'error');
    }
  }, [applyFormat, notify]);

  const handleMinify = useCallback(() => {
    const source = input.trim();
    if (!source) return;
    const result = parseJson(source);
    if (!result.ok) {
      setStatus({ state: 'error', issue: result.issue });
      return;
    }
    const compact = JSON.stringify(result.value);
    setInput(compact);
    applyFormat(compact);
    notify('已压缩为单行');
  }, [input, applyFormat, notify]);

  const handleDownload = useCallback(() => {
    if (!formatted) return;
    const blob = new Blob([formatted], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'formatted.json';
    link.click();
    URL.revokeObjectURL(url);
  }, [formatted]);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.toolbar}>
        <Dropdown
          className={styles.indent}
          value={indent === 2 ? '2 空格' : '4 空格'}
          selectedOptions={[String(indent)]}
          onOptionSelect={(_, data) =>
            setIndent(Number(data.optionValue ?? 2))
          }
          aria-label="缩进方式"
        >
          {INDENT_OPTIONS.map((option) => (
            <Option key={option} value={String(option)} text={`${option} 空格`}>
              {option} 空格
            </Option>
          ))}
        </Dropdown>

        <Switch
          checked={autoFormat}
          onChange={(_, data) => setAutoFormat(data.checked)}
          label="自动格式化"
        />

        <Tooltip
          content="展开层级数，数字越大默认展开越深"
          relationship="description"
          withArrow
        >
          <Dropdown
            className={styles.indent}
            value={`默认展开 ${expandedDepth} 层`}
            selectedOptions={[String(expandedDepth)]}
            onOptionSelect={(_, data) =>
              setExpandedDepth(Number(data.optionValue ?? 3))
            }
            aria-label="默认展开层级"
          >
            {[1, 2, 3, 5, 8].map((level) => (
              <Option
                key={level}
                value={String(level)}
                text={`默认展开 ${level} 层`}
              >
                默认展开 {level} 层
              </Option>
            ))}
          </Dropdown>
        </Tooltip>

        <span className={styles.toolbarSpacer} />

        <Button
          appearance="secondary"
          icon={<Wand16Regular />}
          onClick={() => {
            setInput(SAMPLE_JSON);
            applyFormat(SAMPLE_JSON);
          }}
        >
          示例
        </Button>

        <Button
          appearance="secondary"
          icon={<ClipboardPaste16Regular />}
          onClick={handlePasteFromClipboard}
        >
          粘贴
        </Button>

        <Button
          appearance="secondary"
          icon={<SubtractCircle16Regular />}
          onClick={handleMinify}
          disabled={!input.trim()}
        >
          压缩
        </Button>

        <Button
          appearance="primary"
          icon={<ArrowSync16Regular />}
          onClick={() => applyFormat(input)}
          disabled={!input.trim()}
        >
          格式化
        </Button>
      </div>

      {status.state === 'error' && (
        <MessageBar
          className={styles.errorBar}
          intent="error"
          layout="multiline"
        >
          <MessageBarBody>
            <MessageBarTitle>
              JSON 解析失败
              {status.issue.line !== undefined &&
                `（第 ${status.issue.line} 行${
                  status.issue.column !== undefined
                    ? `, 第 ${status.issue.column} 列`
                    : ''
                }）`}
            </MessageBarTitle>
            <div className={styles.errorDetail}>
              {status.issue.message}
              {status.issue.snippet ? `\n${status.issue.snippet.trim()}` : ''}
            </div>
          </MessageBarBody>
        </MessageBar>
      )}

      <div className="wt-split">
        {/* -------- Input -------- */}
        <section className="wt-surface" aria-label="JSON 输入">
          <div className="wt-surface__header">
            <div className={styles.panelTitle}>
              <DocumentText16Regular />
              <Text size={300} weight="semibold">
                输入
              </Text>
              {input.trim() && (
                <Caption1>{formatBytes(new Blob([input]).size)}</Caption1>
              )}
            </div>
            <span className={styles.toolbarSpacer} />
            <div className={styles.panelActions}>
              <Tooltip content="清空输入" relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  icon={<Broom16Regular />}
                  onClick={() => {
                    setInput('');
                    lastFormatted.current = '';
                    setStatus({ state: 'idle' });
                  }}
                  disabled={!input}
                  aria-label="清空输入"
                />
              </Tooltip>
            </div>
          </div>
          <div className="wt-surface__body">
            <textarea
              className="wt-code-area"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault();
                  applyFormat(input);
                }
              }}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              aria-label="JSON 输入框"
              placeholder={'在此粘贴 JSON，例如：\n{\n  "hello": "world"\n}\n\n提示：Ctrl / Cmd + Enter 立即格式化'}
            />
          </div>
        </section>

        {/* -------- Output -------- */}
        <section className="wt-surface" aria-label="格式化结果">
          <div className="wt-surface__header">
            <div className={styles.panelTitle}>
              <Wand16Regular />
              <Text size={300} weight="semibold">
                格式化结果
              </Text>
              {stats && (
                <>
                  <Badge appearance="tint" color="brand" size="small">
                    {describeKind(stats.kind)}
                  </Badge>
                  <Caption1>
                    {stats.nodes} 个值 · {stats.keys} 个键 · 深度 {stats.depth}
                  </Caption1>
                </>
              )}
            </div>
            <span className={styles.toolbarSpacer} />
            <div className={styles.panelActions}>
              <Tooltip content="下载为 .json" relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  icon={<ArrowDownload16Regular />}
                  onClick={handleDownload}
                  disabled={!formatted}
                  aria-label="下载为 json 文件"
                />
              </Tooltip>
              <Tooltip
                content={copied ? '已复制' : '复制格式化结果'}
                relationship="label"
                withArrow
              >
                <Button
                  appearance="subtle"
                  icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
                  onClick={handleCopyOutput}
                  disabled={!formatted}
                  aria-label="复制格式化结果"
                />
              </Tooltip>
            </div>
          </div>
          <div className="wt-surface__body">
            {status.state === 'ok' ? (
              <div className="wt-code-scroll">
                <JsonTree
                  value={status.value}
                  defaultExpandDepth={expandedDepth}
                />
              </div>
            ) : (
              <div className={`wt-empty ${styles.placeholder}`}>
                <Wand16Regular />
                <Text weight="semibold">
                  {status.state === 'error' ? '等待有效的 JSON' : '尚无内容'}
                </Text>
                <Caption1>
                  在左侧粘贴 JSON 后，这里会显示可展开收起的结构化结果。
                </Caption1>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
