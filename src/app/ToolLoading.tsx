import { Caption1, Skeleton, SkeletonItem, Text, makeStyles, tokens } from '@fluentui/react-components';
import { useI18n } from '../i18n';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '18px 20px',
    borderRadius: 'var(--wt-surface-radius)',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
});

/**
 * Placeholder shown while a tool's chunk is being fetched.
 *
 * A skeleton rather than a spinner: it communicates the shape of what is
 * coming, and because chunks are usually prefetched on hover it is normally
 * visible for only a frame or two.
 */
export function ToolLoading({ name }: { name?: string }) {
  const styles = useStyles();
  const { t } = useI18n();

  return (
    <div className={styles.root} aria-busy="true" aria-live="polite">
      <div className={styles.head}>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          {name ? t('toolPage.loading', { name }) : t('toolPage.loadingGeneric')}
        </Text>
      </div>

      <div className={styles.card}>
        <Skeleton>
          <SkeletonItem size={16} style={{ width: '40%' }} />
        </Skeleton>
        <Skeleton>
          <SkeletonItem size={12} style={{ width: '100%' }} />
        </Skeleton>
        <Skeleton>
          <SkeletonItem size={12} style={{ width: '85%' }} />
        </Skeleton>
      </div>

      <div className={styles.card}>
        <Skeleton>
          <SkeletonItem size={12} style={{ width: '30%' }} />
        </Skeleton>
        <Skeleton>
          <SkeletonItem size={64} style={{ width: '100%' }} />
        </Skeleton>
      </div>

      <Caption1 style={{ color: tokens.colorNeutralForeground4 }}>
        {t('toolPage.loadingHint')}
      </Caption1>
    </div>
  );
}
