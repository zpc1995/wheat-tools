import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  Dropdown,
  MessageBar,
  MessageBarBody,
  Option,
  Switch,
  Tab,
  TabList,
  Text,
  Tooltip,
  makeStyles,
  tokens,
  useId,
  useToastController,
  Toast,
  ToastTitle,
  Toaster,
  type SelectTabData,
} from '@fluentui/react-components';
import {
  ArrowDownload16Regular,
  ArrowSync16Regular,
  Broom16Regular,
  Checkmark16Regular,
  Copy16Regular,
  History16Regular,
  Star16Filled,
  Star16Regular,
  TagRegular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  RANDOM_BYTES,
  ULID_LENGTH,
  decodeUlid,
  formatTimestampIso,
  generateBatch,
  normaliseUlid,
  randomToHex,
  validateUlid,
  type DecodedUlid,
  type MonotonicState,
  type UlidErrorReason,
} from './ulidUtils';

interface HistoryEntry {
  id: number;
  ulid: string;
  createdAt: Date;
  monotonic: boolean;
}

const COUNT_OPTIONS = [1, 5, 10, 50, 100];
const MONO_MONO = 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace';

/**
 * Draws the random bytes.
 *
 * This is the one place that touches the environment, and it lives in the
 * component rather than in the utility layer on purpose: the generators take
 * bytes as an argument so that a check can supply its own. `crypto` is absent
 * on plain-http LAN origins, where the tool would otherwise be unusable, so the
 * same last-resort fallback the UUID tool uses is kept — weaker unpredictability
 * is a better answer than no id at all.
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

function formatClock(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const ERROR_TEXT: Record<UlidErrorReason, string> = {
  length: `长度必须是 ${ULID_LENGTH} 个字符。`,
  alphabet: '含有 Crockford Base32 之外的字符（该字母表刻意不含 I、L、O、U）。',
  overflow: '首字符大于 7，时间戳超出 48 位上限。',
};

type DecodeView =
  | { kind: 'empty' }
  | { kind: 'invalid'; reason: UlidErrorReason }
  | { kind: 'valid'; decoded: DecodedUlid };

const useStyles = makeStyles({
  column: {
    flexDirection: 'column',
  },
  stage: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '24px 20px',
    alignItems: 'center',
    textAlign: 'center',
  },
  eyebrow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  latest: {
    fontFamily: MONO_MONO,
    fontSize: 'clamp(17px, 3vw, 27px)',
    fontWeight: 600,
    letterSpacing: '0.04em',
    wordBreak: 'break-all',
    fontVariantNumeric: 'tabular-nums',
    userSelect: 'all',
  },
  controls: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
  },
  countSelect: {
    minWidth: '132px',
  },
  batch: {
    width: '100%',
    minHeight: '140px',
    maxHeight: '280px',
    fontVariantNumeric: 'tabular-nums',
  },
  prefix: {
    color: tokens.colorNeutralForeground3,
  },
  decodeInput: {
    width: '100%',
  },
  decodeGrid: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    gap: '8px 16px',
    padding: '16px 18px',
    alignItems: 'baseline',
  },
  decodeLabel: {
    color: tokens.colorNeutralForeground3,
    whiteSpace: 'nowrap',
  },
  decodeValue: {
    fontFamily: MONO_MONO,
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 8px 10px 14px',
  },
  panelActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    marginLeft: 'auto',
  },
  historyScroll: {
    maxHeight: '340px',
    overflow: 'auto',
    width: '100%',
  },
  placeholder: {
    padding: '28px 16px',
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
  },
});

export function UlidGeneratorTool() {
  const styles = useStyles();
  const toasterId = useId('ulid-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [count, setCount] = useState(1);
  const [monotonic, setMonotonic] = useState(true);
  const [batch, setBatch] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<'all' | 'favorites'>('all');
  const [decodeInput, setDecodeInput] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  // Monotonic state and the history counter live in refs: neither belongs in
  // render state, and carrying the generator state across clicks is exactly
  // what makes "same millisecond" detection work between batches.
  const monotonicState = useRef<MonotonicState | null>(null);
  const counter = useRef(0);
  const didInit = useRef(false);

  const notify = useCallback(
    (title: string, intent: 'success' | 'error' = 'success') => {
      dispatchToast(
        <Toast>
          <ToastTitle>{title}</ToastTitle>
        </Toast>,
        { intent, timeout: 1500 },
      );
    },
    [dispatchToast],
  );

  const markCopied = useCallback((key: string) => {
    setCopied(key);
    window.setTimeout(() => {
      setCopied((current) => (current === key ? null : current));
    }, 1500);
  }, []);

  /** Generates `amount` ULIDs at one timestamp and records them in history. */
  const generate = useCallback((amount: number, useMonotonic: boolean) => {
    const result = generateBatch(
      amount,
      Date.now(),
      () => randomBytes(RANDOM_BYTES),
      monotonicState.current,
      useMonotonic,
    );
    monotonicState.current = result.monotonicState;

    const created = result.ulids.map((ulid) => {
      counter.current += 1;
      return {
        id: counter.current,
        ulid,
        createdAt: new Date(),
        monotonic: useMonotonic,
      };
    });

    setBatch(result.ulids);
    setHistory((previous) => [...created, ...previous]);
    return result.ulids;
  }, []);

  // A ULID appears as soon as the tool is opened. The ref guards against React
  // 18 StrictMode's double-invoked effects, which would otherwise record two
  // batches on mount.
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    const first = generate(count, monotonic);
    setDecodeInput(first[first.length - 1] ?? '');
    // Intentionally mount-only: changing the options must not generate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decodeView = useMemo<DecodeView>(() => {
    if (decodeInput.trim() === '') return { kind: 'empty' };
    const normalised = normaliseUlid(decodeInput);
    if (normalised === null) {
      return {
        kind: 'invalid',
        reason: validateUlid(decodeInput.trim().toUpperCase()) ?? 'alphabet',
      };
    }
    const decoded = decodeUlid(normalised);
    return decoded ? { kind: 'valid', decoded } : { kind: 'invalid', reason: 'alphabet' };
  }, [decodeInput]);

  const copyBatch = useCallback(async () => {
    if (batch.length === 0) return;
    const ok = await copyText(batch.join('\n'));
    if (ok) {
      markCopied('batch');
      notify(`已复制 ${batch.length} 个 ULID`);
    } else {
      notify('复制失败，请手动选择', 'error');
    }
  }, [batch, markCopied, notify]);

  const copyOne = useCallback(
    async (ulid: string, key: string) => {
      const ok = await copyText(ulid);
      if (ok) {
        markCopied(key);
        notify('已复制 ULID');
      } else {
        notify('复制失败，请手动选择', 'error');
      }
    },
    [markCopied, notify],
  );

  const handleExport = useCallback(() => {
    if (history.length === 0) return;
    const body = history
      .map((entry) => `${entry.ulid}\t${entry.createdAt.toISOString()}`)
      .join('\n');
    const blob = new Blob([`${body}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ulids-${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }, [history]);

  const visibleHistory = useMemo(
    () =>
      filter === 'favorites'
        ? history.filter((entry) => favorites.has(entry.id))
        : history,
    [filter, favorites, history],
  );

  const toggleFavorite = useCallback((id: number) => {
    setFavorites((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // The last element is the newest ULID: in monotonic order (and across
  // milliseconds) the greatest string is the most recently generated one.
  const latest = batch.length > 0 ? batch[batch.length - 1] : '';

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      {/* -------- Generate -------- */}
      <section className="wt-surface" aria-label="生成 ULID">
        <div className="wt-surface__header">
          <TagRegular />
          <Text as="h2" size={300} weight="semibold">
            生成 ULID
          </Text>
          <Badge appearance="tint" color="brand" size="small">
            26 位 · Crockford Base32
          </Badge>
          <div className={styles.panelActions}>
            <Caption1 className={styles.prefix}>
              本次进入已生成 {history.length} 个
            </Caption1>
          </div>
        </div>

        <div className={`wt-surface__body ${styles.column}`}>
          <div className={styles.stage}>
            <Text as="p" className={styles.latest} aria-live="polite" aria-label="最新 ULID">
              {latest || '—'}
            </Text>
            <Caption1 className={styles.eyebrow}>
              10 位时间戳 + 16 位随机数 · 字符串排序即时间排序
            </Caption1>

            <div className={styles.controls}>
              <Button
                appearance="primary"
                size="large"
                icon={<ArrowSync16Regular />}
                onClick={() => generate(count, monotonic)}
              >
                生成 {count} 个
              </Button>

              <Button
                appearance="secondary"
                size="large"
                icon={copied === 'latest' ? <Checkmark16Regular /> : <Copy16Regular />}
                onClick={() => copyOne(latest, 'latest')}
                disabled={!latest}
              >
                复制最新
              </Button>

              <Dropdown
                className={styles.countSelect}
                value={String(count)}
                selectedOptions={[String(count)]}
                onOptionSelect={(_, data) =>
                  setCount(Number(data.optionValue ?? 1))
                }
                aria-label="生成数量"
              >
                {COUNT_OPTIONS.map((value) => (
                  <Option key={value} value={String(value)} text={`${value} 个`}>
                    {`${value} 个`}
                  </Option>
                ))}
              </Dropdown>

              <Tooltip
                content="同一毫秒内复用时间戳、随机部分 +1，保证生成顺序与字符串顺序一致"
                relationship="description"
                withArrow
              >
                <Switch
                  checked={monotonic}
                  onChange={(_, data) => setMonotonic(data.checked)}
                  label="单调递增"
                />
              </Tooltip>
            </div>

            {monotonic && (
              <Caption1 className={styles.prefix}>
                单调递增：同一毫秒内随机部分自增（溢出时按规范报错，不伪造时间戳）
              </Caption1>
            )}
          </div>

          {batch.length > 1 && (
            <>
              <Divider />
              <div style={{ padding: '12px 14px 0' }}>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={copied === 'batch' ? <Checkmark16Regular /> : <Copy16Regular />}
                  onClick={copyBatch}
                >
                  {copied === 'batch' ? '已复制' : `复制全部 ${batch.length} 个`}
                </Button>
              </div>
              <textarea
                className={`wt-code-area ${styles.batch}`}
                value={batch.join('\n')}
                readOnly
                aria-label="本批生成的 ULID 列表"
                spellCheck={false}
              />
            </>
          )}
        </div>
      </section>

      {/* -------- Decode -------- */}
      <section className="wt-surface" aria-label="解码 ULID">
        <div className="wt-surface__header">
          <TagRegular />
          <Text as="h2" size={300} weight="semibold">
            解码
          </Text>
          <Caption1 className={styles.prefix}>反解时间戳与随机部分</Caption1>
          <div className={styles.panelActions}>
            <Button
              appearance="subtle"
              size="small"
              onClick={() => setDecodeInput(latest)}
              disabled={!latest}
            >
              填入最新
            </Button>
          </div>
        </div>

        <div className={`wt-surface__body ${styles.column}`}>
          <div style={{ padding: '14px 16px 0' }}>
            <input
              className={`wt-inline-input ${styles.decodeInput}`}
              value={decodeInput}
              onChange={(event) => setDecodeInput(event.target.value)}
              placeholder="粘贴 26 位 ULID，例如 01ARYZ6S41TSV4RRFFQ69G5FAV"
              aria-label="要解码的 ULID"
              spellCheck={false}
            />
          </div>

          {decodeView.kind === 'empty' && (
            <div className={styles.placeholder}>
              <Text>输入一个 ULID 即可看到它编码的时间戳与随机部分。</Text>
            </div>
          )}

          {decodeView.kind === 'invalid' && (
            <div style={{ padding: '12px 16px 16px' }}>
              <MessageBar intent="error">
                <MessageBarBody>
                  不是合法的 ULID：{ERROR_TEXT[decodeView.reason]}
                </MessageBarBody>
              </MessageBar>
            </div>
          )}

          {decodeView.kind === 'valid' && (
            <div className={styles.decodeGrid}>
              <Text className={styles.decodeLabel}>毫秒时间戳</Text>
              <Text className={styles.decodeValue}>
                {decodeView.decoded.timestamp}
              </Text>

              <Text className={styles.decodeLabel}>UTC 时间</Text>
              <Text className={styles.decodeValue}>
                {formatTimestampIso(decodeView.decoded.timestamp)}
              </Text>

              <Text className={styles.decodeLabel}>时间部分（前 10 位）</Text>
              <Text className={styles.decodeValue}>
                {normaliseUlid(decodeInput)?.slice(0, 10) ?? ''}
              </Text>

              <Text className={styles.decodeLabel}>随机部分（后 16 位）</Text>
              <Text className={styles.decodeValue}>{decodeView.decoded.random}</Text>

              <Text className={styles.decodeLabel}>随机字节（80 位）</Text>
              <Text className={styles.decodeValue}>
                {randomToHex(decodeView.decoded.randomBytes)}
              </Text>
            </div>
          )}
        </div>
      </section>

      {/* -------- History -------- */}
      <section className="wt-surface" aria-label="生成历史">
        <div className={`wt-surface__header ${styles.sectionHeader}`}>
          <History16Regular />
          <Text as="h2" size={300} weight="semibold">
            历史与收藏
          </Text>
          <Caption1 className={styles.prefix}>共 {history.length} 条</Caption1>

          <div className={styles.panelActions}>
            <TabList
              size="small"
              selectedValue={filter}
              onTabSelect={(_, data: SelectTabData) =>
                setFilter(data.value as 'all' | 'favorites')
              }
            >
              <Tab value="all">全部</Tab>
              <Tab value="favorites">收藏 ({favorites.size})</Tab>
            </TabList>
            <Divider vertical style={{ height: '20px' }} />
            <Tooltip content="导出为 txt" relationship="label" withArrow>
              <Button
                appearance="subtle"
                icon={<ArrowDownload16Regular />}
                onClick={handleExport}
                disabled={history.length === 0}
                aria-label="导出历史为 txt"
              />
            </Tooltip>
            <Tooltip content="清空历史" relationship="label" withArrow>
              <Button
                appearance="subtle"
                icon={<Broom16Regular />}
                onClick={() => {
                  setHistory([]);
                  setFavorites(new Set());
                  notify('已清空历史');
                }}
                disabled={history.length === 0}
                aria-label="清空历史"
              />
            </Tooltip>
          </div>
        </div>

        <div className="wt-surface__body">
          {visibleHistory.length === 0 ? (
            <div className={styles.placeholder}>
              <Text>
                {filter === 'favorites'
                  ? '还没有收藏的 ULID，点击列表左侧的星标即可收藏。'
                  : '进入工具后生成的所有 ULID 都会出现在这里。'}
              </Text>
            </div>
          ) : (
            <div className={styles.historyScroll}>
              {visibleHistory.map((entry) => (
                <div key={entry.id} className="wt-history__row">
                  <Caption1 className="wt-history__index">#{entry.id}</Caption1>
                  <button
                    type="button"
                    className="wt-history__value"
                    onClick={() => copyOne(entry.ulid, `entry-${entry.id}`)}
                    title="点击复制"
                  >
                    {entry.ulid}
                  </button>
                  <Caption1 className="wt-history__time">
                    {entry.monotonic ? '单调 ' : ''}
                    {formatClock(entry.createdAt)}
                  </Caption1>
                  <Tooltip
                    content={favorites.has(entry.id) ? '取消收藏' : '收藏'}
                    relationship="label"
                    withArrow
                  >
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={
                        favorites.has(entry.id) ? <Star16Filled /> : <Star16Regular />
                      }
                      onClick={() => toggleFavorite(entry.id)}
                      aria-label={favorites.has(entry.id) ? '取消收藏' : '收藏该条 ULID'}
                      aria-pressed={favorites.has(entry.id)}
                    />
                  </Tooltip>
                  <Tooltip content="复制" relationship="label" withArrow>
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={
                        copied === `entry-${entry.id}` ? (
                          <Checkmark16Regular />
                        ) : (
                          <Copy16Regular />
                        )
                      }
                      onClick={() => copyOne(entry.ulid, `entry-${entry.id}`)}
                      aria-label="复制该条 ULID"
                    />
                  </Tooltip>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
