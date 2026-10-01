import { Suspense, lazy, useMemo } from 'react';
import { Button, Subtitle1, Text, makeStyles, tokens } from '@fluentui/react-components';
import { Link, useNavigate } from 'react-router-dom';
import { getTool } from '../tools/registry';
import { ToolLoading } from './ToolLoading';

const useStyles = makeStyles({
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    minHeight: 0,
  },
  missing: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '48px 24px',
    alignItems: 'center',
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
  },
});

interface ToolPageProps {
  /**
   * Manifest id of the tool to render. The route table passes this in
   * directly, which keeps the page independent of router param plumbing.
   */
  toolId: string;
}

/**
 * Chrome around a single tool: header with a back affordance, the tool's title
 * and description, then the tool component itself. The tool decides its own
 * internal layout.
 */
export function ToolPage({ toolId }: ToolPageProps) {
  const styles = useStyles();
  const navigate = useNavigate();
  const tool = getTool(toolId);

  if (!tool) {
    return (
      <div className="wt-page">
        <div className={styles.missing}>
          <Subtitle1>未找到工具 “{toolId}”</Subtitle1>
          <Text>它可能已被移除，或链接有误。</Text>
          <Button appearance="primary" onClick={() => navigate('/')}>
            返回工具箱
          </Button>
        </div>
      </div>
    );
  }

  // `lazy` must receive a stable reference, otherwise React would treat a new
  // component type as a different one on every render and remount the tool,
  // discarding its state. `tool.load` is memoised per tool in the registry, and
  // the cache here keys off the tool id.
  const LazyTool = useMemo(() => lazy(async () => ({ default: await tool.load() })), [tool.id]);

  return (
    <div className="wt-page">
      <header className="wt-hero">
        <div className={styles.titleRow}>
          <Subtitle1>{tool.name}</Subtitle1>
          {tool.version && (
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              v{tool.version}
            </Text>
          )}
          <Link className="wt-back-link" to="/">
            工具箱
          </Link>
        </div>
        <Text>{tool.description}</Text>
      </header>

      <div className={styles.body}>
        {/* The fallback is deliberately not a spinner: chunks are small and
            often already prefetched, so a flash of spinner is worse than a
            skeleton that matches the page shape. */}
        <Suspense fallback={<ToolLoading name={tool.name} />}>
          <LazyTool />
        </Suspense>
      </div>
    </div>
  );
}
