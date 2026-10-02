import { PhoneRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'phone-parser',
  name: '电话号码解析',
  description:
    '解析并格式化电话号码：识别国家码、国内有效号码、长途冠码与分机号，输出 E.164、国际格式、国内格式、tel URI 与纯数字，并按各国编号规则校验长度与号段。收录 39 个常用国家和地区；未收录的国家码会明确提示，不做猜测。不查询归属地与运营商，不拨打也不发短信。',
  tags: ['电话', '号码', 'E.164', '格式化', '校验'],
  category: 'text',
  icon: PhoneRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Phone Number Parser',
      description:
        'Parse and format phone numbers: detect the country calling code, national significant number, trunk prefix and extension, and emit E.164, international, national, tel URI and plain digits while validating each country\u2019s numbering rules. Covers 39 countries and regions; anything else is reported as not covered rather than guessed. No carrier or location lookup, no calling, no texting.',
      tags: ['phone', 'number', 'E.164', 'format', 'validate'],
    },
  },
};
