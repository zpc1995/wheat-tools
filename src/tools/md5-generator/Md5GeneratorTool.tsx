import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Checkbox,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
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
  ArrowUpload16Regular,
  Broom16Regular,
  Checkmark16Regular,
  Copy16Regular,
  Dismiss16Regular,
  Key16Regular,
  Shield16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  bytesToBase64,
  fileBytes,
  formatBytes,
  md5,
  md5Bytes,
  subtleHash,
  toHex,
  type HashResult,
} from './hashUtils';

/** Beyond this, hashing blocks the main thread long enough to be noticeable. */
const LARGE_FILE_BYTES = 32 * 1024 * 1024;

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
  rows: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '12px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  rowHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  digest: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
    lineHeight: 1.5,
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  muted: {
    color: tokens.colorNeutralForeground3,
  },
  matchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 14px',
    flexWrap: 'wrap',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
});

interface AlgorithmResult {
  key: 'md5' | 'sha1' | 'sha256';
  label: string;
  note: string;
  result: HashResult | null;
}

export function Md5GeneratorTool() {
  const styles = useStyles();
  const toasterId = useId('hash-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [input, setInput] = useState('');
  const [sha1, setSha1] = useState<HashResult | null>(null);
  const [sha256, setSha256] = useState<HashResult | null>(null);
  const [compare, setCompare] = useState(false);
  const [expected, setExpected] = useState('');
  const [fileDigest, setFileDigest] = useState<HashResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileWarn, setFileWarn] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // A file digest takes over the MD5 row until the text input changes.
  const md5Result = useMemo(
    () => (input && !fileDigest ? md5(input) : null),
    [input, fileDigest],
  );
  const effectiveMd5 = fileDigest ?? md5Result;

  // SHA-1 / SHA-256 are async; the flag prevents an older digest overwriting a
  // newer one while the user keeps typing.
  useEffect(() => {
    let cancelled = false;
    if (!input || fileDigest) {
      setSha1(null);
      setSha256(null);
      return undefined;
    }

    void (async () => {
      try {
        const [a, b] = await Promise.all([
          subtleHash('SHA-1', input),
          subtleHash('SHA-256', input),
        ]);
        if (!cancelled) {
          setSha1(a);
          setSha256(b);
        }
      } catch {
        if (!cancelled) {
          setSha1(null);
          setSha256(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [input, fileDigest]);

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
        notify('复制失败，请手动选择');
      }
    },
    [notify],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setFileWarn(
        file.size > LARGE_FILE_BYTES
          ? `文件 ${formatBytes(file.size)} 较大，计算期间页面可能短暂无响应。`
          : null,
      );
      setFileName(`${file.name} · ${formatBytes(file.size)}`);
      try {
        const digest = md5Bytes(await fileBytes(file));
        const hex = toHex(digest);
        setFileDigest({
          hex,
          upper: hex.toUpperCase(),
          base64: bytesToBase64(digest),
          bits: 128,
          bytes: 16,
        });
      } catch {
        notify('读取文件失败');
      }
    },
    [notify],
  );

  const clearAll = useCallback(() => {
    setInput('');
    setFileDigest(null);
    setFileName(null);
    setFileWarn(null);
    setExpected('');
    if (fileInput.current) fileInput.current.value = '';
  }, []);

  const results: AlgorithmResult[] = [
    { key: 'md5', label: 'MD5', note: '128 位 · 已不适合安全校验', result: effectiveMd5 },
    { key: 'sha1', label: 'SHA-1', note: '160 位 · 同样已不推荐用于签名', result: sha1 },
    { key: 'sha256', label: 'SHA-256', note: '256 位 · 安全场景请用这个', result: sha256 },
  ];

  const normalizedExpected = expected.trim().toLowerCase().replace(/\s+/g, '');
  const hasExpected = compare && normalizedExpected.length > 0;

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <section className="wt-surface" aria-label="哈希输入">
          <div className="wt-surface__header">
            <Key16Regular />
            <Text as="h2" size={300} weight="semibold">
              输入
            </Text>
            {input && !fileDigest && (
              <Caption1>{formatBytes(new Blob([input]).size)}</Caption1>
            )}
            <span className={styles.spacer} />
            <div className={styles.toolbar}>
              <Checkbox
                checked={compare}
                onChange={(_, data) => setCompare(Boolean(data.checked))}
                label="校验模式"
              />
              <input
                ref={fileInput}
                type="file"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
              <Tooltip content="选择文件计算 MD5" relationship="label" withArrow>
                <Button
                  appearance="secondary"
                  icon={<ArrowUpload16Regular />}
                  onClick={() => fileInput.current?.click()}
                >
                  文件哈希
                </Button>
              </Tooltip>
              <Tooltip content="清空全部" relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  icon={<Broom16Regular />}
                  onClick={clearAll}
                  disabled={!input && !fileDigest}
                  aria-label="清空全部"
                />
              </Tooltip>
            </div>
          </div>
          <div className="wt-surface__body">
            <textarea
              className="wt-code-area"
              style={{ minHeight: '150px' }}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                // Typing switches back from file mode to text mode.
                if (fileDigest) {
                  setFileDigest(null);
                  setFileName(null);
                  setFileWarn(null);
                }
              }}
              placeholder="在此输入要计算哈希的文本…"
              aria-label="哈希输入文本"
              spellCheck={false}
            />
          </div>
        </section>

        {fileName && (
          <MessageBar>
            <MessageBarBody>
              <MessageBarTitle>已计算文件 MD5</MessageBarTitle>
              {fileName}（文件模式下仅计算 MD5）
            </MessageBarBody>
          </MessageBar>
        )}

        {fileWarn && (
          <MessageBar intent="warning">
            <MessageBarBody>{fileWarn}</MessageBarBody>
          </MessageBar>
        )}

        {compare && (
          <MessageBar intent="info">
            <MessageBarBody>
              <MessageBarTitle>校验模式</MessageBarTitle>
              粘贴预期的哈希值，下方结果会逐行比对。
            </MessageBarBody>
            <MessageBarActions
              containerAction={
                <Button
                  appearance="transparent"
                  icon={<Dismiss16Regular />}
                  onClick={() => setCompare(false)}
                  aria-label="关闭校验模式"
                />
              }
            />
          </MessageBar>
        )}

        <section className="wt-surface" aria-label="哈希结果">
          <div className="wt-surface__header">
            <Shield16Regular />
            <Text as="h2" size={300} weight="semibold">
              哈希结果
            </Text>
            <span className={styles.spacer} />
            {!effectiveMd5 && !sha1 && !sha256 && (
              <Caption1 className={styles.hint}>输入内容后自动计算</Caption1>
            )}
          </div>

          {compare && (
            <div className={styles.matchRow}>
              <input
                className="wt-inline-input"
                value={expected}
                onChange={(event) => setExpected(event.target.value)}
                placeholder="粘贴预期哈希（十六进制，忽略大小写与空格）"
                aria-label="预期哈希值"
                spellCheck={false}
              />
            </div>
          )}

          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.rows}>
              {results.map((item) => {
                const result = item.result;
                const matches =
                  hasExpected && result
                    ? result.hex === normalizedExpected
                    : null;
                return (
                  <div key={item.key} className={styles.row}>
                    <div className={styles.rowHead}>
                      <Text weight="semibold" size={300}>
                        {item.label}
                      </Text>
                      <Caption1 className={styles.hint}>{item.note}</Caption1>
                      {matches === true && (
                        <Badge appearance="tint" color="success" size="small">
                          匹配
                        </Badge>
                      )}
                      {matches === false && (
                        <Badge appearance="tint" color="danger" size="small">
                          不匹配
                        </Badge>
                      )}
                      <span className={styles.spacer} />
                      {result && (
                        <>
                          <Tooltip content="复制小写十六进制" relationship="label" withArrow>
                            <Button
                              appearance="subtle"
                              size="small"
                              icon={
                                copied === `${item.key}-hex` ? (
                                  <Checkmark16Regular />
                                ) : (
                                  <Copy16Regular />
                                )
                              }
                              onClick={() => copy(result.hex, `${item.key}-hex`)}
                              aria-label={`复制 ${item.label} 小写`}
                            />
                          </Tooltip>
                          <Button
                            appearance="subtle"
                            size="small"
                            onClick={() => copy(result.upper, `${item.key}-upper`)}
                            aria-label={`复制 ${item.label} 大写`}
                          >
                            大写
                          </Button>
                          <Button
                            appearance="subtle"
                            size="small"
                            onClick={() => copy(result.base64, `${item.key}-b64`)}
                            aria-label={`复制 ${item.label} Base64`}
                          >
                            Base64
                          </Button>
                        </>
                      )}
                    </div>
                    <span className={`${styles.digest} ${result ? '' : styles.muted}`}>
                      {result ? result.hex : '—'}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className={styles.matchRow}>
              <Caption1 className={styles.hint}>
                MD5 与 SHA-1 均已被证明存在碰撞，请勿用于密码存储或签名校验；
                需要安全强度时请使用 SHA-256 或更强的算法。
              </Caption1>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
