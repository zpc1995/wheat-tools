/**
 * Checks the WebRTC tester's pure logic.
 *
 * `RTCPeerConnection`, `fetch`, `getUserMedia` and `getStats` cannot run in
 * Node, so those stay in `WebrtcTesterTool.tsx` and are *not* exercised here.
 * What is checked is everything that decides what the user sees and what the
 * copied report contains:
 *
 *   - endpoint validation and the WHIP/WHEP path hint
 *   - SDP parsing, against a real Chromium offer captured in
 *     `.verify/rtc/fixture.json` when that file exists, and against an
 *     equivalent built-in sample when it does not (the fixture is gitignored and
 *     will not ship with the repository)
 *   - WHIP/WHEP response classification, including the 201/Location/DELETE rules
 *     from RFC 9725
 *   - interval statistics, including the counter-reset case that a naive
 *     subtraction gets wrong
 *   - token masking and the diagnostic report
 *
 * Independent references are used rather than restating the implementation:
 *
 *   - The SDP samples come from Chromium itself (or a fixed equivalent), and
 *     payload types are read from the SDP text by hand in the assertions.
 *   - Bitrate expectations are hand-computed from bytes and elapsed time.
 *   - The naive counter subtraction is run alongside the implementation to prove
 *     the check would catch the negative-rate defect.
 *
 * Usage: node scripts/check-webrtc-tester.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const UTILS_PATH = 'src/tools/webrtc-tester/webrtcUtils.ts';
const COMPONENT_PATH = 'src/tools/webrtc-tester/WebrtcTesterTool.tsx';

const compiled = ts.transpileModule(readFileSync(UTILS_PATH, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/webrtc-tester.mjs', compiled);
const M = await import(pathToFileURL('.verify/webrtc-tester.mjs').href);

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok
        ? ''
        : `\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`),
  );
}

// ---------------------------------------------------------------------------
// Real SDP sample, with a built-in equivalent fallback
// ---------------------------------------------------------------------------

function sdpFromLines(lines) {
  return lines.join('\n');
}

const FALLBACK_SEND_SDP = sdpFromLines([
  'v=0',
  'o=- 1111111111111111111 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS stream-id',
  'm=audio 50000 UDP/TLS/RTP/SAVPF 111 0 8',
  'c=IN IP4 192.0.2.10',
  'a=candidate:1 1 udp 2122260223 192.0.2.10 50000 typ host generation 0',
  'a=ice-ufrag:testufrag',
  'a=ice-pwd:testpasswordtestpassword',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
  'a=setup:actpass',
  'a=mid:0',
  'a=sendrecv',
  'a=msid:stream-id audio-track',
  'a=rtcp-mux',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:0 PCMU/8000',
  'a=rtpmap:8 PCMA/8000',
  'a=ssrc:1001 cname:test',
  'm=video 50002 UDP/TLS/RTP/SAVPF 96 97 45 98 102',
  'c=IN IP4 192.0.2.10',
  'a=candidate:2 1 udp 2122260223 192.0.2.10 50002 typ host generation 0',
  'a=ice-ufrag:testufrag',
  'a=ice-pwd:testpasswordtestpassword',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
  'a=setup:actpass',
  'a=mid:1',
  'a=sendrecv',
  'a=msid:stream-id video-track',
  'a=rtcp-mux',
  'a=rtpmap:96 VP8/90000',
  'a=rtpmap:97 rtx/90000',
  'a=fmtp:97 apt=96',
  'a=rtpmap:45 AV1/90000',
  'a=rtpmap:98 VP9/90000',
  'a=fmtp:98 profile-id=0',
  'a=rtpmap:102 H264/90000',
  'a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f',
  'a=ssrc-group:FID 2001 2002',
  'a=ssrc:2001 cname:test',
]);

const FALLBACK_RECV_SDP = sdpFromLines([
  'v=0',
  'o=- 2222222222222222222 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97 45 98 102',
  'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:testufrag',
  'a=ice-pwd:testpasswordtestpassword',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF',
  'a=setup:actpass',
  'a=mid:0',
  'a=recvonly',
  'a=rtcp-mux',
  'a=rtpmap:96 VP8/90000',
  'a=rtpmap:97 rtx/90000',
  'a=fmtp:97 apt=96',
  'a=rtpmap:45 AV1/90000',
  'a=rtpmap:98 VP9/90000',
  'a=rtpmap:102 H264/90000',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 0 8',
  'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:testufrag',
  'a=ice-pwd:testpasswordtestpassword',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF',
  'a=setup:actpass',
  'a=mid:1',
  'a=recvonly',
  'a=rtcp-mux',
  'a=rtpmap:111 opus/48000/2',
  'a=rtpmap:0 PCMU/8000',
  'a=rtpmap:8 PCMA/8000',
]);

let fixture = null;
try {
  fixture = JSON.parse(readFileSync('.verify/rtc/fixture.json', 'utf8'));
} catch {
  fixture = null;
}
const usingFixture =
  fixture !== null &&
  typeof fixture.sendSdp === 'string' &&
  typeof fixture.recvSdp === 'string' &&
  M.looksLikeSdp(fixture.sendSdp) &&
  M.looksLikeSdp(fixture.recvSdp);

const sendSdp = usingFixture ? fixture.sendSdp : FALLBACK_SEND_SDP;
const recvSdp = usingFixture ? fixture.recvSdp : FALLBACK_RECV_SDP;

console.log(
  usingFixture
    ? '--- SDP 样本：使用 .verify/rtc/fixture.json 中 Chromium 抓到的真实 offer ---'
    : '--- SDP 样本：.verify/rtc/fixture.json 不可用，使用内置等价样本 ---',
);

const MINIMAL_ANSWER_SDP = sdpFromLines([
  'v=0',
  'o=- 3333333333333333333 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'c=IN IP4 0.0.0.0',
  'a=recvonly',
  'a=rtpmap:96 VP8/90000',
]);

// ---------------------------------------------------------------------------
// Endpoint normalisation
// ---------------------------------------------------------------------------

console.log('--- 地址规范化 ---');
{
  check('https 推流地址', M.normalizeEndpoint('https://example.com/whip'), {
    ok: true,
    url: 'https://example.com/whip',
  });
  check('http localhost 拉流地址', M.normalizeEndpoint('http://localhost:8080/whep'), {
    ok: true,
    url: 'http://localhost:8080/whep',
  });
  check('前后空格被去掉', M.normalizeEndpoint('  https://example.com/whep  '), {
    ok: true,
    url: 'https://example.com/whep',
  });
  check('尾斜杠被保留（有些服务端区分）', M.normalizeEndpoint('https://example.com/whip/'), {
    ok: true,
    url: 'https://example.com/whip/',
  });
  check('默认端口与主机大小写被规范化', M.normalizeEndpoint('HTTPS://Example.COM:443/rtc/v1/whip/'), {
    ok: true,
    url: 'https://example.com/rtc/v1/whip/',
  });

  const empty = M.normalizeEndpoint('');
  check('空串被拒绝', empty.ok, false);
  check('空串给出明确说明', /请填写/.test(empty.error), true);
  const spaces = M.normalizeEndpoint('   ');
  check('只有空格被拒绝', spaces.ok, false);
  check('只有空格也给出明确说明', /请填写/.test(spaces.error), true);

  const ws = M.normalizeEndpoint('ws://example.com/whip');
  check('ws:// 被拒绝', ws.ok, false);
  check('ws:// 的错误点名协议', /ws:/.test(ws.error), true);
  check('ws:// 的错误指向 http/https', /http:\/\/|https:\/\//.test(ws.error), true);
  check('ftp:// 被拒绝', M.normalizeEndpoint('ftp://example.com/whep').ok, false);
  check('缺少协议的裸主机被拒绝', M.normalizeEndpoint('example.com/whip').ok, false);
  check('非 URL 文本被拒绝', M.normalizeEndpoint('not a url').ok, false);
  check('只有协议没有主机被拒绝', M.normalizeEndpoint('https://').ok, false);
  check('IPv6 地址可用', M.normalizeEndpoint('http://[::1]:8080/whip'), {
    ok: true,
    url: 'http://[::1]:8080/whip',
  });
}

console.log('--- WHIP/WHEP 路径启发式（只提示，不阻止） ---');
{
  check('/whip 结尾', M.isWhipWhepPath('https://example.com/whip'), 'whip');
  check('/whip/ 结尾', M.isWhipWhepPath('https://example.com/whip/'), 'whip');
  check('/whep/ 结尾', M.isWhipWhepPath('https://example.com/rtc/v1/whep/'), 'whep');
  check('查询参数不影响判断', M.isWhipWhepPath('https://example.com/whep?app=live&stream=x'), 'whep');
  check('大小写不敏感', M.isWhipWhepPath('https://example.com/WHIP'), 'whip');
  check('其它路径不猜', M.isWhipWhepPath('https://example.com/rtc/v1/publish'), 'unknown');
  check('无法解析的地址不猜', M.isWhipWhepPath('not a url'), 'unknown');
  check('空串不猜', M.isWhipWhepPath(''), 'unknown');
}

// ---------------------------------------------------------------------------
// SDP parsing
// ---------------------------------------------------------------------------

console.log('--- SDP 解析：真实推流 offer ---');
{
  const send = M.parseSdp(sendSdp);
  const expectedUfrag = usingFixture ? 'gbNZ' : 'testufrag';
  const expectedFingerprintPrefix = usingFixture ? 'sha-256 A4:66' : 'sha-256 AA:BB';
  const expectedVideoCandidates = usingFixture ? 4 : 1;

  if (usingFixture) {
    check('真实 sendSdp 行数 170', sendSdp.split('\n').length, 170);
  }
  check('sendSdp 合法', send.valid, true);
  check('sendSdp 有 2 个 m 段', send.media.length, 2);
  check(
    'sendSdp 的 m 段顺序是 audio、video（与抓取时一致）',
    send.media.map((section) => section.kind),
    ['audio', 'video'],
  );
  check(
    'sendSdp 的 kind 集合',
    [...new Set(send.media.map((section) => section.kind))].sort(),
    ['audio', 'video'],
  );
  check(
    'sendSdp 每段方向都是 sendrecv（addTrack 的默认值，不是 sendonly）',
    send.media.map((section) => section.direction),
    ['sendrecv', 'sendrecv'],
  );
  check('sendSdp 的 ice-ufrag', send.media[0].iceUfrag, expectedUfrag);
  check('sendSdp 两段共享 ice-ufrag', send.media[1].iceUfrag, expectedUfrag);
  check(
    'sendSdp 的 fingerprint 存在且算法为 sha-256',
    send.media[1].fingerprint !== null && send.media[1].fingerprint.startsWith(expectedFingerprintPrefix),
    true,
  );
  check(
    'sendSdp 视频段候选数（真实样本 4 个主机候选）',
    send.media[1].candidateCount,
    expectedVideoCandidates,
  );

  const sendVideo = send.media.find((section) => section.kind === 'video');
  const sendAudio = send.media.find((section) => section.kind === 'audio');
  check('sendSdp 有视频段', sendVideo !== undefined, true);
  check('sendSdp 有音频段', sendAudio !== undefined, true);

  const vp8 = sendVideo.codecs.find((codec) => codec.payloadType === 96);
  check('payload 96 映射为 VP8', vp8.encodingName, 'VP8');
  check('VP8 的 clock rate 为 90000', vp8.clockRate, 90000);

  const h264 = sendVideo.codecs.find((codec) => codec.payloadType === 102);
  check('payload 102 映射为 H264', h264.encodingName, 'H264');
  check('H264 的 fmtp 参数被保留', /profile-level-id/.test(h264.fmtp), true);
  check('视频段的 mid 被解析', sendVideo.mid, '1');
  const av1 = sendVideo.codecs.find((codec) => codec.payloadType === 45);
  check('payload 45 映射为 AV1', av1.encodingName, 'AV1');
  const vp9 = sendVideo.codecs.find((codec) => codec.payloadType === 98);
  check('payload 98 映射为 VP9', vp9.encodingName, 'VP9');

  const opus = sendAudio.codecs.find((codec) => codec.payloadType === 111);
  check('payload 111 映射为 opus', opus.encodingName, 'opus');
  check('opus 的 clock rate 为 48000', opus.clockRate, 48000);
  check('opus 的声道数为 2', opus.channels, 2);
  const pcmu = sendAudio.codecs.find((codec) => codec.payloadType === 0);
  check('payload 0 映射为 PCMU', pcmu.encodingName, 'PCMU');
  check('PCMU 的 clock rate 为 8000', pcmu.clockRate, 8000);
  check('PCMU 未写声道数时按音频默认 1', pcmu.channels, 1);

  const videoSummary = M.formatCodecSummary(send);
  check('编解码摘要包含 VP8', videoSummary.includes('VP8/90000'), true);
  check('编解码摘要包含 opus 与声道', videoSummary.includes('opus/48000/2'), true);
  check('编解码摘要不列出 rtx', videoSummary.includes('rtx'), false);
  check('编解码摘要不列出 telephone-event', videoSummary.includes('telephone-event'), false);
  const names = M.primaryCodecs(send).map((codec) => codec.encodingName);
  check('主编解码器集合包含 VP8、H264、AV1、VP9', ['VP8', 'H264', 'AV1', 'VP9'].every((name) => names.includes(name)), true);
}

console.log('--- SDP 解析：真实拉流 offer ---');
{
  const recv = M.parseSdp(recvSdp);
  const expectedUfrag = usingFixture ? 'JfjE' : 'testufrag';
  const expectedFingerprintPrefix = usingFixture ? 'sha-256 54:A7' : 'sha-256 11:22';

  if (usingFixture) {
    check('真实 recvSdp 行数 202', recvSdp.split('\n').length, 202);
  }
  check('recvSdp 合法', recv.valid, true);
  check('recvSdp 有 2 个 m 段', recv.media.length, 2);
  check(
    'recvSdp 的 m 段顺序是 video、audio（addTransceiver 顺序）',
    recv.media.map((section) => section.kind),
    ['video', 'audio'],
  );
  check(
    'recvSdp 每段方向都是 recvonly',
    recv.media.map((section) => section.direction),
    ['recvonly', 'recvonly'],
  );
  check('recvSdp 的 ice-ufrag', recv.media[0].iceUfrag, expectedUfrag);
  check(
    'recvSdp 的 fingerprint 存在',
    recv.media[0].fingerprint !== null && recv.media[0].fingerprint.startsWith(expectedFingerprintPrefix),
    true,
  );
  check('recvSdp 此时还没有候选（未收集）', recv.media[0].candidateCount, 0);
  const recvVideo = recv.media.find((section) => section.kind === 'video');
  const recvVp8 = recvVideo.codecs.find((codec) => codec.payloadType === 96);
  check('recvSdp payload 96 仍是 VP8/90000', `${recvVp8.encodingName}/${recvVp8.clockRate}`, 'VP8/90000');
}

console.log('--- SDP 方向：四种取值与缺省 sendrecv ---');
{
  const base = (direction) =>
    sdpFromLines([
      'v=0',
      'o=- 1 2 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'm=video 9 UDP/TLS/RTP/SAVPF 96',
      'c=IN IP4 0.0.0.0',
      'a=mid:0',
      ...(direction === null ? [] : [`a=${direction}`]),
      'a=rtpmap:96 VP8/90000',
    ]);

  for (const direction of ['sendonly', 'recvonly', 'sendrecv', 'inactive']) {
    const parsed = M.parseSdp(base(direction));
    check(`显式 a=${direction} 被正确解析`, parsed.media[0].direction, direction);
  }

  const noDirection = M.parseSdp(base(null));
  check('没有方向属性时按 RFC 8866 默认 sendrecv', noDirection.media[0].direction, 'sendrecv');

  const sessionLevel = M.parseSdp(
    sdpFromLines([
      'v=0',
      'a=sendonly',
      'm=video 9 UDP/TLS/RTP/SAVPF 96',
      'a=rtpmap:96 VP8/90000',
    ]),
  );
  check('媒体段缺省时继承会话级方向', sessionLevel.media[0].direction, 'sendonly');
  check('会话级方向被单独记录', sessionLevel.session.direction, 'sendonly');

  const override = M.parseSdp(
    sdpFromLines([
      'v=0',
      'a=sendonly',
      'm=video 9 UDP/TLS/RTP/SAVPF 96',
      'a=inactive',
      'a=rtpmap:96 VP8/90000',
    ]),
  );
  check('媒体段方向覆盖会话级方向', override.media[0].direction, 'inactive');

  check('空 SDP 不合法', M.parseSdp('').valid, false);
  check('空 SDP 没有媒体段', M.parseSdp('').media.length, 0);
  check('纯文本不合法', M.parseSdp('hello world').valid, false);
  check('只有 v=0 没有 m= 不合法', M.parseSdp('v=0\ns=-\n').valid, false);
  check('v=0 加 m= 视为合法', M.parseSdp(base(null)).valid, true);

  const sessionIce = M.parseSdp(
    sdpFromLines([
      'v=0',
      'a=ice-ufrag:sessionufrag',
      'a=fingerprint:sha-256 AA:BB',
      'a=candidate:9 1 udp 1 192.0.2.1 9000 typ host',
      'm=video 9 UDP/TLS/RTP/SAVPF 96',
      'a=rtpmap:96 VP8/90000',
    ]),
  );
  check('媒体段缺省的 ice-ufrag 继承会话级值', sessionIce.media[0].iceUfrag, 'sessionufrag');
  check('媒体段缺省的 fingerprint 继承会话级值', sessionIce.media[0].fingerprint, 'sha-256 AA:BB');
  check('会话级候选被单独计数', sessionIce.session.candidateCount, 1);

  const crlf = M.parseSdp(sendSdp.replace(/\n/g, '\r\n'));
  check('CRLF 与 LF 解析结果一致', crlf.media.map((m) => [m.kind, m.direction]), [
    ['audio', 'sendrecv'],
    ['video', 'sendrecv'],
  ]);
  check('looksLikeSdp 接受真实 offer', M.looksLikeSdp(sendSdp), true);
  check('looksLikeSdp 接受最小 answer', M.looksLikeSdp(MINIMAL_ANSWER_SDP), true);
  check('looksLikeSdp 拒绝 HTML', M.looksLikeSdp('<html>Not Found</html>'), false);
  check('looksLikeSdp 拒绝空正文', M.looksLikeSdp(''), false);
}

// ---------------------------------------------------------------------------
// WHIP/WHEP response
// ---------------------------------------------------------------------------

console.log('--- WHIP/WHEP 响应分类 ---');
{
  const location = 'https://example.com/whip/resource/abc';

  const created = M.parseWhipResponse({
    status: 201,
    headers: { Location: location, 'Content-Type': 'application/sdp' },
    body: MINIMAL_ANSWER_SDP,
  });
  check('201 + Location 成功', created.ok, true);
  check('201 资源 URL 被取出', created.resourceUrl, location);
  check('201 answer 被原样保留', created.answerSdp, MINIMAL_ANSWER_SDP);
  check('201 没有错误', created.error, null);
  check('201 没有警告', created.warning, null);

  const lower = M.parseWhipResponse({
    status: 201,
    headers: { location: `  ${location}  ` },
    body: MINIMAL_ANSWER_SDP,
  });
  check('header 名大小写不敏感', lower.resourceUrl, location);
  check('Location 值两端的空格被去掉', lower.resourceUrl, location);
  const upper = M.parseWhipResponse({
    status: 201,
    headers: { LOCATION: location },
    body: MINIMAL_ANSWER_SDP,
  });
  check('全大写 LOCATION 也能读到', upper.resourceUrl, location);

  const noLocation = M.parseWhipResponse({
    status: 201,
    headers: {},
    body: MINIMAL_ANSWER_SDP,
  });
  check('201 无 Location 仍接受 answer', noLocation.ok, true);
  check('201 无 Location 的资源 URL 为 null', noLocation.resourceUrl, null);
  check('201 无 Location 给出警告', noLocation.warning !== null, true);
  check('警告说明无法 DELETE', /DELETE/.test(noLocation.warning), true);
  check('警告提示暴露 Location 的跨域头', /Access-Control-Expose-Headers/.test(noLocation.warning), true);

  const relative = M.parseWhipResponse({
    status: 201,
    headers: { Location: '/resource/abc' },
    body: MINIMAL_ANSWER_SDP,
  });
  check('相对 Location 无法用于 DELETE，被标记', relative.resourceUrl, null);
  check('相对 Location 给出警告', /Location/.test(relative.warning), true);

  const ok200 = M.parseWhipResponse({
    status: 200,
    headers: { Location: location },
    body: MINIMAL_ANSWER_SDP,
  });
  check('200 + SDP 按成功兼容处理', ok200.ok, true);
  check('200 被指出不符合 RFC 9725 的 201 约定', /201/.test(ok200.warning), true);

  const bad400 = M.parseWhipResponse({
    status: 400,
    headers: {},
    body: 'bad offer: no media sections',
  });
  check('400 失败', bad400.ok, false);
  check('400 answer 为 null', bad400.answerSdp, null);
  check('400 错误包含状态码', /400/.test(bad400.error), true);
  check('400 错误包含响应体', /bad offer: no media sections/.test(bad400.error), true);
  check('400 错误给出下一步方向', /检查|原因|路径/.test(bad400.error), true);

  const unauthorized = M.parseWhipResponse({ status: 401, headers: {}, body: 'no token' });
  check('401 被认作认证问题', /认证|token/i.test(unauthorized.error), true);

  const notFound = M.parseWhipResponse({ status: 404, headers: {}, body: '' });
  check('404 被认作路径问题', /404/.test(notFound.error) && /路径|端点/.test(notFound.error), true);

  const serverError = M.parseWhipResponse({ status: 500, headers: {}, body: 'boom' });
  check('500 失败', serverError.ok, false);
  check('500 错误包含服务端内部错误', /服务端|内部错误/.test(serverError.error), true);
  check('500 保留响应体', /boom/.test(serverError.error), true);

  const html = M.parseWhipResponse({
    status: 201,
    headers: { Location: location },
    body: '<html><body>oops</body></html>',
  });
  check('2xx 但正文不是 SDP 视为失败', html.ok, false);
  check('非 SDP 正文的错误说明指向 SDP', /SDP/.test(html.error), true);

  const empty = M.parseWhipResponse({ status: 201, headers: { Location: location }, body: '' });
  check('2xx 空正文视为失败', empty.ok, false);
  check('空正文被明确说明', /空/.test(empty.error), true);

  const noContent = M.parseWhipResponse({ status: 204, headers: {}, body: '' });
  check('204 没有 answer，无法建立连接', noContent.ok, false);

  const huge = M.parseWhipResponse({
    status: 400,
    headers: {},
    body: 'x'.repeat(4000),
  });
  check('超长错误正文被截断', huge.error.includes('已截断'), true);
  check('超长错误正文不会无限增长', huge.error.length < 1200, true);
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

function stream(overrides = {}) {
  return {
    kind: 'video',
    direction: 'send',
    bytes: 0,
    packets: 0,
    packetsLost: 0,
    frames: 0,
    ...overrides,
  };
}

function snapshot(timestampMs, streams, extra = {}) {
  return { timestampMs, streams, ...extra };
}

console.log('--- 统计：手算的码率与帧率 ---');
{
  const prev = snapshot(1000, [
    stream({ kind: 'video', bytes: 100_000, packets: 1000, frames: 300 }),
    stream({ kind: 'audio', bytes: 20_000, packets: 500 }),
  ]);
  const next = snapshot(
    3000,
    [
      stream({
        kind: 'video',
        bytes: 350_000,
        packets: 1700,
        frames: 360,
        frameWidth: 1280,
        frameHeight: 720,
        framesPerSecond: 30,
      }),
      stream({ kind: 'audio', bytes: 30_000, packets: 600 }),
    ],
    { roundTripTimeMs: 25, availableOutgoingBitrateKbps: 1500 },
  );

  const delta = M.pullStats(prev, next, 2000);
  const video = delta.streams.find((item) => item.kind === 'video' && item.direction === 'send');
  const audio = delta.streams.find((item) => item.kind === 'audio' && item.direction === 'send');

  check('250000 字节 / 2 秒 = 1000 kbps', video.bitrateKbps, 1000);
  check('10000 字节 / 2 秒 = 40 kbps', audio.bitrateKbps, 40);
  check('合计码率 1040 kbps', delta.bitrateKbps, 1040);
  check('60 帧 / 2 秒 = 30 fps', video.fps, 30);
  check('音频不报帧率', audio.fps, null);
  check('分辨率来自最新快照', [video.frameWidth, video.frameHeight], [1280, 720]);
  check('RTT 来自候选对', delta.roundTripTimeMs, 25);
  check('可用发送带宽', delta.availableOutgoingBitrateKbps, 1500);
  check('计数器正常前进时不标记重置', delta.reset, false);
  check('采样间隔', delta.elapsedMs, 2000);
}

console.log('--- 统计：丢包率与抖动（接收方向） ---');
{
  const prev = snapshot(0, [
    stream({ direction: 'recv', bytes: 500_000, packets: 1000, packetsLost: 10 }),
  ]);
  const next = snapshot(1000, [
    stream({
      direction: 'recv',
      bytes: 700_000,
      packets: 1990,
      packetsLost: 20,
      jitterMs: 15,
      frameWidth: 640,
      frameHeight: 480,
    }),
  ]);
  const delta = M.pullStats(prev, next, 1000);
  const recv = delta.streams[0];
  check('200000 字节 / 1 秒 = 1600 kbps', recv.bitrateKbps, 1600);
  check('收到 990 包、丢 10 包 = 1% 丢包率', recv.packetLossPercent, 1);
  check('合并丢包率也是 1%', delta.packetLossPercent, 1);
  check('抖动由秒换算为毫秒', recv.jitterMs, 15);
  check('接收分辨率', [recv.frameWidth, recv.frameHeight], [640, 480]);
  check('接收方向不报 fps（无帧计数时）', recv.fps, null);
}

console.log('--- 统计：计数器回退（反证朴素相减会得到负数） ---');
{
  const elapsedMs = 1000;
  const prev = snapshot(0, [
    stream({ bytes: 1_000_000, packets: 10_000, packetsLost: 5, frames: 1000 }),
  ]);
  const next = snapshot(elapsedMs, [
    stream({ bytes: 900_000, packets: 9000, packetsLost: 4, frames: 900 }),
  ]);

  // This is what a straightforward implementation does. It is written out here
  // on purpose so the test proves the implementation's extra reset check is
  // needed, rather than merely asserting the implementation's own output.
  const naiveKbps = ((900_000 - 1_000_000) * 8) / 1000 / (elapsedMs / 1000);
  check('朴素相减确实得到负数码率（证明该缺陷真实存在）', naiveKbps < 0, true);
  check('朴素结果的具体值 -800 kbps', naiveKbps, -800);

  const delta = M.pullStats(prev, next, elapsedMs);
  check('实现把回退的码率钳为 0 而不是负数', delta.streams[0].bitrateKbps, 0);
  check('实现标记为计数器重置', delta.streams[0].reset, true);
  check('总码率也不为负', delta.bitrateKbps, 0);
  check('回退时帧率不采信', delta.streams[0].fps, null);
  check('回退时不计算丢包率', delta.streams[0].packetLossPercent, null);
  check('delta 级别也标记重置', delta.reset, true);
}

console.log('--- 统计：丢失计数器单独回退也丢弃整段 ---');
{
  const prev = snapshot(0, [stream({ direction: 'recv', bytes: 0, packets: 1000, packetsLost: 10 })]);
  const next = snapshot(1000, [
    stream({ direction: 'recv', bytes: 100_000, packets: 1500, packetsLost: 5 }),
  ]);
  const delta = M.pullStats(prev, next, 1000);
  check('只有丢包计数回退也标记重置', delta.reset, true);
  check('整段码率被丢弃而不是得到 800 kbps', delta.streams[0].bitrateKbps, 0);
}

console.log('--- 统计：elapsed 为 0 / 首帧 / 缺失计数器 ---');
{
  const prev = snapshot(0, [stream({ bytes: 1000, packets: 10, frames: 1 })]);
  const next = snapshot(0, [stream({ bytes: 2000, packets: 20, frames: 2 })]);
  const zero = M.pullStats(prev, next, 0);
  check('elapsed 为 0 时码率为 0', zero.bitrateKbps, 0);
  check('elapsed 为 0 时 fps 为 null', zero.streams[0].fps, null);
  check('elapsed 为 0 时丢包率为 null', zero.streams[0].packetLossPercent, null);
  check('elapsed 为 0 时不是重置', zero.streams[0].reset, false);
  check('elapsed 为 0 时不产生 NaN', Number.isNaN(zero.bitrateKbps), false);
  check('elapsed 为负数时按 0 处理', M.pullStats(prev, next, -500).elapsedMs, 0);

  const first = M.pullStats(null, next, 1000);
  check('没有上一份快照时不能编造码率', first.bitrateKbps, 0);
  check('没有上一份快照时标记重置（视为基准）', first.reset, true);

  const fallback = M.pullStats(
    snapshot(0, [stream({ frames: 0 })]),
    snapshot(1000, [stream({ frames: 0, framesPerSecond: 24 })]),
    1000,
  );
  check('帧计数缺失时退回 stats 的瞬时帧率', fallback.streams[0].fps, 24);

  const noLossDenominator = M.pullStats(
    snapshot(0, [stream({ direction: 'recv', packets: 10, packetsLost: 0 })]),
    snapshot(1000, [stream({ direction: 'recv', packets: 10, packetsLost: 0 })]),
    1000,
  );
  check('没有新增包时不计算 0/0 丢包率', noLossDenominator.streams[0].packetLossPercent, null);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

console.log('--- 格式化 ---');
{
  check('0 kbps', M.formatBitrate(0), '0 kbps');
  check('负数码率按 0', M.formatBitrate(-10), '0 kbps');
  check('NaN 码率按 0', M.formatBitrate(Number.NaN), '0 kbps');
  check('512.34 kbps 保留一位', M.formatBitrate(512.34), '512.3 kbps');
  check('999.9 仍是 kbps', M.formatBitrate(999.9), '999.9 kbps');
  check('1000 kbps = 1 Mbps', M.formatBitrate(1000), '1 Mbps');
  check('1500 kbps = 1.5 Mbps', M.formatBitrate(1500), '1.5 Mbps');
  check('12345 kbps = 12.3 Mbps', M.formatBitrate(12345), '12.3 Mbps');

  check('0 毫秒', M.formatDuration(0), '00:00');
  check('999 毫秒向下取整', M.formatDuration(999), '00:00');
  check('1 秒', M.formatDuration(1000), '00:01');
  check('59 秒', M.formatDuration(59_000), '00:59');
  check('60 秒进一分钟', M.formatDuration(60_000), '01:00');
  check('59:59', M.formatDuration(3_599_000), '59:59');
  check('一小时带小时位', M.formatDuration(3_600_000), '1:00:00');
  check('负数按 0', M.formatDuration(-1), '00:00');
  check('NaN 按 0', M.formatDuration(Number.NaN), '00:00');

  check('丢包率 null 显示破折号', M.formatPacketLoss(null), '—');
  check('0% 丢包', M.formatPacketLoss(0), '0%');
  check('1.234% 保留一位', M.formatPacketLoss(1.234), '1.2%');
  check('延迟 null', M.formatMs(null), '—');
  check('20.4 ms 四舍五入', M.formatMs(20.4), '20 ms');
  check('分辨率', M.formatResolution(1280, 720), '1280 × 720');
  check('缺失分辨率', M.formatResolution(null, null), '—');
  check('帧率', M.formatFps(30), '30 fps');
  check('缺失帧率', M.formatFps(null), '—');
}

// ---------------------------------------------------------------------------
// Codec preference, capture plan, ICE servers
// ---------------------------------------------------------------------------

console.log('--- 编解码偏好与采源计划 ---');
{
  const capabilities = [
    { mimeType: 'video/VP8' },
    { mimeType: 'video/H264' },
    { mimeType: 'video/rtx' },
    { mimeType: 'video/VP9' },
  ];
  check(
    'H.264 偏好被移到最前，其它顺序不变',
    M.orderCodecsForPreference(capabilities, 'h264').map((codec) => codec.mimeType),
    ['video/H264', 'video/VP8', 'video/rtx', 'video/VP9'],
  );
  check(
    'VP9 偏好被移到最前',
    M.orderCodecsForPreference(capabilities, 'vp9').map((codec) => codec.mimeType),
    ['video/VP9', 'video/VP8', 'video/H264', 'video/rtx'],
  );
  check(
    '不支持的 AV1 偏好保持原顺序（忽略而不是丢弃）',
    M.orderCodecsForPreference(capabilities, 'av1').map((codec) => codec.mimeType),
    ['video/VP8', 'video/H264', 'video/rtx', 'video/VP9'],
  );
  check(
    'auto 保持原顺序',
    M.orderCodecsForPreference(capabilities, 'auto').map((codec) => codec.mimeType),
    ['video/VP8', 'video/H264', 'video/rtx', 'video/VP9'],
  );
  check('浏览器报告 H.264', M.hasCodecPreference(capabilities, 'h264'), true);
  check('浏览器没有报告 AV1', M.hasCodecPreference(capabilities, 'av1'), false);
  check('auto 总是可用', M.hasCodecPreference([], 'auto'), true);

  check('摄像头 + 麦克风', M.capturePlan('camera-mic'), {
    api: 'getUserMedia',
    video: true,
    audio: true,
  });
  check('仅摄像头', M.capturePlan('camera'), { api: 'getUserMedia', video: true, audio: false });
  check('仅麦克风', M.capturePlan('mic'), { api: 'getUserMedia', video: false, audio: true });
  check('屏幕共享走 getDisplayMedia', M.capturePlan('screen'), {
    api: 'getDisplayMedia',
    video: true,
    audio: true,
  });
}

console.log('--- ICE 服务器解析 ---');
{
  check('留空表示不用 ICE 服务器', M.parseIceServers(''), { servers: [], invalid: [] });
  check('注释与空行被忽略', M.parseIceServers('# 注释\n\n  '), { servers: [], invalid: [] });

  const stun = M.parseIceServers('stun:stun.l.google.com:19302');
  check('单个 STUN', stun.servers.length, 1);
  check('STUN URL', stun.servers[0].urls, ['stun:stun.l.google.com:19302']);
  check('没有用户名时没有凭据字段', stun.servers[0].username, undefined);

  const mixed = M.parseIceServers(
    ' stun:stun.example.com:19302 \nturn:turn.example.com:3478\nstun:stun.example.com:19302\n',
    ' user ',
    ' pass ',
  );
  check('多行解析为一组 URL', mixed.servers[0].urls, [
    'stun:stun.example.com:19302',
    'turn:turn.example.com:3478',
  ]);
  check('重复 URL 被去掉', mixed.servers[0].urls.length, 2);
  check('TURN 用户名被去除两端空格', mixed.servers[0].username, 'user');
  check('TURN 密码被去除两端空格', mixed.servers[0].credential, 'pass');

  const invalid = M.parseIceServers('http://example.com\nstun:ok.example.com:19302\nstun:');
  check('非 STUN/TURN 协议被列入无效行', invalid.invalid, ['http://example.com', 'stun:']);
  check('有效行仍被保留', invalid.servers[0].urls, ['stun:ok.example.com:19302']);

  const onlyName = M.parseIceServers('turn:turn.example.com:3478', 'user', '');
  check('缺密码时不附带半套凭据', onlyName.servers[0].username, undefined);
  check('大写协议也接受', M.parseIceServers('STUN:stun.example.com:19302').servers.length, 1);
}

// ---------------------------------------------------------------------------
// Support and error explanations
// ---------------------------------------------------------------------------

console.log('--- 环境与错误说明 ---');
{
  check('非安全上下文优先报告', M.describeRtcSupport(false, true), 'insecure');
  check('非安全上下文即使有 API 也报告', M.describeRtcSupport(false, false), 'insecure');
  check('安全上下文但缺 API', M.describeRtcSupport(true, false), 'unsupported');
  check('安全上下文且有 API', M.describeRtcSupport(true, true), 'ok');

  const captureCases = [
    ['NotAllowedError', 'denied'],
    ['NotFoundError', 'not-found'],
    ['NotReadableError', 'busy'],
    ['OverconstrainedError', 'constraints'],
    ['AbortError', 'aborted'],
    ['SecurityError', 'insecure'],
    ['TypeError', 'unsupported'],
    ['', 'unknown'],
  ];
  const wrongKinds = [];
  const emptyDetails = [];
  for (const [name, kind] of captureCases) {
    const explained = M.explainCaptureError(name, '');
    if (explained.kind !== kind) wrongKinds.push(`${name} → ${explained.kind}`);
    if (explained.title === '' || explained.detail === '') emptyDetails.push(name);
  }
  check('采集错误名映射到正确类别', wrongKinds, []);
  check('每条采集错误都有标题与说明', emptyDetails, []);

  const fetchFailure = M.explainFetchFailure('Failed to fetch');
  check('网络错误说明提到 CORS', /CORS|跨域/.test(fetchFailure.detail), true);
  check('网络错误说明提到 Location 暴露', /Expose-Headers|Location/.test(fetchFailure.detail), true);
  check('网络错误说明提到 HTTPS 混合内容', /HTTPS|https/.test(fetchFailure.detail), true);
  check('网络错误保留浏览器原文', /Failed to fetch/.test(fetchFailure.detail), true);

  const answerFailure = M.explainAnswerError('Invalid SDP line');
  check('answer 错误说明提到 answer', /answer/i.test(answerFailure.detail), true);
  check('answer 错误保留浏览器原文', /Invalid SDP line/.test(answerFailure.detail), true);
}

// ---------------------------------------------------------------------------
// Token masking and diagnostic report
// ---------------------------------------------------------------------------

console.log('--- token 打码 ---');
{
  check('空 token 标为未设置', M.maskToken(''), '未设置');
  check('空白 token 标为未设置', M.maskToken('   '), '未设置');
  check('短 token 被完全隐藏', M.maskToken('abc'), '已设置（已打码）');
  check('长 token 被完全隐藏', M.maskToken('super-secret-token-123'), '已设置（已打码）');
  check('打码结果不包含原文', M.maskToken('super-secret-token-123').includes('secret'), false);

  const masked = M.maskUrlSecrets('https://example.com/whip?token=abc123&app=live&stream=cam');
  check('查询参数里的 token 被打码', masked.includes('abc123'), false);
  check('打码占位符存在', masked.includes('REDACTED'), true);
  check('非敏感参数保留', masked.includes('stream=cam'), true);
  check('userinfo 密码被打码', M.maskUrlSecrets('https://user:pass@example.com/whip').includes('pass'), false);
  check('无法解析的地址原样返回', M.maskUrlSecrets('not a url'), 'not a url');
}

console.log('--- 诊断报告 ---');
{
  const sendPrev = snapshot(0, [stream({ bytes: 0, packets: 0, frames: 0 })]);
  const sendNext = snapshot(
    1000,
    [stream({ bytes: 125_000, packets: 100, frames: 30, frameWidth: 1280, frameHeight: 720 })],
    { roundTripTimeMs: 25, availableOutgoingBitrateKbps: 1200 },
  );
  const sendDelta = M.pullStats(sendPrev, sendNext, 1000);

  const report = M.buildDiagnosticReport({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) TestBrowser/1.0',
    createdAt: '2026-10-23T12:00:00.000Z',
    push: {
      endpoint: 'https://example.com/whip?token=abc123&app=live',
      token: 'super-secret-token-123',
      state: '已连接',
      connectionState: 'connected',
      iceState: 'connected',
      codecs: '视频 VP8/90000，音频 opus/48000/2',
      stats: sendDelta,
      timeline: [
        { atMs: 0, text: '开始推流' },
        { atMs: 1234, text: 'connectionState=connected' },
      ],
      error: null,
      warning: '服务器没有返回可用的 Location 头。',
    },
    pull: {
      endpoint: 'https://example.com/whep',
      token: '',
      state: '失败',
      connectionState: 'failed',
      iceState: 'failed',
      codecs: '尚未协商',
      stats: null,
      timeline: [],
      error: '拉流请求失败（HTTP 400）：bad offer',
      warning: null,
    },
  });

  check('报告包含标题', report.includes('WebRTC 推拉流诊断报告'), true);
  check('报告包含生成时间', report.includes('2026-10-23T12:00:00.000Z'), true);
  check('报告包含 User-Agent', report.includes('TestBrowser/1.0'), true);
  check('报告包含推流小节', report.includes('推流（WHIP）'), true);
  check('报告包含拉流小节', report.includes('拉流（WHEP）'), true);
  check('报告包含协商编解码', report.includes('视频 VP8/90000'), true);
  check('报告包含统计码率', report.includes(M.formatBitrate(sendDelta.bitrateKbps)), true);
  check('报告包含 RTT 字段', report.includes('RTT：25 ms'), true);
  check('报告包含可用发送带宽', report.includes(M.formatBitrate(1200)), true);
  check('报告包含状态时间线', report.includes('connectionState=connected'), true);
  check('报告包含时间线相对时间', report.includes('[+00:01]'), true);
  check('报告包含警告', report.includes('没有返回可用的 Location'), true);
  check('报告包含错误', report.includes('拉流请求失败（HTTP 400）'), true);
  check('空 token 显示未设置', report.includes('未设置'), true);
  check('已设置的 token 显示已打码', report.includes('已设置（已打码）'), true);
  check('报告绝不含 token 原文', report.includes('super-secret-token-123'), false);
  check('报告绝不含 URL 里的 token 值', report.includes('abc123'), false);
  check('报告中的地址 token 被替换', report.includes('REDACTED'), true);
  check('报告明确说明不能证明媒体送达', /不能.*媒体|无法.*媒体|不代表服务端/.test(report), true);
}

// ---------------------------------------------------------------------------
// Source scans: purity and the browser-only boundary
// ---------------------------------------------------------------------------

console.log('--- 纯逻辑与浏览器 API 的边界 ---');
{
  function codeWithoutComments(file) {
    return ts.transpileModule(readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        removeComments: true,
      },
    }).outputText;
  }

  const utilsCode = codeWithoutComments(UTILS_PATH);
  const componentCode = codeWithoutComments(COMPONENT_PATH);

  check('纯函数文件不 import React', /from ['"]react['"]/.test(utilsCode), false);
  check('纯函数文件不访问 document', /\bdocument\s*\./.test(utilsCode), false);
  check('纯函数文件不访问 window', /\bwindow\s*\./.test(utilsCode), false);
  check('纯函数文件不访问 navigator', /\bnavigator\s*\./.test(utilsCode), false);
  check('纯函数文件不调用 fetch', /\bfetch\s*\(/.test(utilsCode), false);
  check('纯函数文件不构造 RTCPeerConnection', /new\s+RTCPeerConnection/.test(utilsCode), false);
  check('纯函数文件不读取时钟', /\b(Date\.now|performance\.now)\s*\(/.test(utilsCode), false);
  check('纯函数文件不构造 Date', /new\s+Date\s*\(/.test(utilsCode), false);

  check('组件确实构造 RTCPeerConnection', /new\s+RTCPeerConnection/.test(componentCode), true);
  check('组件确实使用 WHIP/WHEP 的 POST', /method:\s*'POST'/.test(componentCode), true);
  check('组件确实使用 DELETE 释放资源', /method:\s*'DELETE'/.test(componentCode), true);
  check('推流使用 getUserMedia', /getUserMedia/.test(componentCode), true);
  check('屏幕共享使用 getDisplayMedia', /getDisplayMedia/.test(componentCode), true);
  check('拉流使用 recvonly transceiver', /addTransceiver\(\s*'video'\s*,\s*\{\s*direction:\s*'recvonly'/.test(componentCode), true);
  check('拉流 video 元素带 autoplay playsInline muted', /autoPlay[\s\S]{0,120}playsInline[\s\S]{0,120}muted/.test(componentCode), true);
  check('停止时停止所有轨道', /track\.stop\(\)/.test(componentCode), true);
  check('停止时关闭 PeerConnection', /\.pc\.close\(\)/.test(componentCode), true);
  check('卸载清理里清除定时器', /clearInterval/.test(componentCode), true);
  check('组件使用 Authorization 头', /headers\.Authorization\s*=\s*`Bearer \$\{token\}`/.test(componentCode), true);
  check(
    '组件没有把 h1 放进工具页',
    /<h1[\s>]/.test(componentCode) || /as="h1"/.test(componentCode),
    false,
  );
}


console.log('\n--- 相对 Location（HTTP 允许，很多服务端这样返回）---');
{
  // A server answering with `/resource/abc` is legal and common. Rejecting it
  // means never sending the DELETE that RFC 9725 requires on stop, which is
  // exactly what a mirroring mock exposed during verification.
  const relative = M.resolveLocation('/resource/abc', 'https://media.example.com/whip');
  check('相对路径按请求地址解析', relative.ok && relative.url, 'https://media.example.com/resource/abc');

  const bareRelative = M.resolveLocation('resource/abc', 'https://media.example.com/live/whip');
  check('不带斜杠的相对路径按目录解析', bareRelative.ok && bareRelative.url, 'https://media.example.com/live/resource/abc');

  const absolute = M.resolveLocation('https://other.example.com/res/1', 'https://media.example.com/whip');
  check('绝对地址原样使用', absolute.ok && absolute.url, 'https://other.example.com/res/1');

  const protocolRelative = M.resolveLocation('//cdn.example.com/res/1', 'https://media.example.com/whip');
  check('协议相对地址继承协议', protocolRelative.ok && protocolRelative.url, 'https://cdn.example.com/res/1');

  const noBase = M.resolveLocation('/resource/abc', null);
  check('相对地址缺少基地址时明确失败', noBase.ok, false);
  check('失败原因可读', typeof noBase.error === 'string' && noBase.error.length > 0, true);

  const wrongScheme = M.resolveLocation('ftp://x/y', 'https://media.example.com/whip');
  check('非 HTTP(S) 被拒绝', wrongScheme.ok, false);

  const parsed = M.parseWhipResponse({
    status: 201,
    headers: { Location: '/resource/abc' },
    body: MINIMAL_ANSWER_SDP,
    requestUrl: 'https://media.example.com/whip',
  });
  check('解析器给出可用的资源地址', parsed.resourceUrl, 'https://media.example.com/resource/abc');
  check('不再产生「Location 不可用」的警告', parsed.warning, null);

  const withoutBase = M.parseWhipResponse({ status: 201, headers: { Location: '/x' }, body: MINIMAL_ANSWER_SDP });
  check('没有请求地址时仍给出警告而不是静默', typeof withoutBase.warning === 'string', true);
}

console.log('\n' + (usingFixture ? 'SDP 样本：真实 Chromium offer' : 'SDP 样本：内置等价样本'));
console.log(`${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
