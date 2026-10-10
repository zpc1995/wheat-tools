import { CodeBlockRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'sql-formatter',
  name: 'SQL 格式化',
  description:
    '把 SQL 排成关键字大写、子句换行的可读形式，或压缩成一行。扫描器按词法切分，字符串字面量、引号标识符、注释与 PostgreSQL 美元引用里的内容一个字节都不改；括号或引号不配平会报错并给出行列。不执行 SQL、不校验方言语义。',
  tags: ['SQL', '格式化', '美化', '压缩', 'sqlite'],
  category: 'dev',
  icon: CodeBlockRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'SQL formatter',
      description:
        'Pretty-print SQL with uppercased keywords and one clause per line, or squeeze it onto a single line. A real lexer keeps string literals, quoted identifiers, comments and PostgreSQL dollar-quoted bodies byte-for-byte intact, and unbalanced brackets or quotes are reported with a line and column. It does not execute SQL and does not validate dialect semantics.',
      tags: ['sql', 'formatter', 'beautify', 'minify'],
    },
  },
};
