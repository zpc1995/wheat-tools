/**
 * Tool categories.
 *
 * Defined here rather than in each manifest so the taxonomy stays consistent
 * and can be reordered in one place. A manifest just names its category; an
 * unknown name falls back to `other` instead of hiding the tool, so a typo can
 * never make a tool disappear from the launcher.
 */
export type ToolCategory =
  | 'common'
  | 'favorite'
  | 'dev'
  | 'time'
  | 'text'
  | 'crypto'
  | 'network'
  | 'media'
  | 'other';

export interface CategoryMeta {
  id: ToolCategory;
  label: string;
  /** Heading order in the sidebar. */
  order: number;
  /**
   * Virtual categories are computed from usage data rather than declared by a
   * manifest, and are hidden when empty.
   */
  virtual?: boolean;
  /** Virtual categories show at most this many entries. */
  limit?: number;
}

export const CATEGORIES: CategoryMeta[] = [
  // Capped at 10 so the shortcut list stays scannable; entries are ranked by
  // open count (ties broken by most recent use).
  { id: 'common', label: '常用工具', order: 0, virtual: true, limit: 10 },
  { id: 'favorite', label: '我的收藏', order: 1, virtual: true },
  { id: 'dev', label: '编程工具', order: 10 },
  { id: 'time', label: '时间工具', order: 20 },
  { id: 'text', label: '文本与格式', order: 30 },
  { id: 'crypto', label: '哈希与加密', order: 40 },
  { id: 'network', label: '网络工具', order: 50 },
  { id: 'media', label: '图片与媒体', order: 60 },
  { id: 'other', label: '其它工具', order: 90 },
];

const BY_ID = new Map(CATEGORIES.map((category) => [category.id, category]));

/** Real (manifest-assignable) categories, in display order. */
export const ASSIGNABLE_CATEGORIES = CATEGORIES.filter(
  (category) => !category.virtual,
);

export function categoryMeta(id: ToolCategory): CategoryMeta {
  return BY_ID.get(id) ?? BY_ID.get('other')!;
}

export function isVirtualCategory(id: ToolCategory): boolean {
  return Boolean(BY_ID.get(id)?.virtual);
}

/** Normalises an arbitrary manifest value to a known category. */
export function normalizeCategory(value: unknown): ToolCategory {
  if (typeof value !== 'string') return 'other';
  return BY_ID.has(value as ToolCategory) ? (value as ToolCategory) : 'other';
}
