import { QrCodeRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';
import { QrcodeGeneratorTool } from './QrcodeGeneratorTool';

export const manifest: ToolManifest = {
  id: 'qrcode-generator',
  name: '二维码生成器',
  description:
    '把网址、文本、WiFi、名片等生成二维码，可调纠错等级、尺寸、留白与配色，并提示对比度与反色风险。',
  tags: ['二维码', 'QR', '分享'],
  category: 'media',
  icon: QrCodeRegular,
  version: '0.1.0',
};

export default QrcodeGeneratorTool;
