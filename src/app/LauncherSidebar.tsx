import { useMemo, useState } from 'react';
import {
  Caption1,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ChevronDown16Regular,
  ChevronRight16Regular,
  Star16Filled,
} from '@fluentui/react-icons';
import { ASSIGNABLE_CATEGORIES, categoryMeta, type ToolCategory } from '../tools/categories';
import { tools } from '../tools/registry';
import { rankByUsage, useUsage, type UsageStats } from '../tools/usage';
import type { RegisteredTool } from '../tools/types';

/** How many favourites to show before the list gets unwieldy. */
const MAX_FAVORITES = 20;

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  sectionHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    width: '100%',
    padding: '4px 6px',
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    color: tokens.colorNeutralForeground3,
    cursor: 'pointer',
    font: 'inherit',
    textAlign: 'left',
    ':hover': {
      backgroundColor: tokens.colorSubtleBackgroundHover,
      color: tokens.colorNeutralForeground1,
    },
  },
  sectionTitle: {
    flex: '1 1 auto',
    fontWeight: 600,
    letterSpacing: '0.02em',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '6px 8px',
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    color: tokens.colorNeutralForeground2,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '13px',
    textAlign: 'left',
    ':hover': {
      backgroundColor: tokens.colorSubtleBackgroundHover,
      color: tokens.colorNeutralForeground1,
    },
    ':focus-visible': {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: '-2px',
    },
  },
  itemActive: {
    backgroundColor: tokens.colorNeutralBackground1Selected,
    color: tokens.colorNeutralForeground1,
    fontWeight: 600,
  },
  itemLabel: {
    flex: '1 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  count: {
    flex: 'none',
    color: tokens.colorNeutralForeground4,
    fontVariantNumeric: 'tabular-nums',
  },
  empty: {
    padding: '6px 8px',
    color: tokens.colorNeutralForeground4,
    fontSize: '12px',
    lineHeight: 1.5,
  },
  star: {
    flex: 'none',
    color: tokens.colorPaletteMarigoldForeground1,
  },
});

interface LauncherSidebarProps {
  /** Currently open tool id, used for the active highlight. */
  activeId?: string;
  onSelect: (toolId: string) => void;
}

export function LauncherSidebar({ activeId, onSelect }: LauncherSidebarProps) {
  const styles = useStyles();
  const { stats } = useUsage();
  const [collapsed, setCollapsed] = useState<Set<ToolCategory>>(new Set());

  const byId = useMemo(() => {
    const map = new Map<string, RegisteredTool>();
    for (const tool of tools) map.set(tool.id, tool);
    return map;
  }, []);

  /** Frequently used: only tools the user has actually opened. */
  const common = useMemo(() => {
    const opened = Object.keys(stats.opens).filter((id) => byId.has(id));
    return rankByUsage(opened, stats, categoryMeta('common').limit);
  }, [stats, byId]);

  const favorites = useMemo(
    () => stats.favorites.filter((id) => byId.has(id)).slice(0, MAX_FAVORITES),
    [stats.favorites, byId],
  );

  const grouped = useMemo(() => {
    return ASSIGNABLE_CATEGORIES.map((category) => ({
      category,
      items: tools.filter((tool) => tool.resolvedCategory === category.id),
    })).filter((group) => group.items.length > 0);
  }, []);

  const toggle = (id: ToolCategory) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderItems = (ids: string[], showCounts = false, showStar = false) => (
    <ul className={styles.list}>
      {ids.map((id) => {
        const tool = byId.get(id)!;
        const active = id === activeId;
        return (
          <li key={id}>
            <button
              type="button"
              className={`${styles.item} ${active ? styles.itemActive : ''}`}
              onClick={() => onSelect(id)}
              aria-current={active ? 'page' : undefined}
              title={tool.name}
            >
              {showStar && <Star16Filled className={styles.star} />}
              <span className={styles.itemLabel}>{tool.name}</span>
              {showCounts && (
                <span className={styles.count}>{stats.opens[id] ?? 0}</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );

  const renderSection = (
    id: ToolCategory,
    label: string,
    ids: string[],
    options: { showCounts?: boolean; showStar?: boolean; emptyHint?: string },
  ) => {
    const isCollapsed = collapsed.has(id);
    return (
      <div className={styles.section} key={id}>
        <button
          type="button"
          className={styles.sectionHead}
          onClick={() => toggle(id)}
          aria-expanded={!isCollapsed}
        >
          {isCollapsed ? <ChevronRight16Regular /> : <ChevronDown16Regular />}
          <span className={styles.sectionTitle}>{label}</span>
          <Caption1>{ids.length}</Caption1>
        </button>
        {!isCollapsed &&
          (ids.length > 0 ? (
            renderItems(ids, options.showCounts, options.showStar)
          ) : (
            <div className={styles.empty}>{options.emptyHint}</div>
          ))}
      </div>
    );
  };

  return (
    <nav className={styles.root} aria-label="工具导航">
      {renderSection('common', '常用工具', common, {
        showCounts: true,
        emptyHint: '打开工具后，这里会按使用次数排序显示。',
      })}

      {renderSection('favorite', '我的收藏', favorites, {
        showStar: true,
        emptyHint: '点击工具卡片右上角的星标即可收藏。',
      })}

      {grouped.map(({ category, items }) =>
        renderSection(
          category.id,
          category.label,
          items.map((tool) => tool.id),
          {},
        ),
      )}

      <Tooltip
        content="统计与收藏保存在浏览器本地（localStorage），不会上传"
        relationship="description"
        withArrow
      >
        <Text size={200} style={{ color: tokens.colorNeutralForeground4, padding: '0 8px' }}>
          本地保存 · 不上传
        </Text>
      </Tooltip>
    </nav>
  );
}

/** Exposed for tests: pure ranking helper re-exported for convenience. */
export { rankByUsage };
export type { UsageStats };
