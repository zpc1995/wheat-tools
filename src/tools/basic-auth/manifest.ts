import { KeyRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'basic-auth',
  name: 'Basic 认证头',
  description:
    '按 RFC 7617 生成 Authorization: Basic 头，也能把粘贴进来的认证头解回用户名与密码，并给出 curl、fetch、Node 代码片段。明确说明字符编码的歧义：标准没有规定默认编码，实践中多用 UTF-8，老服务可能按 ISO-8859-1，两种都可选。不生成 Digest 认证，不发起任何请求。',
  tags: ['Basic', 'Authorization', '认证', 'base64', 'curl', 'RFC 7617'],
  category: 'network',
  icon: KeyRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Basic Auth Header',
      description:
        'Build an Authorization: Basic header per RFC 7617, decode a pasted one back into username and password, and copy curl / fetch / Node snippets. It spells out the encoding ambiguity — the standard defines no default, real servers usually mean UTF-8, older ones may mean ISO-8859-1 — and offers both. It does not do Digest auth and never sends a request.',
      tags: ['basic', 'authorization', 'auth', 'base64', 'curl', 'rfc 7617'],
    },
  },
};
