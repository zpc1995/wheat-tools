/**
 * Pure logic and data for the MIME type cheat sheet.
 *
 * ## Why the table is data rather than computed
 *
 * There is no algorithm that turns `docx` into
 * `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
 * The mapping is a registry maintained by IANA plus a pile of historic
 * `x-` prefixed names, so it is carried as data and the check script pins it
 * against a genuinely independent second table: CPython's `mimetypes` module.
 * Where the two disagree, the disagreement is enumerated and justified in the
 * check script instead of being hidden — Python's table has known stale rows
 * (for example `.rs`, which it maps to an RDF vocabulary rather than Rust).
 *
 * ## The two flags the UI shows
 *
 * `readable` means the bytes are text a human can read (so it is true for
 * `application/json` and `image/svg+xml`, not only for `text/` types).
 * `compressed` means the file is an archive or compression container whose
 * contents must be unpacked before they can be read (zip, gzip, docx, apk).
 * A compressed *image* such as PNG is not flagged: its pixels are decoded by
 * the browser, not extracted from an archive.
 *
 * ## Ambiguous extensions are real
 *
 * `.ts` is both an MPEG transport stream and a TypeScript source file, `.xml`
 * has a text and an application registration, `.gz` is a MIME type *and* a
 * Content-Encoding. So an extension maps to a list of entries, and the reverse
 * lookup returns every match rather than pretending one is the only answer.
 */

/** The category prefixes the sidebar filters by. */
export type MimeCategory =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'application'
  | 'font'
  | 'multipart';

export const MIME_CATEGORY_ORDER: MimeCategory[] = [
  'text',
  'image',
  'audio',
  'video',
  'application',
  'font',
  'multipart',
];

export const MIME_CATEGORY_LABELS: Record<MimeCategory, string> = {
  text: '文本',
  image: '图片',
  audio: '音频',
  video: '视频',
  application: '应用/二进制',
  font: '字体',
  multipart: '多部分',
};

export interface MimeEntry {
  /** The canonical type, lower case, `type/subtype`. */
  type: string;
  /**
   * Lower-case extensions without the leading dot. The first one is the one the
   * reverse lookup reports as primary. Empty for types that are negotiated
   * rather than derived from a file name.
   */
  extensions: string[];
  /** Simplified-Chinese description shown next to the type. */
  zh: string;
  /** Sidebar bucket. Usually the prefix, but `eot` is a font under `application`. */
  category: MimeCategory;
  /** Whether the content is text a human can read. */
  readable: boolean;
  /** Whether it is an archive / compression container. */
  compressed: boolean;
  /** Where the registration comes from, or why there is none. */
  source: string;
  /** Set when the type is superseded; the UI marks it. */
  deprecated?: boolean;
  /** Extra caveat worth showing, especially for ambiguous extensions. */
  note?: string;
}

/**
 * The registry.
 *
 * Ordered by category (text, image, audio, video, application, font,
 * multipart) so the unfiltered list reads sensibly, and within a category from
 * everyday formats to specialised ones.
 */
export const MIME_ENTRIES: MimeEntry[] = [
  // ------------------------------------------------------------------ text
  {
    type: 'text/plain',
    extensions: ['txt', 'text', 'log'],
    zh: '纯文本，没有格式信息',
    category: 'text',
    readable: true,
    compressed: false,
    source: 'RFC 2046',
  },
  {
    type: 'text/html',
    extensions: ['html', 'htm'],
    zh: 'HTML 网页',
    category: 'text',
    readable: true,
    compressed: false,
    source: 'WHATWG HTML',
  },
  {
    type: 'text/css',
    extensions: ['css'],
    zh: 'CSS 样式表',
    category: 'text',
    readable: true,
    compressed: false,
    source: 'W3C',
  },
  {
    type: 'text/javascript',
    extensions: ['js', 'mjs', 'cjs'],
    zh: 'JavaScript 脚本（现行标准类型）',
    category: 'text',
    readable: true,
    compressed: false,
    source: 'RFC 9239',
    note: '旧写法 application/javascript 已被 RFC 9239 废弃。',
  },
  {
    type: 'text/markdown',
    extensions: ['md', 'markdown'],
    zh: 'Markdown 文档',
    category: 'text',
    readable: true,
    compressed: false,
    source: 'RFC 7763',
  },
  {
    type: 'text/csv',
    extensions: ['csv'],
    zh: '逗号分隔的表格数据',
    category: 'text',
    readable: true,
    compressed: false,
    source: 'RFC 4180',
  },
  {
    type: 'text/tab-separated-values',
    extensions: ['tsv'],
    zh: '制表符分隔的表格数据',
    category: 'text',
    readable: true,
    compressed: false,
    source: 'IANA',
  },
  {
    type: 'text/calendar',
    extensions: ['ics', 'ifb'],
    zh: 'iCalendar 日历事件',
    category: 'text',
    readable: true,
    compressed: false,
    source: 'RFC 5545',
  },
  {
    type: 'text/vcard',
    extensions: ['vcf', 'vcard'],
    zh: 'vCard 联系人',
    category: 'text',
    readable: true,
    compressed: false,
    source: 'RFC 6350',
  },
  {
    type: 'text/xml',
    extensions: ['xml'],
    zh: 'XML（text/ 前缀，用于人类阅读的场景）',
    category: 'text',
    readable: true,
    compressed: false,
    source: 'RFC 7303',
    note: '同一扩展名还有 application/xml；RFC 7303 建议默认用 application/xml，除非确实是给人看的。',
  },
  {
    type: 'text/x-python',
    extensions: ['py'],
    zh: 'Python 源码',
    category: 'text',
    readable: true,
    compressed: false,
    source: '未在 IANA 注册（历史惯例）',
  },
  {
    type: 'text/x-c',
    extensions: ['c'],
    zh: 'C 源码',
    category: 'text',
    readable: true,
    compressed: false,
    source: '未在 IANA 注册（历史惯例）',
  },
  {
    type: 'text/x-c++',
    extensions: ['cpp', 'cc', 'cxx', 'hpp'],
    zh: 'C++ 源码',
    category: 'text',
    readable: true,
    compressed: false,
    source: '未在 IANA 注册（历史惯例）',
  },
  {
    type: 'text/x-java-source',
    extensions: ['java'],
    zh: 'Java 源码',
    category: 'text',
    readable: true,
    compressed: false,
    source: '未在 IANA 注册（历史惯例）',
  },
  {
    type: 'text/x-sh',
    extensions: ['sh', 'bash'],
    zh: 'Shell 脚本',
    category: 'text',
    readable: true,
    compressed: false,
    source: '未在 IANA 注册（历史惯例）',
  },
  {
    type: 'text/x-rust',
    extensions: ['rs'],
    zh: 'Rust 源码',
    category: 'text',
    readable: true,
    compressed: false,
    source: '未在 IANA 注册（历史惯例）',
    note: 'Python 的 mimetypes 表把 .rs 认成 application/rls-services+xml（那是 RDF 词汇表），属于已知的过时行，本表不采用。',
  },
  {
    type: 'text/typescript',
    extensions: ['ts', 'mts', 'cts'],
    zh: 'TypeScript 源码',
    category: 'text',
    readable: true,
    compressed: false,
    source: '未在 IANA 注册',
    note: '.ts 同时是 MPEG 传输流（video/mp2t）的扩展名，两者都不算错，取决于文件内容；本工具不做内容嗅探。',
  },
  {
    type: 'text/x-diff',
    extensions: ['diff', 'patch'],
    zh: '补丁 / diff 文本',
    category: 'text',
    readable: true,
    compressed: false,
    source: '未在 IANA 注册（历史惯例）',
  },
  {
    type: 'text/vtt',
    extensions: ['vtt'],
    zh: 'WebVTT 字幕',
    category: 'text',
    readable: true,
    compressed: false,
    source: 'W3C',
  },
  {
    type: 'text/event-stream',
    extensions: [],
    zh: 'Server-Sent Events 流（协商得到，不来自扩展名）',
    category: 'text',
    readable: true,
    compressed: false,
    source: 'WHATWG HTML',
  },
  {
    type: 'application/javascript',
    extensions: [],
    zh: 'JavaScript（已废弃的写法）',
    category: 'application',
    readable: true,
    compressed: false,
    source: 'RFC 9239 已废弃',
    deprecated: true,
    note: '改用 text/javascript。',
  },
  {
    type: 'text/x-yaml',
    extensions: [],
    zh: 'YAML（旧的 text/ 写法）',
    category: 'text',
    readable: true,
    compressed: false,
    source: '未注册；现行写法是 application/yaml',
    deprecated: true,
  },

  // ----------------------------------------------------------------- image
  {
    type: 'image/png',
    extensions: ['png'],
    zh: 'PNG 位图，无损压缩，支持透明',
    category: 'image',
    readable: false,
    compressed: false,
    source: 'RFC 2083',
  },
  {
    type: 'image/jpeg',
    extensions: ['jpg', 'jpeg', 'jpe'],
    zh: 'JPEG 位图，有损压缩，不支持透明',
    category: 'image',
    readable: false,
    compressed: false,
    source: 'RFC 2045',
  },
  {
    type: 'image/gif',
    extensions: ['gif'],
    zh: 'GIF 位图，支持动画与 1 位透明',
    category: 'image',
    readable: false,
    compressed: false,
    source: 'RFC 2045',
  },
  {
    type: 'image/webp',
    extensions: ['webp'],
    zh: 'WebP，可有无损或有损，支持透明与动画',
    category: 'image',
    readable: false,
    compressed: false,
    source: 'IANA',
  },
  {
    type: 'image/avif',
    extensions: ['avif'],
    zh: 'AVIF，基于 AV1 的图片格式',
    category: 'image',
    readable: false,
    compressed: false,
    source: 'IANA',
  },
  {
    type: 'image/svg+xml',
    extensions: ['svg', 'svgz'],
    zh: 'SVG 矢量图，本质是 XML 文本',
    category: 'image',
    readable: true,
    compressed: false,
    source: 'W3C',
    note: '可读文本意味着它可以内联到 HTML，也意味着它可以携带脚本——作为图片加载时才安全。',
  },
  {
    type: 'image/bmp',
    extensions: ['bmp'],
    zh: 'Windows 位图，基本不压缩',
    category: 'image',
    readable: false,
    compressed: false,
    source: 'IANA',
  },
  {
    type: 'image/tiff',
    extensions: ['tif', 'tiff'],
    zh: 'TIFF，印刷与扫描常用',
    category: 'image',
    readable: false,
    compressed: false,
    source: 'RFC 3302',
  },
  {
    type: 'image/vnd.microsoft.icon',
    extensions: ['ico'],
    zh: '网站图标 favicon',
    category: 'image',
    readable: false,
    compressed: false,
    source: 'IANA',
    note: '旧写法 image/x-icon 仍能在很多服务器配置里看到。',
  },
  {
    type: 'image/heic',
    extensions: ['heic'],
    zh: 'HEIC，苹果设备默认拍照格式',
    category: 'image',
    readable: false,
    compressed: false,
    source: 'ISO/IEC 23008-12',
  },
  {
    type: 'image/heif',
    extensions: ['heif'],
    zh: 'HEIF，HEIC 所属的通用图像容器',
    category: 'image',
    readable: false,
    compressed: false,
    source: 'ISO/IEC 23008-12',
  },
  {
    type: 'image/apng',
    extensions: ['apng'],
    zh: '动图 PNG',
    category: 'image',
    readable: false,
    compressed: false,
    source: '未在 IANA 注册',
  },
  {
    type: 'image/x-icon',
    extensions: [],
    zh: 'favicon（已废弃的写法）',
    category: 'image',
    readable: false,
    compressed: false,
    source: '已被 image/vnd.microsoft.icon 取代',
    deprecated: true,
  },

  // ----------------------------------------------------------------- audio
  {
    type: 'audio/mpeg',
    extensions: ['mp3', 'mpga'],
    zh: 'MP3 音频',
    category: 'audio',
    readable: false,
    compressed: false,
    source: 'RFC 3003',
  },
  {
    type: 'audio/wav',
    extensions: ['wav'],
    zh: 'WAV，未压缩 PCM 音频',
    category: 'audio',
    readable: false,
    compressed: false,
    source: 'RFC 2361',
    note: 'audio/x-wav 是同样常见的历史写法，两者都被广泛接受。',
  },
  {
    type: 'audio/ogg',
    extensions: ['ogg', 'oga', 'opus'],
    zh: 'Ogg 容器音频（Vorbis / Opus）',
    category: 'audio',
    readable: false,
    compressed: false,
    source: 'RFC 5334',
    note: '.opus 通常也写作 audio/ogg 并带 codecs=opus 参数，单看类型分不出来。',
  },
  {
    type: 'audio/flac',
    extensions: ['flac'],
    zh: 'FLAC 无损音频',
    category: 'audio',
    readable: false,
    compressed: false,
    source: 'RFC 9639',
  },
  {
    type: 'audio/aac',
    extensions: ['aac'],
    zh: 'AAC 音频裸流',
    category: 'audio',
    readable: false,
    compressed: false,
    source: 'RFC 4337',
  },
  {
    type: 'audio/mp4',
    extensions: ['m4a', 'm4b'],
    zh: 'MP4 容器里的音频（AAC/ALAC）',
    category: 'audio',
    readable: false,
    compressed: false,
    source: 'RFC 4337',
  },
  {
    type: 'audio/webm',
    extensions: ['weba'],
    zh: 'WebM 容器里的音频',
    category: 'audio',
    readable: false,
    compressed: false,
    source: 'IANA',
  },
  {
    type: 'audio/midi',
    extensions: ['midi', 'mid'],
    zh: 'MIDI 音乐指令（不是录音）',
    category: 'audio',
    readable: false,
    compressed: false,
    source: 'IANA',
  },
  {
    type: 'audio/x-ms-wma',
    extensions: ['wma'],
    zh: 'Windows Media Audio',
    category: 'audio',
    readable: false,
    compressed: false,
    source: '未在 IANA 注册（历史惯例）',
  },

  // ----------------------------------------------------------------- video
  {
    type: 'video/mp4',
    extensions: ['mp4', 'm4v'],
    zh: 'MP4 视频',
    category: 'video',
    readable: false,
    compressed: false,
    source: 'RFC 4337',
  },
  {
    type: 'video/webm',
    extensions: ['webm'],
    zh: 'WebM 视频（VP8/VP9/AV1）',
    category: 'video',
    readable: false,
    compressed: false,
    source: 'IANA',
  },
  {
    type: 'video/ogg',
    extensions: ['ogv'],
    zh: 'Ogg 容器视频（Theora）',
    category: 'video',
    readable: false,
    compressed: false,
    source: 'RFC 5334',
  },
  {
    type: 'video/quicktime',
    extensions: ['mov'],
    zh: 'QuickTime 视频',
    category: 'video',
    readable: false,
    compressed: false,
    source: 'IANA',
  },
  {
    type: 'video/x-msvideo',
    extensions: ['avi'],
    zh: 'AVI 视频',
    category: 'video',
    readable: false,
    compressed: false,
    source: '未在 IANA 注册（历史惯例）',
  },
  {
    type: 'video/matroska',
    extensions: ['mkv'],
    zh: 'Matroska（MKV）容器视频',
    category: 'video',
    readable: false,
    compressed: false,
    source: 'RFC 9559',
    note: '旧写法 video/x-matroska 在服务器配置里仍很常见。',
  },
  {
    type: 'video/mpeg',
    extensions: ['mpeg', 'mpg', 'mpe'],
    zh: 'MPEG-1/2 视频',
    category: 'video',
    readable: false,
    compressed: false,
    source: 'RFC 2045',
  },
  {
    type: 'video/mp2t',
    extensions: ['ts'],
    zh: 'MPEG 传输流（HLS 分片）',
    category: 'video',
    readable: false,
    compressed: false,
    source: 'RFC 3555',
    note: '.ts 与 TypeScript 源码撞名；靠扩展名无法区分，需要看内容或上下文。',
  },
  {
    type: 'video/3gpp',
    extensions: ['3gp'],
    zh: '3GPP 手机视频',
    category: 'video',
    readable: false,
    compressed: false,
    source: 'RFC 3839',
  },
  {
    type: 'video/x-flv',
    extensions: ['flv'],
    zh: 'Flash 视频（已淘汰）',
    category: 'video',
    readable: false,
    compressed: false,
    source: '未在 IANA 注册（历史惯例）',
  },

  // ----------------------------------------------------------- application
  {
    type: 'application/json',
    extensions: ['json', 'map'],
    zh: 'JSON 数据；.map 是 Source Map，也是 JSON',
    category: 'application',
    readable: true,
    compressed: false,
    source: 'RFC 8259',
    note: '.map 只是约定俗成的扩展名，格式仍然是 JSON，所以没有独立的 MIME 类型。',
  },
  {
    type: 'application/ld+json',
    extensions: ['jsonld'],
    zh: 'JSON-LD 结构化数据',
    category: 'application',
    readable: true,
    compressed: false,
    source: 'W3C',
  },
  {
    type: 'application/manifest+json',
    extensions: ['webmanifest'],
    zh: 'Web App Manifest',
    category: 'application',
    readable: true,
    compressed: false,
    source: 'W3C',
  },
  {
    type: 'application/xml',
    extensions: ['xml', 'xsl', 'xsd', 'xslt'],
    zh: 'XML（默认注册类型）',
    category: 'application',
    readable: true,
    compressed: false,
    source: 'RFC 7303',
  },
  {
    type: 'application/xhtml+xml',
    extensions: ['xhtml'],
    zh: 'XHTML 文档',
    category: 'application',
    readable: true,
    compressed: false,
    source: 'W3C',
  },
  {
    type: 'application/atom+xml',
    extensions: ['atom'],
    zh: 'Atom 订阅源',
    category: 'application',
    readable: true,
    compressed: false,
    source: 'RFC 4287',
  },
  {
    type: 'application/rss+xml',
    extensions: ['rss'],
    zh: 'RSS 订阅源',
    category: 'application',
    readable: true,
    compressed: false,
    source: '未在 IANA 注册（事实标准）',
  },
  {
    type: 'application/yaml',
    extensions: ['yaml', 'yml'],
    zh: 'YAML 数据',
    category: 'application',
    readable: true,
    compressed: false,
    source: 'RFC 9512',
  },
  {
    type: 'application/toml',
    extensions: ['toml'],
    zh: 'TOML 配置',
    category: 'application',
    readable: true,
    compressed: false,
    source: 'RFC 9259',
  },
  {
    type: 'application/sql',
    extensions: ['sql'],
    zh: 'SQL 语句文本',
    category: 'application',
    readable: true,
    compressed: false,
    source: 'RFC 6922',
  },
  {
    type: 'application/x-httpd-php',
    extensions: ['php'],
    zh: 'PHP 脚本（由服务器执行）',
    category: 'application',
    readable: true,
    compressed: false,
    source: '未在 IANA 注册（历史惯例）',
  },
  {
    type: 'application/pdf',
    extensions: ['pdf'],
    zh: 'PDF 文档，版面固定',
    category: 'application',
    readable: false,
    compressed: true,
    source: 'ISO 32000',
    note: '内部流通常用 Flate 压缩，所以算压缩容器；但它是文档而不是归档。',
  },
  {
    type: 'application/zip',
    extensions: ['zip'],
    zh: 'ZIP 归档',
    category: 'application',
    readable: false,
    compressed: true,
    source: 'ISO/IEC 21320-1',
  },
  {
    type: 'application/gzip',
    extensions: ['gz', 'tgz'],
    zh: 'gzip 压缩流',
    category: 'application',
    readable: false,
    compressed: true,
    source: 'RFC 6713',
    note: 'HTTP 里 gzip 更常作为 Content-Encoding 出现；作为文件类型是 application/gzip，Python 的压缩包 gzip 也一样。',
  },
  {
    type: 'application/x-tar',
    extensions: ['tar'],
    zh: 'tar 归档（不压缩，只打包）',
    category: 'application',
    readable: false,
    compressed: true,
    source: '未在 IANA 注册（历史惯例）',
    note: 'tar 本身不压缩，.tar.gz 才是先打包再压缩。',
  },
  {
    type: 'application/x-bzip2',
    extensions: ['bz2', 'tbz2'],
    zh: 'bzip2 压缩流',
    category: 'application',
    readable: false,
    compressed: true,
    source: '未在 IANA 注册（历史惯例）',
  },
  {
    type: 'application/x-xz',
    extensions: ['xz', 'txz'],
    zh: 'xz 压缩流',
    category: 'application',
    readable: false,
    compressed: true,
    source: '未在 IANA 注册（历史惯例）',
  },
  {
    type: 'application/zstd',
    extensions: ['zst'],
    zh: 'Zstandard 压缩流',
    category: 'application',
    readable: false,
    compressed: true,
    source: 'RFC 8878',
  },
  {
    type: 'application/x-7z-compressed',
    extensions: ['7z'],
    zh: '7-Zip 归档',
    category: 'application',
    readable: false,
    compressed: true,
    source: '未在 IANA 注册（历史惯例）',
  },
  {
    type: 'application/vnd.rar',
    extensions: ['rar'],
    zh: 'RAR 归档',
    category: 'application',
    readable: false,
    compressed: true,
    source: 'IANA',
    note: '旧写法 application/x-rar-compressed 仍很常见。',
  },
  {
    type: 'application/octet-stream',
    extensions: ['bin', 'dat', 'dll'],
    zh: '未知的二进制数据，浏览器只会下载',
    category: 'application',
    readable: false,
    compressed: false,
    source: 'RFC 2046',
    note: '这是「我不知道」的兜底类型，不是一种真正的格式。',
  },
  {
    type: 'application/x-msdos-program',
    extensions: ['exe', 'com'],
    zh: 'Windows 可执行文件',
    category: 'application',
    readable: false,
    compressed: false,
    source: '未在 IANA 注册（历史惯例）',
  },
  {
    type: 'application/x-apple-diskimage',
    extensions: ['dmg'],
    zh: 'macOS 磁盘映像',
    category: 'application',
    readable: false,
    compressed: true,
    source: '未在 IANA 注册（历史惯例）',
  },
  {
    type: 'application/x-iso9660-image',
    extensions: ['iso'],
    zh: '光盘映像',
    category: 'application',
    readable: false,
    compressed: true,
    source: '未在 IANA 注册（历史惯例）',
  },
  {
    type: 'application/java-archive',
    extensions: ['jar'],
    zh: 'Java 归档（本质是 ZIP）',
    category: 'application',
    readable: false,
    compressed: true,
    source: 'IANA',
  },
  {
    type: 'application/wasm',
    extensions: ['wasm'],
    zh: 'WebAssembly 字节码',
    category: 'application',
    readable: false,
    compressed: false,
    source: 'W3C',
  },
  {
    type: 'application/vnd.android.package-archive',
    extensions: ['apk'],
    zh: 'Android 应用包（本质是 ZIP）',
    category: 'application',
    readable: false,
    compressed: true,
    source: 'IANA',
  },
  {
    type: 'application/epub+zip',
    extensions: ['epub'],
    zh: 'EPUB 电子书（本质是 ZIP）',
    category: 'application',
    readable: false,
    compressed: true,
    source: 'IANA',
  },
  {
    type: 'application/rtf',
    extensions: ['rtf'],
    zh: 'RTF 富文本（纯文本语法描述排版）',
    category: 'application',
    readable: false,
    compressed: false,
    source: 'RFC 7111',
  },
  {
    type: 'application/msword',
    extensions: ['doc'],
    zh: 'Word 97-2003 文档（二进制）',
    category: 'application',
    readable: false,
    compressed: false,
    source: 'IANA',
  },
  {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['docx'],
    zh: 'Word 文档（OOXML，ZIP 容器）',
    category: 'application',
    readable: false,
    compressed: true,
    source: 'ISO/IEC 29500',
  },
  {
    type: 'application/vnd.ms-excel',
    extensions: ['xls'],
    zh: 'Excel 97-2003 工作簿（二进制）',
    category: 'application',
    readable: false,
    compressed: false,
    source: 'IANA',
  },
  {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extensions: ['xlsx'],
    zh: 'Excel 工作簿（OOXML，ZIP 容器）',
    category: 'application',
    readable: false,
    compressed: true,
    source: 'ISO/IEC 29500',
  },
  {
    type: 'application/vnd.ms-powerpoint',
    extensions: ['ppt'],
    zh: 'PowerPoint 97-2003 演示文稿（二进制）',
    category: 'application',
    readable: false,
    compressed: false,
    source: 'IANA',
  },
  {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extensions: ['pptx'],
    zh: 'PowerPoint 演示文稿（OOXML，ZIP 容器）',
    category: 'application',
    readable: false,
    compressed: true,
    source: 'ISO/IEC 29500',
  },
  {
    type: 'application/vnd.oasis.opendocument.text',
    extensions: ['odt'],
    zh: 'OpenDocument 文本文档（ZIP 容器）',
    category: 'application',
    readable: false,
    compressed: true,
    source: 'OASIS',
  },
  {
    type: 'application/vnd.oasis.opendocument.spreadsheet',
    extensions: ['ods'],
    zh: 'OpenDocument 电子表格（ZIP 容器）',
    category: 'application',
    readable: false,
    compressed: true,
    source: 'OASIS',
  },
  {
    type: 'application/vnd.oasis.opendocument.presentation',
    extensions: ['odp'],
    zh: 'OpenDocument 演示文稿（ZIP 容器）',
    category: 'application',
    readable: false,
    compressed: true,
    source: 'OASIS',
  },
  {
    type: 'application/vnd.adobe.flash.movie',
    extensions: ['swf'],
    zh: 'Flash 动画（浏览器已不再支持）',
    category: 'application',
    readable: false,
    compressed: false,
    source: 'IANA',
    deprecated: true,
  },
  {
    type: 'application/dash+xml',
    extensions: ['mpd'],
    zh: 'MPEG-DASH 清单',
    category: 'application',
    readable: true,
    compressed: false,
    source: 'ISO/IEC 23009-1',
  },
  {
    type: 'application/vnd.apple.mpegurl',
    extensions: ['m3u8'],
    zh: 'HLS 播放列表',
    category: 'application',
    readable: true,
    compressed: false,
    source: 'IANA',
    note: '另一种写法 application/x-mpegURL 同样常见。',
  },
  {
    type: 'application/x-www-form-urlencoded',
    extensions: [],
    zh: '表单提交的 URL 编码体（协商得到，不来自扩展名）',
    category: 'application',
    readable: true,
    compressed: false,
    source: 'WHATWG URL',
  },
  {
    type: 'application/x-rar-compressed',
    extensions: [],
    zh: 'RAR 归档（已废弃的写法）',
    category: 'application',
    readable: false,
    compressed: true,
    source: '已被 application/vnd.rar 取代',
    deprecated: true,
  },

  // ------------------------------------------------------------------ font
  {
    type: 'font/woff',
    extensions: ['woff'],
    zh: 'WOFF 网页字体（压缩的 sfnt）',
    category: 'font',
    readable: false,
    compressed: false,
    source: 'W3C',
    note: '旧写法 application/font-woff；WOFF 内部本身是压缩的，但浏览器直接解析它，不是归档。',
  },
  {
    type: 'font/woff2',
    extensions: ['woff2'],
    zh: 'WOFF2 网页字体（Brotli 压缩，体积最小）',
    category: 'font',
    readable: false,
    compressed: false,
    source: 'W3C',
  },
  {
    type: 'font/ttf',
    extensions: ['ttf'],
    zh: 'TrueType 字体',
    category: 'font',
    readable: false,
    compressed: false,
    source: 'IANA',
  },
  {
    type: 'font/otf',
    extensions: ['otf'],
    zh: 'OpenType 字体',
    category: 'font',
    readable: false,
    compressed: false,
    source: 'IANA',
  },
  {
    type: 'font/collection',
    extensions: ['ttc'],
    zh: '字体集合（多个字体打包）',
    category: 'font',
    readable: false,
    compressed: false,
    source: 'IANA',
  },
  {
    type: 'application/vnd.ms-fontobject',
    extensions: ['eot'],
    zh: 'EOT 字体（仅 IE 需要）',
    category: 'font',
    readable: false,
    compressed: false,
    source: 'IANA',
    deprecated: true,
  },

  // ------------------------------------------------------------- multipart
  {
    type: 'multipart/form-data',
    extensions: [],
    zh: '表单上传（含文件）的请求体',
    category: 'multipart',
    readable: false,
    compressed: false,
    source: 'RFC 7578',
  },
  {
    type: 'multipart/mixed',
    extensions: [],
    zh: '多段混合内容',
    category: 'multipart',
    readable: false,
    compressed: false,
    source: 'RFC 2046',
  },
  {
    type: 'multipart/byteranges',
    extensions: [],
    zh: 'HTTP 分段下载的响应体',
    category: 'multipart',
    readable: false,
    compressed: false,
    source: 'RFC 9110',
  },
  {
    type: 'multipart/alternative',
    extensions: [],
    zh: '同一内容的多种格式（邮件常见）',
    category: 'multipart',
    readable: false,
    compressed: false,
    source: 'RFC 2046',
  },
];

/** Fast lookup by exact type. */
const BY_TYPE = new Map(MIME_ENTRIES.map((entry) => [entry.type, entry]));

/**
 * Extension to entries.
 *
 * An extension may legitimately have several entries (`.ts`, `.xml`), so this
 * maps to a list in table order; `lookupByExtension` takes the first.
 */
const BY_EXTENSION = new Map<string, MimeEntry[]>();
for (const entry of MIME_ENTRIES) {
  for (const extension of entry.extensions) {
    const list = BY_EXTENSION.get(extension) ?? [];
    list.push(entry);
    BY_EXTENSION.set(extension, list);
  }
}

/**
 * `type/subtype` token per RFC 9110.
 *
 * Only lower-case letters, digits and the registered special characters are
 * allowed; the wildcard `*` is permitted only when the caller asks for it, so
 * that `*` in a search box is not mistaken for a real type.
 */
const MIME_TOKEN = /^[a-z0-9][a-z0-9!#$&^_.+-]*$/;

/** Lower-cases a type and drops any `;charset=...` parameter. */
export function normalizeMimeType(value: string): string {
  if (typeof value !== 'string') return '';
  const withoutParameters = value.split(';', 1)[0];
  return withoutParameters.trim().toLowerCase();
}

/** Strips a leading dot and lower-cases, so `.PNG` and `png` both work. */
export function normalizeExtension(value: string): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/^\.+/, '');
}

export function isValidMimeType(
  value: string,
  options: { allowWildcard?: boolean } = {},
): boolean {
  const type = normalizeMimeType(value);
  if (type === '') return false;
  const parts = type.split('/');
  if (parts.length !== 2) return false;
  const [major, minor] = parts;
  if (major === '*' || minor === '*') return options.allowWildcard === true;
  return MIME_TOKEN.test(major) && MIME_TOKEN.test(minor);
}

/** The category a type belongs to when it is not in the registry. */
export function categoryOfMimeType(type: string): MimeCategory | null {
  const normalized = normalizeMimeType(type);
  const prefix = normalized.split('/', 1)[0];
  return (MIME_CATEGORY_ORDER as string[]).includes(prefix)
    ? (prefix as MimeCategory)
    : null;
}

/** True when the type is registered as human-readable text. */
export function isTextType(type: string): boolean {
  return normalizeMimeType(type).startsWith('text/');
}

/** True when the registry flags the type as readable text. */
export function isReadableType(type: string): boolean {
  return BY_TYPE.get(normalizeMimeType(type))?.readable ?? false;
}

/** True when the registry flags the type as an archive / compression container. */
export function isCompressedType(type: string): boolean {
  return BY_TYPE.get(normalizeMimeType(type))?.compressed ?? false;
}

export function lookupByType(type: string): MimeEntry | null {
  return BY_TYPE.get(normalizeMimeType(type)) ?? null;
}

/** Every entry that claims this extension, in table order. */
export function entriesForExtension(extension: string): MimeEntry[] {
  return BY_EXTENSION.get(normalizeExtension(extension)) ?? [];
}

/** The primary entry for an extension, or null when nothing claims it. */
export function lookupByExtension(extension: string): MimeEntry | null {
  return entriesForExtension(extension)[0] ?? null;
}

/** The extensions of a type, or an empty list when the type is unknown. */
export function extensionsOfType(type: string): string[] {
  return BY_TYPE.get(normalizeMimeType(type))?.extensions ?? [];
}

/** The first extension of a type, used for the "save as" hint. */
export function primaryExtensionOfType(type: string): string | null {
  return extensionsOfType(type)[0] ?? null;
}

/** All distinct extensions in the registry, sorted, for the datalist. */
export function allExtensions(): string[] {
  return [...BY_EXTENSION.keys()].sort();
}

export function categoryCounts(): Record<MimeCategory, number> {
  const counts = Object.fromEntries(
    MIME_CATEGORY_ORDER.map((category) => [category, 0]),
  ) as Record<MimeCategory, number>;
  for (const entry of MIME_ENTRIES) counts[entry.category] += 1;
  return counts;
}

/**
 * Splits a query into lower-case terms.
 *
 * A leading dot is dropped from each term so that searching `.png` behaves the
 * same as searching `png` — typing the dot is what people do when they think of
 * an extension, and rejecting it would look like the search is broken.
 */
export function queryTerms(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== '')
    .map((term) => normalizeExtension(term));
}

/**
 * Free-text search across extension, type, Chinese description and source.
 *
 * Terms are ANDed, matching the shared `ListFilter` component's behaviour, so
 * "image png" narrows rather than widens the result.
 */
export function searchMimeEntries(
  query: string,
  category: MimeCategory | 'all' = 'all',
): MimeEntry[] {
  const terms = queryTerms(query);
  return MIME_ENTRIES.filter((entry) => {
    if (category !== 'all' && entry.category !== category) return false;
    if (terms.length === 0) return true;
    const haystack = [
      entry.type,
      entry.zh,
      entry.source,
      entry.note ?? '',
      ...entry.extensions,
      ...entry.extensions.map((extension) => `.${extension}`),
    ]
      .join(' ')
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/**
 * Renders one entry as a single TSV-ish line, used by the copy button.
 *
 * Tabs are chosen as the separator because the result is meant to be pasted
 * into a spreadsheet or a `mime.types` style file; the human-readable columns
 * stay last so the first two columns are the actual mapping.
 */
export function entryToLine(entry: MimeEntry): string {
  return [
    entry.extensions.length > 0
      ? entry.extensions.map((extension) => `.${extension}`).join(' ')
      : '（无扩展名）',
    entry.type,
    entry.zh,
    entry.readable ? '可读文本' : '二进制',
    entry.compressed ? '压缩/归档' : '非压缩',
  ].join('\t');
}

export function entriesToTsv(entries: MimeEntry[]): string {
  const header = ['扩展名', 'MIME 类型', '说明', '可读性', '压缩'];
  return [header.join('\t'), ...entries.map(entryToLine)].join('\n');
}
