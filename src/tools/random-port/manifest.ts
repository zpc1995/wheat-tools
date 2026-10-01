import { PlugConnectedRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'random-port',
  name: '随机端口生成器',
  description:
    '按范围批量生成随机端口号：默认 IANA 动态端口 49152–65535，也可选注册端口 1024–49151 或全部 0–65535，支持去重、排除常见默认端口，并给出每个端口的十六进制、二进制与 IANA 所属范围。它只生成数字，不检测端口是否真的可用——浏览器无法探测本机端口占用。',
  tags: ['端口', '随机', 'IANA', '网络', 'ephemeral'],
  category: 'network',
  icon: PlugConnectedRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Random port generator',
      description:
        'Generates random port numbers in a chosen range: IANA dynamic ports 49152-65535 by default, plus registered 1024-49151 or the whole 0-65535 space, with optional de-duplication and exclusion of common default ports. Each port is shown in decimal, hex, binary and its IANA range. It only produces numbers: a browser cannot probe whether a port is actually free on your machine.',
      tags: ['port', 'random', 'IANA', 'network', 'ephemeral'],
    },
  },
};
