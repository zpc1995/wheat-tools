import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Checkbox,
  Divider,
  MessageBar,
  MessageBarBody,
  Radio,
  RadioGroup,
  Switch,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowCounterclockwiseRegular,
  Checkmark16Regular,
  ClipboardRegular,
  IncognitoRegular,
  TextGrammarWand16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  DEFAULT_OPTIONS,
  HOMOGLYPH_TABLE,
  MAX_INPUT_CHARS,
  PIPELINE_ORDER,
  SAMPLE_INPUT,
  TRANSFORM_META,
  ZERO_WIDTH_CHARS,
  applyPipeline,
  charDisplay,
  charName,
  codePointCount,
  codePointLabel,
  configsFor,
  countFullwidth,
  countPrefixMarkers,
  countZeroWidth,
  findLookalikes,
  graphemeCount,
  revertOrder,
  revertPipeline,
  type FullwidthDirection,
  type HomoglyphDirection,
  type PipelineOptions,
  type TransformId,
} from './stringObfuscatorUtils';

/** Beyond this the comparison tables are truncated; the transforms still run. */
const MAX_TABLE_ROWS = 300;

const useStyles = makeStyles({
  body: {
    flexDirection: 'column',
    padding: '12px 14px 14px',
    gap: '10px',
  },
  inputArea: {
    minHeight: '100px',
    maxHeight: '220px',
    overflow: 'auto',
  },
  outputArea: {
    minHeight: '90px',
    maxHeight: '220px',
    overflow: 'auto',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  note: {
    color: tokens.colorNeutralForeground2,
    display: 'block',
  },
  transforms: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    width: '100%',
  },
  transform: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '8px 10px',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    borderRadius: '6px',
  },
  transformHead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
  },
  tableScroll: {
    maxHeight: '420px',
    overflow: 'auto',
    overscrollBehavior: 'contain',
    width: '100%',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '12.5px',
  },
  headCell: {
    textAlign: 'left',
    padding: '6px 10px',
    color: tokens.colorNeutralForeground3,
    fontWeight: 600,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    whiteSpace: 'nowrap',
    position: 'sticky',
    top: 0,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  cell: {
    padding: '4px 10px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    verticalAlign: 'top',
    overflowWrap: 'anywhere',
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
  },
  steps: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    width: '100%',
  },
  stepRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    padding: '4px 8px',
    borderRadius: '4px',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  stepLabel: {
    flex: 'none',
    width: '210px',
    color: tokens.colorNeutralForeground3,
    fontSize: '12px',
  },
  stepValue: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12.5px',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  strong: {
    fontWeight: 600,
  },
  order: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
  },
  arrow: {
    color: tokens.colorNeutralForeground4,
  },
});

/** The five transforms that are on or off rather than directional. */
type PlainTransformId = 'leet' | 'alternating' | 'prefix' | 'zeroWidth' | 'reverse';

function withFlag(options: PipelineOptions, id: PlainTransformId, on: boolean): PipelineOptions {
  switch (id) {
    case 'leet':
      return { ...options, leet: on };
    case 'alternating':
      return { ...options, alternating: on };
    case 'prefix':
      return { ...options, prefix: on };
    case 'zeroWidth':
      return { ...options, zeroWidth: on };
    case 'reverse':
      return { ...options, reverse: on };
  }
}

/** Renders a pipeline order as a readable chain. */
function OrderChain({ labels }: { labels: string[] }) {
  const styles = useStyles();
  if (labels.length === 0) return <Caption1 className={styles.hint}>（空）</Caption1>;
  return (
    <span className={styles.order}>
      {labels.map((label, index) => (
        <span key={`${label}-${index}`} className={styles.order}>
          {index > 0 && <span className={styles.arrow}>→</span>}
          <Badge appearance="tint" color="informative">
            {label}
          </Badge>
        </span>
      ))}
    </span>
  );
}

export function StringObfuscatorTool() {
  const styles = useStyles();
  const [input, setInput] = useState(SAMPLE_INPUT);
  const [options, setOptions] = useState<PipelineOptions>(DEFAULT_OPTIONS);
  const [customRevert, setCustomRevert] = useState('');
  const [useOriginal, setUseOriginal] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const configs = useMemo(() => configsFor(options), [options]);
  const forward = useMemo(() => applyPipeline(configs, input), [configs, input]);
  const output = forward.output;

  const revertSource = customRevert === '' ? output : customRevert;
  // The original may only be used as a tie breaker for the exact text it produces.
  const oracleApplies = useOriginal && configs.length > 0 && revertSource === output;
  const revert = useMemo(
    () => revertPipeline(configs, revertSource, oracleApplies ? input : undefined),
    [configs, revertSource, oracleApplies, input],
  );

  const stats = useMemo(
    () => ({
      graphemes: graphemeCount(output),
      codePoints: codePointCount(output),
      zeroWidth: countZeroWidth(output),
      lookalikes: findLookalikes(output).length,
      fullwidth: countFullwidth(output),
      markers: countPrefixMarkers(output),
    }),
    [output],
  );

  const editRows = useMemo(() => {
    const rows: { step: string; index: number; from: string; fromCode: number | null; to: string; toCode: number | null; note: string }[] = [];
    for (const step of forward.steps) {
      for (const edit of step.edits) {
        rows.push({ step: step.label, ...edit });
      }
    }
    return rows;
  }, [forward]);

  const ambiguityRows = useMemo(
    () =>
      revert.steps.flatMap((step) =>
        step.ambiguities.map((ambiguity) => ({ step: step.label, ...ambiguity })),
      ),
    [revert],
  );

  const onInput = useCallback((value: string) => {
    if (value.length > MAX_INPUT_CHARS) {
      setInput(value.slice(0, MAX_INPUT_CHARS));
      setTruncated(true);
    } else {
      setInput(value);
      setTruncated(false);
    }
  }, []);

  const setEnabled = useCallback((id: TransformId, on: boolean) => {
    setOptions((current) => {
      switch (id) {
        case 'homoglyph':
          return {
            ...current,
            homoglyph: on ? (current.homoglyph === false ? 'toLookalike' : current.homoglyph) : false,
          };
        case 'fullwidth':
          return {
            ...current,
            fullwidth: on ? (current.fullwidth === false ? 'toFull' : current.fullwidth) : false,
          };
        default:
          return withFlag(current, id, on);
      }
    });
  }, []);

  const setDirection = useCallback((id: 'homoglyph' | 'fullwidth', value: string) => {
    setOptions((current) =>
      id === 'homoglyph'
        ? { ...current, homoglyph: value as HomoglyphDirection }
        : { ...current, fullwidth: value as FullwidthDirection },
    );
  }, []);

  const copy = useCallback(async (key: string, value: string) => {
    const ok = await copyText(value);
    // Leaving the button unflipped on failure is the honest outcome rather than
    // claiming a copy that did not happen.
    setCopied(ok ? key : null);
  }, []);

  const activeWarnings = PIPELINE_ORDER.filter(
    (id) => options[id] !== false && TRANSFORM_META[id].warning,
  );

  const reappliesAll = revert.steps.length > 0 && revert.steps.every((step) => step.reapplies);
  const editsTruncated = editRows.length > MAX_TABLE_ROWS;
  const ambiguitiesTruncated = ambiguityRows.length > MAX_TABLE_ROWS;

  return (
    <div className="wt-surface">
      <div className="wt-surface__header">
        <IncognitoRegular />
        <Text as="h2" size={300} weight="semibold">
          输入
        </Text>
        <span className={styles.spacer} />
        <Caption1 className={styles.hint}>全部计算在本地完成，文本不会被发送到任何地方</Caption1>
      </div>

      <div className={`wt-surface__body ${styles.body}`}>
        <textarea
          className={`wt-code-area ${styles.inputArea}`}
          value={input}
          onChange={(event) => onInput(event.target.value)}
          placeholder="粘贴要混淆的文本，例如 Hello 汉字 😀"
          aria-label="待混淆的原文"
          spellCheck={false}
        />
        <div className={styles.toolbar}>
          <Button icon={<TextGrammarWand16Regular />} onClick={() => onInput(SAMPLE_INPUT)}>
            填入示例
          </Button>
          <Button
            icon={<ArrowCounterclockwiseRegular />}
            onClick={() => onInput('')}
            disabled={input === ''}
          >
            清空
          </Button>
          <span className={styles.spacer} />
          <Badge appearance="tint" color="informative">
            {`${graphemeCount(input)} 个字素簇 · ${codePointCount(input)} 个码位`}
          </Badge>
        </div>
        {truncated && (
          <MessageBar intent="warning">
            <MessageBarBody>{`输入超过 ${MAX_INPUT_CHARS} 字符，已截断处理。`}</MessageBarBody>
          </MessageBar>
        )}
      </div>

      <div className="wt-surface__header">
        <Text as="h2" size={300} weight="semibold">
          变换
        </Text>
        <span className={styles.spacer} />
        <Button
          appearance="subtle"
          size="small"
          onClick={() => setOptions(DEFAULT_OPTIONS)}
          disabled={configs.length === 0}
        >
          全部关闭
        </Button>
      </div>

      <div className={`wt-surface__body ${styles.body}`}>
        <div className={styles.transforms}>
          {PIPELINE_ORDER.map((id) => {
            const meta = TRANSFORM_META[id];
            const enabled = options[id] !== false;
            return (
              <div className={styles.transform} key={id}>
                <div className={styles.transformHead}>
                  <Switch
                    checked={enabled}
                    onChange={(_, data) => setEnabled(id, data.checked)}
                    label={meta.label}
                  />
                </div>
                <Caption1 className={styles.hint}>{meta.summary}</Caption1>

                {id === 'homoglyph' && options.homoglyph !== false && (
                  <RadioGroup
                    aria-label="同形字替换方向"
                    layout="horizontal"
                    value={options.homoglyph}
                    onChange={(_, data) => setDirection('homoglyph', data.value)}
                  >
                    <Radio value="toLookalike" label="拉丁 → 同形" />
                    <Radio value="toLatin" label="同形 → 拉丁" />
                  </RadioGroup>
                )}

                {id === 'fullwidth' && options.fullwidth !== false && (
                  <RadioGroup
                    aria-label="全半角转换方向"
                    layout="horizontal"
                    value={options.fullwidth}
                    onChange={(_, data) => setDirection('fullwidth', data.value)}
                  >
                    <Radio value="toFull" label="半角 → 全角" />
                    <Radio value="toHalf" label="全角 → 半角" />
                  </RadioGroup>
                )}

                {enabled && <Caption1 className={styles.note}>{meta.note}</Caption1>}
                {enabled && meta.warning && (
                  <MessageBar intent="warning">
                    <MessageBarBody>{meta.warning}</MessageBarBody>
                  </MessageBar>
                )}
              </div>
            );
          })}
        </div>

        <Divider />

        <div>
          <Caption1 className={styles.hint}>混淆顺序（自上而下依次作用）</Caption1>
          <OrderChain labels={forward.steps.map((step) => step.label)} />
        </div>
        <div>
          <Caption1 className={styles.hint}>还原顺序（必须是上面的相反顺序）</Caption1>
          <OrderChain labels={revertOrder(configs)} />
        </div>

        {activeWarnings.length > 0 && (
          <Caption1 className={styles.hint}>
            {`已启用 ${activeWarnings.length} 个带有可靠性警告的变换，请先读上面的提示再使用结果。`}
          </Caption1>
        )}
      </div>

      <div className="wt-surface__header">
        <Text as="h2" size={300} weight="semibold">
          混淆结果
        </Text>
        <span className={styles.spacer} />
        <Button
          appearance="subtle"
          size="small"
          icon={copied === 'output' ? <Checkmark16Regular /> : <ClipboardRegular />}
          onClick={() => copy('output', output)}
          disabled={output === ''}
        >
          {copied === 'output' ? '已复制' : '复制结果'}
        </Button>
      </div>

      <div className={`wt-surface__body ${styles.body}`}>
        <textarea
          className={`wt-code-area ${styles.outputArea}`}
          value={output}
          readOnly
          aria-label="混淆结果"
          spellCheck={false}
        />
        <div className={styles.toolbar}>
          <Badge appearance="tint" color="informative">
            {`${stats.graphemes} 个字素簇 · ${stats.codePoints} 个码位`}
          </Badge>
          {stats.zeroWidth > 0 && (
            <Badge appearance="tint" color="warning">
              {`隐藏的零宽字符：${stats.zeroWidth}`}
            </Badge>
          )}
          {stats.lookalikes > 0 && (
            <Badge appearance="tint" color="warning">
              {`同形字：${stats.lookalikes} 种`}
            </Badge>
          )}
          {stats.markers > 0 && (
            <Badge appearance="tint" color="informative">
              {`反斜杠标记：${stats.markers}`}
            </Badge>
          )}
          {stats.fullwidth > 0 && (
            <Badge appearance="tint" color="informative">
              {`全角字符：${stats.fullwidth}`}
            </Badge>
          )}
        </div>
        <Caption1 className={styles.hint}>
          {`零宽字符集：${ZERO_WIDTH_CHARS.map((char) => codePointLabel(char.codePointAt(0) ?? 0)).join('、')}`}
          ，启用后会按顺序循环插入。它们肉眼不可见，复制时却会一起被带走。
        </Caption1>

        {forward.steps.length > 1 && (
          <>
            <Caption1 className={styles.hint}>每一步的中间结果（叠加效果）</Caption1>
            <div className={styles.steps}>
              {forward.steps.map((step, index) => (
                <div className={styles.stepRow} key={`${step.label}-${index}`}>
                  <span className={styles.stepLabel}>{`${index + 1}. ${step.label}`}</span>
                  <span className={styles.stepValue}>{step.output === '' ? '（空）' : step.output}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="wt-surface__header">
        <Text as="h2" size={300} weight="semibold">
          码位对照表
        </Text>
        <span className={styles.spacer} />
        <Caption1 className={styles.hint}>{`共 ${editRows.length} 处字符改动`}</Caption1>
      </div>

      <div className={`wt-surface__body ${styles.body}`}>
        {editRows.length === 0 ? (
          <Caption1 className={styles.hint}>
            当前没有字符被替换或插入。反转这类不改变字符集合的变换不会有逐字符的对照项，它的说明在对应步骤里。
          </Caption1>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.headCell}>步骤</th>
                  <th className={styles.headCell}>位置</th>
                  <th className={styles.headCell}>原字符</th>
                  <th className={styles.headCell}>原码位</th>
                  <th className={styles.headCell}>新字符</th>
                  <th className={styles.headCell}>新码位</th>
                  <th className={styles.headCell}>说明</th>
                </tr>
              </thead>
              <tbody>
                {editRows.slice(0, MAX_TABLE_ROWS).map((row, rowIndex) => (
                  <tr key={`${row.step}-${row.index}-${rowIndex}`}>
                    <td className={styles.cell}>{row.step}</td>
                    <td className={`${styles.cell} ${styles.mono}`}>{row.index}</td>
                    <td className={`${styles.cell} ${styles.mono}`}>{charDisplay(row.from)}</td>
                    <td className={`${styles.cell} ${styles.mono}`}>
                      {row.fromCode === null ? '—' : codePointLabel(row.fromCode)}
                    </td>
                    <td className={`${styles.cell} ${styles.mono}`}>
                      {row.to === '' ? '（删除）' : charDisplay(row.to)}
                    </td>
                    <td className={`${styles.cell} ${styles.mono}`}>
                      {row.toCode === null ? '—' : codePointLabel(row.toCode)}
                    </td>
                    <td className={styles.cell}>
                      {row.note}
                      {charName(row.to) !== '' && `（${charName(row.to)}）`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {editsTruncated && (
          <Caption1 className={styles.hint}>
            {`改动共 ${editRows.length} 处，表中只显示前 ${MAX_TABLE_ROWS} 处。`}
          </Caption1>
        )}
        {forward.steps
          .filter((step) => step.summary)
          .map((step) => (
            <Caption1 className={styles.note} key={`summary-${step.label}`}>
              {`${step.label}：${step.summary ?? ''}`}
            </Caption1>
          ))}
      </div>

      <div className="wt-surface__header">
        <Text as="h2" size={300} weight="semibold">
          还原
        </Text>
        <span className={styles.spacer} />
        <Caption1 className={styles.hint}>按相反顺序逐步还原；无法唯一确定的位会列出候选</Caption1>
      </div>

      <div className={`wt-surface__body ${styles.body}`}>
        <textarea
          className={`wt-code-area ${styles.outputArea}`}
          value={customRevert}
          onChange={(event) => setCustomRevert(event.target.value)}
          placeholder="留空则还原上面的混淆结果；也可以粘贴别处拿到的混淆文本"
          aria-label="待还原的混淆文本"
          spellCheck={false}
        />
        <div className={styles.toolbar}>
          <Checkbox
            checked={useOriginal}
            onChange={(_, data) => setUseOriginal(Boolean(data.checked))}
            label="用原文逐位消歧（仅当待还原文本与当前混淆结果一致时生效）"
          />
          <span className={styles.spacer} />
          <Button
            appearance="subtle"
            size="small"
            icon={<ArrowCounterclockwiseRegular />}
            onClick={() => setCustomRevert('')}
            disabled={customRevert === ''}
          >
            还原上面的结果
          </Button>
        </div>

        <Divider />

        <textarea
          className={`wt-code-area ${styles.outputArea}`}
          value={revert.output}
          readOnly
          aria-label="还原结果"
          spellCheck={false}
        />
        <div className={styles.toolbar}>
          <Button
            appearance="subtle"
            size="small"
            icon={copied === 'revert' ? <Checkmark16Regular /> : <ClipboardRegular />}
            onClick={() => copy('revert', revert.output)}
            disabled={revert.output === ''}
          >
            {copied === 'revert' ? '已复制' : '复制还原结果'}
          </Button>
          <span className={styles.spacer} />
          {configs.length === 0 ? (
            <Caption1 className={styles.hint}>没有启用任何变换，还原结果与输入相同。</Caption1>
          ) : revert.verified ? (
            <Caption1 className={styles.hint}>
              每一步都用原文逐位消歧，并重新正向变换验证通过（逐字符等于原文）。
            </Caption1>
          ) : revert.uncertain ? (
            <Caption1 className={styles.hint}>
              存在无法唯一确定的字符，下面是每一处的候选；这是变换本身丢掉了信息，不是实现缺漏。
            </Caption1>
          ) : reappliesAll ? (
            <Caption1 className={styles.hint}>
              每一步重新正向变换都能复现输入，因此结果是一个合法的原像（但未必是原文）。
            </Caption1>
          ) : (
            <Caption1 className={styles.hint}>
              还原结果无法通过重新正向变换验证，请检查输入与原文是否对应。
            </Caption1>
          )}
        </div>
        {useOriginal && configs.length > 0 && !oracleApplies && (
          <MessageBar intent="info">
            <MessageBarBody>
              待还原文本与当前混淆结果不一致，原文无法参与消歧，只能逐步尽力还原。
            </MessageBarBody>
          </MessageBar>
        )}

        {ambiguityRows.length > 0 && (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.headCell}>步骤</th>
                  <th className={styles.headCell}>位置</th>
                  <th className={styles.headCell}>混淆后字符</th>
                  <th className={styles.headCell}>码位</th>
                  <th className={styles.headCell}>所有可能</th>
                  <th className={styles.headCell}>说明</th>
                </tr>
              </thead>
              <tbody>
                {ambiguityRows.slice(0, MAX_TABLE_ROWS).map((row, rowIndex) => (
                  <tr key={`${row.step}-${row.index}-${rowIndex}`}>
                    <td className={styles.cell}>{row.step}</td>
                    <td className={`${styles.cell} ${styles.mono}`}>{row.index}</td>
                    <td className={`${styles.cell} ${styles.mono}`}>{charDisplay(row.char)}</td>
                    <td className={`${styles.cell} ${styles.mono}`}>{codePointLabel(row.code)}</td>
                    <td className={`${styles.cell} ${styles.mono}`}>
                      {row.candidates.map((candidate) => charDisplay(candidate)).join(' / ')}
                    </td>
                    <td className={styles.cell}>{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {ambiguitiesTruncated && (
          <Caption1 className={styles.hint}>
            {`歧义共 ${ambiguityRows.length} 处，表中只显示前 ${MAX_TABLE_ROWS} 处。`}
          </Caption1>
        )}
      </div>

      <div className="wt-surface__header">
        <Text as="h2" size={300} weight="semibold">
          同形字对照表
        </Text>
        <span className={styles.spacer} />
        <Caption1 className={styles.hint}>
          {`${HOMOGLYPH_TABLE.length} 项；NFKC 规范化不会把这些字符折叠回拉丁字母`}
        </Caption1>
      </div>

      <div className={`wt-surface__body ${styles.body}`}>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.headCell}>拉丁</th>
                <th className={styles.headCell}>同形字符</th>
                <th className={styles.headCell}>码位</th>
                <th className={styles.headCell}>文字系统</th>
                <th className={styles.headCell}>正向是否采用</th>
                <th className={styles.headCell}>NFKC 能否还原</th>
                <th className={styles.headCell}>名称</th>
              </tr>
            </thead>
            <tbody>
              {HOMOGLYPH_TABLE.map((entry) => (
                <tr key={entry.lookalike}>
                  <td className={`${styles.cell} ${styles.mono} ${styles.strong}`}>{entry.latin}</td>
                  <td className={`${styles.cell} ${styles.mono}`}>{entry.lookalike}</td>
                  <td className={`${styles.cell} ${styles.mono}`}>
                    {codePointLabel(entry.lookalike.codePointAt(0) ?? 0)}
                  </td>
                  <td className={styles.cell}>{entry.script === 'Cyrillic' ? '西里尔' : '希腊'}</td>
                  <td className={styles.cell}>{entry.preferred ? '是' : '否（备选）'}</td>
                  <td className={styles.cell}>
                    {entry.lookalike.normalize('NFKC') === entry.latin ? '能' : '不能'}
                  </td>
                  <td className={styles.cell}>{entry.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="wt-surface__header">
        <Text as="h2" size={300} weight="semibold">
          这个工具做什么、不做什么
        </Text>
      </div>

      <div className={`wt-surface__body ${styles.body}`}>
        <Caption1 className={styles.note}>
          做的是字符层面的混淆：替换、插入、重排单个字符，并保证每一种变换都有对应的还原操作；
          组合使用时按相反顺序还原。码位对照表列出每一步把哪个字符换成了哪个码位，还原面板则列出
          无法唯一确定的位置与全部候选。
        </Caption1>
        <Caption1 className={styles.note}>
          不做加密：这里没有密钥、没有算法强度，任何人都能按相反顺序还原，因此不能用来保护机密。
          不做编码：Base64、ROT13、URL 编码、HTML 实体都属于编码，是另外的工具，编码的目标是
          可解码而不是让人读不出来。
        </Caption1>
        <Caption1 className={styles.note}>
          不做 JS 代码混淆：变量名压缩、控制流平坦化、字符串数组加密那一类是针对源代码的工具，
          与这里的字符替换不是一回事，本工具不涉及也不声称涉及。
        </Caption1>
        <Caption1 className={styles.note}>
          关于可靠性：反转、全半角转换和前两种插入（在原文不含相应字符时）可以精确还原；leet、
          同形字、大小写交替会丢信息，只有拿到原文才能确定地还原。零宽字符更糟 —— 很多平台会直接
          过滤掉它们，混淆会无声消失，因此不要依赖它。
        </Caption1>
      </div>
    </div>
  );
}
