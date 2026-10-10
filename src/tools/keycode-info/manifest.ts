import { KeyboardRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'keycode-info',
  name: '键盘事件信息',
  description:
    '按下任意键，查看 event.key、event.code、已废弃的 keyCode / which、location 与修饰键状态，并解释 code（物理位置）与 key（产生的字符）的区别：同一物理键在 Dvorak / AZERTY 布局下 code 相同而 key 不同。附常用键位对照表与最近按键历史（可复制）。不做按键模拟，也不做按键宏。',
  tags: ['键盘', 'keycode', '按键码', 'key', 'code', '事件'],
  category: 'dev',
  icon: KeyboardRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Keyboard Event Info',
      description:
        'Press any key to inspect event.key, event.code, the deprecated keyCode / which, location and modifier state, and to see why code (physical position) and key (produced character) differ — the same physical key reports the same code but a different key on Dvorak or AZERTY. Includes a key reference table and a copyable press history. Does not simulate keystrokes and does not build macros.',
      tags: ['keyboard', 'keycode', 'key', 'code', 'event'],
    },
  },
};
