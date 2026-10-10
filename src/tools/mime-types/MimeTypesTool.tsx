import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  Field as FluentField,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Tab,
  TabList,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Checkmark16Regular, Copy16Regular } from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import { ListFilter, NoMatches } from '../../components/ListFilter';
import {
  MIME_CATEGORY_LABELS,
  MIME_CATEGORY_ORDER,
  MIME_ENTRIES,
  categoryCounts,
  entriesForExtension,
  entriesToTsv,
  entryToLine,
  extensionsOfType,
  isValidMimeType,
  lookupByType,
  normalizeMimeType,
  searchMimeEntries,
  type MimeCategory,
  type MimeEntry,
} from './mimeTypesUtils';

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    padding: '12px 16px 16px',
    gap: '12px',
    width: '100%',
  },
  lookups: {
    display: 'grid',
    gap: '14px',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    width: '100%',
  },
  lookupCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    borderRadius: tokens.borderRadiusMedium,
    minWidth: 0,
  },
  lookupResult: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minHeight: '44px',
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
  },
  hitRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    flexWrap: 'wrap',
  },
  hitNote: {
    color: tokens.colorNeutralForeground3,
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 16px 0',
    width: '100%',
  },
  spacer: {
    flex: '1 1 auto',
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
    padding: '9px 16px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  extColumn: {
    flex: 'none',
    width: '150px',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
  },
  extChip: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12.5px',
    color: tokens.colorNeutralForeground2,
  },
  main: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    flex: '1 1 auto',
    minWidth: 0,
  },
  typeName: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
    fontWeight: 600,
    overflowWrap: 'anywhere',
  },
  zh: {
    color: tokens.colorNeutralForeground2,
  },
  note: {
    color: tokens.colorNeutralForeground3,
  },
  flags: {
    flex: 'none',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '4px',
  },
});

function HitLine({
  label,
  detail,
  onCopy,
  copied,
}: {
  label: string;
  detail?: string;
  onCopy: () => void;
  copied: boolean;
}) {
  const styles = useStyles();
  return (
    <div className={styles.hitRow}>
      <span className={styles.mono}>{label}</span>
      <Button
        appearance="subtle"
        size="small"
        icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
        onClick={onCopy}
        aria-label={`复制 ${label}`}
      />
      {detail && <Caption1 className={styles.hitNote}>{detail}</Caption1>}
    </div>
  );
}

export function MimeTypesTool() {
  const styles = useStyles();
  const [extension, setExtension] = useState('');
  const [mime, setMime] = useState('');
  const [category, setCategory] = useState<MimeCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const counts = useMemo(() => categoryCounts(), []);
  const visible = useMemo(() => searchMimeEntries(query, category), [query, category]);
  const total = MIME_ENTRIES.length;

  const extensionHits = useMemo(
    () => (extension.trim() === '' ? [] : entriesForExtension(extension)),
    [extension],
  );

  const normalizedMime = normalizeMimeType(mime);
  const mimeHit = useMemo(
    () => (normalizedMime === '' ? null : lookupByType(normalizedMime)),
    [normalizedMime],
  );
  const mimeExtensions = mimeHit ? extensionsOfType(mimeHit.type) : [];

  const notifyCopy = (key: string, text: string) => {
    void copyText(text).then((ok) => {
      if (!ok) return;
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1400);
    });
  };

  const copyEntry = (entry: MimeEntry) => notifyCopy(entry.type, entryToLine(entry));

  return (
    <div className={styles.stack}>
      <MessageBar intent="info">
        <MessageBarBody>
          <MessageBarTitle>
            MIME 类型只是「这个名字通常配这个类型」的注册表
          </MessageBarTitle>
          MIME 类型（媒体类型，也就是 HTTP 的 <code>Content-Type</code>）由 IANA
          维护一张注册表，另有大量历史遗留的 <code>x-</code> 写法被沿用。同一个扩展名可能对应多个类型：
          <code>.ts</code> 既是 TypeScript 源码也是 MPEG 传输流，<code>.xml</code>{' '}
          同时有 <code>text/xml</code> 与 <code>application/xml</code>{' '}
          两个注册；本工具把这些都列出来，而不是替你猜一个。「可读文本」表示内容是人能直接读的文字（
          <code>application/json</code> 和 <code>image/svg+xml</code>{' '}
          都算），「压缩/归档」表示文件是压缩容器、内容需要先解包。
        </MessageBarBody>
      </MessageBar>

      <MessageBar intent="warning">
        <MessageBarBody>
          <MessageBarTitle>边界：不嗅探文件内容，也不猜</MessageBarTitle>
          本工具只查注册表，<strong>不读取文件字节、不做内容嗅探</strong>
          ——一个改名为 <code>.png</code> 的 ZIP 在这里仍然显示{' '}
          <code>image/png</code>。要按字节判断文件真实格式，请用「十六进制查看器」看文件头
          （magic bytes）。另外，服务器按配置返回的 <code>Content-Type</code>{' '}
          可能与这里的表不一致，这里给的是「按扩展名的标准答案」。
        </MessageBarBody>
      </MessageBar>

      <section className="wt-surface" aria-label="MIME 类型双向查询">
        <div className="wt-surface__header">
          <Text as="h2" size={300} weight="semibold">
            双向查询
          </Text>
          <span className={styles.spacer} />
          <Caption1 className={styles.note}>
            共 {total} 条记录，其中 {MIME_ENTRIES.filter((entry) => entry.extensions.length > 0).length} 条带扩展名
          </Caption1>
        </div>
        <div className={styles.body}>
          <div className={styles.lookups}>
            <div className={styles.lookupCard}>
              <FluentField label="扩展名 → MIME 类型" hint="带不带点都行，例如 docx 或 .docx">
                <Input
                  className="wt-inline-input"
                  aria-label="按扩展名查询 MIME 类型"
                  value={extension}
                  onChange={(_, data) => setExtension(data.value)}
                  placeholder="docx"
                  list="wt-mime-extensions"
                />
              </FluentField>
              <datalist id="wt-mime-extensions">
                {MIME_ENTRIES.flatMap((entry) =>
                  entry.extensions.map((ext) => <option key={`${entry.type}-${ext}`} value={ext} />),
                )}
              </datalist>
              <div className={styles.lookupResult}>
                {extension.trim() === '' ? (
                  <Caption1 className={styles.note}>输入扩展名查看对应类型。</Caption1>
                ) : extensionHits.length === 0 ? (
                  <Caption1 className={styles.note}>
                    注册表里没有这个扩展名。未收录不等于无效——很多扩展名本就没有注册类型，浏览器会按{' '}
                    <code>application/octet-stream</code> 处理。
                  </Caption1>
                ) : (
                  extensionHits.map((entry) => (
                    <HitLine
                      key={entry.type}
                      label={entry.type}
                      detail={`${entry.zh}${entry.extensions.length > 1 ? ` · 同组扩展名 .${entry.extensions.join(' / .')}` : ''}`}
                      copied={copied === entry.type}
                      onCopy={() => copyEntry(entry)}
                    />
                  ))
                )}
                {extensionHits.length > 1 && (
                  <Caption1 className={styles.note}>
                    这个扩展名对应 {extensionHits.length} 个类型。MIME 与扩展名之间不是一对一：只能看内容或上下文才能定下来。
                  </Caption1>
                )}
              </div>
            </div>

            <div className={styles.lookupCard}>
              <FluentField label="MIME 类型 → 扩展名" hint="大小写不敏感，可带 charset 参数">
                <Input
                  className="wt-inline-input"
                  aria-label="按 MIME 类型查询扩展名"
                  value={mime}
                  onChange={(_, data) => setMime(data.value)}
                  placeholder="application/json"
                />
              </FluentField>
              <div className={styles.lookupResult}>
                {normalizedMime === '' ? (
                  <Caption1 className={styles.note}>输入 MIME 类型查看常用扩展名。</Caption1>
                ) : !isValidMimeType(normalizedMime) ? (
                  <Caption1 className={styles.note}>
                    「{normalizedMime}」不是合法的 <code>type/subtype</code> 格式。
                  </Caption1>
                ) : !mimeHit ? (
                  <Caption1 className={styles.note}>
                    注册表里没有这一条。它可能是一个合法但未收录的类型，也可能是把子类型拼错了。
                  </Caption1>
                ) : (
                  <HitLine
                    label={
                      mimeExtensions.length > 0
                        ? mimeExtensions.map((ext) => `.${ext}`).join('  ')
                        : '（没有约定扩展名，通常由协商产生）'
                    }
                    detail={mimeHit.zh}
                    copied={copied === `mime:${mimeHit.type}`}
                    onCopy={() =>
                      notifyCopy(
                        `mime:${mimeHit.type}`,
                        mimeExtensions.length > 0
                          ? mimeExtensions.map((ext) => `.${ext}`).join('\n')
                          : mimeHit.type,
                      )
                    }
                  />
                )}
                {mimeHit?.note && <Caption1 className={styles.note}>{mimeHit.note}</Caption1>}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="wt-surface" aria-label="MIME 类型列表">
        <div className="wt-surface__header">
          <Text as="h2" size={300} weight="semibold">
            类型列表
          </Text>
          <span className={styles.spacer} />
          <Caption1 className={styles.note}>
            {visible.length} / {total}
          </Caption1>
          <Button
            appearance="subtle"
            size="small"
            icon={copied === 'all' ? <Checkmark16Regular /> : <Copy16Regular />}
            onClick={() => notifyCopy('all', entriesToTsv(visible))}
            disabled={visible.length === 0}
          >
            {copied === 'all' ? '已复制' : '复制当前结果（TSV）'}
          </Button>
        </div>

        <div className={styles.toolbar}>
          <TabList
            selectedValue={category}
            onTabSelect={(_, data) => setCategory(data.value as MimeCategory | 'all')}
          >
            <Tab value="all">全部（{total}）</Tab>
            {MIME_CATEGORY_ORDER.map((value) => (
              <Tab key={value} value={value}>
                {MIME_CATEGORY_LABELS[value]}（{counts[value]}）
              </Tab>
            ))}
          </TabList>
        </div>

        <ListFilter
          value={query}
          onChange={setQuery}
          shown={visible.length}
          total={category === 'all' ? total : counts[category]}
          label="搜索 MIME 类型"
          placeholder="搜索扩展名、类型或说明，例如 png、application/json、字体、压缩"
        />

        {visible.length === 0 ? (
          <NoMatches
            query={query.trim()}
            hint="可以试试扩展名（woff2）、类型（image/svg+xml）或中文说明（矢量图）。"
          />
        ) : (
          <div className={`wt-surface__body ${styles.rows}`} style={{ flexDirection: 'column' }}>
            {visible.map((entry) => (
              <div key={entry.type} className={styles.row}>
                <div className={styles.extColumn}>
                  {entry.extensions.length === 0 ? (
                    <Caption1 className={styles.note}>（无扩展名）</Caption1>
                  ) : (
                    entry.extensions.map((ext) => (
                      <span key={ext} className={styles.extChip}>
                        .{ext}
                      </span>
                    ))
                  )}
                </div>
                <div className={styles.main}>
                  <span className={styles.typeName}>{entry.type}</span>
                  <span className={styles.zh}>{entry.zh}</span>
                  <Caption1 className={styles.note}>
                    出处：{entry.source}
                    {entry.note ? ` · ${entry.note}` : ''}
                  </Caption1>
                </div>
                <div className={styles.flags}>
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={copied === entry.type ? <Checkmark16Regular /> : <Copy16Regular />}
                    onClick={() => copyEntry(entry)}
                    aria-label={`复制 ${entry.type}`}
                  />
                  <Badge
                    appearance="tint"
                    size="small"
                    color={entry.readable ? 'informative' : 'subtle'}
                  >
                    {entry.readable ? '可读文本' : '二进制'}
                  </Badge>
                  <Badge
                    appearance="tint"
                    size="small"
                    color={entry.compressed ? 'warning' : 'subtle'}
                  >
                    {entry.compressed ? '压缩/归档' : '非压缩'}
                  </Badge>
                  {entry.deprecated && (
                    <Badge appearance="tint" size="small" color="danger">
                      已废弃
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <Caption1 className={styles.note} style={{ padding: '0 4px' }}>
        边界：本工具不解析文件、不做内容嗅探（那是「十六进制查看器」按 magic
        bytes 做的事），也不发网络请求、不读服务器响应头。想看某个 URL
        实际返回的 <code>Content-Type</code>，请用「HTTP 客户端」发一次请求。
        收录范围是常见类型，不是 IANA 全量注册表。
      </Caption1>

      <Divider />
    </div>
  );
}
