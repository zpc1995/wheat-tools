import { VideoRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'camera-recorder',
  name: '摄像头录制',
  description:
    '用 getUserMedia 与 MediaRecorder 录制摄像头画面：可选择摄像头与麦克风、分辨率、是否录音，并设置录制时长上限，支持暂停与继续，最后下载为 .webm 文件。录制内容只存在于当前页面的内存里，不上传、不落盘，刷新即丢失。需要 HTTPS 或 localhost 且经用户授权；不做屏幕录制，也不做视频编辑。',
  tags: ['摄像头', '录制', 'MediaRecorder', 'webm', '录像'],
  category: 'media',
  icon: VideoRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Camera recorder',
      description:
        'Records the camera with getUserMedia and MediaRecorder: pick the camera and microphone, the resolution and whether audio is captured, set a maximum duration, pause and resume, then download a .webm file. The recording lives in this page memory only — nothing is uploaded and nothing is written to disk, so a refresh loses it. Requires HTTPS or localhost plus user permission. No screen recording and no video editing.',
      tags: ['camera', 'recording', 'mediarecorder', 'webm', 'video'],
    },
  },
};
