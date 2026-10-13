import {
  Button,
  Caption1,
  MessageBar,
  MessageBarBody,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { CopyRegular } from '@fluentui/react-icons';
import { useCallback, useMemo, useState } from 'react';
import {
  EMOJI,
  EMOJI_CATEGORIES,
  EMOJI_SUBSET_NOTE,
  EMOJI_TOTAL,
  analyseEmoji,
  describeAnalysis,
  searchEmoji,
  type EmojiEntry,
} from './emojiPickerUtils';

/**
 * Cap on rendered tiles.
 *
 * The grid is plain DOM buttons rather than a virtualised list, so a one-letter
 * query that matches half the table would push several hundred nodes into the
 * page for no benefit — nobody scrolls past the first screenful of a
 * 400-row result. The UI says the list was cut and asks for a narrower query.
 */
const MAX_RESULTS = 240;

/**
 * The emoji shown before the user picks one, chosen because it demonstrates the
 * point of the tool: three people joined by two ZWJ code points.
 */
const DEFAULT_CHAR = '👨‍👩‍👧';

const EMOJI_FONT =
  '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';

const useStyles = makeStyles({
  body: {
    flexDirection: 'column',
    gap: '10px',
    padding: '14px',
    minHeight: 0,
  },
  searchRow: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
  },
  searchField: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: '1 1 260px',
    minWidth: '200px',
  },
  fieldLabel: {
    color: tokens.colorNeutralForeground3,
  },
  categories: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))',
    gap: '6px',
    maxHeight: '320px',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    padding: '8px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '6px',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
    padding: '6px 4px',
    border: `1px solid transparent`,
    borderRadius: '6px',
    background: 'none',
    cursor: 'pointer',
    color: tokens.colorNeutralForeground1,
  },
  tileSelected: {
    border: `1px solid ${tokens.colorBrandStroke1}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  glyph: {
    fontFamily: EMOJI_FONT,
    fontSize: '26px',
    lineHeight: 1.2,
  },
  tileName: {
    fontSize: '11px',
    lineHeight: 1.3,
    maxWidth: '68px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: tokens.colorNeutralForeground3,
  },
  detail: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    padding: '12px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '6px',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  detailGlyph: {
    fontFamily: EMOJI_FONT,
    fontSize: '56px',
    lineHeight: 1.1,
  },
  detailText: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    flex: '1 1 320px',
    minWidth: 0,
  },
  mono: {
    fontFamily: 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace',
    fontVariantNumeric: 'tabular-nums',
    wordBreak: 'break-all',
  },
  counts: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  countChip: {
    padding: '2px 8px',
    borderRadius: '999px',
    backgroundColor: tokens.colorNeutralBackground4,
    fontVariantNumeric: 'tabular-nums',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap',
  },
  note: {
    color: tokens.colorNeutralForeground3,
  },
});

export function EmojiPickerTool() {
  const styles = useStyles();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(EMOJI_CATEGORIES[0].id);
  const [selected, setSelected] = useState<EmojiEntry>(
    () => EMOJI.find((entry) => entry.char === DEFAULT_CHAR) ?? EMOJI[0],
  );
  const [copiedChar, setCopiedChar] = useState('');

  const searching = query.trim() !== '';

  const results = useMemo(() => {
    if (searching) return searchEmoji(query);
    const found = EMOJI_CATEGORIES.find((item) => item.id === category);
    return found ? found.entries : [];
  }, [query, category, searching]);

  const shown = results.slice(0, MAX_RESULTS);
  const analysis = useMemo(() => analyseEmoji(selected.char), [selected]);

  const copy = useCallback(async (char: string) => {
    try {
      await navigator.clipboard.writeText(char);
      setCopiedChar(char);
    } catch {
      // Clipboard access can be refused; prefer showing nothing over claiming a
      // copy that did not happen.
      setCopiedChar('');
    }
  }, []);

  const onPick = useCallback(
    (entry: EmojiEntry) => {
      setSelected(entry);
      void copy(entry.char);
    },
    [copy],
  );

  return (
    <div className="wt-surface">
      <div className={`wt-surface__body ${styles.body}`}>
        <div className={styles.searchRow}>
          <div className={styles.searchField}>
            <Caption1 className={styles.fieldLabel}>搜索（中文名或英文关键词）</Caption1>
            <input
              className="wt-inline-input"
              type="search"
              value={query}
              aria-label="搜索 emoji，支持中文名与英文关键词"
              placeholder="例如：笑、heart、family、食物"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Caption1 className={styles.note}>{EMOJI_SUBSET_NOTE}</Caption1>
        </div>

        <div className={styles.categories}>
          {EMOJI_CATEGORIES.map((item) => (
            <Button
              key={item.id}
              size="small"
              appearance={!searching && item.id === category ? 'primary' : 'subtle'}
              aria-pressed={!searching && item.id === category}
              onClick={() => {
                setQuery('');
                setCategory(item.id);
              }}
            >
              {item.label} {item.entries.length}
            </Button>
          ))}
        </div>

        <div className={styles.row}>
          <Text as="h2" size={300} weight="semibold">
            {searching ? '搜索结果' : '选择 emoji'}
          </Text>
          <Caption1 className={styles.note}>
            {searching
              ? `匹配 ${results.length} 个`
              : `共 ${EMOJI_TOTAL} 个 · 点击任意 emoji 即复制`}
          </Caption1>
        </div>

        {shown.length === 0 ? (
          <Caption1 className={styles.note}>
            没有匹配的 emoji。搜索只覆盖这个精选表里的 {EMOJI_TOTAL} 个条目，试试更短的关键词。
          </Caption1>
        ) : (
          <div className={styles.grid}>
            {shown.map((entry) => (
              <button
                key={`${entry.category}-${entry.char}`}
                type="button"
                className={`${styles.tile} ${entry.char === selected.char ? styles.tileSelected : ''}`}
                title={`${entry.name}（${copiedChar === entry.char ? '已复制' : '点击复制'}）`}
                aria-label={`${entry.name}，点击复制`}
                aria-pressed={entry.char === selected.char}
                onClick={() => onPick(entry)}
              >
                <span className={styles.glyph} aria-hidden="true">
                  {entry.char}
                </span>
                <span className={styles.tileName}>{entry.name}</span>
              </button>
            ))}
          </div>
        )}

        {results.length > shown.length && (
          <MessageBar intent="info">
            <MessageBarBody>
              匹配到 {results.length} 个，只显示前 {MAX_RESULTS} 个。再输入一个关键词即可缩小范围。
            </MessageBarBody>
          </MessageBar>
        )}

        <Text as="h2" size={300} weight="semibold">
          {selected.name} 的码位与字节
        </Text>

        <div className={styles.detail}>
          <span className={styles.detailGlyph} aria-hidden="true">
            {selected.char}
          </span>
          <div className={styles.detailText}>
            <Caption1 className={styles.note}>
              中文名：{selected.name} · 英文关键词：{selected.keywords}
            </Caption1>
            <Caption1 className={styles.note}>码点序列（Unicode code points）</Caption1>
            <span className={styles.mono}>{analysis.codePointLabels.join(' ')}</span>
            <Caption1 className={styles.note}>UTF-8 字节</Caption1>
            <span className={styles.mono}>{analysis.utf8Hex}</span>
            <div className={styles.counts}>
              <Caption1 className={styles.countChip}>{analysis.codePointCount} 个码点</Caption1>
              <Caption1 className={styles.countChip}>{analysis.utf16Units} 个 UTF-16 码元</Caption1>
              <Caption1 className={styles.countChip}>{analysis.utf8ByteCount} 字节 UTF-8</Caption1>
            </div>
            <Caption1 className={styles.note}>{describeAnalysis(analysis)}</Caption1>
            <div>
              <Button
                icon={<CopyRegular />}
                size="small"
                appearance="subtle"
                onClick={() => void copy(selected.char)}
              >
                {copiedChar === selected.char ? '已复制' : '复制 emoji'}
              </Button>
            </div>
          </div>
        </div>

        <Caption1 className={styles.note}>
          JavaScript 里 <span className={styles.mono}>.length</span> 数的是 UTF-16 码元，
          一个 emoji 常常占 2 个甚至更多（上面的「{analysis.utf16Units} 个码元」）。真正按字符数
          应该用码点，也就是上面的「{analysis.codePointCount} 个码点」——ZWJ 组合序列的差距正是
          这么来的。
        </Caption1>
      </div>
    </div>
  );
}
