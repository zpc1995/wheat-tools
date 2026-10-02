import { useCallback, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Dropdown,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  Spinner,
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
  Checkmark16Regular,
  Copy16Regular,
  DocumentArrowDown16Regular,
  FingerprintRegular,
  KeyMultipleRegular,
  KeyRegular,
  LockClosedRegular,
  ShieldKeyholeRegular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  ALLOWED_MODULUS_LENGTHS,
  ALGORITHM_NOTES,
  HASH_NOTES,
  MODULUS_1024_REASON,
  MODULUS_LENGTH_NOTES,
  RSA_ALGORITHMS,
  RSA_HASHES,
  generateRsaKeyPair,
  type RsaAlgorithm,
  type RsaHash,
  type RsaKeyPairResult,
} from './rsaUtils';

const ALGORITHM_LABEL: Record<RsaAlgorithm, string> = {
  'RSASSA-PKCS1-v1_5': 'RSASSA-PKCS1-v1_5（签名，兼容性好）',
  'RSA-PSS': 'RSA-PSS（签名，更现代）',
  'RSA-OAEP': 'RSA-OAEP（加密）',
};

const HASH_LABEL: Record<RsaHash, string> = {
  'SHA-256': 'SHA-256（推荐）',
  'SHA-384': 'SHA-384',
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
    gap: '12px',
    padding: '14px',
    width: '100%',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
    padding: '0 14px 14px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  notes: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  note: {
    color: tokens.colorNeutralForeground2,
  },
  block: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  blockHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  // The shared `.wt-code-area` class supplies the monospace metrics; only the
  // height is overridden, since the default 360px per block would turn four
  // outputs into a very long page.
  code: {
    minHeight: '120px',
    maxHeight: '260px',
    whiteSpace: 'pre',
    userSelect: 'all',
  },
  fingerprint: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    fontSize: '13px',
    lineHeight: 1.7,
    overflowWrap: 'anywhere',
    userSelect: 'all',
    whiteSpace: 'pre-wrap',
  },
  badges: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
  },
  bullets: {
    margin: 0,
    paddingLeft: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    color: tokens.colorNeutralForeground2,
  },
});

/** Starts a download for a text file without leaving an object URL behind. */
function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoking synchronously can cancel the download in some browsers, so it is
  // deferred by a task.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function RsaKeyPairTool() {
  const styles = useStyles();
  const toasterId = useId('rsa-toaster');
  const { dispatchToast } = useToastController(toasterId);
  const algorithmId = useId('rsa-algorithm');
  const hashId = useId('rsa-hash');
  const modulusId = useId('rsa-modulus');

  const [algorithm, setAlgorithm] = useState<RsaAlgorithm>('RSASSA-PKCS1-v1_5');
  const [hash, setHash] = useState<RsaHash>('SHA-256');
  const [modulusLength, setModulusLength] = useState<number>(2048);
  const [result, setResult] = useState<RsaKeyPairResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Generation cannot be cancelled, so a stale run is made harmless instead:
  // only the newest request is allowed to publish its result.
  const requestId = useRef(0);

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

  const generate = useCallback(async () => {
    const id = requestId.current + 1;
    requestId.current = id;
    setBusy(true);
    setError(null);

    const outcome = await generateRsaKeyPair({ modulusLength, algorithm, hash });
    if (id !== requestId.current) return;

    setBusy(false);
    if (outcome.ok) {
      setResult(outcome.result);
    } else {
      setResult(null);
      setError(outcome.error);
    }
  }, [algorithm, hash, modulusLength]);

  const copy = useCallback(
    async (value: string, field: string, label: string) => {
      const ok = await copyText(value);
      if (!ok) {
        notify(`${label}复制失败，请手动选择`);
        return;
      }
      setCopied(field);
      window.setTimeout(() => setCopied(null), 1400);
      notify(`已复制${label}`);
    },
    [notify],
  );

  const copyButton = (
    field: string,
    value: string,
    label: string,
  ) => (
    <Tooltip content={`复制${label}`} relationship="label" withArrow>
      <Button
        appearance="subtle"
        size="small"
        icon={copied === field ? <Checkmark16Regular /> : <Copy16Regular />}
        onClick={() => void copy(value, field, label)}
        aria-label={`复制${label}`}
      />
    </Tooltip>
  );

  const downloadButton = (
    filename: string,
    value: string,
    label: string,
  ) => (
    <Tooltip content={`下载为 ${filename}`} relationship="label" withArrow>
      <Button
        appearance="subtle"
        size="small"
        icon={<DocumentArrowDown16Regular />}
        onClick={() => downloadText(filename, value, 'application/x-pem-file')}
        aria-label={`下载${label}`}
      />
    </Tooltip>
  );

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <section className="wt-surface" aria-label="生成参数">
          <div className="wt-surface__header">
            <KeyMultipleRegular />
            <Text as="h2" size={300} weight="semibold">
              生成参数
            </Text>
            <span className={styles.spacer} />
          </div>

          <div className={styles.toolbar}>
            <div className={styles.field}>
              <label htmlFor={algorithmId}>
                <Text size={200} weight="semibold">
                  用途
                </Text>
              </label>
              <Dropdown
                id={algorithmId}
                style={{ minWidth: 260 }}
                value={ALGORITHM_LABEL[algorithm]}
                selectedOptions={[algorithm]}
                onOptionSelect={(_, data) => setAlgorithm(data.optionValue as RsaAlgorithm)}
                aria-label="密钥用途"
              >
                {RSA_ALGORITHMS.map((item) => (
                  <Option key={item} value={item} text={ALGORITHM_LABEL[item]}>
                    {ALGORITHM_LABEL[item]}
                  </Option>
                ))}
              </Dropdown>
            </div>

            <div className={styles.field}>
              <label htmlFor={hashId}>
                <Text size={200} weight="semibold">
                  哈希
                </Text>
              </label>
              <Dropdown
                id={hashId}
                style={{ minWidth: 160 }}
                value={HASH_LABEL[hash]}
                selectedOptions={[hash]}
                onOptionSelect={(_, data) => setHash(data.optionValue as RsaHash)}
                aria-label="哈希算法"
              >
                {RSA_HASHES.map((item) => (
                  <Option key={item} value={item} text={HASH_LABEL[item]}>
                    {HASH_LABEL[item]}
                  </Option>
                ))}
              </Dropdown>
            </div>

            <div className={styles.field}>
              <label htmlFor={modulusId}>
                <Text size={200} weight="semibold">
                  密钥长度
                </Text>
              </label>
              <Dropdown
                id={modulusId}
                style={{ minWidth: 180 }}
                value={`${modulusLength} 位${modulusLength === 2048 ? '（推荐）' : ''}`}
                selectedOptions={[String(modulusLength)]}
                onOptionSelect={(_, data) =>
                  setModulusLength(Number(data.optionValue))
                }
                aria-label="密钥长度"
              >
                {ALLOWED_MODULUS_LENGTHS.map((bits) => (
                  <Option
                    key={bits}
                    value={String(bits)}
                    text={`${bits} 位${bits === 2048 ? '（推荐）' : ''}`}
                  >
                    {`${bits} 位${bits === 2048 ? '（推荐）' : ''}`}
                  </Option>
                ))}
              </Dropdown>
            </div>

            <div className={styles.field}>
              <Text size={200} weight="semibold" style={{ visibility: 'hidden' }}>
                生成
              </Text>
              <Button
                appearance="primary"
                icon={busy ? <Spinner size="tiny" /> : <KeyMultipleRegular />}
                onClick={() => void generate()}
                disabled={busy}
              >
                {busy ? '正在生成…' : result ? '重新生成密钥对' : '生成密钥对'}
              </Button>
            </div>
          </div>

          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.column}>
              <div className={styles.notes}>
                <Caption1 className={styles.note}>
                  {ALGORITHM_NOTES[algorithm]}
                </Caption1>
                <Caption1 className={styles.note}>{HASH_NOTES[hash]}</Caption1>
                <Caption1 className={styles.note}>
                  {MODULUS_LENGTH_NOTES[modulusLength]}
                  {modulusLength === 4096
                    ? ' 4096 位在较慢的设备上可能等待十几秒，请耐心等待。'
                    : ''}
                </Caption1>
                <Caption1 className={styles.note}>
                  密钥长度不提供 1024 位：{MODULUS_1024_REASON}
                </Caption1>
              </div>
            </div>
          </div>
        </section>

        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>私钥只在本机内存中</MessageBarTitle>
            密钥对完全由浏览器的 Web Crypto 在本机生成，页面不会把它发送到任何服务器，也不会写入
            localStorage。但页面上显示出来的私钥仍然是敏感信息：不要截图分享、不要粘贴到聊天工具，
            用完请关闭或刷新页面以清除。本工具不做密钥的持久化保存，也不生成证书或 X.509 CSR。
          </MessageBarBody>
        </MessageBar>

        {error && (
          <MessageBar intent="error">
            <MessageBarBody>
              <MessageBarTitle>生成失败</MessageBarTitle>
              {error}
            </MessageBarBody>
          </MessageBar>
        )}

        {!result && !error && (
          <MessageBar intent="info">
            <MessageBarBody>
              选择用途、哈希与密钥长度后点击「生成密钥对」。生成在浏览器内存中完成，不会上传。
            </MessageBarBody>
          </MessageBar>
        )}

        {result && (
          <>
            <section className="wt-surface" aria-label="密钥信息">
              <div className="wt-surface__header">
                <FingerprintRegular />
                <Text as="h2" size={300} weight="semibold">
                  指纹与摘要
                </Text>
                <span className={styles.spacer} />
                <div className={styles.badges}>
                  <Badge appearance="tint" color="brand" size="small">
                    {result.modulusBits} 位
                  </Badge>
                  <Badge appearance="tint" color="informative" size="small">
                    {result.algorithm} · {result.hash}
                  </Badge>
                  <Badge appearance="tint" color="subtle" size="small">
                    {result.jwa}
                  </Badge>
                  <Badge appearance="tint" color="subtle" size="small">
                    公钥指数 {result.publicExponent}
                  </Badge>
                </div>
              </div>

              <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                <div className={styles.column}>
                  <div className={styles.block}>
                    <div className={styles.blockHead}>
                      <Text weight="semibold" size={300}>
                        公钥 SHA-256 指纹
                      </Text>
                      <Caption1 className={styles.note}>
                        openssl 风格（对 SPKI DER 取 SHA-256）
                      </Caption1>
                      <span className={styles.spacer} />
                      {copyButton('fp-colon', result.fingerprintColon, '指纹')}
                    </div>
                    <span className={styles.fingerprint}>{result.fingerprintColon}</span>
                  </div>

                  <div className={styles.block}>
                    <div className={styles.blockHead}>
                      <Text weight="semibold" size={300}>
                        指纹（无分隔小写十六进制）
                      </Text>
                      <span className={styles.spacer} />
                      {copyButton('fp-hex', result.fingerprintHex, '十六进制指纹')}
                    </div>
                    <span className={styles.fingerprint}>{result.fingerprintHex}</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="wt-surface" aria-label="公钥">
              <div className="wt-surface__header">
                <KeyRegular />
                <Text as="h2" size={300} weight="semibold">
                  公钥 · SPKI PEM
                </Text>
                <span className={styles.spacer} />
                {copyButton('public-pem', result.publicPem, '公钥')}
                {downloadButton('rsa-public-spki.pem', result.publicPem, '公钥')}
              </div>
              <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                <div className={styles.column}>
                  <pre className="wt-code-area" style={{ minHeight: 0, maxHeight: 240 }}>
                    {result.publicPem}
                  </pre>
                  <Caption1 className={styles.note}>
                    头部为 -----BEGIN PUBLIC KEY-----，这是 X.509 SubjectPublicKeyInfo（SPKI）结构，
                    可直接交给 openssl 或大多数语言的密钥解析库。
                  </Caption1>
                </div>
              </div>
            </section>

            <section className="wt-surface" aria-label="私钥">
              <div className="wt-surface__header">
                <LockClosedRegular />
                <Text as="h2" size={300} weight="semibold">
                  私钥 · PKCS#8 PEM
                </Text>
                <span className={styles.spacer} />
                {copyButton('private-pem', result.privatePem, '私钥')}
                {downloadButton('rsa-private-pkcs8.pem', result.privatePem, '私钥')}
              </div>
              <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                <div className={styles.column}>
                  <MessageBar intent="warning">
                    <MessageBarBody>
                      这是未加密的私钥，谁拿到它就能冒充你签名或解密。页面不做保存，离开前请确认它已存到你
                      自己的安全位置（或刷新页面丢弃）。
                    </MessageBarBody>
                  </MessageBar>
                  <pre className="wt-code-area" style={{ minHeight: 0, maxHeight: 240 }}>
                    {result.privatePem}
                  </pre>
                  <Caption1 className={styles.note}>
                    头部为 -----BEGIN PRIVATE KEY-----（PKCS#8）。本工具不生成需要口令保护的 PKCS#8
                    加密私钥，也不生成证书。
                  </Caption1>
                </div>
              </div>
            </section>

            <section className="wt-surface" aria-label="JWK">
              <div className="wt-surface__header">
                <ShieldKeyholeRegular />
                <Text as="h2" size={300} weight="semibold">
                  JWK（JSON）
                </Text>
                <span className={styles.spacer} />
                {copyButton(
                  'public-jwk',
                  JSON.stringify(result.publicJwk, null, 2),
                  '公钥 JWK',
                )}
                {copyButton(
                  'private-jwk',
                  JSON.stringify(result.privateJwk, null, 2),
                  '私钥 JWK',
                )}
              </div>
              <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                <div className={styles.column}>
                  <div className={styles.block}>
                    <div className={styles.blockHead}>
                      <Text weight="semibold" size={300}>
                        公钥 JWK
                      </Text>
                      <Caption1 className={styles.note}>
                        alg 为 {result.jwa}，n / e 采用 base64url 无填充
                      </Caption1>
                    </div>
                    <pre className="wt-code-area" style={{ minHeight: 0, maxHeight: 200 }}>
                      {JSON.stringify(result.publicJwk, null, 2)}
                    </pre>
                  </div>

                  <div className={styles.block}>
                    <div className={styles.blockHead}>
                      <Text weight="semibold" size={300}>
                        私钥 JWK
                      </Text>
                      <Caption1 className={styles.note}>含 d / p / q / dp / dq / qi，同样敏感</Caption1>
                    </div>
                    <pre className="wt-code-area" style={{ minHeight: 0, maxHeight: 240 }}>
                      {JSON.stringify(result.privateJwk, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        <section className="wt-surface" aria-label="安全提示">
          <div className="wt-surface__header">
            <ShieldKeyholeRegular />
            <Text as="h2" size={300} weight="semibold">
              安全提示
            </Text>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.column}>
              <ul className={styles.bullets}>
                <li>
                  <Text size={200}>
                    私钥在本机浏览器的内存中生成，不会上传到服务器，也不会被保存；但生成出来的私钥依然是
                    敏感数据，用完请刷新或关闭页面清除。
                  </Text>
                </li>
                <li>
                  <Text size={200}>
                    浏览器生成密钥依赖浏览器的随机数源，可信程度可能不如 openssl、HSM 或专用密钥管理设备；
                    用于生产环境、长期身份或高价值资产时，请改用这些专业工具生成，再把公钥或证书带进系统。
                  </Text>
                </li>
                <li>
                  <Text size={200}>
                    1024 位不安全的原因：{MODULUS_1024_REASON}
                  </Text>
                </li>
                <li>
                  <Text size={200}>
                    2048 位是当前的最低推荐长度（约 112 位安全强度）。NIST SP 800-57 认为 2048 位 RSA 可
                    继续使用到 2030 年，2031 年起应使用 3072 位（约 128 位安全强度）。需要长期有效（例如
                    十年以上）的密钥，建议直接选择 3072 位或更长。
                  </Text>
                </li>
                <li>
                  <Text size={200}>
                    本工具明确不做两件事：不生成证书或 X.509 CSR（那需要把公钥交给 CA 签发），也不做密钥
                    的持久化保存（刷新页面即丢弃，请自行下载或复制保存）。
                  </Text>
                </li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
