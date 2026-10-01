import { Button, Text, Tooltip, makeStyles } from '@fluentui/react-components';
import {
  ArrowLeft20Regular,
  Lightbulb20Regular,
  WeatherMoon20Regular,
  WeatherSunny20Regular,
} from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';
import { useAppTheme } from './theme';
import { BrandMark } from './BrandMark';

const useStyles = makeStyles({
  title: {
    fontWeight: 600,
  },
  subtitle: {
    color: 'var(--colorNeutralForeground3)',
  },
});

interface AppHeaderProps {
  /** When set, a back-to-launcher button is rendered on the left. */
  backTo?: string;
}

export function AppHeader({ backTo }: AppHeaderProps) {
  const styles = useStyles();
  const { mode, toggleMode } = useAppTheme();
  const navigate = useNavigate();

  return (
    <header className="wt-header">
      {backTo && (
        <Tooltip content="返回工具箱" relationship="label" withArrow>
          <Button
            appearance="subtle"
            icon={<ArrowLeft20Regular />}
            onClick={() => navigate(backTo)}
            aria-label="返回工具箱"
          />
        </Tooltip>
      )}

      <div className="wt-header__brand">
        <BrandMark size={34} />
        <span className="wt-header__titles">
          <Text className={styles.title} size={400}>
            wheat tools
          </Text>
          <Text className={styles.subtitle} size={200}>
            麦工具
          </Text>
        </span>
      </div>

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
