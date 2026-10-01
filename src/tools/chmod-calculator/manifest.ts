import { ShieldKeyholeRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'chmod-calculator',
  name: 'Chmod 计算器',
  description:
    '勾选用户/组/其他的读、写、执行位，实时得出八进制与 rwx 符号权限；支持 setuid、setgid、sticky 特殊位（4755、2755、1777），也能把八进制或符号形式反填回复选框，并给出对应的 chmod 命令。不涉及 ACL 与任何真实文件操作。',
  tags: ['chmod', '权限', '八进制', 'setuid', 'Linux'],
  category: 'dev',
  icon: ShieldKeyholeRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Chmod calculator',
      description:
        'Tick the read, write and execute bits for user, group and other to get the octal mode and the rwx string, including the setuid, setgid and sticky bits (4755, 2755, 1777). Octal and symbolic input fill the checkboxes back in, and the matching chmod command is generated. No ACL support and no file access.',
      tags: ['chmod', 'permissions', 'octal', 'setuid', 'linux'],
    },
  },
};
