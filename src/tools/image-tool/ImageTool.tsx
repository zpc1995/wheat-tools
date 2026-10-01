import { useCallback, useMemo, useRef, useState } from 'react';
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
  Slider,
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
  ArrowDownload16Regular,
  ArrowUpload16Regular,
  Broom16Regular,
  Checkmark16Regular,
  Copy16Regular,
  Image16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  DEFAULT_COMPRESS_OPTIONS,
  DIMENSION_PRESETS,
  QUALITY_PRESETS,
  base64Size,
  compressImage,
  computeSavings,
  embedSnippets,
  formatBytes,
  isSupportedImage,
  loadImage,
  outputFileName,
  parseDataUrl,
  ratioLabel,
  type CompressOptions,
  type LoadedImage,
  type OutputFormat,
} from './imageUtils';

const FORMATS: Array<{ value: OutputFormat; label: string; note: string }> = [
  { value: 'image/jpeg', label: 'JPEG', note: '照片首选，不支持透明' },
  { value: 'image/webp', label: 'WebP', note: '同质量下更小，支持透明' },
  { value: 'image/png', label: 'PNG', note: '无损，适合截图与线条图' },
];

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
  options: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '14px',
    width: '100%',
  },
  optionRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    alignItems: 'center',
  },
  previewPane: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    minHeight: '220px',
    width: '100%',
    backgroundColor: tokens.colorNeutralBackground2,
    backgroundImage:
      'linear-gradient(45deg, var(--colorNeutralBackground3) 25%, transparent 25%, transparent 75%, var(--colorNeutralBackground3) 75%), linear-gradient(45deg, var(--colorNeutralBackground3) 25%, transparent 25%, transparent 75%, var(--colorNeutralBackground3) 75%)',
    backgroundSize: '16px 16px',
    backgroundPosition: '0 0, 8px 8px',
  },
  previewImg: {
    maxWidth: '100%',
    maxHeight: '360px',
    objectFit: 'contain',
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
    fontSize: '16px',
    fontVariantNumeric: 'tabular-nums',
  },
  snippets: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  snippetRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  snippetCode: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12px',
    overflowWrap: 'anywhere',
  },
});

export function ImageTool() {
  const styles = useStyles();
  const toasterId = useId('img-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [image, setImage] = useState<LoadedImage | null>(null);
  const [options, setOptions] = useState<CompressOptions>(DEFAULT_COMPRESS_OPTIONS);
  const [result, setResult] = useState<{
    blob: Blob;
    dataUrl: string;
    width: number;
    height: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'preview' | 'dataurl'>('preview');
  const [copied, setCopied] = useState<string | null>(null);

  const picker = useRef<HTMLInputElement>(null);

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

  const run = useCallback(
    async (loaded: LoadedImage, config: CompressOptions) => {
      setBusy(true);
      setError(null);
      try {
        const output = await compressImage(loaded, config);
        const dataUrl = output.dataUrl;
        setResult({
          blob: output.blob,
          dataUrl,
          width: output.width,
          height: output.height,
        });
      } catch (caught) {
        setResult(null);
        setError(caught instanceof Error ? caught.message : '处理失败');
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      if (!isSupportedImage(file.type)) {
        setError(
          `不支持的类型 ${file.type || '（未知）'}。` +
            '浏览器画布无法绘制 SVG，请先转为位图格式。',
        );
        return;
      }
      try {
        const loaded = await loadImage(file);
        setImage(loaded);
        await run(loaded, options);
      } catch (caught) {
        setImage(null);
        setResult(null);
        setError(caught instanceof Error ? caught.message : '读取失败');
      }
    },
    [options, run],
  );

  const update = useCallback(
    async (patch: Partial<CompressOptions>) => {
      const next = { ...options, ...patch };
      setOptions(next);
      if (image) await run(image, next);
    },
    [options, image, run],
  );

  const savings = useMemo(
    () => (image && result ? computeSavings(image.bytes, result.blob.size) : null),
    [image, result],
  );

  const dataUrlInfo = useMemo(
    () => (result ? parseDataUrl(result.dataUrl) : null),
    [result],
  );

  const snippets = useMemo(
    () =>
      result ? embedSnippets(result.dataUrl, result.width, result.height) : [],
    [result],
  );

  const download = useCallback(() => {
    if (!result || !image) return;
    const url = URL.createObjectURL(result.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = outputFileName(image.name, options.format);
    link.click();
    URL.revokeObjectURL(url);
  }, [result, image, options.format]);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <input
        ref={picker}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          event.target.value = '';
        }}
      />

      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <Button
            appearance="primary"
            icon={<ArrowUpload16Regular />}
            onClick={() => picker.current?.click()}
          >
            选择图片
          </Button>
          {image && (
            <>
              <Badge appearance="tint" color="brand" size="medium">
                {image.name}
              </Badge>
              <Caption1 className={styles.hint}>
                {image.width} × {image.height} · {formatBytes(image.bytes)}
              </Caption1>
            </>
          )}
          <span className={styles.spacer} />
          {result && (
            <Tooltip content="下载处理后的图片" relationship="label" withArrow>
              <Button
                appearance="secondary"
                icon={<ArrowDownload16Regular />}
                onClick={download}
              >
                下载
              </Button>
            </Tooltip>
          )}
          <Button
            appearance="subtle"
            icon={<Broom16Regular />}
            onClick={() => {
              setImage(null);
              setResult(null);
              setError(null);
            }}
            disabled={!image && !result}
          >
            清除
          </Button>
        </div>

        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}

        <MessageBar intent="info">
          <MessageBarBody>
            图片在浏览器本地用画布处理，不会上传到任何服务器——
            这一点对含隐私内容的截图尤其重要。
            注意 JPEG 没有透明通道：把带透明的 PNG 转为 JPEG 时，
            透明区域会被填充为下方选择的背景色（默认白色），否则多数编码器会填成黑色。
          </MessageBarBody>
        </MessageBar>

        {!image && !error && (
          <section className="wt-surface">
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className="wt-empty">
                <Image16Regular />
                <Text weight="semibold">选择一张图片开始</Text>
                <Caption1>
                  支持 JPEG / PNG / WebP / GIF / BMP / AVIF；SVG 无法用画布处理所以不支持
                </Caption1>
              </div>
            </div>
          </section>
        )}

        {image && result && savings && (
          <>
            <section className="wt-surface" aria-label="处理结果">
              <div className="wt-surface__header">
                <Text as="h2" size={300} weight="semibold">
                  处理结果
                </Text>
                {savings.savedBytes > 0 ? (
                  <Badge appearance="tint" color="success" size="small">
                    减小 {savings.savedPercent}%
                  </Badge>
                ) : (
                  <Badge appearance="tint" color="warning" size="small">
                    反而变大 {Math.abs(savings.savedPercent)}%
                  </Badge>
                )}
                <span className={styles.spacer} />
                <TabList
                  size="small"
                  selectedValue={tab}
                  onTabSelect={(_, data) =>
                    setTab(data.value as 'preview' | 'dataurl')
                  }
                >
                  <Tab value="preview">预览</Tab>
                  <Tab value="dataurl">Base64</Tab>
                </TabList>
              </div>
              <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                {tab === 'preview' ? (
                  <div className={styles.previewPane}>
                    <img
                      className={styles.previewImg}
                      src={result.dataUrl}
                      alt="处理后的预览"
                    />
                  </div>
                ) : (
                  <textarea
                    className="wt-code-area"
                    style={{ minHeight: '220px' }}
                    value={result.dataUrl}
                    readOnly
                    aria-label="Base64 data URL"
                    spellCheck={false}
                  />
                )}
              </div>
            </section>

            <section className="wt-surface" aria-label="体积统计">
              <div className="wt-surface__header">
                <Text as="h2" size={300} weight="semibold">
                  体积对比
                </Text>
                <span className={styles.spacer} />
                <Caption1 className={styles.hint}>
                  {savings.savedBytes > 0
                    ? `省下 ${formatBytes(savings.savedBytes)}`
                    : '当前设置没有带来体积收益，可尝试降低质量或改用 WebP'}
                </Caption1>
              </div>
              <div className={`wt-surface__body ${styles.stats}`}>
                {[
                  ['原始', formatBytes(savings.before)],
                  ['处理后', formatBytes(savings.after)],
                  ['比例', ratioLabel(savings.before, savings.after)],
                  ['输出尺寸', `${result.width} × ${result.height}`],
                  [
                    'Base64 长度',
                    dataUrlInfo ? `${base64Size(savings.after).toLocaleString()} 字符` : '—',
                  ],
                  [
                    'Base64 膨胀',
                    `${Math.round((base64Size(savings.after) / savings.after) * 100)}%`,
                  ],
                ].map(([label, value]) => (
                  <div key={label} className={styles.stat}>
                    <Caption1 className={styles.hint}>{label}</Caption1>
                    <span className={styles.statValue}>{value}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="wt-surface" aria-label="嵌入片段">
              <div className="wt-surface__header">
                <Text as="h2" size={300} weight="semibold">
                  嵌入用法
                </Text>
                <span className={styles.spacer} />
                <Caption1 className={styles.hint}>
                  显示时省略中间内容，复制得到的是完整值
                </Caption1>
              </div>
              <div className={`wt-surface__body ${styles.snippets}`}>
                {snippets.map((snippet) => (
                  <div key={snippet.label} className={styles.snippetRow}>
                    <Caption1 className={styles.hint} style={{ width: 120 }}>
                      {snippet.label}
                    </Caption1>
                    <span className={styles.snippetCode}>{snippet.code}</span>
                    <Tooltip content="复制完整片段" relationship="label" withArrow>
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={
                          copied === snippet.label ? (
                            <Checkmark16Regular />
                          ) : (
                            <Copy16Regular />
                          )
                        }
                        onClick={() => copy(snippet.code, snippet.label)}
                        aria-label="复制完整片段"
                      />
                    </Tooltip>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {image && (
          <section className="wt-surface" aria-label="压缩选项">
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                压缩选项
              </Text>
              <span className={styles.spacer} />
              {busy && <Caption1 className={styles.hint}>处理中…</Caption1>}
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.options}>
                <div className={styles.optionRow}>
                  <Caption1 className={styles.hint} style={{ width: 72 }}>
                    输出格式
                  </Caption1>
                  <TabList
                    selectedValue={options.format}
                    onTabSelect={(_, data) =>
                      void update({ format: data.value as OutputFormat })
                    }
                  >
                    {FORMATS.map((format) => (
                      <Tab key={format.value} value={format.value}>
                        {format.label}
                      </Tab>
                    ))}
                  </TabList>
                  <Caption1 className={styles.hint}>
                    {FORMATS.find((f) => f.value === options.format)?.note}
                  </Caption1>
                </div>

                {options.format !== 'image/png' && (
                  <div className={styles.optionRow}>
                    <Caption1 className={styles.hint} style={{ width: 72 }}>
                      质量 {Math.round(options.quality * 100)}%
                    </Caption1>
                    <div style={{ flex: '1 1 260px', minWidth: 200 }}>
                      <Slider
                        min={10}
                        max={100}
                        value={Math.round(options.quality * 100)}
                        onChange={(_, data) =>
                          void update({ quality: data.value / 100 })
                        }
                      />
                    </div>
                    {QUALITY_PRESETS.map((preset) => (
                      <Tooltip
                        key={preset.label}
                        content={preset.note}
                        relationship="description"
                        withArrow
                      >
                        <Button
                          appearance={
                            Math.abs(options.quality - preset.value) < 0.001
                              ? 'primary'
                              : 'secondary'
                          }
                          size="small"
                          onClick={() => void update({ quality: preset.value })}
                        >
                          {preset.label}
                        </Button>
                      </Tooltip>
                    ))}
                  </div>
                )}

                <div className={styles.optionRow}>
                  <Caption1 className={styles.hint} style={{ width: 72 }}>
                    最大边长
                  </Caption1>
                  <Dropdown
                    style={{ minWidth: 160 }}
                    value={
                      options.maxDimension === null
                        ? '不缩放'
                        : `${options.maxDimension} 像素`
                    }
                    selectedOptions={[String(options.maxDimension)]}
                    onOptionSelect={(_, data) =>
                      void update({
                        maxDimension:
                          data.optionValue === 'null'
                            ? null
                            : Number(data.optionValue),
                      })
                    }
                    aria-label="最大边长"
                  >
                    {DIMENSION_PRESETS.map((preset) => (
                      <Option
                        key={preset.label}
                        value={String(preset.value)}
                        text={preset.label}
                      >
                        {preset.label}
                      </Option>
                    ))}
                  </Dropdown>
                  <Caption1 className={styles.hint}>
                    只缩不放：原图已小于该值时不放大，避免白白增大体积
                  </Caption1>
                </div>

                {options.format === 'image/jpeg' && (
                  <div className={styles.optionRow}>
                    <Caption1 className={styles.hint} style={{ width: 72 }}>
                      透明填充
                    </Caption1>
                    <input
                      type="color"
                      value={options.background}
                      onChange={(event) =>
                        void update({ background: event.target.value })
                      }
                      aria-label="透明区域填充色"
                      style={{ width: 48, height: 32, border: 'none' }}
                    />
                    <Caption1 className={styles.hint}>
                      JPEG 无法保存透明，透明像素会填充为此颜色
                    </Caption1>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>关于「体积反而变大」</MessageBarTitle>
            已压缩过的图片（例如从别处下载的 JPEG）再用同样格式高质量重新编码，
            体积往往会变大——每次有损编码都会损失信息却不一定更小。
            这种情况下建议改用 WebP，或降低质量，或干脆不重新编码。
          </MessageBarBody>
        </MessageBar>

        <Divider />
      </div>
    </>
  );
}
