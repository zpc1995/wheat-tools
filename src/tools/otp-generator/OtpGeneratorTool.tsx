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
  Radio,
  RadioGroup,
  Text,
  Toast,
  ToastTitle,
  Toaster,
  Tooltip,
  makeStyles,
  tokens,
  useId,
  useToastController,
} from '@fluentui/react-components';
import {
  ArrowLeft16Regular,
  ArrowRight16Regular,
  ArrowSync16Regular,
  Broom16Regular,
  Checkmark16Regular,
  Copy16Regular,
  Key16Regular,
  LockClosed16Regular,
  ShieldLock16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  DEFAULT_PERIOD_SECONDS,
  MAX_PERIOD_SECONDS,
  MIN_PERIOD_SECONDS,
  OTP_ALGORITHMS,
  OTP_DIGITS,
  decodeBase32,
  formatCode,
  formatSecondsRemaining,
  generateHotp,
  generateTotp,
  parseOtpAuthUri,
  timeStepCounter,
  timeStepElapsedMs,
  type OtpAlgorithm,
  type OtpAuthConfig,
  type OtpTrace,
  type TotpState,
} from './otpUtils';

type Mode = 'totp' | 'hotp';

/**
 * A well-known demo secret: Base32 for the ASCII bytes `Hello!` followed by
 * 0xDE 0xAD 0xBE 0xEF. It is the example printed in RFC 4648 section 10, so it
 * is recognisable and nobody will mistake it for a real credential.
 */
const SAMPLE_SECRET = 'JBSWY3DPEHPK3PXP';

/**
 * A demo provisioning URI in the Google Authenticator key URI format. The label
 * carries a `Issuer:account` prefix, which is the alternate way the format
 * conveys the issuer.
 */
const SAMPLE_URI =
  'otpauth://totp/Wheat%20Tools:demo@example.com?secret=JBSWY3DPEHPK3PXP' +
  '&issuer=Wheat%20Tools&algorithm=SHA1&digits=6&period=30';

/** Circumference of the countdown ring, for the dash pattern. */
const RING_RADIUS = 44;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Interval between countdown refreshes, in milliseconds. */
const TICK_MS = 250;

const ALGORITHM_LABEL: Record<OtpAlgorithm, string> = {
  'SHA-1': 'SHA-1（默认，兼容性最好）',
  'SHA-256': 'SHA-256',
  'SHA-512': 'SHA-512',
};

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    padding: '14px',
    width: '100%',
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
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  grid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '14px',
  },
  gridItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    minWidth: '170px',
  },
  label: {
    color: tokens.colorNeutralForeground2,
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  codeRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '14px',
  },
  code: {
    // Monospace plus tabular figures: the digits must not change width when the
    // code rolls over, or the whole line visibly shifts every 30 seconds.
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    fontSize: 'clamp(30px, 7vw, 48px)',
    fontWeight: 600,
    letterSpacing: '0.06em',
    userSelect: 'all',
  },
  codeSecondary: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    fontSize: '20px',
    fontWeight: 600,
    letterSpacing: '0.06em',
    userSelect: 'all',
  },
  ringWrap: {
    position: 'relative',
    width: '112px',
    height: '112px',
    flex: '0 0 auto',
  },
  ringLabel: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0',
    fontVariantNumeric: 'tabular-nums',
  },
  ringSeconds: {
    fontSize: '26px',
    fontWeight: 600,
    lineHeight: 1.1,
  },
  ringCaption: {
    color: tokens.colorNeutralForeground3,
  },
  facts: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  factRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    alignItems: 'center',
  },
  factLabel: {
    color: tokens.colorNeutralForeground3,
    minWidth: '84px',
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  list: {
    margin: 0,
    paddingLeft: '20px',
    color: tokens.colorNeutralForeground2,
    lineHeight: 1.7,
  },
});

/** Parses a decimal integer from a text field, or returns NaN. */
function parseInt10(text: string): number {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
}

export function OtpGeneratorTool() {
  const styles = useStyles();
  const toasterId = useId('otp-toaster');
  const { dispatchToast } = useToastController(toasterId);
  const secretId = useId('otp-secret');
  const uriId = useId('otp-uri');
  const periodId = useId('otp-period');
  const counterId = useId('otp-counter');
  const algorithmId = useId('otp-algorithm');
  const digitsId = useId('otp-digits');

  const [mode, setMode] = useState<Mode>('totp');
  const [secretText, setSecretText] = useState('');
  const [algorithm, setAlgorithm] = useState<OtpAlgorithm>('SHA-1');
  const [digits, setDigits] = useState(6);
  const [periodText, setPeriodText] = useState(String(DEFAULT_PERIOD_SECONDS));
  const [counterText, setCounterText] = useState('0');
  const [uriText, setUriText] = useState('');
  const [parsed, setParsed] = useState<OtpAuthConfig | null>(null);
  const [uriError, setUriError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [totp, setTotp] = useState<TotpState | null>(null);
  const [hotp, setHotp] = useState<OtpTrace | null>(null);

  // Nothing about the secret is written to storage: no localStorage, no session
  // storage, no history entry. Reloading the page is what forgets it.
  const secret = useMemo(() => decodeBase32(secretText), [secretText]);

  const periodValue = parseInt10(periodText);
  const counterValue = parseInt10(counterText);

  // A single ticking clock for the whole component. The secret never enters
  // this state, so a re-render every 250 ms does not touch it.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const step = timeStepCounter(now, Number.isInteger(periodValue) ? periodValue : DEFAULT_PERIOD_SECONDS);

  // TOTP is recomputed once per time step rather than on every tick. The countdown
  // is derived from the live clock below, so the ring stays smooth while the HMAC
  // runs only when the counter actually changes.
  useEffect(() => {
    if (mode !== 'totp' || !secret.ok || secret.bytes.length === 0 || !Number.isInteger(periodValue)) {
      setTotp(null);
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      const outcome = await generateTotp(
        secret.bytes,
        step * periodValue * 1000,
        algorithm,
        digits,
        periodValue,
      );
      if (cancelled) return;
      if (outcome.ok) {
        setTotp(outcome.state);
        setCodeError(null);
      } else {
        setTotp(null);
        setCodeError(outcome.error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, secret, algorithm, digits, periodValue, step]);

  useEffect(() => {
    if (mode !== 'hotp' || !secret.ok || secret.bytes.length === 0 || !Number.isInteger(counterValue)) {
      setHotp(null);
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      const outcome = await generateHotp(secret.bytes, counterValue, algorithm, digits);
      if (cancelled) return;
      if (outcome.ok) {
        setHotp(outcome.trace);
        setCodeError(null);
      } else {
        setHotp(null);
        setCodeError(outcome.error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, secret, algorithm, digits, counterValue]);

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
    setMode('totp');
    setSecretText(SAMPLE_SECRET);
    setAlgorithm('SHA-1');
    setDigits(6);
    setPeriodText(String(DEFAULT_PERIOD_SECONDS));
    setCounterText('0');
    notify('已填入 RFC 4648 示例密钥');
  }, [notify]);

  const clearAll = useCallback(() => {
    setSecretText('');
    setUriText('');
    setParsed(null);
    setUriError(null);
    setCodeError(null);
    setCounterText('0');
    setPeriodText(String(DEFAULT_PERIOD_SECONDS));
  }, []);

  const parseUri = useCallback(() => {
    const outcome = parseOtpAuthUri(uriText);
    if (!outcome.ok) {
      setParsed(null);
      setUriError(outcome.error);
      return;
    }
    const config = outcome.config;
    setParsed(config);
    setUriError(null);
    setCodeError(null);
    setMode(config.type);
    setSecretText(config.secret);
    setAlgorithm(config.algorithm);
    setDigits(config.digits);
    setPeriodText(String(config.periodSeconds));
    setCounterText(String(config.counter));
    notify('已按 URI 填好参数');
  }, [uriText, notify]);

  const loadSampleUri = useCallback(() => {
    setUriText(SAMPLE_URI);
    const outcome = parseOtpAuthUri(SAMPLE_URI);
    if (outcome.ok) {
      const config = outcome.config;
      setParsed(config);
      setUriError(null);
      setCodeError(null);
      setMode(config.type);
      setSecretText(config.secret);
      setAlgorithm(config.algorithm);
      setDigits(config.digits);
      setPeriodText(String(config.periodSeconds));
      setCounterText(String(config.counter));
    }
    notify('已填入示例 otpauth URI');
  }, [notify]);

  // Live countdown, derived from the clock rather than stored with the code.
  const livePeriod = Number.isInteger(periodValue) && periodValue >= MIN_PERIOD_SECONDS
    ? periodValue
    : DEFAULT_PERIOD_SECONDS;
  const elapsedMs = timeStepElapsedMs(now, livePeriod);
  const secondsRemaining = livePeriod - Math.floor(elapsedMs / 1000);
  const remainingFraction = (livePeriod * 1000 - elapsedMs) / (livePeriod * 1000);
  const urgent = secondsRemaining <= 5;

  const code = mode === 'totp' ? totp?.code ?? '' : hotp?.code ?? '';
  const nextCode = totp?.nextCode ?? '';
  const ready = code !== '';
  const decodedHint = secret.ok
    ? secret.bytes.length === 0
      ? '等待输入密钥'
      : `Base32 解码后 ${secret.bytes.length} 字节（${secret.bytes.length * 8} 位）`
    : secret.error;

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <MessageBar intent="warning" icon={<LockClosed16Regular />}>
          <MessageBarBody>
            <MessageBarTitle>密钥是敏感信息</MessageBarTitle>
            本工具完全在浏览器本地计算：密钥既不写入任何存储，也不上传到任何服务器，刷新页面即被遗忘。
            页面上显示出来的验证码本身同样是一次性凭据 —— 它在有效期内等同于你的第二因素，不要截图、不要发给任何人。
          </MessageBarBody>
        </MessageBar>

        <section className="wt-surface" aria-label="验证码参数">
          <div className="wt-surface__header">
            <Key16Regular />
            <Text as="h2" size={300} weight="semibold">
              密钥与参数
            </Text>
            <span className={styles.spacer} />
            <div className={styles.toolbar}>
              <Tooltip content="填入 RFC 4648 的示例密钥（并不是真实凭据）" relationship="label" withArrow>
                <Button appearance="secondary" onClick={loadSample}>
                  示例密钥
                </Button>
              </Tooltip>
              <Tooltip content="清空密钥、URI 与解析结果（刷新页面也会清空）" relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  icon={<Broom16Regular />}
                  onClick={clearAll}
                  disabled={!secretText && !uriText && !parsed}
                  aria-label="清空全部"
                />
              </Tooltip>
            </div>
          </div>

          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.column}>
              <RadioGroup
                value={mode}
                onChange={(_, data) => setMode(data.value as Mode)}
                aria-label="验证码类型"
              >
                <Radio value="totp" label="TOTP（按时间，RFC 6238）" />
                <Radio value="hotp" label="HOTP（按计数器，RFC 4226）" />
              </RadioGroup>

              <div className={styles.field}>
                <label className={styles.label} htmlFor={secretId}>
                  <Text size={200} weight="semibold">
                    Base32 密钥
                  </Text>
                </label>
                <input
                  id={secretId}
                  className="wt-inline-input"
                  value={secretText}
                  onChange={(event) => setSecretText(event.target.value)}
                  placeholder="例如 JBSWY3DPEHPK3PXP（大小写与空格都会自动规范化）"
                  aria-label="Base32 密钥"
                  spellCheck={false}
                  autoComplete="off"
                  style={{ width: '100%', maxWidth: '520px' }}
                />
                <Caption1 className={styles.hint}>
                  {decodedHint}
                  {secret.ok && secret.normalized && secret.normalized !== secretText
                    ? ` · 规范化后：${secret.normalized}`
                    : ''}
                </Caption1>
              </div>

              <div className={styles.grid}>
                <div className={styles.gridItem}>
                  <label className={styles.label} htmlFor={algorithmId}>
                    <Text size={200} weight="semibold">
                      HMAC 算法
                    </Text>
                  </label>
                  <Dropdown
                    id={algorithmId}
                    value={ALGORITHM_LABEL[algorithm]}
                    selectedOptions={[algorithm]}
                    onOptionSelect={(_, data) => setAlgorithm(data.optionValue as OtpAlgorithm)}
                    aria-label="HMAC 算法"
                  >
                    {OTP_ALGORITHMS.map((item) => (
                      <Option key={item} value={item} text={ALGORITHM_LABEL[item]}>
                        {ALGORITHM_LABEL[item]}
                      </Option>
                    ))}
                  </Dropdown>
                </div>

                <div className={styles.gridItem}>
                  <label className={styles.label} htmlFor={digitsId}>
                    <Text size={200} weight="semibold">
                      位数
                    </Text>
                  </label>
                  <Dropdown
                    id={digitsId}
                    value={`${digits} 位`}
                    selectedOptions={[String(digits)]}
                    onOptionSelect={(_, data) => setDigits(Number(data.optionValue))}
                    aria-label="验证码位数"
                  >
                    {OTP_DIGITS.map((item) => (
                      <Option key={item} value={String(item)} text={`${item} 位`}>
                        {`${item} 位`}
                      </Option>
                    ))}
                  </Dropdown>
                </div>

                <div className={styles.gridItem}>
                  <label className={styles.label} htmlFor={periodId}>
                    <Text size={200} weight="semibold">
                      周期（秒）
                    </Text>
                  </label>
                  <input
                    id={periodId}
                    className="wt-inline-input"
                    value={periodText}
                    onChange={(event) => setPeriodText(event.target.value)}
                    inputMode="numeric"
                    aria-label="时间步长（秒）"
                    spellCheck={false}
                    autoComplete="off"
                    disabled={mode === 'hotp'}
                  />
                  <Caption1 className={styles.hint}>
                    {mode === 'hotp'
                      ? 'HOTP 不使用时间步长'
                      : Number.isInteger(periodValue) &&
                          periodValue >= MIN_PERIOD_SECONDS &&
                          periodValue <= MAX_PERIOD_SECONDS
                        ? `默认 ${DEFAULT_PERIOD_SECONDS} 秒，可填 ${MIN_PERIOD_SECONDS} - ${MAX_PERIOD_SECONDS}`
                        : `周期必须是 ${MIN_PERIOD_SECONDS} - ${MAX_PERIOD_SECONDS} 之间的整数秒`}
                  </Caption1>
                </div>

                {mode === 'hotp' && (
                  <div className={styles.gridItem}>
                    <label className={styles.label} htmlFor={counterId}>
                      <Text size={200} weight="semibold">
                        计数器
                      </Text>
                    </label>
                    <input
                      id={counterId}
                      className="wt-inline-input"
                      value={counterText}
                      onChange={(event) => setCounterText(event.target.value)}
                      inputMode="numeric"
                      aria-label="HOTP 计数器"
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <Caption1 className={styles.hint}>
                      服务器与令牌必须同步到同一个计数值
                    </Caption1>
                  </div>
                )}
              </div>

              {!secret.ok && secretText.trim() !== '' && (
                <MessageBar intent="error">
                  <MessageBarBody>
                    <MessageBarTitle>密钥无法解析</MessageBarTitle>
                    {secret.error}
                  </MessageBarBody>
                </MessageBar>
              )}
            </div>
          </div>
        </section>

        <section className="wt-surface" aria-label="解析 otpauth URI">
          <div className="wt-surface__header">
            <ArrowSync16Regular />
            <Text as="h2" size={300} weight="semibold">
              解析 otpauth:// URI
            </Text>
            <span className={styles.spacer} />
            <div className={styles.toolbar}>
              <Button appearance="secondary" onClick={loadSampleUri}>
                示例 URI
              </Button>
              <Button appearance="primary" onClick={parseUri} disabled={!uriText.trim()}>
                解析并填入
              </Button>
            </div>
          </div>

          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.column}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={uriId}>
                  <Text size={200} weight="semibold">
                    Google Authenticator 密钥 URI
                  </Text>
                </label>
                <textarea
                  id={uriId}
                  className="wt-code-area"
                  style={{ minHeight: '76px' }}
                  value={uriText}
                  onChange={(event) => {
                    setUriText(event.target.value);
                    // A stale "cannot parse" message next to edited text is
                    // worse than no message: it describes input that is gone.
                    if (uriError) setUriError(null);
                  }}
                  placeholder="otpauth://totp/Issuer:account?secret=BASE32&issuer=Issuer&algorithm=SHA1&digits=6&period=30"
                  aria-label="otpauth 密钥 URI"
                  spellCheck={false}
                />
                <Caption1 className={styles.hint}>
                  secret 参数是 Base32 文本（不是十六进制、不是原始字节）；参数名按小写约定书写，
                  这里也接受大写写法；algorithm 取 SHA1 / SHA256 / SHA512，digits 取 6 或 8，period 是整数秒。
                </Caption1>
              </div>

              {parsed && (
                <div className={styles.facts}>
                  <div className={styles.factRow}>
                    <Badge appearance="tint" color="brand" size="small">
                      {parsed.type.toUpperCase()}
                    </Badge>
                    {parsed.issuer && (
                      <Badge appearance="tint" color="informative" size="small">
                        {`签发方 ${parsed.issuer}`}
                      </Badge>
                    )}
                    {parsed.label && (
                      <Badge appearance="tint" color="subtle" size="small">
                        {`账号 ${parsed.label}`}
                      </Badge>
                    )}
                  </div>
                  <Caption1 className={styles.mono}>
                    {`${parsed.algorithm} · ${parsed.digits} 位 · ${
                      parsed.type === 'totp' ? `${parsed.periodSeconds} 秒` : `计数器 ${parsed.counter}`
                    } · 密钥 ${parsed.secretBytes} 字节`}
                  </Caption1>
                  {parsed.ignoredParams.length > 0 && (
                    <Caption1 className={styles.hint}>
                      {`已忽略参数：${parsed.ignoredParams.join(', ')}`}
                    </Caption1>
                  )}
                  {parsed.warnings.map((warning) => (
                    <Caption1 key={warning} className={styles.hint}>
                      {`注意：${warning}`}
                    </Caption1>
                  ))}
                </div>
              )}

              {uriError && (
                <MessageBar intent="error">
                  <MessageBarBody>
                    <MessageBarTitle>URI 无法解析</MessageBarTitle>
                    {uriError}
                  </MessageBarBody>
                </MessageBar>
              )}
            </div>
          </div>
        </section>

        <section className="wt-surface" aria-label="验证码">
          <div className="wt-surface__header">
            <ShieldLock16Regular />
            <Text as="h2" size={300} weight="semibold">
              当前验证码
            </Text>
            <span className={styles.spacer} />
            {mode === 'totp' && totp && (
              <Badge appearance="tint" color={urgent ? 'danger' : 'success'} size="small">
                {formatSecondsRemaining(secondsRemaining)}
              </Badge>
            )}
          </div>

          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.column}>
              {codeError && secret.ok && secret.bytes.length > 0 && (
                <MessageBar intent="error">
                  <MessageBarBody>
                    <MessageBarTitle>无法生成验证码</MessageBarTitle>
                    {codeError}
                  </MessageBarBody>
                </MessageBar>
              )}

              {!ready ? (
                <Caption1 className={styles.hint}>
                  {secret.ok && secret.bytes.length > 0
                    ? '上方的参数还不完整（检查周期、位数或计数器），修正后验证码会立即出现在这里。'
                    : '填入 Base32 密钥后，这里会显示当前验证码。'}
                </Caption1>
              ) : (
                <>
                  <div className={styles.codeRow}>
                    {mode === 'totp' && (
                      <div className={styles.ringWrap}>
                        <svg
                          viewBox="0 0 100 100"
                          width="112"
                          height="112"
                          role="img"
                          aria-label={`当前验证码剩余 ${secondsRemaining} 秒`}
                        >
                          <circle
                            cx="50"
                            cy="50"
                            r={RING_RADIUS}
                            fill="none"
                            stroke={tokens.colorNeutralStroke2}
                            strokeWidth="8"
                          />
                          <circle
                            cx="50"
                            cy="50"
                            r={RING_RADIUS}
                            fill="none"
                            stroke={
                              urgent
                                ? tokens.colorPaletteRedForeground1
                                : tokens.colorPaletteGreenForeground1
                            }
                            strokeWidth="8"
                            strokeLinecap="round"
                            strokeDasharray={RING_CIRCUMFERENCE}
                            strokeDashoffset={RING_CIRCUMFERENCE * (1 - remainingFraction)}
                            transform="rotate(-90 50 50)"
                            // The dash offset is only updated a few times a second;
                            // the transition is what makes the arc glide instead of
                            // stepping. Without it the ring visibly jumps 30 times a
                            // period and looks broken.
                            style={{
                              transition: `stroke-dashoffset ${TICK_MS}ms linear, stroke 300ms linear`,
                            }}
                          />
                        </svg>
                        <div className={styles.ringLabel}>
                          <span className={styles.ringSeconds}>{secondsRemaining}</span>
                          <Caption1 className={styles.ringCaption}>秒后失效</Caption1>
                        </div>
                      </div>
                    )}

                    <div className={styles.facts}>
                      <div className={styles.factRow}>
                        <span className={styles.code} aria-label={`验证码 ${code.split('').join(' ')}`}>
                          {formatCode(code)}
                        </span>
                        <Tooltip content="复制验证码（不含空格）" relationship="label" withArrow>
                          <Button
                            appearance="secondary"
                            icon={copied === 'code' ? <Checkmark16Regular /> : <Copy16Regular />}
                            onClick={() => copy(code, 'code')}
                            aria-label="复制验证码"
                          >
                            复制
                          </Button>
                        </Tooltip>
                      </div>

                      <div className={styles.factRow}>
                        <Caption1 className={styles.factLabel}>计数器</Caption1>
                        <Caption1 className={styles.mono}>
                          {mode === 'totp' ? String(totp?.counter ?? '') : String(hotp?.counter ?? '')}
                        </Caption1>
                      </div>

                      {mode === 'totp' && (
                        <>
                          <div className={styles.factRow}>
                            <Caption1 className={styles.factLabel}>失效时刻</Caption1>
                            <Caption1 className={styles.mono}>
                              {new Date(totp?.expiresAtMs ?? now).toLocaleTimeString('zh-CN', {
                                hour12: false,
                              })}
                            </Caption1>
                          </div>
                          <div className={styles.factRow}>
                            <Caption1 className={styles.factLabel}>下一个</Caption1>
                            <span className={styles.codeSecondary}>{formatCode(nextCode)}</span>
                            <Tooltip content="复制下一个验证码" relationship="label" withArrow>
                              <Button
                                appearance="subtle"
                                size="small"
                                icon={copied === 'next' ? <Checkmark16Regular /> : <Copy16Regular />}
                                onClick={() => copy(nextCode, 'next')}
                                aria-label="复制下一个验证码"
                              />
                            </Tooltip>
                          </div>
                        </>
                      )}

                      {mode === 'hotp' && (
                        <div className={styles.factRow}>
                          <Button
                            appearance="secondary"
                            icon={<ArrowLeft16Regular />}
                            onClick={() =>
                              setCounterText(String(Math.max(0, (hotp?.counter ?? 0) - 1)))
                            }
                            disabled={(hotp?.counter ?? 0) <= 0}
                          >
                            上一个
                          </Button>
                          <Button
                            appearance="secondary"
                            icon={<ArrowRight16Regular />}
                            onClick={() => setCounterText(String((hotp?.counter ?? 0) + 1))}
                          >
                            下一个
                          </Button>
                          <Button
                            appearance="subtle"
                            onClick={() => setCounterText('0')}
                            disabled={(hotp?.counter ?? 0) === 0}
                          >
                            归零
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>

                  <Caption1 className={styles.hint}>
                    {mode === 'totp'
                      ? `T = floor(Unix 秒 / ${livePeriod})，再用 HMAC-${algorithm} 与动态截断得到 ${digits} 位数字；同一个时间步内验证码不会变化。`
                      : `用 HMAC-${algorithm} 对 8 字节大端计数器 ${hotp?.counter ?? ''} 求摘要，再动态截断为 ${digits} 位数字；每用一次计数器加一，服务器与令牌必须同步。`}
                  </Caption1>
                </>
              )}
            </div>
          </div>
        </section>

        <section className="wt-surface" aria-label="工具说明与边界">
          <div className="wt-surface__header">
            <LockClosed16Regular />
            <Text as="h2" size={300} weight="semibold">
              说明与边界
            </Text>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.column}>
              <ul className={styles.list}>
                <li>
                  算法严格按 RFC 4226（HOTP）与 RFC 6238（TOTP）实现，已逐条对照两份 RFC
                  附录里的官方测试向量，包括 HMAC 摘要、截断偏移与截断后的 31 位整数。
                </li>
                <li>支持 SHA-1 / SHA-256 / SHA-512，6 位或 8 位，自定义时间步长（默认 30 秒）。</li>
                <li>密钥可带空格、大小写混写，也可解析 otpauth:// 密钥 URI 后自动填好参数。</li>
                <li>
                  <strong>不做</strong>：不扫描二维码（那是「二维码识别」工具的事），
                  不做服务器端校验，不保存密钥，也不提供导出或分享。
                </li>
                <li>
                  密钥与验证码都只存在于当前页面内存中；本工具没有任何网络请求。
                  关闭或刷新页面后密钥即消失。
                </li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
