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
  Tooltip,
  Toast,
  ToastTitle,
  Toaster,
  makeStyles,
  tokens,
  useId,
  useToastController,
} from '@fluentui/react-components';
import {
  Checkmark16Regular,
  Copy16Regular,
  Info16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import { ListFilter, NoMatches } from '../../components/ListFilter';
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  HTTP_STATUS_CODES,
  KIND_LABELS,
  countByCategory,
  searchStatusCodes,
  statusCodeText,
  type HttpStatusEntry,
  type StatusCategory,
  type StatusKind,
} from './httpStatusCodesUtils';

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
    padding: '10px 14px 0',
    width: '100%',
  },
  spacer: {
    flex: '1 1 auto',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    padding: '10px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  codeButton: {
    flex: 'none',
    minWidth: '78px',
    justifyContent: 'space-between',
  },
  codeText: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '14px',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.5px',
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    flex: '1 1 auto',
    minWidth: 0,
  },
  titleLine: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: '8px',
  },
  name: {
    fontWeight: 600,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13.5px',
    overflowWrap: 'anywhere',
  },
  source: {
    color: tokens.colorNeutralForeground3,
    fontVariantNumeric: 'tabular-nums',
  },
  zh: {
    color: tokens.colorNeutralForeground2,
  },
  note: {
    color: tokens.colorNeutralForeground3,
  },
});

/**
 * Badge colour per normativity. Deliberately not colour-only information: the
 * badge always carries its Chinese label too, so the distinction survives a
 * colour-blind reader and a monochrome screenshot.
 */
const KIND_COLORS: Record<
  StatusKind,
  'informative' | 'warning' | 'subtle' | 'danger'
> = {
  standard: 'informative',
  deprecated: 'warning',
  reserved: 'subtle',
  nonstandard: 'danger',
};

export function HttpStatusCodesTool() {
  const styles = useStyles();
  const toasterId = useId('http-status-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [category, setCategory] = useState<StatusCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<number | null>(null);

  const counts = useMemo(() => countByCategory(HTTP_STATUS_CODES), []);
  const total = HTTP_STATUS_CODES.length;

  const visible = useMemo(
    () => searchStatusCodes(query, category),
    [query, category],
  );

  /**
   * Matches outside the selected class.
   *
   * The class tabs and the search box are combined with AND, which is
   * predictable but can hide a hit: searching "418" while the 2xx tab is
   * selected finds nothing even though the code exists. This count powers an
   * explicit "search all classes" escape hatch in the empty state, instead of
   * silently widening the search and making the tab look broken.
   */
  const elsewhere = useMemo(() => {
    if (category === 'all' || query.trim() === '') return 0;
    return searchStatusCodes(query, 'all').length;
  }, [category, query]);

  const notable = useMemo(
    () =>
      HTTP_STATUS_CODES.filter((entry) => entry.kind !== 'standard')
        .map((entry) => `${entry.code} ${KIND_LABELS[entry.kind]}`)
        .join('、'),
    [],
  );

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
    async (entry: HttpStatusEntry) => {
      const ok = await copyText(statusCodeText(entry));
      if (ok) {
        setCopied(entry.code);
        window.setTimeout(() => setCopied(null), 1400);
        notify(`已复制 ${entry.code}`);
      } else {
        notify('复制失败，请手动选择文本');
      }
    },
    [notify],
  );

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>
              收录 {total} 个状态码，每个都标了出处
            </MessageBarTitle>
            标准码取自 IANA HTTP 状态码注册表与 RFC 9110；WebDAV、Delta
            编码等扩展码按各自的 RFC（4918、5842、3229、2774 等）标注，
            可以搜「WebDAV」「RFC 4918」试试。需要留意的码单独加徽标：
            {notable}——每一条都写清了原因。104 Upload Resumption
            Supported 目前只是 IANA 的临时注册（2026-11-13 到期，依据是
            Internet-Draft 而不是 RFC），因此没有收录。
          </MessageBarBody>
        </MessageBar>

        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>两个容易记错的标准名称</MessageBarTitle>
            422 在 RFC 9110 里叫 Unprocessable Content，早期 RFC 4918
            里叫 Unprocessable Entity：本页按现行标准显示前者，旧名在各框架与文档中仍很常见。
            413 同样改过名——RFC 9110 叫 Content Too Large，RFC 7231 叫
            Payload Too Large，RFC 2616 叫 Request Entity Too Large。
            418 的英文名{" "}
            <span className={styles.codeText}>I&apos;m a teapot</span>{" "}
            来自愚人节 RFC 2324，RFC 9110 只是保留了这个号码，IANA
            注册表里登记为 (Unused)。
          </MessageBarBody>
        </MessageBar>

        <section className="wt-surface" aria-label="HTTP 状态码列表">
          <div className="wt-surface__header">
            <Text as="h2" size={300} weight="semibold">
              状态码列表
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              {category === 'all'
                ? '全部类别'
                : `${category} ${CATEGORY_META[category].label} · ${CATEGORY_META[category].summary}`}
            </Caption1>
          </div>

          <div className={styles.toolbar}>
            <TabList
              selectedValue={category}
              onTabSelect={(_, data) =>
                setCategory(data.value as StatusCategory | 'all')
              }
            >
              <Tab value="all">全部（{total}）</Tab>
              {CATEGORY_ORDER.map((value) => (
                <Tab key={value} value={value}>
                  {value}（{counts[value]}）
                </Tab>
              ))}
            </TabList>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              可搜数字、英文名、中文说明与 RFC 编号
            </Caption1>
          </div>

          <ListFilter
            value={query}
            onChange={setQuery}
            shown={visible.length}
            total={category === 'all' ? total : counts[category]}
            label="搜索 HTTP 状态码"
            placeholder="搜索状态码或说明，例如 404、Not Found、限流、RFC 4918"
          />

          {visible.length === 0 ? (
            <>
              <NoMatches
                query={query.trim()}
                hint="可以试试状态码数字（404）、英文名（Teapot）或中文说明（限流）。"
              />
              {elsewhere > 0 && (
                <div className={styles.toolbar}>
                  <Button
                    appearance="primary"
                    size="small"
                    icon={<Info16Regular />}
                    onClick={() => setCategory('all')}
                  >
                    该关键词在其它类别还有 {elsewhere} 条，改为搜索全部类别
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div
              className={`wt-surface__body ${styles.rows}`}
              style={{ flexDirection: 'column' }}
            >
              {visible.map((entry) => (
                <div key={entry.code} className={styles.row}>
                  <Tooltip
                    content="点击复制状态码"
                    relationship="label"
                    withArrow
                  >
                    <Button
                      appearance="subtle"
                      size="medium"
                      className={styles.codeButton}
                      icon={
                        copied === entry.code ? (
                          <Checkmark16Regular />
                        ) : (
                          <Copy16Regular />
                        )
                      }
                      iconPosition="after"
                      onClick={() => void copy(entry)}
                      aria-label={`复制状态码 ${entry.code}`}
                    >
                      <span className={styles.codeText}>{entry.code}</span>
                    </Button>
                  </Tooltip>
                  <div className={styles.body}>
                    <div className={styles.titleLine}>
                      <span className={styles.name}>{entry.name}</span>
                      <Badge
                        appearance="tint"
                        size="small"
                        color={KIND_COLORS[entry.kind]}
                      >
                        {KIND_LABELS[entry.kind]}
                      </Badge>
                      <Caption1 className={styles.source}>
                        出处：{entry.source}
                      </Caption1>
                    </div>
                    <span className={styles.zh}>{entry.zh}</span>
                    {entry.note && (
                      <Caption1 className={styles.note}>{entry.note}</Caption1>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <Caption1 className={styles.hint} style={{ padding: '0 4px' }}>
          本工具只做状态码速查，不解析响应头。想真正发一次请求并查看响应头，
          请用「HTTP 客户端」；把状态码粘贴进代码或断言时，点左侧码值即可复制。
        </Caption1>

        <Divider />
      </div>
    </>
  );
}
