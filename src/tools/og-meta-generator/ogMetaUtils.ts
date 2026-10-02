/**
 * Open Graph / Twitter Card tag generation.
 *
 * ## Why escaping is not optional here
 *
 * Every generated tag puts user text inside a double-quoted attribute:
 *
 *   <meta property="og:title" content="..." />
 *
 * A title containing a double quote ends the attribute early; whatever follows
 * is then parsed as further attributes, so `<script>`-style payloads can escape
 * the tag entirely. That is not a theoretical concern: page titles and
 * descriptions are exactly the fields people fill in from a CMS, and a preview
 * generator that emits broken markup teaches the wrong thing. Every value goes
 * through `escapeHtml` before it is interpolated, and the check script parses
 * the output back with an independent HTML parser to prove the round trip.
 *
 * ## What this deliberately does not do
 *
 * It never fetches the target page or the image. Reading the real metadata needs
 * a network request and, in a browser, a CORS-permitted response; measuring an
 * image's intrinsic size needs the image fetched as well. Both are out of scope,
 * so the tool asks for the dimensions instead of pretending to know them.
 *
 * Pure logic: no React, no DOM, no clock, no randomness. `URL` is a global in
 * both the browser and Node.
 */

export type TwitterCardType = 'summary' | 'summary_large_image' | 'player' | 'app';

export interface OgInput {
  title: string;
  description: string;
  url: string;
  canonical: string;
  image: string;
  imageAlt: string;
  imageWidth: string;
  imageHeight: string;
  siteName: string;
  type: string;
  locale: string;
  localeAlternates: string;
  themeColor: string;
  fbAppId: string;
  twitterCard: TwitterCardType;
  twitterSite: string;
  twitterCreator: string;
  twitterTitle: string;
  twitterDescription: string;
  twitterImage: string;
  twitterImageAlt: string;
  playerUrl: string;
  playerWidth: string;
  playerHeight: string;
  playerStream: string;
  appNameIphone: string;
  appIdIphone: string;
  appUrlIphone: string;
  appNameIpad: string;
  appIdIpad: string;
  appUrlIpad: string;
  appNameGoogleplay: string;
  appIdGoogleplay: string;
  appUrlGoogleplay: string;
  appCountry: string;
}

export const DEFAULT_INPUT: OgInput = {
  title: 'Wheat Tools — 一组小巧的网页工具',
  description: '秒表、URL 分析器、二维码、哈希……每个工具都只做一件事，且都在本地运行，不上传你的数据。',
  url: 'https://tools.example.com/?ref=home&from=og',
  canonical: '',
  image: 'https://tools.example.com/preview.png?v=2&size=large',
  imageAlt: 'Wheat Tools 的工具列表界面',
  imageWidth: '1200',
  imageHeight: '630',
  siteName: 'Wheat Tools',
  type: 'website',
  locale: 'zh_CN',
  localeAlternates: 'en_US',
  themeColor: '#0f6cbd',
  fbAppId: '',
  twitterCard: 'summary_large_image',
  twitterSite: '@wheattools',
  twitterCreator: '@wheet',
  twitterTitle: '',
  twitterDescription: '',
  twitterImage: '',
  twitterImageAlt: '',
  playerUrl: '',
  playerWidth: '',
  playerHeight: '',
  playerStream: '',
  appNameIphone: '',
  appIdIphone: '',
  appUrlIphone: '',
  appNameIpad: '',
  appIdIpad: '',
  appUrlIpad: '',
  appNameGoogleplay: '',
  appIdGoogleplay: '',
  appUrlGoogleplay: '',
  appCountry: '',
};

export const CARD_TYPES: Array<{ value: TwitterCardType; label: string; note: string }> = [
  { value: 'summary', label: 'summary（小图卡片）', note: '左侧方形缩略图 + 标题描述，图片建议 1:1。' },
  { value: 'summary_large_image', label: 'summary_large_image（大图卡片）', note: '整幅大图在上方，图片建议 1200 × 628（约 1.91:1）。' },
  { value: 'player', label: 'player（音视频播放器）', note: '需要 twitter:player 与宽高，且必须是 HTTPS 的 iframe 地址。' },
  { value: 'app', label: 'app（移动应用卡片）', note: '至少填写一个平台的名称，以及 id 或 url。' },
];

export const OG_TYPES: string[] = [
  'website',
  'article',
  'product',
  'profile',
  'book',
  'music.album',
  'music.playlist',
  'video.movie',
  'video.episode',
  'video.other',
];

export const RECOMMENDED_SIZES: Array<{ context: string; size: string; ratio: string; note: string }> = [
  {
    context: 'Open Graph（Facebook / LinkedIn / 微信等）',
    size: '1200 × 630',
    ratio: '1.91:1',
    note: '低于 200 × 200 多数平台不会展示大图；1.91:1 是各平台裁切的交集。',
  },
  {
    context: 'Twitter summary_large_image',
    size: '1200 × 628',
    ratio: '约 1.91:1',
    note: '官方建议 1200 × 628，文件小于 5 MB；宽高比偏离太多会被裁切。',
  },
  {
    context: 'Twitter summary',
    size: '最小 144 × 144',
    ratio: '1:1',
    note: '方形缩略图，非正方形会被居中裁切。',
  },
];

export interface MetaTag {
  group: 'seo' | 'og' | 'twitter' | 'facebook';
  /** The attribute that carries the key: `property` for OG, `name` for the rest. */
  attr: 'name' | 'property' | null;
  key: string;
  content: string;
  /** The fully serialised, escaped line. */
  line: string;
}

export interface MetaIssue {
  field: string;
  message: string;
}

export interface MetaBuildResult {
  ok: boolean;
  tags: MetaTag[];
  html: string;
  errors: MetaIssue[];
  warnings: MetaIssue[];
}

/** Escapes text for both element content and double-quoted attribute values. */
export function escapeHtml(value: string): string {
  // `&` first, otherwise the ampersands introduced by the later replacements
  // would themselves be escaped a second time.
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A `meta` tag with a double-quoted attribute, always self-closed. */
function metaTag(group: MetaTag['group'], attr: 'name' | 'property', key: string, content: string): MetaTag {
  return {
    group,
    attr,
    key,
    content,
    line: `<meta ${attr}="${key}" content="${escapeHtml(content)}" />`,
  };
}

function linkTag(rel: string, href: string): MetaTag {
  return {
    group: 'seo',
    attr: null,
    key: rel,
    content: href,
    line: `<link rel="${rel}" href="${escapeHtml(href)}" />`,
  };
}

function titleTag(title: string): MetaTag {
  return {
    group: 'seo',
    attr: null,
    key: 'title',
    content: title,
    line: `<title>${escapeHtml(title)}</title>`,
  };
}

function parseDimension(value: string): number | null {
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return parsed > 0 ? parsed : null;
}

/** Whether a string is an absolute URL the platform accepts. */
export function isAbsoluteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol !== '' && parsed.host !== '';
  } catch {
    return false;
  }
}

export interface ImageAdvice {
  level: 'ok' | 'warning';
  messages: string[];
}

/**
 * Aspect-ratio and minimum-size advice.
 *
 * The recommended ratios are 1.91:1 for large cards and 1:1 for the small
 * summary card. A tolerance band is used rather than a single accepted value,
 * because 1200 × 630 (1.905) and 1200 × 628 (1.911) are both "correct" and a
 * strict equality check would reject one of the two official recommendations.
 */
export function validateImageSize(input: OgInput): ImageAdvice {
  const width = parseDimension(input.imageWidth);
  const height = parseDimension(input.imageHeight);
  const messages: string[] = [];
  let level: 'ok' | 'warning' = 'ok';

  if (width === null && height === null) {
    messages.push('未填写图片宽高：无法校验比例与最小尺寸，请自行确认图片符合下方建议。');
    return { level: 'warning', messages };
  }

  if (width === null || height === null) {
    messages.push('只填写了宽或高其中一项：需要两者都填才能计算宽高比。');
    return { level: 'warning', messages };
  }

  const ratio = width / height;
  const square = input.twitterCard === 'summary';

  if (square) {
    if (ratio < 0.95 || ratio > 1.05) {
      level = 'warning';
      messages.push(`summary 卡片建议 1:1 正方形，当前宽高比为 ${ratio.toFixed(2)}:1（${width} × ${height}），平台会居中裁切。`);
    }
    if (width < 144 || height < 144) {
      level = 'warning';
      messages.push(`summary 卡片图片最小 144 × 144，当前 ${width} × ${height} 偏小，可能不被展示。`);
    }
  } else {
    if (ratio < 1.85 || ratio > 1.97) {
      level = 'warning';
      messages.push(`大图卡片建议约 1.91:1（1200 × 630 或 1200 × 628），当前宽高比为 ${ratio.toFixed(2)}:1（${width} × ${height}），可能被裁切或留白。`);
    }
    if (width < 600 || height < 315) {
      level = 'warning';
      messages.push(`大图卡片建议至少 600 × 315，当前 ${width} × ${height} 偏小。`);
    }
  }

  if (messages.length === 0) {
    messages.push(`尺寸 ${width} × ${height}（宽高比 ${ratio.toFixed(2)}:1）符合当前卡片类型的建议。`);
  }

  return { level, messages };
}

/** Splits the comma / newline separated alternate-locale field. */
export function parseLocaleAlternates(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

interface AppPlatform {
  key: 'iphone' | 'ipad' | 'googleplay';
  label: string;
  name: string;
  id: string;
  url: string;
}

function appPlatforms(input: OgInput): AppPlatform[] {
  return [
    { key: 'iphone', label: 'iPhone', name: input.appNameIphone, id: input.appIdIphone, url: input.appUrlIphone },
    { key: 'ipad', label: 'iPad', name: input.appNameIpad, id: input.appIdIpad, url: input.appUrlIpad },
    { key: 'googleplay', label: 'Google Play', name: input.appNameGoogleplay, id: input.appIdGoogleplay, url: input.appUrlGoogleplay },
  ];
}

/**
 * Builds the tag list.
 *
 * Validation is part of the build rather than a separate pass so the rendered
 * output, the copied HTML and the on-screen error list can never disagree about
 * what was generated.
 */
export function buildMetaTags(input: OgInput): MetaBuildResult {
  const errors: MetaIssue[] = [];
  const warnings: MetaIssue[] = [];

  const title = input.title.trim();
  const description = input.description.trim();
  const url = input.url.trim();
  const canonical = input.canonical.trim() === '' ? url : input.canonical.trim();
  const image = input.image.trim();
  const imageAlt = input.imageAlt.trim();
  const type = input.type.trim();
  const locale = input.locale.trim();
  const siteName = input.siteName.trim();
  const twitterTitle = input.twitterTitle.trim() === '' ? title : input.twitterTitle.trim();
  const twitterDescription = input.twitterDescription.trim() === '' ? description : input.twitterDescription.trim();
  const twitterImage = input.twitterImage.trim() === '' ? image : input.twitterImage.trim();
  const twitterImageAlt = input.twitterImageAlt.trim() === '' ? imageAlt : input.twitterImageAlt.trim();

  const require_ = (value: string, field: string, message: string) => {
    if (value === '') errors.push({ field, message });
  };

  require_(title, 'title', '缺少标题（og:title）——这是卡片的主文案，必填。');
  require_(url, 'url', '缺少页面 URL（og:url）。');
  require_(image, 'image', '缺少分享图（og:image）——Open Graph 协议要求提供。');
  require_(type, 'type', '缺少类型（og:type），通常填 website 或 article。');
  if (description === '') warnings.push({ field: 'description', message: '未填写描述（og:description），卡片会缺少摘要文案。' });

  if (url !== '' && !isAbsoluteUrl(url)) {
    errors.push({ field: 'url', message: `og:url 不是合法的绝对 URL：${url}` });
  }
  if (canonical !== '' && !isAbsoluteUrl(canonical)) {
    errors.push({ field: 'canonical', message: `canonical 不是合法的绝对 URL：${canonical}` });
  }
  if (image !== '' && !isAbsoluteUrl(image)) {
    errors.push({ field: 'image', message: `og:image 不是合法的绝对 URL：${image}` });
  }
  if (image !== '' && imageAlt === '') {
    warnings.push({ field: 'imageAlt', message: '建议填写 og:image:alt，为看不到图片的用户描述图片内容。' });
  }

  // --- per-card-type requirements -----------------------------------
  switch (input.twitterCard) {
    case 'summary':
      if (twitterImage === '') warnings.push({ field: 'twitterImage', message: 'summary 卡片未提供图片，将退化为纯文字卡片。' });
      if (twitterTitle === '') warnings.push({ field: 'twitterTitle', message: 'summary 卡片缺少标题。' });
      if (twitterDescription === '') warnings.push({ field: 'twitterDescription', message: 'summary 卡片缺少描述。' });
      break;
    case 'summary_large_image':
      if (twitterImage === '') {
        errors.push({ field: 'twitterImage', message: 'summary_large_image 卡片必须提供图片（twitter:image）。' });
      }
      if (twitterTitle === '') warnings.push({ field: 'twitterTitle', message: '大图卡片缺少标题。' });
      if (twitterDescription === '') warnings.push({ field: 'twitterDescription', message: '大图卡片缺少描述。' });
      break;
    case 'player': {
      const playerUrl = input.playerUrl.trim();
      const playerWidth = parseDimension(input.playerWidth);
      const playerHeight = parseDimension(input.playerHeight);
      if (playerUrl === '') errors.push({ field: 'playerUrl', message: 'player 卡片必须提供 twitter:player 播放器地址。' });
      else if (!isAbsoluteUrl(playerUrl)) errors.push({ field: 'playerUrl', message: `twitter:player 不是合法的绝对 URL：${playerUrl}` });
      else if (!playerUrl.toLowerCase().startsWith('https://')) {
        errors.push({ field: 'playerUrl', message: 'twitter:player 必须是 HTTPS 地址，否则卡片会被拒绝。' });
      }
      if (playerWidth === null) errors.push({ field: 'playerWidth', message: 'player 卡片必须提供 twitter:player:width（正整数像素）。' });
      if (playerHeight === null) errors.push({ field: 'playerHeight', message: 'player 卡片必须提供 twitter:player:height（正整数像素）。' });
      if (twitterImage === '') errors.push({ field: 'twitterImage', message: 'player 卡片必须提供 twitter:image 作为封面。' });
      break;
    }
    case 'app': {
      const platforms = appPlatforms(input);
      const touched = platforms.filter((platform) => platform.name.trim() !== '' || platform.id.trim() !== '' || platform.url.trim() !== '');
      if (touched.length === 0) {
        errors.push({
          field: 'app',
          message: 'app 卡片必须至少指定一个平台（iPhone、iPad 或 Google Play），并填写名称与 id 或 url。',
        });
      }
      for (const platform of touched) {
        if (platform.name.trim() === '') {
          errors.push({ field: `appName${platform.key}`, message: `${platform.label} 平台缺少应用名称（twitter:app:name:${platform.key}）。` });
        }
        if (platform.id.trim() === '' && platform.url.trim() === '') {
          errors.push({
            field: `appId${platform.key}`,
            message: `${platform.label} 平台需要 twitter:app:id:${platform.key} 或 twitter:app:url:${platform.key} 至少一项。`,
          });
        }
        if (platform.id.trim() !== '' && !/^[0-9]+$/.test(platform.id.trim())) {
          warnings.push({ field: `appId${platform.key}`, message: `${platform.label} 的应用 id 通常是纯数字。` });
        }
        if (platform.url.trim() !== '' && !isAbsoluteUrl(platform.url.trim())) {
          errors.push({ field: `appUrl${platform.key}`, message: `${platform.label} 的应用链接不是合法的绝对 URL。` });
        }
      }
      if (twitterImage === '') warnings.push({ field: 'twitterImage', message: 'app 卡片未提供图片，卡片会缺少视觉预览。' });
      break;
    }
    default: {
      const exhaustive: never = input.twitterCard;
      void exhaustive;
    }
  }

  // --- tag list ------------------------------------------------------
  const tags: MetaTag[] = [];
  if (title !== '') tags.push(titleTag(title));
  if (description !== '') tags.push(metaTag('seo', 'name', 'description', description));
  if (canonical !== '') tags.push(linkTag('canonical', canonical));
  if (input.themeColor.trim() !== '') tags.push(metaTag('seo', 'name', 'theme-color', input.themeColor.trim()));

  if (title !== '') tags.push(metaTag('og', 'property', 'og:title', title));
  if (description !== '') tags.push(metaTag('og', 'property', 'og:description', description));
  if (url !== '') tags.push(metaTag('og', 'property', 'og:url', url));
  if (image !== '') {
    tags.push(metaTag('og', 'property', 'og:image', image));
    if (imageAlt !== '') tags.push(metaTag('og', 'property', 'og:image:alt', imageAlt));
    const width = parseDimension(input.imageWidth);
    const height = parseDimension(input.imageHeight);
    if (width !== null) tags.push(metaTag('og', 'property', 'og:image:width', String(width)));
    if (height !== null) tags.push(metaTag('og', 'property', 'og:image:height', String(height)));
  }
  if (siteName !== '') tags.push(metaTag('og', 'property', 'og:site_name', siteName));
  if (type !== '') tags.push(metaTag('og', 'property', 'og:type', type));
  if (locale !== '') tags.push(metaTag('og', 'property', 'og:locale', locale));
  for (const alternate of parseLocaleAlternates(input.localeAlternates)) {
    tags.push(metaTag('og', 'property', 'og:locale:alternate', alternate));
  }
  if (input.fbAppId.trim() !== '') tags.push(metaTag('facebook', 'property', 'fb:app_id', input.fbAppId.trim()));

  tags.push(metaTag('twitter', 'name', 'twitter:card', input.twitterCard));
  if (twitterTitle !== '') tags.push(metaTag('twitter', 'name', 'twitter:title', twitterTitle));
  if (twitterDescription !== '') tags.push(metaTag('twitter', 'name', 'twitter:description', twitterDescription));
  if (twitterImage !== '') tags.push(metaTag('twitter', 'name', 'twitter:image', twitterImage));
  if (twitterImageAlt !== '') tags.push(metaTag('twitter', 'name', 'twitter:image:alt', twitterImageAlt));
  if (input.twitterSite.trim() !== '') tags.push(metaTag('twitter', 'name', 'twitter:site', input.twitterSite.trim()));
  if (input.twitterCreator.trim() !== '') tags.push(metaTag('twitter', 'name', 'twitter:creator', input.twitterCreator.trim()));

  if (input.twitterCard === 'player') {
    if (input.playerUrl.trim() !== '') tags.push(metaTag('twitter', 'name', 'twitter:player', input.playerUrl.trim()));
    const width = parseDimension(input.playerWidth);
    const height = parseDimension(input.playerHeight);
    if (width !== null) tags.push(metaTag('twitter', 'name', 'twitter:player:width', String(width)));
    if (height !== null) tags.push(metaTag('twitter', 'name', 'twitter:player:height', String(height)));
    if (input.playerStream.trim() !== '') tags.push(metaTag('twitter', 'name', 'twitter:player:stream', input.playerStream.trim()));
  }

  if (input.twitterCard === 'app') {
    for (const platform of appPlatforms(input)) {
      const suffix = platform.key;
      if (platform.name.trim() !== '') tags.push(metaTag('twitter', 'name', `twitter:app:name:${suffix}`, platform.name.trim()));
      if (platform.id.trim() !== '') tags.push(metaTag('twitter', 'name', `twitter:app:id:${suffix}`, platform.id.trim()));
      if (platform.url.trim() !== '') tags.push(metaTag('twitter', 'name', `twitter:app:url:${suffix}`, platform.url.trim()));
    }
    if (input.appCountry.trim() !== '') tags.push(metaTag('twitter', 'name', 'twitter:app:country', input.appCountry.trim()));
  }

  // Image advice is folded into the shared warning list so the error panel, the
  // preview and the copied HTML all describe the same state.
  const advice = validateImageSize(input);
  for (const message of advice.messages) {
    if (advice.level === 'warning' && !message.startsWith('尺寸 ')) {
      warnings.push({ field: 'imageSize', message });
    }
  }

  const html = tags.map((tag) => tag.line).join('\n');
  return { ok: errors.length === 0, tags, html, errors, warnings };
}

/** The data a preview card needs, with the same fallbacks the tags use. */
export interface PreviewModel {
  host: string;
  hostLabel: string;
  urlValid: boolean;
  title: string;
  description: string;
  image: string;
  site: string;
  creator: string;
  card: TwitterCardType;
  cardLabel: string;
}

export function previewModel(input: OgInput): PreviewModel {
  const raw = input.url.trim();
  let host = raw;
  let urlValid = false;
  try {
    if (raw !== '') {
      const parsed = new URL(raw);
      host = parsed.hostname;
      urlValid = true;
    }
  } catch {
    urlValid = false;
  }
  if (host === '') host = '（未填写 URL）';

  const cardLabel = CARD_TYPES.find((item) => item.value === input.twitterCard)?.label ?? input.twitterCard;

  return {
    host,
    hostLabel: host.toUpperCase(),
    urlValid,
    title: (input.twitterTitle.trim() || input.title.trim()) || '（未填写标题）',
    description: (input.twitterDescription.trim() || input.description.trim()) || '（未填写描述）',
    image: input.twitterImage.trim() || input.image.trim(),
    site: input.twitterSite.trim().replace(/^@+/, ''),
    creator: input.twitterCreator.trim().replace(/^@+/, ''),
    card: input.twitterCard,
    cardLabel,
  };
}

/** The generated HTML with a short comment header, for pasting into a page head. */
export function buildCopyableHtml(input: OgInput): string {
  const result = buildMetaTags(input);
  return `<!-- 由 wheat-tools 的 Open Graph 标签生成器生成 -->\n${result.html}`;
}
