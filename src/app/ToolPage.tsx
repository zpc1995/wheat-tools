import { Button, Subtitle1, Text, makeStyles, tokens } from '@fluentui/react-components';
import { Link, useNavigate } from 'react-router-dom';
import { getTool } from '../tools/registry';

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

  const { Component } = tool;

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
        <Component />
      </div>
    </div>
  );
}
