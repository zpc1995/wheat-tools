import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Checkbox,
  Divider,
  Dropdown,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  Text,
  Tooltip,
  makeStyles,
  tokens,
  useId,
  useToastController,
  Toast,
  ToastTitle,
  Toaster,
} from '@fluentui/react-components';
import {
  ArrowSync16Regular,
  Checkmark16Regular,
  Copy16Regular,
  DocumentText16Regular,
  Filter16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  DEFAULT_DIFF_OPTIONS,
  applyChanges,
  changeKindLabel,
  changesToJson,
  changesToText,
  deepEqual,
  diff,
  hasContentChanges,
  parseJsonInput,
  visibleChanges,
  type ArrayMode,
  type ChangeKind,
  type DiffOptions,
  type JsonChange,
  type JsonValue,
} from './jsonDiffUtils';

/**
 * The tool surface.
 *
 * The heavy lifting lives in `jsonDiffUtils`; this file is about making the result
 * legible: which changes exist, what each one did, and — the part a text diff
 * cannot offer — whether anything actually changed at all once array elements are
 * matched by identity.
 */

const SAMPLE_BEFORE = `{
  "name": "wheat-tools",
  "version": "0.1.0",
  "tags": ["tools", "json"],
  "users": [
    { "id": 1, "name": "Ada",  "role": "admin" },
    { "id": 2, "name": "Linus", "role": "user" }
  ],
  "limits": { "maxBytes": 1048576, "retries": 3 }
}`;

const SAMPLE_AFTER = `{
  "name": "wheat-tools",
  "version": "0.2.0",
  "tags": ["tools", "json"],
  "users": [
    { "id": 2, "name": "Linus", "role": "maintainer" },
    { "id": 1, "name": "Ada",   "role": "admin" }
  ],
  "limits": { "maxBytes": "1048576", "retries": 3 },
  "archived": false
}`;

/** Changes shown at once; the rest are behind "show more". */
const PAGE_SIZE = 200;
/** Above this many characters the live parse is skipped until the user asks. */
const LIVE_PARSE_LIMIT = 400_000;

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    width: '100%',
    minWidth: 0,
  },
  intro: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  pane: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    overflow: 'hidden',
    background: tokens.colorNeutralBackground1,
  },
  paneHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    background: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  spacer: {
    flex: '1 1 auto',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
  },
  field: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
    gap: '8px',
    width: '100%',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '8px 12px',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  statValue: {
    fontFamily: 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace',
    fontVariantNumeric: 'tabular-nums',
    fontSize: '18px',
    fontWeight: 600,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '440px',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '76px minmax(120px, 1fr) minmax(0, 2fr)',
    gap: '10px',
    alignItems: 'baseline',
    padding: '6px 10px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    minWidth: 0,
  },
  path: {
    fontFamily: 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace',
    fontSize: '12.5px',
    wordBreak: 'break-all',
    color: tokens.colorNeutralForeground1,
  },
  values: {
    fontFamily: 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace',
    fontSize: '12.5px',
    wordBreak: 'break-all',
    color: tokens.colorNeutralForeground3,
  },
  before: {
    color: tokens.colorPaletteRedForeground1,
  },
  after: {
    color: tokens.colorPaletteGreenForeground1,
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    padding: '28px 12px',
    color: tokens.colorNeutralForeground3,
    textAlign: 'center',
  },
});

type Filter = ChangeKind | 'all';

interface Outcome {
  changes: JsonChange[];
  options: DiffOptions;
  roundTripOk: boolean;
  keyedBy: number;
  keyedByIndex: number;
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'added', label: '新增' },
  { id: 'removed', label: '删除' },
  { id: 'modified', label: '修改' },
  { id: 'typeChanged', label: '类型变化' },
  { id: 'moved', label: '位置移动' },
];

export function JsonDiffTool() {
  const styles = useStyles();
  const toasterId = useId('json-diff-toaster');
  const { dispatchToast } = useToastController(toasterId);
  const [before, setBefore] = useState('');
  const [after, setAfter] = useState('');
  const [mode, setMode] = useState<ArrayMode>(DEFAULT_DIFF_OPTIONS.mode);
  const [keyField, setKeyField] = useState(DEFAULT_DIFF_OPTIONS.keyField);
  const [tolerance, setTolerance] = useState('0');
  const [emptyIsDocument, setEmptyIsDocument] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /**
   * The inputs the comparison reads.
   *
   * Held in a ref rather than closed over so `compare` has no dependencies: with
   * the inputs in its dependency list the debounce effect would restart on every
   * render, and because comparing sets state the effect would keep re-arming
   * itself forever. A ref keeps the function stable without making it stale.
   */
  const latest = useRef({ before, after, mode, keyField, tolerance, emptyIsDocument });
  latest.current = { before, after, mode, keyField, tolerance, emptyIsDocument };

  const compare = useCallback(
    (force: boolean) => {
      const { before, after, mode, keyField, tolerance, emptyIsDocument } = latest.current;
      const trimmedBefore = before.trim();
      const trimmedAfter = after.trim();

      if (trimmedBefore === '' && trimmedAfter === '') {
        setOutcome(null);
        setError(null);
        setNote(null);
        return;
      }
      if (!force && trimmedBefore.length + trimmedAfter.length > LIVE_PARSE_LIMIT) {
        setOutcome(null);
        setError(null);
        setNote('输入很长，已暂停实时比较。点「比较」强制执行一次。');
        return;
      }

      try {
        // An empty box is either "no document yet" or the document `null`,
        // depending on the checkbox. `null` is a real JSON document, so the
        // distinction has to be the user's to make rather than assumed.
        const read = (text: string, label: string): JsonValue =>
          emptyIsDocument && text.trim() === '' ? null : parseJsonInput(text, label);
        const left: JsonValue = read(before, '左侧 JSON');
        const right: JsonValue = read(after, '右侧 JSON');

        const numericTolerance = Number.parseFloat(tolerance);
        const options: DiffOptions = {
          mode,
          keyField: keyField.trim() === '' ? DEFAULT_DIFF_OPTIONS.keyField : keyField,
          numberTolerance: Number.isFinite(numericTolerance) && numericTolerance > 0 ? numericTolerance : 0,
        };

        const result = diff(left, right, options);

        // The round trip is verified here as well as in the check script. It is
        // the one statement that makes the list trustworthy — applying these
        // changes to the left document really does produce the right one — and it
        // costs one extra traversal on top of a comparison that already happened.
        let roundTripOk = false;
        try {
          roundTripOk = deepEqual(applyChanges(left, result.changes), right);
        } catch {
          roundTripOk = false;
        }

        setOutcome({
          changes: result.changes,
          options,
          roundTripOk,
          keyedBy: result.keyedArrays.byKey,
          keyedByIndex: result.keyedArrays.byIndex,
        });
        setError(null);
        setNote(null);
      } catch (caught) {
        setOutcome(null);
        setNote(null);
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [],
  );

  // Debounced so typing in a large document does not re-diff on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => compare(false), 250);
    return () => window.clearTimeout(timer);
  }, [compare]);

  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [filter, outcome]);

  const visible = useMemo(() => (outcome ? visibleChanges(outcome.changes) : []), [outcome]);
  const stats = useMemo(() => {
    const counts = { added: 0, removed: 0, modified: 0, typeChanged: 0, moved: 0 };
    for (const change of visible) {
      if (change.kind === 'added') counts.added += 1;
      else if (change.kind === 'removed') counts.removed += 1;
      else if (change.kind === 'typeChanged') counts.typeChanged += 1;
      else if (change.kind === 'moved') counts.moved += 1;
      else counts.modified += 1;
    }
    return counts;
  }, [visible]);

  const filtered = useMemo(
    () => (filter === 'all' ? visible : visible.filter((change) => change.kind === filter)),
    [filter, visible],
  );

  const copy = useCallback(
    async (text: string, label: string) => {
      const ok = await copyText(text);
      dispatchToast(
        <Toast>
          <ToastTitle>{ok ? `${label}已复制` : '复制失败，请手动选择文本'}</ToastTitle>
        </Toast>,
        { intent: ok ? 'success' : 'error' },
      );
    },
    [dispatchToast],
  );

  const loaded = useCallback(() => {
    setBefore(SAMPLE_BEFORE);
    setAfter(SAMPLE_AFTER);
  }, []);

  const contentChanged = outcome ? hasContentChanges(outcome.changes) : false;

  return (
    <div className="wt-surface">
      <Toaster toasterId={toasterId} position="top-end" />
      <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
        <div className={styles.stack}>
          <div className={styles.intro}>
            <Text as="h2" size={300} weight="semibold">
              结构化比较
            </Text>
            <Caption1 className={styles.hint}>
              逐行文本对比只能看出「这一行变了」；这里比较的是解析后的结构，所以能说出改动的是哪一个键，
              用 JSON Pointer 定位到 <code>/users/0/name</code> 这样的精确位置。数组可以选择按 <code>id</code>{' '}
              之类的标识字段配对，这样元素重排不会被报成一片假差异。不做三路合并，也不生成 RFC 6902 的 JSON Patch。
            </Caption1>
          </div>

          <div className="wt-split">
            <div className={styles.pane}>
              <div className={styles.paneHead}>
                <DocumentText16Regular />
                <Text size={200} weight="semibold">
                  左侧 JSON（原）
                </Text>
                <span className={styles.spacer} />
                <Button appearance="subtle" size="small" onClick={loaded}>
                  载入示例
                </Button>
              </div>
              <textarea
                className="wt-code-area"
                aria-label="左侧 JSON（原）"
                spellCheck={false}
                value={before}
                onChange={(event) => setBefore(event.target.value)}
                placeholder='{ "a": 1 }'
              />
            </div>
            <div className={styles.pane}>
              <div className={styles.paneHead}>
                <DocumentText16Regular />
                <Text size={200} weight="semibold">
                  右侧 JSON（新）
                </Text>
                <span className={styles.spacer} />
                <Button appearance="subtle" size="small" onClick={() => setBefore('')}>
                  清空左侧
                </Button>
                <Button appearance="subtle" size="small" onClick={() => setAfter('')}>
                  清空右侧
                </Button>
              </div>
              <textarea
                className="wt-code-area"
                aria-label="右侧 JSON（新）"
                spellCheck={false}
                value={after}
                onChange={(event) => setAfter(event.target.value)}
                placeholder='{ "a": 2 }'
              />
            </div>
          </div>

          <div className={styles.toolbar}>
            <div className={styles.field}>
              <Text size={200}>数组比较</Text>
              <Dropdown
                aria-label="数组比较方式"
                value={mode === 'index' ? '按索引比较' : '按标识字段配对'}
                selectedOptions={[mode]}
                onOptionSelect={(_, data) => setMode(data.optionValue as ArrayMode)}
              >
                <Option value="index">按索引比较</Option>
                <Option value="key">按标识字段配对</Option>
              </Dropdown>
            </div>
            <div className={styles.field}>
              <Text size={200}>标识字段</Text>
              <input
                className="wt-inline-input"
                aria-label="数组元素标识字段名"
                value={keyField}
                disabled={mode !== 'key'}
                onChange={(event) => setKeyField(event.target.value)}
                placeholder="id"
                style={{ width: 110 }}
              />
            </div>
            <div className={styles.field}>
              <Text size={200}>数值容差</Text>
              <input
                className="wt-inline-input"
                aria-label="数值比较容差"
                value={tolerance}
                onChange={(event) => setTolerance(event.target.value)}
                placeholder="0"
                style={{ width: 90, fontVariantNumeric: 'tabular-nums' }}
              />
            </div>
            <Checkbox
              checked={emptyIsDocument}
              onChange={(_, data) => setEmptyIsDocument(Boolean(data.checked))}
              label="空输入视为 null"
            />
            <span className={styles.spacer} />
            <Button appearance="primary" icon={<ArrowSync16Regular />} onClick={() => compare(true)}>
              比较
            </Button>
          </div>

          {error && (
            <MessageBar intent="error">
              <MessageBarBody>
                <MessageBarTitle>无法比较</MessageBarTitle>
                {error}
              </MessageBarBody>
            </MessageBar>
          )}
          {note && (
            <MessageBar intent="warning">
              <MessageBarBody>{note}</MessageBarBody>
            </MessageBar>
          )}

          {outcome && (
            <>
              <Divider />
              <Text as="h2" size={300} weight="semibold">
                差异统计
              </Text>
              <div className={styles.stats}>
                <div className={styles.stat}>
                  <Text size={200}>新增</Text>
                  <Text className={styles.statValue} style={{ color: tokens.colorPaletteGreenForeground1 }}>
                    {stats.added}
                  </Text>
                </div>
                <div className={styles.stat}>
                  <Text size={200}>删除</Text>
                  <Text className={styles.statValue} style={{ color: tokens.colorPaletteRedForeground1 }}>
                    {stats.removed}
                  </Text>
                </div>
                <div className={styles.stat}>
                  <Text size={200}>修改</Text>
                  <Text className={styles.statValue}>{stats.modified}</Text>
                </div>
                <div className={styles.stat}>
                  <Text size={200}>类型变化</Text>
                  <Text className={styles.statValue} style={{ color: tokens.colorPaletteMarigoldForeground1 }}>
                    {stats.typeChanged}
                  </Text>
                </div>
                <div className={styles.stat}>
                  <Text size={200}>位置移动</Text>
                  <Text className={styles.statValue}>{stats.moved}</Text>
                </div>
              </div>

              <div className={styles.toolbar}>
                <Caption1 className={styles.hint}>
                  {visible.length === 0
                    ? '两份 JSON 结构相同，没有差异。'
                    : contentChanged
                      ? `${visible.length} 处差异。`
                      : `没有内容差异：${stats.moved} 个元素只是换了位置。`}
                </Caption1>
                <span className={styles.spacer} />
                {outcome.keyedBy > 0 || outcome.keyedByIndex > 0 ? (
                  <Tooltip
                    content={
                      `按键配对的数组 ${outcome.keyedBy} 个；按索引比较的数组 ${outcome.keyedByIndex} 个。` +
                      '只有全部元素都是对象、都含标识字段且取值互不相同时才会按键配对，否则自动退化为按索引。'
                    }
                    relationship="description"
                  >
                    <Badge appearance="tint" color={outcome.keyedBy > 0 ? 'brand' : 'subtle'}>
                      按键配对 {outcome.keyedBy} / 按索引 {outcome.keyedByIndex}
                    </Badge>
                  </Tooltip>
                ) : null}
                <Tooltip
                  content="用差异列表回放左侧文档，结果与右侧文档深度相等——这是差异列表可信的依据。"
                  relationship="description"
                >
                  <Badge
                    appearance="tint"
                    color={outcome.roundTripOk ? 'success' : 'danger'}
                    icon={outcome.roundTripOk ? <Checkmark16Regular /> : undefined}
                  >
                    {outcome.roundTripOk ? '回放校验通过' : '回放校验失败'}
                  </Badge>
                </Tooltip>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<Copy16Regular />}
                  disabled={visible.length === 0}
                  onClick={() => copy(changesToText(outcome.changes), '差异列表')}
                >
                  复制差异列表
                </Button>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<Copy16Regular />}
                  disabled={visible.length === 0}
                  onClick={() => copy(changesToJson(outcome.changes), '差异 JSON')}
                >
                  复制为 JSON
                </Button>
              </div>

              <div className={styles.toolbar}>
                <Filter16Regular />
                {FILTERS.map((entry) => {
                  const count =
                    entry.id === 'all'
                      ? visible.length
                      : stats[entry.id as keyof typeof stats] ?? 0;
                  return (
                    <Button
                      key={entry.id}
                      size="small"
                      appearance={filter === entry.id ? 'primary' : 'subtle'}
                      onClick={() => setFilter(entry.id)}
                      disabled={count === 0 && entry.id !== 'all'}
                    >
                      {entry.label} {count}
                    </Button>
                  );
                })}
              </div>

              {filtered.length === 0 ? (
                <div className={styles.empty}>
                  <Text size={300}>
                    {visible.length === 0 ? '两份 JSON 结构相同' : '没有符合筛选条件的差异'}
                  </Text>
                  <Caption1>
                    {visible.length === 0
                      ? '键的顺序不同不算差异；数组元素在按标识字段配对时重排也不算内容差异。'
                      : '换一个筛选条件看看。'}
                  </Caption1>
                </div>
              ) : (
                <div className={styles.list}>
                  {filtered.slice(0, limit).map((change, index) => (
                    <div className={styles.row} key={`${change.path}-${change.kind}-${index}`}>
                      <span>
                        <Badge
                          appearance="tint"
                          color={
                            change.kind === 'added'
                              ? 'success'
                              : change.kind === 'removed'
                                ? 'danger'
                                : change.kind === 'typeChanged'
                                  ? 'warning'
                                  : change.kind === 'moved'
                                    ? 'informative'
                                    : 'subtle'
                          }
                        >
                          {changeKindLabel(change.kind)}
                        </Badge>
                      </span>
                      <span className={styles.path}>{change.path === '' ? '/' : change.path}</span>
                      <span className={styles.values}>{describe(change)}</span>
                    </div>
                  ))}
                </div>
              )}

              {filtered.length > limit && (
                <Button appearance="subtle" onClick={() => setLimit((value) => value + PAGE_SIZE)}>
                  还有 {filtered.length - limit} 条，继续显示
                </Button>
              )}

              <Caption1 className={styles.hint}>
                列表用 JSON Pointer（RFC 6901）定位：键名里的 <code>/</code> 写作 <code>~1</code>，<code>~</code>{' '}
                写作 <code>~0</code>，所以 <code>{'{"a/b":1}'}</code> 与 <code>{'{"a":{"b":1}}'}</code>{' '}
                会得到不同的路径。
              </Caption1>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** One change rendered as `old → new`, or as the single value it added/removed. */
function describe(change: JsonChange): string {
  if (change.kind === 'added') return `+ ${formatValue(change.after)}`;
  if (change.kind === 'removed') return `- ${formatValue(change.before)}`;
  if (change.kind === 'moved') {
    return `位置 ${change.baseIndex} → ${change.targetIndex}，值未变`;
  }
  return `${formatValue(change.before)} → ${formatValue(change.after)}`;
}

function formatValue(value: JsonValue | undefined): string {
  if (value === undefined) return '（无）';
  const text = JSON.stringify(value);
  if (text === undefined) return '（无）';
  return text.length <= 120 ? text : `${text.slice(0, 119)}…`;
}
