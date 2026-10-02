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
  ArrowClockwise16Regular,
  Checkmark16Regular,
  ClipboardTextLtr16Regular,
  Copy16Regular,
  Key16Regular,
  LockClosed16Regular,
  ShieldKeyhole16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  ENTROPY_BITS,
  WORD_COUNT,
  bytesToHex,
  describePassphrase,
  entropyToMnemonic,
  groupHex,
  inspectMnemonic,
  mnemonicToSeed,
  parseHexBytes,
  randomEntropy,
  splitMnemonic,
  type EntropyBits,
  type MnemonicFailure,
  type MnemonicInspection,
} from './bip39Utils';

/**
 * What the "no passphrase" case produces for the canonical all-zero entropy,
 * shown as a worked example so the tool can be spot-checked against the
 * published vectors without leaving the page. The seed below is the empty
 * passphrase value for the "abandon ... about" mnemonic.
 */
const SAMPLE_ENTROPY = '00000000000000000000000000000000';
const SAMPLE_SEED_HEX =
  '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc1' +
  '9a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4';

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
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    fontSize: '13px',
    lineHeight: 1.6,
    overflowWrap: 'anywhere',
    userSelect: 'all',
    whiteSpace: 'pre-wrap',
  },
  words: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
    gap: '6px',
  },
  word: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
    padding: '4px 8px',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    borderRadius: tokens.borderRadiusSmall,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    fontSize: '13px',
    userSelect: 'all',
  },
  wordBad: {
    border: `1px solid ${tokens.colorPaletteRedBorder2}`,
    backgroundColor: tokens.colorPaletteRedBackground1,
  },
  wordIndex: {
    color: tokens.colorNeutralForeground4,
    fontSize: '11px',
    minWidth: '18px',
    textAlign: 'right',
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
  metrics: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
    fontVariantNumeric: 'tabular-nums',
  },
});

/** Reads the raw words out of the textarea, for display next to the indices. */
function displayWords(text: string): string[] {
  return splitMnemonic(text).words;
}

export function Bip39GeneratorTool() {
  const styles = useStyles();
  const toasterId = useId('bip39-toaster');
  const { dispatchToast } = useToastController(toasterId);
  const mnemonicId = useId('bip39-mnemonic');
  const passphraseId = useId('bip39-passphrase');
  const entropyId = useId('bip39-entropy');

  const [bits, setBits] = useState<EntropyBits>(128);
  const [mnemonic, setMnemonic] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [entropyInput, setEntropyInput] = useState('');
  const [inspection, setInspection] = useState<MnemonicInspection | MnemonicFailure | null>(null);
  const [seed, setSeed] = useState<Uint8Array | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [entropyError, setEntropyError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // The textarea is the single source of truth: generating only ever writes a
  // sentence into it, and everything shown below is derived from it. That keeps
  // "generated" and "pasted" mnemonics on exactly the same code path.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await inspectMnemonic(mnemonic);
      if (!cancelled) setInspection(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [mnemonic]);

  useEffect(() => {
    let cancelled = false;
    if (!inspection?.ok) {
      setSeed(null);
      setSeedError(null);
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      try {
        const derived = await mnemonicToSeed(inspection.normalized, passphrase);
        if (cancelled) return;
        setSeed(derived);
        setSeedError(null);
      } catch (cause) {
        if (cancelled) return;
        setSeed(null);
        setSeedError(cause instanceof Error ? cause.message : '种子派生失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inspection, passphrase]);

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
    async (value: string, field: string, label: string) => {
      const ok = await copyText(value);
      if (!ok) {
        notify('复制失败，请手动选择');
        return;
      }
      setCopied(field);
      window.setTimeout(() => setCopied(null), 1400);
      notify(`已复制${label}`);
    },
    [notify],
  );

  /** Generates from fresh system randomness; the fill function is injected. */
  const generate = useCallback((size: EntropyBits) => {
    void (async () => {
      const entropy = randomEntropy(size, (target) => crypto.getRandomValues(target));
      const outcome = await entropyToMnemonic(entropy);
      if (!outcome.ok) {
        notify(outcome.error);
        return;
      }
      setMnemonic(outcome.result.mnemonic);
      setEntropyInput(outcome.result.entropyHex);
      setEntropyError(null);
    })();
  }, [notify]);

  /** Deterministic path: a hand-supplied entropy, useful for checking vectors. */
  const generateFromHex = useCallback(() => {
    const parsed = parseHexBytes(entropyInput);
    if (!parsed.ok) {
      setEntropyError(parsed.error);
      return;
    }
    void (async () => {
      const outcome = await entropyToMnemonic(parsed.bytes);
      if (!outcome.ok) {
        setEntropyError(outcome.error);
        return;
      }
      setEntropyError(null);
      setMnemonic(outcome.result.mnemonic);
      setEntropyInput(outcome.result.entropyHex);
      notify('已按指定熵生成');
    })();
  }, [entropyInput, notify]);

  const clearAll = useCallback(() => {
    setMnemonic('');
    setEntropyInput('');
    setEntropyError(null);
    setInspection(null);
    setSeed(null);
  }, []);

  const words = useMemo(() => displayWords(mnemonic), [mnemonic]);
  const ok = inspection?.ok ? inspection : null;
  const failure = inspection && !inspection.ok ? inspection : null;
  const badPositions = useMemo(
    () => new Set((failure?.unknown ?? []).map((item) => item.position)),
    [failure],
  );

  const seedHex = seed ? bytesToHex(seed) : '';

  const renderCopy = (field: string, value: string, label: string, disabled = false) => (
    <Tooltip content={`复制${label}`} relationship="label" withArrow>
      <Button
        appearance="subtle"
        size="small"
        icon={copied === field ? <Checkmark16Regular /> : <Copy16Regular />}
        onClick={() => copy(value, field, label)}
        disabled={disabled || value === ''}
        aria-label={`复制${label}`}
      />
    </Tooltip>
  );

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>助记词等同于私钥</MessageBarTitle>
            任何拿到助记词（以及口令）的人都能完全控制对应的钱包资产。请离线抄写并妥善保存，
            不要把它输入任何联网页面——包括本页。本工具完全在本地浏览器内计算，
            不保存、不上传任何输入；页面生成的助记词也只是演示，请勿用于存放真实资产。
          </MessageBarBody>
        </MessageBar>

        <section className="wt-surface" aria-label="生成助记词">
          <div className="wt-surface__header">
            <Key16Regular />
            <Text as="h2" size={300} weight="semibold">
              生成助记词
            </Text>
            <span className={styles.spacer} />
            <div className={styles.toolbar}>
              <Dropdown
                style={{ minWidth: 220 }}
                value={`${bits} 位熵 · ${WORD_COUNT[bits]} 个词`}
                selectedOptions={[String(bits)]}
                onOptionSelect={(_, data) => setBits(Number(data.optionValue) as EntropyBits)}
                aria-label="熵长度"
              >
                {ENTROPY_BITS.map((item) => (
                  <Option key={item} value={String(item)} text={`${item} 位熵 · ${WORD_COUNT[item]} 个词`}>
                    {`${item} 位熵 · ${WORD_COUNT[item]} 个词`}
                  </Option>
                ))}
              </Dropdown>

              <Button appearance="primary" icon={<ShieldKeyhole16Regular />} onClick={() => generate(bits)}>
                生成
              </Button>

              <Tooltip content="清空助记词与熵" relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  icon={<ArrowClockwise16Regular />}
                  onClick={clearAll}
                  disabled={!mnemonic && !entropyInput}
                  aria-label="清空"
                />
              </Tooltip>
            </div>
          </div>

          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.column}>
              <Caption1 className={styles.hint}>
                熵由 <code>crypto.getRandomValues</code> 生成，每一步都是标准的 BIP-39：
                熵 → SHA-256 → 取前 ENT/32 位作校验和 → 与熵拼接 → 每 11 位索引一个词。
              </Caption1>

              <div className={styles.field}>
                <label className={styles.label} htmlFor={entropyId}>
                  <Text size={200} weight="semibold">
                    用指定熵生成（十六进制，可选）
                  </Text>
                </label>
                <div className={styles.toolbar}>
                  <input
                    id={entropyId}
                    className="wt-inline-input"
                    style={{ minWidth: 320, flex: '1 1 320px' }}
                    value={entropyInput}
                    onChange={(event) => setEntropyInput(event.target.value)}
                    placeholder="例如 00000000000000000000000000000000（16 / 20 / 24 / 28 / 32 字节）"
                    aria-label="十六进制熵"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <Button appearance="secondary" onClick={generateFromHex} disabled={entropyInput.trim() === ''}>
                    按此熵生成
                  </Button>
                  <Button
                    appearance="subtle"
                    onClick={() => {
                      setEntropyInput(SAMPLE_ENTROPY);
                      setEntropyError(null);
                    }}
                  >
                    填入全零示例
                  </Button>
                </div>
                {entropyError && (
                  <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>{entropyError}</Caption1>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="wt-surface" aria-label="助记词与校验">
          <div className="wt-surface__header">
            <ClipboardTextLtr16Regular />
            <Text as="h2" size={300} weight="semibold">
              助记词
            </Text>
            <span className={styles.spacer} />
            <div className={styles.metrics}>
              {ok && (
                <Badge appearance="tint" color="informative" size="small">
                  {`${ok.wordCount} 词 · ${ok.bits} 位熵`}
                </Badge>
              )}
              {ok && ok.checksumValid && (
                <Badge appearance="tint" color="success" size="small">
                  校验和有效
                </Badge>
              )}
              {ok && !ok.checksumValid && (
                <Badge appearance="tint" color="danger" size="small">
                  校验和错误
                </Badge>
              )}
              {ok &&
                renderCopy('mnemonic', mnemonic, '助记词')}
            </div>
          </div>

          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.column}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={mnemonicId}>
                  <Text size={200} weight="semibold">
                    助记词（可编辑：粘贴一组助记词即可反向恢复熵并验证校验和）
                  </Text>
                </label>
                <textarea
                  id={mnemonicId}
                  className="wt-code-area"
                  style={{ minHeight: '80px' }}
                  value={mnemonic}
                  onChange={(event) => setMnemonic(event.target.value)}
                  placeholder="点上面的「生成」，或粘贴 12 / 15 / 18 / 21 / 24 个 BIP-39 英文单词（用空格分隔）"
                  aria-label="BIP-39 助记词"
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>

              {words.length > 0 && (
                <div className={styles.words}>
                  {words.map((word, index) => (
                    <span
                      key={`${index}-${word}`}
                      className={`${styles.word} ${badPositions.has(index + 1) ? styles.wordBad : ''}`}
                    >
                      <span className={styles.wordIndex}>{index + 1}</span>
                      <span>{word}</span>
                      {ok && (
                        <span className={styles.wordIndex} style={{ marginLeft: 'auto' }}>
                          #{ok.indices[index]}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}

              {failure && (
                <MessageBar intent="error">
                  <MessageBarBody>
                    <MessageBarTitle>
                      {failure.code === 'empty'
                        ? '还没有助记词'
                        : failure.code === 'count'
                          ? '词数不合法'
                          : '有词不在词表中'}
                    </MessageBarTitle>
                    {failure.error}
                    {failure.unknown.length > 1 && (
                      <>
                        {' '}
                        另外还有 {failure.unknown.length - 1} 个词不在词表中（已在上面标红）。
                      </>
                    )}
                  </MessageBarBody>
                </MessageBar>
              )}

              {ok && !ok.checksumValid && (
                <MessageBar intent="error">
                  <MessageBarBody>
                    <MessageBarTitle>校验和不匹配</MessageBarTitle>
                    这组词能解出熵，但末词的校验和位与熵的 SHA-256 不一致，通常是抄错了某个词
                    （或词序不对）。请核对后再使用；BIP-39 的校验和只有 {ok.checksumLength} 位，
                    约 1/256 的错误它抓不到，所以校验通过也不代表一定没抄错。
                  </MessageBarBody>
                </MessageBar>
              )}

              {ok && (ok.caseFolded || ok.whitespaceCollapsed) && (
                <Caption1 className={styles.hint}>
                  {ok.caseFolded ? '输入含大写字母，已按小写归一化后查表。' : ''}
                  {ok.whitespaceCollapsed ? ' 输入含多余空白，已按单个空格归一化。' : ''}
                </Caption1>
              )}
            </div>
          </div>
        </section>

        {ok && (
          <section className="wt-surface" aria-label="熵与校验和">
            <div className="wt-surface__header">
              <LockClosed16Regular />
              <Text as="h2" size={300} weight="semibold">
                熵与校验和
              </Text>
              <span className={styles.spacer} />
              {renderCopy('entropy', ok.entropyHex, '熵')}
            </div>

            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.column}>
                <div className={styles.row}>
                  <div className={styles.rowHead}>
                    <Text weight="semibold" size={300}>
                      熵（{ok.bits} 位 / {ok.entropy.length} 字节）
                    </Text>
                    <Caption1 className={styles.hint}>十六进制</Caption1>
                    <span className={styles.spacer} />
                    {renderCopy('entropy-row', ok.entropyHex, '熵')}
                  </div>
                  <span className={styles.mono}>{groupHex(ok.entropyHex)}</span>
                </div>

                <div className={styles.row}>
                  <div className={styles.rowHead}>
                    <Text weight="semibold" size={300}>
                      校验和（{ok.checksumLength} 位）
                    </Text>
                    <Badge appearance="tint" color={ok.checksumValid ? 'success' : 'danger'} size="small">
                      {ok.checksumValid ? '一致' : '不一致'}
                    </Badge>
                  </div>
                  <span className={styles.mono}>
                    助记词携带：{ok.checksumBits}（{ok.checksumValue}）{'\n'}
                    熵的 SHA-256 前 {ok.checksumLength} 位：{ok.expectedChecksumBits}（
                    {ok.expectedChecksumValue}）
                  </span>
                </div>

                <div className={styles.row}>
                  <div className={styles.rowHead}>
                    <Text weight="semibold" size={300}>
                      词索引
                    </Text>
                    <Caption1 className={styles.hint}>每 11 位一个索引，范围 0–2047</Caption1>
                    <span className={styles.spacer} />
                    {renderCopy('indices', ok.indices.join(' '), '词索引')}
                  </div>
                  <span className={styles.mono}>{ok.indices.join(' ')}</span>
                </div>

                <Caption1 className={styles.hint}>
                  熵与校验和是本工具自己解出来的，可以和第 3 方实现对照；若不放心，
                  请用离线钱包交叉核对。
                </Caption1>
              </div>
            </div>
          </section>
        )}

        <section className="wt-surface" aria-label="BIP39 种子">
          <div className="wt-surface__header">
            <ShieldKeyhole16Regular />
            <Text as="h2" size={300} weight="semibold">
              BIP-39 种子
            </Text>
            <span className={styles.spacer} />
            <div className={styles.metrics}>
              {seed && (
                <Badge appearance="tint" color="informative" size="small">
                  64 字节 / 512 位
                </Badge>
              )}
              {renderCopy('seed', seedHex, '种子')}
            </div>
          </div>

          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.column}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={passphraseId}>
                  <Text size={200} weight="semibold">
                    口令（BIP-39 passphrase，可选，可留空）
                  </Text>
                </label>
                <input
                  id={passphraseId}
                  className="wt-inline-input"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  placeholder="留空表示不加口令；口令按 UTF-8 NFKD 拼接在盐前缀 mnemonic 之后"
                  aria-label="BIP-39 口令"
                  spellCheck={false}
                  autoComplete="off"
                />
                <Caption1 className={styles.hint}>{describePassphrase(passphrase)}</Caption1>
              </div>

              <div className={styles.row}>
                <div className={styles.rowHead}>
                  <Text weight="semibold" size={300}>
                    种子（十六进制）
                  </Text>
                  <Caption1 className={styles.hint}>PBKDF2-HMAC-SHA512，2048 轮</Caption1>
                </div>
                {seedError && <Caption1>{seedError}</Caption1>}
                {!seed && !seedError && (
                  <Caption1 className={styles.hint}>
                    先在上面生成或粘贴一组合法的助记词（词数合法且每个词都在词表内），这里会显示种子。
                  </Caption1>
                )}
                {seed && <span className={styles.mono}>{groupHex(seedHex)}</span>}
              </div>

              <Caption1 className={styles.hint}>
                这 64 字节就是 BIP-32 的主种子（master seed），本工具到此为止：
                不做 BIP-32/44 派生、不生成地址、不生成二维码（地址与二维码请用专门的钱包工具）。
                留空口令时，{SAMPLE_ENTROPY} 这组熵（12 个词，最后一个词 about）对应的种子以{' '}
                <span className={styles.mono}>{SAMPLE_SEED_HEX.slice(0, 16)}…</span> 开头。
              </Caption1>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
