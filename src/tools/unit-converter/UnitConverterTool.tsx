import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  Dropdown,
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
  ArrowSwap16Regular,
  Checkmark16Regular,
  Copy16Regular,
  Ruler16Regular,
  Table16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import { ListFilter, NoMatches, matchesQuery } from '../../components/ListFilter';
import {
  CATEGORIES,
  QUICK_FACTS,
  convert,
  convertAll,
  findCategory,
  formatNumber,
  parseQuantity,
  type CategoryId,
} from './unitUtils';

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
  hero: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    padding: '22px 20px',
  },
  value: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: 'clamp(26px, 5vw, 48px)',
    fontWeight: 600,
    userSelect: 'all',
    textAlign: 'center',
    overflowWrap: 'anywhere',
    lineHeight: 1.2,
  },
  unit: {
    color: tokens.colorNeutralForeground3,
    fontSize: '0.5em',
    marginLeft: '0.3em',
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    padding: '8px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  rowLabel: {
    flex: 'none',
    width: '150px',
    color: tokens.colorNeutralForeground3,
  },
  rowValue: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '14px',
    overflowWrap: 'anywhere',
    userSelect: 'all',
    textAlign: 'right',
  },
  rowCurrent: {
    backgroundColor: tokens.colorNeutralBackground2,
    fontWeight: 600,
  },
  input: {
    width: '100%',
    fontSize: '16px',
  },
});

export function UnitConverterTool() {
  const styles = useStyles();
  const toasterId = useId('unit-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [categoryId, setCategoryId] = useState<CategoryId>('length');
  const [fromId, setFromId] = useState('m');
  const [toId, setToId] = useState('cm');
  const [raw, setRaw] = useState('1');
  const [unitQuery, setUnitQuery] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const category = useMemo(() => findCategory(categoryId), [categoryId]);

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

  // Reset the selected units whenever the category changes, otherwise a stale
  // id would silently resolve to the first unit of the new category.
  useEffect(() => {
    const units = category.units;
    const base = units.find((unit) => unit.id === category.baseUnit) ?? units[0];
    const other =
      units.find((unit) => unit.id !== base.id && unit.factor !== undefined) ??
      units[1] ??
      base;
    setFromId(base.id);
    setToId(other.id);
  }, [category]);

  const numeric = useMemo(() => {
    const text = raw.trim();
    if (!text) return Number.NaN;
    // Accept a unit suffix in the input, e.g. "12.5 cm".
    const parsed = parseQuantity(text, category);
    if (parsed) return parsed.value;
    return Number(text.replace(/,/g, ''));
  }, [raw, category]);

  // Pasting "3kg" should also switch the source unit, which is what people
  // usually mean when they include the unit.
  useEffect(() => {
    const parsed = parseQuantity(raw, category);
    if (parsed && parsed.unit.id !== fromId) setFromId(parsed.unit.id);
    // Only react to the raw text and category.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, category]);

  const result = useMemo(
    () => convert(numeric, fromId, toId, category),
    [numeric, fromId, toId, category],
  );

  const all = useMemo(
    () => (Number.isFinite(numeric) ? convertAll(numeric, fromId, category) : []),
    [numeric, fromId, category],
  );

  // The full unit list can run to 15 rows in a category, and the id, label and
  // aliases are all worth searching — people look for "mi" as often as "英里".
  const visibleUnits = useMemo(
    () =>
      all.filter((item) =>
        matchesQuery(unitQuery, [
          item.unit.label,
          item.unit.id,
          ...(item.unit.aliases ?? []),
        ]),
      ),
    [all, unitQuery],
  );

  const fromUnit = category.units.find((unit) => unit.id === fromId);
  const toUnit = category.units.find((unit) => unit.id === toId);

  const swap = useCallback(() => {
    setFromId(toId);
    setToId(fromId);
    if (result.ok) setRaw(result.formatted);
  }, [toId, fromId, result]);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <Dropdown
            style={{ minWidth: 130 }}
            value={category.label}
            selectedOptions={[categoryId]}
            onOptionSelect={(_, data) =>
              setCategoryId(data.optionValue as CategoryId)
            }
            aria-label="类别"
          >
            {CATEGORIES.map((item) => (
              <Option key={item.id} value={item.id} text={item.label}>
                {item.label}
              </Option>
            ))}
          </Dropdown>

          <Dropdown
            style={{ minWidth: 160 }}
            value={fromUnit?.label ?? ''}
            selectedOptions={[fromId]}
            onOptionSelect={(_, data) => setFromId(data.optionValue ?? fromId)}
            aria-label="源单位"
          >
            {category.units.map((unit) => (
              <Option key={unit.id} value={unit.id} text={unit.label}>
                {unit.label}
              </Option>
            ))}
          </Dropdown>

          <Button
            appearance="secondary"
            icon={<ArrowSwap16Regular />}
            onClick={swap}
            aria-label="对调单位"
          >
            对调
          </Button>

          <Dropdown
            style={{ minWidth: 160 }}
            value={toUnit?.label ?? ''}
            selectedOptions={[toId]}
            onOptionSelect={(_, data) => setToId(data.optionValue ?? toId)}
            aria-label="目标单位"
          >
            {category.units.map((unit) => (
              <Option key={unit.id} value={unit.id} text={unit.label}>
                {unit.label}
              </Option>
            ))}
          </Dropdown>

          <span className={styles.spacer} />
          <Badge appearance="tint" color="brand" size="small">
            {category.units.length} 个单位
          </Badge>
        </div>

        <section className="wt-surface" aria-label="输入">
          <div className="wt-surface__header">
            <Ruler16Regular />
            <Text as="h2" size={300} weight="semibold">
              输入
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              可直接带单位，如 <code>12.5 cm</code> 或 <code>3kg</code>
            </Caption1>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.row}>
              <input
                className={`wt-inline-input ${styles.input}`}
                value={raw}
                onChange={(event) => setRaw(event.target.value)}
                placeholder={`输入 ${category.label}数值`}
                aria-label="数值输入"
                spellCheck={false}
              />
            </div>
          </div>
        </section>

        <section className="wt-surface" aria-label="换算结果">
          <div className="wt-surface__header">
            <Text as="h2" size={300} weight="semibold">
              {toUnit?.label ?? '结果'}
            </Text>
            <span className={styles.spacer} />
            {result.ok && (
              <Tooltip content="复制结果" relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  icon={
                    copied === 'main' ? <Checkmark16Regular /> : <Copy16Regular />
                  }
                  onClick={() => copy(result.formatted, 'main')}
                  aria-label="复制结果"
                />
              </Tooltip>
            )}
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.hero}>
              {result.ok ? (
                <>
                  <Text className={styles.value}>
                    {result.formatted}
                    <span className={styles.unit}>{toUnit?.label}</span>
                  </Text>
                  <Caption1 className={styles.hint}>
                    {formatNumber(numeric)} {fromUnit?.label} ={' '}
                    {result.formatted} {toUnit?.label}
                  </Caption1>
                </>
              ) : (
                <Caption1 className={styles.hint}>
                  {Number.isFinite(numeric) ? result.error : '请输入有效数字'}
                </Caption1>
              )}
            </div>
          </div>
        </section>

        {all.length > 0 && (
          <section className="wt-surface" aria-label="全部单位">
            <div className="wt-surface__header">
              <Table16Regular />
              <Text as="h2" size={300} weight="semibold">
                {category.label}的全部单位
              </Text>
              <span className={styles.spacer} />
              <Caption1 className={styles.hint}>点击任意行切换目标单位</Caption1>
            </div>

            <ListFilter
              value={unitQuery}
              onChange={setUnitQuery}
              shown={visibleUnits.length}
              total={all.length}
              label="搜索单位"
              placeholder="搜索单位，例如 英里、km、ounce"
            />

            {visibleUnits.length === 0 ? (
              <NoMatches query={unitQuery.trim()} hint="换一个关键词，或清空搜索。" />
            ) : (
            <div className={`wt-surface__body ${styles.rows}`}>
              {visibleUnits.map((item) => (
                <div
                  key={item.unit.id}
                  className={`${styles.row} ${
                    item.unit.id === toId ? styles.rowCurrent : ''
                  }`}
                >
                  <span className={styles.rowLabel}>{item.unit.label}</span>
                  <span className={styles.rowValue}>{item.formatted}</span>
                  <Tooltip content="复制" relationship="label" withArrow>
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={
                        copied === item.unit.id ? (
                          <Checkmark16Regular />
                        ) : (
                          <Copy16Regular />
                        )
                      }
                      onClick={() => copy(item.formatted, item.unit.id)}
                      aria-label={`复制 ${item.unit.label}`}
                    />
                  </Tooltip>
                  <Button
                    appearance="subtle"
                    size="small"
                    onClick={() => setToId(item.unit.id)}
                  >
                    设为目标
                  </Button>
                </div>
              ))}
            </div>
            )}
          </section>
        )}

        <section className="wt-surface" aria-label="常用换算">
          <div className="wt-surface__header">
            <Text as="h2" size={300} weight="semibold">
              常用换算速查
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              标「精确值」的是定义值，不是近似
            </Caption1>
          </div>
          <div className={`wt-surface__body ${styles.rows}`}>
            {QUICK_FACTS.map((fact) => (
              <div key={fact.label} className={styles.row}>
                <span className={styles.rowLabel}>{fact.label}</span>
                <span className={styles.rowValue}>{fact.detail}</span>
              </div>
            ))}
          </div>
        </section>

        <Caption1 className={styles.hint} style={{ padding: '0 4px' }}>
          温度使用仿射变换（含偏移）而不是比例换算，因此 0 °C = 32 °F 而不是 0 °F；
          存储区分十进制（kB = 1000）与二进制（KiB = 1024），两者在 TB 级别相差约 10%。
        </Caption1>

        <Divider />
      </div>
    </>
  );
}
