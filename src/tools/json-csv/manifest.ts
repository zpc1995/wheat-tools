import { TableRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'json-csv',
  name: 'JSON ↔ CSV 转换',
  description:
    'JSON 数组与 CSV 互转：键取并集、缺失值留空，可按点号路径扁平化（user.name）或把嵌套结构写成 JSON 文本；CSV 解析遵循 RFC 4180，正确处理带引号的字段、字段内逗号/换行与双双引号转义。分隔符、表头、行尾与 BOM 可选（BOM 用于避免 Excel 打开中文 CSV 乱码）。不读写 Excel（xlsx）文件。',
  tags: ['JSON', 'CSV', 'TSV', '转换', '表格', 'RFC 4180'],
  category: 'dev',
  icon: TableRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'JSON ↔ CSV',
      description:
        'Convert JSON arrays to CSV and back: columns are the union of every object key with missing values left empty, and nested objects are either flattened to dotted paths (user.name) or written as JSON text. The parser follows RFC 4180, so quoted fields, embedded commas and line breaks, and doubled quotes all round-trip. Delimiter, header row, line ending and BOM are configurable (the BOM stops Excel from mangling UTF-8 Chinese). It does not read or write Excel (xlsx) files.',
      tags: ['json', 'csv', 'tsv', 'converter', 'spreadsheet'],
    },
  },
};
