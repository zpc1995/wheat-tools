import { useCallback, useMemo } from 'react';
import {
  Badge,
  Button,
  Input,
  Subtitle1,
  Title2,
  Tooltip,
  makeStyles,
  tokens,
  Text,
  Caption1,
} from '@fluentui/react-components';
import {
  ArrowRight16Regular,
  Search20Regular,
  Wrench24Filled,
} from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { tools } from '../tools/registry';
import { AppHeader } from './AppHeader';

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
});

export function HomeLauncher() {
  const styles = useStyles();
  const navigate = useNavigate();
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

  const openTool = useCallback(
    (id: string) => navigate(`/tools/${id}`),
    [navigate],
  );

  return (
    <>
      <AppHeader />
      <div className="wt-main">
        <div className="wt-page">
          <header className="wt-hero">
            <Title2>工具箱</Title2>
            <Text>
              共 {tools.length} 个独立小工具，全部在浏览器本地运行，不上传任何数据。
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
              <Subtitle1>没有匹配的工具</Subtitle1>
              <Text>换个关键词试试，或清空搜索框查看全部工具。</Text>
              <Button appearance="secondary" onClick={() => setQuery('')}>
                清空搜索
              </Button>
            </div>
          ) : (
            <div className="wt-tool-grid">
              {filtered.map((tool) => {
                const Icon = tool.icon;
                return (
                  <button
                    key={tool.id}
                    type="button"
                    className="wt-tool-card"
                    onClick={() => openTool(tool.id)}
                    aria-label={`打开工具：${tool.name}`}
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
                          <Badge
                            key={tag}
                            appearance="tint"
                            color="brand"
                            size="small"
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className="wt-tool-card__meta">
                      <Caption1>{tool.id}</Caption1>
                      <span style={{ flex: 1 }} />
                      <Tooltip
                        content="打开工具"
                        relationship="label"
                        withArrow
                      >
                        <ArrowRight16Regular />
                      </Tooltip>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
