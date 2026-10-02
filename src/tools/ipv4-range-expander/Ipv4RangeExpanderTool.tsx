import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Tab,
  TabList,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { CheckmarkRegular, CopyRegular, WarningRegular } from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  MAX_INPUT_LINES,
  areDisjoint,
  blockSize,
  collapseBlocks,
  formatBlock,
  parseCidrList,
  parseRangeList,
  summarizeRange,
  toDotted,
  totalAddresses,
  usableHostCount,
  type AddressRange,
  type CidrBlock,
} from './ipv4RangeExpanderUtils';

type Mode = 'range' | 'cidr';

const RANGE_EXAMPLE = '192.168.1.5 - 192.168.1.30\n10.0.0.0 - 10.0.0.255\n203.0.113.7';
const CIDR_EXAMPLE = '192.168.1.0/25\n192.168.1.128/25\n10.0.0.0/8\n10.1.0.0/16\n192.168.4.0/24';

const useStyles = makeStyles({
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    padding: '16px',
    width: '100%',
    boxSizing: 'border-box',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
    justifyContent: 'space-between',
  },
  examples: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    alignItems: 'center',
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
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
  },
  numeric: {
    textAlign: 'right',
  },
  badges: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    alignItems: 'center',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  scroll: {
    maxHeight: '360px',
    overflow: 'auto',
    overscrollBehavior: 'contain',
  },
  code: {
    margin: 0,
    padding: '10px 12px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '6px',
    backgroundColor: tokens.colorNeutralBackground3,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12.5px',
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
});

/** Renders a CIDR list with its per-block and aggregate address counts. */
function BlockTable({ blocks }: { blocks: CidrBlock[] }) {
  const styles = useStyles();
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.headCell}>#</th>
            <th className={styles.headCell}>CIDR</th>
            <th className={`${styles.headCell} ${styles.numeric}`}>地址数</th>
            <th className={`${styles.headCell} ${styles.numeric}`}>可用主机数</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((block, index) => (
            <tr key={`${block.network}-${block.prefix}-${index}`}>
              <td className={styles.cell}>{index + 1}</td>
              <td className={`${styles.cell} ${styles.mono}`}>{formatBlock(block)}</td>
              <td className={`${styles.cell} ${styles.mono} ${styles.numeric}`}>
                {blockSize(block.prefix).toLocaleString('en-US')}
              </td>
              <td className={`${styles.cell} ${styles.mono} ${styles.numeric}`}>
                {usableHostCount(block.prefix).toLocaleString('en-US')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** `192.168.1.5 – 192.168.1.30（26 个地址）`. */
function formatRange(range: AddressRange): string {
  const count = range.last - range.first + 1;
  return `${toDotted(range.first)} – ${toDotted(range.last)}（${count.toLocaleString('en-US')} 个地址）`;
}

export function Ipv4RangeExpanderTool() {
  const styles = useStyles();
  const [mode, setMode] = useState<Mode>('range');
  const [rangeText, setRangeText] = useState(RANGE_EXAMPLE);
  const [cidrText, setCidrText] = useState(CIDR_EXAMPLE);
  const [copied, setCopied] = useState<string | null>(null);

  const rangeResult = useMemo(() => {
    const parsed = parseRangeList(rangeText);
    const rows = parsed.ranges.map((range) => ({
      range,
      blocks: summarizeRange(range.first, range.last),
    }));
    const allBlocks = rows.flatMap((row) => row.blocks);
    const listedTotal = parsed.ranges.reduce((sum, range) => sum + (range.last - range.first + 1), 0);
    return { parsed, rows, allBlocks, listedTotal, disjoint: areDisjoint(allBlocks) };
  }, [rangeText]);

  const cidrResult = useMemo(() => {
    const parsed = parseCidrList(cidrText);
    const collapsed = collapseBlocks(parsed.blocks);
    return {
      parsed,
      collapsed,
      inputTotal: totalAddresses(parsed.blocks),
      uniqueTotal: totalAddresses(collapsed.blocks),
      mergedAway: parsed.blocks.length - collapsed.blocks.length,
    };
  }, [cidrText]);

  const onCopy = useCallback(async (key: string, text: string) => {
    const ok = await copyText(text);
    setCopied(ok ? key : null);
  }, []);

  const rangeBlocksText = rangeResult.allBlocks.map(formatBlock).join('\n');
  const cidrBlocksText = cidrResult.collapsed.blocks.map(formatBlock).join('\n');
  const cidrRangesText = cidrResult.collapsed.ranges
    .map((range) => `${toDotted(range.first)} - ${toDotted(range.last)}`)
    .join('\n');

  return (
    <div className="wt-surface">
      <div className={`wt-surface__body ${styles.body}`}>
        <TabList
          selectedValue={mode}
          onTabSelect={(_event, data) => setMode(data.value as Mode)}
          aria-label="转换方向"
        >
          <Tab value="range">范围 → 最小 CIDR 集合</Tab>
          <Tab value="cidr">CIDR → 并集范围</Tab>
        </TabList>

        {mode === 'range' ? (
          <>
            <div className={styles.toolbar}>
              <Caption1 className={styles.hint}>
                {`每行一个范围："起始 - 结束"（也接受 ~、..、to 与不带空格的连字符）、单个地址，或一个 CIDR；空行与 # 注释忽略，最多 ${MAX_INPUT_LINES} 行`}
              </Caption1>
              <div className={styles.examples}>
                <Button size="small" appearance="subtle" onClick={() => setRangeText(RANGE_EXAMPLE)}>
                  示例
                </Button>
                <Button
                  size="small"
                  appearance="subtle"
                  onClick={() => setRangeText('0.0.0.0 - 255.255.255.255')}
                >
                  整个 IPv4 空间
                </Button>
                <Button size="small" appearance="subtle" onClick={() => setRangeText('192.168.1.7 - 192.168.1.7')}>
                  单个地址
                </Button>
              </div>
            </div>

            <textarea
              className="wt-code-area"
              style={{ minHeight: '120px' }}
              value={rangeText}
              aria-label="IPv4 起止范围列表，每行一个"
              onChange={(event) => setRangeText(event.target.value)}
            />

            {rangeResult.parsed.errors.length > 0 && (
              <MessageBar intent="error">
                <MessageBarBody>
                  <MessageBarTitle>{`${rangeResult.parsed.errors.length} 行无法解析`}</MessageBarTitle>
                  {rangeResult.parsed.errors.map((error) => `${error.line}：${error.message}`).join('；')}
                </MessageBarBody>
              </MessageBar>
            )}

            {rangeResult.parsed.truncated && (
              <MessageBar intent="warning">
                <MessageBarBody>{`输入超过 ${MAX_INPUT_LINES} 行，只处理前 ${MAX_INPUT_LINES} 行`}</MessageBarBody>
              </MessageBar>
            )}

            {rangeResult.rows.length > 0 && (
              <>
                <div className={styles.badges}>
                  <Badge appearance="tint" color="informative">
                    {`${rangeResult.rows.length} 个范围`}
                  </Badge>
                  <Badge appearance="tint" color="informative">
                    {`${rangeResult.allBlocks.length} 个 CIDR`}
                  </Badge>
                  <Badge appearance="tint" color="success">
                    {`合计 ${rangeResult.listedTotal.toLocaleString('en-US')} 个地址`}
                  </Badge>
                  {!rangeResult.disjoint && (
                    <Badge appearance="tint" color="warning" icon={<WarningRegular />}>
                      多个范围有重叠，CIDR 集合可进一步合并
                    </Badge>
                  )}
                  <Button
                    size="small"
                    appearance="subtle"
                    icon={copied === 'rangeBlocks' ? <CheckmarkRegular /> : <CopyRegular />}
                    onClick={() => onCopy('rangeBlocks', rangeBlocksText)}
                  >
                    {copied === 'rangeBlocks' ? '已复制' : '复制 CIDR 列表'}
                  </Button>
                </div>

                <div className={styles.scroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.headCell}>输入范围</th>
                        <th className={styles.headCell}>最小 CIDR 集合</th>
                        <th className={`${styles.headCell} ${styles.numeric}`}>地址数合计</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rangeResult.rows.map((row) => {
                        const covered = totalAddresses(row.blocks);
                        const expected = row.range.last - row.range.first + 1;
                        return (
                          <tr key={`${row.range.first}-${row.range.last}`}>
                            <td className={`${styles.cell} ${styles.mono}`}>{formatRange(row.range)}</td>
                            <td className={`${styles.cell} ${styles.mono}`}>
                              {row.blocks.map(formatBlock).join('  ')}
                            </td>
                            <td className={`${styles.cell} ${styles.mono} ${styles.numeric}`}>
                              {`${covered.toLocaleString('en-US')}${covered === expected ? ' ✓' : ' ✗'}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <BlockTable blocks={rangeResult.allBlocks} />

                <MessageBar intent="success">
                  <MessageBarBody>
                    <MessageBarTitle>为什么这个集合是最小的</MessageBarTitle>
                    每个 CIDR 都是一段 <code>[base, base + 2^k - 1]</code> 且 base 必须是
                    <code>2^k</code> 的整数倍。所以从地址 <code>x</code> 出发、又不越过终点的块，大小
                    最大只能是「<code>x</code> 的二进制对齐长度」与「剩余长度」中的较小者——本工具每次就取这个
                    上界，取满再前进。任何覆盖都必须有一块包含 <code>x</code>，而所有候选项都被这一块包含，
                    因此贪心结果同时是下界：它不只是一个最小集合，而是唯一的最小集合。
                  </MessageBarBody>
                </MessageBar>
              </>
            )}
          </>
        ) : (
          <>
            <div className={styles.toolbar}>
              <Caption1 className={styles.hint}>
                {`每行一个 CIDR；空行、# 与 // 注释忽略；带主机位的写法（如 192.168.1.5/24）会按网络地址规范化并提示，最多 ${MAX_INPUT_LINES} 行`}
              </Caption1>
              <div className={styles.examples}>
                <Button size="small" appearance="subtle" onClick={() => setCidrText(CIDR_EXAMPLE)}>
                  示例
                </Button>
                <Button size="small" appearance="subtle" onClick={() => setCidrText('10.0.0.0/24\n10.0.1.0/24')}>
                  相邻两块
                </Button>
                <Button size="small" appearance="subtle" onClick={() => setCidrText('192.168.1.0/24\n192.168.3.0/24')}>
                  不相邻（有空洞）
                </Button>
              </div>
            </div>

            <textarea
              className="wt-code-area"
              style={{ minHeight: '120px' }}
              value={cidrText}
              aria-label="CIDR 列表，每行一个"
              onChange={(event) => setCidrText(event.target.value)}
            />

            {cidrResult.parsed.errors.length > 0 && (
              <MessageBar intent="error">
                <MessageBarBody>
                  <MessageBarTitle>{`${cidrResult.parsed.errors.length} 行无法解析`}</MessageBarTitle>
                  {cidrResult.parsed.errors.map((error) => `${error.line}：${error.message}`).join('；')}
                </MessageBarBody>
              </MessageBar>
            )}

            {cidrResult.parsed.normalised.length > 0 && (
              <MessageBar intent="warning">
                <MessageBarBody>
                  <MessageBarTitle>有写法带主机位，已按网络地址处理</MessageBarTitle>
                  {cidrResult.parsed.normalised
                    .map((item) => `${item.input} → ${item.canonical}`)
                    .join('；')}
                </MessageBarBody>
              </MessageBar>
            )}

            {cidrResult.parsed.blocks.length > 0 && (
              <>
                <div className={styles.badges}>
                  <Badge appearance="tint" color="informative">
                    {`输入 ${cidrResult.parsed.blocks.length} 个块`}
                  </Badge>
                  <Badge appearance="tint" color={cidrResult.mergedAway > 0 ? 'success' : 'informative'}>
                    {`合并后 ${cidrResult.collapsed.blocks.length} 个块`}
                  </Badge>
                  <Badge appearance="tint" color="informative">
                    {`并集 ${cidrResult.collapsed.ranges.length} 段`}
                  </Badge>
                  <Badge appearance="tint" color="success">
                    {`去重后 ${cidrResult.uniqueTotal.toLocaleString('en-US')} 个地址`}
                  </Badge>
                  {cidrResult.inputTotal !== cidrResult.uniqueTotal && (
                    <Badge appearance="tint" color="warning" icon={<WarningRegular />}>
                      {`输入合计 ${cidrResult.inputTotal.toLocaleString('en-US')}，重叠 ${(
                        cidrResult.inputTotal - cidrResult.uniqueTotal
                      ).toLocaleString('en-US')}`}
                    </Badge>
                  )}
                  <Button
                    size="small"
                    appearance="subtle"
                    icon={copied === 'cidrBlocks' ? <CheckmarkRegular /> : <CopyRegular />}
                    onClick={() => onCopy('cidrBlocks', cidrBlocksText)}
                  >
                    {copied === 'cidrBlocks' ? '已复制' : '复制最小 CIDR 集合'}
                  </Button>
                  <Button
                    size="small"
                    appearance="subtle"
                    icon={copied === 'cidrRanges' ? <CheckmarkRegular /> : <CopyRegular />}
                    onClick={() => onCopy('cidrRanges', cidrRangesText)}
                  >
                    {copied === 'cidrRanges' ? '已复制' : '复制并集范围'}
                  </Button>
                </div>

                <Text as="h2" size={300} weight="semibold">
                  并集范围
                </Text>
                <pre className={styles.code}>{cidrRangesText}</pre>

                <Text as="h2" size={300} weight="semibold">
                  合并后的最小 CIDR 集合
                </Text>
                <pre className={styles.code}>{cidrBlocksText}</pre>

                <BlockTable blocks={cidrResult.collapsed.blocks} />

                <MessageBar intent="info">
                  <MessageBarBody>
                    地址数<strong>合计</strong>指块大小之和（0.0.0.0/0 是 4,294,967,296）。
                    网络工程里"可用主机数"另有口径：/31 按 RFC 3021 算 2 个，/32 算 1
                    个，其余前缀要扣掉网络地址与广播地址，表中两列都给出，避免把覆盖范围和可分配主机
                    混为一谈。
                  </MessageBarBody>
                </MessageBar>
              </>
            )}
          </>
        )}

        <Divider />
        <Caption1 className={styles.hint}>
          不做的事：这里只做集合运算上的最小覆盖/合并，不判断某个聚合是否"业务上允许发布"，
          不做最长前缀匹配、路由策略或归属查询。相邻的块会被合并，只是因为它们的并集确实
          是一个块，与谁去宣告它无关。
        </Caption1>
      </div>
    </div>
  );
}
