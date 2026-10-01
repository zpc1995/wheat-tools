import {
  Button,
  Caption1,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { CopyRegular, EraserRegular } from '@fluentui/react-icons';
import { useCallback, useMemo, useState } from 'react';
import {
  IBAN_EXAMPLES,
  analyzeIban,
  listIbanCountries,
  type IbanAnalysis,
  type IbanIssue,
} from './ibanUtils';

const useStyles = makeStyles({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    width: '100%',
    padding: '18px 20px 24px',
    minWidth: 0,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    minWidth: 0,
  },
  inputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  ibanInput: {
    flex: '1 1 320px',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  exampleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap',
  },
  exampleHint: {
    color: tokens.colorNeutralForeground3,
    marginRight: '2px',
  },
  issueList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  facts: {
    display: 'grid',
    gridTemplateColumns: 'minmax(96px, max-content) minmax(0, 1fr)',
    rowGap: '6px',
    columnGap: '16px',
    alignItems: 'baseline',
  },
  factLabel: {
    color: tokens.colorNeutralForeground3,
  },
  mono: {
    fontFamily: 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace',
    fontVariantNumeric: 'tabular-nums',
    wordBreak: 'break-all',
  },
  // Groups of four are separated by spaces, so the value must not wrap in the
  // middle of a group; the container scrolls horizontally instead.
  monoNowrap: {
    fontFamily: 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  monoCell: {
    fontFamily: 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  scrollX: {
    overflowX: 'auto',
    minWidth: 0,
  },
  scrollY: {
    maxHeight: '300px',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  headCell: {
    textAlign: 'left',
    padding: '6px 10px',
    color: tokens.colorNeutralForeground3,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  cell: {
    padding: '5px 10px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    whiteSpace: 'nowrap',
  },
  currentRow: {
    backgroundColor: tokens.colorNeutralBackground3,
    fontWeight: 600,
  },
  filterInput: {
    maxWidth: '280px',
  },
  muted: {
    color: tokens.colorNeutralForeground3,
  },
  bullets: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    margin: 0,
    paddingLeft: '20px',
  },
});

/** Turns one structured issue into the sentence shown to the user. */
function issueText(analysis: IbanAnalysis, issue: IbanIssue): string {
  const { countryCode, countryName, actualLength, expectedLength, checkDigits } = analysis;
  switch (issue) {
    case 'empty':
      return '还没有输入内容。';
    case 'invalidCharacters':
      return `含非法字符「${analysis.invalidCharacters.join(' ')}」：IBAN 只允许 A–Z 和 0–9，可以带空格或连字符。`;
    case 'tooShort':
      return '长度不足：IBAN 至少需要 4 个字符（两位国家代码加两位校验位）。';
    case 'tooLong':
      return `长度超出上限：IBAN 最长 34 位，当前 ${actualLength} 位。`;
    case 'unknownCountry':
      return `前两位「${countryCode}」不是有效的 ISO 3166-1 国家或地区代码。`;
    case 'notIbanCountry':
      return `${countryCode}${countryName ? `（${countryName}）` : ''}不在 SWIFT IBAN 注册表中，因此没有可核对的国家长度规则。`;
    case 'wrongLength':
      return `长度错误：当前 ${actualLength} 位，${countryName || countryCode}（${countryCode}）的 IBAN 应为 ${expectedLength} 位。`;
    case 'checkDigitsNotNumeric':
      return `第 3–4 位必须是数字校验位，当前是「${checkDigits}」。`;
    case 'badCheckDigits':
      return `校验位错误：mod-97 余数为 ${analysis.remainder}，应为 1。按当前国家代码与 BBAN 重算，正确的校验位是「${analysis.expectedCheckDigits}」。`;
    default:
      return issue;
  }
}

function verdictTitle(analysis: IbanAnalysis): string {
  if (analysis.status === 'valid') {
    return `校验通过：${analysis.countryName}（${analysis.countryCode}），${analysis.actualLength} 位`;
  }
  if (analysis.status === 'checksum-only') {
    return '校验位正确，但这个国家不在 IBAN 注册表里';
  }
  return '校验未通过';
}

export function IbanValidatorTool() {
  const styles = useStyles();
  const [input, setInput] = useState('');
  const [filter, setFilter] = useState('');
  const [copied, setCopied] = useState(false);

  // All of the work happens in one pure call, so the component never has to
  // keep two sources of truth in sync.
  const analysis = useMemo(() => analyzeIban(input), [input]);
  const countries = useMemo(() => listIbanCountries(), []);
  const shownCountries = useMemo(() => {
    const query = filter.trim();
    if (!query) return countries;
    const upper = query.toUpperCase();
    return countries.filter(
      (country) => country.code.includes(upper) || country.name.includes(query),
    );
  }, [countries, filter]);

  const copyFormatted = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(analysis.formatted);
      setCopied(true);
    } catch {
      // A denied clipboard leaves the button unflipped rather than claiming a
      // copy that did not happen.
      setCopied(false);
    }
  }, [analysis.formatted]);

  const hasInput = analysis.normalized.length > 0;
  const intent =
    analysis.status === 'valid' ? 'success' : analysis.status === 'checksum-only' ? 'warning' : 'error';
  // Before anything is typed there is nothing to complain about: an error bar
  // saying "校验未通过" on first paint reads as if the empty box were wrong.
  const untouched = analysis.issues.length === 1 && analysis.issues[0] === 'empty';

  return (
    <div className="wt-surface">
      {/* `wt-surface__body` is a flex row by default, so the direction has to be
          set explicitly or every section below lays out side by side. */}
      <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
        <div className={styles.page}>
          <section className={styles.section}>
            <Text as="h2" size={300} weight="semibold">
              校验
            </Text>
            <div className={styles.inputRow}>
              <input
                className={`wt-inline-input ${styles.ibanInput}`}
                aria-label="IBAN 号码"
                placeholder="DE89 3704 0044 0532 0130 00"
                spellCheck={false}
                autoComplete="off"
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  setCopied(false);
                }}
              />
              <Caption1 className={styles.muted}>
                {hasInput ? `${analysis.actualLength} 位` : '支持空格与连字符'}
              </Caption1>
              <Button
                appearance="subtle"
                size="small"
                icon={<EraserRegular />}
                onClick={() => {
                  setInput('');
                  setCopied(false);
                }}
                disabled={input.length === 0}
              >
                清空
              </Button>
            </div>

            <div className={styles.exampleRow}>
              <Caption1 className={styles.exampleHint}>官方示例：</Caption1>
              {IBAN_EXAMPLES.map((example) => (
                <Button
                  key={example.iban}
                  size="small"
                  appearance="outline"
                  onClick={() => {
                    setInput(example.iban);
                    setCopied(false);
                  }}
                >
                  {example.note}
                </Button>
              ))}
            </div>

            {untouched ? (
              <MessageBar intent="info">
                <MessageBarBody>
                  <MessageBarTitle>等待输入</MessageBarTitle>
                  输入或粘贴一个 IBAN。大小写随便，空格和连字符会自动去掉；也可以点上面的官方示例。
                </MessageBarBody>
              </MessageBar>
            ) : (
              <MessageBar intent={intent}>
                <MessageBarBody>
                  <MessageBarTitle>{verdictTitle(analysis)}</MessageBarTitle>
                  {analysis.issues.length === 0 ? (
                    <span>校验位正确（mod-97 余数 = 1），长度也符合该国规则。</span>
                  ) : (
                    <div className={styles.issueList}>
                      {analysis.issues.map((issue) => (
                        <span key={issue}>{issueText(analysis, issue)}</span>
                      ))}
                    </div>
                  )}
                </MessageBarBody>
              </MessageBar>
            )}

            {analysis.hadSeparators && hasInput && (
              <Caption1 className={styles.muted}>
                已自动去掉空格与连字符，规范化结果：{analysis.normalized || '（空）'}
              </Caption1>
            )}
          </section>

          <Divider />

          <section className={styles.section}>
            <Text as="h2" size={300} weight="semibold">
              解析结果
            </Text>
            {!hasInput ? (
              <Caption1 className={styles.muted}>输入或粘贴一个 IBAN 后显示解析结果。</Caption1>
            ) : (
              <div className={styles.facts}>
                <span className={styles.factLabel}>国家 / 地区</span>
                <span>
                  {analysis.countryName
                    ? `${analysis.countryName}（${analysis.countryCode}）`
                    : analysis.countryCode || '—'}
                  {analysis.country === null && analysis.countryName !== '' && ' · 不在 IBAN 注册表'}
                </span>

                <span className={styles.factLabel}>校验位</span>
                <span className={styles.mono}>
                  {analysis.checkDigits || '—'}
                  {analysis.expectedCheckDigits &&
                    analysis.checkDigits !== analysis.expectedCheckDigits &&
                    ` · 重算应为 ${analysis.expectedCheckDigits}`}
                </span>

                <span className={styles.factLabel}>BBAN</span>
                <span className={styles.mono}>{analysis.bban || '—'}</span>

                <span className={styles.factLabel}>长度</span>
                <span>
                  {analysis.actualLength} 位
                  {analysis.expectedLength !== null
                    ? analysis.actualLength === analysis.expectedLength
                      ? `（符合 ${analysis.countryCode} 的规则）`
                      : `（${analysis.countryCode} 应为 ${analysis.expectedLength} 位）`
                    : '（该国未收录，无长度规则可对照）'}
                </span>

                <span className={styles.factLabel}>mod-97</span>
                <span className={styles.mono}>
                  {analysis.remainder < 0
                    ? '—'
                    : `余数 ${analysis.remainder}${analysis.checksumOk ? ' · 通过' : ' · 未通过'}`}
                </span>

                <span className={styles.factLabel}>格式化</span>
                <span className={styles.scrollX}>
                  <span className={styles.monoNowrap}>
                    {analysis.formatted || '—'}
                  </span>{' '}
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<CopyRegular />}
                    onClick={copyFormatted}
                    disabled={!hasInput}
                  >
                    {copied ? '已复制' : '复制'}
                  </Button>
                </span>

                <span className={styles.factLabel}>规范化</span>
                <span className={styles.mono}>{analysis.normalized || '—'}</span>
              </div>
            )}
          </section>

          <Divider />

          <section className={styles.section}>
            <Text as="h2" size={300} weight="semibold">
              BBAN 拆分
            </Text>
            {analysis.bbanFields.length > 0 ? (
              <div className={styles.scrollX}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col" className={styles.headCell}>
                        字段
                      </th>
                      <th scope="col" className={styles.headCell}>
                        值
                      </th>
                      <th scope="col" className={styles.headCell}>
                        位置
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.bbanFields.map((field) => (
                      <tr key={`${field.label}-${field.start}`}>
                        <td className={styles.cell}>{field.label}</td>
                        <td className={`${styles.cell} ${styles.monoCell}`}>{field.value}</td>
                        <td className={`${styles.cell} ${styles.muted}`}>
                          BBAN 第 {field.start + 1}–{field.start + field.length} 位
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Caption1 className={styles.muted}>
                {hasInput
                  ? analysis.country
                    ? `BBAN 拆分要靠国家规则定位字段边界：${analysis.countryCode} 的 IBAN 应为 ${analysis.expectedLength} 位，当前 ${analysis.actualLength} 位，长度对了才会显示拆分。`
                    : '只有 SWIFT IBAN 注册表中的国家才有可对照的 BBAN 结构，未收录的国家不做拆分。'
                  : '输入 IBAN 后显示银行代码与账号的拆分。'}
              </Caption1>
            )}
          </section>

          <Divider />

          <section className={styles.section}>
            <Text as="h2" size={300} weight="semibold">
              各国 IBAN 长度
            </Text>
            <Caption1 className={styles.muted}>
              长度规则与 BBAN 结构来自 SWIFT IBAN 注册表（2024 年 12 月版），共 {countries.length}{' '}
              个国家或地区，全部给出了 BBAN 拆分。长度不对是最常见的错误，所以输入后会先核对这一项。
            </Caption1>
            <input
              className={`wt-inline-input ${styles.filterInput}`}
              aria-label="按国家代码或名称筛选"
              placeholder="筛选：DE 或 德国"
              spellCheck={false}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <div className={styles.scrollY}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col" className={styles.headCell}>
                      代码
                    </th>
                    <th scope="col" className={styles.headCell}>
                      国家 / 地区
                    </th>
                    <th scope="col" className={styles.headCell}>
                      长度
                    </th>
                    <th scope="col" className={styles.headCell}>
                      BBAN 拆分
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shownCountries.map((country) => (
                    <tr
                      key={country.code}
                      className={
                        analysis.country?.code === country.code ? styles.currentRow : undefined
                      }
                    >
                      <td className={`${styles.cell} ${styles.monoCell}`}>{country.code}</td>
                      <td className={styles.cell}>{country.name}</td>
                      <td className={`${styles.cell} ${styles.monoCell}`}>{country.length}</td>
                      <td className={`${styles.cell} ${styles.muted}`}>
                        {country.fields
                          ? country.fields.map((field) => `${field.label} ${field.length}`).join(' + ')
                          : '未收录'}
                      </td>
                    </tr>
                  ))}
                  {shownCountries.length === 0 && (
                    <tr>
                      <td className={styles.cell} colSpan={4}>
                        没有匹配的国家或地区。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <Divider />

          <section className={styles.section}>
            <Text as="h2" size={300} weight="semibold">
              它做什么，不做什么
            </Text>
            <ul className={styles.bullets}>
              <li>
                按 ISO 13616 做三件事：识别国家代码、核对该国的 IBAN 长度、验证 mod-97 校验位。
              </li>
              <li>
                BBAN 按 SWIFT IBAN 注册表公布的字段划分来拆（芬兰、冰岛、哥斯达黎加、塞舌尔这些国家的
                边界和“账号看起来从哪开始”并不一致，所以不靠猜）。
              </li>
              <li>
                <strong>不校验账号是否真实存在、是否已销户、属于谁</strong>
                ——那需要银行接口，静态页面做不到。校验通过只代表号码格式合法。
              </li>
              <li>
                摩洛哥、塞内加尔、阿尔及利亚等十来个国家也在使用 IBAN 式的号码，但没有登记进 SWIFT
                注册表，本工具会直接说「未收录」，而不是套用邻国的长度规则去猜。
              </li>
              <li>
                校验位错误时给出的“正确校验位”是按当前 BBAN 重算的；如果 BBAN 本身抄错了，
                它同样无法救回来。
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
