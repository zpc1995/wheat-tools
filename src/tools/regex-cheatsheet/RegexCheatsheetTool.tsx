import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Tab,
  TabList,
  Text,
  Tooltip,
  makeStyles,
  tokens,
  Toast,
  ToastTitle,
  Toaster,
  useId,
  useToastController,
} from '@fluentui/react-components';
import {
  Checkmark16Regular,
  Copy16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import { CHEAT_GROUPS, PITFALLS, flagsForEntry } from './cheatsheetData';

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '12px',
    padding: '8px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  pattern: {
    flex: 'none',
    width: '230px',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12.5px',
    color: tokens.colorBrandForeground1,
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  meaning: {
    flex: '1 1 auto',
    minWidth: 0,
    color: tokens.colorNeutralForeground2,
  },
  sample: {
    flex: 'none',
    maxWidth: '260px',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  pitfalls: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '14px',
    width: '100%',
  },
  pitfall: {
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-start',
  },
  pitfallIcon: {
    flex: 'none',
    marginTop: '2px',
    color: tokens.colorPaletteMarigoldForeground1,
  },
  pitfallBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minWidth: 0,
  },
  pitfallTitle: {
    fontWeight: 600,
  },
});

export function RegexCheatsheetTool() {
  const styles = useStyles();
  const toasterId = useId('cheat-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [group, setGroup] = useState(CHEAT_GROUPS[0].id);
  const [copied, setCopied] = useState<string | null>(null);

  const notify = useCallback(
    (message: string) => {
      dispatchToast(
        <Toast>
          <ToastTitle>{message}</ToastTitle>
        </Toast>,
        { timeout: 1400 },
      );
    },
    [dispatchToast],
  );

  const copy = useCallback(
    async (value: string, key: string) => {
      const ok = await copyText(value);
      if (ok) {
        setCopied(key);
        window.setTimeout(() => setCopied(null), 1400);
        notify('已复制');
      } else {
        notify('复制失败');
      }
    },
    [notify],
  );

  const active = useMemo(
    () => CHEAT_GROUPS.find((item) => item.id === group) ?? CHEAT_GROUPS[0],
    [group],
  );

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <TabList
            selectedValue={group}
            onTabSelect={(_, data) => setGroup(data.value as string)}
          >
            {CHEAT_GROUPS.map((item) => (
              <Tab key={item.id} value={item.id}>
                {item.title}
              </Tab>
            ))}
          </TabList>
          <span className={styles.spacer} />
          <Badge appearance="tint" color="brand" size="small">
            条目均已通过编译与匹配验证
          </Badge>
        </div>

        {/* The claim above is the point of this page: the reference is tested. */}
        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>这份速查表是可执行的</MessageBarTitle>
            每一条都带一个示例字符串，构建测试会真正用该模式去匹配它。
            模式写错、或示例根本匹配不上，测试就会失败——因此这里不会出现
            「看起来对但实际无效」的条目。事实上确有两条在验证时被剔除
            （见下方陷阱中的占有量词）。
          </MessageBarBody>
        </MessageBar>

        <section className="wt-surface" aria-label={`${active.title}速查`}>
          <div className="wt-surface__header">
            <Text size={300} weight="semibold">
              {active.title}
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              {active.entries.length} 条
              {active.note ? ` · ${active.note}` : ''}
            </Caption1>
          </div>
          <div className={`wt-surface__body ${styles.rows}`}>
            {active.entries.map((entry) => {
              const flags = flagsForEntry(entry);
              const key = `${active.id}:${entry.pattern}`;
              const literal = `/${entry.pattern}/${flags}`;
              return (
                <div key={key} className={styles.row}>
                  <span className={styles.pattern}>{literal}</span>
                  <span className={styles.meaning}>
                    {entry.meaning}
                    {flags && (
                      <>
                        {' '}
                        <Badge appearance="tint" color="informative" size="small">
                          {flags}
                        </Badge>
                      </>
                    )}
                  </span>
                  <Tooltip
                    content="这一串确实能匹配左侧模式（已由测试验证）"
                    relationship="description"
                    withArrow
                  >
                    <span className={styles.sample}>{JSON.stringify(entry.sample)}</span>
                  </Tooltip>
                  <Tooltip content="复制模式" relationship="label" withArrow>
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={
                        copied === key ? <Checkmark16Regular /> : <Copy16Regular />
                      }
                      onClick={() => copy(literal, key)}
                      aria-label="复制模式"
                    />
                  </Tooltip>
                </div>
              );
            })}
          </div>
        </section>

        <section className="wt-surface" aria-label="常见陷阱">
          <div className="wt-surface__header">
            <Warning16Regular />
            <Text size={300} weight="semibold">
              常见陷阱
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              这几条是最容易踩且最难排查的
            </Caption1>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.pitfalls}>
              {PITFALLS.map((item) => (
                <div key={item.title} className={styles.pitfall}>
                  <Warning16Regular
                    className={styles.pitfallIcon}
                    style={{
                      color: item.caution
                        ? tokens.colorPaletteRedForeground1
                        : tokens.colorPaletteMarigoldForeground1,
                    }}
                  />
                  <div className={styles.pitfallBody}>
                    <span className={styles.pitfallTitle}>{item.title}</span>
                    <Caption1 className={styles.hint}>{item.detail}</Caption1>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <Caption1 className={styles.hint} style={{ padding: '0 4px' }}>
          想直接试验这些模式？「正则测试」工具支持实时高亮匹配、捕获组查看与
          灾难性回溯提示。
        </Caption1>

        <Divider />
      </div>
    </>
  );
}
