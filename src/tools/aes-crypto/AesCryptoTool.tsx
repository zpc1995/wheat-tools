import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Checkbox,
  Divider,
  Dropdown,
  Input,
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
  Toast,
  ToastTitle,
  Toaster,
  useId,
  useToastController,
} from '@fluentui/react-components';
import {
  ArrowUpload16Regular,
  Checkmark16Regular,
  Copy16Regular,
  Key16Regular,
  LockClosed16Regular,
  LockOpen16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  PBKDF2_ITERATIONS,
  decrypt,
  decryptBytes,
  describeEnvelope,
  encrypt,
  encryptBytes,
  parseEnvelope,
  type CipherAlgorithm,
} from './aesUtils';

type Mode = 'encrypt' | 'decrypt';

const ITERATION_OPTIONS = [
  { value: 100_000, label: '100,000（较快）' },
  { value: 210_000, label: '210,000（推荐，与 OWASP 一致）' },
  { value: 600_000, label: '600,000（较慢，更强）' },
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
    alignItems: 'baseline',
    gap: '10px',
    padding: '7px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  rowLabel: {
    flex: 'none',
    width: '120px',
    color: tokens.colorNeutralForeground3,
  },
  rowValue: {
    flex: '1 1 auto',
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12.5px',
  },
  passwordRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 14px',
    flexWrap: 'wrap',
  },
  strength: {
    display: 'flex',
    gap: '3px',
    alignItems: 'center',
  },
  strengthBar: {
    width: '26px',
    height: '6px',
    borderRadius: '3px',
  },
});

/** Rough passphrase strength: length plus character-class variety. */
function passwordScore(password: string): { score: number; label: string; color: string } {
  if (!password) return { score: 0, label: '未输入', color: tokens.colorNeutralBackground4 };

  let classes = 0;
  if (/[a-z]/.test(password)) classes += 1;
  if (/[A-Z]/.test(password)) classes += 1;
  if (/\d/.test(password)) classes += 1;
  if (/[^a-zA-Z0-9]/.test(password)) classes += 1;

  const lengthScore = Math.min(password.length / 16, 1);
  const score = Math.round((lengthScore * 0.6 + (classes / 4) * 0.4) * 4);

  if (score <= 1) return { score: 1, label: '弱', color: tokens.colorPaletteRedForeground1 };
  if (score === 2) return { score: 2, label: '一般', color: tokens.colorPaletteMarigoldForeground1 };
  if (score === 3) return { score: 3, label: '较强', color: tokens.colorPaletteGreenForeground1 };
  return { score: 4, label: '强', color: tokens.colorPaletteGreenForeground1 };
}

export function AesCryptoTool() {
  const styles = useStyles();
  const toasterId = useId('aes-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [mode, setMode] = useState<Mode>('encrypt');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [algorithm, setAlgorithm] = useState<CipherAlgorithm>('AES-GCM');
  const [iterations, setIterations] = useState(PBKDF2_ITERATIONS);
  const [plaintext, setPlaintext] = useState('需要加密的内容');
  const [ciphertext, setCiphertext] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const filePicker = useRef<HTMLInputElement>(null);

  const notify = useCallback(
    (message: string) => {
      dispatchToast(
        <Toast>
          <ToastTitle>{message}</ToastTitle>
        </Toast>,
        { timeout: 1800 },
      );
    },
    [dispatchToast],
  );

  const copy = useCallback(
    async (value: string) => {
      const ok = await copyText(value);
      if (ok) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
        notify('已复制');
      } else {
        notify('复制失败');
      }
    },
    [notify],
  );

  const runEncrypt = useCallback(async () => {
    setBusy(true);
    setError(null);
    const outcome = await encrypt(plaintext, {
      password,
      algorithm,
      iterations,
    });
    setBusy(false);

    if (outcome.ok) {
      setResult(outcome.text);
      setCiphertext(outcome.text);
      notify('加密完成');
    } else {
      setResult(null);
      setError(outcome.error);
    }
  }, [plaintext, password, algorithm, iterations, notify]);

  const runDecrypt = useCallback(async () => {
    setBusy(true);
    setError(null);
    const outcome = await decrypt(ciphertext, password);
    setBusy(false);

    if (outcome.ok) {
      setResult(outcome.plaintext);
      notify('解密完成');
    } else {
      setResult(null);
      setError(outcome.error);
    }
  }, [ciphertext, password, notify]);

  const handleFile = useCallback(
    async (file: File) => {
      if (!password) {
        notify('请先输入口令');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());

        if (mode === 'encrypt') {
          const outcome = await encryptBytes(bytes, { password, algorithm, iterations });
          if (!outcome.ok) {
            setError(outcome.error);
            return;
          }
          setCiphertext(outcome.text);
          setResult(outcome.text);
          notify(`已加密 ${file.name}（${bytes.length} 字节）`);
        } else {
          const outcome = await decryptBytes(ciphertext, password);
          if (!outcome.ok) {
            setError(outcome.error);
            return;
          }
          const blob = new Blob([outcome.bytes as BlobPart], {
            type: 'application/octet-stream',
          });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `decrypted-${file.name.replace(/\.enc$/, '') || 'file.bin'}`;
          link.click();
          URL.revokeObjectURL(url);
          notify(`已解密并下载（${outcome.bytes.length} 字节）`);
        }
      } catch {
        setError('读取文件失败');
      } finally {
        setBusy(false);
      }
    },
    [password, algorithm, iterations, mode, ciphertext, notify],
  );

  const strength = useMemo(() => passwordScore(password), [password]);

  /** Envelope details for the produced ciphertext, when parseable. */
  const envelopeRows = useMemo(() => {
    const source = result && mode === 'encrypt' ? result : ciphertext;
    if (!source) return null;
    const parsed = parseEnvelope(source);
    return parsed.ok ? describeEnvelope(parsed.envelope) : null;
  }, [result, ciphertext, mode]);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <input
          ref={filePicker}
          type="file"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
            event.target.value = '';
          }}
        />
        <div className={styles.toolbar}>
          <TabList
            selectedValue={mode}
            onTabSelect={(_, data) => {
              setMode(data.value as Mode);
              setResult(null);
              setError(null);
            }}
          >
            <Tab value="encrypt" icon={<LockClosed16Regular />}>
              加密
            </Tab>
            <Tab value="decrypt" icon={<LockOpen16Regular />}>
              解密
            </Tab>
          </TabList>

          <Dropdown
            style={{ minWidth: 190 }}
            value={algorithm === 'AES-GCM' ? 'AES-GCM（含校验）' : 'AES-CBC（无校验）'}
            selectedOptions={[algorithm]}
            onOptionSelect={(_, data) =>
              setAlgorithm(data.optionValue as CipherAlgorithm)
            }
            aria-label="加密算法"
          >
            <Option value="AES-GCM" text="AES-GCM（含校验）">
              AES-GCM（含校验）
            </Option>
            <Option value="AES-CBC" text="AES-CBC（无校验）">
              AES-CBC（无校验）
            </Option>
          </Dropdown>

          {mode === 'encrypt' && (
            <Dropdown
              style={{ minWidth: 230 }}
              value={
                ITERATION_OPTIONS.find((item) => item.value === iterations)?.label ??
                String(iterations)
              }
              selectedOptions={[String(iterations)]}
              onOptionSelect={(_, data) =>
                setIterations(Number(data.optionValue))
              }
              aria-label="PBKDF2 迭代次数"
            >
              {ITERATION_OPTIONS.map((item) => (
                <Option key={item.value} value={String(item.value)} text={item.label}>
                  {item.label}
                </Option>
              ))}
            </Dropdown>
          )}

          <span className={styles.spacer} />
          <Badge appearance="tint" color="brand" size="small">
            AES-256
          </Badge>
          <Badge appearance="tint" color="informative" size="small">
            PBKDF2-SHA256
          </Badge>
        </div>

        {/* The two mistakes this tool exists to prevent. */}
        {algorithm === 'AES-CBC' && (
          <MessageBar intent="warning">
            <MessageBarBody>
              <MessageBarTitle>AES-CBC 不校验完整性</MessageBarTitle>
              密文被改动时 CBC 仍会“成功”解密并产出乱码，无法察觉。除兼容既有系统外，
              建议使用默认的 AES-GCM。
            </MessageBarBody>
          </MessageBar>
        )}

        <section className="wt-surface" aria-label="口令">
          <div className="wt-surface__header">
            <Key16Regular />
            <Text as="h2" size={300} weight="semibold">
              口令
            </Text>
            <span className={styles.spacer} />
            <Checkbox
              checked={showPassword}
              onChange={(_, data) => setShowPassword(Boolean(data.checked))}
              label="显示口令"
            />
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.passwordRow}>
              <Input
                style={{ flex: '1 1 260px' }}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(_, data) => setPassword(data.value)}
                placeholder="输入口令（不会被上传，也不存进 localStorage）"
                aria-label="口令"
              />
              <div className={styles.strength}>
                {[0, 1, 2, 3].map((index) => (
                  <span
                    key={index}
                    className={styles.strengthBar}
                    style={{
                      backgroundColor:
                        index < strength.score
                          ? strength.color
                          : tokens.colorNeutralBackground4,
                    }}
                  />
                ))}
                <Caption1 className={styles.hint}>{strength.label}</Caption1>
              </div>
            </div>
            <div className={styles.row}>
              <Caption1 className={styles.hint}>
                口令经 PBKDF2-SHA256 派生密钥，绝不用作 AES 密钥本身。
                即使口令相同，每次加密都会生成新的随机盐与 IV，因此相同明文不会产生相同密文。
              </Caption1>
            </div>
          </div>
        </section>

        {error && (
          <MessageBar intent="error">
            <MessageBarBody>
              <MessageBarTitle>操作失败</MessageBarTitle>
              {error}
            </MessageBarBody>
          </MessageBar>
        )}

        <div className="wt-split">
          <section className="wt-surface" aria-label={mode === 'encrypt' ? '明文' : '密文'}>
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                {mode === 'encrypt' ? '明文' : '密文（信封格式）'}
              </Text>
              <span className={styles.spacer} />
              <Tooltip
                content={
                  mode === 'encrypt'
                    ? '选择文件后加密（Base64 信封），大文件会占用较多内存'
                    : '选择已加密的信封文件，解密后自动下载'
                }
                relationship="description"
                withArrow
              >
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<ArrowUpload16Regular />}
                  onClick={() => filePicker.current?.click()}
                >
                  {mode === 'encrypt' ? '文件加密' : '文件解密'}
                </Button>
              </Tooltip>
            </div>
            <div className="wt-surface__body">
              {mode === 'encrypt' ? (
                <textarea
                  className="wt-code-area"
                  value={plaintext}
                  onChange={(event) => setPlaintext(event.target.value)}
                  placeholder="输入要加密的文本…"
                  aria-label="明文"
                  spellCheck={false}
                />
              ) : (
                <textarea
                  className="wt-code-area"
                  value={ciphertext}
                  onChange={(event) => setCiphertext(event.target.value)}
                  placeholder="粘贴密文（以 WTENC1: 开头的完整信封）"
                  aria-label="密文"
                  spellCheck={false}
                />
              )}
            </div>
          </section>

          <section className="wt-surface" aria-label={mode === 'encrypt' ? '密文' : '明文'}>
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                {mode === 'encrypt' ? '密文（信封格式）' : '明文'}
              </Text>
              <span className={styles.spacer} />
              {result && (
                <Tooltip content="复制结果" relationship="label" withArrow>
                  <Button
                    appearance="subtle"
                    icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
                    onClick={() => copy(result)}
                    aria-label="复制结果"
                  />
                </Tooltip>
              )}
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              {result ? (
                <textarea
                  className="wt-code-area"
                  value={result}
                  readOnly
                  aria-label={mode === 'encrypt' ? '密文结果' : '明文结果'}
                  spellCheck={false}
                />
              ) : (
                <div className="wt-empty">
                  {mode === 'encrypt' ? <LockClosed16Regular /> : <LockOpen16Regular />}
                  <Text weight="semibold">
                    {mode === 'encrypt' ? '等待加密' : '等待解密'}
                  </Text>
                  <Caption1>
                    输入口令与内容后点击下方按钮；密文自带算法、盐与 IV，便于日后解密
                  </Caption1>
                </div>
              )}
            </div>
          </section>
        </div>

        <div className={styles.toolbar}>
          {mode === 'encrypt' ? (
            <Button
              appearance="primary"
              icon={<LockClosed16Regular />}
              onClick={() => void runEncrypt()}
              disabled={busy || !password || !plaintext}
            >
              {busy ? '加密中…' : '加密'}
            </Button>
          ) : (
            <Button
              appearance="primary"
              icon={<LockOpen16Regular />}
              onClick={() => void runDecrypt()}
              disabled={busy || !password || !ciphertext}
            >
              {busy ? '解密中…' : '解密'}
            </Button>
          )}
          <Button
            appearance="secondary"
            onClick={() => {
              setResult(null);
              setError(null);
              setCiphertext('');
              setPlaintext('');
            }}
          >
            清空
          </Button>
          {busy && (
            <Caption1 className={styles.hint}>
              正在执行 PBKDF2 派生（{iterations.toLocaleString()} 次迭代），请稍候…
            </Caption1>
          )}
        </div>

        {envelopeRows && (
          <section className="wt-surface" aria-label="信封信息">
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                信封信息
              </Text>
              <span className={styles.spacer} />
              <Caption1 className={styles.hint}>
                解密所需的全部参数都在密文里
              </Caption1>
            </div>
            <div className={`wt-surface__body ${styles.rows}`}>
              {envelopeRows.map(([label, value]) => (
                <div key={label} className={styles.row}>
                  <Text className={styles.rowLabel} size={200}>
                    {label}
                  </Text>
                  <span className={`${styles.rowValue} ${styles.mono}`}>{value}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>安全边界</MessageBarTitle>
            加解密在浏览器本地完成，口令与内容不会离开页面，也不写入 localStorage。
            但请理解本工具的定位：它适合临时、一次性的加解密与格式互转，
            <strong>不是密钥管理方案</strong>。真正重要的数据请使用专门的加密工具
            （如 age、GPG）并妥善保管密钥；另外「页面来自 https 且未被篡改」
            是这类纯前端加密工具无法自证的前提。
          </MessageBarBody>
        </MessageBar>

        <Divider />
      </div>
    </>
  );
}
