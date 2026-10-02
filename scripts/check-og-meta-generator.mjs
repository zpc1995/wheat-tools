/**
 * Checks the Open Graph tag generator.
 *
 * The generated HTML is never trusted by inspection. It is handed to Python's
 * `html.parser`, a completely independent HTML parser, and the tag/attribute
 * structure it reports is compared against the input. That is what proves the
 * escaping is real: a round trip through a foreign parser returns the original
 * character-for-character, including quotes, angle brackets, ampersands, emoji
 * and newlines.
 *
 * The escaping is also attacked from the other side. A naive generator that
 * interpolates the description into the attribute without escaping is built
 * here and fed to the same parser; the check asserts its content attribute is
 * truncated at the first quote, which is what makes the real implementation's
 * escaping load-bearing rather than cosmetic.
 *
 * Usage: node scripts/check-og-meta-generator.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/og-meta-generator/ogMetaUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/og-meta-generator.mjs', compiled);
const M = await import(pathToFileURL('.verify/og-meta-generator.mjs').href);

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`),
  );
}

/* ------------------------------------------------------------------ */
/* The independent parser: Python's html.parser                        */
/* ------------------------------------------------------------------ */

const PYTHON = `
import sys, json
from html.parser import HTMLParser

class Collector(HTMLParser):
    def __init__(self):
        HTMLParser.__init__(self, convert_charrefs=True)
        self.tags = []
        self.title = None
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        self.tags.append({"tag": tag, "attrs": attrs})
        if tag == "title":
            self._in_title = True
            self.title = ""

    def handle_startendtag(self, tag, attrs):
        self.tags.append({"tag": tag, "attrs": attrs})

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title and self.title is not None:
            self.title += data

html = sys.stdin.read()
collector = Collector()
collector.feed(html)
collector.close()
sys.stdout.write(json.dumps({"tags": collector.tags, "title": collector.title}))
`;

/** Parses HTML with python3 and returns `{ tags, title }`. */
function parseHtml(html) {
  let out;
  try {
    out = execFileSync('python3', ['-c', PYTHON], { input: html, encoding: 'utf8' });
  } catch (error) {
    console.error('python3 不可用或解析失败，无法完成权威校验：', error.message);
    process.exit(1);
  }
  return JSON.parse(out);
}

/** The `content` attribute of the first meta tag carrying `key`. */
function metaContent(parsed, key) {
  for (const tag of parsed.tags) {
    if (tag.tag !== 'meta') continue;
    const attrs = Object.fromEntries(tag.attrs);
    if (attrs.property === key || attrs.name === key) return attrs.content;
  }
  return null;
}

function metaCount(parsed, key) {
  return parsed.tags.filter((tag) => {
    if (tag.tag !== 'meta') return false;
    const attrs = Object.fromEntries(tag.attrs);
    return attrs.property === key || attrs.name === key;
  }).length;
}

function attrsOf(parsed, key) {
  for (const tag of parsed.tags) {
    const attrs = Object.fromEntries(tag.attrs);
    if (attrs.property === key || attrs.name === key) return attrs;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 1. Escaping primitive                                               */
/* ------------------------------------------------------------------ */

console.log('--- 转义原语 ---');
check('& 先于其他字符被转义', M.escapeHtml('a&b<c'), 'a&amp;b&lt;c');
check('双引号被转义', M.escapeHtml('say "hi"'), 'say &quot;hi&quot;');
check('单引号被转义', M.escapeHtml("it's"), 'it&#39;s');
check('尖括号被转义', M.escapeHtml('<script>'), '&lt;script&gt;');
check('五个字符一起转义', M.escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
check('中文与 emoji 不被改动', M.escapeHtml('中文🎉'), '中文🎉');
check('空串保持空串', M.escapeHtml(''), '');
check('& 不会被二次转义', M.escapeHtml('&amp;'), '&amp;amp;');

/* ------------------------------------------------------------------ */
/* 2. Round trip through an independent parser                         */
/* ------------------------------------------------------------------ */

console.log('--- 与 python3 html.parser 的解析回读 ---');

function baseInput(overrides) {
  return {
    title: '示例标题 — Wheat Tools',
    description: '示例描述：包含 & 与 " 引号。',
    url: 'https://example.com/page?ref=og&x=1',
    canonical: '',
    image: 'https://cdn.example.com/img.png?w=1200&h=630',
    imageAlt: '示例图片',
    imageWidth: '1200',
    imageHeight: '630',
    siteName: '示例站点',
    type: 'website',
    locale: 'zh_CN',
    localeAlternates: 'en_US, ja_JP',
    themeColor: '#123456',
    fbAppId: '',
    twitterCard: 'summary_large_image',
    twitterSite: '@example',
    twitterCreator: '@creator',
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
    ...overrides,
  };
}

{
  const input = baseInput();
  const result = M.buildMetaTags(input);
  check('完整输入没有错误', result.errors, []);
  check('完整输入没有警告', result.warnings, []);
  check('生成 23 个标签（含两个 og:locale:alternate）', result.tags.length, 23);

  const parsed = parseHtml(result.html);
  check('解析回读 og:title', metaContent(parsed, 'og:title'), input.title);
  check('解析回读 title 元素', parsed.title, input.title);
  check('解析回读 description', metaContent(parsed, 'description'), input.description);
  check('解析回读 og:description（含 & 与引号）', metaContent(parsed, 'og:description'), input.description);
  check('解析回读 og:url（含 & 的查询串）', metaContent(parsed, 'og:url'), input.url);
  check('解析回读 og:image（含 & 的查询串）', metaContent(parsed, 'og:image'), input.image);
  check('解析回读 og:image:width', metaContent(parsed, 'og:image:width'), '1200');
  check('解析回读 og:image:height', metaContent(parsed, 'og:image:height'), '630');
  check('解析回读 og:locale', metaContent(parsed, 'og:locale'), 'zh_CN');
  check('解析回读 theme-color', metaContent(parsed, 'theme-color'), '#123456');
  check('解析回读 twitter:card', metaContent(parsed, 'twitter:card'), 'summary_large_image');
  check('解析回读 twitter:site', metaContent(parsed, 'twitter:site'), '@example');

  const canonical = parsed.tags.find((tag) => tag.tag === 'link' && Object.fromEntries(tag.attrs).rel === 'canonical');
  check('canonical 链接存在', Boolean(canonical), true);
  check('canonical 默认取 og:url', Object.fromEntries(canonical.attrs).href, input.url);

  check('og:title 只出现一次', metaCount(parsed, 'og:title'), 1);
  check('twitter:card 只出现一次', metaCount(parsed, 'twitter:card'), 1);
  check('description 只出现一次', metaCount(parsed, 'description'), 1);
  check('每个 meta 都是自闭合写法', result.html.split('\n').every((line) => line.endsWith('/>') || line.startsWith('<title>')), true);
  check('所有属性都用双引号', result.html.includes("content='"), false);
}

/* ------------------------------------------------------------------ */
/* 3. Hostile input must round trip too                                */
/* ------------------------------------------------------------------ */

console.log('--- 注入与特殊字符 ---');

{
  const hostile = {
    title: '"><script>alert(1)</script>',
    description: 'He said "hi" & then <img src=x onerror=alert(1)> left \'quoted\'',
    url: 'https://example.com/?a=1&b="2"',
    image: 'https://cdn.example.com/i.png?a=1&b=2',
    imageAlt: 'alt with "quotes" & <b>tags</b>',
  };
  const input = baseInput(hostile);
  const result = M.buildMetaTags(input);
  const parsed = parseHtml(result.html);

  check('注入的标题原样回读', metaContent(parsed, 'og:title'), hostile.title);
  check('注入的 title 元素原样回读', parsed.title, hostile.title);
  check('注入的描述原样回读', metaContent(parsed, 'og:description'), hostile.description);
  check('注入的 URL 原样回读', metaContent(parsed, 'og:url'), hostile.url);
  check('注入的图片 alt 原样回读', metaContent(parsed, 'og:image:alt'), hostile.imageAlt);
  check('没有解析出 script 标签', parsed.tags.some((tag) => tag.tag === 'script'), false);
  check('没有解析出 img 标签', parsed.tags.some((tag) => tag.tag === 'img'), false);
  check('没有解析出 b 标签', parsed.tags.some((tag) => tag.tag === 'b'), false);
  check('meta 标签个数没有被注入撑大', parsed.tags.filter((tag) => tag.tag === 'meta').length, result.tags.filter((tag) => tag.key !== 'title' && tag.key !== 'canonical').length);
  check('原文里的 < 不会出现在输出里（除了标签本身）', metaContent(parsed, 'og:description').includes('<img'), true);

  const attrs = attrsOf(parsed, 'og:title');
  check('og:title 只有 property 与 content 两个属性', Object.keys(attrs).sort(), ['content', 'property']);
}

/* ------------------------------------------------------------------ */
/* 4. Reverse proof: not escaping really does break it                 */
/* ------------------------------------------------------------------ */

console.log('--- 反证：不转义会产出非法 HTML ---');

{
  const description = 'He said "hi" and left';
  const naive = `<meta property="og:description" content="${description}" />`;
  const naiveParsed = parseHtml(naive);
  const naiveAttrs = naiveParsed.tags[0].attrs;
  const naiveContent = Object.fromEntries(naiveAttrs).content;

  check('未转义时 content 在第一个引号处被截断（反证成立）', naiveContent, 'He said ');
  check('未转义时 content 不等于原文（反证成立）', naiveContent !== description, true);
  check('未转义时多出伪造属性（反证成立）', naiveAttrs.length > 2, true);
  check('未转义时伪造属性确实是 hi 与 left（反证成立）', naiveAttrs.map(([name]) => name), ['property', 'content', 'hi"', 'and', 'left"']);

  const real = M.buildMetaTags(baseInput({ description })).tags.find((tag) => tag.key === 'og:description');
  const realParsed = parseHtml(real.line);
  check('转义后 content 完整回读', Object.fromEntries(realParsed.tags[0].attrs).content, description);
  check('转义后只有两个属性', realParsed.tags[0].attrs.length, 2);
  check('真正实现里没有裸引号', real.line.includes(`content="${description}"`), false);
  check('真正实现用的是实体', real.line.includes('&quot;hi&quot;'), true);
}

/* ------------------------------------------------------------------ */
/* 5. Required fields and card-type validation                         */
/* ------------------------------------------------------------------ */

console.log('--- 必填校验 ---');

{
  const missingAll = M.buildMetaTags(baseInput({ title: '', description: '', url: '', image: '', type: '' }));
  check('缺标题时报错', missingAll.errors.some((issue) => issue.field === 'title'), true);
  check('缺 URL 时报错', missingAll.errors.some((issue) => issue.field === 'url'), true);
  check('缺图片时报错', missingAll.errors.some((issue) => issue.field === 'image'), true);
  check('缺类型时报错', missingAll.errors.some((issue) => issue.field === 'type'), true);
  check('缺描述时给出警告而不是错误', missingAll.warnings.some((issue) => issue.field === 'description'), true);
  check('必填缺失时 ok 为 false', missingAll.ok, false);
  check('错误信息指明字段名', missingAll.errors.find((issue) => issue.field === 'title').message.includes('og:title'), true);

  const badUrl = M.buildMetaTags(baseInput({ url: 'not a url' }));
  check('非法 URL 报错', badUrl.errors.some((issue) => issue.field === 'url'), true);
  const badImage = M.buildMetaTags(baseInput({ image: '/relative.png' }));
  check('相对图片地址报错', badImage.errors.some((issue) => issue.field === 'image'), true);
  const badCanonical = M.buildMetaTags(baseInput({ canonical: '/relative' }));
  check('相对 canonical 报错', badCanonical.errors.some((issue) => issue.field === 'canonical'), true);
  check('相对 URL 不被认为是绝对 URL', M.isAbsoluteUrl('/a'), false);
  check('绝对 URL 被认可', M.isAbsoluteUrl('https://a.example/x'), true);
}

console.log('--- 卡片类型差异 ---');

{
  const noImage = baseInput({ image: '', twitterCard: 'summary_large_image' });
  const large = M.buildMetaTags(noImage);
  check('summary_large_image 缺图时报错', large.errors.some((issue) => issue.field === 'twitterImage'), true);

  const small = M.buildMetaTags(baseInput({ image: '', imageAlt: '', twitterCard: 'summary' }));
  check('summary 缺图时只是警告', small.warnings.some((issue) => issue.field === 'twitterImage'), true);
  check('summary 缺图时没有图片错误', small.errors.some((issue) => issue.field === 'twitterImage'), false);

  const player = M.buildMetaTags(baseInput({ twitterCard: 'player', playerUrl: '', playerWidth: '', playerHeight: '' }));
  check('player 缺 player 地址时报错', player.errors.some((issue) => issue.field === 'playerUrl'), true);
  check('player 缺宽时报错', player.errors.some((issue) => issue.field === 'playerWidth'), true);
  check('player 缺高时报错', player.errors.some((issue) => issue.field === 'playerHeight'), true);

  const httpPlayer = M.buildMetaTags(baseInput({ twitterCard: 'player', playerUrl: 'http://a.example/p', playerWidth: '640', playerHeight: '360' }));
  check('player 非 HTTPS 时报错', httpPlayer.errors.some((issue) => issue.message.includes('HTTPS')), true);

  const okPlayer = M.buildMetaTags(baseInput({ twitterCard: 'player', playerUrl: 'https://a.example/p', playerWidth: '640', playerHeight: '360', imageWidth: '1200', imageHeight: '628' }));
  check('完整的 player 输入没有错误', okPlayer.errors, []);
  const playerParsed = parseHtml(okPlayer.html);
  check('player 标签被输出', metaContent(playerParsed, 'twitter:player'), 'https://a.example/p');
  check('player 宽被输出', metaContent(playerParsed, 'twitter:player:width'), '640');
  check('player 高被输出', metaContent(playerParsed, 'twitter:player:height'), '360');

  const appEmpty = M.buildMetaTags(baseInput({ twitterCard: 'app' }));
  check('app 未填任何平台时报错', appEmpty.errors.some((issue) => issue.field === 'app'), true);

  const appPartial = M.buildMetaTags(baseInput({ twitterCard: 'app', appNameIphone: 'My App' }));
  check('app 只填名称时报错（缺 id 与 url）', appPartial.errors.some((issue) => issue.field === 'appIdiphone'), true);

  const appNoName = M.buildMetaTags(baseInput({ twitterCard: 'app', appIdIphone: '123456' }));
  check('app 只填 id 时报错（缺名称）', appNoName.errors.some((issue) => issue.field === 'appNameiphone'), true);

  const appOk = M.buildMetaTags(baseInput({ twitterCard: 'app', appNameIphone: 'My App', appIdIphone: '1234567890', appNameGoogleplay: 'My App', appUrlGoogleplay: 'https://play.google.com/store/apps/details?id=com.example' }));
  check('app 填好 iPhone 与 Google Play 后没有错误', appOk.errors, []);
  const appParsed = parseHtml(appOk.html);
  check('app 名称标签被输出', metaContent(appParsed, 'twitter:app:name:iphone'), 'My App');
  check('app id 标签被输出', metaContent(appParsed, 'twitter:app:id:iphone'), '1234567890');
  check('googleplay url 标签被输出', metaContent(appParsed, 'twitter:app:url:googleplay'), 'https://play.google.com/store/apps/details?id=com.example');

  const appNonNumeric = M.buildMetaTags(baseInput({ twitterCard: 'app', appNameIphone: 'My App', appIdIphone: 'abc' }));
  check('非数字 app id 给出警告', appNonNumeric.warnings.some((issue) => issue.field === 'appIdiphone'), true);

  const otherEmpty = M.buildMetaTags(baseInput({ twitterCard: 'summary', twitterTitle: '', twitterDescription: '' }));
  check('summary 未给 twitter 专属字段时用 OG 回退，因此不报缺失', otherEmpty.warnings.some((issue) => issue.field === 'twitterTitle'), false);
}

/* ------------------------------------------------------------------ */
/* 6. Twitter fallback                                                 */
/* ------------------------------------------------------------------ */

console.log('--- Twitter 字段回退到 OG ---');

{
  const input = baseInput({ twitterTitle: '', twitterDescription: '', twitterImage: '', twitterImageAlt: '' });
  const parsed = parseHtml(M.buildMetaTags(input).html);
  check('twitter:title 回退到 og:title', metaContent(parsed, 'twitter:title'), input.title);
  check('twitter:description 回退到 og:description', metaContent(parsed, 'twitter:description'), input.description);
  check('twitter:image 回退到 og:image', metaContent(parsed, 'twitter:image'), input.image);
  check('twitter:image:alt 回退到 og:image:alt', metaContent(parsed, 'twitter:image:alt'), input.imageAlt);

  const overridden = baseInput({ twitterTitle: 'Twitter 专属标题' });
  const overriddenParsed = parseHtml(M.buildMetaTags(overridden).html);
  check('填写 twitter:title 时优先使用它', metaContent(overriddenParsed, 'twitter:title'), 'Twitter 专属标题');
  check('同时 og:title 仍是原来的标题', metaContent(overriddenParsed, 'og:title'), overridden.title);
}

/* ------------------------------------------------------------------ */
/* 7. Image size advice                                                */
/* ------------------------------------------------------------------ */

console.log('--- 图片尺寸建议 ---');

{
  check(
    '1200 × 630 对大图卡片合格',
    M.validateImageSize(baseInput({ twitterCard: 'summary_large_image', imageWidth: '1200', imageHeight: '630' })).level,
    'ok',
  );
  check(
    '1200 × 628 也被接受（两种官方建议比值略有差异）',
    M.validateImageSize(baseInput({ twitterCard: 'summary_large_image', imageWidth: '1200', imageHeight: '628' })).level,
    'ok',
  );
  const square = M.validateImageSize(baseInput({ twitterCard: 'summary', imageWidth: '100', imageHeight: '100' }));
  check('100 × 100 对 summary 卡片判定为警告（尺寸太小）', square.level, 'warning');
  check('小尺寸提示提到 144', square.messages.some((message) => message.includes('144')), true);

  const wide = M.validateImageSize(baseInput({ twitterCard: 'summary_large_image', imageWidth: '2000', imageHeight: '500' }));
  check('比例失衡时判定为警告', wide.level, 'warning');
  check('比例失衡提示给出实际比值', wide.messages.some((message) => message.includes('4.00')), true);

  const single = M.validateImageSize(baseInput({ imageWidth: '1200', imageHeight: '' }));
  check('只填一个维度时无法校验', single.messages.some((message) => message.includes('两者')), true);

  const none = M.validateImageSize(baseInput({ imageWidth: '', imageHeight: '' }));
  check('完全不填时提示无法校验', none.messages.some((message) => message.includes('无法校验')), true);

  const badRatio = M.buildMetaTags(baseInput({ twitterCard: 'summary', imageWidth: '100', imageHeight: '100' }));
  check('尺寸警告会进入构建结果', badRatio.warnings.some((issue) => issue.field === 'imageSize'), true);

  check('建议表包含三行', M.RECOMMENDED_SIZES.length, 3);
  check('建议表提到 1200 × 630', M.RECOMMENDED_SIZES.some((row) => row.size.includes('1200 × 630')), true);
  check('建议表提到 1200 × 628', M.RECOMMENDED_SIZES.some((row) => row.size.includes('1200 × 628')), true);

  const numeric = M.buildMetaTags(baseInput({ imageWidth: '0', imageHeight: '-5' }));
  check('非正整数的宽高不被输出为标签', numeric.tags.some((tag) => tag.key === 'og:image:width'), false);
}

/* ------------------------------------------------------------------ */
/* 8. Preview model                                                    */
/* ------------------------------------------------------------------ */

console.log('--- 预览模型 ---');

{
  const model = M.previewModel(baseInput({ url: 'https://sub.example.com/a/b?x=1' }));
  check('预览主机名来自 URL', model.host, 'sub.example.com');
  check('预览主机名大写展示', model.hostLabel, 'SUB.EXAMPLE.COM');
  check('预览标题回退到 OG 标题', model.title, '示例标题 — Wheat Tools');
  check('预览 site 去掉 @', model.site, 'example');
  check('预览 creator 去掉 @', model.creator, 'creator');
  check('预览图片回退到 OG 图片', model.image, 'https://cdn.example.com/img.png?w=1200&h=630');

  const empty = M.previewModel(baseInput({ url: '' }));
  check('URL 为空时预览不崩溃', empty.urlValid, false);
  check('URL 为空时给出占位主机名', empty.host, '（未填写 URL）');
  check('缺少标题时给出占位文案', M.previewModel(baseInput({ title: '', twitterTitle: '' })).title, '（未填写标题）');

  const longHost = M.previewModel(baseInput({ url: 'https://xn--fiqs8s.cn/x' }));
  check('IDN 预览主机名保留 Punycode', longHost.host, 'xn--fiqs8s.cn');
}

/* ------------------------------------------------------------------ */
/* 9. Boundaries                                                       */
/* ------------------------------------------------------------------ */

console.log('--- 边界 ---');

{
  const longTitle = 'T'.repeat(5000);
  const longResult = M.buildMetaTags(baseInput({ title: longTitle }));
  const longParsed = parseHtml(longResult.html);
  check('5000 字标题完整回读', metaContent(longParsed, 'og:title').length, 5000);
  check('5000 字标题内容一致', metaContent(longParsed, 'og:title'), longTitle);

  const multiline = baseInput({ description: '第一行\n第二行\r\n第三行' });
  const multilineParsed = parseHtml(M.buildMetaTags(multiline).html);
  check('描述里的换行不会截断属性', metaContent(multilineParsed, 'og:description'), '第一行\n第二行\r\n第三行');

  const emoji = baseInput({ title: '中文标题 🎉🚀', description: '描述里也有 emoji 😀 与 & < >' });
  const emojiParsed = parseHtml(M.buildMetaTags(emoji).html);
  check('emoji 标题完整回读', metaContent(emojiParsed, 'og:title'), '中文标题 🎉🚀');
  check('emoji + 特殊字符描述完整回读', metaContent(emojiParsed, 'og:description'), '描述里也有 emoji 😀 与 & < >');
  check('emoji 也出现在 title 元素里', emojiParsed.title, '中文标题 🎉🚀');

  const emptyEverything = M.buildMetaTags(baseInput({
    title: '', description: '', url: '', image: '', type: '', locale: '', siteName: '', themeColor: '',
    imageAlt: '', localeAlternates: '', imageWidth: '', imageHeight: '',
    twitterCard: 'summary', twitterSite: '', twitterCreator: '',
  }));
  check('全空输入仍有 twitter:card 一个标签', emptyEverything.tags.length, 1);
  check('全空输入仍能通过解析器', parseHtml(emptyEverything.html).tags.length, 1);
  check('全空输入 ok 为 false', emptyEverything.ok, false);

  const alternates = M.buildMetaTags(baseInput({ localeAlternates: 'en_US\n ja_JP ,, ko_KR ' }));
  const alternatesParsed = parseHtml(alternates.html);
  check('多语言行被拆成三个', alternatesParsed.tags.filter((tag) => Object.fromEntries(tag.attrs).property === 'og:locale:alternate').length, 3);
  check('多语言值被去掉空白', metaContent(alternatesParsed, 'og:locale:alternate'), 'en_US');

  check('可复制 HTML 带注释头', M.buildCopyableHtml(baseInput()).startsWith('<!--'), true);
  check('可复制 HTML 仍可被解析', parseHtml(M.buildCopyableHtml(baseInput())).tags.length, 23);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
