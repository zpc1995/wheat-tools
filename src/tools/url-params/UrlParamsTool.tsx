import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Checkbox,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
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
  Add16Regular,
  Checkmark16Regular,
  Copy16Regular,
  Delete16Regular,
  Filter16Regular,
  Link16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  DEFAULT_BUILD_OPTIONS,
  URL_EDITOR_SAMPLES,
  breakdown,
  buildUrl,
  collectStats,
  diffParams,
  makeParam,
  normaliseInput,
  parseUrl,
  stripTracking,
  type BuildOptions,
  type ParamRow,
} from './urlParamsUtils';

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  urlRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    padding: '12px 14px',
    flexWrap: 'wrap',
    width: '100%',
  },
  urlInput: {
    flex: '1 1 320px',
    minWidth: '220px',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13.5px',
  },
  table: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxHeight: '420px',
    overflowY: 'auto',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  cell: {
    flex: '1 1 0',
    minWidth: 0,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 14px',
    color: tokens.colorNeutralForeground4,
    fontSize: '12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12.5px',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  output: {
    padding: '14px',
    width: '100%',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
    lineHeight: 1.7,
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
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
    overflowWrap: 'anywhere',
  },
  kvRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    padding: '7px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  kvLabel: {
    flex: 'none',
    width: '110px',
    color: tokens.colorNeutralForeground3,
  },
  presets: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    padding: '12px 14px',
    width: '100%',
  },
});

/** Rows parsed from a URL, used both for the initial state and for samples. */
function rowsFrom(url: string): ParamRow[] {
  const parsed = parseUrl(normaliseInput(url));
  return 'error' in parsed ? [] : parsed.rows;
}

export function UrlParamsTool() {
  const styles = useStyles();
  const toasterId = useId('urlp-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [input, setInput] = useState(URL_EDITOR_SAMPLES[0].url);
  // Lazy initialiser rather than deriving during render: the rows are editable
  // state, so they must be seeded exactly once.
  const [rows, setRows] = useState<ParamRow[]>(() => rowsFrom(URL_EDITOR_SAMPLES[0].url));
  const [options, setOptions] = useState<BuildOptions>(DEFAULT_BUILD_OPTIONS);
  const [view, setView] = useState<'params' | 'structure' | 'compare'>('params');
  const [compareInput, setCompareInput] = useState('');
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

  const parsed = useMemo(() => parseUrl(normaliseInput(input)), [input]);

  /** Loads a URL into the editor, replacing the current rows. */
  const load = useCallback((url: string) => {
    setInput(url);
    setRows(rowsFrom(url));
  }, []);

  const output = useMemo(
    () => ('error' in parsed ? '' : buildUrl(parsed, rows, options)),
    [parsed, rows, options],
  );

  const stats = useMemo(() => collectStats(rows, output), [rows, output]);

  const structure = useMemo(
    () => breakdown(output || normaliseInput(input)),
    [output, input],
  );

  const comparison = useMemo(() => {
    if (!compareInput.trim() || 'error' in parsed) return null;
    const other = parseUrl(normaliseInput(compareInput));
    if ('error' in other) return null;
    return diffParams(rows, other.rows);
  }, [compareInput, rows, parsed]);

  const update = (id: string, patch: Partial<ParamRow>) =>
    setRows((previous) =>
      previous.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );

  const doStripTracking = () => {
    const { rows: kept, removed } = stripTracking(rows);
    setRows(kept);
    notify(removed > 0 ? `已移除 ${removed} 个跟踪参数` : '没有发现跟踪参数');
  };

  const duplicateGroups = stats.duplicates;

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <section className="wt-surface" aria-label="URL 输入">
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.urlRow}>
              <Link16Regular style={{ color: tokens.colorBrandForeground1 }} />
              <input
                className={`wt-inline-input ${styles.urlInput}`}
                value={input}
                onChange={(event) => load(event.target.value)}
                placeholder="粘贴带参数的 URL，或直接粘贴 a=1&b=2"
                aria-label="URL"
                spellCheck={false}
              />
              <Tooltip content="复制重建后的 URL" relationship="label" withArrow>
                <Button
                  appearance="primary"
                  icon={copied === 'out' ? <Checkmark16Regular /> : <Copy16Regular />}
                  onClick={() => copy(output, 'out')}
                  disabled={!output}
                >
                  复制结果
                </Button>
              </Tooltip>
            </div>

            <div className={styles.presets}>
              {URL_EDITOR_SAMPLES.map((sample) => (
                <Tooltip
                  key={sample.label}
                  content={sample.note}
                  relationship="description"
                  withArrow
                >
                  <Button
                    appearance="secondary"
                    size="small"
                    onClick={() => load(sample.url)}
                  >
                    {sample.label}
                  </Button>
                </Tooltip>
              ))}
            </div>
          </div>
        </section>

        {'error' in parsed && (
          <MessageBar intent="error">
            <MessageBarBody>{parsed.error}</MessageBarBody>
          </MessageBar>
        )}

        {!(('error' in parsed)) && parsed.warnings.length > 0 && (
          <MessageBar intent="warning">
            <MessageBarBody>
              <MessageBarTitle>
                <Warning16Regular /> 解析提示
              </MessageBarTitle>
              {parsed.warnings.join('；')}
            </MessageBarBody>
          </MessageBar>
        )}

        {/* The reason this is a list editor and not a key/value form. */}
        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>为什么按行编辑而不是用键值表单</MessageBarTitle>
            同一个键可以在查询串里出现多次（<code>?tag=a&amp;tag=b</code>），顺序也可能有意义。
            用对象或表单来编辑会静默丢掉重复键并打乱顺序，所以这里按行编辑、原样保留。
            「不重新编码」模式还会原样输出原始转义字节——带签名的 URL 一旦重新编码就会验签失败
            （<code>%2B</code> 与 <code>+</code> 解码后都是 <code>+</code>，无法还原）。
          </MessageBarBody>
        </MessageBar>

        <section className="wt-surface" aria-label="参数">
          <div className="wt-surface__header">
            <TabList
              selectedValue={view}
              onTabSelect={(_, data) =>
                setView(data.value as 'params' | 'structure' | 'compare')
              }
            >
              <Tab value="params">
                参数{stats.enabled > 0 && ` (${stats.enabled})`}
              </Tab>
              <Tab value="structure">结构</Tab>
              <Tab value="compare">对比</Tab>
            </TabList>
            <span className={styles.spacer} />
            {duplicateGroups > 0 && (
              <Tooltip
                content="有重复键，这正是对象模型会丢数据的情况"
                relationship="description"
                withArrow
              >
                <Badge appearance="tint" color="warning" size="small">
                  {duplicateGroups} 组重复键
                </Badge>
              </Tooltip>
            )}
            {view === 'params' && (
              <>
                <Tooltip content="移除常见的跟踪参数" relationship="label" withArrow>
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<Filter16Regular />}
                    onClick={doStripTracking}
                    disabled={rows.length === 0}
                  >
                    清理跟踪参数
                  </Button>
                </Tooltip>
                <Tooltip content="复制结果" relationship="label" withArrow>
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={copied === 'out2' ? <Checkmark16Regular /> : <Copy16Regular />}
                    onClick={() => copy(output, 'out2')}
                    disabled={!output}
                    aria-label="复制结果"
                  />
                </Tooltip>
              </>
            )}
          </div>

          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            {view === 'params' && (
              <>
                <div className={styles.table}>
                  <div className={styles.head}>
                    <span style={{ flex: '1 1 0' }}>参数名</span>
                    <span style={{ flex: '1 1 0' }}>参数值</span>
                    <span style={{ width: 74 }}>无值</span>
                    <span style={{ width: 32 }} />
                  </div>

                  {rows.length === 0 && (
                    <div className={styles.row}>
                      <Caption1 className={styles.hint}>
                        该地址没有查询参数，可点下方「添加参数」。
                      </Caption1>
                    </div>
                  )}

                  {rows.map((row) => (
                    <div key={row.id} className={styles.row}>
                      <input
                        className={`wt-inline-input ${styles.cell}`}
                        value={row.key}
                        onChange={(event) => update(row.id, { key: event.target.value })}
                        placeholder="参数名"
                        aria-label="参数名"
                        spellCheck={false}
                      />
                      <input
                        className={`wt-inline-input ${styles.cell}`}
                        value={row.value}
                        onChange={(event) =>
                          update(row.id, {
                            value: event.target.value,
                            // Typing a value means it is no longer valueless.
                            valueless: false,
                          })
                        }
                        placeholder="参数值"
                        aria-label="参数值"
                        spellCheck={false}
                      />
                      <Tooltip
                        content="输出为 ?flag 而不是 ?flag=（两种写法含义可能不同）"
                        relationship="description"
                        withArrow
                      >
                        <Checkbox
                          style={{ width: 74 }}
                          checked={row.valueless}
                          onChange={(_, data) =>
                            update(row.id, {
                              valueless: Boolean(data.checked),
                              value: data.checked ? '' : row.value,
                            })
                          }
                          aria-label="无值参数"
                        />
                      </Tooltip>
                      <Tooltip content="删除该行" relationship="label" withArrow>
                        <Button
                          appearance="subtle"
                          size="small"
                          icon={<Delete16Regular />}
                          onClick={() =>
                            setRows((previous) =>
                              previous.filter((item) => item.id !== row.id),
                            )
                          }
                          aria-label="删除该行"
                        />
                      </Tooltip>
                    </div>
                  ))}

                  <div className={styles.row}>
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={<Add16Regular />}
                      onClick={() => setRows((previous) => [...previous, makeParam()])}
                    >
                      添加参数
                    </Button>
                  </div>
                </div>

                <Divider />

                <div className={styles.urlRow}>
                  <Checkbox
                    checked={options.encode}
                    onChange={(_, data) =>
                      setOptions((current) => ({
                        ...current,
                        encode: Boolean(data.checked),
                      }))
                    }
                    label="重新编码（取消后原样输出原始转义字节）"
                  />
                  <Checkbox
                    checked={options.keepValueless}
                    onChange={(_, data) =>
                      setOptions((current) => ({
                        ...current,
                        keepValueless: Boolean(data.checked),
                      }))
                    }
                    label="保留无值参数写法"
                  />
                </div>
              </>
            )}

            {view === 'structure' && (
              <div style={{ width: '100%' }}>
                {[
                  ['协议', structure.protocol || '（非绝对地址）'],
                  ['用户名', structure.username || '—'],
                  ['主机', structure.host || '—'],
                  ['端口', structure.port || '（默认）'],
                  ['路径', structure.path || '/'],
                  ['查询串长度', `${stats.queryLength} 字符`],
                  ['片段', structure.fragment || '—'],
                ].map(([label, value]) => (
                  <div key={label} className={styles.kvRow}>
                    <Text className={styles.kvLabel} size={200}>
                      {label}
                    </Text>
                    <span className={`${styles.cell} ${styles.mono}`}>{value}</span>
                  </div>
                ))}
              </div>
            )}

            {view === 'compare' && (
              <div style={{ width: '100%', padding: '12px 14px' }}>
                <Caption1 className={styles.hint}>
                  粘贴另一个 URL，对比两侧的参数差异（重复键作为整体比较）
                </Caption1>
                <input
                  className={`wt-inline-input ${styles.urlInput}`}
                  style={{ width: '100%', marginTop: 8 }}
                  value={compareInput}
                  onChange={(event) => setCompareInput(event.target.value)}
                  placeholder="另一个 URL…"
                  aria-label="对比 URL"
                  spellCheck={false}
                />

                {comparison && (
                  <div style={{ marginTop: 12 }}>
                    {comparison.onlyInA.length === 0 &&
                      comparison.onlyInB.length === 0 &&
                      comparison.changed.length === 0 && (
                        <Caption1 className={styles.hint}>
                          两侧参数完全一致（{comparison.same.length} 个）。
                        </Caption1>
                      )}

                    {comparison.onlyInA.map((row) => (
                      <div key={`a${row.id}`} className={styles.kvRow}>
                        <Badge appearance="tint" color="danger" size="small">
                          仅左侧
                        </Badge>
                        <span className={`${styles.cell} ${styles.mono}`}>
                          {row.key}={row.value}
                        </span>
                      </div>
                    ))}

                    {comparison.onlyInB.map((row) => (
                      <div key={`b${row.id}`} className={styles.kvRow}>
                        <Badge appearance="tint" color="success" size="small">
                          仅右侧
                        </Badge>
                        <span className={`${styles.cell} ${styles.mono}`}>
                          {row.key}={row.value}
                        </span>
                      </div>
                    ))}

                    {comparison.changed.map((item) => (
                      <div key={`c${item.key}`} className={styles.kvRow}>
                        <Badge appearance="tint" color="warning" size="small">
                          值不同
                        </Badge>
                        <span className={`${styles.cell} ${styles.mono}`}>
                          {item.key}：{item.from} → {item.to}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {!comparison && compareInput.trim() !== '' && (
                  <Caption1 className={styles.hint} style={{ marginTop: 8, display: 'block' }}>
                    右侧地址无法解析。
                  </Caption1>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="wt-surface" aria-label="重建结果">
          <div className="wt-surface__header">
            <Text size={300} weight="semibold">
              重建后的 URL
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              {options.encode ? '已重新编码' : '保留原始转义字节'}
            </Caption1>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.output}>{output || '（无有效输入）'}</div>
          </div>
        </section>

        <section className="wt-surface" aria-label="统计">
          <div className={`wt-surface__body ${styles.stats}`}>
            {[
              ['参数总数', String(stats.total)],
              ['重复键组数', String(stats.duplicates)],
              ['空值参数', String(stats.emptyValues)],
              ['查询串长度', `${stats.queryLength} 字符`],
            ].map(([label, value]) => (
              <div key={label} className={styles.stat}>
                <Caption1 className={styles.hint}>{label}</Caption1>
                <span className={styles.statValue}>{value}</span>
              </div>
            ))}
          </div>
        </section>

        <Caption1 className={styles.hint} style={{ padding: '0 4px' }}>
          提示：查询串里常带 token、邮箱等敏感信息。本工具只在浏览器本地解析，
          不会把地址发往任何地方——但分享截图或链接前请自行确认。
        </Caption1>

        <Divider />
      </div>
    </>
  );
}
