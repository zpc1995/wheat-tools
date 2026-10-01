import { Suspense, lazy, useMemo } from 'react';
import {
  Button,
  MessageBar,
  MessageBarBody,
  Subtitle1,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Link, useNavigate } from 'react-router-dom';
import { getTool } from '../tools/registry';
import { ToolLoading } from './ToolLoading';
import { useI18n } from '../i18n';
import { hasMetadataTranslation, localiseManifest } from '../i18n/manifest';

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
  const { t, locale } = useI18n();

  if (!tool) {
    return (
      <div className="wt-page">
        <div className={styles.missing}>
          <Subtitle1 as="h1">{t('toolPage.notFound', { id: toolId ?? '' })}</Subtitle1>
          <Text>{t('toolPage.notFoundHint')}</Text>
          <Button appearance="primary" onClick={() => navigate('/')}>
            {t('toolPage.back')}
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

  const localised = localiseManifest(tool, locale);
  // Tool *content* is authored in Chinese; only the chrome is translated. Saying
  // so is better than letting a Chinese-only panel look like a bug.
  const needsTranslationNotice =
    locale !== 'zh-CN' && hasMetadataTranslation(tool, locale);

  return (
    <div className="wt-page">
      <header className="wt-hero">
        <div className={styles.titleRow}>
          <Subtitle1 as="h1">{localised.name}</Subtitle1>
          {tool.version && (
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {t('toolPage.version', { version: tool.version })}
            </Text>
          )}
          <Link className="wt-back-link" to="/">
            {t('toolPage.backToLauncher')}
          </Link>
        </div>
        <Text>{localised.description}</Text>

        {needsTranslationNotice && (
          <MessageBar intent="info" style={{ marginTop: 8 }}>
            <MessageBarBody>{t('toolPage.contentNotTranslated')}</MessageBarBody>
          </MessageBar>
        )}
      </header>

      <div className={styles.body}>
        {/* The fallback is deliberately not a spinner: chunks are small and
            often already prefetched, so a flash of spinner is worse than a
            skeleton that matches the page shape. */}
        <Suspense fallback={<ToolLoading name={localised.name} />}>
          <LazyTool />
        </Suspense>
      </div>
    </div>
  );
}
