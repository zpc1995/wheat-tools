import {
  Badge,
  Button,
  Caption1,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Tab,
  TabList,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowSwap16Regular,
  Broom16Regular,
  Checkmark16Regular,
  Copy16Regular,
  DocumentText16Regular,
  Settings16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { useCallback, useMemo, useState } from 'react';
import { MAPPING_NOTES, SAMPLE_TOML, SAMPLE_YAML, tomlToYaml, yamlToToml } from './tomlYamlUtils';

type Direction = 'toml-to-yaml' | 'yaml-to-toml';

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    width: '100%',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px 14px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  note: {
    lineHeight: 1.7,
  },
  list: {
    margin: 0,
    paddingInlineStart: '22px',
    lineHeight: 1.8,
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
  },
  warnings: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
});

async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Reporting the failure is more honest than flashing a "copied" state for a
    // copy that never happened.
    return false;
  }
}

export function TomlYamlTool() {
  const styles = useStyles();

  const [direction, setDirection] = useState<Direction>('toml-to-yaml');
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);

  const result = useMemo(
    () => (direction === 'toml-to-yaml' ? tomlToYaml(input) : yamlToToml(input)),
    [direction, input],
  );

  const output = result.ok ? result.text : '';
  const errorMessage = result.ok ? '' : (result.error ?? '转换失败');

  const handleCopy = useCallback(async () => {
    if (!output) return;
    const ok = await copyToClipboard(output);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1400);
  }, [output]);

  const handleSwap = useCallback(() => {
    setInput(output);
    setDirection((current) => (current === 'toml-to-yaml' ? 'yaml-to-toml' : 'toml-to-yaml'));
    setCopied(false);
  }, [output]);

  const handleClear = useCallback(() => {
    setInput('');
    setCopied(false);
  }, []);

  const handleSample = useCallback(() => {
    setInput(direction === 'toml-to-yaml' ? SAMPLE_TOML : SAMPLE_YAML);
  }, [direction]);

  return (
    <div className={styles.stack}>
      <TabList
        selectedValue={direction}
        onTabSelect={(_, data) => setDirection(data.value as Direction)}
      >
        <Tab value="toml-to-yaml">TOML → YAML</Tab>
        <Tab value="yaml-to-toml">YAML → TOML</Tab>
      </TabList>

      <div className={styles.toolbar}>
        <Caption1 className={styles.hint}>
          复用 TOML 转 JSON 的自写解析器与 yaml 依赖；两个方向的类型映射见下方说明。
        </Caption1>
        <span className={styles.spacer} />
        <Button
          appearance="secondary"
          icon={<ArrowSwap16Regular />}
          onClick={handleSwap}
          disabled={!output}
        >
          交换方向
        </Button>
        <Button appearance="subtle" icon={<Broom16Regular />} onClick={handleClear} disabled={!input}>
          清空
        </Button>
      </div>

      <MessageBar intent="warning">
        <MessageBarBody>
          <MessageBarTitle>映射约定（两个格式的类型系统不同构，约定不唯一）</MessageBarTitle>
          <ul className={styles.list}>
            {MAPPING_NOTES.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </MessageBarBody>
      </MessageBar>

      <Caption1 className={styles.hint}>
        时间戳的判定与 PyYAML 一致：不带引号的 <span className={styles.mono}>2001-12-15</span>、
        <span className={styles.mono}>2001-12-15 02:59:43</span> 会被当成时间戳而不是字符串——想要字符串就加引号。
        YAML 解析遵循 1.2 core（<span className={styles.mono}>yes</span>、
        <span className={styles.mono}>1_000</span> 等都是字符串），输出时会给这类写法补上引号，保证任何读取器里含义相同。
        输入上限 512 KB，嵌套上限 100 层，别名展开上限 100 次。
      </Caption1>

      <div className="wt-split">
        <section className="wt-surface" aria-label="输入">
          <div className="wt-surface__header">
            <DocumentText16Regular />
            <Text as="h2" size={300} weight="semibold">
              输入
            </Text>
            <span className={styles.spacer} />
            <Button appearance="subtle" size="small" onClick={handleSample}>
              填入示例
            </Button>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <textarea
              className="wt-code-area"
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                setCopied(false);
              }}
              placeholder={
                direction === 'toml-to-yaml'
                  ? '在此粘贴 TOML，例如：\ntitle = "小麦"\n[owner]\nborn = 1979-05-27T07:32:00Z\nalarm = 07:32:00'
                  : '在此粘贴 YAML，例如：\ntitle: 小麦\nowner:\n  born: 2001-12-15T02:59:43Z'
              }
              aria-label={direction === 'toml-to-yaml' ? '待转换的 TOML' : '待转换的 YAML'}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
            />
          </div>
        </section>

        <section className="wt-surface" aria-label="输出">
          <div className="wt-surface__header">
            <Settings16Regular />
            <Text as="h2" size={300} weight="semibold">
              输出
            </Text>
            <span className={styles.spacer} />
            {output && (
              <>
                <Badge appearance="tint" color="brand" size="small">
                  {direction === 'toml-to-yaml' ? 'YAML' : 'TOML'}
                </Badge>
                <Tooltip content="复制结果" relationship="label" withArrow>
                  <Button
                    appearance="subtle"
                    icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
                    onClick={handleCopy}
                    aria-label="复制结果"
                  />
                </Tooltip>
              </>
            )}
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            {errorMessage ? (
              <div style={{ padding: '12px 14px' }}>
                <MessageBar intent="error" layout="multiline">
                  <MessageBarBody>
                    <MessageBarTitle>无法转换</MessageBarTitle>
                    <div className={`${styles.note} ${styles.mono}`}>{errorMessage}</div>
                  </MessageBarBody>
                </MessageBar>
              </div>
            ) : output ? (
              <>
                {result.warnings.length > 0 && (
                  <div style={{ padding: '12px 14px 0' }}>
                    <MessageBar intent="warning" layout="multiline">
                      <MessageBarBody>
                        <MessageBarTitle>类型提醒</MessageBarTitle>
                        <div className={styles.warnings}>
                          {result.warnings.map((warning) => (
                            <div key={warning} className={styles.note}>
                              <Warning16Regular /> {warning}
                            </div>
                          ))}
                        </div>
                      </MessageBarBody>
                    </MessageBar>
                  </div>
                )}
                <textarea
                  className="wt-code-area"
                  value={output}
                  readOnly
                  aria-label="转换结果"
                  spellCheck={false}
                />
              </>
            ) : (
              <div className="wt-empty">
                <Settings16Regular />
                <Text weight="semibold">{input.trim() ? '没有可显示的转换结果' : '等待输入'}</Text>
                <Caption1>
                  {direction === 'toml-to-yaml'
                    ? '粘贴 TOML 后立即得到 YAML；本地时间会写成 $type 标签映射，大整数丢精度会警告'
                    : '粘贴 YAML 后立即得到 TOML；null 与非字符串键会报错并指出键名，锚点与别名会展开'}
                </Caption1>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
