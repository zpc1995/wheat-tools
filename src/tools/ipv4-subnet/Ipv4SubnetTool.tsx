import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  MessageBar,
  MessageBarBody,
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
  IpParseError,
  MAX_LISTED_SUBNETS,
  analyseCidrText,
  describeAddress,
  formatIp,
  hasCidrSuffix,
  splitSubnet,
  type SubnetInfo,
  type SubnetSlice,
} from './ipv4SubnetUtils';

const EXAMPLES = [
  '192.168.1.10/24',
  '10.0.0.1/8',
  '172.16.5.4/12',
  '203.0.113.7/32',
  '0.0.0.0/0',
  '192.168.1.0/31',
  '192.168.1.0/30',
];

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    width: '100%',
    padding: '16px',
    boxSizing: 'border-box',
  },
  inputRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
  },
  field: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: '1 1 320px',
    minWidth: '260px',
  },
  prefixField: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: '0 1 210px',
  },
  prefixInput: {
    width: '84px',
    flex: 'none',
  },
  label: {
    color: tokens.colorNeutralForeground3,
    whiteSpace: 'nowrap',
  },
  examples: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    alignItems: 'center',
  },
  exampleButton: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12px',
    padding: '3px 8px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '999px',
    backgroundColor: 'transparent',
    color: tokens.colorNeutralForeground2,
    cursor: 'pointer',
    ':hover': {
      backgroundColor: tokens.colorSubtleBackgroundHover,
      color: tokens.colorNeutralForeground1,
    },
  },
  card: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '8px',
    overflow: 'hidden',
  },
  bits: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '12px 14px',
    backgroundColor: tokens.colorNeutralBackground2,
    overflowX: 'auto',
  },
  bitRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '12px',
    minWidth: 'max-content',
  },
  bitLabel: {
    flex: 'none',
    width: '92px',
    color: tokens.colorNeutralForeground3,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12px',
  },
  bitValue: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
    letterSpacing: '0.06em',
    whiteSpace: 'pre',
  },
  bitText: {
    userSelect: 'all',
  },
  // Network bits and host bits get different foreground colours because that
  // split is the whole point of the binary view: the eye can find the boundary
  // (and therefore the block size) without counting characters.
  networkBit: {
    color: tokens.colorBrandForeground1,
    fontWeight: 600,
  },
  hostBit: {
    color: tokens.colorPaletteMarigoldForeground2,
  },
  boundary: {
    color: tokens.colorNeutralForeground4,
  },
  legend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '14px',
    alignItems: 'center',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  swatch: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontWeight: 600,
    letterSpacing: '0.06em',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontVariantNumeric: 'tabular-nums',
  },
  headCell: {
    textAlign: 'left',
    padding: '8px 12px',
    color: tokens.colorNeutralForeground3,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  cell: {
    padding: '7px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    whiteSpace: 'nowrap',
  },
  labelCell: {
    padding: '7px 12px',
    color: tokens.colorNeutralForeground3,
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    whiteSpace: 'nowrap',
    width: '180px',
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    userSelect: 'all',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  scroll: {
    maxHeight: '420px',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
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
  right: {
    textAlign: 'right',
  },
});

/**
 * One 32-bit word, drawn as four octets.
 *
 * The prefix decides where the "network" colouring stops, so this component
 * takes the boundary as an argument instead of guessing it from the value: a
 * mask's bytes are not the boundary, and neither are the octet separators.
 */
function BitRow({
  label,
  value,
  prefix,
  highlight,
}: {
  label: string;
  value: number;
  prefix: number;
  /** Suppress the colour split (used for the mask and wildcard rows). */
  highlight: boolean;
}) {
  const styles = useStyles();
  const octets = [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];

  return (
    <div className={styles.bitRow}>
      <span className={styles.bitLabel}>{label}</span>
      <span className={styles.bitValue} role="img" aria-label={`${label} ${describeAddress(value).binary}`}>
        {octets.map((octet, octetIndex) => (
          <span key={octetIndex} className={styles.bitText}>
            {octetIndex > 0 ? <span className={styles.boundary}>{' '}</span> : null}
            {Array.from({ length: 8 }, (_unused, bitIndex) => {
              const position = octetIndex * 8 + bitIndex;
              const isNetwork = highlight && position < prefix;
              return (
                <span
                  key={bitIndex}
                  className={isNetwork ? styles.networkBit : highlight ? styles.hostBit : undefined}
                >
                  {(octet >>> (7 - bitIndex)) & 1}
                </span>
              );
            })}
          </span>
        ))}
      </span>
    </div>
  );
}

function bitsText(value: number): string {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
    .map((octet) => octet.toString(2).padStart(8, '0'))
    .join(' ');
}

/** A one-line label/value pair; the workhorse of the detail table. */
function Row({
  label,
  value,
  mono = true,
  title,
}: {
  label: string;
  value: string;
  mono?: boolean;
  title?: string;
}) {
  const styles = useStyles();
  return (
    <tr>
      <td className={styles.labelCell}>{label}</td>
      <td className={mono ? `${styles.cell} ${styles.mono}` : styles.cell} title={title}>
        {value}
      </td>
    </tr>
  );
}

/** Human-readable description of a slice when it has no ordinary host range. */
function sliceRange(slice: SubnetSlice): string {
  if (slice.kind === 'singleHost') {
    return `${formatIp(slice.network)}（单地址主机路由）`;
  }
  if (slice.kind === 'pointToPoint') {
    return `${formatIp(slice.network)} – ${formatIp(slice.broadcast)}（RFC 3021 两点链路）`;
  }
  return `${formatIp(slice.firstHost!)} – ${formatIp(slice.lastHost!)}`;
}

/** Plain-text rendering of the whole result, for the copy button. */
function toPlainText(info: SubnetInfo, plan: ReturnType<typeof splitSubnet> | null): string {
  const lines = [
    `输入网段：${formatIp(info.address)}/${info.prefix}`,
    `网络地址：${formatIp(info.network)}`,
    `广播地址：${formatIp(info.broadcast)}`,
    `子网掩码：${formatIp(info.mask)}`,
    `反掩码：  ${formatIp(info.wildcard)}`,
    `可用主机范围：${
      info.firstHost === null ? '无' : `${formatIp(info.firstHost)} – ${formatIp(info.lastHost!)}`
    }`,
    `可用主机数：${info.usableHosts}`,
    `地址总数：${info.totalAddresses}`,
    `地址类别：${info.classInfo.name} 类`,
    `地址性质：${info.block.label}`,
    '',
    `二进制 IP：      ${bitsText(info.address)}`,
    `二进制掩码：    ${bitsText(info.mask)}`,
    `二进制网络地址：${bitsText(info.network)}`,
  ];

  if (plan) {
    lines.push(
      '',
      `子网划分：新前缀 /${plan.newPrefix}，共 ${plan.subnetCount} 个子网，每个 ${plan.subnetSize} 个地址`,
    );
    for (const slice of plan.subnets) {
      lines.push(
        `${slice.cidr}\t${sliceRange(slice)}\t广播 ${formatIp(slice.broadcast)}\t可用 ${slice.usableHosts}`,
      );
    }
    if (!plan.complete) {
      lines.push(`（仅列出前 ${plan.subnets.length} 个，共 ${plan.subnetCount} 个）`);
    }
  }

  return lines.join('\n');
}

export function Ipv4SubnetTool() {
  const styles = useStyles();
  const [input, setInput] = useState('192.168.1.10/24');
  const [splitText, setSplitText] = useState('26');
  const [copied, setCopied] = useState(false);

  // Parse + analyse on every keystroke. The whole computation is a handful of
  // bitwise operations, so there is nothing to debounce; the only cost is that
  // half-typed input goes through the error path, which is exactly what the
  // message below is for.
  const result = useMemo(() => {
    if (input.trim().length === 0) return { info: null, error: null };
    try {
      return { info: analyseCidrText(input), error: null };
    } catch (error) {
      if (error instanceof IpParseError) return { info: null, error: error.message };
      throw error;
    }
  }, [input]);

  const info = result.info;

  // The split prefix is read from its own field. An empty/invalid value is not
  // an error state: the table simply disappears and the field keeps what the
  // user typed, which is friendlier than resetting it mid-edit.
  const plan = useMemo(() => {
    if (!info) return { plan: null, error: null };
    const trimmed = splitText.trim();
    if (trimmed.length === 0) return { plan: null, error: null };
    try {
      const newPrefix = Number.parseInt(trimmed, 10);
      if (!/^\d{1,9}$/.test(trimmed)) {
        return { plan: null, error: '新前缀必须是整数' };
      }
      return { plan: splitSubnet(info.network, info.prefix, newPrefix, MAX_LISTED_SUBNETS), error: null };
    } catch (error) {
      if (error instanceof IpParseError) return { plan: null, error: error.message };
      throw error;
    }
  }, [info, splitText]);

  const onCopy = useCallback(async () => {
    if (!info) return;
    const ok = await copyText(toPlainText(info, plan.plan));
    setCopied(ok);
  }, [info, plan.plan]);

  return (
    <div className="wt-surface">
      <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
        <div className={styles.stack}>
          <div className={styles.inputRow}>
            <div className={styles.field}>
              <span className={styles.label}>网段</span>
              <input
                className="wt-inline-input"
                aria-label="IPv4 地址或 CIDR 网段"
                placeholder="192.168.1.10/24"
                spellCheck={false}
                value={input}
                onChange={(event) => setInput(event.target.value)}
              />
            </div>
            <div className={styles.prefixField}>
              <span className={styles.label}>划分子网前缀 /</span>
              <input
                className={`wt-inline-input ${styles.prefixInput}`}
                aria-label="划分子网使用的新前缀长度"
                inputMode="numeric"
                placeholder="26"
                value={splitText}
                onChange={(event) => setSplitText(event.target.value)}
              />
            </div>
            <Button
              appearance="subtle"
              size="small"
              icon={<ArrowSync16Regular />}
              onClick={() => {
                setInput('192.168.1.10/24');
                setSplitText('26');
              }}
            >
              重置
            </Button>
          </div>

          <div className={styles.examples}>
            <Caption1 className={styles.hint}>示例：</Caption1>
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                className={styles.exampleButton}
                aria-label={`使用示例 ${example}`}
                onClick={() => {
                  setInput(example);
                  // Keep the split prefix meaningful: a /31 or /32 parent cannot
                  // be split further, so the field is nudged to the next size
                  // rather than left showing an impossible value.
                  const slash = example.indexOf('/');
                  const parent = slash === -1 ? 32 : Number.parseInt(example.slice(slash + 1), 10);
                  if (Number.isInteger(parent) && parent >= 30) setSplitText('32');
                  else if (Number.isInteger(parent)) setSplitText(String(parent + 2));
                }}
              >
                {example}
              </button>
            ))}
          </div>

          {result.error && (
            <MessageBar intent="error">
              <MessageBarBody>{result.error}</MessageBarBody>
            </MessageBar>
          )}

          {!result.error && info && (
            <>
              <div className={styles.sectionHead}>
                <div className={styles.badgeRow}>
                  <Badge appearance="filled" color="brand">
                    {`${formatIp(info.network)}/${info.prefix}`}
                  </Badge>
                  <Badge appearance="tint" color={info.block.isPrivate ? 'important' : 'informative'}>
                    {info.block.label}
                  </Badge>
                  <Badge appearance="outline">{`${info.classInfo.name} 类地址`}</Badge>
                  {info.kind === 'pointToPoint' && (
                    <Badge appearance="tint" color="warning">
                      RFC 3021 点对点链路
                    </Badge>
                  )}
                  {info.kind === 'singleHost' && (
                    <Badge appearance="tint" color="warning">
                      单主机路由
                    </Badge>
                  )}
                </div>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
                  onClick={onCopy}
                >
                  {copied ? '已复制' : '复制结果'}
                </Button>
              </div>

              {info.leadingZeroWarning && (
                <MessageBar intent="warning">
                  <MessageBarBody>
                    输入中存在以 0 开头的十进制段（如 010）。本工具按十进制解析（010 = 10）；部分系统会按八进制处理，
                    得到不同结果。
                  </MessageBarBody>
                </MessageBar>
              )}

              {info.textbookFormulaFails && (
                <MessageBar intent="warning">
                  <MessageBarBody>
                    {`经典公式「2^(32-前缀) - 2」在这里不适用：它会算出 ${info.textbookUsableHosts}，` +
                      `而 /${info.prefix} 的实际可用主机数是 ${info.usableHosts}。` +
                      (info.prefix === 31
                        ? ' /31 按 RFC 3021 是点对点链路，两个地址都能分配给接口，没有网络地址与广播地址之分。'
                        : ' /32 是单地址主机路由，这唯一一个地址本身就是可用的主机地址。')}
                  </MessageBarBody>
                </MessageBar>
              )}

              <div className={styles.card}>
                <div className={styles.bits}>
                  <BitRow label="IP 地址" value={info.address} prefix={info.prefix} highlight />
                  <BitRow label="子网掩码" value={info.mask} prefix={info.prefix} highlight={false} />
                  <BitRow label="网络地址" value={info.network} prefix={info.prefix} highlight />
                  <div className={styles.legend}>
                    <span className={styles.legendItem}>
                      <span className={`${styles.swatch} ${styles.networkBit}`}>11111111</span>
                      <Caption1 className={styles.hint}>网络位</Caption1>
                    </span>
                    <span className={styles.legendItem}>
                      <span className={`${styles.swatch} ${styles.hostBit}`}>00000000</span>
                      <Caption1 className={styles.hint}>主机位</Caption1>
                    </span>
                    <Caption1 className={styles.hint}>
                      分隔符为字节边界；前 {info.prefix} 位为网络位，后 {32 - info.prefix} 位为主机位
                    </Caption1>
                  </div>
                </div>
              </div>

              <div className={styles.card}>
                <table className={styles.table}>
                  <tbody>
                    <Row label="网络地址" value={formatIp(info.network)} />
                    <Row
                      label="广播地址"
                      value={
                        info.kind === 'pointToPoint'
                          ? `${formatIp(info.broadcast)}（RFC 3021 下按主机地址使用）`
                          : formatIp(info.broadcast)
                      }
                    />
                    <Row label="子网掩码" value={`${formatIp(info.mask)}  (/${info.prefix})`} />
                    <Row label="反掩码（wildcard）" value={formatIp(info.wildcard)} />
                    <Row
                      label="首个可用主机"
                      value={info.firstHost === null ? '无' : formatIp(info.firstHost)}
                    />
                    <Row
                      label="最后可用主机"
                      value={info.lastHost === null ? '无' : formatIp(info.lastHost)}
                    />
                    <Row
                      label="可用主机数"
                      value={info.usableHosts.toLocaleString('zh-CN')}
                      title={
                        info.textbookFormulaFails
                          ? `经典公式 2^(32-${info.prefix})-2 会得到 ${info.textbookUsableHosts}，此处不适用`
                          : `即 2^(32-${info.prefix}) - 2`
                      }
                    />
                    <Row label="地址总数" value={info.totalAddresses.toLocaleString('zh-CN')} />
                    <Row label="十进制地址" value={String(info.address)} />
                    <Row label="十六进制地址" value={`0x${describeAddress(info.address).hex.slice(2)}`} />
                    <Row
                      label="地址类别"
                      value={`${info.classInfo.name} 类 — ${info.classInfo.note}`}
                      mono={false}
                    />
                    <Row
                      label="地址性质"
                      value={`${info.block.label}（${info.block.cidr}）${
                        info.block.isPrivate ? '' : '，不属于 RFC 1918 私有地址'
                      }`}
                      mono={false}
                    />
                    <Row
                      label="是否私有地址"
                      value={info.block.isPrivate ? '是' : '否'}
                      mono={false}
                    />
                  </tbody>
                </table>
              </div>

              <div className={styles.sectionHead}>
                <Text as="h2" size={300} weight="semibold">
                  子网划分
                </Text>
                <Caption1 className={styles.hint}>
                  {plan.plan
                    ? `/${info.prefix} 按 /${plan.plan.newPrefix} 切分：${plan.plan.subnetCount.toLocaleString(
                        'zh-CN',
                      )} 个子网，每个 ${plan.plan.subnetSize.toLocaleString('zh-CN')} 个地址`
                    : `输入一个大于 ${info.prefix} 的前缀长度即可切分`}
                </Caption1>
              </div>

              {plan.error && (
                <MessageBar intent="warning">
                  <MessageBarBody>{plan.error}</MessageBarBody>
                </MessageBar>
              )}

              {plan.plan && (
                <div className={styles.card}>
                  <div className={styles.scroll}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th className={styles.headCell}>#</th>
                          <th className={styles.headCell}>子网</th>
                          <th className={styles.headCell}>可用范围</th>
                          <th className={styles.headCell}>广播地址</th>
                          <th className={`${styles.headCell} ${styles.right}`}>可用主机</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.plan.subnets.map((slice) => (
                          <tr key={slice.index}>
                            <td className={styles.cell}>{slice.index + 1}</td>
                            <td className={`${styles.cell} ${styles.mono}`}>{slice.cidr}</td>
                            <td className={`${styles.cell} ${styles.mono}`}>{sliceRange(slice)}</td>
                            <td className={`${styles.cell} ${styles.mono}`}>
                              {slice.kind === 'pointToPoint' ? '—（无广播）' : formatIp(slice.broadcast)}
                            </td>
                            <td className={`${styles.cell} ${styles.right}`}>
                              {slice.usableHosts.toLocaleString('zh-CN')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!plan.plan.complete && (
                    <Caption1
                      style={{
                        display: 'block',
                        padding: '8px 12px',
                        color: tokens.colorNeutralForeground3,
                      }}
                    >
                      共 {plan.plan.subnetCount.toLocaleString('zh-CN')} 个子网，仅列出前{' '}
                      {plan.plan.subnets.length} 个。
                    </Caption1>
                  )}
                </div>
              )}

              <div className={styles.footnote}>
                <Info16Regular style={{ flex: 'none', marginTop: 2 }} />
                <Caption1>
                  可用主机数的取值规则：前缀 ≤ 30 时为 2^(32-前缀) - 2（去掉全 0 的网络地址与全 1 的广播地址，RFC 950）；
                  /31 为 2（RFC 3021 点对点链路，两个地址都可用，没有广播地址）；/32 为 1（单地址主机路由）。
                  因此经典公式 2^(32-前缀) - 2 对 /31 会得到 0、对 /32 会得到 -1，两种情况下都是错的。
                </Caption1>
              </div>

              <Divider />
              <Caption1 className={styles.hint}>
                输入支持：点分十进制（192.168.1.10/24）、32 位十进制（3232235786/24）、十六进制（0xC0A8010A/24）、
                二进制（0b…/24）；掩码可写成前缀长度、点分十进制、0x 或 0b 形式。
                {hasCidrSuffix(input) ? '' : ' 未写 "/" 时按 /32 处理。'}
                本工具只处理 IPv4，不做 IPv6，也不查询 IP 归属地（请用「外网 IP 查询」）。
              </Caption1>
            </>
          )}

          {!result.error && !info && (
            <MessageBar>
              <MessageBarBody>输入一个 IPv4 地址或 CIDR 网段后开始计算，例如 192.168.1.10/24。</MessageBarBody>
            </MessageBar>
          )}
        </div>
      </div>
    </div>
  );
}
