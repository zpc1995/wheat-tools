import { RulerRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'unit-converter',
  name: '单位换算',
  description:
    '长度、重量、温度、面积、体积、速度、存储、时间、压力、能量互转；温度按仿射变换处理，存储区分 1000 与 1024。',
  tags: ['单位', '换算', '度量'],
  category: 'dev',
  icon: RulerRegular,
  version: '0.1.0',
};
