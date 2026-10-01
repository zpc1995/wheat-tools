import { Button, Text, Tooltip, makeStyles } from '@fluentui/react-components';
import {
  Lightbulb20Regular,
  Navigation20Regular,
  WeatherMoon20Regular,
  WeatherSunny20Regular,
} from '@fluentui/react-icons';
import { Link } from 'react-router-dom';
import { useAppTheme } from './theme';
import { BrandMark } from './BrandMark';
import { useSidebar } from './AppLayout';

const useStyles = makeStyles({
  title: {
    fontWeight: 600,
  },
  subtitle: {
    color: 'var(--colorNeutralForeground3)',
  },
});

export function AppHeader() {
  const styles = useStyles();
  const { mode, toggleMode } = useAppTheme();
  const { open, toggle } = useSidebar();

  return (
    <header className="wt-header">
      {/* Only shown on narrow screens, where the sidebar is a drawer. */}
      <Tooltip content="展开/收起导航" relationship="label" withArrow>
        <Button
          className="wt-nav-toggle"
          appearance="subtle"
          icon={<Navigation20Regular />}
          onClick={toggle}
          aria-expanded={open}
          aria-label="展开或收起导航栏"
        />
      </Tooltip>

      <Link className="wt-header__brand" to="/" aria-label="返回工具箱首页">
        <BrandMark size={34} />
        <span className="wt-header__titles">
          <Text className={styles.title} size={400}>
            wheat tools
          </Text>
          <Text className={styles.subtitle} size={200}>
            麦工具
          </Text>
        </span>
      </Link>

      <span className="wt-header__spacer" />

      <Tooltip content="设计规范：Fluent 2" relationship="label" withArrow>
        <Button
          as="a"
          appearance="subtle"
          href="https://fluent2.microsoft.design/"
          target="_blank"
          rel="noreferrer"
          icon={<Lightbulb20Regular />}
          aria-label="Fluent 2 设计规范"
        />
      </Tooltip>

      <Tooltip
        content={mode === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
        relationship="label"
        withArrow
      >
        <Button
          appearance="subtle"
          icon={mode === 'dark' ? <WeatherSunny20Regular /> : <WeatherMoon20Regular />}
          onClick={toggleMode}
          aria-label={mode === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
        />
      </Tooltip>
    </header>
  );
}
