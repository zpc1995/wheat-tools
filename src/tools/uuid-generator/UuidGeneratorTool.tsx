import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  Dropdown,
  Option,
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
  Tab,
  TabList,
} from '@fluentui/react-components';
import {
  ArrowDownload16Regular,
  ArrowSync16Regular,
  Broom16Regular,
  Checkmark16Regular,
  Copy16Regular,
  History16Regular,
  Info16Regular,
  Key16Regular,
  Star16Filled,
  Star16Regular,
} from '@fluentui/react-icons';
import {
  UUID_FORMAT_LABELS,
  formatTime,
  formatUuid,
  uuidV4,
  type UuidFormat,
} from './uuid';
import { copyText } from '../json-formatter/jsonUtils';

interface HistoryEntry {
  id: number;
  uuid: string;
  createdAt: Date;
}

function describeUuid(uuid: string): string {
  const match = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i.exec(
    uuid,
  );
  if (!match) return '非标准格式';
  return `time_low ${match[1]} · time_mid ${match[2]} · time_hi ${match[3]} · clock_seq ${match[4]} · node ${match[5]}`;
}

const useStyles = makeStyles({
  stage: {
    display: 'flex',
    flexDirection: 'column',
  },
  eyebrow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  uuidValue: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    userSelect: 'all',
  },
  controls: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
  },
  formatSelect: {
    minWidth: '148px',
  },
  segmented: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  historyHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 8px 10px 14px',
  },
  historyScroll: {
    maxHeight: '320px',
    overflow: 'auto',
    width: '100%',
  },
  placeholder: {
    padding: '28px 16px',
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
  },
  panelActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    marginLeft: 'auto',
  },
});

export function UuidGeneratorTool() {
  const styles = useStyles();
  const toasterId = useId('uuid-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [uuid, setUuid] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [format, setFormat] = useState<UuidFormat>('lower');
  const [autoCopy, setAutoCopy] = useState(false);
  const [copiedId, setCopiedId] = useState<number | 'current' | null>(null);
  const [filter, setFilter] = useState<'all' | 'favorites'>('all');
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const counter = useRef(0);

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

  /** Creates a new UUID, prepends it to the session history and returns it. */
  const generate = useCallback(() => {
    const next = uuidV4();
    counter.current += 1;
    setUuid(next);
    setHistory((previous) => [
      { id: counter.current, uuid: next, createdAt: new Date() },
      ...previous,
    ]);
    return next;
  }, []);

  // The tool contract says a UUID appears as soon as the tool is opened.
  // Refs guard against React 18 StrictMode's double-invoked effects, which
  // would otherwise create two entries on mount.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    const initial = generate();
    if (autoCopy && initial) {
      void copyText(initial);
    }
    // Intentionally mount-only: changing these options must not regenerate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displayValue = useMemo(
    () => (uuid ? formatUuid(uuid, format) : ''),
    [uuid, format],
  );

  const handleCopyCurrent = useCallback(async () => {
    if (!displayValue) return;
    const ok = await copyText(displayValue);
    if (ok) {
      setCopiedId('current');
      window.setTimeout(() => setCopiedId(null), 1500);
      notify('已复制 UUID');
    } else {
      notify('复制失败，请手动选择', 'error');
    }
  }, [displayValue, notify]);

  const handleCopyEntry = useCallback(
    async (entry: HistoryEntry) => {
      const ok = await copyText(formatUuid(entry.uuid, format));
      if (ok) {
        setCopiedId(entry.id);
        window.setTimeout(() => setCopiedId(null), 1500);
        notify('已复制该条 UUID');
      } else {
        notify('复制失败，请手动选择', 'error');
      }
    },
    [format, notify],
  );

  const handleExport = useCallback(() => {
    if (history.length === 0) return;
    const body = history
      .map(
        (entry) =>
          `${formatUuid(entry.uuid, format)}\t${entry.createdAt.toISOString()}`,
      )
      .join('\n');
    const blob = new Blob([`${body}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `uuids-${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }, [history, format]);

  const visibleHistory = useMemo(
    () =>
      filter === 'favorites'
        ? history.filter((entry) => favorites.has(entry.id))
        : history,
    [history, filter, favorites],
  );

  const toggleFavorite = useCallback((id: number) => {
    setFavorites((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      {/* -------- Current UUID stage -------- */}
      <section className="wt-surface" aria-label="当前 UUID">
        <div className="wt-surface__header">
          <Key16Regular />
          <Text as="h2" size={300} weight="semibold">
            当前 UUID
          </Text>
          <Badge appearance="tint" color="brand" size="small">
            v4 随机
          </Badge>
          <div className={styles.panelActions}>
            {displayValue && (
              <Tooltip
                content={describeUuid(uuid)}
                relationship="description"
                withArrow
              >
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<Info16Regular />}
                >
                  结构
                </Button>
              </Tooltip>
            )}
          </div>
        </div>

        <div className={`wt-uuid-display ${styles.stage}`}>
          <Caption1 className={styles.eyebrow}>
            本次进入工具已生成 {history.length} 个
          </Caption1>

          <Text
            as="p"
            className={`wt-uuid-value ${styles.uuidValue}`}
            aria-live="polite"
            aria-label="当前 UUID"
          >
            {displayValue || '—'}
          </Text>

          <div className={styles.controls}>
            <Button
              appearance="primary"
              size="large"
              icon={<ArrowSync16Regular />}
              onClick={() => {
                const next = generate();
                if (autoCopy) void copyText(formatUuid(next, format));
              }}
            >
              生成新 UUID
            </Button>

            <Button
              appearance="secondary"
              size="large"
              icon={
                copiedId === 'current' ? (
                  <Checkmark16Regular />
                ) : (
                  <Copy16Regular />
                )
              }
              onClick={handleCopyCurrent}
              disabled={!displayValue}
            >
              复制
            </Button>

            <Dropdown
              className={styles.formatSelect}
              value={UUID_FORMAT_LABELS[format]}
              selectedOptions={[format]}
              onOptionSelect={(_, data) =>
                setFormat(data.optionValue as UuidFormat)
              }
              aria-label="UUID 显示格式"
            >
              {(Object.keys(UUID_FORMAT_LABELS) as UuidFormat[]).map((key) => (
                <Option key={key} value={key}>
                  {UUID_FORMAT_LABELS[key]}
                </Option>
              ))}
            </Dropdown>

            <Tooltip
              content="每次生成后自动写入剪贴板"
              relationship="description"
              withArrow
            >
              <Button
                appearance={autoCopy ? 'primary' : 'subtle'}
                icon={<Copy16Regular />}
                onClick={() => setAutoCopy((value) => !value)}
                aria-pressed={autoCopy}
              >
                自动复制{autoCopy ? '：开' : '：关'}
              </Button>
            </Tooltip>
          </div>
        </div>
      </section>

      {/* -------- History -------- */}
      <section className="wt-surface" aria-label="生成历史">
        <div className={`wt-surface__header ${styles.historyHeader}`}>
          <History16Regular />
          <Text as="h2" size={300} weight="semibold">
            生成历史
          </Text>
          <Caption1>共 {history.length} 条</Caption1>

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
                  ? '还没有收藏的 UUID，点击列表左侧的星标即可收藏。'
                  : '进入工具后生成的所有 UUID 都会出现在这里。'}
              </Text>
            </div>
          ) : (
            <div className={styles.historyScroll}>
              {visibleHistory.map((entry) => {
                const index = history.length - history.indexOf(entry);
                return (
                  <div key={entry.id} className="wt-history__row">
                    <Caption1 className="wt-history__index">#{index}</Caption1>
                    <button
                      type="button"
                      className="wt-history__value"
                      onClick={() => handleCopyEntry(entry)}
                      title="点击复制"
                    >
                      {formatUuid(entry.uuid, format)}
                    </button>
                    <Caption1 className="wt-history__time">
                      {formatTime(entry.createdAt)}
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
                          favorites.has(entry.id) ? (
                            <Star16Filled />
                          ) : (
                            <Star16Regular />
                          )
                        }
                        onClick={() => toggleFavorite(entry.id)}
                        aria-label={
                          favorites.has(entry.id) ? '取消收藏' : '收藏该条 UUID'
                        }
                        aria-pressed={favorites.has(entry.id)}
                      />
                    </Tooltip>
                    <Tooltip content="复制" relationship="label" withArrow>
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={
                          copiedId === entry.id ? (
                            <Checkmark16Regular />
                          ) : (
                            <Copy16Regular />
                          )
                        }
                        onClick={() => handleCopyEntry(entry)}
                        aria-label="复制该条 UUID"
                      />
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
