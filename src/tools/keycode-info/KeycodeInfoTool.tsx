import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  Checkmark16Regular,
  Copy16Regular,
  KeyboardRegular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import { ListFilter } from '../../components/ListFilter';
import {
  CODE_VS_KEY_EXAMPLES,
  DEPRECATED_CODE_ALIASES,
  KEY_REFERENCE,
  MAX_HISTORY,
  analyseKeyEvent,
  historyToTsv,
  locationOfCode,
  pushHistory,
  shouldPreventDefault,
  type KeyAnalysis,
  type KeyHistoryEntry,
} from './keycodeInfoUtils';

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  capture: {
    // Focusable on purpose: the key events are read from this element, so a
    // keyboard-only user reaches it with Tab and can tell when it holds focus.
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    minHeight: '132px',
    margin: '16px',
    padding: '18px',
    border: `2px dashed ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusLarge,
    cursor: 'pointer',
    outline: 'none',
  },
  captureFocused: {
    border: `2px solid ${tokens.colorBrandStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  captureHint: {
    color: tokens.colorNeutralForeground3,
    textAlign: 'center',
  },
  bigKey: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '30px',
    fontWeight: 600,
    lineHeight: 1.2,
    wordBreak: 'break-all',
    textAlign: 'center',
  },
  columns: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    padding: '0 16px 16px',
    width: '100%',
  },
  fieldGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '10px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '8px 10px',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    borderRadius: tokens.borderRadiusMedium,
    minWidth: 0,
  },
  fieldLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: '11.5px',
  },
  fieldValue: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '14px',
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '8px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  tableWrap: {
    overflowX: 'auto',
    padding: '0 16px 16px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  headCell: {
    textAlign: 'left',
    padding: '7px 10px',
    color: tokens.colorNeutralForeground3,
    fontWeight: 600,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    whiteSpace: 'nowrap',
  },
  cell: {
    padding: '6px 10px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    verticalAlign: 'top',
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  note: {
    color: tokens.colorNeutralForeground3,
  },
  historyList: {
    display: 'flex',
    flexDirection: 'column',
    padding: '0 16px 16px',
  },
  historyRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: '10px',
    padding: '6px 0',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  index: {
    color: tokens.colorNeutralForeground3,
    minWidth: '28px',
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'right',
  },
});

/** Renders a `key` value so whitespace and invisible characters are visible. */
function visibleKey(key: string): string {
  if (key === ' ') return '␠ （空格）';
  if (key === '\t') return '⇥ （Tab）';
  if (key === '\n') return '⏎ （换行）';
  if (key === '') return '（空）';
  return key;
}

function Field({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.fieldValue} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </div>
  );
}

export function KeycodeInfoTool() {
  const styles = useStyles();
  const [current, setCurrent] = useState<KeyAnalysis | null>(null);
  const [history, setHistory] = useState<KeyHistoryEntry[]>([]);
  const [focused, setFocused] = useState(false);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState('');
  const captureRef = useRef<HTMLDivElement | null>(null);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const targetIsEditable =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable === true;

    // Only the scroll keys are stopped, and never when a browser shortcut is
    // involved nor while a text field has focus — swallowing Ctrl+W or Cmd+L
    // from a page is user-hostile, and trapping Tab breaks keyboard navigation.
    if (
      shouldPreventDefault({
        code: event.code,
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        targetIsEditable,
      })
    ) {
      event.preventDefault();
    }

    const eventLike = {
      key: event.key,
      code: event.code,
      keyCode: event.keyCode,
      which: event.which,
      location: event.location,
      repeat: event.repeat,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    };
    setCurrent(analyseKeyEvent(eventLike));
    setHistory((previous) => pushHistory(previous, eventLike));
    setCopied(false);
  }, []);

  const copyHistory = useCallback(async () => {
    const ok = await copyText(historyToTsv(history));
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1400);
  }, [history]);

  const visibleReference = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (term === '') return KEY_REFERENCE;
    return KEY_REFERENCE.filter((entry) =>
      [entry.code, entry.key, entry.zh, String(entry.keyCode)]
        .join(' ')
        .toLowerCase()
        .includes(term),
    );
  }, [query]);

  const aliasRows = useMemo(
    () => Object.entries(DEPRECATED_CODE_ALIASES),
    [],
  );

  return (
    <div className={styles.stack}>
      <MessageBar intent="warning">
        <MessageBarBody>
          <MessageBarTitle>
            code 是物理位置，key 是产生的字符——两者不是一回事
          </MessageBarTitle>
          <code>event.code</code> 指的是「美式 QWERTY
          键盘上的那个位置」，与键盘布局无关；<code>event.key</code>{' '}
          指的是这次按键<strong>实际产生的字符</strong>。同一个物理键在 Dvorak
          布局下按下 E 所在的位置，<code>code</code> 仍是 <code>KeyE</code>，而{' '}
          <code>key</code> 会变成 <code>.</code>；法语 AZERTY 把 A 和 Q
          对调，按 <code>KeyQ</code> 得到的是 <code>a</code>。旧代码常用的{' '}
          <code>keyCode</code> / <code>which</code> 属于
          <strong>已废弃</strong>属性，它跟着物理键走（字母用大写 ASCII
          码，例如 a 与 A 都是 65），不同浏览器还可能给出不同的值。
        </MessageBarBody>
      </MessageBar>

      <section className="wt-surface" aria-label="按键捕获">
        <div className="wt-surface__header">
          <KeyboardRegular />
          <Text as="h2" size={300} weight="semibold">
            按键捕获
          </Text>
          <span className={styles.spacer} />
          <Caption1 className={styles.note}>
            已记录 {history.length} / {MAX_HISTORY} 次
          </Caption1>
        </div>

        <div
          ref={captureRef}
          className={`${styles.capture} ${focused ? styles.captureFocused : ''}`}
          tabIndex={0}
          role="group"
          aria-label="按键捕获区域，获得焦点后按下任意键查看事件信息"
          onClick={() => captureRef.current?.focus()}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
        >
          {current ? (
            <>
              <span className={styles.bigKey} aria-live="polite">
                {visibleKey(current.key)}
              </span>
              <Caption1 className={styles.captureHint}>
                code = {current.code || '（空）'}
                {current.codeLabel ? ` · ${current.codeLabel}` : ''}
              </Caption1>
            </>
          ) : (
            <>
              <span className={styles.bigKey}>点击这里，然后按任意键</span>
              <Caption1 className={styles.captureHint}>
                需要键盘焦点。按空格或方向键时会阻止页面滚动；带 Ctrl / Cmd /
                Alt 的组合键不会被拦截，浏览器快捷键保持可用。
              </Caption1>
            </>
          )}
        </div>

        {current && (
          <div className={styles.columns}>
            <div className={styles.fieldGrid}>
              <Field label="event.key（字符或键名）" value={visibleKey(current.key)} />
              <Field label="event.code（物理位置）" value={current.code || '（空）'} />
              <div className={styles.field}>
                <span className={styles.fieldLabel}>keyCode（已废弃）</span>
                <span className={styles.fieldValue}>
                  {current.keyCode === null ? '（无）' : current.keyCode}{' '}
                  <Badge appearance="tint" color="warning" size="small">
                    已废弃
                  </Badge>
                </span>
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>which（已废弃）</span>
                <span className={styles.fieldValue}>
                  {current.which === null ? '（无）' : current.which}{' '}
                  <Badge appearance="tint" color="warning" size="small">
                    已废弃
                  </Badge>
                </span>
              </div>
              <Field
                label="location"
                value={`${current.location} · ${current.locationName}`}
              />
              <Field
                label="修饰键"
                value={
                  current.modifierNames.length > 0
                    ? current.modifierNames.join(' + ')
                    : '（无）'
                }
              />
              <Field label="Unicode 码位" value={current.codePointHex ?? '（非字符键）'} />
              <Field label="十进制码位" value={current.codePoint === null ? '（无）' : String(current.codePoint)} />
              <Field label="是否重复（长按）" value={current.repeat ? '是' : '否'} />
              <Field label="keyCode 来源" value={current.keyCodeSource} />
            </div>
            <Caption1 className={styles.note}>{current.note}</Caption1>
          </div>
        )}
      </section>

      <section className="wt-surface" aria-label="按键历史">
        <div className="wt-surface__header">
          <Text as="h2" size={300} weight="semibold">
            按键历史
          </Text>
          <span className={styles.spacer} />
          <Caption1 className={styles.note}>最多保留最近 {MAX_HISTORY} 次</Caption1>
          <Button
            appearance="subtle"
            size="small"
            icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
            onClick={() => void copyHistory()}
            disabled={history.length === 0}
          >
            {copied ? '已复制' : '复制为 TSV'}
          </Button>
        </div>
        {history.length === 0 ? (
          <Caption1 className={styles.note} style={{ padding: '12px 16px 16px' }}>
            还没有记录。在上面的捕获区域按键即可。
          </Caption1>
        ) : (
          <div className={styles.historyList}>
            {history.map((entry) => (
              <div key={entry.index} className={styles.historyRow}>
                <span className={styles.index}>{entry.index}</span>
                <span className={styles.mono}>{visibleKey(entry.analysis.key)}</span>
                <span className={styles.mono}>{entry.analysis.code || '（空）'}</span>
                <Caption1 className={styles.note}>
                  keyCode {entry.analysis.keyCode ?? '—'} · which{' '}
                  {entry.analysis.which ?? '—'} · location{' '}
                  {entry.analysis.locationName}
                  {entry.analysis.modifierNames.length > 0
                    ? ` · ${entry.analysis.modifierNames.join('+')}`
                    : ''}
                  {entry.analysis.repeat ? ' · 长按重复' : ''}
                </Caption1>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="wt-surface" aria-label="code 与 key 的对照例子">
        <div className="wt-surface__header">
          <Text as="h2" size={300} weight="semibold">
            code 与 key 的对照例子
          </Text>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.headCell}>场景</th>
                <th className={styles.headCell}>code</th>
                <th className={styles.headCell}>key</th>
                <th className={styles.headCell}>keyCode</th>
                <th className={styles.headCell}>说明</th>
              </tr>
            </thead>
            <tbody>
              {CODE_VS_KEY_EXAMPLES.map((example) => (
                <tr key={example.scenario}>
                  <td className={styles.cell}>{example.scenario}</td>
                  <td className={`${styles.cell} ${styles.mono}`}>{example.code}</td>
                  <td className={`${styles.cell} ${styles.mono}`}>
                    {visibleKey(example.key)}
                  </td>
                  <td className={`${styles.cell} ${styles.mono}`}>{example.keyCode}</td>
                  <td className={`${styles.cell} ${styles.note}`}>{example.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="wt-surface" aria-label="常用键位对照表">
        <div className="wt-surface__header">
          <Text as="h2" size={300} weight="semibold">
            常用键位对照表（美式 QWERTY）
          </Text>
          <span className={styles.spacer} />
          <Caption1 className={styles.note}>
            {visibleReference.length} / {KEY_REFERENCE.length} 条
          </Caption1>
        </div>
        <ListFilter
          value={query}
          onChange={setQuery}
          shown={visibleReference.length}
          total={KEY_REFERENCE.length}
          label="搜索键位"
          placeholder="搜索 code、key 或 keyCode，例如 Shift、65、Numpad"
        />
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.headCell}>code</th>
                <th className={styles.headCell}>key（美式）</th>
                <th className={styles.headCell}>keyCode</th>
                <th className={styles.headCell}>location</th>
                <th className={styles.headCell}>说明</th>
              </tr>
            </thead>
            <tbody>
              {visibleReference.map((entry) => (
                <tr key={entry.code}>
                  <td className={`${styles.cell} ${styles.mono}`}>{entry.code}</td>
                  <td className={`${styles.cell} ${styles.mono}`}>
                    {visibleKey(entry.key)}
                  </td>
                  <td className={`${styles.cell} ${styles.mono}`}>{entry.keyCode}</td>
                  <td className={`${styles.cell} ${styles.mono}`}>
                    {locationOfCode(entry.code)}
                  </td>
                  <td className={`${styles.cell} ${styles.note}`}>{entry.zh}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="wt-surface" aria-label="已废弃的 code 别名">
        <div className="wt-surface__header">
          <Text as="h2" size={300} weight="semibold">
            已废弃的 code 别名
          </Text>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.headCell}>旧写法</th>
                <th className={styles.headCell}>现状</th>
              </tr>
            </thead>
            <tbody>
              {aliasRows.map(([oldCode, replacement]) => (
                <tr key={oldCode}>
                  <td className={`${styles.cell} ${styles.mono}`}>{oldCode}</td>
                  <td className={`${styles.cell} ${styles.note}`}>{replacement}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Caption1 className={styles.note} style={{ padding: '0 4px' }}>
        边界：本工具只读取并展示浏览器给的键盘事件，不做按键模拟（不会替你按下任何键），
        不做按键宏或输入录制，也不监听输入框内容。keyCode / which
        之所以仍要显示，是因为大量存量代码还在读它们；新代码请改用{' '}
        <code>event.key</code>（要字符）或 <code>event.code</code>（要物理位置）。
      </Caption1>

      <Divider />
    </div>
  );
}
