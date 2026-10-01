import { FingerprintRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';
import { Md5GeneratorTool } from './Md5GeneratorTool';

export const manifest: ToolManifest = {
  id: 'md5-generator',
  name: 'MD5 生成器',
  description:
    '计算 MD5 摘要（纯实现，不依赖后端），同时给出 SHA-1 / SHA-256，支持文件哈希与结果校验。',
  tags: ['MD5', '哈希', '校验'],
  icon: FingerprintRegular,
  version: '0.1.0',
};

export default Md5GeneratorTool;
