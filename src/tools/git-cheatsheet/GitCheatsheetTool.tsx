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
  Toast,
  ToastTitle,
  Toaster,
  Tooltip,
  makeStyles,
  tokens,
  useId,
  useToastController,
} from '@fluentui/react-components';
import {
  BookOpenRegular,
  Checkmark16Regular,
  Copy16Regular,
  ShieldCheckmark16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import { ListFilter, NoMatches } from '../../components/ListFilter';
import {
  DANGER_META,
  GIT_GROUPS,
  PLACEHOLDERS,
  flattenCommands,
  searchCommands,
  type DangerLevel,
} from './gitCheatsheetData';

const DANGER_COLOR: Record<DangerLevel, 'success' | 'warning' | 'danger'> = {
  safe: 'success',
  caution: 'warning',
  danger: 'danger',
};

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
    flexDirection: 'column',
    gap: '6px',
    padding: '12px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  commandLine: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  command: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
    fontVariantNumeric: 'tabular-nums',
    color: tokens.colorBrandForeground1,
    userSelect: 'all',
    overflowWrap: 'anywhere',
  },
  summary: {
    color: tokens.colorNeutralForeground1,
  },
  detail: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    paddingLeft: '2px',
  },
  recovery: {
    color: tokens.colorPaletteMarigoldForeground1,
  },
  legendRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'baseline',
    padding: '10px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  legendLabel: {
    flex: 'none',
    width: '120px',
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  placeholderRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'baseline',
    padding: '8px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  token: {
    flex: 'none',
    width: '130px',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12.5px',
    fontVariantNumeric: 'tabular-nums',
    color: tokens.colorBrandForeground1,
    userSelect: 'all',
  },
});

function DangerBadge({ level }: { level: DangerLevel }) {
  return (
    <Tooltip content={DANGER_META[level].detail} relationship="description" withArrow>
      <Badge appearance="tint" color={DANGER_COLOR[level]} size="small">
        {DANGER_META[level].label}
      </Badge>
    </Tooltip>
  );
}

export function GitCheatsheetTool() {
  const styles = useStyles();
  const toasterId = useId('git-cheat-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [group, setGroup] = useState(GIT_GROUPS[0].id);
  const [query, setQuery] = useState('');
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
    async (value: string) => {
      const ok = await copyText(value);
      if (ok) {
        setCopied(value);
        window.setTimeout(() => setCopied(null), 1400);
        notify('已复制');
      } else {
        notify('复制失败');
      }
    },
    [notify],
  );

  const searching = query.trim() !== '';
  const total = flattenCommands().length;

  // A search spans every section, not just the open tab: a filter that only
  // looked at the visible tab would hide the entry the user is after.
  const visible = useMemo(() => {
    if (searching) return searchCommands(query);
    const active = GIT_GROUPS.find((item) => item.id === group) ?? GIT_GROUPS[0];
    return active.entries.map((entry) => ({ entry, group: active }));
  }, [searching, query, group]);

  const activeGroup = GIT_GROUPS.find((item) => item.id === group) ?? GIT_GROUPS[0];

  const dangerCounts = useMemo(() => {
    const all = flattenCommands();
    return {
      safe: all.filter(({ entry }) => entry.danger === 'safe').length,
      caution: all.filter(({ entry }) => entry.danger === 'caution').length,
      danger: all.filter(({ entry }) => entry.danger === 'danger').length,
    };
  }, []);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>按场景查，不按字母序查</MessageBarTitle>
            {total} 条命令按「想做什么」分组：日常提交、分支、撤销与回退、查看历史、暂存、远程协作、排查问题。
            每条都有一句话说明、使用场景和<strong>危险性等级</strong>。
            这是一个纯速查表，<strong>不会执行任何 git 命令</strong>，也不访问你的仓库；
            复制走之后请自己在终端里确认当前状态再执行。
          </MessageBarBody>
        </MessageBar>

        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>先看危险等级再敲回车</MessageBarTitle>
            本表共 {dangerCounts.danger} 条<strong>危险</strong>、{dangerCounts.caution} 条<strong>注意</strong>、
            {' '}{dangerCounts.safe} 条<strong>安全</strong>。危险命令会丢掉未提交的内容，或改写别人已经拉取过的历史；
            其中标了「危险」的条目都写了怎么补救——多数要靠 <span className={styles.command}>git reflog</span>，
            而 <span className={styles.command}>git clean</span> 删掉的未跟踪文件谁都救不回来。
          </MessageBarBody>
        </MessageBar>

        <div className={styles.toolbar}>
          <TabList
            selectedValue={searching ? null : group}
            onTabSelect={(_, data) => {
              // Picking a tab while searching leaves the search; otherwise the
              // tab would appear to do nothing.
              if (searching) setQuery('');
              setGroup(data.value as string);
            }}
          >
            {GIT_GROUPS.map((item) => (
              <Tab key={item.id} value={item.id}>
                {item.title}
              </Tab>
            ))}
          </TabList>
          <span className={styles.spacer} />
          <Badge appearance="tint" color="brand" size="small">
            危险性分级已由检查脚本按语义校验
          </Badge>
        </div>

        <section className="wt-surface" aria-label={searching ? '搜索结果' : `${activeGroup.title}速查`}>
          <div className="wt-surface__header">
            <BookOpenRegular />
            <Text as="h2" size={300} weight="semibold">
              {searching ? `搜索「${query.trim()}」` : activeGroup.title}
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              {searching
                ? `在全部 ${GIT_GROUPS.length} 组、${total} 条里查找`
                : `${activeGroup.entries.length} 条${activeGroup.note ? ` · ${activeGroup.note}` : ''}`}
            </Caption1>
          </div>

          <ListFilter
            value={query}
            onChange={setQuery}
            shown={visible.length}
            total={total}
            label="搜索 git 命令"
            placeholder="搜索命令、说明或场景，例如 撤销、reflog、rebase、暂存"
          />

          {visible.length === 0 ? (
            <NoMatches
              query={query.trim()}
              hint="可以试试「撤销」「分支」「reflog」「冲突」这类词，或者直接搜 reset、bisect。"
            />
          ) : (
            <div className={`wt-surface__body ${styles.rows}`}>
              {visible.map(({ entry, group: owner }) => (
                <div key={entry.command} className={styles.row}>
                  <div className={styles.commandLine}>
                    <code className={styles.command}>{entry.command}</code>
                    <DangerBadge level={entry.danger} />
                    {searching ? (
                      <Badge appearance="outline" size="small">
                        {owner.title}
                      </Badge>
                    ) : null}
                    <span className={styles.spacer} />
                    <Tooltip content="复制命令" relationship="label" withArrow>
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={copied === entry.command ? <Checkmark16Regular /> : <Copy16Regular />}
                        onClick={() => copy(entry.command)}
                        aria-label={`复制命令 ${entry.command}`}
                      />
                    </Tooltip>
                  </div>
                  <div className={styles.detail}>
                    <span className={styles.summary}>{entry.summary}</span>
                    <Caption1 className={styles.hint}>使用场景：{entry.scenario}</Caption1>
                    {entry.recovery ? (
                      <Caption1 className={styles.recovery}>出错了怎么补救：{entry.recovery}</Caption1>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="wt-surface" aria-label="危险性分级">
          <div className="wt-surface__header">
            <Warning16Regular />
            <Text as="h2" size={300} weight="semibold">
              危险性分级怎么定
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>看会不会丢数据，而不是看命令长得多吓人</Caption1>
          </div>
          <div className={styles.column}>
            {(['safe', 'caution', 'danger'] as DangerLevel[]).map((level) => (
              <div key={level} className={styles.legendRow}>
                <span className={styles.legendLabel}>
                  <Badge appearance="tint" color={DANGER_COLOR[level]} size="small">
                    {DANGER_META[level].label}
                  </Badge>
                </span>
                <Caption1 className={styles.hint}>{DANGER_META[level].detail}</Caption1>
              </div>
            ))}
            <div className={styles.legendRow}>
              <span className={styles.legendLabel}>
                <ShieldCheckmark16Regular />
              </span>
              <Caption1 className={styles.hint}>
                检查脚本会强制这条规则：<span className={styles.command}>git status / log / diff / show / blame / reflog</span>
                {' '}这类只读命令必须标成「安全」，而带 <span className={styles.command}>--hard</span>、
                {' '}<span className={styles.command}>clean -fd</span>、<span className={styles.command}>--force</span>、
                {' '}<span className={styles.command}>rebase</span> 的命令必须标成「危险」。
                等级写错，脚本就会失败。
              </Caption1>
            </div>
          </div>
        </section>

        <section className="wt-surface" aria-label="占位符约定">
          <div className="wt-surface__header">
            <Text as="h2" size={300} weight="semibold">
              占位符约定
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>尖括号里是你要替换的部分，全表只有这些写法</Caption1>
          </div>
          <div className={styles.column}>
            {PLACEHOLDERS.map((item) => (
              <div key={item.token} className={styles.placeholderRow}>
                <span className={styles.token}>{item.token}</span>
                <Caption1 className={styles.hint}>{item.meaning}</Caption1>
              </div>
            ))}
          </div>
        </section>

        <Caption1 className={styles.hint} style={{ padding: '0 4px' }}>
          命令语义以 Git 官方手册为准（git-scm.com/docs 下的 git-reset、git-clean、git-restore、git-rebase、
          git-push、git-bisect 等页面）。如果你要找的不是 git，仓库里还有「正则速查表」。
        </Caption1>

        <Divider />
      </div>
    </>
  );
}
