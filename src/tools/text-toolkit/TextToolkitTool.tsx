import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  Dropdown,
  MessageBar,
  MessageBarBody,
  Option,
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
  ArrowDownload16Regular,
  ArrowUndo16Regular,
  Broom16Regular,
  Checkmark16Regular,
  Copy16Regular,
  TextBulletListSquare16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  TEXT_OPERATIONS,
  analyseText,
  applyLineEnding,
  type LineEnding,
  type TextOperation,
} from './textUtils';

const GROUPS = ['大小写', '行处理', '空白与标点', '编码', '统计'] as const;

/** Operations that are not idempotent and could destroy input if misclicked. */
const DESTRUCTIVE = new Set(['shuffle-lines']);

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
  ops: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    width: '100%',
    padding: '14px',
  },
  group: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    alignItems: 'center',
  },
  groupLabel: {
    flex: 'none',
    width: '84px',
    color: tokens.colorNeutralForeground3,
  },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    width: '100%',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '10px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  statValue: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '17px',
    fontVariantNumeric: 'tabular-nums',
  },
  dupRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    padding: '6px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  dupCount: {
    flex: 'none',
    width: '42px',
    color: tokens.colorPaletteMarigoldForeground2,
    fontVariantNumeric: 'tabular-nums',
  },
  dupLine: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12.5px',
    overflowWrap: 'anywhere',
  },
});

export function TextToolkitTool() {
  const styles = useStyles();
  const toasterId = useId('text-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [input, setInput] = useState('');
  const [ending, setEnding] = useState<LineEnding>('keep');
  const [copied, setCopied] = useState(false);

  // History of the raw input only: applying an op mutates `input`, so undo
  // restores the previous text rather than trying to invert the operation
  // (impossible for lossy ones like dedupe).
  const [history, setHistory] = useState<string[]>([]);

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

  const output = useMemo(() => applyLineEnding(input, ending), [input, ending]);
  const stats = useMemo(() => analyseText(input), [input]);

  const copy = useCallback(async () => {
    const ok = await copyText(output);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
      notify('已复制结果');
    } else {
      notify('复制失败');
    }
  }, [output, notify]);

  const apply = useCallback(
    (operation: TextOperation) => {
      setHistory((previous) => [...previous.slice(-49), input]);
      setInput(operation.run(input));
      notify(`已应用：${operation.label}`);
    },
    [input, notify],
  );

  const undo = useCallback(() => {
    setHistory((previous) => {
      if (previous.length === 0) return previous;
      setInput(previous[previous.length - 1]);
      return previous.slice(0, -1);
    });
  }, []);

  const download = useCallback(() => {
    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'text-output.txt';
    link.click();
    URL.revokeObjectURL(url);
  }, [output]);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <Dropdown
            style={{ minWidth: 190 }}
            value={
              ending === 'keep'
                ? '保持原有换行符'
                : ending === 'lf'
                  ? '换行符：LF（\\n）'
                  : '换行符：CRLF（\\r\\n）'
            }
            selectedOptions={[ending]}
            onOptionSelect={(_, data) =>
              setEnding(data.optionValue as LineEnding)
            }
            aria-label="换行符"
          >
            <Option value="keep">保持原有换行符</Option>
            <Option value="lf">换行符：LF（\n）</Option>
            <Option value="crlf">换行符：CRLF（\r\n）</Option>
          </Dropdown>

          <Button
            appearance="secondary"
            icon={<ArrowUndo16Regular />}
            onClick={undo}
            disabled={history.length === 0}
          >
            撤销（{history.length}）
          </Button>

          <span className={styles.spacer} />

          <Tooltip content="下载为 txt" relationship="label" withArrow>
            <Button
              appearance="subtle"
              icon={<ArrowDownload16Regular />}
              onClick={download}
              disabled={!output}
              aria-label="下载为 txt"
            />
          </Tooltip>
          <Tooltip content="复制结果" relationship="label" withArrow>
            <Button
              appearance="subtle"
              icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
              onClick={() => void copy()}
              disabled={!output}
              aria-label="复制结果"
            />
          </Tooltip>
          <Tooltip content="清空" relationship="label" withArrow>
            <Button
              appearance="subtle"
              icon={<Broom16Regular />}
              onClick={() => {
                setHistory((previous) => [...previous.slice(-49), input]);
                setInput('');
              }}
              disabled={!input}
              aria-label="清空"
            />
          </Tooltip>
        </div>

        <section className="wt-surface" aria-label="文本输入">
          <div className="wt-surface__header">
            <TextBulletListSquare16Regular />
            <Text as="h2" size={300} weight="semibold">
              输入
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              所有处理都在本地完成；每次操作都会记入撤销历史
            </Caption1>
          </div>
          <div className="wt-surface__body">
            <textarea
              className="wt-code-area"
              value={output}
              onChange={(event) => setInput(event.target.value)}
              placeholder="在此输入或粘贴文本，然后点击下方任一操作…"
              aria-label="文本输入"
              spellCheck={false}
            />
          </div>
        </section>

        <section className="wt-surface" aria-label="文本操作">
          <div className="wt-surface__header">
            <Text as="h2" size={300} weight="semibold">
              操作
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              点击即作用于上方文本
            </Caption1>
          </div>
          <div className="wt-surface__body">
            <div className={styles.ops}>
              {GROUPS.map((group) => (
                <div key={group} className={styles.group}>
                  <Caption1 className={styles.groupLabel}>{group}</Caption1>
                  {TEXT_OPERATIONS.filter((op) => op.group === group).map((op) => (
                    <Tooltip
                      key={op.id}
                      content={
                        DESTRUCTIVE.has(op.id)
                          ? '结果随机，可用「撤销」还原'
                          : op.label
                      }
                      relationship="description"
                      withArrow
                    >
                      <Button
                        appearance={
                          DESTRUCTIVE.has(op.id) ? 'outline' : 'secondary'
                        }
                        size="small"
                        onClick={() => apply(op)}
                        disabled={!input}
                      >
                        {op.label}
                      </Button>
                    </Tooltip>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="wt-surface" aria-label="统计">
          <div className="wt-surface__header">
            <Text as="h2" size={300} weight="semibold">
              统计
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              中文按字计数，其余按空白分词
            </Caption1>
          </div>
          <div className={`wt-surface__body ${styles.stats}`}>
            {[
              ['行数', stats.lines],
              ['非空行', stats.nonEmptyLines],
              ['词数', stats.words],
              ['字符数', stats.chars],
              ['不含空白', stats.charsNoSpace],
              ['UTF-8 字节', stats.bytes],
            ].map(([label, value]) => (
              <div key={String(label)} className={styles.stat}>
                <Caption1 className={styles.hint}>{label}</Caption1>
                <span className={styles.statValue}>{value}</span>
              </div>
            ))}
          </div>
        </section>

        {stats.duplicates.length > 0 && (
          <section className="wt-surface" aria-label="重复行">
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                重复行
              </Text>
              <Badge appearance="tint" color="warning" size="small">
                {stats.duplicates.length} 组
              </Badge>
              <span className={styles.spacer} />
              <Caption1 className={styles.hint}>按出现次数排序</Caption1>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              {stats.duplicates.map((item) => (
                <div key={item.line} className={styles.dupRow}>
                  <span className={styles.dupCount}>×{item.count}</span>
                  <span className={styles.dupLine}>{item.line}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <MessageBar intent="info">
          <MessageBarBody>
            「全角转半角」等操作会按 Unicode 码位移动字符，对日文假名与部分符号
            可能不符合预期；「随机打乱行序」使用 Fisher–Yates 洗牌（而非
            <code>sort(() =&gt; Math.random() - 0.5)</code>，后者分布不均匀），
            结果随机且可用撤销还原。
          </MessageBarBody>
        </MessageBar>

        <Divider />
      </div>
    </>
  );
}
