import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  MessageBar,
  MessageBarBody,
  Radio,
  RadioGroup,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowSync16Regular,
  Checkmark16Regular,
  Copy16Regular,
  Info16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  GLOBAL_ID_BYTES,
  UlaError,
  formatCollisionProbability,
  formatGlobalId,
  formatUtcIso,
  globalIdFromBytes,
  globalIdFromTimeAndEui64,
  ntpToBytes,
  ntpToEpochMs,
  parseEui64,
  parseGlobalId,
  parseHexBytes,
  parseSubnetId,
  planUla,
  randomInterfaceId,
  toHex,
  toNtpTimestamp,
  type UlaPlan,
} from './ipv6UlaUtils';

const MONO = "'Cascadia Code', 'Cascadia Mono', Consolas, monospace";

/** The NTP offsets worth showing in the collision table. */
const CONNECTION_ROWS = [2, 10, 100, 1000, 10000];

type Mode = 'random' | 'rfc4193';

/**
 * Random bytes from the platform.
 *
 * The one environment access in this tool, kept in the component on purpose so
 * the utility layer stays pure and a check can inject its own bytes. `crypto`
 * is missing on plain-http LAN origins, where the classic `Math.random()`
 * fallback keeps the generator usable (a weaker prefix is better than none).
 */
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/** Colon-separated byte pairs, the way interface IDs and MACs are written. */
function hexPairs(bytes: Uint8Array): string {
  const text = toHex(bytes);
  return text.replace(/(..)(?=.)/g, '$1:');
}

/** The 64-bit NTP timestamp as 16 hex digits. */
function ntpHex(seconds: number, fraction: number): string {
  const bytes = ntpToBytes({ seconds, fraction });
  const text = toHex(bytes);
  return text.replace(/(.{4})(?=.)/g, '$1:');
}

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    width: '100%',
    padding: '16px',
    boxSizing: 'border-box',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '12px',
  },
  field: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
  },
  wideInput: {
    flex: '1 1 260px',
    minWidth: '200px',
  },
  shortInput: {
    width: '120px',
    flex: 'none',
  },
  label: {
    color: tokens.colorNeutralForeground3,
    whiteSpace: 'nowrap',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  card: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '8px',
    overflow: 'hidden',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontVariantNumeric: 'tabular-nums',
  },
  labelCell: {
    padding: '8px 12px',
    color: tokens.colorNeutralForeground3,
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    whiteSpace: 'nowrap',
    verticalAlign: 'top',
    width: '190px',
  },
  valueCell: {
    padding: '8px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    wordBreak: 'break-all',
    verticalAlign: 'top',
  },
  actionCell: {
    padding: '4px 8px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    whiteSpace: 'nowrap',
    verticalAlign: 'top',
    width: '96px',
    textAlign: 'right',
  },
  primary: {
    fontFamily: MONO,
    fontSize: '15px',
    fontWeight: 600,
    userSelect: 'all',
  },
  mono: {
    fontFamily: MONO,
    userSelect: 'all',
  },
  badgeRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    alignItems: 'center',
  },
  sectionHead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
  },
  footnote: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
    padding: '10px 12px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '8px',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  prose: {
    display: 'block',
    color: tokens.colorNeutralForeground2,
    lineHeight: 1.7,
  },
  right: {
    textAlign: 'right',
  },
});

/** One label / value / copy-button row of the result table. */
function ValueRow({
  label,
  value,
  onCopy,
  copied,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  onCopy: (value: string) => void;
  copied: boolean;
  hint?: string;
  emphasis?: boolean;
}) {
  const styles = useStyles();
  return (
    <tr>
      <td className={styles.labelCell}>{label}</td>
      <td className={styles.valueCell}>
        <span className={emphasis ? styles.primary : styles.mono}>{value}</span>
        {hint ? (
          <>
            <br />
            <Caption1 className={styles.hint}>{hint}</Caption1>
          </>
        ) : null}
      </td>
      <td className={styles.actionCell}>
        <Button
          appearance="subtle"
          size="small"
          icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
          onClick={() => onCopy(value)}
          aria-label={`复制${label}`}
        >
          {copied ? '已复制' : '复制'}
        </Button>
      </td>
    </tr>
  );
}

/** Plain-text rendering of the whole result, for the "copy everything" button. */
function toPlainText(plan: UlaPlan): string {
  const lines = [
    `全局 ID（40 位）：${formatGlobalId(plan.globalId)}`,
    `u 位（掩码 0x02）：${plan.uBitCleared ? '原始值为 1，已置 0' : '0（本地分配）'}`,
    `/48 站点前缀：${plan.sitePrefix}`,
    `/64 子网前缀：${plan.subnetPrefix}`,
  ];
  if (plan.address) {
    lines.push(`完整地址（压缩）：${plan.address}`);
    lines.push(`完整地址（不压缩）：${plan.addressFull ?? ''}`);
    lines.push(`完整地址（补零）：${plan.addressPadded ?? ''}`);
  }
  lines.push(
    `生成方式：${
      plan.derived
        ? `RFC 4193 §3.2.2（NTP 时间戳 + EUI-64 的 SHA-1）${
            plan.ntp ? `，NTP 秒 ${plan.ntp.seconds} 小数 ${plan.ntp.fraction}` : ''
          }`
        : '纯随机 40 位'
    }`,
  );
  return lines.join('\n');
}

export function Ipv6UlaTool() {
  const styles = useStyles();
  const [mode, setMode] = useState<Mode>('random');
  const [macText, setMacText] = useState('34-56-78-9A-BC-DE');
  const [manualGlobalId, setManualGlobalId] = useState('');
  const [subnetText, setSubnetText] = useState('1');
  const [interfaceIdText, setInterfaceIdText] = useState('');
  const [round, setRound] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  // One memo for the whole derivation: the clock read happens here, in the
  // component, and every pure step it feeds lives in the utility module. The
  // `round` counter is a dependency so "generate again" re-rolls the random
  // path and re-reads the clock for the RFC 4193 path.
  const view = useMemo(() => {
    try {
      const manual = manualGlobalId.trim();
      const generated =
        manual.length > 0
          ? globalIdFromBytes(parseGlobalId(manual))
          : mode === 'rfc4193'
            ? globalIdFromTimeAndEui64(toNtpTimestamp(Date.now()), parseEui64(macText))
            : globalIdFromBytes(randomBytes(GLOBAL_ID_BYTES));

      const subnetId = parseSubnetId(subnetText);
      const iidText = interfaceIdText.trim();
      const interfaceId = iidText.length > 0 ? parseHexBytes(iidText, 8, '接口 ID') : null;

      return { plan: planUla(generated, subnetId, interfaceId), error: null, generated };
    } catch (error) {
      if (error instanceof UlaError) return { plan: null, error: error.message, generated: null };
      throw error;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, macText, manualGlobalId, subnetText, interfaceIdText, round]);

  const plan = view.plan;

  const copy = async (key: string, value: string) => {
    const ok = await copyText(value);
    setCopied(ok ? key : null);
  };

  return (
    <div className="wt-surface">
      <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
        <div className={styles.stack}>
          <div className={styles.toolbar}>
            <RadioGroup
              layout="horizontal"
              aria-label="全局 ID 的生成方式"
              value={mode}
              onChange={(_event, data) => setMode(data.value as Mode)}
            >
              <Radio value="random" label="纯随机（推荐）" />
              <Radio value="rfc4193" label="RFC 4193：NTP 时间戳 + EUI-64" />
            </RadioGroup>
            <span style={{ flex: '1 1 auto' }} />
            <Button
              appearance="primary"
              icon={<ArrowSync16Regular />}
              onClick={() => setRound((value) => value + 1)}
            >
              重新生成
            </Button>
            <Button
              appearance="subtle"
              icon={copied === 'all' ? <Checkmark16Regular /> : <Copy16Regular />}
              disabled={!plan}
              onClick={() => plan && void copy('all', toPlainText(plan))}
            >
              {copied === 'all' ? '已复制' : '复制全部'}
            </Button>
          </div>

          {mode === 'rfc4193' && manualGlobalId.trim().length === 0 && (
            <>
              <div className={styles.field}>
                <span className={styles.label}>MAC / EUI-64</span>
                <input
                  className={`wt-inline-input ${styles.wideInput}`}
                  aria-label="用于推导全局 ID 的 MAC 地址或 EUI-64"
                  placeholder="34-56-78-9A-BC-DE"
                  spellCheck={false}
                  value={macText}
                  onChange={(event) => setMacText(event.target.value)}
                />
                <Caption1 className={styles.hint}>
                  48 位 MAC 会先转成 EUI-64（中间插入 FF:FE，并翻转 u 位，RFC 4291 附录 A）
                </Caption1>
              </div>
              <MessageBar intent="warning">
                <MessageBarBody>
                  RFC 4193 §3.2.2 的示例算法把「NTP 时间戳 + EUI-64 的 SHA-1」变成前缀的一部分，
                  因此前缀可复现、也可能被推测：知道你的网卡和时间（精确到秒内）的人能算出同一个全局 ID。
                  看重隐私就用纯随机；需要按文档复现一个前缀时才选这一项。
                </MessageBarBody>
              </MessageBar>
            </>
          )}

          <div className={styles.field}>
            <span className={styles.label}>手动指定全局 ID</span>
            <input
              className={`wt-inline-input ${styles.wideInput}`}
              aria-label="手动指定 40 位全局 ID（留空则自动生成）"
              placeholder="留空则按上面的方式生成，例如 103456789a 或 10:34:56:78:9a"
              spellCheck={false}
              value={manualGlobalId}
              onChange={(event) => setManualGlobalId(event.target.value)}
            />
            <Caption1 className={styles.hint}>
              10 位十六进制；其中 u 位（首字节 0x02）会被显式置 0，并在结果里说明
            </Caption1>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>子网 ID</span>
            <input
              className={`wt-inline-input ${styles.shortInput}`}
              aria-label="子网 ID（16 位，十进制或以 0x 开头的十六进制）"
              spellCheck={false}
              value={subnetText}
              onChange={(event) => setSubnetText(event.target.value)}
            />
            <span className={styles.label}>接口 ID</span>
            <input
              className={`wt-inline-input ${styles.wideInput}`}
              aria-label="接口 ID（64 位十六进制，可留空）"
              placeholder="留空则只给出 /48 与 /64 前缀，例如 021a:2b3c:4d5e:6f70"
              spellCheck={false}
              value={interfaceIdText}
              onChange={(event) => setInterfaceIdText(event.target.value)}
            />
            <Button
              appearance="subtle"
              size="small"
              onClick={() => setInterfaceIdText(hexPairs(randomInterfaceId(randomBytes(8))))}
            >
              随机接口 ID
            </Button>
            <Button
              appearance="subtle"
              size="small"
              disabled={interfaceIdText.length === 0}
              onClick={() => setInterfaceIdText('')}
            >
              清空
            </Button>
          </div>

          {view.error && (
            <MessageBar intent="error">
              <MessageBarBody>{view.error}</MessageBarBody>
            </MessageBar>
          )}

          {plan && (
            <>
              <div className={styles.sectionHead}>
                <Text as="h2" size={300} weight="semibold">
                  生成结果
                </Text>
                <div className={styles.badgeRow}>
                  <Badge appearance="tint" color="brand">
                    {plan.derived ? 'RFC 4193 时间 + EUI-64' : '纯随机'}
                  </Badge>
                  <Badge appearance="tint" color={plan.uBitCleared ? 'warning' : 'success'}>
                    {plan.uBitCleared ? 'u 位原始值为 1，已置 0' : 'u 位为 0'}
                  </Badge>
                  <Badge appearance="outline">{`子网 ID ${plan.subnetId}`}</Badge>
                </div>
              </div>

              <div className={styles.card}>
                <table className={styles.table}>
                  <tbody>
                    <tr>
                      <td className={styles.labelCell}>40 位全局 ID</td>
                      <td className={styles.valueCell}>
                        <span className={styles.primary}>{formatGlobalId(plan.globalId)}</span>
                      </td>
                      <td className={styles.actionCell}>
                        <Button
                          appearance="subtle"
                          size="small"
                          icon={copied === 'gid' ? <Checkmark16Regular /> : <Copy16Regular />}
                          onClick={() => void copy('gid', formatGlobalId(plan.globalId))}
                          aria-label="复制全局 ID"
                        >
                          {copied === 'gid' ? '已复制' : '复制'}
                        </Button>
                      </td>
                    </tr>
                    <ValueRow
                      label="/48 站点前缀"
                      value={plan.sitePrefix}
                      emphasis
                      copied={copied === 'site'}
                      onCopy={(value) => void copy('site', value)}
                    />
                    <ValueRow
                      label="/64 子网前缀"
                      value={plan.subnetPrefix}
                      copied={copied === 'subnet'}
                      onCopy={(value) => void copy('subnet', value)}
                    />
                    {plan.address && (
                      <>
                        <ValueRow
                          label="/128 完整地址"
                          value={plan.address}
                          emphasis
                          hint="RFC 5952 规范形式（最长零组压缩、长度相同压最左、单个零组不压缩、十六进制小写）"
                          copied={copied === 'address'}
                          onCopy={(value) => void copy('address', value)}
                        />
                        <ValueRow
                          label="不压缩形式"
                          value={plan.addressFull ?? ''}
                          hint="省略前导零，但不使用 ::"
                          copied={copied === 'addressFull'}
                          onCopy={(value) => void copy('addressFull', value)}
                        />
                        <ValueRow
                          label="补零形式"
                          value={plan.addressPadded ?? ''}
                          hint="每组补足 4 位十六进制，仅便于看清 /48、/64、接口 ID 的字段边界；不是规范形式"
                          copied={copied === 'addressPadded'}
                          onCopy={(value) => void copy('addressPadded', value)}
                        />
                      </>
                    )}
                    <ValueRow
                      label="第 1 字节"
                      value="0xFD"
                      hint="FC00::/7 加上 L=1。L 位是这一字节的最低位；u 位在全局 ID（第 2 字节）里，掩码 0x02，两者不是同一位"
                      copied={copied === 'firstByte'}
                      onCopy={(value) => void copy('firstByte', value)}
                    />
                    {view.generated?.ntp && (
                      <>
                        <ValueRow
                          label="NTP 时间戳（64 位）"
                          value={ntpHex(view.generated.ntp.seconds, view.generated.ntp.fraction)}
                          hint={`UTC ${formatUtcIso(ntpToEpochMs(view.generated.ntp))}（NTP 秒 ${view.generated.ntp.seconds}，小数秒 ${view.generated.ntp.fraction}）`}
                          copied={copied === 'ntp'}
                          onCopy={(value) => void copy('ntp', value)}
                        />
                        <ValueRow
                          label="EUI-64"
                          value={hexPairs(parseEui64(macText))}
                          copied={copied === 'eui'}
                          onCopy={(value) => void copy('eui', value)}
                        />
                        {view.generated.digest && (
                          <>
                            <ValueRow
                              label="哈希输入"
                              value={view.generated.key ? hexPairs(view.generated.key) : ''}
                              hint="NTP 时间戳（8 字节）‖ EUI-64（8 字节）"
                              copied={copied === 'key'}
                              onCopy={(value) => void copy('key', value)}
                            />
                            <ValueRow
                              label="SHA-1 摘要"
                              value={view.generated.digest ? toHex(view.generated.digest) : ''}
                              hint="取最低 40 位（摘要最后 5 字节）作为全局 ID，再清除 u 位"
                              copied={copied === 'digest'}
                              onCopy={(value) => void copy('digest', value)}
                            />
                          </>
                        )}
                      </>
                    )}
                  </tbody>
                </table>
              </div>

              <div className={styles.footnote}>
                <Info16Regular style={{ flex: 'none', marginTop: 2 }} />
                <Caption1>
                  本工具只生成地址文本，不改动本机网络配置。ULA 前缀不会在全球互联网上路由，适合内网、VPN
                  与实验环境；它不由任何机构注册，因此「唯一」只是概率意义上的唯一（见下方的碰撞概率）。
                </Caption1>
              </div>

              <Text as="h2" size={300} weight="semibold">
                关于 u 位与 L 位
              </Text>
              <Caption1 className={styles.prose}>
                RFC 4193 §3.1 把地址分成 7 位前缀 + 1 位 L 位 + 40 位全局 ID + 16 位子网 ID + 64 位接口 ID。
                前缀 FC00::/7 加上 L=1（本地分配）就是大家熟悉的 fd00::/8，所以第 1 字节固定是 0xFD。
                另有一个容易混淆的「u 位」（universal/local），按 RFC 4291 附录 A 对 modified EUI-64 的定义
                是首字节中从最高位数起第 6 位，掩码 0x02：0 表示本地管理，1 表示由全球唯一标识派生。
                本工具在这个 40 位全局 ID 的第一个字节上把该位保持为 0 —— ULA 本来就是本地分配的标识符，
                置 1 等于声称它来自某个全球注册机构。RFC 4193 正文只规定了 L 位与「必须伪随机」，
                并未使用 u 位这个说法；把全局 ID 的 u 位置 0 是业界一致的做法，因此这里既执行它，
                也在原始值确实带 1 时明确告诉你「已置 0」，而不是悄悄改掉你输入的数字。
              </Caption1>

              <Text as="h2" size={300} weight="semibold">
                两种生成方式的取舍
              </Text>
              <Caption1 className={styles.prose}>
                纯随机：直接取 40 位随机数（保留 u 位为 0，因此实际上有 39 位随机熵）。与硬件和时间无关，
                无法从网卡或生成时刻反推，是默认选项。 RFC 4193 §3.2.2 示例算法：NTP 时间戳（64 位）
                ‖ EUI-64，做 SHA-1，取摘要最低 40 位。它有可复现的优点（同样输入永远得到同样前缀），
                代价是把网卡标识和生成时刻写进了前缀的可推导来源，且不满足 RFC 4086 意义上的「不可预测」。
              </Caption1>

              <Text as="h2" size={300} weight="semibold">
                碰撞概率（RFC 4193 §3.2.3）
              </Text>
              <div className={styles.card}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.labelCell}>互联的 ULA 前缀数</th>
                      <th className={styles.valueCell}>40 位全局 ID</th>
                      <th className={styles.valueCell}>清除 u 位后的 39 位随机</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CONNECTION_ROWS.map((connections) => (
                      <tr key={connections}>
                        <td className={styles.labelCell}>{connections.toLocaleString('zh-CN')}</td>
                        <td className={styles.valueCell}>
                          <span className={styles.mono}>{formatCollisionProbability(connections, 40)}</span>
                        </td>
                        <td className={styles.valueCell}>
                          <span className={styles.mono}>{formatCollisionProbability(connections, 39)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Caption1 className={styles.hint}>
                公式 P = 1 - exp(-N² / 2^(L+1))，数值截断到 3 位有效数字，与 RFC 4193 公布的表格一致。
                把 u 位固定为 0 会少掉一位随机性，因此第二列比第一列大约翻倍 —— 这是「u 位必须为 0」
                这条约定付出的实际代价，量级上依然可以忽略。
              </Caption1>

              <Divider />
              <Caption1 className={styles.hint}>
                明确不做：不做 IPv6 子网计算（不切分子网、不算可用地址数、不做前缀聚合或反向解析），
                也不查询地址属主。压缩形式遵循 RFC 5952 第 4 节：省略前导零、最长连续零组才用 ::、
                长度相同压最左边、单个零组不压缩、十六进制一律小写；混合写法（如 ::ffff:192.0.2.1）
                属于第 5 节的另一种建议，本工具不涉及。
              </Caption1>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
