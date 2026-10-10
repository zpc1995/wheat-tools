import { MailRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'email-normalizer',
  name: '邮箱规范化与校验',
  description:
    '按写明的规则校验邮箱并给出规范化形式：域名统一小写、IDN 域名转 Punycode、本地部分是否小写可选（RFC 说它大小写敏感）、Gmail 的点号与 + 后缀规则可单独开关。同时提取本地部分/域名/TLD，并按内置的小型列表判断免费邮箱与一次性邮箱。不做真实存在性验证（需要发信）也不查 MX，所以一次通过不代表邮箱可用。',
  tags: ['邮箱', '邮件地址', '校验', '规范化', 'Punycode', 'Gmail', '一次性邮箱'],
  category: 'text',
  icon: MailRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Email normalizer and validator',
      description:
        'Validates email addresses against rules that are stated on the page, and returns a normalised form: lower-cased domain, IDN converted to Punycode, optional local-part lower-casing (RFC says the local part is case-sensitive), and optional Gmail dot / plus-tag rules. Splits the local part, domain and TLD, and classifies free and disposable providers from small built-in lists. It does not prove the mailbox exists (that needs SMTP) and does not look up MX.',
      tags: ['email', 'validation', 'normalisation', 'Punycode', 'Gmail', 'disposable'],
    },
  },
};
