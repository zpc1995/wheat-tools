import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  Dropdown,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  Tab,
  TabList,
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
  ArrowUpload16Regular,
  Broom16Regular,
  Checkmark16Regular,
  Copy16Regular,
  DocumentText16Regular,
  Search16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  BYTES_PER_ROW,
  MAX_FILE_BYTES,
  analyseBytes,
  buildHexRows,
  decodeText,
  detectSignature,
  extractStrings,
  formatSize,
  readWidths,
} from './hexUtils';

/** How many bytes are rendered per page; keeps the DOM small. */
const PAGE_SIZE = 8192;

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
    gap: '10px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  dump: {
    width: '100%',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12.5px',
    lineHeight: 1.6,
    maxHeight: '440px',
    overflow: 'auto',
    padding: '10px 0',
  },
  row: {
    display: 'flex',
    gap: '12px',
    padding: '0 14px',
    whiteSpace: 'pre',
    ':hover': { backgroundColor: tokens.colorSubtleBackgroundHover },
  },
  offset: {
    flex: 'none',
    color: tokens.colorNeutralForeground4,
    userSelect: 'none',
  },
  hex: {
    flex: 'none',
    color: tokens.colorNeutralForeground1,
  },
  ascii: {
    flex: '1 1 auto',
    color: tokens.colorBrandForeground1,
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxHeight: '360px',
    overflowY: 'auto',
  },
  row2: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    padding: '7px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  rowLabel: {
    flex: 'none',
    width: '110px',
    color: tokens.colorNeutralForeground3,
  },
  rowValue: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12.5px',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
    width: '100%',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '10px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  statValue: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '16px',
    fontVariantNumeric: 'tabular-nums',
  },
  text: {
    padding: '12px 14px',
    width: '100%',
    maxHeight: '360px',
    overflow: 'auto',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12.5px',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    userSelect: 'text',
  },
});

export function HexViewerTool() {
  const styles = useStyles();
  const toasterId = useId('hex-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState('');
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState<'dump' | 'text' | 'strings'>('dump');
  const [stringFilter, setStringFilter] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [encoding, setEncoding] = useState<'utf-8' | 'utf-16le' | 'latin1'>('utf-8');

  const picker = useRef<HTMLInputElement>(null);

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

  const load = useCallback(
    async (file: File) => {
      setError(null);
      if (file.size > MAX_FILE_BYTES) {
        setError(
          `文件 ${formatSize(file.size)} 超过上限 ${formatSize(MAX_FILE_BYTES)}。` +
            `更大的文件请先用命令行工具（如 xxd / hexdump）分段查看。`,
        );
        return;
      }
      try {
        setBytes(new Uint8Array(await file.arrayBuffer()));
        setFileName(file.name);
        setPage(0);
        setTab('dump');
      } catch {
        setError('读取文件失败');
      }
    },
    [],
  );

  const detection = useMemo(() => (bytes ? detectSignature(bytes) : null), [bytes]);
  const stats = useMemo(() => (bytes ? analyseBytes(bytes) : null), [bytes]);

  const strings = useMemo(
    () => (bytes && tab === 'strings' ? extractStrings(bytes) : []),
    [bytes, tab],
  );

  const filteredStrings = useMemo(() => {
    const query = stringFilter.trim().toLowerCase();
    if (!query) return strings;
    return strings.filter((hit) => hit.text.toLowerCase().includes(query));
  }, [strings, stringFilter]);

  const rows = useMemo(
    () => (bytes ? buildHexRows(bytes, page * PAGE_SIZE, PAGE_SIZE) : []),
    [bytes, page],
  );

  const totalPages = bytes ? Math.max(1, Math.ceil(bytes.length / PAGE_SIZE)) : 1;

  /** Sample reads at the first offset of the visible page. */
  const widths = useMemo(
    () => (bytes ? readWidths(bytes, page * PAGE_SIZE) : null),
    [bytes, page],
  );

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <input
        ref={picker}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void load(file);
          event.target.value = '';
        }}
      />

      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <Button
            appearance="primary"
            icon={<ArrowUpload16Regular />}
            onClick={() => picker.current?.click()}
          >
            选择文件
          </Button>
          {bytes && (
            <>
              <Badge appearance="tint" color="brand" size="medium">
                {fileName || '未命名'}
              </Badge>
              <Caption1 className={styles.hint}>
                {formatSize(bytes.length)} · {bytes.length.toLocaleString()} 字节
              </Caption1>
            </>
          )}
          <span className={styles.spacer} />
          <Button
            appearance="subtle"
            icon={<Broom16Regular />}
            onClick={() => {
              setBytes(null);
              setFileName('');
              setError(null);
            }}
            disabled={!bytes}
          >
            清除
          </Button>
        </div>

        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}

        {!bytes && !error && (
          <section className="wt-surface">
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className="wt-empty">
                <DocumentText16Regular />
                <Text weight="semibold">选择一个文件开始查看</Text>
                <Caption1>
                  文件只在本地读取，不会上传。上限 {formatSize(MAX_FILE_BYTES)}。
                </Caption1>
              </div>
            </div>
          </section>
        )}

        {bytes && stats && (
          <>
            <section className="wt-surface" aria-label="文件识别">
              <div className="wt-surface__header">
                <Text size={300} weight="semibold">
                  文件识别
                </Text>
                {detection ? (
                  <Badge appearance="tint" color="success" size="small">
                    已识别
                  </Badge>
                ) : (
                  <Badge appearance="tint" color="warning" size="small">
                    未匹配已知特征
                  </Badge>
                )}
                <span className={styles.spacer} />
                <Caption1 className={styles.hint}>
                  依据文件头字节判断，比扩展名可靠
                </Caption1>
              </div>
              <div className={`wt-surface__body ${styles.rows}`}>
                <div className={styles.row2}>
                  <Text className={styles.rowLabel} size={200}>
                    类型
                  </Text>
                  <span className={styles.rowValue}>
                    {detection ? detection.name : '未知（没有匹配到内置的文件特征）'}
                  </span>
                </div>
                {detection && (
                  <div className={styles.row2}>
                    <Text className={styles.rowLabel} size={200}>
                      常见后缀
                    </Text>
                    <span className={styles.rowValue}>
                      {detection.extension || '（无固定后缀）'} · 匹配 {detection.matched} 字节
                    </span>
                  </div>
                )}
              </div>
            </section>

            <section className="wt-surface" aria-label="字节统计">
              <div className="wt-surface__header">
                <Text size={300} weight="semibold">
                  字节统计
                </Text>
                <span className={styles.spacer} />
                <Caption1 className={styles.hint}>
                  熵接近 8 位/字节通常表示已压缩或已加密
                </Caption1>
              </div>
              <div className={`wt-surface__body ${styles.stats}`}>
                {[
                  ['总字节', stats.total.toLocaleString()],
                  ['熵', `${stats.entropy.toFixed(3)} 位/字节`],
                  ['可打印字符占比', `${(stats.printableRatio * 100).toFixed(1)}%`],
                  ['零字节', stats.nullBytes.toLocaleString()],
                  ['非零字节种类', String(stats.histogram.filter((c) => c > 0).length)],
                ].map(([label, value]) => (
                  <div key={label} className={styles.stat}>
                    <Caption1 className={styles.hint}>{label}</Caption1>
                    <span className={styles.statValue}>{value}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="wt-surface" aria-label="内容">
              <div className="wt-surface__header">
                <TabList
                  size="small"
                  selectedValue={tab}
                  onTabSelect={(_, data) =>
                    setTab(data.value as 'dump' | 'text' | 'strings')
                  }
                >
                  <Tab value="dump">十六进制</Tab>
                  <Tab value="text">文本</Tab>
                  <Tab value="strings">可读字符串</Tab>
                </TabList>
                <span className={styles.spacer} />
                {tab === 'dump' && (
                  <>
                    <Tooltip content="复制本页十六进制" relationship="label" withArrow>
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={
                          copied === 'dump' ? (
                            <Checkmark16Regular />
                          ) : (
                            <Copy16Regular />
                          )
                        }
                        onClick={() =>
                          copy(
                            rows
                              .map(
                                (row) =>
                                  `${row.offset.toString(16).padStart(8, '0')}  ${row.hex.join(' ')}  |${row.ascii}|`,
                              )
                              .join('\n'),
                            'dump',
                          )
                        }
                        aria-label="复制本页十六进制"
                      />
                    </Tooltip>
                    <Caption1 className={styles.hint}>
                      第 {page + 1} / {totalPages} 页
                    </Caption1>
                    <Button
                      appearance="subtle"
                      size="small"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                    >
                      上一页
                    </Button>
                    <Button
                      appearance="subtle"
                      size="small"
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                    >
                      下一页
                    </Button>
                  </>
                )}
                {tab === 'text' && (
                  <Dropdown
                    style={{ minWidth: 140 }}
                    value={encoding}
                    selectedOptions={[encoding]}
                    onOptionSelect={(_, data) =>
                      setEncoding(data.optionValue as typeof encoding)
                    }
                    aria-label="文本编码"
                  >
                    <Option value="utf-8" text="UTF-8">
                      UTF-8
                    </Option>
                    <Option value="utf-16le" text="UTF-16LE">
                      UTF-16LE
                    </Option>
                    <Option value="latin1" text="Latin-1">
                      Latin-1
                    </Option>
                  </Dropdown>
                )}
                {tab === 'strings' && (
                  <>
                    <Search16Regular />
                    <Input
                      style={{ width: 160 }}
                      value={stringFilter}
                      onChange={(_, data) => setStringFilter(data.value)}
                      placeholder="过滤字符串"
                      aria-label="过滤字符串"
                    />
                  </>
                )}
              </div>

              <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                {tab === 'dump' && (
                  <div className={styles.dump}>
                    {rows.length === 0 ? (
                      <Caption1 className={styles.hint} style={{ padding: '0 14px' }}>
                        文件为空
                      </Caption1>
                    ) : (
                      rows.map((row) => (
                        <div key={row.offset} className={styles.row}>
                          <span className={styles.offset}>
                            {row.offset.toString(16).padStart(8, '0')}
                          </span>
                          <span className={styles.hex}>
                            {row.hex.join(' ').padEnd(BYTES_PER_ROW * 3 - 1, ' ')}
                          </span>
                          <span className={styles.ascii}>|{row.ascii}|</span>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {tab === 'text' && (
                  <div className={styles.text}>{decodeText(bytes, encoding)}</div>
                )}

                {tab === 'strings' && (
                  <div className={styles.rows}>
                    {filteredStrings.length === 0 ? (
                      <div className={styles.row2}>
                        <Caption1 className={styles.hint}>
                          {strings.length === 0
                            ? '没有找到长度 ≥ 4 的可读字符串'
                            : '没有匹配的字符串'}
                        </Caption1>
                      </div>
                    ) : (
                      filteredStrings.map((hit) => (
                        <div key={`${hit.offset}-${hit.text}`} className={styles.row2}>
                          <Caption1 className={styles.hint}>
                            0x{hit.offset.toString(16)}
                          </Caption1>
                          <span className={styles.rowValue}>{hit.text}</span>
                          <Tooltip content="复制" relationship="label" withArrow>
                            <Button
                              appearance="subtle"
                              size="small"
                              icon={
                                copied === `s${hit.offset}` ? (
                                  <Checkmark16Regular />
                                ) : (
                                  <Copy16Regular />
                                )
                              }
                              onClick={() =>
                                copy(hit.text, `s${hit.offset}`)
                              }
                              aria-label="复制该字符串"
                            />
                          </Tooltip>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </section>

            {widths && tab === 'dump' && (
              <section className="wt-surface" aria-label="数值解读">
                <div className="wt-surface__header">
                  <Text size={300} weight="semibold">
                    按不同宽度解读（偏移 0x{(page * PAGE_SIZE).toString(16)}）
                  </Text>
                  <span className={styles.spacer} />
                  <Caption1 className={styles.hint}>
                    小端 / 大端同时给出，便于判定位序
                  </Caption1>
                </div>
                <div className={`wt-surface__body ${styles.rows}`}>
                  {Object.keys(widths.little).map((key) => (
                    <div key={key} className={styles.row2}>
                      <Text className={styles.rowLabel} size={200}>
                        {key}
                      </Text>
                      <span className={styles.rowValue}>
                        小端 {widths.little[key]} · 大端 {widths.big[key]}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        <MessageBar intent="info">
          <MessageBarBody>
            文件在浏览器本地读取，不会上传。十六进制按每行 {BYTES_PER_ROW} 字节显示，
            右侧是该行的可打印字符（不可打印显示为 <code>.</code>）。
            「可读字符串」提取等同于 <code>strings</code> 命令的常用行为，
            用来快速找出二进制里内嵌的 URL、路径或提示文本。
          </MessageBarBody>
        </MessageBar>

        <Divider />
      </div>
    </>
  );
}
