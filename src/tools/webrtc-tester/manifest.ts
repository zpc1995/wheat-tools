import { VideoProhibitedRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'webrtc-tester',
  name: 'WebRTC 推拉流测试',
  description:
    '按 WHIP/WHEP（RFC 9725）把摄像头、麦克风或屏幕推到一个地址，或从另一个地址拉流播放，两个方向可独立启停。显示连接与 ICE 状态时间线、实际协商的编解码器、每秒刷新的码率/帧率/分辨率/丢包/抖动/RTT，并可复制 offer、answer SDP 与打码后的诊断报告。需要一个支持 WHIP/WHEP 的服务端（如 SRS、ZLMediaKit、mediamtx）；本工具只负责协议与诊断，不包含服务端，也不能证明媒体真的被对方接收。',
  tags: ['WebRTC', 'WHIP', 'WHEP', '推流', '拉流', 'SDP', 'getStats'],
  category: 'network',
  icon: VideoProhibitedRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'WebRTC push/pull tester',
      description:
        'Push a camera, microphone or screen to a WHIP endpoint, or play a WHEP stream from another endpoint, following RFC 9725; the two directions start and stop independently. Shows connection and ICE state timelines, the codecs actually negotiated, and per-second bitrate, frame rate, resolution, packet loss, jitter and RTT, with copyable offer/answer SDP and a redacted diagnostic report. Needs a WHIP/WHEP server such as SRS, ZLMediaKit or mediamtx: this tool implements the client protocol and diagnostics only, contains no server, and cannot prove that media actually reached the other side.',
      tags: ['webrtc', 'whip', 'whep', 'push', 'pull', 'sdp', 'getstats'],
    },
  },
};
