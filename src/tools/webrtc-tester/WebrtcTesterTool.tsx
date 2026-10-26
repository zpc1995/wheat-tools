import {
  Badge,
  Button,
  Caption1,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowSyncRegular,
  CopyRegular,
  PlayRegular,
  StopRegular,
} from '@fluentui/react-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildDiagnosticReport,
  buildEndpoint,
  buildRtmpHint,
  capturePlan,
  describeRtcSupport,
  explainAnswerError,
  explainCaptureError,
  explainFetchFailure,
  formatBitrate,
  formatCodecSummary,
  formatDuration,
  formatFps,
  formatMs,
  formatPacketLoss,
  formatResolution,
  hasCodecPreference,
  isWebrtcUrlInput,
  isWhipWhepPath,
  normalizeEndpoint,
  orderCodecsForPreference,
  parseIceServers,
  parseSdp,
  parseWhipResponse,
  parseWebrtcUrl,
  pullStats,
  type CaptureSource,
  type CodecPreference,
  type DiagnosticSession,
  type DiagnosticTimelineEntry,
  type RtmpHint,
  type RtpSnapshot,
  type StatsDelta,
  type StatsSnapshot,
  type UiExplanation,
  type WebrtcAddress,
  type WebrtcEndpointKind,
} from './webrtcUtils';

type SessionDirection = 'push' | 'pull';
type PanelPhase = 'idle' | 'starting' | 'live' | 'stopping' | 'error';

interface PanelState {
  phase: PanelPhase;
  /** The normalised endpoint the session was started with, kept for the report. */
  endpoint: string;
  /** The token the session was started with; only ever rendered masked. */
  token: string;
  connectionState: string;
  iceState: string;
  error: UiExplanation | null;
  warning: string | null;
  resourceUrl: string | null;
  offerSdp: string;
  answerSdp: string;
  codecs: string;
  stats: StatsDelta | null;
  timeline: DiagnosticTimelineEntry[];
}

const EMPTY_PANEL: PanelState = {
  phase: 'idle',
  endpoint: '',
  token: '',
  connectionState: '',
  iceState: '',
  error: null,
  warning: null,
  resourceUrl: null,
  offerSdp: '',
  answerSdp: '',
  codecs: '',
  stats: null,
  timeline: [],
};

/** Everything the cleanup path needs, independent of React state. */
interface ActiveSession {
  pc: RTCPeerConnection;
  stream: MediaStream | null;
  resourceUrl: string | null;
  token: string;
  startedAt: number;
  prevStats: StatsSnapshot | null;
  prevStatsAt: number | null;
  timer: number | null;
  /** Set by stop and unmount; every await in the start path re-checks it. */
  disposed: boolean;
  timeline: DiagnosticTimelineEntry[];
}

/**
 * What the pull address field currently means.
 *
 * The field accepts two shapes and decides by prefix. Both paths end in the same
 * `url`, which is the only value the WHEP flow posts to — so adding webrtc://
 * support does not grow a second connection implementation.
 */
interface PullDerivation {
  mode: 'http' | 'webrtc';
  /** HTTP WHEP endpoint to POST to, or null while the input is not usable. */
  url: string | null;
  /** Reason the input is unusable, or null. */
  error: string | null;
  /** Assumptions made while deriving; shown verbatim so none stays silent. */
  notes: string[];
  address: WebrtcAddress | null;
  rtmp: RtmpHint | null;
}

const STATS_INTERVAL_MS = 1000;
/** Long enough for ordinary STUN, short enough not to look frozen. */
const ICE_GATHER_TIMEOUT_MS = 3000;

const PHASE_LABEL: Record<PanelPhase, string> = {
  idle: '未开始',
  starting: '连接中',
  live: '已连接',
  stopping: '正在停止',
  error: '失败',
};

type BadgeColor = 'subtle' | 'informative' | 'success' | 'warning' | 'danger';

const PHASE_COLOR: Record<PanelPhase, BadgeColor> = {
  idle: 'subtle',
  starting: 'informative',
  live: 'success',
  stopping: 'warning',
  error: 'danger',
};

const SOURCE_OPTIONS: { value: CaptureSource; label: string }[] = [
  { value: 'camera-mic', label: '摄像头 + 麦克风' },
  { value: 'camera', label: '仅摄像头' },
  { value: 'mic', label: '仅麦克风' },
  { value: 'screen', label: '屏幕共享' },
];

const CODEC_OPTIONS: { value: CodecPreference; label: string }[] = [
  { value: 'auto', label: '自动（不干预）' },
  { value: 'h264', label: 'H.264' },
  { value: 'vp8', label: 'VP8' },
  { value: 'vp9', label: 'VP9' },
  { value: 'av1', label: 'AV1' },
];

const EXAMPLE_PUSH = 'https://your-server:8080/whip';
const EXAMPLE_PULL = 'https://your-server:8080/whep';
const EXAMPLE_PULL_WEBRTC = 'webrtc://your-server/live/streamA';
const DEFAULT_CUSTOM_TEMPLATE = '{scheme}://{host}:{port}/{app}/{stream}/whep';

const PULL_KIND_OPTIONS: { value: WebrtcEndpointKind; label: string }[] = [
  { value: 'srs', label: 'SRS 6+' },
  { value: 'mediamtx', label: 'mediamtx' },
  { value: 'custom', label: '自定义模板' },
];

const MONO_FONT = 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace';

const useStyles = makeStyles({
  column: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    width: '100%',
    minWidth: 0,
    padding: '14px 16px 20px',
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    width: '100%',
    minWidth: 0,
    padding: '14px',
    borderRadius: '10px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: '10px',
    width: '100%',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: '150px',
    flex: '0 1 auto',
  },
  fieldWide: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: '260px',
    flex: '1 1 340px',
  },
  fieldLabel: {
    color: tokens.colorNeutralForeground3,
  },
  controls: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
  },
  statusRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
  },
  video: {
    width: '100%',
    maxHeight: '360px',
    display: 'block',
    borderRadius: '8px',
    backgroundColor: '#000',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontVariantNumeric: 'tabular-nums',
    fontSize: '13px',
  },
  headCell: {
    textAlign: 'left',
    padding: '6px 10px',
    color: tokens.colorNeutralForeground3,
    fontWeight: 600,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    whiteSpace: 'nowrap',
  },
  cell: {
    padding: '5px 10px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    whiteSpace: 'nowrap',
  },
  numeric: {
    fontFamily: MONO_FONT,
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'right',
  },
  metaLine: {
    color: tokens.colorNeutralForeground3,
    fontVariantNumeric: 'tabular-nums',
  },
  timeline: {
    margin: 0,
    paddingLeft: '20px',
    maxHeight: '190px',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    color: tokens.colorNeutralForeground2,
    fontVariantNumeric: 'tabular-nums',
  },
  mono: {
    fontFamily: MONO_FONT,
    color: tokens.colorNeutralForeground3,
  },
  sdp: {
    width: '100%',
    minHeight: '120px',
    maxHeight: '240px',
    fontFamily: MONO_FONT,
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
  },
  details: {
    width: '100%',
    color: tokens.colorNeutralForeground2,
  },
  notes: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  noteList: {
    margin: 0,
    paddingLeft: '20px',
    color: tokens.colorNeutralForeground3,
  },
  endpointBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    width: '100%',
    minWidth: 0,
    padding: '10px 12px',
    borderRadius: '8px',
    border: `1px solid ${tokens.colorBrandStroke1}`,
    backgroundColor: tokens.colorBrandBackground2,
  },
  endpointUrl: {
    fontFamily: MONO_FONT,
    fontSize: '16px',
    fontWeight: 600,
    lineHeight: '22px',
    wordBreak: 'break-all',
    color: tokens.colorNeutralForeground1,
  },
  hintBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    width: '100%',
    minWidth: 0,
    padding: '10px 12px',
    borderRadius: '8px',
    border: `1px dashed ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  report: {
    width: '100%',
    minHeight: '220px',
    maxHeight: '360px',
    fontFamily: MONO_FONT,
    fontSize: '12px',
  },
});

function withWarning(current: string | null, note: string | null): string | null {
  if (note === null || note === '') return current;
  return current === null || current === '' ? note : `${current} ${note}`;
}

async function deleteResource(resourceUrl: string, token: string): Promise<void> {
  // RFC 9725: the client releases the WHIP/WHEP resource with DELETE on the
  // Location URL. This is best effort — the connection is already going away,
  // and a failure here must not make stopping look like it failed.
  try {
    const headers: Record<string, string> = {};
    if (token !== '') headers.Authorization = `Bearer ${token}`;
    await fetch(resourceUrl, { method: 'DELETE', headers });
  } catch {
    // Ignored on purpose: nothing useful can be done once the page is leaving.
  }
}

/** Stops media first, then closes the peer connection and releases the resource. */
function closeActiveSession(session: ActiveSession, releaseResource: boolean): void {
  session.disposed = true;
  if (session.timer !== null) {
    window.clearInterval(session.timer);
    session.timer = null;
  }
  if (releaseResource && session.resourceUrl !== null) {
    void deleteResource(session.resourceUrl, session.token);
  }
  if (session.stream !== null) {
    for (const track of session.stream.getTracks()) track.stop();
    session.stream = null;
  }
  session.pc.onconnectionstatechange = null;
  session.pc.oniceconnectionstatechange = null;
  session.pc.ontrack = null;
  try {
    session.pc.close();
  } catch {
    // Already closed; nothing to recover.
  }
}

/**
 * Waits until ICE gathering finishes so the offer includes candidates.
 *
 * This client posts the offer once, with no trickle ICE and no PATCH, because
 * that is the simple interoperable subset of RFC 9725. Without waiting, the SDP
 * sent to the server usually contains no candidates yet and the server has no
 * way to learn them later. The timeout prevents an unreachable STUN server from
 * blocking the test forever; the caller reports that the offer may be partial.
 */
function waitForIceGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<boolean> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (complete: boolean) => {
      if (settled) return;
      settled = true;
      pc.removeEventListener('icegatheringstatechange', onChange);
      window.clearTimeout(timer);
      resolve(complete);
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') finish(true);
    };
    const timer = window.setTimeout(() => finish(pc.iceGatheringState === 'complete'), timeoutMs);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mergeStream(map: Map<string, RtpSnapshot>, stream: RtpSnapshot): void {
  const key = `${stream.kind}:${stream.direction}`;
  const previous = map.get(key);
  if (previous === undefined) {
    map.set(key, stream);
    return;
  }
  const width = Math.max(previous.frameWidth ?? 0, stream.frameWidth ?? 0);
  const height = Math.max(previous.frameHeight ?? 0, stream.frameHeight ?? 0);
  map.set(key, {
    kind: stream.kind,
    direction: stream.direction,
    bytes: previous.bytes + stream.bytes,
    packets: previous.packets + stream.packets,
    packetsLost: previous.packetsLost + stream.packetsLost,
    frames: previous.frames + stream.frames,
    framesPerSecond: stream.framesPerSecond ?? previous.framesPerSecond ?? null,
    jitterMs: stream.jitterMs ?? previous.jitterMs ?? null,
    frameWidth: width > 0 ? width : null,
    frameHeight: height > 0 ? height : null,
  });
}

/**
 * Reads one `getStats` snapshot into the plain object `pullStats` consumes.
 *
 * Simulcast can produce several outbound or inbound entries of the same kind, so
 * counters are summed per kind. The round-trip time lives on the selected
 * candidate pair rather than on the RTP stream; `remote-inbound-rtp` is used as
 * a fallback for the sending side.
 */
async function collectStats(
  pc: RTCPeerConnection,
  direction: 'send' | 'recv',
): Promise<StatsSnapshot> {
  const report = await pc.getStats();
  const streams = new Map<string, RtpSnapshot>();
  const pairs: Record<string, unknown>[] = [];
  let selectedPairId: string | null = null;
  let remoteRoundTripSeconds: number | null = null;

  report.forEach((raw) => {
    const entry = raw as Record<string, unknown>;
    const type = entry.type;

    if (type === 'transport') {
      const id = entry.selectedCandidatePairId;
      if (typeof id === 'string') selectedPairId = id;
      return;
    }

    if (type === 'candidate-pair') {
      pairs.push(entry);
      return;
    }

    if (type === 'remote-inbound-rtp' && direction === 'send') {
      const rtt = numberField(entry, 'roundTripTime');
      if (rtt !== null) remoteRoundTripSeconds = rtt;
      return;
    }

    if (type === 'outbound-rtp' && direction === 'send') {
      const kind = entry.kind === 'audio' ? 'audio' : entry.kind === 'video' ? 'video' : null;
      if (kind === null) return;
      mergeStream(streams, {
        kind,
        direction: 'send',
        bytes: numberField(entry, 'bytesSent') ?? 0,
        packets: numberField(entry, 'packetsSent') ?? 0,
        packetsLost: 0,
        frames: numberField(entry, 'framesEncoded') ?? 0,
        framesPerSecond: numberField(entry, 'framesPerSecond'),
        frameWidth: numberField(entry, 'frameWidth'),
        frameHeight: numberField(entry, 'frameHeight'),
      });
      return;
    }

    if (type === 'inbound-rtp' && direction === 'recv') {
      const kind = entry.kind === 'audio' ? 'audio' : entry.kind === 'video' ? 'video' : null;
      if (kind === null) return;
      const jitterSeconds = numberField(entry, 'jitter');
      mergeStream(streams, {
        kind,
        direction: 'recv',
        bytes: numberField(entry, 'bytesReceived') ?? 0,
        packets: numberField(entry, 'packetsReceived') ?? 0,
        packetsLost: numberField(entry, 'packetsLost') ?? 0,
        frames: numberField(entry, 'framesDecoded') ?? 0,
        framesPerSecond: numberField(entry, 'framesPerSecond'),
        jitterMs: jitterSeconds === null ? null : jitterSeconds * 1000,
        frameWidth: numberField(entry, 'frameWidth'),
        frameHeight: numberField(entry, 'frameHeight'),
      });
    }
  });

  const selected =
    (selectedPairId === null ? undefined : pairs.find((pair) => pair.id === selectedPairId)) ??
    pairs.find((pair) => pair.selected === true || pair.nominated === true);

  const pairRtt = selected === undefined ? null : numberField(selected, 'currentRoundTripTime');
  const available = selected === undefined ? null : numberField(selected, 'availableOutgoingBitrate');
  const roundTripMs =
    pairRtt !== null ? pairRtt * 1000 : remoteRoundTripSeconds !== null ? remoteRoundTripSeconds * 1000 : null;

  return {
    timestampMs: performance.now(),
    streams: [...streams.values()],
    roundTripTimeMs: roundTripMs,
    availableOutgoingBitrateKbps: available === null ? null : available / 1000,
  };
}

/**
 * Applies the codec preference to every video transceiver.
 *
 * Returns a warning when the browser does not support the requested codec, or
 * when `setCodecPreferences` refuses. The caller shows it and continues: a codec
 * preference is a hint in browsers, never a guarantee, and the answer SDP is
 * what actually decides.
 */
function applyCodecPreference(
  pc: RTCPeerConnection,
  preference: CodecPreference,
): string | null {
  if (preference === 'auto') return null;
  const label = preference.toUpperCase();
  const capabilities = RTCRtpSender.getCapabilities('video');
  const codecs = capabilities?.codecs ?? [];
  if (!hasCodecPreference(codecs, preference)) {
    return `当前浏览器没有报告 ${label} 编码能力，已忽略该偏好，由浏览器自动协商。`;
  }

  const ordered = orderCodecsForPreference(codecs, preference);
  let failed = false;
  let applied = 0;
  for (const transceiver of pc.getTransceivers()) {
    const kind = transceiver.sender.track?.kind ?? transceiver.receiver.track.kind;
    if (kind !== 'video') continue;
    try {
      transceiver.setCodecPreferences(ordered);
      applied += 1;
    } catch {
      failed = true;
    }
  }

  if (failed || applied === 0) {
    return `已请求 ${label} 偏好，但 setCodecPreferences 未生效；最终编码仍以服务端 answer 为准。`;
  }
  return null;
}

function countLines(text: string): number {
  return text === '' ? 0 : text.split(/\r?\n/).length;
}

function phaseBadge(phase: PanelPhase) {
  return (
    <Badge appearance="filled" color={PHASE_COLOR[phase]}>
      {PHASE_LABEL[phase]}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

function TimelineList({ entries }: { entries: DiagnosticTimelineEntry[] }) {
  const styles = useStyles();
  if (entries.length === 0) {
    return <Caption1 className={styles.metaLine}>还没有状态变化。</Caption1>;
  }
  return (
    <ul className={styles.timeline}>
      {entries.map((entry, index) => (
        <li key={`${entry.atMs}-${index}`}>
          <span className={styles.mono}>[+{formatDuration(entry.atMs)}]</span> {entry.text}
        </li>
      ))}
    </ul>
  );
}

function StreamStatsTable({
  delta,
  direction,
}: {
  delta: StatsDelta | null;
  direction: SessionDirection;
}) {
  const styles = useStyles();
  if (delta === null) {
    return (
      <Caption1 className={styles.metaLine}>
        尚无统计。连接建立后每秒读取一次 getStats；第一次采样只建立基准，第二个采样起才有码率。
      </Caption1>
    );
  }

  const pull = direction === 'pull';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.headCell}>流</th>
            <th className={styles.headCell}>码率</th>
            <th className={styles.headCell}>帧率</th>
            <th className={styles.headCell}>分辨率</th>
            {pull && <th className={styles.headCell}>丢包率</th>}
            {pull && <th className={styles.headCell}>抖动</th>}
          </tr>
        </thead>
        <tbody>
          {delta.streams.length === 0 ? (
            <tr>
              <td className={styles.cell} colSpan={pull ? 6 : 4}>
                暂无可用的 RTP 统计条目（可能连接尚未真正建立）。
              </td>
            </tr>
          ) : (
            delta.streams.map((stream) => (
              <tr key={`${stream.kind}-${stream.direction}`}>
                <td className={styles.cell}>
                  {stream.direction === 'send' ? '发送' : '接收'}
                  {stream.kind === 'video' ? '视频' : '音频'}
                </td>
                <td className={`${styles.cell} ${styles.numeric}`}>
                  {formatBitrate(stream.bitrateKbps)}
                </td>
                <td className={`${styles.cell} ${styles.numeric}`}>{formatFps(stream.fps)}</td>
                <td className={`${styles.cell} ${styles.numeric}`}>
                  {formatResolution(stream.frameWidth, stream.frameHeight)}
                </td>
                {pull && (
                  <td className={`${styles.cell} ${styles.numeric}`}>
                    {formatPacketLoss(stream.packetLossPercent)}
                  </td>
                )}
                {pull && (
                  <td className={`${styles.cell} ${styles.numeric}`}>
                    {formatMs(stream.jitterMs)}
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
      <Caption1 className={styles.metaLine}>
        采样间隔 {formatDuration(delta.elapsedMs)} · 合计 {formatBitrate(delta.bitrateKbps)} · RTT{' '}
        {formatMs(delta.roundTripTimeMs)}
        {direction === 'push' &&
          ` · 可用发送带宽 ${
            delta.availableOutgoingBitrateKbps === null
              ? '—'
              : formatBitrate(delta.availableOutgoingBitrateKbps)
          }`}
      </Caption1>
      {delta.reset && (
        <Caption1 className={styles.metaLine}>
          检测到计数器回退（重置或回绕），这一段的增量按 0 处理，避免出现负码率。
        </Caption1>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export function WebrtcTesterTool() {
  const styles = useStyles();
  const pullVideoRef = useRef<HTMLVideoElement>(null);
  const pushRef = useRef<ActiveSession | null>(null);
  const pullRef = useRef<ActiveSession | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [pushUrl, setPushUrl] = useState('');
  const [pushToken, setPushToken] = useState('');
  const [pullUrl, setPullUrl] = useState('');
  const [pullToken, setPullToken] = useState('');
  const [pullKind, setPullKind] = useState<WebrtcEndpointKind>('srs');
  const [pullHttpPort, setPullHttpPort] = useState('');
  const [pullTemplate, setPullTemplate] = useState(DEFAULT_CUSTOM_TEMPLATE);
  const [source, setSource] = useState<CaptureSource>('camera-mic');
  const [codecPreference, setCodecPreference] = useState<CodecPreference>('auto');
  const [iceText, setIceText] = useState('');
  const [iceUsername, setIceUsername] = useState('');
  const [iceCredential, setIceCredential] = useState('');

  const [pushPanel, setPushPanel] = useState<PanelState>(EMPTY_PANEL);
  const [pullPanel, setPullPanel] = useState<PanelState>(EMPTY_PANEL);

  const support = useMemo(
    () =>
      describeRtcSupport(
        typeof window !== 'undefined' && window.isSecureContext === true,
        typeof RTCPeerConnection !== 'undefined',
      ),
    [],
  );
  const hasMediaDevices =
    typeof navigator !== 'undefined' && navigator.mediaDevices !== undefined;
  const canCapture = support === 'ok' && hasMediaDevices;

  const iceParsed = useMemo(
    () => parseIceServers(iceText, iceUsername, iceCredential),
    [iceText, iceUsername, iceCredential],
  );

  // One derivation feeds both the visible preview and startPull, so the endpoint
  // the user reads is always the endpoint that is actually posted to.
  const pullDerivation = useMemo<PullDerivation>(() => {
    const raw = pullUrl.trim();
    if (!isWebrtcUrlInput(raw)) {
      const normalized = normalizeEndpoint(raw);
      return {
        mode: 'http',
        url: normalized.ok ? normalized.url : null,
        error: normalized.ok ? null : normalized.error,
        notes: [],
        address: null,
        rtmp: null,
      };
    }

    const address = parseWebrtcUrl(raw);
    if (!address.ok) {
      return {
        mode: 'webrtc',
        url: null,
        error: address.error,
        notes: [],
        address: null,
        rtmp: null,
      };
    }

    // An empty box means "use the address port, then the scheme default".
    const httpPort = pullHttpPort.trim() === '' ? null : Number(pullHttpPort);
    const endpoint = buildEndpoint(address, {
      kind: pullKind,
      httpPort,
      customTemplate: pullTemplate,
    });
    return {
      mode: 'webrtc',
      url: endpoint.ok ? endpoint.url : null,
      error: endpoint.ok ? null : endpoint.error,
      notes: endpoint.ok ? endpoint.notes : [],
      address,
      rtmp: buildRtmpHint(address),
    };
  }, [pullHttpPort, pullKind, pullTemplate, pullUrl]);

  const pushActive =
    pushPanel.phase === 'starting' || pushPanel.phase === 'live' || pushPanel.phase === 'stopping';
  const pullActive =
    pullPanel.phase === 'starting' || pullPanel.phase === 'live' || pullPanel.phase === 'stopping';
  const configLocked = pushActive || pullActive;

  const pushPathHint = useMemo(() => {
    const normalized = normalizeEndpoint(pushUrl);
    if (!normalized.ok) return null;
    const kind = isWhipWhepPath(normalized.url);
    if (kind === 'whep') {
      return '提示：这个地址以 /whep 结尾，看起来是拉流端点；推流通常用 /whip。仍会按填写的地址原样发送，不会阻止。';
    }
    if (kind === 'unknown') {
      return '提示：路径不以 /whip 结尾。RFC 9725 不规定路径，只要服务端在该地址提供 WHIP 端点即可；这只是提示，不会阻止发送。';
    }
    return null;
  }, [pushUrl]);

  const pullPathHint = useMemo(() => {
    // Derivation mode has its own diagnostics; the /whep suffix heuristic only
    // applies to a complete HTTP endpoint.
    if (isWebrtcUrlInput(pullUrl)) return null;
    const normalized = normalizeEndpoint(pullUrl);
    if (!normalized.ok) return null;
    const kind = isWhipWhepPath(normalized.url);
    if (kind === 'whip') {
      return '提示：这个地址以 /whip 结尾，看起来是推流端点；拉流通常用 /whep。仍会按填写的地址原样发送，不会阻止。';
    }
    if (kind === 'unknown') {
      return '提示：路径不以 /whep 结尾。RFC 9725 不规定路径，只要服务端在该地址提供 WHEP 端点即可；这只是提示，不会阻止发送。';
    }
    return null;
  }, [pullUrl]);

  const fillExamples = useCallback(() => {
    setPushUrl(EXAMPLE_PUSH);
    setPullUrl(EXAMPLE_PULL);
  }, []);

  const copyText = useCallback(async (key: string, text: string) => {
    if (text === '') return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setCopied(`${key}:failed`);
    }
  }, []);

  const iceServers = useMemo(
    () =>
      iceParsed.servers.map((server) => ({
        urls: server.urls,
        ...(server.username === undefined ? {} : { username: server.username }),
        ...(server.credential === undefined ? {} : { credential: server.credential }),
      })),
    [iceParsed],
  );

  // Release the camera/screen and both peer connections if the user navigates
  // away without pressing stop. Nothing here calls setState: the component is
  // already unmounting.
  useEffect(
    () => () => {
      const push = pushRef.current;
      if (push !== null) {
        pushRef.current = null;
        closeActiveSession(push, true);
      }
      const pull = pullRef.current;
      if (pull !== null) {
        pullRef.current = null;
        closeActiveSession(pull, true);
      }
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Push (WHIP)
  // -------------------------------------------------------------------------

  const startPush = useCallback(async () => {
    if (pushRef.current !== null) return;

    if (support !== 'ok') {
      setPushPanel({
        ...EMPTY_PANEL,
        phase: 'error',
        endpoint: pushUrl,
        token: pushToken,
        error: {
          kind: 'support',
          title: support === 'insecure' ? '需要安全上下文（HTTPS 或 localhost）' : '浏览器不支持 WebRTC',
          detail:
            support === 'insecure'
              ? '当前页面不是安全上下文。浏览器只在 HTTPS 或 localhost 上提供摄像头、麦克风与 WebRTC 相关能力，请换用 https:// 或 http://localhost 打开本页。'
              : '当前浏览器没有 RTCPeerConnection。请改用较新的 Chrome、Edge、Firefox 或 Safari。',
        },
      });
      return;
    }
    if (!hasMediaDevices) {
      setPushPanel({
        ...EMPTY_PANEL,
        phase: 'error',
        endpoint: pushUrl,
        token: pushToken,
        error: {
          kind: 'unsupported',
          title: '浏览器不提供采集接口',
          detail: '没有找到 navigator.mediaDevices，无法为推流获取摄像头或屏幕。请改用较新的浏览器并通过 HTTPS 或 localhost 打开。',
        },
      });
      return;
    }

    const normalized = normalizeEndpoint(pushUrl);
    if (!normalized.ok) {
      setPushPanel({
        ...EMPTY_PANEL,
        phase: 'error',
        endpoint: pushUrl,
        token: pushToken,
        error: { kind: 'endpoint', title: '推流地址无效', detail: normalized.error },
      });
      return;
    }
    if (iceParsed.invalid.length > 0) {
      setPushPanel({
        ...EMPTY_PANEL,
        phase: 'error',
        endpoint: normalized.url,
        token: pushToken,
        error: {
          kind: 'ice',
          title: 'ICE 服务器地址无效',
          detail: `下面这些行不是 stun:/stuns:/turn:/turns: 地址，已停止启动：${iceParsed.invalid.join('；')}`,
        },
      });
      return;
    }

    const plan = capturePlan(source);
    if (plan.api === 'getDisplayMedia' && typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      setPushPanel({
        ...EMPTY_PANEL,
        phase: 'error',
        endpoint: normalized.url,
        token: pushToken,
        error: {
          kind: 'unsupported',
          title: '浏览器不支持屏幕共享',
          detail: '没有找到 getDisplayMedia，请改用摄像头源，或换用支持屏幕共享的桌面浏览器。',
        },
      });
      return;
    }

    const token = pushToken.trim();
    const startedAt = performance.now();
    const pc = new RTCPeerConnection({ iceServers });
    const session: ActiveSession = {
      pc,
      stream: null,
      resourceUrl: null,
      token,
      startedAt,
      prevStats: null,
      prevStatsAt: null,
      timer: null,
      disposed: false,
      timeline: [],
    };
    pushRef.current = session;

    let warning: string | null = null;
    setPushPanel({
      ...EMPTY_PANEL,
      phase: 'starting',
      endpoint: normalized.url,
      token,
    });

    const mark = (text: string) => {
      session.timeline.push({ atMs: performance.now() - startedAt, text });
      setPushPanel((previous) => ({ ...previous, timeline: [...session.timeline] }));
    };
    const note = (text: string | null) => {
      warning = withWarning(warning, text);
      setPushPanel((previous) => ({ ...previous, warning }));
    };
    const stopped = () => session.disposed || pushRef.current !== session;

    pc.onconnectionstatechange = () => {
      if (stopped()) return;
      mark(`connectionState=${pc.connectionState}`);
      setPushPanel((previous) => ({ ...previous, connectionState: pc.connectionState }));
      if (pc.connectionState === 'failed') {
        note('PeerConnection 进入 failed：ICE 没有找到可用的候选对。检查 ICE 服务器（STUN/TURN）与防火墙；只有主机候选时，跨 NAT 通常连不上。');
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (stopped()) return;
      mark(`iceConnectionState=${pc.iceConnectionState}`);
      setPushPanel((previous) => ({ ...previous, iceState: pc.iceConnectionState }));
    };

    mark(`开始推流（${plan.api === 'getDisplayMedia' ? '屏幕共享' : '摄像头/麦克风'}）`);

    let stream: MediaStream;
    try {
      stream =
        plan.api === 'getDisplayMedia'
          ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: plan.audio })
          : await navigator.mediaDevices.getUserMedia({ video: plan.video, audio: plan.audio });
    } catch (caught) {
      const named = caught as { name?: string; message?: string };
      if (stopped()) return;
      closeActiveSession(session, false);
      pushRef.current = null;
      setPushPanel((previous) => ({
        ...previous,
        phase: 'error',
        error: explainCaptureError(named?.name ?? '', named?.message ?? ''),
      }));
      return;
    }

    if (stopped()) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }

    session.stream = stream;
    const kinds = stream.getTracks().map((track) => track.kind);
    if (kinds.length === 0) {
      closeActiveSession(session, false);
      pushRef.current = null;
      setPushPanel((previous) => ({
        ...previous,
        phase: 'error',
        error: {
          kind: 'capture',
          title: '没有采集到任何轨道',
          detail: '浏览器返回了空的媒体流。请重新开始并确认已选中摄像头、麦克风或屏幕。',
        },
      }));
      return;
    }
    mark(`已获取媒体源：${kinds.join(' + ')}`);

    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    note(applyCodecPreference(pc, codecPreference));

    let offerSdp = '';
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      mark('本地 offer 已生成');
      const complete = await waitForIceGathering(pc, ICE_GATHER_TIMEOUT_MS);
      offerSdp = pc.localDescription?.sdp ?? offer.sdp ?? '';
      if (offerSdp.trim() === '') throw new Error('浏览器生成的 offer SDP 为空');
      if (!complete) {
        note('ICE 候选在 3 秒内没有收集完，已发送当前 SDP；若服务端连不上，请检查 STUN/TURN 或网络。');
      }
      mark(`ICE 收集${complete ? '完成' : '超时'}，offer ${countLines(offerSdp)} 行`);
      setPushPanel((previous) => ({ ...previous, offerSdp }));
    } catch (caught) {
      const named = caught as { message?: string };
      if (stopped()) return;
      closeActiveSession(session, false);
      pushRef.current = null;
      setPushPanel((previous) => ({
        ...previous,
        phase: 'error',
        error: {
          kind: 'offer',
          title: '无法生成 offer',
          detail: `创建或应用本地 SDP 失败：${named?.message ?? '未知错误'}。这通常是浏览器的 WebRTC 实现异常，重试或换一个浏览器可能解决。`,
        },
      }));
      return;
    }

    if (stopped()) return;

    const headers: Record<string, string> = {
      'Content-Type': 'application/sdp',
      Accept: 'application/sdp',
    };
    if (token !== '') headers.Authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetch(normalized.url, {
        method: 'POST',
        headers,
        body: offerSdp,
      });
    } catch (caught) {
      const named = caught as { message?: string };
      if (stopped()) return;
      closeActiveSession(session, false);
      pushRef.current = null;
      setPushPanel((previous) => ({
        ...previous,
        phase: 'error',
        error: explainFetchFailure(named?.message ?? ''),
      }));
      return;
    }

    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch {
      bodyText = '';
    }

    const result = parseWhipResponse({
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: bodyText,
      requestUrl: normalized.url,
    });
    note(result.warning);

    if (stopped()) {
      if (result.resourceUrl !== null) void deleteResource(result.resourceUrl, token);
      return;
    }

    if (!result.ok || result.answerSdp === null) {
      closeActiveSession(session, result.resourceUrl !== null);
      pushRef.current = null;
      setPushPanel((previous) => ({
        ...previous,
        phase: 'error',
        resourceUrl: result.resourceUrl,
        warning,
        error: {
          kind: `http-${result.status}`,
          title: `推流请求失败（HTTP ${result.status}）`,
          detail: result.error ?? '服务端响应无法使用。',
        },
      }));
      return;
    }

    session.resourceUrl = result.resourceUrl;
    const answerSdp = result.answerSdp;
    mark(`收到 answer（HTTP ${result.status}${result.resourceUrl === null ? '，没有 Location' : '，已获得 Location'}）`);
    setPushPanel((previous) => ({
      ...previous,
      resourceUrl: result.resourceUrl,
      answerSdp,
      codecs: formatCodecSummary(parseSdp(answerSdp)),
      warning,
    }));

    try {
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch (caught) {
      const named = caught as { message?: string };
      if (stopped()) return;
      closeActiveSession(session, true);
      pushRef.current = null;
      setPushPanel((previous) => ({
        ...previous,
        phase: 'error',
        warning,
        error: explainAnswerError(named?.message ?? ''),
      }));
      return;
    }

    mark('远端 answer 已应用，推流通道建立');
    setPushPanel((previous) => ({
      ...previous,
      phase: 'live',
      connectionState: pc.connectionState,
      iceState: pc.iceConnectionState,
      warning,
    }));

    let sampling = false;
    const takeSample = async () => {
      if (stopped() || sampling) return;
      sampling = true;
      try {
        const snapshot = await collectStats(pc, 'send');
        if (stopped()) return;
        if (session.prevStats !== null && session.prevStatsAt !== null) {
          const delta = pullStats(
            session.prevStats,
            snapshot,
            snapshot.timestampMs - session.prevStatsAt,
          );
          setPushPanel((previous) =>
            previous.phase === 'live' ? { ...previous, stats: delta } : previous,
          );
        }
        session.prevStats = snapshot;
        session.prevStatsAt = snapshot.timestampMs;
      } catch {
        // getStats can fail while the transport is closing; the next tick retries.
      } finally {
        sampling = false;
      }
    };
    void takeSample();
    session.timer = window.setInterval(() => void takeSample(), STATS_INTERVAL_MS);
  }, [
    codecPreference,
    hasMediaDevices,
    iceParsed,
    iceServers,
    pushToken,
    pushUrl,
    source,
    support,
  ]);

  const stopPush = useCallback(() => {
    const session = pushRef.current;
    if (session === null) return;
    pushRef.current = null;
    session.timeline.push({ atMs: performance.now() - session.startedAt, text: '用户停止推流' });
    const timeline = [...session.timeline];
    closeActiveSession(session, true);
    setPushPanel((previous) => ({
      ...previous,
      phase: 'idle',
      connectionState: 'closed',
      iceState: 'closed',
      timeline,
    }));
  }, []);

  // -------------------------------------------------------------------------
  // Pull (WHEP)
  // -------------------------------------------------------------------------

  const startPull = useCallback(async () => {
    if (pullRef.current !== null) return;

    if (support !== 'ok') {
      setPullPanel({
        ...EMPTY_PANEL,
        phase: 'error',
        endpoint: pullUrl,
        token: pullToken,
        error: {
          kind: 'support',
          title: support === 'insecure' ? '需要安全上下文（HTTPS 或 localhost）' : '浏览器不支持 WebRTC',
          detail:
            support === 'insecure'
              ? '当前页面不是安全上下文。浏览器只在 HTTPS 或 localhost 上提供 WebRTC 相关能力，请换用 https:// 或 http://localhost 打开本页。'
              : '当前浏览器没有 RTCPeerConnection。请改用较新的 Chrome、Edge、Firefox 或 Safari。',
        },
      });
      return;
    }

    if (pullDerivation.url === null) {
      setPullPanel({
        ...EMPTY_PANEL,
        phase: 'error',
        endpoint: pullUrl,
        token: pullToken,
        error: {
          kind: 'endpoint',
          title: pullDerivation.mode === 'webrtc' ? 'webrtc:// 地址无法使用' : '拉流地址无效',
          detail: pullDerivation.error ?? '地址无法解析。',
        },
      });
      return;
    }
    const endpointUrl = pullDerivation.url;
    if (iceParsed.invalid.length > 0) {
      setPullPanel({
        ...EMPTY_PANEL,
        phase: 'error',
        endpoint: endpointUrl,
        token: pullToken,
        error: {
          kind: 'ice',
          title: 'ICE 服务器地址无效',
          detail: `下面这些行不是 stun:/stuns:/turn:/turns: 地址，已停止启动：${iceParsed.invalid.join('；')}`,
        },
      });
      return;
    }

    const token = pullToken.trim();
    const startedAt = performance.now();
    const pc = new RTCPeerConnection({ iceServers });
    const session: ActiveSession = {
      pc,
      stream: null,
      resourceUrl: null,
      token,
      startedAt,
      prevStats: null,
      prevStatsAt: null,
      timer: null,
      disposed: false,
      timeline: [],
    };
    pullRef.current = session;

    let warning: string | null = null;
    setPullPanel({
      ...EMPTY_PANEL,
      phase: 'starting',
      endpoint: endpointUrl,
      token,
    });

    const mark = (text: string) => {
      session.timeline.push({ atMs: performance.now() - startedAt, text });
      setPullPanel((previous) => ({ ...previous, timeline: [...session.timeline] }));
    };
    const note = (text: string | null) => {
      warning = withWarning(warning, text);
      setPullPanel((previous) => ({ ...previous, warning }));
    };
    const stopped = () => session.disposed || pullRef.current !== session;

    pc.onconnectionstatechange = () => {
      if (stopped()) return;
      mark(`connectionState=${pc.connectionState}`);
      setPullPanel((previous) => ({ ...previous, connectionState: pc.connectionState }));
      if (pc.connectionState === 'failed') {
        note('PeerConnection 进入 failed：ICE 没有找到可用的候选对。检查 ICE 服务器（STUN/TURN）与防火墙；只有主机候选时，跨 NAT 通常连不上。');
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (stopped()) return;
      mark(`iceConnectionState=${pc.iceConnectionState}`);
      setPullPanel((previous) => ({ ...previous, iceState: pc.iceConnectionState }));
    };

    // WHEP sends a receive-only offer. `addTransceiver` with direction recvonly
    // is what puts `a=recvonly` into the SDP; `addTrack` cannot do this because
    // there is no local track to add.
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    note(applyCodecPreference(pc, codecPreference));

    pc.ontrack = (event) => {
      if (stopped()) return;
      const incoming = event.streams[0] ?? new MediaStream([event.track]);
      const video = pullVideoRef.current;
      if (video !== null) {
        video.srcObject = incoming;
        void video.play().catch(() => undefined);
      }
      mark(`收到远端 ${event.track.kind} 轨道`);
    };

    mark('开始拉流（recvonly offer）');

    let offerSdp = '';
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      mark('本地 recvonly offer 已生成');
      const complete = await waitForIceGathering(pc, ICE_GATHER_TIMEOUT_MS);
      offerSdp = pc.localDescription?.sdp ?? offer.sdp ?? '';
      if (offerSdp.trim() === '') throw new Error('浏览器生成的 offer SDP 为空');
      if (!complete) {
        note('ICE 候选在 3 秒内没有收集完，已发送当前 SDP；若服务端连不上，请检查 STUN/TURN 或网络。');
      }
      mark(`ICE 收集${complete ? '完成' : '超时'}，offer ${countLines(offerSdp)} 行`);
      setPullPanel((previous) => ({ ...previous, offerSdp }));
    } catch (caught) {
      const named = caught as { message?: string };
      if (stopped()) return;
      closeActiveSession(session, false);
      pullRef.current = null;
      setPullPanel((previous) => ({
        ...previous,
        phase: 'error',
        error: {
          kind: 'offer',
          title: '无法生成 recvonly offer',
          detail: `创建或应用本地 SDP 失败：${named?.message ?? '未知错误'}。这通常是浏览器的 WebRTC 实现异常，重试或换一个浏览器可能解决。`,
        },
      }));
      return;
    }

    if (stopped()) return;

    const headers: Record<string, string> = {
      'Content-Type': 'application/sdp',
      Accept: 'application/sdp',
    };
    if (token !== '') headers.Authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetch(endpointUrl, {
        method: 'POST',
        headers,
        body: offerSdp,
      });
    } catch (caught) {
      const named = caught as { message?: string };
      if (stopped()) return;
      closeActiveSession(session, false);
      pullRef.current = null;
      setPullPanel((previous) => ({
        ...previous,
        phase: 'error',
        error: explainFetchFailure(named?.message ?? ''),
      }));
      return;
    }

    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch {
      bodyText = '';
    }

    const result = parseWhipResponse({
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: bodyText,
      requestUrl: endpointUrl,
    });
    note(result.warning);

    if (stopped()) {
      if (result.resourceUrl !== null) void deleteResource(result.resourceUrl, token);
      return;
    }

    if (!result.ok || result.answerSdp === null) {
      closeActiveSession(session, result.resourceUrl !== null);
      pullRef.current = null;
      setPullPanel((previous) => ({
        ...previous,
        phase: 'error',
        resourceUrl: result.resourceUrl,
        warning,
        error: {
          kind: `http-${result.status}`,
          title: `拉流请求失败（HTTP ${result.status}）`,
          detail: result.error ?? '服务端响应无法使用。',
        },
      }));
      return;
    }

    session.resourceUrl = result.resourceUrl;
    const answerSdp = result.answerSdp;
    mark(`收到 answer（HTTP ${result.status}${result.resourceUrl === null ? '，没有 Location' : '，已获得 Location'}）`);
    setPullPanel((previous) => ({
      ...previous,
      resourceUrl: result.resourceUrl,
      answerSdp,
      codecs: formatCodecSummary(parseSdp(answerSdp)),
      warning,
    }));

    try {
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch (caught) {
      const named = caught as { message?: string };
      if (stopped()) return;
      closeActiveSession(session, true);
      pullRef.current = null;
      setPullPanel((previous) => ({
        ...previous,
        phase: 'error',
        warning,
        error: explainAnswerError(named?.message ?? ''),
      }));
      return;
    }

    mark('远端 answer 已应用，等待媒体轨道');
    setPullPanel((previous) => ({
      ...previous,
      phase: 'live',
      connectionState: pc.connectionState,
      iceState: pc.iceConnectionState,
      warning,
    }));

    let sampling = false;
    const takeSample = async () => {
      if (stopped() || sampling) return;
      sampling = true;
      try {
        const snapshot = await collectStats(pc, 'recv');
        if (stopped()) return;
        if (session.prevStats !== null && session.prevStatsAt !== null) {
          const delta = pullStats(
            session.prevStats,
            snapshot,
            snapshot.timestampMs - session.prevStatsAt,
          );
          setPullPanel((previous) =>
            previous.phase === 'live' ? { ...previous, stats: delta } : previous,
          );
        }
        session.prevStats = snapshot;
        session.prevStatsAt = snapshot.timestampMs;
      } catch {
        // Transient getStats failure; retry on the next tick.
      } finally {
        sampling = false;
      }
    };
    void takeSample();
    session.timer = window.setInterval(() => void takeSample(), STATS_INTERVAL_MS);
  }, [codecPreference, iceParsed, iceServers, pullDerivation, pullToken, pullUrl, support]);

  const stopPull = useCallback(() => {
    const session = pullRef.current;
    if (session === null) return;
    pullRef.current = null;
    session.timeline.push({ atMs: performance.now() - session.startedAt, text: '用户停止拉流' });
    const timeline = [...session.timeline];
    closeActiveSession(session, true);
    if (pullVideoRef.current !== null) pullVideoRef.current.srcObject = null;
    setPullPanel((previous) => ({
      ...previous,
      phase: 'idle',
      connectionState: 'closed',
      iceState: 'closed',
      timeline,
    }));
  }, []);

  // -------------------------------------------------------------------------
  // Diagnostic report
  // -------------------------------------------------------------------------

  const report = useMemo(() => {
    const toDiagnostic = (
      panel: PanelState,
      fallbackEndpoint: string,
    ): DiagnosticSession => ({
      endpoint: panel.endpoint === '' ? fallbackEndpoint : panel.endpoint,
      token: panel.token,
      state: PHASE_LABEL[panel.phase],
      connectionState: panel.connectionState === '' ? '—' : panel.connectionState,
      iceState: panel.iceState === '' ? '—' : panel.iceState,
      codecs: panel.codecs,
      stats: panel.stats,
      timeline: panel.timeline,
      error: panel.error === null ? null : `${panel.error.title}：${panel.error.detail}`,
      warning: panel.warning,
    });

    return buildDiagnosticReport({
      userAgent: typeof navigator === 'undefined' ? '未知' : navigator.userAgent,
      createdAt: new Date().toISOString(),
      push: toDiagnostic(pushPanel, pushUrl),
      pull: toDiagnostic(pullPanel, pullUrl),
    });
  }, [pullPanel, pullUrl, pushPanel, pushUrl]);

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  const renderSessionDetails = (panel: PanelState, direction: SessionDirection) => (
    <>
      <div className={styles.statusRow}>
        {phaseBadge(panel.phase)}
        <Caption1 className={styles.metaLine}>
          连接：{panel.connectionState === '' ? '—' : panel.connectionState} · ICE：
          {panel.iceState === '' ? '—' : panel.iceState}
        </Caption1>
        {panel.resourceUrl !== null && (
          <Caption1 className={styles.metaLine}>资源 URL 已获得，停止时会 DELETE</Caption1>
        )}
      </div>

      {panel.error !== null && (
        <MessageBar intent="error">
          <MessageBarBody>
            <MessageBarTitle>{panel.error.title}。</MessageBarTitle>
            {panel.error.detail}
          </MessageBarBody>
        </MessageBar>
      )}

      {panel.warning !== null && (
        <MessageBar intent="warning">
          <MessageBarBody>{panel.warning}</MessageBarBody>
        </MessageBar>
      )}

      {direction === 'pull' && panel.phase !== 'idle' && (
        <video
          ref={pullVideoRef}
          className={styles.video}
          autoPlay
          playsInline
          muted
          aria-label="拉流预览"
        />
      )}

      <Caption1 className={styles.metaLine}>
        实际协商编解码：{panel.codecs === '' ? '尚未协商（以服务端 answer 为准）' : panel.codecs}
      </Caption1>

      <Text size={300} weight="semibold">
        实时统计（每秒刷新）
      </Text>
      <StreamStatsTable delta={panel.stats} direction={direction} />

      <Text size={300} weight="semibold">
        状态时间线
      </Text>
      <TimelineList entries={panel.timeline} />

      {panel.offerSdp !== '' && (
        <details className={styles.details}>
          <summary>
            offer SDP（{countLines(panel.offerSdp)} 行）
          </summary>
          <div className={styles.controls} style={{ margin: '8px 0' }}>
            <Button
              size="small"
              icon={<CopyRegular />}
              onClick={() => void copyText(`${direction}-offer`, panel.offerSdp)}
            >
              {copied === `${direction}-offer` ? '已复制' : '复制 offer'}
            </Button>
          </div>
          <textarea
            className={`wt-code-area ${styles.sdp}`}
            readOnly
            value={panel.offerSdp}
            aria-label={`${direction === 'push' ? '推流' : '拉流'} offer SDP`}
            spellCheck={false}
          />
        </details>
      )}

      {panel.answerSdp !== '' && (
        <details className={styles.details}>
          <summary>
            answer SDP（{countLines(panel.answerSdp)} 行）
          </summary>
          <div className={styles.controls} style={{ margin: '8px 0' }}>
            <Button
              size="small"
              icon={<CopyRegular />}
              onClick={() => void copyText(`${direction}-answer`, panel.answerSdp)}
            >
              {copied === `${direction}-answer` ? '已复制' : '复制 answer'}
            </Button>
          </div>
          <textarea
            className={`wt-code-area ${styles.sdp}`}
            readOnly
            value={panel.answerSdp}
            aria-label={`${direction === 'push' ? '推流' : '拉流'} answer SDP`}
            spellCheck={false}
          />
        </details>
      )}
    </>
  );

  return (
    <div className="wt-surface">
      <div
        className={`wt-surface__body ${styles.column}`}
        style={{ flexDirection: 'column' }}
      >
        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>需要一个支持 WHIP/WHEP 的服务端，本工具不包含服务端。</MessageBarTitle>
            本工具只实现 RFC 9725 的客户端部分（POST offer、读取 201/Location、DELETE 释放资源）并读取浏览器的
            getStats。SRS、ZLMediaKit、mediamtx 等常见媒体服务器都提供 WHIP/WHEP 端点。本机没有可用的服务端，
            因此无法在这里验证真实媒体是否送达；页面显示成功只代表协议交换完成。
          </MessageBarBody>
        </MessageBar>

        {support === 'insecure' && (
          <MessageBar intent="error">
            <MessageBarBody>
              <MessageBarTitle>需要安全上下文（HTTPS 或 localhost）。</MessageBarTitle>
              当前页面不是安全上下文。摄像头、麦克风、屏幕共享与部分 WebRTC 能力会被浏览器禁用，请通过 https://
              或 http://localhost 打开本页。
            </MessageBarBody>
          </MessageBar>
        )}

        {support === 'unsupported' && (
          <MessageBar intent="error">
            <MessageBarBody>
              <MessageBarTitle>当前浏览器不支持 WebRTC。</MessageBarTitle>
              没有找到 RTCPeerConnection。请改用较新的 Chrome、Edge、Firefox 或 Safari。
            </MessageBarBody>
          </MessageBar>
        )}

        <Text as="h2" size={300} weight="semibold">
          测试配置
        </Text>

        <div className={styles.row}>
          <label className={styles.field}>
            <Caption1 className={styles.fieldLabel}>推流采源</Caption1>
            <select
              className="wt-inline-input"
              value={source}
              onChange={(event) => setSource(event.target.value as CaptureSource)}
              aria-label="推流采源"
              disabled={configLocked}
            >
              {SOURCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <Caption1 className={styles.fieldLabel}>编解码偏好（尽量）</Caption1>
            <select
              className="wt-inline-input"
              value={codecPreference}
              onChange={(event) => setCodecPreference(event.target.value as CodecPreference)}
              aria-label="编解码偏好"
              disabled={configLocked}
            >
              {CODEC_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <Button icon={<ArrowSyncRegular />} onClick={fillExamples} disabled={configLocked}>
            填入示例地址
          </Button>
        </div>

        <div className={styles.row}>
          <label className={styles.fieldWide}>
            <Caption1 className={styles.fieldLabel}>
              STUN/TURN 服务器（每行一个，可留空）
            </Caption1>
            <textarea
              className="wt-inline-input"
              value={iceText}
              onChange={(event) => setIceText(event.target.value)}
              aria-label="STUN 或 TURN 服务器地址"
              placeholder={'stun:stun.l.google.com:19302\nturn:turn.example.com:3478'}
              rows={2}
              spellCheck={false}
              autoComplete="off"
              disabled={configLocked}
            />
          </label>

          <label className={styles.field}>
            <Caption1 className={styles.fieldLabel}>TURN 用户名（可选）</Caption1>
            <input
              className="wt-inline-input"
              value={iceUsername}
              onChange={(event) => setIceUsername(event.target.value)}
              aria-label="TURN 用户名"
              autoComplete="off"
              spellCheck={false}
              disabled={configLocked}
            />
          </label>

          <label className={styles.field}>
            <Caption1 className={styles.fieldLabel}>TURN 密码（可选）</Caption1>
            <input
              className="wt-inline-input"
              type="password"
              value={iceCredential}
              onChange={(event) => setIceCredential(event.target.value)}
              aria-label="TURN 密码"
              autoComplete="off"
              spellCheck={false}
              disabled={configLocked}
            />
          </label>
        </div>

        {iceParsed.invalid.length > 0 && (
          <MessageBar intent="warning">
            <MessageBarBody>
              这些行不会被当作 ICE 服务器使用（只接受 stun:/stuns:/turn:/turns: 地址）：
              {iceParsed.invalid.join('；')}
            </MessageBarBody>
          </MessageBar>
        )}

        <Caption1 className={styles.metaLine}>
          STUN 只用于发现公网地址；对称 NAT 或严格防火墙下通常还需要 TURN 中继。留空时只能依靠主机候选，
          同一局域网内可能可用，跨网络一般连不上。
        </Caption1>

        <section className={styles.panel} aria-label="推流（WHIP）">
          <Text as="h2" size={300} weight="semibold">
            推流（WHIP）
          </Text>

          <div className={styles.row}>
            <label className={styles.fieldWide}>
              <Caption1 className={styles.fieldLabel}>推流地址</Caption1>
              <input
                className="wt-inline-input"
                value={pushUrl}
                onChange={(event) => setPushUrl(event.target.value)}
                aria-label="推流地址"
                placeholder={EXAMPLE_PUSH}
                spellCheck={false}
                autoComplete="off"
                disabled={pushActive}
              />
            </label>
            <label className={styles.field}>
              <Caption1 className={styles.fieldLabel}>Bearer token（可选）</Caption1>
              <input
                className="wt-inline-input"
                type="password"
                value={pushToken}
                onChange={(event) => setPushToken(event.target.value)}
                aria-label="推流 Bearer token"
                autoComplete="off"
                spellCheck={false}
                disabled={pushActive}
              />
            </label>
            <Button
              appearance="primary"
              icon={<PlayRegular />}
              onClick={() => void startPush()}
              disabled={pushActive || !canCapture || support !== 'ok'}
            >
              开始推流
            </Button>
            <Button
              icon={<StopRegular />}
              onClick={stopPush}
              disabled={pushPanel.phase !== 'live' && pushPanel.phase !== 'starting'}
            >
              停止推流
            </Button>
          </div>

          {!pushActive && pushPathHint !== null && (
            <Caption1 className={styles.metaLine}>{pushPathHint}</Caption1>
          )}

          {renderSessionDetails(pushPanel, 'push')}
        </section>

        <section className={styles.panel} aria-label="拉流（WHEP）">
          <Text as="h2" size={300} weight="semibold">
            拉流（WHEP）
          </Text>

          <div className={styles.row}>
            <label className={styles.fieldWide}>
              <Caption1 className={styles.fieldLabel}>
                拉流地址（HTTP WHEP 端点，或 webrtc:// 地址）
              </Caption1>
              <input
                className="wt-inline-input"
                value={pullUrl}
                onChange={(event) => setPullUrl(event.target.value)}
                aria-label="拉流地址"
                placeholder={`${EXAMPLE_PULL} 或 ${EXAMPLE_PULL_WEBRTC}`}
                spellCheck={false}
                autoComplete="off"
                disabled={pullActive}
              />
            </label>
            <label className={styles.field}>
              <Caption1 className={styles.fieldLabel}>Bearer token（可选）</Caption1>
              <input
                className="wt-inline-input"
                type="password"
                value={pullToken}
                onChange={(event) => setPullToken(event.target.value)}
                aria-label="拉流 Bearer token"
                autoComplete="off"
                spellCheck={false}
                disabled={pullActive}
              />
            </label>
            <Button
              appearance="primary"
              icon={<PlayRegular />}
              onClick={() => void startPull()}
              disabled={pullActive || support !== 'ok'}
            >
              开始拉流
            </Button>
            <Button
              icon={<StopRegular />}
              onClick={stopPull}
              disabled={pullPanel.phase !== 'live' && pullPanel.phase !== 'starting'}
            >
              停止拉流
            </Button>
          </div>

          <Caption1 className={styles.metaLine}>
            以 webrtc:// 或 webrtcs:// 开头时，会先按所选服务端推导成真实的 HTTP WHEP 端点，再走同一套
            WHEP 流程；其它输入按完整的 HTTP 端点原样使用。
          </Caption1>

          {pullDerivation.mode === 'webrtc' && (
            <>
              <div className={styles.row}>
                <label className={styles.field}>
                  <Caption1 className={styles.fieldLabel}>服务端</Caption1>
                  <select
                    className="wt-inline-input"
                    value={pullKind}
                    onChange={(event) => setPullKind(event.target.value as WebrtcEndpointKind)}
                    aria-label="webrtc 服务端类型"
                    disabled={pullActive}
                  >
                    {PULL_KIND_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.field}>
                  <Caption1 className={styles.fieldLabel}>HTTP 端口（可选）</Caption1>
                  <input
                    className="wt-inline-input"
                    value={pullHttpPort}
                    onChange={(event) => setPullHttpPort(event.target.value)}
                    aria-label="HTTP 端口"
                    placeholder="如 8080；留空按 80/443"
                    inputMode="numeric"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={pullActive}
                  />
                </label>

                {pullKind === 'custom' ? (
                  <label className={styles.fieldWide}>
                    <Caption1 className={styles.fieldLabel}>自定义模板</Caption1>
                    <input
                      className="wt-inline-input"
                      value={pullTemplate}
                      onChange={(event) => setPullTemplate(event.target.value)}
                      aria-label="自定义 WHEP 模板"
                      placeholder={DEFAULT_CUSTOM_TEMPLATE}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={pullActive}
                    />
                  </label>
                ) : (
                  <label className={styles.fieldWide}>
                    <Caption1 className={styles.fieldLabel}>推导出的端点（只读预览）</Caption1>
                    <input
                      className="wt-inline-input"
                      value={pullDerivation.url ?? ''}
                      aria-label="推导出的端点预览"
                      readOnly
                      spellCheck={false}
                    />
                  </label>
                )}
              </div>

              <Caption1 className={styles.metaLine}>
                <Text font="monospace">SRS</Text> 用 /rtc/v1/whep/?app=…&amp;stream=…，
                <Text font="monospace">mediamtx</Text> 用 /app/stream/whep。自定义模板支持占位符{' '}
                {'{scheme} {host} {port} {app} {stream}'}；ZLMediaKit 各版本 WHEP 路径不同，请选「自定义模板」按其版本文档填写。
              </Caption1>

              {pullDerivation.error !== null && (
                <MessageBar intent="error">
                  <MessageBarBody>
                    <MessageBarTitle>无法从 webrtc:// 地址推导端点。</MessageBarTitle>
                    {pullDerivation.error}
                  </MessageBarBody>
                </MessageBar>
              )}

              {pullDerivation.url !== null && (
                <div className={styles.endpointBox}>
                  <Caption1 className={styles.fieldLabel}>实际会 POST 的真实 WHEP 端点</Caption1>
                  <div className={styles.endpointUrl} role="status">
                    {pullDerivation.url}
                  </div>
                  <div className={styles.controls}>
                    <Button
                      size="small"
                      icon={<CopyRegular />}
                      onClick={() => void copyText('pull-endpoint', pullDerivation.url ?? '')}
                    >
                      {copied === 'pull-endpoint' ? '已复制端点' : '复制端点'}
                    </Button>
                  </div>
                </div>
              )}

              {pullDerivation.notes.length > 0 && (
                <div className={styles.notes}>
                  <Caption1 className={styles.fieldLabel}>推导假设（请核对）</Caption1>
                  <ul className={styles.noteList}>
                    {pullDerivation.notes.map((note, index) => (
                      <li key={`${index}-${note}`}>
                        <Caption1>{note}</Caption1>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {pullDerivation.rtmp !== null && (
                <div className={styles.hintBox}>
                  <Text size={200} weight="semibold">
                    推流侧提示（仅供对照）
                  </Text>
                  <Caption1>本工具不推 RTMP，请用 OBS/ffmpeg 推流；此处只验证拉流。</Caption1>
                  <Caption1 className={styles.mono}>
                    RTMP 地址：{pullDerivation.rtmp.rtmpUrl}
                  </Caption1>
                  <div className={styles.controls}>
                    <Button
                      size="small"
                      icon={<CopyRegular />}
                      onClick={() => void copyText('pull-rtmp', pullDerivation.rtmp?.rtmpUrl ?? '')}
                    >
                      {copied === 'pull-rtmp' ? '已复制' : '复制 RTMP 地址'}
                    </Button>
                  </div>
                  <Caption1 className={styles.mono}>
                    ffmpeg：{pullDerivation.rtmp.ffmpegCommand}
                  </Caption1>
                  <div className={styles.controls}>
                    <Button
                      size="small"
                      icon={<CopyRegular />}
                      onClick={() =>
                        void copyText('pull-ffmpeg', pullDerivation.rtmp?.ffmpegCommand ?? '')
                      }
                    >
                      {copied === 'pull-ffmpeg' ? '已复制' : '复制 ffmpeg 命令'}
                    </Button>
                  </div>
                  <Caption1 className={styles.metaLine}>
                    命令里的 input.mp4 需替换成本机文件。RTMP 默认端口 1935；地址里的端口用于信令/HTTP，不一定是 RTMP 端口。
                  </Caption1>
                </div>
              )}
            </>
          )}

          {!pullActive && pullDerivation.mode === 'http' && pullPathHint !== null && (
            <Caption1 className={styles.metaLine}>{pullPathHint}</Caption1>
          )}

          {renderSessionDetails(pullPanel, 'pull')}
        </section>

        <Text as="h2" size={300} weight="semibold">
          诊断报告
        </Text>
        <Caption1 className={styles.metaLine}>
          报告包含 User-Agent、两个地址（token 与可疑查询参数已打码）、协商编解码、最近一次统计快照、状态时间线和错误。
          复制后可直接粘贴给他人排查。
        </Caption1>
        <div className={styles.controls}>
          <Button
            appearance="primary"
            icon={<CopyRegular />}
            onClick={() => void copyText('report', report)}
          >
            {copied === 'report' ? '已复制诊断报告' : '一键复制诊断报告'}
          </Button>
        </div>
        <textarea
          className={`wt-code-area ${styles.report}`}
          readOnly
          value={report}
          aria-label="诊断报告"
          spellCheck={false}
        />

        <Text as="h2" size={300} weight="semibold">
          说明与限制
        </Text>
        <div className={styles.notes}>
          <ul className={styles.noteList}>
            <li>
              <Caption1>
                推流使用 WHIP：POST 一个包含本地轨道的 offer 到推流地址；拉流使用 WHEP：POST 一个 recvonly offer
                到拉流地址。两者互不依赖，可以只推、只拉或同时进行。
              </Caption1>
            </li>
            <li>
              <Caption1>
                RFC 9725 规定成功创建资源返回 201 Created，并用 Location 头给出资源 URL；停止时本工具对该 URL
                发送 DELETE。若服务端没有返回 Location（跨域时还需用 Access-Control-Expose-Headers 暴露它），
                就只能关闭本地 PeerConnection，无法通知服务端释放资源。
              </Caption1>
            </li>
            <li>
              <Caption1>
                没有实现 trickle ICE 与 PATCH。为了让一次 POST 就带上候选，工具会等待 ICE 收集完成（最多 3 秒），
                超时则发送当时的 SDP 并给出警告。服务端必须接受非 trickle 的完整 offer。
              </Caption1>
            </li>
            <li>
              <Caption1>
                编解码偏好通过 setCodecPreferences 表达，浏览器与服务端都可能不采纳；页面显示的「实际协商编解码」
                来自服务端 answer SDP，比偏好更可信。
              </Caption1>
            </li>
            <li>
              <Caption1>
                统计来自 getStats：推流显示码率、发送帧率、分辨率、RTT 与可用发送带宽；拉流显示码率、接收帧率、
                分辨率、丢包率、抖动与 RTT。数值只反映本地浏览器看到的 RTP，不能证明服务端已正确录制或转发。
              </Caption1>
            </li>
            <li>
              <Caption1>
                webrtc:// 与 webrtcs:// 不是浏览器协议，只是服务端控制台里的写法：本工具会先把它推导成该服务端的
                HTTP WHEP 端点。SRS 与 mediamtx 的路径模板已核实，ZLMediaKit 因版本差异请用自定义模板；
                推导结果与假设都显示在拉流面板上，开始拉流时用的就是那个端点。RTMP 地址只是推流提示，
                本工具不推 RTMP。
              </Caption1>
            </li>
            <li>
              <Caption1>
                不包含服务端、不做转码、录制、鉴权签发或流管理；也不会把媒体上传到本工具自己的任何地方，
                媒体只在本页与填写的 WHIP/WHEP 地址之间传输。
              </Caption1>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
