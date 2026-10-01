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
  WeatherMoon20Regular,
  WeatherSunny20Regular,
} from '@fluentui/react-icons';
import { useAppTheme } from './theme';
import { BrandMark } from './BrandMark';
import { useSidebar } from './AppLayout';
import { LOCALES, useI18n, type Locale } from '../i18n';

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
});

export function AppHeader() {
  const styles = useStyles();
  const { mode, toggleMode } = useAppTheme();
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

      <Tooltip
        content={mode === 'dark' ? t('header.themeToLight') : t('header.themeToDark')}
        relationship="label"
        withArrow
      >
        <Button
          appearance="subtle"
          icon={mode === 'dark' ? <WeatherSunny20Regular /> : <WeatherMoon20Regular />}
          onClick={toggleMode}
          aria-label={mode === 'dark' ? t('header.themeToLight') : t('header.themeToDark')}
        />
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
