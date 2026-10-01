import { DocumentTextRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'json-schema',
  name: 'JSON Schema 生成',
  description:
    '从一份或多份 JSON 样本生成 draft 2020-12 Schema；多样本合并推断必填字段，并说明 format 与 additionalProperties 的真实行为。',
  tags: ['JSON', 'Schema', '校验'],
  category: 'dev',
  icon: DocumentTextRegular,
  version: '0.1.0',
};
