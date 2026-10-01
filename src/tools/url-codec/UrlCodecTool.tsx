import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Checkbox,
  Divider,
  Dropdown,
  MessageBar,
  MessageBarBody,
  Option,
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
  ArrowSwap16Regular,
  Checkmark16Regular,
  Copy16Regular,
  Link16Regular,
  Table16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  buildQuery,
  decodeForm,
  decodeText,
  encodeText,
  parseQuery,
  parseUrl,
  type EncodeMode,
} from './urlUtils';

type Mode = 'encode' | 'decode';

const MODES: Array<{ value: EncodeMode; label: string; note: string }> = [
  {
    value: 'component',
    label: '组件（encodeURIComponent）',
    note: '转义所有保留字符，空格 → %20。适合单个查询参数值',
  },
  {
    value: 'uri',
    label: '整条 URL（encodeURI）',
    note: '保留 / ? # & = 等分隔符，适合整条链接',
  },
  {
    value: 'form',
    label: '表单（application/x-www-form-urlencoded）',
    note: '空格 → +，其余同组件编码',
  },
];

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
  rows: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  rowLabel: {
    flex: 'none',
    width: '150px',
    color: tokens.colorNeutralForeground3,
  },
  rowValue: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  paramKey: {
    flex: 'none',
    width: '180px',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
    overflowWrap: 'anywhere',
    userSelect: 'all',
    color: tokens.colorPaletteMarigoldForeground2,
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
  },
});

export function UrlCodecTool() {
  const styles = useStyles();
  const toasterId = useId('url-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [mode, setMode] = useState<Mode>('encode');
  const [encodeMode, setEncodeMode] = useState<EncodeMode>('component');
  const [input, setInput] = useState('');
  const [formSpaces, setFormSpaces] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const notify = useCallback(
    (message: string) => {
      dispatchToast(
        <Toast>
          <ToastTitle>{message}</ToastTitle>
        </Toast>,
        { timeout: 1400 },
      );
    },
    [dispatchToast],
  );

  const copy = useCallback(
    async (value: string, key: string) => {
      const ok = await copyText(value);
      if (ok) {
        setCopied(key);
        window.setTimeout(() => setCopied(null), 1400);
        notify('已复制');
      } else {
        notify('复制失败');
      }
    },
    [notify],
  );

  const result = useMemo(() => {
    if (!input) return { text: '', error: null as string | null };
    if (mode === 'encode') {
      return { text: encodeText(input, encodeMode), error: null };
    }
    const decoded = formSpaces ? decodeForm(input) : decodeText(input);
    return decoded.ok
      ? { text: decoded.text, error: null }
      : { text: '', error: decoded.error };
  }, [input, mode, encodeMode, formSpaces]);

  /** Query-string breakdown, shown when the input looks like one. */
  const queryPairs = useMemo(() => {
    if (!input) return [];
    const trimmed = input.trim();
    const looksLikeQuery =
      trimmed.startsWith('?') ||
      (!trimmed.includes('://') && trimmed.includes('='));
    return looksLikeQuery ? parseQuery(trimmed) : [];
  }, [input]);

  const urlInfo = useMemo(() => {
    if (!input.trim().includes('://')) return null;
    return parseUrl(input);
  }, [input]);

  const swap = useCallback(() => {
    // Carry the output into the input so encode/decode round-trips do not need
    // manual copy-paste.
    setInput(result.text);
    setMode((current) => (current === 'encode' ? 'decode' : 'encode'));
  }, [result.text]);

  const activeMode = MODES.find((item) => item.value === encodeMode)!;

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <Switch
            checked={mode === 'decode'}
            onChange={(_, data) => setMode(data.checked ? 'decode' : 'encode')}
            label={mode === 'encode' ? '当前：编码' : '当前：解码'}
          />
          <Button
            appearance="secondary"
            icon={<ArrowSwap16Regular />}
            onClick={swap}
            disabled={!input}
          >
            交换方向
          </Button>

          {mode === 'encode' ? (
            <Dropdown
              style={{ minWidth: 260 }}
              value={activeMode.label}
              selectedOptions={[encodeMode]}
              onOptionSelect={(_, data) =>
                setEncodeMode(data.optionValue as EncodeMode)
              }
              aria-label="编码方式"
            >
              {MODES.map((item) => (
                <Option key={item.value} value={item.value} text={item.label}>
                  {item.label}
                </Option>
              ))}
            </Dropdown>
          ) : (
            <Checkbox
              checked={formSpaces}
              onChange={(_, data) => setFormSpaces(Boolean(data.checked))}
              label="把 + 视为空格（表单编码）"
            />
          )}

          <span className={styles.spacer} />
          <Button
            appearance="subtle"
            onClick={() => setInput('')}
            disabled={!input}
          >
            清空
          </Button>
        </div>

        <div className="wt-split">
          <section className="wt-surface" aria-label="输入">
            <div className="wt-surface__header">
              <Link16Regular />
              <Text as="h2" size={300} weight="semibold">
                输入
              </Text>
              <span className={styles.spacer} />
              <Caption1 className={styles.hint}>
                {mode === 'encode' ? '要编码的文本' : '要解码的 URL 片段'}
              </Caption1>
            </div>
            <div className="wt-surface__body">
              <textarea
                className="wt-code-area"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={
                  mode === 'encode'
                    ? '例如：https://例子.com/搜索?q=麦工具 与 空格'
                    : '例如：https%3A%2F%2F%E4%BE%8B%E5%AD%90.com'
                }
                aria-label="URL 输入"
                spellCheck={false}
              />
            </div>
          </section>

          <section className="wt-surface" aria-label="输出">
            <div className="wt-surface__header">
              <Link16Regular />
              <Text as="h2" size={300} weight="semibold">
                {mode === 'encode' ? '编码结果' : '解码结果'}
              </Text>
              <span className={styles.spacer} />
              {result.text && (
                <Tooltip content="复制结果" relationship="label" withArrow>
                  <Button
                    appearance="subtle"
                    icon={
                      copied === 'out' ? (
                        <Checkmark16Regular />
                      ) : (
                        <Copy16Regular />
                      )
                    }
                    onClick={() => copy(result.text, 'out')}
                    aria-label="复制结果"
                  />
                </Tooltip>
              )}
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              {result.error ? (
                <MessageBar intent="error">
                  <MessageBarBody>{result.error}</MessageBarBody>
                </MessageBar>
              ) : result.text ? (
                <textarea
                  className="wt-code-area"
                  value={result.text}
                  readOnly
                  aria-label="URL 输出"
                  spellCheck={false}
                />
              ) : (
                <div className="wt-empty">
                  <Link16Regular />
                  <Text weight="semibold">等待输入</Text>
                  <Caption1>输入内容后即时转换，支持中文与 emoji</Caption1>
                </div>
              )}
            </div>
          </section>
        </div>

        {mode === 'encode' && (
          <MessageBar intent="info">
            <MessageBarBody>
              <Badge appearance="tint" color="brand" size="small">
                当前方式
              </Badge>{' '}
              {activeMode.note}
            </MessageBarBody>
          </MessageBar>
        )}

        {queryPairs.length > 0 && (
          <section className="wt-surface" aria-label="查询参数">
            <div className="wt-surface__header">
              <Table16Regular />
              <Text as="h2" size={300} weight="semibold">
                查询参数解析
              </Text>
              <Caption1 className={styles.hint}>
                已解码，共 {queryPairs.length} 项
              </Caption1>
              <span className={styles.spacer} />
              <Tooltip content="复制为 a=1&b=2" relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<Copy16Regular />}
                  onClick={() => copy(buildQuery(queryPairs), 'query')}
                  aria-label="复制查询字符串"
                />
              </Tooltip>
            </div>
            <div className={`wt-surface__body ${styles.rows}`}>
              {queryPairs.map((pair, index) => (
                <div key={`${pair.key}-${index}`} className={styles.row}>
                  <span className={styles.paramKey}>{pair.key || '(空键)'}</span>
                  <span className={styles.rowValue}>{pair.value || '(空值)'}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {urlInfo && (
          <section className="wt-surface" aria-label="URL 结构">
            <div className="wt-surface__header">
              <Link16Regular />
              <Text as="h2" size={300} weight="semibold">
                URL 结构
              </Text>
              <span className={styles.spacer} />
              <Caption1 className={styles.hint}>
                {urlInfo.ok ? '按标准 URL 解析' : urlInfo.error}
              </Caption1>
            </div>
            {urlInfo.ok && (
              <div className={`wt-surface__body ${styles.rows}`}>
                {[
                  ['协议', urlInfo.protocol],
                  ['主机', urlInfo.host],
                  ['主机名', urlInfo.hostname],
                  ['端口', urlInfo.port || '(默认)'],
                  ['路径', urlInfo.pathname],
                  ['查询串', urlInfo.search || '(无)'],
                  ['锚点', urlInfo.hash || '(无)'],
                  ['来源', urlInfo.origin],
                  ['用户名', urlInfo.username ?? '(无)'],
                ].map(([label, value]) => (
                  <div key={label} className={styles.row}>
                    <Text className={styles.rowLabel} size={200}>
                      {label}
                    </Text>
                    <span className={styles.rowValue}>{value}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <Divider />
      </div>
    </>
  );
}
