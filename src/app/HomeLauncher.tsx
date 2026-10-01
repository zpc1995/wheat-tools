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
  Wrench16Regular,
  Code16Regular,
} from '@fluentui/react-icons';
import { useHref } from 'react-router-dom';
import { prefetchTool } from '../tools/registry';
import { useI18n } from '../i18n';
import { localiseManifest } from '../i18n/manifest';
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
  footer: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '16px',
    marginTop: '28px',
    paddingTop: '16px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground3,
  },
  footerItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  footerLink: {
    color: tokens.colorBrandForeground1,
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
  const { t, locale } = useI18n();
  const localised = localiseManifest(tool, locale);
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
        aria-label={
          favorite
            ? `${t('launcher.removeFavorite')} ${localised.name}`
            : `${t('launcher.addFavorite')} ${localised.name}`
        }
        title={favorite ? t('launcher.removeFavorite') : t('launcher.addFavorite')}
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
          <Subtitle1>{localised.name}</Subtitle1>
          <Text size={200}>{localised.description}</Text>
        </div>
        {localised.tags.length > 0 && (
          <div className={styles.tags}>
            {localised.tags.map((tag) => (
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
  const { t } = useI18n();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tools;
    return tools.filter((tool) =>
      // Search both languages' metadata: someone may type an English word
      // while the interface is Chinese, or the reverse.
      [
        tool.name,
        tool.description,
        tool.id,
        ...(tool.tags ?? []),
        ...(tool.translations?.['en-US']
          ? [
              tool.translations['en-US'].name ?? '',
              tool.translations['en-US'].description ?? '',
              ...(tool.translations['en-US'].tags ?? []),
            ]
          : []),
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [query]);

  return (
    <div className="wt-page">
      <header className="wt-hero">
        <Title2 as="h1">{t('launcher.title')}</Title2>
        <Text>{t('launcher.subtitle', { count: tools.length })}</Text>
      </header>

      <div className={styles.searchRow}>
        <Input
          className={styles.search}
          value={query}
          onChange={(_, data) => setQuery(data.value)}
          placeholder={t('launcher.searchPlaceholder')}
          aria-label={t('launcher.searchLabel')}
          contentBefore={<Search20Regular />}
          type="search"
        />
        <Caption1 aria-live="polite">
          {t('launcher.countOf', { shown: filtered.length, total: tools.length })}
        </Caption1>
      </div>

      {filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <Wrench24Filled />
          <Subtitle1 as="h2">{t('launcher.noMatch')}</Subtitle1>
          <Text>{t('launcher.noMatchHint')}</Text>
          <Button appearance="secondary" onClick={() => setQuery('')}>
            {t('launcher.clearSearch')}
          </Button>
        </div>
      ) : (
        <div className="wt-tool-grid">
          {filtered.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}

      {/* Provenance, stated on the page itself rather than only in the README:
          the whole project was written by an agent, and that is worth knowing
          when judging how much to trust it. */}
      <footer className={styles.footer}>
        <Caption1 className={styles.footerItem}>
          <Wrench16Regular /> {t('footer.local')}
        </Caption1>
        <Caption1 className={styles.footerItem}>
          <Code16Regular /> {t('footer.built')} {t('app.builtWithShort')}
        </Caption1>
        <a
          className={styles.footerLink}
          href="https://github.com/zpc1995/wheat-tools"
          target="_blank"
          rel="noreferrer"
        >
          {t('footer.source')} · GitHub
        </a>
      </footer>
    </div>
  );
}
