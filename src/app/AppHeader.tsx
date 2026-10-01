import {
  Button,
  Dropdown,
  Option,
  Text,
  Tooltip,
  makeStyles,
} from '@fluentui/react-components';
import {
  Lightbulb20Regular,
  Navigation20Regular,
} from '@fluentui/react-icons';
import { useAppTheme, type ThemePreference } from './theme';
import { BrandMark } from './BrandMark';
import { useSidebar } from './AppLayout';
import { LOCALES, useI18n, type Locale, type TranslationKey } from '../i18n';

const useStyles = makeStyles({
  title: {
    fontWeight: 600,
  },
  subtitle: {
    color: 'var(--colorNeutralForeground3)',
  },
  language: {
    minWidth: '118px',
  },
  theme: {
    minWidth: '112px',
  },
});

/**
 * Label for the current theme preference.
 *
 * Kept as a lookup rather than inline ternaries so each option's label comes
 * from exactly one place, and the rendered value always matches the list.
 */
const THEME_LABELS: Record<ThemePreference, (t: (key: TranslationKey) => string) => string> = {
  system: (t) => t('header.themeSystem'),
  light: (t) => t('header.themeLight'),
  dark: (t) => t('header.themeDark'),
};

export function AppHeader() {
  const styles = useStyles();
  const { preference, setPreference } = useAppTheme();
  const { open, railVisible, narrow, toggle } = useSidebar();
  const { t, locale, setLocale } = useI18n();

  return (
    <header className="wt-header">
      {/* Works at every width, but means something different at each: on a wide
          screen it collapses the rail, below the breakpoint it opens the overlay
          drawer. Previously it was hidden above the breakpoint by a CSS rule that
          Fluent's runtime-injected styles overrode, so it stayed visible and
          clicking it genuinely did nothing. */}
      <Tooltip
        content={
          narrow
            ? open
              ? t('header.collapseNav')
              : t('header.expandNav')
            : railVisible
              ? t('header.collapseSidebar')
              : t('header.expandSidebar')
        }
        relationship="label"
        withArrow
      >
        <Button
          className="wt-nav-toggle"
          appearance="subtle"
          icon={<Navigation20Regular />}
          onClick={toggle}
          aria-expanded={narrow ? open : railVisible}
          aria-label={t('header.toggleSidebar')}
        />
      </Tooltip>

      {/* Deliberately not a link: the sidebar already has a dedicated
          「工具箱首页」 entry, and making the wordmark clickable as well turned
          the headings into an unexpected navigation target. */}
      <div className="wt-header__brand">
        <BrandMark size={34} />
        <span className="wt-header__titles">
          <Text className={styles.title} size={400}>
            {t('app.name')}
          </Text>
          <Text className={styles.subtitle} size={200}>
            {t('app.subtitle')}
          </Text>
        </span>
      </div>

      <span className="wt-header__spacer" />

      <Tooltip content={t('header.designSpec')} relationship="label" withArrow>
        <Button
          as="a"
          appearance="subtle"
          href="https://fluent2.microsoft.design/"
          target="_blank"
          rel="noreferrer"
          icon={<Lightbulb20Regular />}
          aria-label={t('header.designSpec')}
        />
      </Tooltip>

      {/* A three-way choice rather than a toggle: a toggle cannot express
          "follow the system", and could never return to it once pinned.

          Rendered as a plain Dropdown rather than one with a custom `button`:
          the custom form produced two elements carrying the same aria-label,
          which makes the control ambiguous to a screen reader and to anything
          selecting it by name. */}
      <Tooltip content={t('header.theme')} relationship="label" withArrow>
        <Dropdown
          className={styles.theme}
          value={THEME_LABELS[preference](t)}
          selectedOptions={[preference]}
          onOptionSelect={(_, data) =>
            setPreference(data.optionValue as ThemePreference)
          }
          aria-label={t('header.theme')}
        >
          <Option value="system" text={t('header.themeSystem')}>
            {t('header.themeSystem')}
          </Option>
          <Option value="light" text={t('header.themeLight')}>
            {t('header.themeLight')}
          </Option>
          <Option value="dark" text={t('header.themeDark')}>
            {t('header.themeDark')}
          </Option>
        </Dropdown>
      </Tooltip>

      <Tooltip content={t('header.switchLanguage')} relationship="label" withArrow>
        <Dropdown
          className={styles.language}
          value={LOCALES.find((item) => item.id === locale)?.label ?? locale}
          selectedOptions={[locale]}
          onOptionSelect={(_, data) => setLocale(data.optionValue as Locale)}
          aria-label={t('header.language')}
        >
          {LOCALES.map((item) => (
            <Option key={item.id} value={item.id} text={item.label}>
              {item.label}
            </Option>
          ))}
        </Dropdown>
      </Tooltip>
    </header>
  );
}
