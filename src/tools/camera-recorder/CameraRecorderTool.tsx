import {
  Badge,
  Button,
  Caption1,
  Checkbox,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowDownloadRegular,
  ArrowSyncRegular,
  CameraSwitchRegular,
  DeleteRegular,
  PauseRegular,
  PlayRegular,
  RecordStopRegular,
  StopRegular,
} from '@fluentui/react-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildFileName,
  chooseMimeType,
  clockElapsed,
  clockPause,
  clockReset,
  clockStart,
  createClock,
  describeContextStatus,
  deviceOptionLabel,
  explainMediaError,
  extensionForMime,
  formatBytes,
  formatDurationMs,
  isMimeAllowedFor,
  limitMsFromText,
  remainingMs,
  shouldAutoStop,
  type MediaErrorExplanation,
  type RecorderClock,
} from './cameraRecorderUtils';

/** Recording phases. `ready` means a finished clip is waiting to be downloaded. */
type Phase = 'idle' | 'preview' | 'recording' | 'paused' | 'ready';

interface Resolution {
  key: string;
  label: string;
  width: number;
  height: number;
}

/**
 * Resolution presets.
 *
 * "Browser default" is first because it is the only choice that respects what
 * the camera actually prefers; the fixed sizes are requests, and a camera that
 * cannot satisfy one produces `OverconstrainedError`, which the error mapping
 * below explains rather than swallowing.
 */
const RESOLUTIONS: Resolution[] = [
  { key: 'default', label: '浏览器默认', width: 0, height: 0 },
  { key: '2160', label: '3840 × 2160 (4K)', width: 3840, height: 2160 },
  { key: '1440', label: '2560 × 1440 (2K)', width: 2560, height: 1440 },
  { key: '1080', label: '1920 × 1080 (1080p)', width: 1920, height: 1080 },
  { key: '720', label: '1280 × 720 (720p)', width: 1280, height: 720 },
  { key: '480', label: '640 × 480 (480p)', width: 640, height: 480 },
];

/** The slice size handed to `ondataavailable`, in milliseconds. */
const TIMESLICE_MS = 1000;

const useStyles = makeStyles({
  column: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    width: '100%',
    minWidth: 0,
    padding: '12px 14px 4px',
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: '12px',
    width: '100%',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: '160px',
  },
  fieldLabel: {
    color: tokens.colorNeutralForeground3,
  },
  controls: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
  },
  stage: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '16px',
    width: '100%',
    minWidth: 0,
  },
  previewWrap: {
    position: 'relative',
    flex: '1 1 360px',
    minWidth: '280px',
    minHeight: '240px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '8px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground3,
    overflow: 'hidden',
  },
  video: {
    width: '100%',
    maxHeight: '420px',
    display: 'block',
    backgroundColor: '#000',
  },
  status: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    flex: '1 1 260px',
    minWidth: '240px',
  },
  timer: {
    fontFamily: 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace',
    fontVariantNumeric: 'tabular-nums',
    fontSize: '34px',
    fontWeight: 600,
    lineHeight: 1.1,
  },
  meta: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    color: tokens.colorNeutralForeground3,
  },
  notes: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    width: '100%',
  },
  noteList: {
    margin: 0,
    paddingLeft: '20px',
    color: tokens.colorNeutralForeground3,
  },
});

/** Labels for the recording indicator. */
const PHASE_LABEL: Record<Phase, string> = {
  idle: '未开启预览',
  preview: '预览中（未录制）',
  recording: '录制中',
  paused: '已暂停',
  ready: '录制完成',
};

export function CameraRecorderTool() {
  const styles = useStyles();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const clockRef = useRef<RecorderClock>(createClock());
  const clipUrlRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDeviceId, setVideoDeviceId] = useState('');
  const [audioDeviceId, setAudioDeviceId] = useState('');
  const [resolutionKey, setResolutionKey] = useState('default');
  const [withAudio, setWithAudio] = useState(true);
  const [limitText, setLimitText] = useState('60');
  const [error, setError] = useState<MediaErrorExplanation | null>(null);
  const [activeMime, setActiveMime] = useState('');
  const [clip, setClip] = useState<{
    url: string;
    size: number;
    mime: string;
    name: string;
    durationMs: number;
  } | null>(null);

  /**
   * Secure-context and API availability.
   *
   * Both are read once: neither changes while the page is open, and a
   * non-secure context must be reported before anything else is attempted,
   * because the failure would otherwise look like a browser that simply lacks
   * the API.
   */
  const contextStatus = useMemo(
    () =>
      describeContextStatus(
        typeof window !== 'undefined' && window.isSecureContext === true,
        typeof navigator !== 'undefined' && navigator.mediaDevices !== undefined,
      ),
    [],
  );

  const limit = useMemo(() => limitMsFromText(limitText), [limitText]);
  const limitMs = limit.ok ? limit.limitMs : null;

  const refreshDevices = useCallback(async () => {
    if (typeof navigator === 'undefined' || navigator.mediaDevices === undefined) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(devices.filter((device) => device.kind === 'videoinput'));
      setAudioDevices(devices.filter((device) => device.kind === 'audioinput'));
    } catch {
      // Enumeration can fail without permission on some browsers. The device
      // dropdowns then stay empty while the default device still works, so this
      // is not surfaced as a blocking error.
    }
  }, []);

  /** Stops every track and forgets the stream. */
  const releaseStream = useCallback(() => {
    const stream = streamRef.current;
    if (stream !== null) {
      for (const track of stream.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current !== null) videoRef.current.srcObject = null;
  }, []);

  const detachClip = useCallback(() => {
    if (clipUrlRef.current !== null) {
      URL.revokeObjectURL(clipUrlRef.current);
      clipUrlRef.current = null;
    }
    setClip(null);
  }, []);

  useEffect(() => {
    void refreshDevices();
    // The device list changes when something is plugged in; re-reading it then
    // is cheaper than polling.
    const onDeviceChange = () => void refreshDevices();
    if (typeof navigator !== 'undefined' && navigator.mediaDevices !== undefined) {
      navigator.mediaDevices.addEventListener?.('devicechange', onDeviceChange);
    }
    return () => {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices !== undefined) {
        navigator.mediaDevices.removeEventListener?.('devicechange', onDeviceChange);
      }
    };
  }, [refreshDevices]);

  // Release the camera on unmount. Leaving it on would keep the recording light
  // lit after the user navigates away, which reads as spyware. The handlers are
  // detached first: otherwise the stop would fire `onstop`, build a Blob and
  // create an object URL that the cleanup below has already run past, leaking it.
  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      if (recorder !== null && recorder.state !== 'inactive') {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
        recorder.stop();
      }
      releaseStream();
      if (clipUrlRef.current !== null) URL.revokeObjectURL(clipUrlRef.current);
    },
    [releaseStream],
  );

  const buildConstraints = useCallback((): MediaStreamConstraints => {
    const preset = RESOLUTIONS.find((item) => item.key === resolutionKey) ?? RESOLUTIONS[0];
    const video: MediaTrackConstraints =
      preset.width === 0
        ? { deviceId: videoDeviceId === '' ? undefined : { exact: videoDeviceId } }
        : {
            deviceId: videoDeviceId === '' ? undefined : { exact: videoDeviceId },
            width: { ideal: preset.width },
            height: { ideal: preset.height },
          };
    return withAudio
      ? {
          video,
          audio: audioDeviceId === '' ? true : { deviceId: { exact: audioDeviceId } },
        }
      : { video, audio: false };
  }, [audioDeviceId, resolutionKey, videoDeviceId, withAudio]);

  const startPreview = useCallback(async () => {
    if (contextStatus !== 'ok') return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(buildConstraints());
      releaseStream();
      streamRef.current = stream;
      if (videoRef.current !== null) {
        videoRef.current.srcObject = stream;
        // Autoplay is muted in the markup, so the returned promise does not
        // need handling here; the stream is already live once assigned.
        void videoRef.current.play().catch(() => undefined);
      }
      setPhase('preview');
      void refreshDevices();
    } catch (caught) {
      const named = caught as DOMException;
      setError(explainMediaError(named?.name ?? '', named?.message ?? ''));
      setPhase('idle');
    }
  }, [buildConstraints, contextStatus, refreshDevices, releaseStream]);

  const stopPreview = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder !== null && recorder.state !== 'inactive') recorder.stop();
    releaseStream();
    clockRef.current = clockReset();
    setElapsed(0);
    setPhase('idle');
  }, [releaseStream]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder === null || recorder.state === 'inactive') return;
    clockRef.current = clockPause(clockRef.current, performance.now());
    recorder.stop();
    setPhase('preview');
  }, []);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (stream === null) return;
    if (typeof MediaRecorder === 'undefined') {
      setError(explainMediaError('TypeError', '当前浏览器没有 MediaRecorder'));
      return;
    }

    setError(null);
    detachClip();

    // The codec list is filtered by whether audio is being captured at all, so
    // an audio-only candidate is not chosen for a silent recording.
    const mime = chooseMimeType(
      (candidate) =>
        isMimeAllowedFor(candidate, withAudio) && MediaRecorder.isTypeSupported(candidate),
    );

    try {
      const recorder =
        mime === '' ? new MediaRecorder(stream) : new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorderRef.current = recorder;
      setActiveMime(mime);

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const type = recorder.mimeType !== '' ? recorder.mimeType : mime === '' ? 'video/webm' : mime;
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        const url = URL.createObjectURL(blob);
        if (clipUrlRef.current !== null) URL.revokeObjectURL(clipUrlRef.current);
        clipUrlRef.current = url;
        setClip({
          url,
          size: blob.size,
          mime: type,
          name: buildFileName('camera-recording', Date.now(), extensionForMime(type)),
          durationMs: clockElapsed(clockRef.current, performance.now()),
        });
        setPhase('ready');
      };

      recorder.onerror = () => {
        setError(explainMediaError('unknown', '录制过程中 MediaRecorder 报告错误'));
        setPhase('preview');
      };

      clockRef.current = clockStart(clockReset(), performance.now());
      setElapsed(0);
      // A timeslice means chunks arrive periodically rather than only at stop,
      // which bounds how much a crash can lose and keeps memory pressure even.
      recorder.start(TIMESLICE_MS);
      setPhase('recording');
    } catch (caught) {
      const named = caught as DOMException;
      setError(explainMediaError(named?.name ?? '', named?.message ?? ''));
      setPhase('preview');
    }
  }, [detachClip, withAudio]);

  const pauseRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder === null || recorder.state !== 'recording') return;
    clockRef.current = clockPause(clockRef.current, performance.now());
    recorder.pause();
    setPhase('paused');
  }, []);

  const resumeRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder === null || recorder.state !== 'paused') return;
    clockRef.current = clockStart(clockRef.current, performance.now());
    recorder.resume();
    setPhase('recording');
  }, []);

  // The visible clock. It re-reads the anchored clock rather than accumulating,
  // so a throttled interval only makes the number update less often.
  useEffect(() => {
    if (phase !== 'recording') return undefined;
    const id = window.setInterval(() => {
      const now = performance.now();
      const value = clockElapsed(clockRef.current, now);
      setElapsed(value);
      if (shouldAutoStop(limitMs, value)) stopRecording();
    }, 200);
    return () => window.clearInterval(id);
  }, [limitMs, phase, stopRecording]);

  const download = useCallback(() => {
    if (clip === null) return;
    const anchor = document.createElement('a');
    anchor.href = clip.url;
    anchor.download = clip.name;
    anchor.rel = 'noopener';
    anchor.click();
  }, [clip]);

  const remaining = remainingMs(limitMs, elapsed);
  const canPreview = contextStatus === 'ok';
  const isRecording = phase === 'recording' || phase === 'paused';

  return (
    <div className="wt-surface">
      <div className={styles.column}>
        {contextStatus === 'insecure' && (
          <MessageBar intent="error">
            <MessageBarTitle>需要安全上下文（HTTPS 或 localhost）</MessageBarTitle>
            <MessageBarBody>
              当前页面不是安全上下文，浏览器不会提供摄像头与麦克风，navigator.mediaDevices
              可能直接不存在。请通过 https:// 打开本页，或在 http://localhost 上访问；仅靠重试或授权无法绕过这一限制。
            </MessageBarBody>
          </MessageBar>
        )}

        {contextStatus === 'unsupported' && (
          <MessageBar intent="error">
            <MessageBarTitle>当前浏览器不提供所需 API</MessageBarTitle>
            <MessageBarBody>
              没有找到 navigator.mediaDevices.getUserMedia，或页面环境缺少 MediaRecorder。
              请改用较新的 Chrome、Edge、Firefox 或 Safari。
            </MessageBarBody>
          </MessageBar>
        )}

        {error !== null && (
          <MessageBar intent="error">
            <MessageBarTitle>{error.title}</MessageBarTitle>
            <MessageBarBody>
              {error.detail}
              <br />
              如何重试：{error.retry}
            </MessageBarBody>
          </MessageBar>
        )}

        <div className={styles.row}>
          <label className={styles.field}>
            <Caption1 className={styles.fieldLabel}>摄像头</Caption1>
            <select
              className="wt-inline-input"
              value={videoDeviceId}
              onChange={(event) => setVideoDeviceId(event.target.value)}
              aria-label="摄像头设备"
              disabled={isRecording}
            >
              <option value="">默认摄像头</option>
              {videoDevices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {deviceOptionLabel(device.label, 'video', index)}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <Caption1 className={styles.fieldLabel}>麦克风</Caption1>
            <select
              className="wt-inline-input"
              value={audioDeviceId}
              onChange={(event) => setAudioDeviceId(event.target.value)}
              aria-label="麦克风设备"
              disabled={isRecording || !withAudio}
            >
              <option value="">默认麦克风</option>
              {audioDevices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {deviceOptionLabel(device.label, 'audio', index)}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <Caption1 className={styles.fieldLabel}>分辨率</Caption1>
            <select
              className="wt-inline-input"
              value={resolutionKey}
              onChange={(event) => setResolutionKey(event.target.value)}
              aria-label="分辨率"
              disabled={isRecording}
            >
              {RESOLUTIONS.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <Caption1 className={styles.fieldLabel}>时长上限（留空为不限）</Caption1>
            <input
              className="wt-inline-input"
              value={limitText}
              onChange={(event) => setLimitText(event.target.value)}
              aria-label="录制时长上限"
              placeholder="例如 60、1:30 或 1:00:00"
              spellCheck={false}
              autoComplete="off"
              disabled={isRecording}
            />
          </label>

          <Button
            icon={<ArrowSyncRegular />}
            onClick={() => void refreshDevices()}
            disabled={isRecording}
          >
            刷新设备
          </Button>
        </div>

        <div className={styles.controls}>
          <Checkbox
            checked={withAudio}
            onChange={(_, data) => setWithAudio(data.checked === true)}
            label="录制声音"
            disabled={isRecording}
          />
        </div>

        {!limit.ok && (
          <MessageBar intent="warning">
            <MessageBarBody>
              时长上限无法识别，将保持为“不限”。可以使用秒数（60）、MM:SS（1:30）或 HH:MM:SS（1:00:00）。
            </MessageBarBody>
          </MessageBar>
        )}

        <div className={styles.controls}>
          {phase === 'idle' ? (
            <Button
              appearance="primary"
              icon={<CameraSwitchRegular />}
              onClick={() => void startPreview()}
              disabled={!canPreview}
            >
              开启预览
            </Button>
          ) : (
            <Button icon={<StopRegular />} onClick={stopPreview} disabled={isRecording}>
              停止预览
            </Button>
          )}

          {(phase === 'preview' || phase === 'ready') && (
            <Button appearance="primary" icon={<RecordStopRegular />} onClick={startRecording}>
              {phase === 'ready' ? '重新录制' : '开始录制'}
            </Button>
          )}
          {phase === 'recording' && (
            <Button icon={<PauseRegular />} onClick={pauseRecording}>
              暂停
            </Button>
          )}
          {phase === 'paused' && (
            <Button icon={<PlayRegular />} onClick={resumeRecording}>
              继续
            </Button>
          )}
          {isRecording && (
            <Button icon={<StopRegular />} onClick={stopRecording}>
              停止录制
            </Button>
          )}
        </div>

        <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
          <div className={styles.stage}>
            <div className={styles.previewWrap}>
              {/*
                `muted` is not a preference: an unmuted local preview feeds the
                microphone back into the speakers and howls. It does not affect
                what the recorder captures, which takes the audio track directly.
              */}
              <video
                ref={videoRef}
                className={styles.video}
                muted
                playsInline
                autoPlay
                aria-label="摄像头预览画面"
              />
            </div>

            <div className={styles.status}>
              <Badge
                appearance="filled"
                color={phase === 'recording' ? 'danger' : phase === 'paused' ? 'warning' : 'informative'}
              >
                {PHASE_LABEL[phase]}
              </Badge>

              <Text className={styles.timer} role="timer" aria-live="off">
                {formatDurationMs(elapsed)}
              </Text>

              <div className={styles.meta}>
                <Caption1>
                  {remaining === null
                    ? '时长上限：不限'
                    : `剩余 ${formatDurationMs(remaining)}（上限 ${formatDurationMs(limitMs ?? 0)}）`}
                </Caption1>
                <Caption1>
                  编码：{activeMime === '' ? '由浏览器自动选择（未确认到受支持的 MIME 类型）' : activeMime}
                </Caption1>
                <Caption1>录制内容仅保存在本页内存，刷新或关闭页面即丢失。</Caption1>
              </div>

              {clip !== null && (
                <>
                  <Divider />
                  <div className={styles.meta}>
                    <Text size={300} weight="semibold">
                      已录制片段
                    </Text>
                    <Caption1>文件：{clip.name}</Caption1>
                    <Caption1>
                      大小：{formatBytes(clip.size)} · 类型：{clip.mime} · 时长：
                      {formatDurationMs(clip.durationMs)}
                    </Caption1>
                  </div>
                  <div className={styles.controls}>
                    <Button appearance="primary" icon={<ArrowDownloadRegular />} onClick={download}>
                      下载 .{extensionForMime(clip.mime)}
                    </Button>
                    <Button icon={<DeleteRegular />} onClick={detachClip}>
                      丢弃
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className={styles.notes}>
          <Text as="h2" size={300} weight="semibold">
            权限、环境与限制
          </Text>
          <ul className={styles.noteList}>
            <li>
              <Caption1>
                需要你明确授权。浏览器只会弹出一次权限询问；若被拒绝，页面无法再次主动弹出，必须点地址栏的权限图标
                （或站点的“网站设置”）把摄像头/麦克风改回“允许”，然后重新点击“开启预览”。
              </Caption1>
            </li>
            <li>
              <Caption1>
                必须处于安全上下文（HTTPS 或 localhost）。在其它 http:// 页面上，浏览器不会暴露
                navigator.mediaDevices，也无法通过授权绕开。
              </Caption1>
            </li>
            <li>
              <Caption1>
                兼容性差异真实存在：MediaRecorder 在 Chrome/Edge/Firefox 上通常输出 WebM（VP8/VP9 + Opus），
                而 Safari 对 WebM 支持有限、多数版本录制 MP4/H.264。因此这里按可用性依次回退选择编码，
                并在选不到任何受支持类型时交给浏览器自行决定；下载扩展名也按实际类型生成。
              </Caption1>
            </li>
            <li>
              <Caption1>
                不录制到服务器：没有上传、没有远端存储，录制的数据只以 Blob 形式留在当前页面的内存里，
                下载由浏览器直接写本地文件，刷新页面即全部丢失。
              </Caption1>
            </li>
            <li>
              <Caption1>
                不做屏幕录制 —— 那是另一个 API（getDisplayMedia），需要单独选择窗口或屏幕并处理它的权限模型。
                也不做视频编辑、转码、裁剪或拼接。
              </Caption1>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
