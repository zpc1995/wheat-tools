import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
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
  Color16Regular,
  Copy16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  NAMED_COLORS,
  buildScale,
  contrastWith,
  parseColor,
  readableTextColor,
  rgbToCmyk,
  toHex,
  toHslString,
  toHsvString,
  toRgbString,
  type Rgba,
} from './colorUtils';

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
    alignItems: 'center',
    gap: '10px',
    padding: '9px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  rowLabel: {
    flex: 'none',
    width: '110px',
    color: tokens.colorNeutralForeground3,
  },
  rowValue: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '14px',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  preview: {
    display: 'flex',
    gap: '12px',
    padding: '16px',
    width: '100%',
    alignItems: 'stretch',
    flexWrap: 'wrap',
  },
  swatch: {
    flex: '1 1 220px',
    minHeight: '120px',
    borderRadius: '10px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    // Checkerboard so alpha is visible rather than implied.
    backgroundImage:
      'linear-gradient(45deg, var(--colorNeutralBackground4) 25%, transparent 25%), linear-gradient(-45deg, var(--colorNeutralBackground4) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--colorNeutralBackground4) 75%), linear-gradient(-45deg, transparent 75%, var(--colorNeutralBackground4) 75%)',
    backgroundSize: '16px 16px',
    backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
    position: 'relative',
    overflow: 'hidden',
  },
  swatchFill: {
    position: 'absolute',
    inset: 0,
  },
  swatchLabel: {
    position: 'relative',
    fontWeight: 600,
    fontSize: '15px',
    padding: '4px 10px',
    borderRadius: '6px',
  },
  scale: {
    display: 'flex',
    width: '100%',
    height: '64px',
  },
  scaleCell: {
    flex: '1 1 0',
    display: 'grid',
    placeItems: 'center',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '10px',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    padding: '12px 14px',
  },
  chip: {
    width: '26px',
    height: '26px',
    borderRadius: '6px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    cursor: 'pointer',
    padding: 0,
  },
  slider: {
    flex: '1 1 auto',
    minWidth: '140px',
  },
});

interface Row {
  label: string;
  value: string;
}

export function ColorConverterTool() {
  const styles = useStyles();
  const toasterId = useId('color-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [input, setInput] = useState('#2f6fed');
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

  const parsed = useMemo(() => parseColor(input), [input]);
  const color: Rgba | null = parsed.ok ? parsed.color : null;

  const rows = useMemo<Row[]>(() => {
    if (!color) return [];
    const cmyk = rgbToCmyk(color);
    return [
      { label: 'HEX', value: toHex(color) },
      { label: 'HEX (含 alpha)', value: toHex(color, true) },
      { label: 'RGB', value: toRgbString(color) },
      { label: 'HSL', value: toHslString(color) },
      { label: 'HSV / HSB', value: toHsvString(color) },
      {
        label: 'CMYK',
        value: `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`,
      },
      {
        label: 'CSS 变量',
        value: `--color: ${toHex(color)};`,
      },
    ];
  }, [color]);

  const scale = useMemo(() => (color ? buildScale(color) : []), [color]);

  const contrast = useMemo(() => {
    if (!color) return null;
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const black = { r: 0, g: 0, b: 0, a: 1 };
    return {
      onWhite: contrastWith(color, white),
      onBlack: contrastWith(color, black),
      textColor: readableTextColor(color),
    };
  }, [color]);

  /** Sets alpha without disturbing the parsed hue. */
  const setAlpha = useCallback(
    (value: number) => {
      if (!color) return;
      setInput(toHex({ ...color, a: value }, true));
    },
    [color],
  );

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <input
            className="wt-inline-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="#2f6fed / rgb(47,111,237) / hsl(220,84%,56%) / red"
            aria-label="颜色输入"
            spellCheck={false}
          />
          {/* Native picker as a convenience; it writes back the same hex form. */}
          <input
            type="color"
            className={styles.chip}
            style={{ width: 38, height: 38 }}
            value={color ? toHex(color) : '#000000'}
            onChange={(event) => setInput(event.target.value)}
            aria-label="取色器"
          />
          <span className={styles.spacer} />
          <Caption1 className={styles.hint}>
            支持 HEX / RGB / HSL / HSV / 颜色名
          </Caption1>
        </div>

        {!parsed.ok && (
          <Text className={styles.hint} style={{ color: tokens.colorPaletteRedForeground1 }}>
            {parsed.error}
          </Text>
        )}

        {color && (
          <>
            <section className="wt-surface" aria-label="颜色预览">
              <div className="wt-surface__header">
                <Color16Regular />
                <Text size={300} weight="semibold">
                  预览
                </Text>
                <span className={styles.spacer} />
                <Caption1 className={styles.hint}>
                  棋盘格用于显示透明度
                </Caption1>
              </div>
              <div className={styles.preview}>
                <div className={styles.swatch}>
                  <div
                    className={styles.swatchFill}
                    style={{ backgroundColor: toHex(color, true) }}
                  />
                  <span
                    className={styles.swatchLabel}
                    style={{
                      color: readableTextColor(color),
                      backgroundColor: `${readableTextColor(color)}22`,
                    }}
                  >
                    {toHex(color)}
                  </span>
                </div>
                <div
                  className={styles.swatch}
                  style={{ backgroundColor: toHex({ ...color, a: 1 }) }}
                >
                  <span
                    className={styles.swatchLabel}
                    style={{ color: readableTextColor({ ...color, a: 1 }) }}
                  >
                    不透明预览
                  </span>
                </div>
              </div>
              <div className={styles.row}>
                <Text className={styles.rowLabel} size={200}>
                  Alpha
                </Text>
                <input
                  className={styles.slider}
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(color.a * 100)}
                  onChange={(event) => setAlpha(Number(event.target.value) / 100)}
                  aria-label="透明度"
                />
                <Caption1>{Math.round(color.a * 100)}%</Caption1>
              </div>
            </section>

            <section className="wt-surface" aria-label="颜色格式">
              <div className="wt-surface__header">
                <Text size={300} weight="semibold">
                  各格式表示
                </Text>
                <span className={styles.spacer} />
                <Caption1 className={styles.hint}>点击右侧按钮复制</Caption1>
              </div>
              <div className={`wt-surface__body ${styles.rows}`}>
                {rows.map((row) => (
                  <div key={row.label} className={styles.row}>
                    <Text className={styles.rowLabel} size={200}>
                      {row.label}
                    </Text>
                    <span className={styles.rowValue}>{row.value}</span>
                    <Tooltip content="复制" relationship="label" withArrow>
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={
                          copied === row.label ? (
                            <Checkmark16Regular />
                          ) : (
                            <Copy16Regular />
                          )
                        }
                        onClick={() => copy(row.value, row.label)}
                        aria-label={`复制 ${row.label}`}
                      />
                    </Tooltip>
                  </div>
                ))}
              </div>
            </section>

            {contrast && (
              <section className="wt-surface" aria-label="对比度">
                <div className="wt-surface__header">
                  <Text size={300} weight="semibold">
                    对比度（WCAG）
                  </Text>
                  <span className={styles.spacer} />
                  <Caption1 className={styles.hint}>
                    正文需 4.5:1，大字需 3:1
                  </Caption1>
                </div>
                <div className={`wt-surface__body ${styles.rows}`}>
                  {[
                    { label: '对白字', value: contrast.onWhite },
                    { label: '对黑字', value: contrast.onBlack },
                  ].map((item) => (
                    <div key={item.label} className={styles.row}>
                      <Text className={styles.rowLabel} size={200}>
                        {item.label}
                      </Text>
                      <span className={styles.rowValue}>
                        {item.value.toFixed(2)} : 1
                      </span>
                      <Badge
                        appearance="tint"
                        color={
                          item.value >= 4.5
                            ? 'success'
                            : item.value >= 3
                              ? 'warning'
                              : 'danger'
                        }
                        size="small"
                      >
                        {item.value >= 7
                          ? 'AAA'
                          : item.value >= 4.5
                            ? 'AA'
                            : item.value >= 3
                              ? '仅大字'
                              : '不达标'}
                      </Badge>
                    </div>
                  ))}
                  <div className={styles.row}>
                    <Text className={styles.rowLabel} size={200}>
                      建议文字色
                    </Text>
                    <span className={styles.rowValue}>{contrast.textColor}</span>
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 4,
                        backgroundColor: contrast.textColor,
                        border: `1px solid ${tokens.colorNeutralStroke2}`,
                      }}
                    />
                  </div>
                </div>
              </section>
            )}

            <section className="wt-surface" aria-label="色阶">
              <div className="wt-surface__header">
                <Text size={300} weight="semibold">
                  色阶（保持色相）
                </Text>
                <span className={styles.spacer} />
                <Caption1 className={styles.hint}>点击任意格子切换</Caption1>
              </div>
              <div className={`wt-surface__body ${styles.rows}`}>
                <div className={styles.scale}>
                  {scale.map((step) => (
                    <button
                      key={step.step}
                      type="button"
                      className={styles.scaleCell}
                      style={{
                        backgroundColor: toHex(step.color),
                        color: readableTextColor(step.color),
                      }}
                      onClick={() => setInput(toHex(step.color))}
                      title={toHex(step.color)}
                    >
                      {step.step}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="wt-surface" aria-label="常用颜色">
              <div className="wt-surface__header">
                <Text size={300} weight="semibold">
                  常用颜色
                </Text>
                <span className={styles.spacer} />
                <Caption1 className={styles.hint}>
                  {NAMED_COLORS.length} 个内置颜色名
                </Caption1>
              </div>
              <div className={`wt-surface__body ${styles.rows}`}>
                <div className={styles.chips}>
                  {NAMED_COLORS.map((named) => (
                    <Tooltip
                      key={named.name}
                      content={`${named.name} ${named.hex}`}
                      relationship="label"
                      withArrow
                    >
                      <button
                        type="button"
                        className={styles.chip}
                        style={{ backgroundColor: named.hex }}
                        onClick={() => setInput(named.name)}
                        aria-label={named.name}
                      />
                    </Tooltip>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}

        <Divider />
      </div>
    </>
  );
}
