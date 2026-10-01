import { CalculatorRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';
import { NumberBaseTool } from './NumberBaseTool';

export const manifest: ToolManifest = {
  id: 'number-base',
  name: '进制转换',
  description:
    '2–36 进制互转，整数用 BigInt 精确计算不丢精度，支持小数与常用进制对照。',
  tags: ['进制', '二进制', '十六进制'],
  category: 'dev',
  icon: CalculatorRegular,
  version: '0.1.0',
};

export default NumberBaseTool;
