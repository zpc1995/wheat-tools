import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Input,
  Subtitle1,
  Text,
  Title2,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  Search20Regular,
  Star16Filled,
  Star16Regular,
  Wrench24Filled,
} from '@fluentui/react-icons';
import { useHref } from 'react-router-dom';
import { prefetchTool } from '../tools/registry';
import { tools } from '../tools/registry';
import { useUsage } from '../tools/usage';
import type { RegisteredTool } from '../tools/types';

const useStyles = makeStyles({
  cardText: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  tags: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  searchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  search: {
    maxWidth: '360px',
    minWidth: '220px',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    padding: '48px 24px',
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
  },
  star: {
    position: 'absolute',
    top: '8px',
    right: '8px',
    zIndex: 1,
  },
  starOn: {
    color: tokens.colorPaletteMarigoldForeground1,
  },
});

/**
 * One launcher card.
 *
 * The card is a container rather than a `<button>` because it holds two
 * independent affordances (open the tool, toggle favourite) and interactive
 * elements must not be nested. Keeping the whole surface clickable is handled
 * by making the link fill the card.
 */
function ToolCard({ tool }: { tool: RegisteredTool }) {
  const styles = useStyles();
  const { isFavorite, toggleFavorite } = useUsage();
  const href = useHref(`/tools/${tool.id}`);
  const Icon = tool.icon;
  const favorite = isFavorite(tool.id);

  return (
    <div className="wt-tool-card">
      <Button
        className={styles.star}
        appearance="subtle"
        size="small"
        icon={
          favorite ? (
            <Star16Filled className={styles.starOn} />
          ) : (
            <Star16Regular />
          )
        }
        onClick={() => toggleFavorite(tool.id)}
        aria-pressed={favorite}
        aria-label={favorite ? `取消收藏 ${tool.name}` : `收藏 ${tool.name}`}
        title={favorite ? '取消收藏' : '收藏'}
      />

      <a
        className="wt-tool-card__link"
        href={href}
        // Start fetching the tool's chunk as soon as the pointer or keyboard
        // focus arrives, so opening it usually needs no loading state.
        onMouseEnter={() => prefetchTool(tool.id)}
        onFocus={() => prefetchTool(tool.id)}
      >
        <span className="wt-tool-card__icon" aria-hidden>
          {Icon ? <Icon /> : <Wrench24Filled />}
        </span>
        <div className={styles.cardText}>
          <Subtitle1>{tool.name}</Subtitle1>
          <Text size={200}>{tool.description}</Text>
        </div>
        {tool.tags && tool.tags.length > 0 && (
          <div className={styles.tags}>
            {tool.tags.map((tag) => (
              <Badge key={tag} appearance="tint" color="brand" size="small">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </a>
    </div>
  );
}

export function HomeLauncher() {
  const styles = useStyles();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tools;
    return tools.filter((tool) =>
      [tool.name, tool.description, tool.id, ...(tool.tags ?? [])]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [query]);

  return (
    <div className="wt-page">
      <header className="wt-hero">
        <Title2 as="h1">工具箱</Title2>
        <Text>
          共 {tools.length} 个独立小工具，除「外网 IP 查询」需请求第三方接口外，
          其余全部在浏览器本地运行。
        </Text>
      </header>

      <div className={styles.searchRow}>
        <Input
          className={styles.search}
          value={query}
          onChange={(_, data) => setQuery(data.value)}
          placeholder="搜索工具…"
          aria-label="搜索工具"
          contentBefore={<Search20Regular />}
          type="search"
        />
        <Caption1>
          {filtered.length} / {tools.length}
        </Caption1>
      </div>

      {filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <Wrench24Filled />
          <Subtitle1 as="h2">没有匹配的工具</Subtitle1>
          <Text>换个关键词试试，或清空搜索框查看全部工具。</Text>
          <Button appearance="secondary" onClick={() => setQuery('')}>
            清空搜索
          </Button>
        </div>
      ) : (
        <div className="wt-tool-grid">
          {filtered.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}
