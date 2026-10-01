import { BuildingBankRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'iban-validator',
  name: 'IBAN 验证器',
  description:
    '按 ISO 13616 校验 IBAN：检查国家代码、各国长度规则与 mod-97 校验位，并把 BBAN 拆成银行代码与账号。覆盖 SWIFT IBAN 注册表里全部 89 个国家/地区，只有校验位正确时才会通过。注意：它只判断号码格式是否合法，无法确认账号是否真实存在。',
  tags: ['IBAN', '银行账号', '校验位', 'mod-97'],
  category: 'text',
  icon: BuildingBankRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'IBAN validator',
      description:
        'Validate an IBAN the way ISO 13616 defines it: country code, that country’s length rule and the mod-97 check digits, plus a breakdown of the BBAN into bank code and account number. Covers all 89 countries in the SWIFT IBAN Registry. It checks whether the number is well formed, not whether the account exists.',
      tags: ['iban', 'bank account', 'checksum', 'mod-97'],
    },
  },
};
