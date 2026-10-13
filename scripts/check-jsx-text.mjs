/**
 * Catches Markdown syntax written as plain JSX text.
 *
 * JSX text is not Markdown: `<Caption1>它**复用**了…</Caption1>` renders the
 * asterisks literally, so the user reads `它**复用**了…` instead of *复用* being
 * emphasised. Two instances of this shipped before anyone noticed — the reviewer
 * reads the source, where it looks correct.
 *
 * The check walks the real syntax tree rather than grepping, because `**` is
 * legitimate in several other places and a regex cannot tell them apart:
 *
 *   - inside a comment (documentation may quote Markdown)
 *   - inside a string literal (a Markdown *sample* the user is meant to see)
 *   - the exponentiation operator in the maths tool
 *
 * Only `JsxText` nodes — the literal text between tags — are inspected, which is
 * exactly where the mistake happens and nowhere else.
 *
 * Usage: node scripts/check-jsx-text.mjs
 */
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const FILES = [
  ...globSync('src/tools/**/*.tsx'),
  ...globSync('src/app/**/*.tsx'),
  ...globSync('src/components/**/*.tsx'),
].sort();

/**
 * Bold spans, which never render when written as JSX text.
 *
 * Backticks are deliberately *not* flagged. They appear in prose across many
 * tools as a way of quoting code (`ls -l`, `localStorage.getItem(...)`), and the
 * project has used that convention consistently since the beginning. Literal
 * backticks around a code word read fine and are widely understood, whereas a
 * literal ** emphasis marker just looks like a mistake. Converting thirteen of
 * them to <code> would be a visual redesign, not a bug fix, so it is left as a
 * deliberate choice rather than quietly changed here.
 */
const MARKDOWN_IN_TEXT = [{ pattern: /\*\*[^*\n]+\*\*/, label: '加粗 **…**' }];

/**
 * Allowed exceptions, with the reason they are not a bug.
 *
 * A sample string that the user is meant to see as Markdown lives in a string
 * literal, not in JSX text, so it will not appear here at all — which is why
 * this list is short.
 */
const ALLOWED = [
  {
    file: 'src/tools/math-evaluator/MathEvaluatorTool.tsx',
    // The maths tool documents `**` as the exponentiation operator; showing it
    // with backticks is intentional notation, not a formatting mistake.
    text: '**',
  },
];

const findings = [];

for (const file of FILES) {
  const source = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const text = node.text;
      for (const { pattern, label } of MARKDOWN_IN_TEXT) {
        const match = pattern.exec(text);
        if (!match) continue;
        const allowed = ALLOWED.some(
          (entry) => entry.file === file && match[0].includes(entry.text),
        );
        if (allowed) continue;

        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        findings.push({
          file,
          line: line + 1,
          label,
          snippet: match[0].slice(0, 40),
        });
        break;
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

if (findings.length === 0) {
  console.log(`PASS  ${FILES.length} 个组件的 JSX 文本里没有会被原样显示的 Markdown 语法`);
  console.log('\n1/1 passed');
  process.exit(0);
}

console.log(`FAIL  JSX 文本里出现了不会渲染的 Markdown 语法（会原样显示字符）\n`);
for (const finding of findings) {
  console.log(`  ${finding.file}:${finding.line}  ${finding.label}  ${JSON.stringify(finding.snippet)}`);
}
console.log('\n改法：用 <strong>…</strong> 代替 **…**；行内代码用 <code>…</code>。');
console.log(`\n0/1 passed`);

process.exit(1);
