import { ShieldLockRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'otp-generator',
  name: 'OTP 验证码生成器',
  description:
    '按 Base32 密钥生成 TOTP（RFC 6238）与 HOTP（RFC 4226）动态验证码：SHA-1/256/512、6 位或 8 位、自定义周期，显示剩余有效秒数与下一个验证码，并可解析 otpauth:// 密钥 URI。密钥不保存、不上传，也不做服务器端校验。',
  tags: ['TOTP', 'HOTP', '两步验证', '2FA', '动态口令', 'otpauth'],
  category: 'crypto',
  icon: ShieldLockRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'OTP generator',
      description:
        'Generate TOTP (RFC 6238) and HOTP (RFC 4226) codes from a Base32 secret: SHA-1/256/512, 6 or 8 digits, a custom time step, a seconds-remaining countdown, the next code, and an otpauth:// URI parser. The secret is never stored or uploaded, and nothing is validated server-side. Verified against the RFC 4226 Appendix D and RFC 6238 Appendix B vectors.',
      tags: ['TOTP', 'HOTP', 'two-factor', '2FA', 'one-time password', 'otpauth'],
    },
  },
};
