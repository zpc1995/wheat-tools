import {
  Badge,
  Button,
  Caption1,
  Divider,
  Dropdown,
  MessageBar,
  MessageBarBody,
  Option,
  Tab,
  TabList,
  Text,
  Toast,
  ToastTitle,
  Toaster,
  makeStyles,
  tokens,
  useId,
  useToastController,
} from '@fluentui/react-components';
import { Checkmark16Regular, Copy16Regular, PhoneRegular } from '@fluentui/react-icons';
import { useCallback, useMemo, useState } from 'react';
import { copyText } from '../json-formatter/jsonUtils';
import {
  COUNTRIES,
  NUMBER_TYPE_LABEL,
  SAMPLE_NUMBERS,
  countriesByRegion,
  batchToTsv,
  parseBatch,
  parsePhone,
  summariseBatch,
  type BatchRow,
  type PhoneParse,
  type PhoneNumberType,
} from './phoneUtils';

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    padding: '16px',
    width: '100%',
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
  samples: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  breakdown: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    padding: '12px 0 4px',
  },
  segment: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '8px 12px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '8px',
    background: tokens.colorNeutralBackground2,
  },
  segmentValue: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    fontSize: '16px',
    fontWeight: 600,
    userSelect: 'all',
    overflowWrap: 'anywhere',
  },
  segmentLabel: {
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
    padding: '9px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  rowLabel: {
    flex: 'none',
    width: '168px',
    color: tokens.colorNeutralForeground3,
  },
  rowValue: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    fontSize: '14px',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  tableScroll: {
    width: '100%',
    maxHeight: '420px',
    overflow: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontVariantNumeric: 'tabular-nums',
    fontSize: '13px',
  },
  headCell: {
    position: 'sticky',
    top: 0,
    textAlign: 'left',
    padding: '8px 10px',
    background: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground3,
    fontWeight: 600,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    whiteSpace: 'nowrap',
  },
  cell: {
    padding: '6px 10px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    whiteSpace: 'nowrap',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
  },
  cellWide: {
    padding: '6px 10px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    whiteSpace: 'normal',
    minWidth: '220px',
  },
  failedRow: {
    background: tokens.colorStatusDangerBackground1,
  },
  coverageGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '12px',
    width: '100%',
  },
  coverageGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  coverageItem: {
    display: 'flex',
    gap: '8px',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
  },
  coverageCode: {
    color: tokens.colorNeutralForeground3,
    minWidth: '48px',
  },
});

const TYPE_COLOR: Record<PhoneNumberType, 'informative' | 'success' | 'warning' | 'subtle'> = {
  mobile: 'informative',
  fixed: 'subtle',
  tollFree: 'success',
  service: 'warning',
  unknown: 'subtle',
};

const DEFAULT_BATCH = [
  '+86 138 0013 8000',
  '+1 202 555 0147',
  '020 7946 0958',
  '+44 7700 900123',
  '+49 30 12345678',
  '+39 06 6982 1234',
  '+998 90 123 4567',
].join('\n');

/** The grouped subscriber digits, without the country code or any extension. */
function subscriberDisplay(parsed: PhoneParse): string {
  return parsed.outputs.international
    .replace(`+${parsed.callingCode} `, '')
    .replace(/ ext\. \d+$/, '');
}

function formatLabel(parsed: PhoneParse): string {
  if (parsed.formatKind === 'national') return '国内格式（无国家码）';
  return parsed.internationalPrefix === '+'
    ? '国际格式（+ 前缀）'
    : '国际格式（00 前缀）';
}

export function PhoneParserTool() {
  const styles = useStyles();
  const toasterId = useId('phone-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [input, setInput] = useState('+86 138 0013 8000');
  const [defaultIso, setDefaultIso] = useState('CN');
  const [batchText, setBatchText] = useState(DEFAULT_BATCH);
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

  const single = useMemo(
    () => parsePhone(input, { defaultCountry: defaultIso }),
    [input, defaultIso],
  );
  const rows = useMemo(
    () => parseBatch(batchText, { defaultCountry: defaultIso }),
    [batchText, defaultIso],
  );
  const summary = useMemo(() => summariseBatch(rows), [rows]);
  const regions = useMemo(() => countriesByRegion(), []);

  const selectedCountry = COUNTRIES.find((country) => country.iso === defaultIso);
  const countryOptions = useMemo(
    () => [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')),
    [],
  );

  const outputs = single.ok
    ? [
        {
          key: 'e164',
          label: 'E.164',
          hint: 'ITU-T E.164 正式形式，适合存储与交换',
          value: single.outputs.e164,
        },
        {
          key: 'international',
          label: '国际格式',
          hint: '带国家码，便于跨区阅读与拨号',
          value: single.outputs.international,
        },
        {
          key: 'national',
          label: '国内格式',
          hint: `按${single.country.name}的国内写法（含长途冠码时保留）`,
          value: single.outputs.national,
        },
        {
          key: 'telUri',
          label: 'RFC 3966 tel URI',
          hint: '网页链接与二维码使用的 tel: 形式',
          value: single.outputs.telUri,
        },
        {
          key: 'digits',
          label: '纯数字',
          hint: '国家码 + 国内有效号码，无任何分隔符',
          value: single.outputs.digits,
        },
      ]
    : [];

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className="wt-surface">
        <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
          <div className={styles.stack}>
            <div className={styles.toolbar}>
              <TabList
                selectedValue={mode}
                onTabSelect={(_, data) => setMode(data.value as 'single' | 'batch')}
              >
                <Tab value="single">单个解析</Tab>
                <Tab value="batch">批量解析</Tab>
              </TabList>
              <span className={styles.spacer} />
              <Caption1 className={styles.hint}>国内格式的默认国家/地区</Caption1>
              <Dropdown
                style={{ minWidth: 220 }}
                value={
                  selectedCountry
                    ? `${selectedCountry.name} (+${selectedCountry.callingCode})`
                    : defaultIso
                }
                selectedOptions={[defaultIso]}
                onOptionSelect={(_, data) => setDefaultIso(data.optionValue ?? 'CN')}
                aria-label="国内格式的默认国家/地区"
              >
                {countryOptions.map((country) => (
                  <Option
                    key={country.iso}
                    value={country.iso}
                    text={`${country.name} (+${country.callingCode})`}
                  >
                    {`${country.name} (+${country.callingCode})`}
                  </Option>
                ))}
              </Dropdown>
            </div>

            {mode === 'single' ? (
              <>
                <section className="wt-surface" aria-label="号码输入">
                  <div className="wt-surface__header">
                    <PhoneRegular />
                    <Text as="h2" size={300} weight="semibold">
                      输入号码
                    </Text>
                    <span className={styles.spacer} />
                    <Button appearance="subtle" onClick={() => setInput('')} disabled={!input}>
                      清空
                    </Button>
                  </div>
                  <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                    <div className={styles.row}>
                      <input
                        className="wt-inline-input"
                        style={{ fontSize: 16 }}
                        value={input}
                        onChange={(event) => setInput(event.target.value)}
                        placeholder="例如 +86 138 0013 8000、020 7946 0958、0044 7700 900123"
                        aria-label="电话号码输入"
                        spellCheck={false}
                        autoComplete="off"
                      />
                    </div>
                    <div className={styles.samples} style={{ padding: '4px 14px 12px' }}>
                      {[...SAMPLE_NUMBERS, '+86 138 0013 8000 ext. 123'].map((sample) => (
                        <Button
                          key={sample}
                          size="small"
                          appearance="subtle"
                          onClick={() => setInput(sample)}
                        >
                          {sample}
                        </Button>
                      ))}
                    </div>
                  </div>
                </section>

                {!single.ok && (
                  <MessageBar intent="error">
                    <MessageBarBody>{single.error}</MessageBarBody>
                  </MessageBar>
                )}

                {single.ok && (
                  <>
                    <section className="wt-surface" aria-label="解析过程">
                      <div className="wt-surface__header">
                        <Text as="h2" size={300} weight="semibold">
                          解析过程
                        </Text>
                        <span className={styles.spacer} />
                        <Badge appearance="tint" color={TYPE_COLOR[single.type]}>
                          {NUMBER_TYPE_LABEL[single.type]}
                        </Badge>
                      </div>
                      <div
                        className="wt-surface__body"
                        style={{ flexDirection: 'column', padding: '0 14px 12px' }}
                      >
                        <div className={styles.breakdown}>
                          <div className={styles.segment}>
                            <span className={styles.segmentValue}>
                              {single.internationalPrefix ?? '（无）'}
                            </span>
                            <Caption1 className={styles.segmentLabel}>国际前缀</Caption1>
                          </div>
                          <div className={styles.segment}>
                            <span className={styles.segmentValue}>+{single.callingCode}</span>
                            <Caption1 className={styles.segmentLabel}>国家码</Caption1>
                          </div>
                          <div className={styles.segment}>
                            <span className={styles.segmentValue}>
                              {subscriberDisplay(single)}
                            </span>
                            <Caption1 className={styles.segmentLabel}>国内有效号码</Caption1>
                          </div>
                          <div className={styles.segment}>
                            <span className={styles.segmentValue}>
                              {single.trunkPrefixStripped
                                ? `${single.trunkPrefixStripped}（已剥离）`
                                : single.country.trunkPrefix
                                  ? `${single.country.trunkPrefix}（未出现）`
                                  : '无'}
                            </span>
                            <Caption1 className={styles.segmentLabel}>长途冠码</Caption1>
                          </div>
                          <div className={styles.segment}>
                            <span className={styles.segmentValue}>
                              {single.extension ?? '无'}
                            </span>
                            <Caption1 className={styles.segmentLabel}>分机号</Caption1>
                          </div>
                        </div>

                        <div className={styles.rows}>
                          <div className={styles.row}>
                            <Text className={styles.rowLabel} size={200}>
                              识别到的输入格式
                            </Text>
                            <span className={styles.rowValue}>{formatLabel(single)}</span>
                          </div>
                          <div className={styles.row}>
                            <Text className={styles.rowLabel} size={200}>
                              国家/地区
                            </Text>
                            <span className={styles.rowValue}>
                              {`${single.country.name}（${single.country.iso}） 国家码 +${single.callingCode}`}
                            </span>
                          </div>
                          <div className={styles.row}>
                            <Text className={styles.rowLabel} size={200}>
                              国内有效号码（数字）
                            </Text>
                            <span className={styles.rowValue}>{single.nationalNumber}</span>
                          </div>
                          <div className={styles.row}>
                            <Text className={styles.rowLabel} size={200}>
                              有效长度集合
                            </Text>
                            <span className={styles.rowValue}>
                              {`${single.country.lengths.join(' / ')} 位 · 当前 ${single.nationalNumber.length} 位`}
                            </span>
                          </div>
                          <div className={styles.row}>
                            <Text className={styles.rowLabel} size={200}>
                              号码类型依据
                            </Text>
                            <span className={styles.rowValue} style={{ fontFamily: 'inherit' }}>
                              {single.typeBasis ??
                                '该号段形态无法可靠区分手机/固话，因此不给类型结论'}
                            </span>
                          </div>
                          <div className={styles.row}>
                            <Text className={styles.rowLabel} size={200}>
                              命中的号段模式
                            </Text>
                            <span className={styles.rowValue}>{single.matchedPattern}</span>
                          </div>
                        </div>

                        {single.sharedNote && (
                          <MessageBar intent="warning" style={{ marginTop: 12 }}>
                            <MessageBarBody>{single.sharedNote}</MessageBarBody>
                          </MessageBar>
                        )}
                      </div>
                    </section>

                    <section className="wt-surface" aria-label="输出格式">
                      <div className="wt-surface__header">
                        <Text as="h2" size={300} weight="semibold">
                          输出格式
                        </Text>
                        <span className={styles.spacer} />
                        <Caption1 className={styles.hint}>
                          五种形式互相一致，可逐一复制
                        </Caption1>
                      </div>
                      <div className={`wt-surface__body ${styles.rows}`} style={{ display: 'flex' }}>
                        {outputs.map((item) => (
                          <div key={item.key} className={styles.row}>
                            <Text className={styles.rowLabel} size={200}>
                              {item.label}
                              <br />
                              <span style={{ fontSize: 11 }}>{item.hint}</span>
                            </Text>
                            <span className={styles.rowValue}>{item.value}</span>
                            <Button
                              appearance="subtle"
                              size="small"
                              icon={
                                copied === item.key ? <Checkmark16Regular /> : <Copy16Regular />
                              }
                              onClick={() => copy(item.value, item.key)}
                              aria-label={`复制${item.label}`}
                            />
                          </div>
                        ))}
                      </div>
                    </section>
                  </>
                )}
              </>
            ) : (
              <section className="wt-surface" aria-label="批量解析">
                <div className="wt-surface__header">
                  <Text as="h2" size={300} weight="semibold">
                    批量解析
                  </Text>
                  <span className={styles.spacer} />
                  <Caption1 className={styles.hint}>
                    共 {summary.total} 行 · 成功 {summary.ok} · 失败 {summary.failed}
                  </Caption1>
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={copied === 'tsv' ? <Checkmark16Regular /> : <Copy16Regular />}
                    onClick={() => copy(batchToTsv(rows), 'tsv')}
                    disabled={rows.length === 0}
                  >
                    复制表格
                  </Button>
                </div>
                <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                  <textarea
                    className="wt-code-area"
                    style={{ minHeight: 180 }}
                    value={batchText}
                    onChange={(event) => setBatchText(event.target.value)}
                    placeholder="一行一个号码，空行会被跳过"
                    aria-label="批量号码输入，一行一个"
                    spellCheck={false}
                  />
                  <Divider />
                  <div className={styles.tableScroll}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th className={styles.headCell}>行号</th>
                          <th className={styles.headCell}>输入</th>
                          <th className={styles.headCell}>国家/地区</th>
                          <th className={styles.headCell}>E.164</th>
                          <th className={styles.headCell}>国际格式</th>
                          <th className={styles.headCell}>国内格式</th>
                          <th className={styles.headCell}>类型</th>
                          <th className={styles.headCell}>说明</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row: BatchRow) => (
                          <tr key={`${row.line}-${row.input}`}>
                            <td className={styles.cell}>{row.line}</td>
                            <td className={styles.cell}>{row.input}</td>
                            {row.result.ok ? (
                              <>
                                <td className={styles.cell}>
                                  {`${row.result.country.name} (${row.result.country.iso})`}
                                </td>
                                <td className={styles.cell}>{row.result.outputs.e164}</td>
                                <td className={styles.cell}>{row.result.outputs.international}</td>
                                <td className={styles.cell}>{row.result.outputs.national}</td>
                                <td className={styles.cell}>
                                  {NUMBER_TYPE_LABEL[row.result.type]}
                                </td>
                                <td className={styles.cellWide}>
                                  {row.result.typeBasis ?? '—'}
                                </td>
                              </>
                            ) : (
                              <>
                                <td className={styles.cell}>—</td>
                                <td className={styles.cell}>—</td>
                                <td className={styles.cell}>—</td>
                                <td className={styles.cell}>—</td>
                                <td className={styles.cell}>失败</td>
                                <td className={`${styles.cellWide} ${styles.failedRow}`}>
                                  {row.result.error}
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            <section className="wt-surface" aria-label="已收录的国家和地区">
              <div className="wt-surface__header">
                <Text as="h2" size={300} weight="semibold">
                  已收录的国家和地区（{COUNTRIES.length}）
                </Text>
                <span className={styles.spacer} />
                <Caption1 className={styles.hint}>
                  未列出的国家码一律返回"未收录"，不做猜测
                </Caption1>
              </div>
              <div className="wt-surface__body" style={{ padding: '12px 14px', display: 'block' }}>
                <div className={styles.coverageGrid}>
                  {regions.map((group) => (
                    <div key={group.region} className={styles.coverageGroup}>
                      <Text size={200} weight="semibold">
                        {group.region}
                      </Text>
                      {group.countries.map((country) => (
                        <div key={country.iso} className={styles.coverageItem}>
                          <span className={styles.coverageCode}>{`+${country.callingCode}`}</span>
                          <span>
                            {country.name}
                            <span className={styles.hint}>
                              {` · ${country.lengths.join('/')} 位`}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <MessageBar intent="info">
              <MessageBarBody>
                本工具只依据公开的编号规则（国家码、长途冠码、国内有效号码长度与号段形态）做解析与校验。
                它<strong>不查询</strong>号码归属地、运营商或在网状态——那需要运营商数据库；
                也<strong>不拨打</strong>、<strong>不发短信</strong>。
                号码类型只在有公开号段依据时才给出（如中国 1[3-9] 为手机、NANP 的 800 为免费号），
                手机与固话无法区分的国家（如美国、加拿大、丹麦、墨西哥）会明确显示"未知"。
                国家码 +1、+7 由多个国家/地区共用，结果会同时给出候选与说明。
                号码按 E.164 的 15 位总长上限校验；意大利等保留国内号码前导 0 的国家不会被错误地去零。
              </MessageBarBody>
            </MessageBar>
          </div>
        </div>
      </div>
    </>
  );
}
