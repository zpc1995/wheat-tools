import { useCallback, useEffect, useState } from 'react';

/**
 * Per-tool usage statistics and favourites, persisted to `localStorage`.
 *
 * Design notes:
 * - Storage access is wrapped in try/catch. `localStorage` throws in some
 *   embedded/sandboxed contexts (and when disabled), and losing statistics must
 *   never break the app.
 * - Only counts and ids are stored, never content the user typed.
 * - "Frequently used" is ranked by an explicit open count rather than by
 *   recency, because the user asked for "most used" — recency would just
 *   duplicate a "recently used" list. `lastUsedAt` is kept for tie-breaking and
 *   for a future recents UI.
 */

const STORAGE_KEY = 'wheat-tools:usage:v1';
/** Cap the recency list so storage cannot grow without bound. */
const MAX_RECENT = 24;

export interface UsageStats {
  /** Tool id → number of times opened. */
  opens: Record<string, number>;
  /** Tool id → epoch millis of the most recent open. */
  lastUsedAt: Record<string, number>;
  /** Tool ids in most-recently-used order. */
  recent: string[];
  /** Favourited tool ids. */
  favorites: string[];
}

const EMPTY: UsageStats = { opens: {}, lastUsedAt: {}, recent: [], favorites: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates and repairs whatever was in storage. */
function parse(raw: string | null): UsageStats {
  if (!raw) return EMPTY;
  try {
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data)) return EMPTY;

    const opens: Record<string, number> = {};
    if (isRecord(data.opens)) {
      for (const [id, value] of Object.entries(data.opens)) {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
          opens[id] = Math.floor(value);
        }
      }
    }

    const lastUsedAt: Record<string, number> = {};
    if (isRecord(data.lastUsedAt)) {
      for (const [id, value] of Object.entries(data.lastUsedAt)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          lastUsedAt[id] = value;
        }
      }
    }

    const stringArray = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];

    return {
      opens,
      lastUsedAt,
      recent: stringArray(data.recent).slice(0, MAX_RECENT),
      favorites: stringArray(data.favorites),
    };
  } catch {
    // Corrupt payload: start clean rather than crashing on every render.
    return EMPTY;
  }
}

function read(): UsageStats {
  try {
    return parse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return EMPTY;
  }
}

function write(stats: UsageStats): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // Persistence is best-effort; the in-memory state still works.
  }
}

/**
 * Subscribers keep every mounted consumer in sync.
 *
 * Without this, favouriting from the launcher would not update the sidebar
 * (and vice versa) because each would hold its own `useState` copy.
 */
const listeners = new Set<(stats: UsageStats) => void>();
let cache: UsageStats | null = null;

function current(): UsageStats {
  if (cache === null) cache = read();
  return cache;
}

function update(next: UsageStats): void {
  cache = next;
  write(next);
  for (const listener of listeners) listener(next);
}

export interface UsageApi {
  stats: UsageStats;
  /** Records an open and returns the updated stats. */
  recordOpen: (toolId: string) => void;
  toggleFavorite: (toolId: string) => void;
  isFavorite: (toolId: string) => boolean;
  reset: () => void;
}

export function useUsage(): UsageApi {
  const [stats, setStats] = useState<UsageStats>(current);

  useEffect(() => {
    listeners.add(setStats);
    // Re-read on mount in case another tab changed the value.
    const fresh = read();
    if (JSON.stringify(fresh) !== JSON.stringify(cache)) {
      cache = fresh;
      setStats(fresh);
    }
    return () => {
      listeners.delete(setStats);
    };
  }, []);

  const recordOpen = useCallback((toolId: string) => {
    const base = current();
    const recent = [toolId, ...base.recent.filter((id) => id !== toolId)].slice(
      0,
      MAX_RECENT,
    );
    update({
      ...base,
      opens: { ...base.opens, [toolId]: (base.opens[toolId] ?? 0) + 1 },
      lastUsedAt: { ...base.lastUsedAt, [toolId]: Date.now() },
      recent,
    });
  }, []);

  const toggleFavorite = useCallback((toolId: string) => {
    const base = current();
    const favorites = base.favorites.includes(toolId)
      ? base.favorites.filter((id) => id !== toolId)
      : [toolId, ...base.favorites];
    update({ ...base, favorites });
  }, []);

  const isFavorite = useCallback(
    (toolId: string) => stats.favorites.includes(toolId),
    [stats.favorites],
  );

  const reset = useCallback(() => {
    update(EMPTY);
  }, []);

  return { stats, recordOpen, toggleFavorite, isFavorite, reset };
}

/**
 * Ranks tool ids by usage.
 *
 * Ties fall back to most-recent, which keeps the order stable and sensible
 * before a user has accumulated many opens.
 */
export function rankByUsage(
  ids: string[],
  stats: UsageStats,
  limit?: number,
): string[] {
  const ranked = [...ids].sort((a, b) => {
    const byOpens = (stats.opens[b] ?? 0) - (stats.opens[a] ?? 0);
    if (byOpens !== 0) return byOpens;
    return (stats.lastUsedAt[b] ?? 0) - (stats.lastUsedAt[a] ?? 0);
  });
  return typeof limit === 'number' ? ranked.slice(0, limit) : ranked;
}

export { MAX_RECENT };
