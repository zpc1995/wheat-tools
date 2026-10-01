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
  Grid16Filled,
  Star16Filled,
} from '@fluentui/react-icons';
import { Link } from 'react-router-dom';
import { ASSIGNABLE_CATEGORIES, categoryMeta, type ToolCategory } from '../tools/categories';
import { tools } from '../tools/registry';
import { rankByUsage, useUsage, type UsageStats } from '../tools/usage';
import type { RegisteredTool } from '../tools/types';

/** How many favourites to show before the list gets unwieldy. */
const MAX_FAVORITES = 20;

/**
 * Which sections the user has collapsed.
 *
 * The category groups start collapsed so the rail stays short, while the two
 * personalised sections stay open because they are the shortcut the user came
 * for. The choice is persisted, so expanding a group is remembered instead of
 * being undone on the next visit.
 */
const COLLAPSED_KEY = 'wheat-tools:sidebar-collapsed:v1';

/** Categories collapsed before the user has expressed a preference. */
const DEFAULT_COLLAPSED = (): Set<ToolCategory> =>
  new Set(ASSIGNABLE_CATEGORIES.map((category) => category.id));

function readCollapsed(): Set<ToolCategory> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    if (raw === null) return DEFAULT_COLLAPSED();

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_COLLAPSED();

    // Only accept ids that still exist, so a removed category cannot keep a
    // stale entry alive forever.
    const valid = new Set<ToolCategory>(ASSIGNABLE_CATEGORIES.map((c) => c.id));
    return new Set(
      parsed.filter(
        (item): item is ToolCategory => typeof item === 'string' && valid.has(item as ToolCategory),
      ),
    );
  } catch {
    return DEFAULT_COLLAPSED();
  }
}

function writeCollapsed(value: Set<ToolCategory>): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...value]));
  } catch {
    // Best effort: the sidebar still works without persistence.
  }
}

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
  /* Anchor variant of `item`, used by the always-present home entry. */
  itemLink: {
    textDecoration: 'none',
  },
  home: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '8px',
    marginBottom: '2px',
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    color: tokens.colorNeutralForeground2,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '13px',
    textAlign: 'left',
    textDecoration: 'none',
    ':hover': {
      backgroundColor: tokens.colorSubtleBackgroundHover,
      color: tokens.colorNeutralForeground1,
    },
    ':focus-visible': {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: '-2px',
    },
  },
  homeIcon: {
    flex: 'none',
    color: tokens.colorBrandForeground1,
  },
  groupsHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '0 6px',
    marginTop: '4px',
  },
  groupsToggle: {
    border: 'none',
    background: 'transparent',
    color: tokens.colorBrandForeground1,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '12px',
    padding: '2px 4px',
    borderRadius: '4px',
    ':hover': {
      backgroundColor: tokens.colorSubtleBackgroundHover,
      textDecoration: 'underline',
    },
    ':focus-visible': {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: '-2px',
    },
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
  const [collapsed, setCollapsed] = useState<Set<ToolCategory>>(readCollapsed);

  // Collapse-all / expand-all, which is what people want once the list grows.
  const allCollapsed = useMemo(
    () => ASSIGNABLE_CATEGORIES.every((category) => collapsed.has(category.id)),
    [collapsed],
  );

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
      writeCollapsed(next);
      return next;
    });
  };

  const toggleAll = () => {
    const next = allCollapsed ? new Set<ToolCategory>() : DEFAULT_COLLAPSED();
    setCollapsed(next);
    writeCollapsed(next);
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
      {/* Always present: the brand in the header is clickable, but there was no
          obvious way back once a tool was open and the list scrolled. */}
      <Link
        to="/"
        className={`${styles.home} ${activeId ? '' : styles.itemActive}`}
        aria-current={activeId ? undefined : 'page'}
      >
        <Grid16Filled className={styles.homeIcon} />
        <span className={styles.itemLabel}>工具箱首页</span>
      </Link>

      {renderSection('common', '常用工具', common, {
        showCounts: true,
        emptyHint: '打开工具后，这里会按使用次数排序显示。',
      })}

      {renderSection('favorite', '我的收藏', favorites, {
        showStar: true,
        emptyHint: '点击工具卡片右上角的星标即可收藏。',
      })}

      <div className={styles.groupsHead}>
        <Caption1 style={{ color: tokens.colorNeutralForeground4 }}>
          工具分类
        </Caption1>
        <button
          type="button"
          className={styles.groupsToggle}
          onClick={toggleAll}
        >
          {allCollapsed ? '全部展开' : '全部收起'}
        </button>
      </div>

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
