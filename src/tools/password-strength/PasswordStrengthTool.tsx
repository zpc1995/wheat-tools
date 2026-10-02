import {
  Badge,
  Button,
  Caption1,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  DismissRegular,
  EyeOffRegular,
  EyeRegular,
  InfoRegular,
  ShieldRegular,
  WarningRegular,
} from '@fluentui/react-icons';
import { useMemo, useState } from 'react';
import {
  CHAR_CLASS_LABELS,
  MAX_ANALYSIS_LENGTH,
  analysePassword,
  type CharClass,
  type PasswordAnalysis,
  type Verdict,
} from './passwordStrengthUtils';

/** Characters shown in the per-character table before it is truncated. */
const MAX_BREAKDOWN_ROWS = 64;

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '14px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  spacer: {
    flex: '1 1 auto',
  },
  verdictRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '12px',
    flexWrap: 'wrap',
  },
  bigNumber: {
    fontFamily: 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace',
    fontVariantNumeric: 'tabular-nums',
    fontSize: '30px',
    fontWeight: 600,
    lineHeight: 1.1,
  },
  mono: {
    fontFamily: 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace',
    fontVariantNumeric: 'tabular-nums',
  },
  bar: {
    width: '100%',
    height: '10px',
    borderRadius: '5px',
    backgroundColor: tokens.colorNeutralBackground4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: '5px',
    transitionProperty: 'width',
    transitionDuration: '160ms',
  },
  muted: {
    color: tokens.colorNeutralForeground3,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  headCell: {
    textAlign: 'left',
    padding: '8px 10px',
    color: tokens.colorNeutralForeground3,
    fontWeight: 600,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    whiteSpace: 'nowrap',
  },
  cell: {
    padding: '6px 10px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    verticalAlign: 'top',
  },
  scroll: {
    maxHeight: '340px',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  metricGrid: {
    display: 'grid',
    gap: '10px',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
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
  finding: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '10px 12px',
    borderRadius: '8px',
    borderLeft: `3px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  findingHigh: {
    borderLeftColor: tokens.colorPaletteRedBorder2,
  },
  findingMedium: {
    borderLeftColor: tokens.colorPaletteDarkOrangeBorder2,
  },
  findingLow: {
    borderLeftColor: tokens.colorPaletteYellowBorder2,
  },
  findingInfo: {
    borderLeftColor: tokens.colorNeutralStroke2,
  },
  suggestion: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '10px 12px',
    borderRadius: '8px',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  recommended: {
    border: `1px solid ${tokens.colorBrandStroke1}`,
    backgroundColor: tokens.colorBrandBackground2,
  },
  charChip: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '26px',
    height: '26px',
    padding: '0 6px',
    borderRadius: '6px',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    backgroundColor: tokens.colorNeutralBackground2,
    fontFamily: 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace',
  },
});

/** Percentage of the way from "no entropy" to the 100-bit comfort line. */
function strengthPercent(bits: number): number {
  return Math.max(0, Math.min(100, (bits / 100) * 100));
}

function toneColor(tone: Verdict['tone']): string {
  if (tone === 'danger') return tokens.colorPaletteRedBackground3;
  if (tone === 'warning') return tokens.colorPaletteDarkOrangeBackground3;
  if (tone === 'success') return tokens.colorPaletteGreenBackground3;
  return tokens.colorBrandBackground;
}

function badgeColor(severity: string): 'danger' | 'warning' | 'informative' {
  if (severity === 'high') return 'danger';
  if (severity === 'medium') return 'warning';
  return 'informative';
}

const SEVERITY_LABELS: Record<string, string> = {
  high: '高风险',
  medium: '中风险',
  low: '低风险',
  info: '说明',
};

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const styles = useStyles();
  return (
    <div className={styles.metric}>
      <Caption1 className={styles.muted}>{label}</Caption1>
      <Text className={styles.bigNumber} size={400}>
        {value}
      </Text>
      {hint ? <Caption1 className={styles.muted}>{hint}</Caption1> : null}
    </div>
  );
}

function CrackTimeTable({ analysis }: { analysis: PasswordAnalysis }) {
  const styles = useStyles();
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.headCell}>攻击场景</th>
            <th className={styles.headCell}>预计平均耗时</th>
            <th className={styles.headCell}>说明</th>
          </tr>
        </thead>
        <tbody>
          {analysis.crackTimes.map((estimate) => (
            <tr key={estimate.id}>
              <td className={styles.cell}>{estimate.label}</td>
              <td className={`${styles.cell} ${styles.mono}`}>{estimate.human}</td>
              <td className={`${styles.cell} ${styles.muted}`}>
                <Caption1>{estimate.note}</Caption1>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompositionTable({ analysis }: { analysis: PasswordAnalysis }) {
  const styles = useStyles();
  const entries = (Object.keys(analysis.composition.counts) as CharClass[]).map((key) => ({
    key,
    label: CHAR_CLASS_LABELS[key],
    count: analysis.composition.counts[key],
    pool: analysis.composition.poolByClass[key],
  }));

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th className={styles.headCell}>字符类型</th>
          <th className={styles.headCell}>在密码中出现</th>
          <th className={styles.headCell}>为字符集贡献</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.key}>
            <td className={styles.cell}>{entry.label}</td>
            <td className={`${styles.cell} ${styles.mono}`}>
              {entry.count > 0 ? `${entry.count} 个` : '未使用'}
            </td>
            <td className={`${styles.cell} ${styles.mono} ${styles.muted}`}>
              {entry.pool > 0 ? `+${entry.pool}` : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PasswordStrengthTool() {
  const styles = useStyles();
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [contextText, setContextText] = useState('');

  const contextWords = useMemo(
    () =>
      contextText
        .split(/[\s,，、;；|/]+/)
        .map((word) => word.trim())
        .filter((word) => word.length > 0),
    [contextText],
  );

  const analysis = useMemo(
    () => analysePassword(password, { contextWords }),
    [password, contextWords],
  );

  const percent = strengthPercent(analysis.effectiveBits);
  const breakdownRows = analysis.breakdown.slice(0, MAX_BREAKDOWN_ROWS);

  return (
    <div className={styles.stack}>
      <section className="wt-surface" aria-label="输入">
        <div className="wt-surface__header">
          <ShieldRegular />
          <Text as="h2" size={300} weight="semibold">
            输入要分析的密码
          </Text>
        </div>
        <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
          <div className={styles.column}>
            <div className={styles.row}>
              <input
                className="wt-inline-input"
                style={{ fontSize: 15 }}
                type={visible ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value.slice(0, MAX_ANALYSIS_LENGTH))}
                placeholder="在这里输入或粘贴密码"
                aria-label="要分析的密码"
                // The password must not be captured by the browser's form
                // history or offered to a password manager: this page is a
                // scratch pad, not a login form, and nothing here should ever
                // come back later.
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                name="password-strength-scratch"
                data-1p-ignore="true"
                data-lpignore="true"
              />
              <Button
                appearance="subtle"
                icon={visible ? <EyeOffRegular /> : <EyeRegular />}
                onClick={() => setVisible((current) => !current)}
                aria-label={visible ? '隐藏密码' : '显示密码'}
              >
                {visible ? '隐藏' : '显示'}
              </Button>
              <Button
                appearance="subtle"
                icon={<DismissRegular />}
                onClick={() => setPassword('')}
                disabled={password.length === 0}
              >
                清空
              </Button>
            </div>

            <Text size={200} weight="semibold">
              上下文词（可选）
            </Text>
            <Textarea
              className="wt-code-area"
              style={{ minHeight: '84px' }}
              value={contextText}
              onChange={(_, data) => setContextText(data.value.slice(0, 400))}
              placeholder="网站名、用户名、邮箱前缀、家人名字……用空格或逗号分隔"
              aria-label="上下文词"
            />
            <Caption1 className={styles.muted}>
              这些词会被当作攻击者已知的信息（网站名和用户名本来就是公开的），
              密码里出现它们几乎不贡献强度。词只参与本次计算，不会离开这个页面。
            </Caption1>
          </div>
        </div>
      </section>

      {password.length === 0 ? (
        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>还没有输入</MessageBarTitle>
            键入密码后这里会显示两类熵：按字符集估算的上界，以及按模式分解得到的有效熵。
          </MessageBarBody>
        </MessageBar>
      ) : (
        <>
          <section className="wt-surface" aria-label="强度结论">
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                强度结论
              </Text>
              <span className={styles.spacer} />
              <Badge
                appearance="filled"
                color={
                  analysis.verdict.tone === 'danger'
                    ? 'danger'
                    : analysis.verdict.tone === 'warning'
                      ? 'warning'
                      : 'success'
                }
                size="large"
              >
                {analysis.verdict.label}
              </Badge>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.column}>
                <div className={styles.verdictRow}>
                  <Text className={styles.bigNumber}>有效熵 {analysis.effectiveBits.toFixed(1)} 位</Text>
                  <Caption1 className={styles.muted}>{analysis.verdict.summary}</Caption1>
                </div>

                <div className={styles.bar} role="img" aria-label={`有效熵 ${analysis.effectiveBits.toFixed(1)} 位，参考线 100 位`}>
                  <div
                    className={styles.barFill}
                    style={{ width: `${percent}%`, backgroundColor: toneColor(analysis.verdict.tone) }}
                  />
                </div>
                <Caption1 className={styles.muted}>
                  进度条以 100 位为满格（常见的“足够强”参考线是 80 位）。
                </Caption1>

                <div className={styles.metricGrid}>
                  <Metric
                    label="按字符集估算（上界）"
                    value={`${analysis.charsetBits.toFixed(1)} 位`}
                    hint={`${analysis.length} 个字符 × log2(${analysis.composition.poolSize})，假设每位都均匀随机`}
                  />
                  <Metric
                    label="按模式分析（有效熵）"
                    value={`${analysis.effectiveBits.toFixed(1)} 位`}
                    hint={`最省力的拆解方式：${analysis.segments
                      .map((segment) => segment.label)
                      .join(' + ')}`}
                  />
                  <Metric
                    label="字符集公式高估了"
                    value={`${Math.max(analysis.charsetBits - analysis.effectiveBits, 0).toFixed(1)} 位`}
                    hint="差值越大，说明这个密码越“看起来复杂”"
                  />
                  {analysis.utf16Length !== analysis.length ? (
                    <Metric
                      label="人类可读长度"
                      value={`${analysis.length} 个字符`}
                      hint={`UTF-16 编码下占 ${analysis.utf16Length} 个码元（Emoji 等需要两个）`}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          <section className="wt-surface" aria-label="破解时间">
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                破解时间（数量级估计）
              </Text>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.column}>
                <CrackTimeTable analysis={analysis} />
                <MessageBar intent="warning">
                  <MessageBarBody>
                    <MessageBarTitle>这些是数量级估计，不是精确预测</MessageBarTitle>
                    计算方式：平均尝试半个搜索空间，即 2^(有效熵 − 1) 次，再除以场景的每秒尝试次数。
                    真实攻击者会先跑字典、再变形、再按泄露库排序，硬件速度也会相差一个数量级；
                    这里的数字用来比较“毫无希望”和“几秒钟”，不能用来推断某一个具体账号会不会被攻破。
                  </MessageBarBody>
                </MessageBar>
              </div>
            </div>
          </section>

          <section className="wt-surface" aria-label="识别到的弱模式">
            <div className="wt-surface__header">
              <WarningRegular />
              <Text as="h2" size={300} weight="semibold">
                识别到的弱模式
              </Text>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.column}>
                {analysis.findings.map((finding) => (
                  <div
                    key={finding.id}
                    className={`${styles.finding} ${
                      finding.severity === 'high'
                        ? styles.findingHigh
                        : finding.severity === 'medium'
                          ? styles.findingMedium
                          : finding.severity === 'low'
                            ? styles.findingLow
                            : styles.findingInfo
                    }`}
                  >
                    <div className={styles.row}>
                      <Badge appearance="tint" size="small" color={badgeColor(finding.severity)}>
                        {SEVERITY_LABELS[finding.severity]}
                      </Badge>
                      <Text weight="semibold">{finding.title}</Text>
                    </div>
                    <Text size={200}>{finding.detail}</Text>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="wt-surface" aria-label="片段分解">
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                片段分解
              </Text>
              <span className={styles.spacer} />
              <Caption1 className={styles.muted}>攻击者最省力的拆解方式</Caption1>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.column}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.headCell}>片段</th>
                      <th className={styles.headCell}>类型</th>
                      <th className={styles.headCell}>该片段熵</th>
                      <th className={styles.headCell}>为什么这么算</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.segments.map((segment) => (
                      <tr key={`${segment.start}-${segment.kind}`}>
                        <td className={`${styles.cell} ${styles.mono}`}>{segment.text}</td>
                        <td className={styles.cell}>{segment.label}</td>
                        <td className={`${styles.cell} ${styles.mono}`}>
                          {segment.bits.toFixed(1)} 位
                        </td>
                        <td className={`${styles.cell} ${styles.muted}`}>
                          <Caption1>{segment.detail}</Caption1>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="wt-surface" aria-label="改进建议">
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                改进建议（按熵收益排序）
              </Text>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.column}>
                {analysis.suggestions.map((suggestion) => (
                  <div
                    key={suggestion.id}
                    className={`${styles.suggestion} ${suggestion.recommended ? styles.recommended : ''}`}
                  >
                    <div className={styles.row}>
                      {suggestion.recommended ? (
                        <Badge appearance="tint" size="small" color="brand">
                          收益最大
                        </Badge>
                      ) : null}
                      <Text weight="semibold">{suggestion.title}</Text>
                      <span className={styles.spacer} />
                      {suggestion.gainBits > 0 ? (
                        <Text className={styles.mono} size={200}>
                          +{suggestion.gainBits.toFixed(1)} 位
                        </Text>
                      ) : (
                        <Caption1 className={styles.muted}>不计入熵值</Caption1>
                      )}
                    </div>
                    <Text size={200}>{suggestion.detail}</Text>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="wt-surface" aria-label="字符集构成">
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                字符集构成
              </Text>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.column}>
                <div className={styles.metricGrid}>
                  <Metric label="字符集大小" value={`${analysis.composition.poolSize}`} hint="用于计算上界" />
                  <Metric label="不重复字符" value={`${analysis.composition.distinctChars}`} hint={`共 ${analysis.length} 个字符`} />
                  <Metric label="字符类型" value={`${analysis.composition.classes.length}`} hint="大小写、数字、符号、空格、Unicode" />
                </div>
                <CompositionTable analysis={analysis} />
                {analysis.composition.unicodeBlocks.length > 0 ? (
                  <Caption1 className={styles.muted}>
                    识别到的 Unicode 区块：{analysis.composition.unicodeBlocks.join('、')}
                  </Caption1>
                ) : null}
              </div>
            </div>
          </section>

          <section className="wt-surface" aria-label="逐字符分析">
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                逐字符分析
              </Text>
              <span className={styles.spacer} />
              <Caption1 className={styles.muted}>
                {analysis.length > MAX_BREAKDOWN_ROWS
                  ? `只显示前 ${MAX_BREAKDOWN_ROWS} 个字符`
                  : `共 ${analysis.length} 个字符`}
              </Caption1>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.column}>
                <div className={styles.row}>
                  {breakdownRows.map((row) => (
                    <span
                      key={row.index}
                      className={styles.charChip}
                      title={`第 ${row.index} 位 ${row.codePoint} ${row.classLabel} · ${row.segmentLabel}`}
                    >
                      {row.char}
                    </span>
                  ))}
                </div>
                <div className={styles.scroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.headCell}>#</th>
                        <th className={styles.headCell}>字符</th>
                        <th className={styles.headCell}>码位</th>
                        <th className={styles.headCell}>类型</th>
                        <th className={styles.headCell}>归属片段</th>
                      </tr>
                    </thead>
                    <tbody>
                      {breakdownRows.map((row) => (
                        <tr key={row.index}>
                          <td className={`${styles.cell} ${styles.mono}`}>{row.index}</td>
                          <td className={`${styles.cell} ${styles.mono}`}>{row.char}</td>
                          <td className={`${styles.cell} ${styles.mono}`}>{row.codePoint}</td>
                          <td className={styles.cell}>{row.classLabel}</td>
                          <td className={styles.cell}>{row.segmentLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      <MessageBar intent="warning">
        <MessageBarBody>
          <MessageBarTitle>关于“在这里输入真实密码”这件事</MessageBarTitle>
          本工具不联网、不上传、不写本地存储、不把密码放进地址栏，代码里的模式分析全部在浏览器内存里完成。
          但即便这样，<strong>养成在第三方页面输入真实密码的习惯本身就是危险的</strong>：
          你无法验证一个页面的代码与其声称的一样（今天一样不代表你下次打开时一样），
          浏览器扩展、输入法、剪贴板同步、录屏软件也都在这条链路上。
          要检查自己的密码，最稳妥的做法是输入一个<strong>结构相似但并非真实密码</strong>的样本，
          或者只在你能确认来源的本地环境中检查。
          本工具也<b>不做</b>“密码库比对”（没有网络），因此“没有报弱口令”不代表它不在某个泄露库里。
        </MessageBarBody>
      </MessageBar>

      <section className="wt-surface" aria-label="计算说明">
        <div className="wt-surface__header">
          <InfoRegular />
          <Text as="h2" size={300} weight="semibold">
            这个数字是怎么来的
          </Text>
        </div>
        <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
          <div className={styles.column}>
            <Text size={200}>
              1. <b>字符集熵</b>是 length × log2(字符集大小)，只对“每一位都均匀随机”的密码成立，是上界。
            </Text>
            <Text size={200}>
              2. <b>模式分析</b>把密码拆成最省力的片段组合：常见弱口令（内置 1000 条公开榜单条目，按榜单排名计熵）、
              常见单词（按 2048 词规模计）、键盘走位、字符序列、重复片段、日期与年份、
              以及你自己提供的上下文词；没有被任何模式解释的字符按字符集穷举计价。
            </Text>
            <Text size={200}>
              3. <b>有效熵</b>取两者中较小的那个。模式分析只会让估计变低，不会变高，
              所以“看起来复杂”的密码会在这里被扣回它真实的强度。
            </Text>
            <Caption1 className={styles.muted}>
              已知的局限：内置词表只有几百个常见英文词，不在词表里的单词会按穷举计价（偏高）；
              每位未解释的字符都按完整字符集计价（偏低）；形近替换统一按 log2(3) 计。
              这些都是估计，不是测量值。
            </Caption1>
          </div>
        </div>
      </section>
    </div>
  );
}
