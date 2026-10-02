import { DocumentSignatureRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'pdf-signature-inspector',
  name: 'PDF 签名信息查看器',
  description:
    '只读查看 PDF 里的签名结构：签名者、时间、原因、位置、子过滤器与 /ByteRange 覆盖范围，并算出签名是否覆盖了整个文件。不做密码学验证——不解析 CMS、不验证书链、不验时间戳，因此不会给出“签名有效”的结论。',
  tags: ['PDF', '签名', '数字签名', 'ByteRange', '文档'],
  category: 'dev',
  icon: DocumentSignatureRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'PDF Signature Inspector',
      description:
        'Reads the signature structures out of a PDF: signer name, time, reason, location, sub-filter and the /ByteRange coverage, including whether the signature covers the whole file. It performs no cryptographic verification — no CMS parsing, no certificate chain, no timestamp validation — so it never reports a signature as valid.',
      tags: ['pdf', 'signature', 'digital signature', 'ByteRange', 'document'],
    },
  },
};
