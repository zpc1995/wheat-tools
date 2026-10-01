import { QrCodeRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'qrcode-reader',
  name: '二维码识别',
  description:
    '上传图片识别二维码，并把内容拆成带标签的字段（WiFi/名片/2FA/网址）；危险协议会被拦下并给出钓鱼提示。',
  tags: ['二维码', '识别', '解码'],
  category: 'media',
  icon: QrCodeRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: "QR code reader",
      description:
        "Decode a QR code from an uploaded image and break its content into labelled fields (WiFi, contact, 2FA, URL). Dangerous schemes are blocked and phishing hints are given.",
      tags: ["QR code","scan","decode"],
    },
  },
};
