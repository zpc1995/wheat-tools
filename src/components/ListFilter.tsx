import { useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  Caption1,
  Input,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Dismiss16Regular, Search16Regular } from '@fluentui/react-icons';

/**
 * Search/filter helpers and a small input for tools whose content is a long list.
 *
 * The matching rules are deliberately simple and predictable, because a filter
 * that surprises you is worse than no filter:
 *
 * - **Case-insensitive**, always. Nobody types exact case into a filter.
 * - **Whitespace splits into terms, and every term must match** (AND). This is
 *   what makes `\d 数字` narrow rather than widen the result.
 * - **Every term must appear**, but not adjacently — `email format` matches a row
 *   containing "format" before "email".
 * - **CJK has no word boundaries**, so a single-character Chinese query works the
 *   same as a multi-character one; terms are compared as plain substrings.
 */

/** Splits a query into lower-cased terms. */
export function queryTerms(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Whether any of the given fields contains every term of the query.
 *
 * Callers pass the fields to search rather than a single blob so that a term can
 * match one field and another term a different one — searching the concatenation
 * would produce false positives across field boundaries.
 */
export function matchesQuery(query: string, fields: Array<string | undefined>): boolean {
  const terms = queryTerms(query);
  if (terms.length === 0) return true;

  const haystack = fields
    .filter((field): field is string => typeof field === 'string')
    .map((field) => field.toLowerCase());

  return terms.every((term) => haystack.some((field) => field.includes(term)));
}

const useStyles = makeStyles({
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
    padding: '10px 14px',
    width: '100%',
  },
  input: {
    flex: '1 1 220px',
    minWidth: '160px',
  },
  count: {
    flex: 'none',
    color: tokens.colorNeutralForeground3,
  },
  empty: {
    padding: '16px 14px',
    color: tokens.colorNeutralForeground3,
    width: '100%',
  },
});

export interface ListFilterProps {
  value: string;
  onChange: (next: string) => void;
  /** Number of items currently shown, and the total available. */
  shown: number;
  total: number;
  placeholder?: string;
  /** Accessible name; required because the input has no visible label. */
  label: string;
  /** Extra controls rendered at the end of the bar. */
  children?: ReactNode;
}

/**
 * The filter bar itself.
 *
 * Controlled: the owning component holds the query so it can also use it for its
 * own matching, which keeps a single source of truth.
 */
export function ListFilter({
  value,
  onChange,
  shown,
  total,
  placeholder = '搜索…',
  label,
  children,
}: ListFilterProps) {
  const styles = useStyles();
  const filtered = value.trim() !== '';

  return (
    <div className={styles.bar}>
      <Input
        className={styles.input}
        value={value}
        onChange={(_, data) => onChange(data.value)}
        onKeyDown={(event) => {
          // Escape clears the filter, which is the convention people expect and
          // saves reaching for the mouse.
          if (event.key === 'Escape' && filtered) {
            event.preventDefault();
            onChange('');
          }
        }}
        contentBefore={<Search16Regular />}
        placeholder={placeholder}
        aria-label={label}
        type="search"
      />

      {filtered && (
        <Tooltip content="清除搜索（Esc）" relationship="label" withArrow>
          <Button
            appearance="subtle"
            size="small"
            icon={<Dismiss16Regular />}
            onClick={() => onChange('')}
            aria-label="清除搜索"
          />
        </Tooltip>
      )}

      {/* Announced politely so a screen reader hears the count change while
          typing, without stealing focus from the input. */}
      <Caption1 className={styles.count} aria-live="polite">
        {filtered ? `${shown} / ${total}` : `${total} 项`}
      </Caption1>

      {children}
    </div>
  );
}

/**
 * Convenience wrapper for the common case: the caller keeps the query and gets
 * back both the filtered list and the filter bar element.
 *
 * Returns `element` separately rather than rendering the bar itself so the call
 * site can place it inside whichever surface it already has.
 */
export function useListFilter<T>(
  items: T[],
  fieldsOf: (item: T) => Array<string | undefined>,
  label: string,
  placeholder?: string,
): {
  query: string;
  setQuery: (next: string) => void;
  filtered: T[];
  bar: ReactNode;
  /** True when a query is active and nothing matched. */
  isEmpty: boolean;
} {
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () => items.filter((item) => matchesQuery(query, fieldsOf(item))),
    // `fieldsOf` is expected to be stable (a module-level function or inline
    // arrow over primitive fields); recomputing on it changing is harmless.
    [items, query, fieldsOf],
  );

  const bar = (
    <ListFilter
      value={query}
      onChange={setQuery}
      shown={filtered.length}
      total={items.length}
      label={label}
      placeholder={placeholder}
    />
  );

  return {
    query,
    setQuery,
    filtered,
    bar,
    isEmpty: query.trim() !== '' && filtered.length === 0,
  };
}

/** The message shown when a filter matches nothing. */
export function NoMatches({ query, hint }: { query: string; hint?: string }) {
  const styles = useStyles();
  return (
    <div className={styles.empty}>
      <Caption1>
        没有匹配「{query}」的条目。
        {hint ? ` ${hint}` : ' 可以换一个关键词，或清空搜索查看全部。'}
      </Caption1>
    </div>
  );
}
