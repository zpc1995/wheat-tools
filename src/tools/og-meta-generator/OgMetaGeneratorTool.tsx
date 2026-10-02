/**
 * The Open Graph / social card tag generator UI.
 *
 * Everything that can be decided without a browser lives in `ogMetaUtils.ts`:
 * validation, tag building, escaping and the preview model. This file only
 * turns that into a form, a code block and two approximations of the cards a
 * social network would draw.
 *
 * Why the preview is built from CSS boxes rather than from the real image:
 * fetching the image to measure it is exactly the network dependency the tool
 * promises not to have. The card chrome (rounded frame, uppercase host line,
 * title/description stacking, 1.91:1 media area) is what makes the preview
 * useful, so it is drawn locally. The image itself is only *attempted*: if the
 * URL points somewhere unreachable the box falls back to a neutral placeholder
 * instead of leaving a broken-image icon, which is what a real client shows too.
 */
import {
  Badge,
  Button,
  Caption1,
  Dropdown,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  Text,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowCounterclockwise16Regular,
  Checkmark16Regular,
  ClipboardCode16Regular,
  Copy16Regular,
  Globe16Regular,
  Image16Regular,
  Link16Regular,
  TextBulletListSquare16Regular,
} from '@fluentui/react-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { copyText } from '../json-formatter/jsonUtils';
import {
  CARD_TYPES,
  DEFAULT_INPUT,
  OG_TYPES,
  RECOMMENDED_SIZES,
  buildCopyableHtml,
  buildMetaTags,
  previewModel,
  validateImageSize,
  type OgInput,
  type TwitterCardType,
} from './ogMetaUtils';

/**
 * Every field except the card type holds free text, so the single-field helper
 * can be typed on this subset. Without the exclusion the setter would have to
 * accept the card-type union and every keystroke would need a cast.
 */
type TextFieldKey = Exclude<keyof OgInput, 'twitterCard'>;

/** Human-readable names for the fields validation can complain about. */
const FIELD_LABELS: Record<string, string> = {
  title: '标题（og:title）',
  description: '描述（og:description）',
  url: '页面 URL（og:url）',
  canonical: 'canonical 链接',
  image: '分享图（og:image）',
  imageAlt: '图片替代文字（og:image:alt）',
  type: '类型（og:type）',
  twitterTitle: 'Twitter 标题',
  twitterDescription: 'Twitter 描述',
  twitterImage: 'Twitter 图片',
  playerUrl: '播放器地址（twitter:player）',
  playerWidth: '播放器宽度',
  playerHeight: '播放器高度',
  app: '移动应用平台',
  appNameiphone: 'iPhone 应用名称',
  appIdiphone: 'iPhone 应用 id',
  appUrliphone: 'iPhone 应用链接',
  appNameipad: 'iPad 应用名称',
  appIdipad: 'iPad 应用 id',
  appUrlipad: 'iPad 应用链接',
  appNamegoogleplay: 'Google Play 应用名称',
  appIdgoogleplay: 'Google Play 应用 id',
  appUrlgoogleplay: 'Google Play 应用链接',
  imageSize: '图片尺寸',
};

/** The fields Open Graph itself requires, shown as a checklist. */
const REQUIRED_FIELDS: Array<{ key: TextFieldKey; label: string }> = [
  { key: 'title', label: '标题 og:title' },
  { key: 'url', label: '页面 URL og:url' },
  { key: 'image', label: '分享图 og:image' },
  { key: 'type', label: '类型 og:type' },
];

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    minWidth: 0,
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '14px 16px',
    minWidth: 0,
  },
  form: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: '12px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: 0,
  },
  wide: {
    gridColumn: '1 / -1',
  },
  label: {
    color: tokens.colorNeutralForeground3,
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px 12px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  checklist: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px 10px',
  },
  issues: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    margin: 0,
    paddingLeft: '20px',
  },
  subSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '12px 14px',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  previewCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minWidth: 0,
    padding: '14px',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  previewChrome: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: tokens.colorNeutralForeground3,
    minWidth: 0,
  },
  media: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground4,
    overflow: 'hidden',
  },
  mediaLarge: {
    height: '190px',
  },
  mediaSquare: {
    width: '120px',
    height: '120px',
    flex: '0 0 auto',
    borderRadius: tokens.borderRadiusMedium,
  },
  mediaImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  ogCard: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow4,
    minWidth: 0,
  },
  xCard: {
    display: 'flex',
    overflow: 'hidden',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '16px',
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow4,
    minWidth: 0,
  },
  xCardColumn: {
    flexDirection: 'column',
  },
  xCardRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  cardBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '10px 12px 12px',
    minWidth: 0,
  },
  host: {
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    overflowWrap: 'anywhere',
  },
  cardTitle: {
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
    overflowWrap: 'anywhere',
  },
  cardDescription: {
    color: tokens.colorNeutralForeground3,
    overflowWrap: 'anywhere',
  },
  sizeRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '10px 12px',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  sizeHead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
  },
});

/**
 * The media area of a preview card.
 *
 * The image is attempted, not required: a URL that cannot be loaded (offline,
 * hotlink protection, wrong path) swaps in a neutral placeholder. Tracking the
 * failure in state is why this is a component rather than inline JSX; the
 * effect clears the flag when the URL changes so a corrected URL gets a retry.
 */
function PreviewMedia({ src, alt, square }: { src: string; alt: string; square: boolean }) {
  const styles = useStyles();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const className = square
    ? mergeClasses(styles.media, styles.mediaSquare)
    : mergeClasses(styles.media, styles.mediaLarge);

  return (
    <div className={className}>
      {src !== '' && !failed ? (
        <img className={styles.mediaImage} src={src} alt={alt} onError={() => setFailed(true)} />
      ) : (
        <>
          <Image16Regular />
          <Caption1 className={styles.hint}>
            {src === '' ? '未提供图片' : '图片无法加载，这里显示占位块'}
          </Caption1>
        </>
      )}
    </div>
  );
}

export function OgMetaGeneratorTool() {
  const styles = useStyles();

  const [input, setInput] = useState<OgInput>({ ...DEFAULT_INPUT });
  const [copied, setCopied] = useState(false);

  const set = useCallback(<K extends keyof OgInput>(key: K, value: OgInput[K]) => {
    setInput((previous) => ({ ...previous, [key]: value }));
  }, []);

  const result = useMemo(() => buildMetaTags(input), [input]);
  const copyable = useMemo(() => buildCopyableHtml(input), [input]);
  const model = useMemo(() => previewModel(input), [input]);
  const advice = useMemo(() => validateImageSize(input), [input]);

  const nonSizeWarnings = result.warnings.filter((issue) => issue.field !== 'imageSize');
  const hasSizeWarning = result.warnings.some((issue) => issue.field === 'imageSize');

  const copy = useCallback(async () => {
    const ok = await copyText(copyable);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }, [copyable]);

  const card = CARD_TYPES.find((item) => item.value === input.twitterCard);
  const imageWidth = input.imageWidth.trim();
  const imageHeight = input.imageHeight.trim();
  const dimensions = imageWidth !== '' && imageHeight !== '' ? `${imageWidth} × ${imageHeight}` : '未填写宽高';

  /** One line of the form. Free-text fields all share this shape. */
  const textInput = (key: TextFieldKey, label: string, hint?: string) => (
    <label className={styles.field}>
      <Text size={200} weight="semibold" className={styles.label}>
        {label}
      </Text>
      <input
        className="wt-inline-input"
        value={input[key]}
        onChange={(event) => set(key, event.target.value)}
        aria-label={label}
        spellCheck={false}
        autoComplete="off"
      />
      {hint ? <Caption1 className={styles.hint}>{hint}</Caption1> : null}
    </label>
  );

  /** A textarea for the two long text fields. */
  const textArea = (key: TextFieldKey, label: string, hint: string) => (
    <label className={mergeClasses(styles.field, styles.wide)}>
      <Text size={200} weight="semibold" className={styles.label}>
        {label}
      </Text>
      <textarea
        className="wt-code-area"
        style={{ minHeight: '72px', maxHeight: '160px' }}
        value={input[key]}
        onChange={(event) => set(key, event.target.value)}
        aria-label={label}
        spellCheck={false}
      />
      <Caption1 className={styles.hint}>{hint}</Caption1>
    </label>
  );

  /** A dropdown for the two enumerated fields. */
  const dropdown = (
    label: string,
    value: string,
    options: Array<{ value: string; label: string }>,
    onSelect: (option: string) => void,
    hint?: string,
  ) => (
    <div className={styles.field}>
      <Text size={200} weight="semibold" className={styles.label}>
        {label}
      </Text>
      <Dropdown
        value={options.find((item) => item.value === value)?.label ?? value}
        selectedOptions={[value]}
        onOptionSelect={(_, data) => {
          if (data.optionValue) onSelect(data.optionValue);
        }}
        aria-label={label}
      >
        {options.map((item) => (
          <Option key={item.value} value={item.value} text={item.label}>
            {item.label}
          </Option>
        ))}
      </Dropdown>
      {hint ? <Caption1 className={styles.hint}>{hint}</Caption1> : null}
    </div>
  );

  return (
    <div className={styles.stack}>
      <MessageBar intent="info">
        <MessageBarBody>
          <MessageBarTitle>它生成标签，不抓取网页</MessageBarTitle>
          填好内容后，这里会给出可直接粘贴进 <code>head</code> 的 Open Graph、Twitter Card 与基础
          SEO 标签。所有输出都在本地拼装并转义（引号、尖括号、&amp; 都会变成实体），
          不请求目标页面，也不下载图片——图片宽高需要你自己填，预览卡片是按你填的内容近似画出来的。
        </MessageBarBody>
      </MessageBar>

      {/* ---------------------------------------------------------- */}
      {/* 1. The form                                                */}
      {/* ---------------------------------------------------------- */}
      <section className="wt-surface" aria-label="页面信息">
        <div className="wt-surface__header">
          <TextBulletListSquare16Regular />
          <Text as="h2" size={300} weight="semibold">
            页面信息
          </Text>
          <span className={styles.spacer} />
          <div className={styles.toolbar}>
            <Badge appearance="tint" color={result.ok ? 'success' : 'danger'} size="small">
              {result.ok ? '必填项已齐全' : `还缺 ${result.errors.length} 项`}
            </Badge>
            <Tooltip content="恢复为示例内容" relationship="label" withArrow>
              <Button
                appearance="subtle"
                size="small"
                icon={<ArrowCounterclockwise16Regular />}
                onClick={() => setInput({ ...DEFAULT_INPUT })}
                aria-label="重置为示例内容"
              >
                重置
              </Button>
            </Tooltip>
          </div>
        </div>

        <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
          <div className={styles.body}>
            <div className={styles.form}>
              {textInput('title', '标题（og:title）', '卡片的主文案，必填。')}
              {textInput('url', '页面 URL（og:url）', '必须是含协议与域名的绝对地址。')}
              {textInput('image', '分享图 URL（og:image）', 'Open Graph 要求提供，建议 1200 × 630。')}
              {textInput('imageAlt', '图片替代文字（og:image:alt）', '为看不到图片的用户描述图片内容。')}
              {textInput('imageWidth', '图片宽度（像素）', '只填数字，用于 og:image:width 与比例校验。')}
              {textInput('imageHeight', '图片高度（像素）', '只填数字，用于 og:image:height 与比例校验。')}
              {textInput('siteName', '站点名（og:site_name）', '例如「Wheat Tools」。')}
              {dropdown(
                '类型（og:type）',
                input.type,
                OG_TYPES.map((value) => ({ value, label: value })),
                (option) => set('type', option),
                '普通页面用 website，文章用 article。',
              )}
              {textInput('locale', '语言（og:locale）', '形如 zh_CN；Facebook 用下划线而非短横线。')}
              {textInput('localeAlternates', '备用语言（og:locale:alternate）', '多个用逗号或换行分隔。')}
              {textInput('canonical', 'canonical 链接（可选）', '留空时自动使用上面的页面 URL。')}
              {textInput('themeColor', '主题色 theme-color（可选）', '形如 #0f6cbd。')}
              {textInput('fbAppId', 'Facebook 应用 id（可选）', '只在使用 Facebook 统计时填写。')}
              {textArea('description', '描述（og:description）', '卡片上的摘要文案，留空只是警告，不影响标签生成。')}
            </div>

            <div className={styles.subSection}>
              <Text size={300} weight="semibold">
                Twitter / X 卡片
              </Text>
              <div className={styles.form}>
                {dropdown(
                  '卡片类型（twitter:card）',
                  input.twitterCard,
                  CARD_TYPES.map((item) => ({ value: item.value, label: item.label })),
                  (option) => set('twitterCard', option as TwitterCardType),
                  card?.note,
                )}
                {textInput('twitterSite', '站点账号（twitter:site）', '例如 @wheattools。')}
                {textInput('twitterCreator', '作者账号（twitter:creator）', '例如 @wheet。')}
                {textInput('twitterTitle', 'Twitter 专属标题（可选）', '留空时回退到 og:title。')}
                {textInput('twitterImage', 'Twitter 专属图片（可选）', '留空时回退到 og:image。')}
                {textInput('twitterImageAlt', 'Twitter 图片替代文字（可选）', '留空时回退到 og:image:alt。')}
                {textArea('twitterDescription', 'Twitter 专属描述（可选）', '留空时回退到 og:description。')}
              </div>
            </div>

            {input.twitterCard === 'player' ? (
              <div className={styles.subSection}>
                <Text size={300} weight="semibold">
                  播放器（player 卡片必填）
                </Text>
                <div className={styles.form}>
                  {textInput('playerUrl', '播放器地址（twitter:player）', '必须是 HTTPS 的绝对地址。')}
                  {textInput('playerWidth', '播放器宽度（像素）', '正整数。')}
                  {textInput('playerHeight', '播放器高度（像素）', '正整数。')}
                  {textInput('playerStream', '流地址（twitter:player:stream，可选）', '音视频文件的直链。')}
                </div>
              </div>
            ) : null}

            {input.twitterCard === 'app' ? (
              <div className={styles.subSection}>
                <Text size={300} weight="semibold">
                  移动应用（app 卡片必填）
                </Text>
                <Caption1 className={styles.hint}>
                  至少完整填写一个平台：名称加上 id 或链接至少一项。
                </Caption1>
                <div className={styles.form}>
                  {textInput('appNameIphone', 'iPhone 应用名称', 'twitter:app:name:iphone')}
                  {textInput('appIdIphone', 'iPhone 应用 id', '通常是纯数字。')}
                  {textInput('appUrlIphone', 'iPhone 应用链接（可选）', '例如自定义 scheme 或商店地址。')}
                  {textInput('appNameIpad', 'iPad 应用名称', 'twitter:app:name:ipad')}
                  {textInput('appIdIpad', 'iPad 应用 id', '通常是纯数字。')}
                  {textInput('appUrlIpad', 'iPad 应用链接（可选）', '')}
                  {textInput('appNameGoogleplay', 'Google Play 应用名称', 'twitter:app:name:googleplay')}
                  {textInput('appIdGoogleplay', 'Google Play 应用 id', '通常是纯数字。')}
                  {textInput('appUrlGoogleplay', 'Google Play 应用链接（可选）', '通常是商店页面地址。')}
                  {textInput('appCountry', '应用国家（twitter:app:country，可选）', '例如 US。')}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- */}
      {/* 2. Generated tags, missing-field hints and the copy button  */}
      {/* ---------------------------------------------------------- */}
      <section className="wt-surface" aria-label="生成的标签">
        <div className="wt-surface__header">
          <ClipboardCode16Regular />
          <Text as="h2" size={300} weight="semibold">
            生成的标签
          </Text>
          <span className={styles.spacer} />
          <div className={styles.toolbar}>
            <Badge appearance="tint" color="informative" size="small">
              {`${result.tags.length} 个标签`}
            </Badge>
            <Tooltip content="复制全部标签" relationship="label" withArrow>
              <Button
                appearance="primary"
                size="small"
                icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
                onClick={copy}
                aria-label="复制生成的标签"
              >
                {copied ? '已复制' : '复制'}
              </Button>
            </Tooltip>
          </div>
        </div>

        <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
          <div className={styles.body}>
            <div className={styles.checklist}>
              {REQUIRED_FIELDS.map((field) => {
                const filled = input[field.key].trim() !== '';
                return (
                  <Badge
                    key={field.key}
                    appearance="tint"
                    color={filled ? 'success' : 'danger'}
                    size="small"
                  >
                    {`${filled ? '已填' : '缺'} ${field.label}`}
                  </Badge>
                );
              })}
            </div>

            {result.errors.length > 0 ? (
              <MessageBar intent="error">
                <MessageBarBody>
                  <MessageBarTitle>{`有 ${result.errors.length} 处必须先修正`}</MessageBarTitle>
                  <ul className={styles.issues}>
                    {result.errors.map((issue) => (
                      <li key={`${issue.field}-${issue.message}`}>
                        <strong>{FIELD_LABELS[issue.field] ?? issue.field}</strong>：{issue.message}
                      </li>
                    ))}
                  </ul>
                </MessageBarBody>
              </MessageBar>
            ) : (
              <MessageBar intent="success">
                <MessageBarBody>
                  <MessageBarTitle>必填项已齐全</MessageBarTitle>
                  下面的标签可以直接粘贴进页面 head。
                </MessageBarBody>
              </MessageBar>
            )}

            {nonSizeWarnings.length > 0 ? (
              <MessageBar intent="warning">
                <MessageBarBody>
                  <MessageBarTitle>{`${nonSizeWarnings.length} 条建议`}</MessageBarTitle>
                  <ul className={styles.issues}>
                    {nonSizeWarnings.map((issue) => (
                      <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>
                    ))}
                  </ul>
                </MessageBarBody>
              </MessageBar>
            ) : null}

            {hasSizeWarning ? (
              <MessageBar intent="warning">
                <MessageBarBody>图片尺寸问题单独列在下方「图片尺寸建议」里。</MessageBarBody>
              </MessageBar>
            ) : null}
          </div>

          <textarea
            className="wt-code-area"
            style={{ minHeight: '220px', maxHeight: '460px' }}
            value={copyable}
            readOnly
            aria-label="生成的 meta 标签代码"
            spellCheck={false}
          />
        </div>
      </section>

      {/* ---------------------------------------------------------- */}
      {/* 3. Preview cards drawn with CSS                             */}
      {/* ---------------------------------------------------------- */}
      <section className="wt-surface" aria-label="社交卡片预览">
        <div className="wt-surface__header">
          <Globe16Regular />
          <Text as="h2" size={300} weight="semibold">
            社交卡片预览
          </Text>
          <span className={styles.spacer} />
          <Caption1 className={styles.hint}>
            <Link16Regular /> {model.host}
          </Caption1>
        </div>

        <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
          <div className={styles.body}>
            <div className="wt-split">
              <div className={styles.previewCard}>
                <div className={styles.previewChrome}>
                  <Globe16Regular />
                  <Text size={200} weight="semibold">
                    Facebook / Open Graph
                  </Text>
                </div>
                <div className={styles.ogCard}>
                  <PreviewMedia src={input.image.trim()} alt={input.imageAlt.trim()} square={false} />
                  <div className={styles.cardBody}>
                    <Caption1 className={styles.host}>{model.hostLabel}</Caption1>
                    <Text className={styles.cardTitle}>
                      {input.title.trim() === '' ? '（未填写标题）' : input.title.trim()}
                    </Text>
                    <Caption1 className={styles.cardDescription}>
                      {input.description.trim() === '' ? '（未填写描述）' : input.description.trim()}
                    </Caption1>
                  </div>
                </div>
                <Caption1 className={styles.hint}>
                  媒体区按 1.91:1 近似；实际裁切由各平台决定。
                </Caption1>
              </div>

              <div className={styles.previewCard}>
                <div className={styles.previewChrome}>
                  <Globe16Regular />
                  <Text size={200} weight="semibold">
                    Twitter / X
                  </Text>
                  <span className={styles.spacer} />
                  <Badge appearance="tint" color="informative" size="small">
                    {input.twitterCard}
                  </Badge>
                </div>
                <div
                  className={mergeClasses(
                    styles.xCard,
                    input.twitterCard === 'summary' || input.twitterCard === 'app'
                      ? styles.xCardRow
                      : styles.xCardColumn,
                  )}
                >
                  <PreviewMedia
                    src={model.image}
                    alt={input.twitterImageAlt.trim() || input.imageAlt.trim() || model.title}
                    square={input.twitterCard === 'summary' || input.twitterCard === 'app'}
                  />
                  <div className={styles.cardBody}>
                    <Text className={styles.cardTitle}>{model.title}</Text>
                    <Caption1 className={styles.cardDescription}>{model.description}</Caption1>
                    <Caption1 className={styles.host}>
                      {model.site === '' ? model.hostLabel : `@${model.site}${model.creator === '' ? '' : ` · @${model.creator}`}`}
                    </Caption1>
                  </div>
                </div>
                <Caption1 className={styles.hint}>{card?.note}</Caption1>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- */}
      {/* 4. Image size advice                                        */}
      {/* ---------------------------------------------------------- */}
      <section className="wt-surface" aria-label="图片尺寸建议">
        <div className="wt-surface__header">
          <Image16Regular />
          <Text as="h2" size={300} weight="semibold">
            图片尺寸建议
          </Text>
          <span className={styles.spacer} />
          <Caption1 className={mergeClasses(styles.hint, styles.mono)}>{dimensions}</Caption1>
        </div>

        <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
          <div className={styles.body}>
            <MessageBar intent={advice.level === 'ok' ? 'success' : 'warning'}>
              <MessageBarBody>
                <ul className={styles.issues}>
                  {advice.messages.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </MessageBarBody>
            </MessageBar>

            {RECOMMENDED_SIZES.map((row) => (
              <div key={row.context} className={styles.sizeRow}>
                <div className={styles.sizeHead}>
                  <Text size={300} weight="semibold">
                    {row.context}
                  </Text>
                  <Badge appearance="tint" color="informative" size="small">
                    {row.size}
                  </Badge>
                  <Caption1 className={styles.hint}>{row.ratio}</Caption1>
                </div>
                <Caption1 className={styles.hint}>{row.note}</Caption1>
              </div>
            ))}

            <Caption1 className={styles.hint}>
              只做算术校验：本工具既不下拉图片，也不读取它的真实像素，所以这里比的是你填写的宽高。
            </Caption1>
          </div>
        </div>
      </section>
    </div>
  );
}
