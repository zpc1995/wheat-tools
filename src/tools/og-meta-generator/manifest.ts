import { ShareRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'og-meta-generator',
  name: 'Open Graph 社交卡片标签生成器',
  description:
    '填写标题、描述、URL 与图片，生成完整的 Open Graph、Twitter Card 与基础 SEO 标签块；按卡片类型校验缺失字段、给出图片尺寸建议，并用 CSS 画出 Facebook 与 Twitter 的近似预览卡片。不抓取目标网页的真实 meta（需要网络与 CORS）。',
  tags: ['Open Graph', 'Twitter Card', '社交卡片', 'SEO', 'meta'],
  category: 'network',
  icon: ShareRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Open Graph & Social Card Tag Generator',
      description:
        'Fill in title, description, URL and image to get a complete Open Graph, Twitter Card and basic SEO tag block. Validates missing fields per card type, gives image size advice, and draws Facebook and Twitter preview cards in CSS. It does not fetch the target page metadata (that needs network access and CORS).',
      tags: ['open graph', 'twitter card', 'social card', 'seo', 'meta tags'],
    },
  },
};
