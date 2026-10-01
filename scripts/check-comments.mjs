/**
 * Detects block comments that the comment-closing sequence ends prematurely.
 *
 * Writing the two-character close marker inside a block comment (for example
 * while documenting cron step syntax) ends the comment right there, after which
 * the parser reports a cascade of confusing errors on unrelated lines. That has
 * happened twice in this repo, so it is now checked mechanically.
 *
 * Tokenisation is delegated to the TypeScript scanner rather than hand-rolled,
 * so strings, template literals and regular expressions cannot confuse it.
 *
 * Two signatures are reported:
 *
 *   1. A comment spanning several lines whose final line continues with code —
 *      the comment clearly ended in the middle of its own sentence.
 *   2. A comment line carrying a **second** close marker after the one the
 *      scanner stopped at. The author wrote that trailing marker intending it to
 *      be the end of the comment, so its presence proves the first one closed it
 *      early. This catches the single-line case, which signature 1 misses.
 *
 * The second rule is what keeps legitimate inline documentation — one close
 * marker, followed by a member declaration — from being flagged.
 *
 * Usage: node scripts/check-comments.mjs
 */
import { globSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const files = [
  ...globSync('src/**/*.ts'),
  ...globSync('src/**/*.tsx'),
  ...globSync('scripts/**/*.mjs'),
];

// Assembled from parts so this file's own comments stay intact.
const CLOSE = '*' + '/';

/** Content after a close marker that is still a legitimate close. */
const BENIGN_TAIL = /^[)\]};,]*$/;

let problems = 0;
let commentCount = 0;

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ false,
    ts.LanguageVariant.Standard,
    text,
  );

  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (token === ts.SyntaxKind.MultiLineCommentTrivia) {
      commentCount += 1;
      const start = scanner.getTokenStart();
      const end = scanner.getTokenEnd();

      const startLine =
        text.slice(0, start).split('\n').length;
      const endLine = text.slice(0, end).split('\n').length;

      const lineEnd = text.indexOf('\n', end);
      const tail = text.slice(end, lineEnd === -1 ? text.length : lineEnd);
      const significant = tail.replace(/[)\]};,]+/g, '').trim();

      // Signature 2: another close marker remains on the same line, which can
      // only be the one the author meant to end the comment.
      const extraClose = tail.includes(CLOSE);

      // Signature 1: a multi-line comment whose last line continues with code.
      const multiLine = endLine > startLine;
      const continuesWithCode =
        !BENIGN_TAIL.test(tail.trim()) && significant !== '';

      if (extraClose || (multiLine && continuesWithCode)) {
        problems += 1;
        console.log(
          `FAIL  ${file}:${endLine}  注释（始于第 ${startLine} 行）在此行中途结束` +
            (extraClose ? '：本行还存在第二个结束标记' : ''),
        );
        console.log(`        ${text.split('\n')[endLine - 1].trim()}`);
      }
    }
    token = scanner.scan();
  }
}

console.log(
  problems === 0
    ? `PASS  ${files.length} 个文件、${commentCount} 个块注释均正常闭合`
    : `\n共 ${problems} 处问题`,
);
process.exit(problems === 0 ? 0 : 1);
