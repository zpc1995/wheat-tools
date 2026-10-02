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
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowClockwiseRegular,
  ArrowDownloadRegular,
  CopyRegular,
  InfoRegular,
  LockClosedRegular,
  TagRegular,
} from '@fluentui/react-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_TOKEN_OPTIONS,
  GROUP_SIZES,
  MAX_TOKEN_COUNT,
  MAX_TOKEN_LENGTH,
  TOKEN_FORMATS,
  generateTokens,
  type RandomSource,
  type TokenBatch,
  type TokenFormat,
  type TokenOptions,
} from './tokenUtils';

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
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  numberInput: {
    width: '110px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  metricGrid: {
    display: 'grid',
    gap: '10px',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
  },
  metric: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '10px 12px',
    borderRadius: '8px',
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  bigNumber: {
    fontFamily: 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace',
    fontVariantNumeric: 'tabular-nums',
    fontSize: '24px',
    fontWeight: 600,
    lineHeight: 1.15,
  },
  mono: {
    fontFamily: 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace',
    fontVariantNumeric: 'tabular-nums',
  },
  muted: {
    color: tokens.colorNeutralForeground3,
  },
});

/** Turns a text field into a positive integer, keeping the last valid value. */
function parsePositiveInteger(text: string, fallback: number): number {
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  const styles = useStyles();
  return (
    <div className={styles.metric}>
      <Caption1 className={styles.muted}>{label}</Caption1>
      <Text className={styles.bigNumber}>{value}</Text>
      <Caption1 className={styles.muted}>{hint}</Caption1>
    </div>
  );
}

function collisionText(batch: TokenBatch): { text: string; warn: boolean } {
  const exponent = batch.log10CollisionChance;
  if (!Number.isFinite(exponent)) return { text: '—', warn: false };
  if (exponent > -3) {
    return { text: `约 10^${exponent.toFixed(1)}（很高）`, warn: true };
  }
  if (exponent > -9) {
    return { text: `约 10^${exponent.toFixed(1)}`, warn: false };
  }
  return { text: `低于 10^-9`, warn: false };
}

export function TokenGeneratorTool() {
  const styles = useStyles();
  const [format, setFormat] = useState<TokenFormat>(DEFAULT_TOKEN_OPTIONS.format);
  const [customCharset, setCustomCharset] = useState(DEFAULT_TOKEN_OPTIONS.customCharset);
  const [lengthText, setLengthText] = useState(String(DEFAULT_TOKEN_OPTIONS.length));
  const [countText, setCountText] = useState(String(DEFAULT_TOKEN_OPTIONS.count));
  const [prefix, setPrefix] = useState(DEFAULT_TOKEN_OPTIONS.prefix);
  const [groupSize, setGroupSize] = useState(DEFAULT_TOKEN_OPTIONS.groupSize);

  const [batch, setBatch] = useState<TokenBatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const options = useMemo<TokenOptions>(
    () => ({
      format,
      customCharset,
      length: parsePositiveInteger(lengthText, DEFAULT_TOKEN_OPTIONS.length),
      count: parsePositiveInteger(countText, DEFAULT_TOKEN_OPTIONS.count),
      prefix,
      groupSize,
    }),
    [format, customCharset, lengthText, countText, prefix, groupSize],
  );

  /**
   * The only random source in this tool: the browser's CSPRNG. `Math.random`
   * would be shorter to write and is exactly what must not be used here — it is
   * a predictable PRNG whose internal state can be recovered from its output.
   */
  const source = useCallback<RandomSource>(
    (count: number) => crypto.getRandomValues(new Uint8Array(count)),
    [],
  );

  const generate = useCallback(() => {
    try {
      const result = generateTokens(options, source);
      if (!result.ok) {
        setError(result.error);
        setBatch(null);
        return;
      }
      setError(null);
      setBatch(result.batch);
      setCopied(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '生成失败');
      setBatch(null);
    }
  }, [options, source]);

  // Regenerate whenever a setting changes: unlike a password, a token nobody
  // has used yet costs nothing to replace, and seeing the new length
  // immediately is the whole point of the controls.
  useEffect(() => {
    generate();
  }, [generate]);

  const copyTokens = useCallback(async () => {
    if (!batch) return;
    try {
      // The ungrouped values: the spaces are a reading aid on screen and would
      // be part of the token if they were copied.
      await navigator.clipboard.writeText(batch.rawText);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; leaving the button unflipped is the
      // honest outcome rather than claiming a copy that did not happen.
      setCopied(false);
    }
  }, [batch]);

  const exportTokens = useCallback(() => {
    if (!batch) return;
    const blob = new Blob([`${batch.rawText}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tokens-${batch.format}-${options.length}-${batch.tokens.length}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [batch, options.length]);

  const collision = batch ? collisionText(batch) : null;
  const customAlphabetOnly = format === 'custom';
  const selectedFormat = TOKEN_FORMATS.find((entry) => entry.id === format) ?? TOKEN_FORMATS[0];

  return (
    <div className={styles.stack}>
      <section className="wt-surface" aria-label="生成设置">
        <div className="wt-surface__header">
          <TagRegular />
          <Text as="h2" size={300} weight="semibold">
            生成设置
          </Text>
        </div>
        <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
          <div className={styles.column}>
            <div className={styles.row}>
              <div className={styles.field}>
                <Caption1 className={styles.muted}>输出格式</Caption1>
                <Dropdown
                  style={{ minWidth: 190 }}
                  value={selectedFormat.label}
                  selectedOptions={[format]}
                  onOptionSelect={(_, data) => setFormat(data.optionValue as TokenFormat)}
                  aria-label="输出格式"
                >
                  {TOKEN_FORMATS.map((entry) => (
                    <Option key={entry.id} value={entry.id} text={entry.label}>
                      {entry.label}
                    </Option>
                  ))}
                </Dropdown>
              </div>

              <div className={styles.field}>
                <Caption1 className={styles.muted}>长度（字符）</Caption1>
                <input
                  className={`wt-inline-input ${styles.numberInput}`}
                  type="number"
                  min={1}
                  max={MAX_TOKEN_LENGTH}
                  value={lengthText}
                  onChange={(event) => setLengthText(event.target.value.slice(0, 6))}
                  aria-label="长度（字符）"
                />
              </div>

              <div className={styles.field}>
                <Caption1 className={styles.muted}>数量</Caption1>
                <input
                  className={`wt-inline-input ${styles.numberInput}`}
                  type="number"
                  min={1}
                  max={MAX_TOKEN_COUNT}
                  value={countText}
                  onChange={(event) => setCountText(event.target.value.slice(0, 5))}
                  aria-label="数量"
                />
              </div>

              <div className={styles.field}>
                <Caption1 className={styles.muted}>分组显示</Caption1>
                <Dropdown
                  style={{ minWidth: 130 }}
                  value={groupSize === 0 ? '不分组' : `每 ${groupSize} 位`}
                  selectedOptions={[String(groupSize)]}
                  onOptionSelect={(_, data) => setGroupSize(Number(data.optionValue))}
                  aria-label="分组显示"
                >
                  {GROUP_SIZES.map((size) => (
                    <Option key={size} value={String(size)} text={size === 0 ? '不分组' : `每 ${size} 位`}>
                      {size === 0 ? '不分组' : `每 ${size} 位`}
                    </Option>
                  ))}
                </Dropdown>
              </div>
            </div>

            <div className={styles.row}>
              <div className={styles.field} style={{ flex: '1 1 220px' }}>
                <Caption1 className={styles.muted}>前缀（可选，不增加熵）</Caption1>
                <input
                  className="wt-inline-input"
                  value={prefix}
                  onChange={(event) => setPrefix(event.target.value.slice(0, 64))}
                  placeholder="例如 sk_ 或 ghp_"
                  aria-label="前缀"
                  spellCheck={false}
                />
              </div>
            </div>

            {customAlphabetOnly ? (
              <div className={styles.field}>
                <Caption1 className={styles.muted}>
                  自定义字符集（去重后使用，空白字符会被忽略）
                </Caption1>
                <input
                  className="wt-inline-input"
                  value={customCharset}
                  onChange={(event) => setCustomCharset(event.target.value.slice(0, 600))}
                  aria-label="自定义字符集"
                  spellCheck={false}
                />
              </div>
            ) : null}

            <Caption1 className={styles.muted}>{selectedFormat.note}</Caption1>

            <div className={styles.row}>
              <Button
                appearance="primary"
                icon={<ArrowClockwiseRegular />}
                onClick={generate}
                disabled={Boolean(error)}
              >
                重新生成
              </Button>
              <Caption1 className={styles.muted}>
                改动任意设置都会立即重新生成；没有任何一条被保存到服务器或本地存储。
              </Caption1>
            </div>

            {error ? (
              <MessageBar intent="error">
                <MessageBarBody>
                  <MessageBarTitle>设置不合法</MessageBarTitle>
                  {error}
                </MessageBarBody>
              </MessageBar>
            ) : null}
          </div>
        </div>
      </section>

      {batch && batch.tokens.length > 0 ? (
        <section className="wt-surface" aria-label="生成结果">
          <div className="wt-surface__header">
            <Text as="h2" size={300} weight="semibold">
              生成结果
            </Text>
            <span className={styles.spacer} />
            <Button appearance="subtle" icon={<CopyRegular />} onClick={copyTokens}>
              {copied ? '已复制（不含空格）' : '复制全部'}
            </Button>
            <Button appearance="subtle" icon={<ArrowDownloadRegular />} onClick={exportTokens}>
              导出 txt
            </Button>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.column}>
              <div className={styles.metricGrid}>
                <Metric
                  label="每个 token 的熵"
                  value={`${batch.bitsPerToken.toFixed(1)} 位`}
                  hint={`${options.length} 个字符 × log2(${batch.alphabetSize})`}
                />
                <Metric
                  label="等效随机字节数"
                  value={`${batch.equivalentBytes.toFixed(1)} 字节`}
                  hint="与直接用 crypto 取这么多随机字节等价"
                />
                <Metric
                  label="字符集"
                  value={`${batch.alphabetSize} 个字符`}
                  hint={`每字符 ${batch.bitsPerChar.toFixed(2)} 位`}
                />
                <Metric
                  label={`整批总熵（${batch.tokens.length} 条）`}
                  value={`${batch.totalBits.toFixed(0)} 位`}
                  hint="各条相互独立，总熵按条数累加"
                />
                <Metric
                  label="本批出现重复的概率"
                  value={collision ? collision.text : '—'}
                  hint="生日界估计；熵足够时重复概率可以忽略"
                />
              </div>

              {collision?.warn ? (
                <MessageBar intent="warning">
                  <MessageBarBody>
                    这批 token 太短或数量太多，出现重复的概率不可忽略。请加长长度、减少数量，或换用信息密度更高的格式。
                  </MessageBarBody>
                </MessageBar>
              ) : null}

              <textarea
                className="wt-code-area"
                style={{ minHeight: 220 }}
                readOnly
                value={batch.displayText}
                aria-label="生成的 token"
                spellCheck={false}
                onFocus={(event) => event.currentTarget.select()}
              />
              <Caption1 className={styles.muted}>
                {batch.groupSize === 0
                  ? '当前未分组显示；'
                  : `显示时每 ${batch.groupSize} 位插入一个空格，只是为了便于抄写；`}
                “复制全部”和“导出 txt”给出的都是不含空格的原值。
                {batch.prefix ? ` 前缀 ${batch.prefix} 是固定的，不计入熵。` : ''}
              </Caption1>
            </div>
          </div>
        </section>
      ) : null}

      <section className="wt-surface" aria-label="随机源与边界">
        <div className="wt-surface__header">
          <LockClosedRegular />
          <Text as="h2" size={300} weight="semibold">
            随机源与这个工具不做什么
          </Text>
        </div>
        <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
          <div className={styles.column}>
            <Text size={200}>
              <b>随机源是 crypto.getRandomValues，不是 Math.random。</b>
              Math.random 是一个为速度设计的伪随机数发生器，内部状态很小：它的输出看起来随机，也能通过一般的统计检验，
              但整串输出是完全由那个状态决定的确定性序列，而状态可以从少量输出反推出来。可被预测的 token 不是秘密，
              无论它看起来多随机。crypto.getRandomValues 由操作系统提供熵，是浏览器里唯一的密码学安全随机源。
            </Text>
            <Text size={200}>
              每个字符都是独立从字符集里均匀抽取的（自定义字符集用拒绝采样消除取模偏差），
              因此熵就是 <span className={styles.mono}>长度 × log2(字符集大小)</span>，不需要额外假设。
            </Text>
            <div className={styles.row}>
              <Badge appearance="tint" color="informative">
                不生成 JWT
              </Badge>
              <Caption1 className={styles.muted}>
                JWT 需要签名（HS256/RS256），密钥、头部与载荷的编码都有格式要求，那是签名工具的事；
                本工具只产出随机字符串。
              </Caption1>
            </div>
            <div className={styles.row}>
              <Badge appearance="tint" color="informative">
                不保存历史
              </Badge>
              <Caption1 className={styles.muted}>
                没有服务器、没有请求、没有 localStorage：关掉页面这些 token 就只剩下你已经复制走的那份。
                也正因为如此，刷新页面后旧 token 找不回来——请先复制或导出再刷新。
              </Caption1>
            </div>
            <div className={styles.row}>
              <InfoRegular />
              <Caption1 className={styles.muted}>
                熵高不等于 token 一定安全：把它交给别人、贴进聊天记录、写进前端代码或提交到仓库，
                都会让强度归零。生成之后请当作密码一样保管。
              </Caption1>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
