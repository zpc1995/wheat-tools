import { useCallback, useState, type ReactNode } from 'react';
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
  AddSubtractCircle16Regular,
  ArrowRepeatAll16Regular,
  ArrowSwap16Regular,
  ArrowTrending16Regular,
  DataBarVertical16Regular,
  DataPie16Regular,
  MathFormula16Regular,
  ScaleFit16Regular,
  Scales16Regular,
  TagPercent16Regular,
} from '@fluentui/react-icons';
import {
  FORMULAS,
  RATIO_UNIT_LABEL,
  RATIO_UNITS,
  allocationSum,
  convertRatio,
  discountPrice,
  discountRate,
  formatNumber,
  formatPercent,
  increaseBy,
  decreaseBy,
  increaseThenDecrease,
  originalPrice,
  parseNumberList,
  percentageDifference,
  percentagePointDiff,
  percentagePointRelative,
  percentChange,
  percentOf,
  ratioAllocation,
  reverseDecrease,
  reverseIncrease,
  whatPercent,
  type RatioUnit,
  type Result,
} from './percentageUtils';

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
    gap: '8px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  formula: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    color: tokens.colorNeutralForeground3,
    textAlign: 'right',
    overflowWrap: 'anywhere',
    maxWidth: '60%',
  },
  fields: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    padding: '12px 14px',
    width: '100%',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: '0 1 180px',
    minWidth: '120px',
  },
  fieldLabel: {
    color: tokens.colorNeutralForeground3,
  },
  results: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '0 14px 14px',
    width: '100%',
  },
  resultRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    flexWrap: 'wrap',
  },
  bigValue: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    fontSize: 'clamp(18px, 2.6vw, 26px)',
    fontWeight: 600,
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  smallValue: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    fontSize: '15px',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  resultLabel: {
    color: tokens.colorNeutralForeground3,
    minWidth: '96px',
  },
  warning: {
    color: tokens.colorPaletteYellowForeground1,
    overflowWrap: 'anywhere',
  },
  error: {
    color: tokens.colorPaletteRedForeground1,
    overflowWrap: 'anywhere',
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    padding: '0 14px 14px',
  },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    padding: '6px 0',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  rowIndex: {
    minWidth: '64px',
    color: tokens.colorNeutralForeground3,
  },
  rowValue: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    userSelect: 'all',
  },
  rowNote: {
    color: tokens.colorNeutralForeground3,
    marginLeft: 'auto',
  },
  navRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    padding: '10px 14px',
    width: '100%',
  },
  select: {
    flex: '0 1 160px',
    minWidth: '120px',
  },
});

/** Parses an input box into a number; an empty box is NaN, which every scenario rejects. */
function toNumber(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? Number.NaN : Number(trimmed);
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

function NumberField({ label, value, onChange, placeholder }: FieldProps) {
  const styles = useStyles();
  return (
    <label className={styles.field}>
      <Caption1 className={styles.fieldLabel}>{label}</Caption1>
      <input
        className="wt-inline-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode="decimal"
        aria-label={label}
        spellCheck={false}
      />
    </label>
  );
}

interface ChoiceFieldProps extends FieldProps {
  options: Array<{ value: string; label: string }>;
}

function ChoiceField({ label, value, onChange, options }: ChoiceFieldProps) {
  const styles = useStyles();
  return (
    <label className={styles.field}>
      <Caption1 className={styles.fieldLabel}>{label}</Caption1>
      <select
        className={`wt-inline-input ${styles.select}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ScenarioCard({
  id,
  title,
  formula,
  icon,
  children,
}: {
  id: string;
  title: string;
  formula: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <section className="wt-surface" id={id} aria-label={title}>
      <div className="wt-surface__header">
        {icon}
        <Text as="h2" size={300} weight="semibold">
          {title}
        </Text>
        <span className={styles.spacer} />
        <Caption1 className={styles.formula}>{formula}</Caption1>
      </div>
      <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
        {children}
      </div>
    </section>
  );
}

function Outcome({
  result,
  suffix = '',
  format,
}: {
  result: Result<number>;
  suffix?: string;
  format?: (value: number) => string;
}) {
  const styles = useStyles();
  if (!result.ok) {
    return (
      <div className={styles.resultRow}>
        <Badge appearance="tint" color="danger" size="small">
          无法计算
        </Badge>
        <span className={styles.error}>{result.error}</span>
      </div>
    );
  }
  const show = format ?? ((value: number) => formatNumber(value, 6));
  return (
    <>
      <div className={styles.resultRow}>
        <span className={styles.bigValue}>
          {show(result.value)}
          {suffix}
        </span>
      </div>
      {result.warning && <Caption1 className={styles.warning}>注意：{result.warning}</Caption1>}
    </>
  );
}

function Muted({ text }: { text: string }) {
  const styles = useStyles();
  return (
    <div className={styles.resultRow}>
      <span className={styles.smallValue}>{text}</span>
    </div>
  );
}

function PercentOfCard() {
  const styles = useStyles();
  const [base, setBase] = useState('200');
  const [percent, setPercent] = useState('15');
  const result = percentOf(toNumber(base), toNumber(percent));
  return (
    <ScenarioCard
      id="percent-of"
      title="X 的 Y% 是多少"
      formula={FORMULAS.percentOf}
      icon={<MathFormula16Regular />}
    >
      <div className={styles.fields}>
        <NumberField label="X（基数）" value={base} onChange={setBase} />
        <NumberField label="Y（百分比，%）" value={percent} onChange={setPercent} />
      </div>
      <div className={styles.results}>
        <Outcome result={result} />
      </div>
    </ScenarioCard>
  );
}

function WhatPercentCard() {
  const styles = useStyles();
  const [part, setPart] = useState('25');
  const [whole, setWhole] = useState('200');
  const result = whatPercent(toNumber(part), toNumber(whole));
  return (
    <ScenarioCard
      id="what-percent"
      title="X 是 Y 的百分之几"
      formula={FORMULAS.whatPercent}
      icon={<DataPie16Regular />}
    >
      <div className={styles.fields}>
        <NumberField label="X（部分）" value={part} onChange={setPart} />
        <NumberField label="Y（整体）" value={whole} onChange={setWhole} />
      </div>
      <div className={styles.results}>
        <Outcome result={result} />
      </div>
    </ScenarioCard>
  );
}

function ChangeCard() {
  const styles = useStyles();
  const [from, setFrom] = useState('100');
  const [to, setTo] = useState('120');
  const result = percentChange(toNumber(from), toNumber(to));
  const absolute = toNumber(to) - toNumber(from);
  return (
    <ScenarioCard
      id="change"
      title="从 X 到 Y 的变化率（增减百分比）"
      formula={FORMULAS.percentChange}
      icon={<ArrowTrending16Regular />}
    >
      <div className={styles.fields}>
        <NumberField label="原值 X" value={from} onChange={setFrom} />
        <NumberField label="新值 Y" value={to} onChange={setTo} />
      </div>
      <div className={styles.results}>
        <Outcome result={result} />
        {Number.isFinite(absolute) && (
          <Caption1 className={styles.hint}>
            绝对变化量：{formatNumber(absolute, 6)}（
            {absolute > 0 ? '增加' : absolute < 0 ? '减少' : '不变'}）
          </Caption1>
        )}
      </div>
    </ScenarioCard>
  );
}

function IncreaseDecreaseCard() {
  const styles = useStyles();
  const [value, setValue] = useState('100');
  const [percent, setPercent] = useState('25');
  return (
    <ScenarioCard
      id="increase-decrease"
      title="按百分比增加 / 减少后的值"
      formula={`${FORMULAS.increaseBy}；${FORMULAS.decreaseBy}`}
      icon={<AddSubtractCircle16Regular />}
    >
      <div className={styles.fields}>
        <NumberField label="原值" value={value} onChange={setValue} />
        <NumberField label="变化百分比（%），可为负" value={percent} onChange={setPercent} />
      </div>
      <div className={styles.results}>
        <div className={styles.resultRow}>
          <Caption1 className={styles.resultLabel}>增加 Y% 后</Caption1>
        </div>
        <Outcome result={increaseBy(toNumber(value), toNumber(percent))} />
        <div className={styles.resultRow}>
          <Caption1 className={styles.resultLabel}>减少 Y% 后</Caption1>
        </div>
        <Outcome result={decreaseBy(toNumber(value), toNumber(percent))} />
      </div>
    </ScenarioCard>
  );
}

function ReverseCard() {
  const styles = useStyles();
  const [finalValue, setFinalValue] = useState('125');
  const [percent, setPercent] = useState('25');
  const [direction, setDirection] = useState('increase');
  const result =
    direction === 'increase'
      ? reverseIncrease(toNumber(finalValue), toNumber(percent))
      : reverseDecrease(toNumber(finalValue), toNumber(percent));
  return (
    <ScenarioCard
      id="reverse"
      title="反推原值（已知变化后的值）"
      formula={`${FORMULAS.reverseIncrease}；${FORMULAS.reverseDecrease}`}
      icon={<ArrowSwap16Regular />}
    >
      <div className={styles.fields}>
        <NumberField label="变化后的值" value={finalValue} onChange={setFinalValue} />
        <NumberField label="变化百分比（%）" value={percent} onChange={setPercent} />
        <ChoiceField
          label="这是"
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'increase', label: '增加 Y% 后的值' },
            { value: 'decrease', label: '减少 Y% 后的值' },
          ]}
        />
      </div>
      <div className={styles.results}>
        <Outcome result={result} />
      </div>
    </ScenarioCard>
  );
}

function DiscountCard() {
  const styles = useStyles();
  const [priceText, setPriceText] = useState('200');
  const [rateText, setRateText] = useState('30');
  const [saleText, setSaleText] = useState('140');

  const price = toNumber(priceText);
  const rate = toNumber(rateText);
  const sale = toNumber(saleText);

  const hasPrice = Number.isFinite(price);
  const hasRate = Number.isFinite(rate);
  const hasSale = Number.isFinite(sale);

  return (
    <ScenarioCard
      id="discount"
      title="打折互算：原价 / 折扣 / 现价"
      formula={`${FORMULAS.discountPrice}；${FORMULAS.discountRate}；${FORMULAS.reverseDecrease}`}
      icon={<TagPercent16Regular />}
    >
      <div className={styles.fields}>
        <NumberField label="原价" value={priceText} onChange={setPriceText} />
        <NumberField label="折扣率（%，填「减多少」）" value={rateText} onChange={setRateText} />
        <NumberField label="现价" value={saleText} onChange={setSaleText} />
      </div>
      <div className={styles.results}>
        <Caption1 className={styles.hint}>任意填两个，第三行都能算出来：</Caption1>
        <div className={styles.resultRow}>
          <Caption1 className={styles.resultLabel}>现价</Caption1>
        </div>
        {hasPrice && hasRate ? (
          <Outcome result={discountPrice(price, rate)} suffix=" 元" />
        ) : (
          <Muted text="需要原价与折扣率" />
        )}
        <div className={styles.resultRow}>
          <Caption1 className={styles.resultLabel}>折扣率</Caption1>
        </div>
        {hasPrice && hasSale ? (
          <Outcome result={discountRate(price, sale)} suffix="%" />
        ) : (
          <Muted text="需要原价与现价" />
        )}
        <div className={styles.resultRow}>
          <Caption1 className={styles.resultLabel}>原价</Caption1>
        </div>
        {hasSale && hasRate ? (
          <Outcome result={originalPrice(sale, rate)} suffix=" 元" />
        ) : (
          <Muted text="需要现价与折扣率" />
        )}
      </div>
    </ScenarioCard>
  );
}

function DifferenceCard() {
  const styles = useStyles();
  const [a, setA] = useState('100');
  const [b, setB] = useState('110');
  const numberA = toNumber(a);
  const numberB = toNumber(b);
  // Computed once into consts so TypeScript narrows `.ok` before `.value`.
  const difference = percentageDifference(numberA, numberB);
  const changeAB = percentChange(numberA, numberB);
  const changeBA = percentChange(numberB, numberA);
  return (
    <ScenarioCard
      id="difference"
      title="百分比差异（与变化率的区别）"
      formula={FORMULAS.percentageDifference}
      icon={<ScaleFit16Regular />}
    >
      <div className={styles.fields}>
        <NumberField label="数值 A" value={a} onChange={setA} />
        <NumberField label="数值 B" value={b} onChange={setB} />
      </div>
      <div className={styles.results}>
        <div className={styles.resultRow}>
          <Caption1 className={styles.resultLabel}>百分比差异</Caption1>
        </div>
        <Outcome result={difference} suffix="%" />
        <Caption1 className={styles.hint}>
          差异以两者的平均值为分母，A 与 B 互换结果不变；变化率以「原值」为分母，方向相反。
          下面是同一对数上的三个量：
        </Caption1>
        <div className={styles.row}>
          <Caption1 className={styles.resultLabel}>差异 |A−B| ÷ 平均值</Caption1>
          <span className={styles.smallValue}>
            {difference.ok ? formatPercent(difference.value, 4) : '—'}
          </span>
        </div>
        <div className={styles.row}>
          <Caption1 className={styles.resultLabel}>变化率 A → B</Caption1>
          <span className={styles.smallValue}>
            {changeAB.ok ? formatPercent(changeAB.value, 4) : '—'}
          </span>
        </div>
        <div className={styles.row}>
          <Caption1 className={styles.resultLabel}>变化率 B → A</Caption1>
          <span className={styles.smallValue}>
            {changeBA.ok ? formatPercent(changeBA.value, 4) : '—'}
          </span>
        </div>
      </div>
    </ScenarioCard>
  );
}

function PointCard() {
  const styles = useStyles();
  const [p1, setP1] = useState('12');
  const [p2, setP2] = useState('10');
  return (
    <ScenarioCard
      id="points"
      title="百分点（与相对变化不同）"
      formula={FORMULAS.percentagePoint}
      icon={<DataBarVertical16Regular />}
    >
      <div className={styles.fields}>
        <NumberField label="变化后的百分比 P₁（%）" value={p1} onChange={setP1} />
        <NumberField label="基准百分比 P₂（%）" value={p2} onChange={setP2} />
      </div>
      <div className={styles.results}>
        <div className={styles.resultRow}>
          <Caption1 className={styles.resultLabel}>百分点差 P₁ − P₂</Caption1>
        </div>
        <Outcome result={percentagePointDiff(toNumber(p1), toNumber(p2))} suffix=" 个百分点" />
        <div className={styles.resultRow}>
          <Caption1 className={styles.resultLabel}>相对变化 (P₁−P₂) ÷ P₂</Caption1>
        </div>
        <Outcome result={percentagePointRelative(toNumber(p1), toNumber(p2))} suffix="%" />
        <Caption1 className={styles.hint}>
          10% 涨到 12% 是 +2 个百分点，但相对变化是 +20%；两者不可混用。
        </Caption1>
      </div>
    </ScenarioCard>
  );
}

function RoundTripCard() {
  const styles = useStyles();
  const [value, setValue] = useState('100');
  const [percent, setPercent] = useState('10');
  const result = increaseThenDecrease(toNumber(value), toNumber(percent));
  return (
    <ScenarioCard
      id="round-trip"
      title="涨 Y% 再降 Y% 会回到原值吗"
      formula={FORMULAS.roundTrip}
      icon={<ArrowRepeatAll16Regular />}
    >
      <div className={styles.fields}>
        <NumberField label="原值" value={value} onChange={setValue} />
        <NumberField label="涨跌幅 Y（%）" value={percent} onChange={setPercent} />
      </div>
      <div className={styles.results}>
        {result.ok ? (
          <>
            <div className={styles.resultRow}>
              <Caption1 className={styles.resultLabel}>涨跌之后</Caption1>
              <span className={styles.bigValue}>{formatNumber(result.value.after, 6)}</span>
            </div>
            <div className={styles.row}>
              <Caption1 className={styles.resultLabel}>净损失</Caption1>
              <span className={styles.smallValue}>
                {formatNumber(result.value.lost, 6)}（原值的 {formatNumber(result.value.lostPercent, 6)}%）
              </span>
            </div>
            <div className={styles.row}>
              <Caption1 className={styles.resultLabel}>与原值的关系</Caption1>
              <span className={styles.smallValue}>
                {result.value.after === toNumber(value) ? '恰好相等（Y = 0）' : '不等于原值'}
              </span>
            </div>
          </>
        ) : (
          <Outcome result={result} />
        )}
        {result.ok && result.warning && (
          <Caption1 className={styles.warning}>{result.warning}</Caption1>
        )}
        <Caption1 className={styles.hint}>
          常见误解是「涨 10% 再跌 10% 就回来了」。实际上两个因子相乘是 1 − Y²÷10000，
          永远小于 1（Y ≠ 0 时），差额正好是 Y²÷100。
        </Caption1>
      </div>
    </ScenarioCard>
  );
}

function AllocationCard() {
  const styles = useStyles();
  const [total, setTotal] = useState('100');
  const [weightsText, setWeightsText] = useState('1:2:3');
  const weights = parseNumberList(weightsText);
  const result = weights.ok ? ratioAllocation(toNumber(total), weights.value) : weights;
  const weightSum = weights.ok ? weights.value.reduce((sum, weight) => sum + weight, 0) : 0;
  return (
    <ScenarioCard
      id="allocation"
      title="按权重分配总数（余数怎么分）"
      formula={FORMULAS.ratioAllocation}
      icon={<Scales16Regular />}
    >
      <div className={styles.fields}>
        <NumberField label="总数（整数，按最小单位）" value={total} onChange={setTotal} />
        <NumberField
          label="权重（如 1:2:3 或 0.5, 1.5）"
          value={weightsText}
          onChange={setWeightsText}
          placeholder="1:2:3"
        />
      </div>
      <div className={styles.results}>
        {!result.ok && <Outcome result={result} />}
        {result.ok && (
          <>
            <div className={styles.rows} style={{ padding: 0 }}>
              {result.value.map((share, index) => (
                <div className={styles.row} key={index}>
                  <span className={styles.rowIndex}>第 {index + 1} 份</span>
                  <span className={styles.rowValue}>{formatNumber(share, 6)}</span>
                  {weights.ok && (
                    <span className={styles.rowNote}>
                      权重 {formatNumber(weights.value[index], 6)}（占{' '}
                      {weightSum > 0
                        ? formatPercent((weights.value[index] / weightSum) * 100, 4)
                        : '—'}
                      ）
                    </span>
                  )}
                </div>
              ))}
            </div>
            <Caption1 className={styles.hint}>
              各份合计 {formatNumber(allocationSum(result.value), 6)}，
              {allocationSum(result.value) === toNumber(total)
                ? '与总数完全相等（余数已按小数部分从大到小逐份补 1）。'
                : '与总数不一致，请检查输入。'}
            </Caption1>
            {result.warning && <Caption1 className={styles.warning}>{result.warning}</Caption1>}
          </>
        )}
      </div>
    </ScenarioCard>
  );
}

function UnitCard() {
  const styles = useStyles();
  const [value, setValue] = useState('1');
  const [from, setFrom] = useState<RatioUnit>('percent');
  const [to, setTo] = useState<RatioUnit>('basisPoint');
  const result = convertRatio(toNumber(value), from, to);
  const options = RATIO_UNITS.map((unit) => ({
    value: unit,
    label: RATIO_UNIT_LABEL[unit],
  }));
  return (
    <ScenarioCard
      id="units"
      title="千分比 / 基点（万分比）/ ppm 换算"
      formula={FORMULAS.unitConversion}
      icon={<ArrowSwap16Regular />}
    >
      <div className={styles.fields}>
        <NumberField label="数值" value={value} onChange={setValue} />
        <ChoiceField label="源单位" value={from} onChange={(next) => setFrom(next as RatioUnit)} options={options} />
        <ChoiceField label="目标单位" value={to} onChange={(next) => setTo(next as RatioUnit)} options={options} />
      </div>
      <div className={styles.results}>
        <Outcome result={result} />
        <Caption1 className={styles.hint}>
          1% = 10‰ = 100 bp = 10000 ppm。基点（bp）就是万分之一，常用于利率与手续费。
        </Caption1>
      </div>
    </ScenarioCard>
  );
}

export function PercentageCalculatorTool() {
  const styles = useStyles();
  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const sections: Array<{ id: string; label: string }> = [
    { id: 'percent-of', label: 'X 的 Y%' },
    { id: 'what-percent', label: 'X 是 Y 的百分之几' },
    { id: 'change', label: '变化率' },
    { id: 'increase-decrease', label: '增减后的值' },
    { id: 'reverse', label: '反推原值' },
    { id: 'discount', label: '打折互算' },
    { id: 'difference', label: '百分比差异' },
    { id: 'points', label: '百分点' },
    { id: 'round-trip', label: '涨跌往返' },
    { id: 'allocation', label: '按权重分配' },
    { id: 'units', label: '千分比 / 基点' },
  ];

  return (
    <div className={styles.stack}>
      <MessageBar intent="info">
        <MessageBarBody>
          <MessageBarTitle>按问题选卡片，不用先想公式</MessageBarTitle>
          百分比问题有十来种问法，方向搞反就会差出很多（比如 100→110 是 +10%，反过来是 −9.09%）。
          下面每张卡片对应一类问法，输入即算，并标明所用公式。除数、原值为 0 时会明确说明「无法计算」，
          而不是给出 Infinity。
        </MessageBarBody>
      </MessageBar>

      <section className="wt-surface" aria-label="场景导航">
        <div className="wt-surface__header">
          <Text as="h2" size={300} weight="semibold">
            场景导航
          </Text>
          <span className={styles.spacer} />
          <Caption1 className={styles.hint}>点击跳到对应卡片</Caption1>
        </div>
        <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
          <div className={styles.navRow}>
            {sections.map((section) => (
              <Button
                key={section.id}
                appearance="subtle"
                size="small"
                onClick={() => scrollTo(section.id)}
              >
                {section.label}
              </Button>
            ))}
          </div>
        </div>
      </section>

      <PercentOfCard />
      <WhatPercentCard />
      <ChangeCard />
      <IncreaseDecreaseCard />
      <ReverseCard />
      <DiscountCard />
      <DifferenceCard />
      <PointCard />
      <RoundTripCard />
      <AllocationCard />
      <UnitCard />

      <MessageBar intent="warning">
        <MessageBarBody>
          <MessageBarTitle>边界与取舍</MessageBarTitle>
          除以 0（占比的整体、变化率的原值、折扣率的原价）会被拒绝并说明原因；
          结果超出 ±1.8e308 时也会报错而不是显示 Infinity。分配功能按整数最小单位计算，
          余数用「最大余数法」逐份补 1，保证各份之和精确等于总数。数值本身按双精度浮点返回，
          只在显示时四舍五入。
        </MessageBarBody>
      </MessageBar>

      <Divider />
    </div>
  );
}
