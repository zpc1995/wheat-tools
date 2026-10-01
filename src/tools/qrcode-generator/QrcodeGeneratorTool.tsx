import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
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
  Toast,
  ToastTitle,
  Toaster,
  useId,
  useToastController,
} from '@fluentui/react-components';
import {
  ArrowDownload16Regular,
  Broom16Regular,
  Checkmark16Regular,
  Copy16Regular,
  QrCode20Regular,
  Sparkle16Regular,
} from '@fluentui/react-icons';
import QRCode from 'qrcode';
import {
  QR_PRESETS,
  canRenderOnWhite,
  contrastRatio,
  type QrPreset,
} from './qrPresets';

const LEVELS: Array<{ value: 'L' | 'M' | 'Q' | 'H'; label: string; note: string }> = [
  { value: 'L', label: 'L · 低（约 7%）', note: '容量最大' },
  { value: 'M', label: 'M · 中（约 15%）', note: '默认，通用推荐' },
  { value: 'Q', label: 'Q · 较高（约 25%）', note: '适合有遮挡' },
  { value: 'H', label: 'H · 高（约 30%）', note: '容错最强，容量最小' },
];

const SIZES = [256, 384, 512, 768, 1024];

const useStyles = makeStyles({
  split: {
    display: 'grid',
    gap: '16px',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 380px)',
    alignItems: 'start',
  },
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  controls: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0',
    width: '100%',
  },
  controlRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  controlLabel: {
    flex: 'none',
    width: '92px',
    color: tokens.colorNeutralForeground3,
  },
  spacer: {
    flex: '1 1 auto',
  },
  canvasWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    backgroundColor: tokens.colorNeutralBackground3,
    flex: '1 1 auto',
  },
  canvas: {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: '6px',
    boxShadow: tokens.shadow8,
  },
  presets: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    padding: '12px 14px',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  colorInput: {
    width: '40px',
    height: '28px',
    padding: '2px',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: '6px',
    background: 'none',
    cursor: 'pointer',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    padding: '56px 24px',
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
  },
});

export function QrcodeGeneratorTool() {
  const styles = useStyles();
  const toasterId = useId('qr-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [text, setText] = useState('https://wheat.chat');
  const [level, setLevel] = useState<'L' | 'M' | 'Q' | 'H'>('M');
  const [size, setSize] = useState(384);
  const [margin, setMargin] = useState(2);
  const [dark, setDark] = useState('#0f172a');
  const [light, setLight] = useState('#ffffff');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);

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

  // Render straight onto the visible canvas; the same element then backs both
  // the preview and the PNG download, so what you see is what you get.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const trimmed = text;
    if (!trimmed) {
      setError(null);
      const context = canvas.getContext('2d');
      context?.clearRect(0, 0, canvas.width, canvas.height);
      return undefined;
    }

    let cancelled = false;

    QRCode.toCanvas(canvas, trimmed, {
      errorCorrectionLevel: level,
      width: size,
      margin,
      color: { dark, light },
    })
      .then(() => {
        if (!cancelled) setError(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        // The library throws when the payload exceeds the capacity for the
        // selected level; surface that instead of showing a stale code.
        setError(
          caught instanceof Error
            ? `无法生成：${caught.message}（可尝试降低纠错等级或缩短内容）`
            : '无法生成二维码',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [text, level, size, margin, dark, light]);

  const contrast = useMemo(() => contrastRatio(dark, light), [dark, light]);
  const lowContrast = contrast !== null && contrast < 3;
  const inverted = useMemo(
    () => !canRenderOnWhite(dark, light),
    [dark, light],
  );

  const download = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `qrcode-${level}-${size}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    notify('已开始下载 PNG');
  }, [level, size, notify]);

  const copyImage = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png'),
      );
      if (!blob || !navigator.clipboard?.write) {
        notify('当前浏览器不支持复制图片，请使用下载');
        return;
      }
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
      notify('二维码图片已复制');
    } catch {
      notify('复制图片失败，请使用下载');
    }
  }, [notify]);

  const applyPreset = useCallback((preset: QrPreset) => {
    setText(preset.build());
  }, []);

  const resetColors = useCallback(() => {
    setDark('#0f172a');
    setLight('#ffffff');
  }, []);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.split}>
        {/* -------- Input + preview -------- */}
        <div className={styles.stack}>
          <section className="wt-surface" aria-label="二维码内容">
            <div className="wt-surface__header">
              <QrCode20Regular />
              <Text as="h2" size={300} weight="semibold">
                二维码内容
              </Text>
              <span className={styles.spacer} />
              {text && (
                <Caption1 className={styles.hint}>{text.length} 字符</Caption1>
              )}
              <Tooltip content="清空内容" relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  icon={<Broom16Regular />}
                  onClick={() => setText('')}
                  disabled={!text}
                  aria-label="清空内容"
                />
              </Tooltip>
            </div>
            <div className="wt-surface__body">
              <textarea
                className="wt-code-area"
                style={{ minHeight: '130px' }}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="输入要生成二维码的内容，例如网址、文本、WIFI 配置…"
                aria-label="二维码内容"
                spellCheck={false}
              />
            </div>
          </section>

          <section className="wt-surface" aria-label="二维码预览">
            <div className="wt-surface__header">
              <Sparkle16Regular />
              <Text as="h2" size={300} weight="semibold">
                预览
              </Text>
              {error && (
                <Badge appearance="tint" color="danger" size="small">
                  生成失败
                </Badge>
              )}
              <span className={styles.spacer} />
              <Button
                appearance="secondary"
                size="small"
                icon={<ArrowDownload16Regular />}
                onClick={download}
                disabled={!text || Boolean(error)}
              >
                下载 PNG
              </Button>
              <Button
                appearance="secondary"
                size="small"
                icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
                onClick={() => void copyImage()}
                disabled={!text || Boolean(error)}
              >
                复制图片
              </Button>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              {text ? (
                <div className={styles.canvasWrap}>
                  <canvas
                    ref={canvasRef}
                    className={styles.canvas}
                    aria-label="二维码预览"
                  />
                </div>
              ) : (
                <div className={styles.empty}>
                  <QrCode20Regular />
                  <Text weight="semibold">等待输入</Text>
                  <Caption1>输入内容后即时生成二维码</Caption1>
                </div>
              )}
            </div>
          </section>

          {error && (
            <MessageBar intent="error">
              <MessageBarBody>
                <MessageBarTitle>无法生成二维码</MessageBarTitle>
                {error}
              </MessageBarBody>
            </MessageBar>
          )}

          {!error && text && lowContrast && (
            <MessageBar intent="warning">
              <MessageBarBody>
                <MessageBarTitle>
                  前景与背景对比度偏低（{contrast?.toFixed(1)}:1）
                </MessageBarTitle>
                对比度不足会导致部分扫码器识别失败，建议至少 3:1。
              </MessageBarBody>
            </MessageBar>
          )}

          {!error && text && inverted && (
            <MessageBar intent="warning">
              <MessageBarBody>
                <MessageBarTitle>前景比背景更亮（反色二维码）</MessageBarTitle>
                多数扫码器假定深色前景，反色可能无法识别，建议对调两个颜色。
              </MessageBarBody>
            </MessageBar>
          )}
        </div>

        {/* -------- Options -------- */}
        <div className={styles.stack}>
          <section className="wt-surface" aria-label="二维码选项">
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                选项
              </Text>
            </div>
            <div className={`wt-surface__body ${styles.controls}`}>
              <div className={styles.controlRow}>
                <Caption1 className={styles.controlLabel}>纠错等级</Caption1>
                <Dropdown
                  style={{ minWidth: 0, flex: '1 1 auto' }}
                  value={LEVELS.find((item) => item.value === level)?.label ?? ''}
                  selectedOptions={[level]}
                  onOptionSelect={(_, data) =>
                    setLevel((data.optionValue as 'L' | 'M' | 'Q' | 'H') ?? 'M')
                  }
                  aria-label="纠错等级"
                >
                  {LEVELS.map((item) => (
                    <Option key={item.value} value={item.value} text={item.label}>
                      {item.label}
                    </Option>
                  ))}
                </Dropdown>
              </div>

              <div className={styles.controlRow}>
                <Caption1 className={styles.controlLabel}>尺寸</Caption1>
                <Dropdown
                  style={{ minWidth: 0, flex: '1 1 auto' }}
                  value={`${size} × ${size}`}
                  selectedOptions={[String(size)]}
                  onOptionSelect={(_, data) => setSize(Number(data.optionValue))}
                  aria-label="图片尺寸"
                >
                  {SIZES.map((item) => (
                    <Option key={item} value={String(item)} text={`${item} × ${item}`}>
                      {item} × {item}
                    </Option>
                  ))}
                </Dropdown>
              </div>

              <div className={styles.controlRow}>
                <Caption1 className={styles.controlLabel}>留白</Caption1>
                <input
                  type="range"
                  min={0}
                  max={8}
                  value={margin}
                  onChange={(event) => setMargin(Number(event.target.value))}
                  aria-label="留白模块数"
                  style={{ flex: '1 1 auto' }}
                />
                <Caption1>{margin}</Caption1>
              </div>

              <div className={styles.controlRow}>
                <Caption1 className={styles.controlLabel}>前景色</Caption1>
                <input
                  type="color"
                  className={styles.colorInput}
                  value={dark}
                  onChange={(event) => setDark(event.target.value)}
                  aria-label="前景色"
                />
                <Caption1 className={styles.hint}>{dark}</Caption1>
                <span className={styles.spacer} />
                <Caption1 className={styles.controlLabel}>背景色</Caption1>
                <input
                  type="color"
                  className={styles.colorInput}
                  value={light}
                  onChange={(event) => setLight(event.target.value)}
                  aria-label="背景色"
                />
                <Caption1 className={styles.hint}>{light}</Caption1>
              </div>

              <div className={styles.controlRow}>
                <Caption1 className={styles.controlLabel}>颜色</Caption1>
                <Button appearance="secondary" size="small" onClick={resetColors}>
                  恢复默认黑白
                </Button>
                {contrast !== null && (
                  <Caption1 className={styles.hint}>
                    对比度 {contrast.toFixed(1)}:1
                  </Caption1>
                )}
              </div>
            </div>
          </section>

          <section className="wt-surface" aria-label="常用模板">
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                模板
              </Text>
              <span className={styles.spacer} />
              <Caption1>点击填入内容</Caption1>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.presets}>
                {QR_PRESETS.map((preset) => (
                  <Tooltip
                    key={preset.key}
                    content={preset.description}
                    relationship="description"
                    withArrow
                  >
                    <Button
                      appearance="secondary"
                      size="small"
                      onClick={() => applyPreset(preset)}
                    >
                      {preset.label}
                    </Button>
                  </Tooltip>
                ))}
              </div>
              <Divider />
              <div className={styles.controlRow}>
                <Caption1 className={styles.hint}>
                  二维码在本地用 canvas 生成，内容不会离开浏览器；
                  但若内容本身包含敏感信息，请谨慎分享生成后的图片。
                </Caption1>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
