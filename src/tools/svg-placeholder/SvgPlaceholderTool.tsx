import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Checkbox,
  Divider,
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowDownloadRegular,
  CheckmarkRegular,
  CopyRegular,
  ImageRegular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  DEFAULT_OPTIONS,
  MAX_DIMENSION,
  MIN_DIMENSION,
  generatePlaceholder,
  isValidColour,
  type PatternKind,
  type PlaceholderOptions,
} from './svgPlaceholderUtils';

const PATTERNS: Array<{ value: PatternKind; label: string }> = [
  { value: 'none', label: '无底纹' },
  { value: 'grid', label: '网格' },
  { value: 'stripes', label: '斜条纹' },
];

const useStyles = makeStyles({
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    padding: '16px',
    width: '100%',
    boxSizing: 'border-box',
  },
  columns: {
    display: 'grid',
    gap: '18px',
    gridTemplateColumns: 'minmax(280px, 340px) minmax(0, 1fr)',
    alignItems: 'start',
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    minWidth: 0,
  },
  pair: {
    display: 'grid',
    gap: '10px',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
  },
  colourRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  swatch: {
    flex: 'none',
    width: '36px',
    height: '32px',
    padding: '2px',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: '6px',
    background: 'none',
    cursor: 'pointer',
  },
  preview: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '18px',
    borderRadius: '8px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    // A checkerboard reads as "transparent" without needing to render one: the
    // gradient pair below is the CSS shorthand for it.
    backgroundColor: tokens.colorNeutralBackground2,
    overflow: 'auto',
    minHeight: '200px',
  },
  previewImage: {
    maxWidth: '100%',
    boxShadow: tokens.shadow4,
  },
  codeHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
    flexWrap: 'wrap',
  },
  codeScroll: {
    maxHeight: '220px',
    overflow: 'auto',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '6px',
    backgroundColor: tokens.colorNeutralBackground3,
  },
  code: {
    margin: 0,
    padding: '10px 12px',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12px',
    lineHeight: 1.55,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  meta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    alignItems: 'center',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
  },
});

/** Parses a numeric field, keeping the previous value when the text is not a number. */
function toNumber(text: string, fallback: number): number {
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function SvgPlaceholderTool() {
  const styles = useStyles();
  const [options, setOptions] = useState<PlaceholderOptions>(DEFAULT_OPTIONS);
  const [copied, setCopied] = useState<'svg' | 'data' | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  const result = useMemo(() => generatePlaceholder(options), [options]);

  const update = useCallback(<K extends keyof PlaceholderOptions>(key: K, value: PlaceholderOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
    setCopied(null);
    setDownloaded(false);
  }, []);

  /**
   * Copies through the shared helper, which reports failure instead of throwing.
   * The button only flips to "已复制" when the clipboard actually accepted the
   * text — claiming a copy that did not happen is worse than saying nothing.
   */
  const onCopy = useCallback(async (kind: 'svg' | 'data', text: string) => {
    const ok = await copyText(text);
    setCopied(ok ? kind : null);
  }, []);

  const onDownload = useCallback(() => {
    // A Blob plus `URL.createObjectURL` rather than a `data:` href: a long data
    // URL hits browser URL-length limits and is re-parsed by the downloader,
    // while the object URL hands over the exact bytes.
    const blob = new Blob([result.svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `placeholder-${options.width}x${options.height}.svg`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoking immediately can cancel the download in some browsers; the next
    // tick is enough of a delay and does not leak the URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setDownloaded(true);
  }, [options.height, options.width, result.svg]);

  const badColour =
    !isValidColour(options.background) ||
    !isValidColour(options.textColor) ||
    !isValidColour(options.borderColor) ||
    !isValidColour(options.patternColor);

  return (
    <div className="wt-surface">
      <div className={`wt-surface__body ${styles.body}`}>
        <div className={styles.columns}>
          <div className={styles.panel}>
            <Text as="h2" size={300} weight="semibold">
              参数
            </Text>

            <div className={styles.pair}>
              <Field label="宽度">
                <Input
                  type="number"
                  min={MIN_DIMENSION}
                  max={MAX_DIMENSION}
                  value={String(options.width)}
                  aria-label="占位图宽度（像素）"
                  onChange={(_event, data) => update('width', toNumber(data.value, options.width))}
                />
              </Field>
              <Field label="高度">
                <Input
                  type="number"
                  min={MIN_DIMENSION}
                  max={MAX_DIMENSION}
                  value={String(options.height)}
                  aria-label="占位图高度（像素）"
                  onChange={(_event, data) => update('height', toNumber(data.value, options.height))}
                />
              </Field>
            </div>

            <Field label="文字（可多行）">
              <textarea
                className="wt-code-area"
                style={{ minHeight: '84px', resize: 'vertical' }}
                value={options.text}
                aria-label="占位图文字内容"
                onChange={(event) => update('text', event.target.value)}
              />
            </Field>

            <div className={styles.pair}>
              <Field label="字号（0 = 自动）">
                <Input
                  type="number"
                  min={0}
                  value={String(options.fontSize)}
                  aria-label="文字字号，0 表示自动"
                  onChange={(_event, data) => update('fontSize', toNumber(data.value, options.fontSize))}
                />
              </Field>
              <Field label="圆角">
                <Input
                  type="number"
                  min={0}
                  value={String(options.radius)}
                  aria-label="圆角半径"
                  onChange={(_event, data) => update('radius', toNumber(data.value, options.radius))}
                />
              </Field>
            </div>

            <Field label="背景色">
              <div className={styles.colourRow}>
                <input
                  type="color"
                  className={styles.swatch}
                  aria-label="选择背景色"
                  value={/^#[0-9a-f]{6}$/i.test(options.background) ? options.background : '#ffffff'}
                  onChange={(event) => update('background', event.target.value)}
                />
                <Input
                  value={options.background}
                  aria-label="背景色文本（支持 #hex、rgb()、颜色名）"
                  onChange={(_event, data) => update('background', data.value)}
                />
              </div>
            </Field>

            <Field label="文字颜色">
              <div className={styles.colourRow}>
                <input
                  type="color"
                  className={styles.swatch}
                  aria-label="选择文字颜色"
                  value={/^#[0-9a-f]{6}$/i.test(options.textColor) ? options.textColor : '#000000'}
                  onChange={(event) => update('textColor', event.target.value)}
                />
                <Input
                  value={options.textColor}
                  aria-label="文字颜色文本（支持 #hex、rgb()、颜色名）"
                  onChange={(_event, data) => update('textColor', data.value)}
                />
              </div>
            </Field>

            <div className={styles.pair}>
              <Field label="边框宽度">
                <Input
                  type="number"
                  min={0}
                  value={String(options.borderWidth)}
                  aria-label="边框宽度（像素）"
                  onChange={(_event, data) => update('borderWidth', toNumber(data.value, options.borderWidth))}
                />
              </Field>
              <Field label="边框颜色">
                <div className={styles.colourRow}>
                  <input
                    type="color"
                    className={styles.swatch}
                    aria-label="选择边框颜色"
                    value={/^#[0-9a-f]{6}$/i.test(options.borderColor) ? options.borderColor : '#000000'}
                    onChange={(event) => update('borderColor', event.target.value)}
                  />
                  <Input
                    value={options.borderColor}
                      aria-label="边框颜色文本（支持 #hex、rgb()、颜色名）"
                    onChange={(_event, data) => update('borderColor', data.value)}
                  />
                </div>
              </Field>
            </div>

            <Field label="底纹">
              <Dropdown
                aria-label="底纹样式"
                value={PATTERNS.find((pattern) => pattern.value === options.pattern)?.label ?? '无底纹'}
                selectedOptions={[options.pattern]}
                onOptionSelect={(_event, data) =>
                  update('pattern', (data.optionValue as PatternKind | undefined) ?? 'none')
                }
              >
                {PATTERNS.map((pattern) => (
                  <Option key={pattern.value} value={pattern.value}>
                    {pattern.label}
                  </Option>
                ))}
              </Dropdown>
            </Field>

            <Field label="底纹颜色">
              <Input
                value={options.patternColor}
                aria-label="底纹颜色文本（支持 #hex、rgb()、颜色名）"
                onChange={(_event, data) => update('patternColor', data.value)}
              />
            </Field>

            <Checkbox
              checked={options.showDimensions}
              label="显示尺寸标注（在边缘画出宽高刻度）"
              aria-label="显示尺寸标注"
              onChange={(_event, data) => update('showDimensions', data.checked === true)}
            />

            {badColour && (
              <MessageBar intent="warning">
                <MessageBarBody>
                  有颜色值不符合允许的写法（<code>#hex</code>、<code>rgb()</code>、<code>hsl()</code>
                  或颜色名），已回退到默认色。颜色不做转义而是走白名单，是为了杜绝
                  <code>red&quot; onload=&quot;…</code> 这类属性注入。
                </MessageBarBody>
              </MessageBar>
            )}

            <Divider />
            <Text as="h2" size={300} weight="semibold">
              安全与边界
            </Text>
            <Caption1 className={styles.hint}>
              文字会先做 XML 转义（<code>&amp;</code> 优先），再替换掉 XML 1.0
              不允许的控制字符与孤立代理项，所以 <code>&lt;/text&gt;&lt;script&gt;</code>
              这类内容只会原样显示，不会变成元素。预览使用 <code>&lt;img src=&quot;data:…&quot;&gt;</code>
              ：浏览器在图片上下文里不执行 SVG 脚本、不加载外部资源，即使文档被注入也打不出去。
            </Caption1>
            <Caption1 className={styles.hint}>
              不做 PNG/JPEG 导出——位图需要真正的渲染引擎（canvas 或原生光栅化库），与本工具的
              字符串生成路径是两件事；需要位图时请用图像工具。也不做外部图片、字体与滤镜引用，
              生成的 SVG 完全自包含、可离线打开。
            </Caption1>
          </div>

          <div className={styles.panel}>
            <div className={styles.codeHeader}>
              <Text as="h2" size={300} weight="semibold">
                预览
              </Text>
              <div className={styles.meta}>
                <Badge appearance="tint" color="informative">
                  {`${options.width} × ${options.height}`}
                </Badge>
                <Caption1 className={styles.hint}>{`SVG 源码 ${result.byteLength} 字节`}</Caption1>
              </div>
            </div>

            <div className={styles.preview}>
              <img className={styles.previewImage} src={result.dataUrl} alt="占位图预览" />
            </div>

            <div className={styles.codeHeader}>
              <Text as="h2" size={300} weight="semibold">
                SVG 源码
              </Text>
              <div className={styles.meta}>
                <Button
                  size="small"
                  icon={copied === 'svg' ? <CheckmarkRegular /> : <CopyRegular />}
                  onClick={() => onCopy('svg', result.svg)}
                >
                  {copied === 'svg' ? '已复制' : '复制'}
                </Button>
                <Button
                  size="small"
                  appearance="primary"
                  icon={downloaded ? <CheckmarkRegular /> : <ArrowDownloadRegular />}
                  onClick={onDownload}
                >
                  {downloaded ? '已下载' : '下载 .svg'}
                </Button>
              </div>
            </div>

            {/* A read-only textarea rather than a syntax-highlighted block: it is
                selectable and copyable in one gesture, and at a few hundred
                lines highlighting would cost more than it explains. */}
            <div className={styles.codeScroll}>
              <pre className={styles.code}>{result.svg}</pre>
            </div>

            <div className={styles.codeHeader}>
              <Text as="h2" size={300} weight="semibold">
                Data URL
              </Text>
              <Button
                size="small"
                icon={copied === 'data' ? <CheckmarkRegular /> : <CopyRegular />}
                onClick={() => onCopy('data', result.dataUrl)}
              >
                {copied === 'data' ? '已复制' : '复制'}
              </Button>
            </div>
            <div className={styles.codeScroll} style={{ maxHeight: '120px' }}>
              <pre className={styles.code}>{result.dataUrl}</pre>
            </div>

            <MessageBar intent="info">
              <MessageBarBody>
                <MessageBarTitle>为什么是百分号编码而不是 base64</MessageBarTitle>
                Data URL 用 <code>encodeURIComponent</code> 逐字符编码成 UTF-8 百分号形式。若不编码，
                第一个颜色里的 <code>#</code> 会被当作 URL 片段起点，把后面整段标记截掉；
                base64 则无法直接编码中文标题（需要手工 UTF-8 预处理），而且会把以 ASCII
                为主的标记文档撑大约三分之一。直接放进 <code>&lt;img src&gt;</code>
                或 CSS <code>background-image</code> 即可。
              </MessageBarBody>
            </MessageBar>

            <div className={styles.meta}>
              <ImageRegular />
              <Caption1 className={styles.hint}>
                提示：把宽高、文字与字号做成一致的取值，同一套页面里的占位图看起来就是一套的。
              </Caption1>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
