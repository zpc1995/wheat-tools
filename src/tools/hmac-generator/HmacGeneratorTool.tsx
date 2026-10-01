import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Dropdown,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
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
  Key16Regular,
  ShieldKeyhole16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  HMAC_ALGORITHMS,
  computeHmac,
  describeKeyHandling,
  resolveKey,
  type HmacAlgorithm,
  type HmacResult,
  type KeyEncoding,
} from './hmacUtils';

/**
 * The RFC 2202 test case 2 key, offered as a one-click sample so the tool can be
 * sanity-checked against the published vectors without pasting a long hex
 * string by hand.
 */
const SAMPLE_KEY_HEX = '4a656665';
const SAMPLE_MESSAGE = 'what do ya want for nothing?';

/** RFC 4231 test case 2, HMAC-SHA-256 — the value the sample must produce. */
const SAMPLE_TAG = '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843';

const ALGORITHM_LABEL: Record<HmacAlgorithm, string> = {
  'SHA-256': 'SHA-256（推荐）',
  'SHA-384': 'SHA-384',
  'SHA-512': 'SHA-512',
  'SHA-1': 'SHA-1（已不推荐）',
};

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
    gap: '8px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    padding: '14px',
    width: '100%',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    color: tokens.colorNeutralForeground2,
  },
  digest: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    fontSize: '13px',
    lineHeight: 1.6,
    overflowWrap: 'anywhere',
    userSelect: 'all',
    whiteSpace: 'pre-wrap',
  },
  metrics: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
    fontVariantNumeric: 'tabular-nums',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '12px 14px',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  rowHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  compare: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
});

/**
 * Compares a pasted tag against the computed one.
 *
 * Hex is accepted in any case and with the grouping people copy out of logs,
 * Base64 must match as-is. An empty input means "not comparing", which is
 * distinct from "does not match" — the UI shows a neutral state for it.
 */
function matchesExpected(result: HmacResult, expected: string): boolean | null {
  const compact = expected.replace(/\s+/g, '');
  if (!compact) return null;
  if (compact.toLowerCase() === result.hex) return true;
  return compact === result.base64;
}

export function HmacGeneratorTool() {
  const styles = useStyles();
  const toasterId = useId('hmac-toaster');
  const { dispatchToast } = useToastController(toasterId);
  const messageId = useId('hmac-message');
  const keyId = useId('hmac-key');

  const [algorithm, setAlgorithm] = useState<HmacAlgorithm>('SHA-256');
  const [message, setMessage] = useState('');
  const [key, setKey] = useState('');
  const [keyEncoding, setKeyEncoding] = useState<KeyEncoding>('text');
  const [expected, setExpected] = useState('');
  const [result, setResult] = useState<HmacResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Web Crypto is async; the flag stops a slow digest from overwriting a newer
  // one while the user keeps typing.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const outcome = await computeHmac({ algorithm, message, key, keyEncoding });
      if (cancelled) return;
      if (outcome.ok) {
        setResult(outcome.result);
        setError(null);
      } else {
        setResult(null);
        setError(outcome.error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [algorithm, message, key, keyEncoding]);

  // The decoded key is also needed for the length hints, and decoding it here is
  // what surfaces a malformed hex key before the digest is even attempted.
  const decodedKey = useMemo(() => resolveKey(key, keyEncoding), [key, keyEncoding]);

  const notify = useCallback(
    (text: string) => {
      dispatchToast(
        <Toast>
          <ToastTitle>{text}</ToastTitle>
        </Toast>,
        { timeout: 1400 },
      );
    },
    [dispatchToast],
  );

  const copy = useCallback(
    async (value: string, field: string) => {
      const ok = await copyText(value);
      if (!ok) {
        notify('复制失败，请手动选择');
        return;
      }
      setCopied(field);
      window.setTimeout(() => setCopied(null), 1400);
      notify('已复制');
    },
    [notify],
  );

  const loadSample = useCallback(() => {
    setAlgorithm('SHA-256');
    setKeyEncoding('hex');
    setKey(SAMPLE_KEY_HEX);
    setMessage(SAMPLE_MESSAGE);
    setExpected(SAMPLE_TAG);
    notify('已填入 RFC 4231 测试用例 2');
  }, [notify]);

  const clearAll = useCallback(() => {
    setMessage('');
    setKey('');
    setExpected('');
    setResult(null);
    setError(null);
  }, []);

  const verdict = result ? matchesExpected(result, expected) : null;

  const renderDigestRow = (
    label: string,
    value: string,
    field: string,
    caption: string,
  ) => (
    <div className={styles.row}>
      <div className={styles.rowHead}>
        <Text weight="semibold" size={300}>
          {label}
        </Text>
        <Caption1 className={styles.hint}>{caption}</Caption1>
        <span className={styles.spacer} />
        <Tooltip content={`复制${label}`} relationship="label" withArrow>
          <Button
            appearance="subtle"
            size="small"
            icon={copied === field ? <Checkmark16Regular /> : <Copy16Regular />}
            onClick={() => copy(value, field)}
            aria-label={`复制${label}`}
          />
        </Tooltip>
      </div>
      <span className={styles.digest}>{value}</span>
    </div>
  );

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <section className="wt-surface" aria-label="HMAC 输入">
          <div className="wt-surface__header">
            <Key16Regular />
            <Text as="h2" size={300} weight="semibold">
              输入
            </Text>
            <span className={styles.spacer} />
            <div className={styles.toolbar}>
              <Dropdown
                style={{ minWidth: 170 }}
                value={ALGORITHM_LABEL[algorithm]}
                selectedOptions={[algorithm]}
                onOptionSelect={(_, data) =>
                  setAlgorithm(data.optionValue as HmacAlgorithm)
                }
                aria-label="HMAC 算法"
              >
                {HMAC_ALGORITHMS.map((item) => (
                  <Option key={item} value={item} text={ALGORITHM_LABEL[item]}>
                    {ALGORITHM_LABEL[item]}
                  </Option>
                ))}
              </Dropdown>

              <Dropdown
                style={{ minWidth: 150 }}
                value={keyEncoding === 'hex' ? '密钥：十六进制' : '密钥：文本（UTF-8）'}
                selectedOptions={[keyEncoding]}
                onOptionSelect={(_, data) =>
                  setKeyEncoding(data.optionValue as KeyEncoding)
                }
                aria-label="密钥解释方式"
              >
                <Option value="text" text="密钥：文本（UTF-8）">
                  密钥：文本（UTF-8）
                </Option>
                <Option value="hex" text="密钥：十六进制">
                  密钥：十六进制
                </Option>
              </Dropdown>

              <Tooltip content="填入 RFC 4231 测试用例 2" relationship="label" withArrow>
                <Button appearance="secondary" onClick={loadSample}>
                  示例向量
                </Button>
              </Tooltip>

              <Tooltip content="清空全部（算法与密钥解释方式保留）" relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  icon={<Broom16Regular />}
                  onClick={clearAll}
                  disabled={!message && !key && !expected}
                  aria-label="清空全部"
                />
              </Tooltip>
            </div>
          </div>

          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.column}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={messageId}>
                  <Text size={200} weight="semibold">
                    消息
                  </Text>
                </label>
                <textarea
                  id={messageId}
                  className="wt-code-area"
                  style={{ minHeight: '140px' }}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="要认证的消息，按 UTF-8 编码后参与计算（空消息也有定义）"
                  aria-label="要计算 HMAC 的消息"
                  spellCheck={false}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor={keyId}>
                  <Text size={200} weight="semibold">
                    密钥
                  </Text>
                </label>
                <input
                  id={keyId}
                  className="wt-inline-input"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  placeholder={
                    keyEncoding === 'hex'
                      ? '例如 4a656665（可带空格或冒号，也接受 0x 前缀）'
                      : '例如 Jefe（按 UTF-8 取字节）'
                  }
                  aria-label="HMAC 密钥"
                  spellCheck={false}
                  autoComplete="off"
                />
                <Caption1 className={styles.hint}>
                  {decodedKey.ok
                    ? describeKeyHandling(algorithm, decodedKey.bytes.length)
                    : decodedKey.error}
                </Caption1>
              </div>
            </div>
          </div>
        </section>

        {result?.emptyKey && (
          <MessageBar intent="warning">
            <MessageBarBody>
              <MessageBarTitle>密钥为空</MessageBarTitle>
              结果按 RFC 2104 对全零密钥计算，任何人都能复现，不具备认证能力；
              这里保留它只是为了与其它实现的空密钥结果对齐。
            </MessageBarBody>
          </MessageBar>
        )}

        {!decodedKey.ok && error && (
          <MessageBar intent="error">
            <MessageBarBody>
              <MessageBarTitle>密钥无法解析</MessageBarTitle>
              {error}
            </MessageBarBody>
          </MessageBar>
        )}

        <section className="wt-surface" aria-label="HMAC 结果">
          <div className="wt-surface__header">
            <ShieldKeyhole16Regular />
            <Text as="h2" size={300} weight="semibold">
              HMAC 摘要
            </Text>
            <span className={styles.spacer} />
            {result && (
              <div className={styles.metrics}>
                <Badge appearance="tint" color="brand" size="small">
                  {result.algorithm}
                </Badge>
                <Badge appearance="tint" color="informative" size="small">
                  {`${result.bits} 位 / ${result.bytes} 字节`}
                </Badge>
                <Badge appearance="tint" color="subtle" size="small">
                  {`密钥 ${result.keyLength} 字节 · 消息 ${result.messageLength} 字节`}
                </Badge>
              </div>
            )}
          </div>

          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.column}>
              {error && decodedKey.ok && (
                <MessageBar intent="error">
                  <MessageBarBody>
                    <MessageBarTitle>计算失败</MessageBarTitle>
                    {error}
                  </MessageBarBody>
                </MessageBar>
              )}

              {result && (
                <>
                  {renderDigestRow(
                    '十六进制',
                    result.hex,
                    'hex',
                    '小写；接口签名里最常见的形式',
                  )}
                  {renderDigestRow(
                    'Base64',
                    result.base64,
                    'base64',
                    '与上面是同一份摘要字节',
                  )}

                  <div className={styles.compare}>
                    <input
                      className="wt-inline-input"
                      value={expected}
                      onChange={(event) => setExpected(event.target.value)}
                      placeholder="粘贴预期摘要做核对（十六进制忽略大小写与空格，或 Base64）"
                      aria-label="预期摘要"
                      spellCheck={false}
                    />
                    {verdict === true && (
                      <Badge appearance="tint" color="success" size="medium">
                        匹配
                      </Badge>
                    )}
                    {verdict === false && (
                      <Badge appearance="tint" color="danger" size="medium">
                        不匹配
                      </Badge>
                    )}
                  </div>

                  <Caption1 className={styles.hint}>
                    HMAC 由 Web Crypto 计算，密钥与消息均不离开本机。
                    {algorithm === 'SHA-1'
                      ? ' SHA-1 已被证明存在碰撞，仅用于兼容既有系统。'
                      : ''}
                  </Caption1>
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
