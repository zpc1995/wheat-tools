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
import { useI18n, type TranslationKey } from '../i18n';
import { localiseManifest } from '../i18n/manifest';
import { prefetchTool, tools } from '../tools/registry';
import { rankByUsage, useUsage, type UsageStats } from '../tools/usage';
import type { RegisteredTool } from '../tools/types';

/**
 * Category label for the current locale.
 *
 * The dictionary is preferred and the manifest's Chinese label is the fallback,
 * so a new category shows something sensible before it is translated.
 */
function categoryLabel(
  id: ToolCategory,
  fallback: string,
  t: (key: TranslationKey) => string,
): string {
  const key = `categories.${id}` as TranslationKey;
  const value = t(key);
  // `t` returns the key itself when it is missing, which is how a fallback is
  // detected without duplicating the dictionary shape here.
  return value === key ? fallback : value;
}

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
  const { t, locale } = useI18n();
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
              // Prefetch on hover/focus: the sidebar is the other main way in.
              onMouseEnter={() => prefetchTool(id)}
              onFocus={() => prefetchTool(id)}
              aria-current={active ? 'page' : undefined}
              title={localiseManifest(tool, locale).name}
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
    <nav className={styles.root} aria-label={t('nav.ariaLabel')}>
      {/* Always present: the brand in the header is clickable, but there was no
          obvious way back once a tool was open and the list scrolled. */}
      <Link
        to="/"
        className={`${styles.home} ${activeId ? '' : styles.itemActive}`}
        aria-current={activeId ? undefined : 'page'}
      >
        <Grid16Filled className={styles.homeIcon} />
        <span className={styles.itemLabel}>{t('nav.home')}</span>
      </Link>

      {renderSection('common', t('categories.common'), common, {
        showCounts: true,
        emptyHint: t('nav.commonEmpty'),
      })}

      {renderSection('favorite', t('categories.favorite'), favorites, {
        showStar: true,
        emptyHint: t('nav.favoriteEmpty'),
      })}

      <div className={styles.groupsHead}>
        <Caption1 style={{ color: tokens.colorNeutralForeground4 }}>
          {t('nav.groups')}
        </Caption1>
        <button
          type="button"
          className={styles.groupsToggle}
          onClick={toggleAll}
        >
          {allCollapsed ? t('nav.expandAll') : t('nav.collapseAll')}
        </button>
      </div>

      {grouped.map(({ category, items }) =>
        renderSection(
          category.id,
          // Prefer the dictionary so category names follow the interface
          // language; the manifest label stays as the fallback.
          categoryLabel(category.id, category.label, t),
          items.map((tool) => tool.id),
          {},
        ),
      )}

      <Tooltip content={t('nav.localStorageHint')} relationship="description" withArrow>
        <Text size={200} style={{ color: tokens.colorNeutralForeground4, padding: '0 8px' }}>
          {t('nav.localStorageNote')}
        </Text>
      </Tooltip>

      {/* Provenance lives here as well as in the launcher footer: the sidebar is
          always on screen, whereas the footer needs scrolling to reach. */}
      <Tooltip content={t('app.builtWith')} relationship="description" withArrow>
        <Text size={200} style={{ color: tokens.colorNeutralForeground4, padding: '0 8px' }}>
          {t('app.builtWithShort')}
        </Text>
      </Tooltip>
    </nav>
  );
}

/** Exposed for tests: pure ranking helper re-exported for convenience. */
export { rankByUsage };
export type { UsageStats };
