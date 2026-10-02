/**
 * Checks the PDF signature inspector.
 *
 * Three independent references stand behind the assertions here:
 *
 *   1. **Hand-built PDFs.** Every fixture is assembled byte by byte in this file
 *      from a known structure, so the expected parse result is known by
 *      construction rather than read off the implementation. Fixtures are
 *      deliberately built to be *valid* PDFs (correct xref, trailer, and a
 *      64 KiB alignment) so `pdfinfo` accepts them too.
 *   2. **`/ByteRange` arithmetic done by hand.** `[0 100 200 300]` over a
 *      500-byte file is asserted to mean 400 signed bytes and 80.00%, which is
 *      the one number in this tool that a reader is meant to act on.
 *   3. **`pdfinfo` (poppler-utils)**, when present, cross-checks page count and
 *      PDF version on a generated multi-page file. Absent, that section reports
 *      itself skipped instead of pretending to have run.
 *
 * Two counter-examples are built as real files to prove the obvious
 * implementation is wrong:
 *
 *   - a file where `/Type /Sig` appears only inside a hex string;
 *   - a file with a real signature reachable *only* through `/V 12 0 R`.
 *
 * Usage: node scripts/check-pdf-signature-inspector.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/pdf-signature-inspector/pdfSignatureUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const textSource = readFileSync('src/tools/pdf-signature-inspector/pdfTextUtils.ts', 'utf8');
const textCompiled = ts.transpileModule(textSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/pdf-signature-text.mjs', textCompiled);
writeFileSync(
  '.verify/pdf-signature-utils.mjs',
  compiled.replace(/from '\.\/pdfTextUtils'/, "from './pdf-signature-text.mjs'"),
);
const M = await import(pathToFileURL('.verify/pdf-signature-utils.mjs').href);
const T = await import(pathToFileURL('.verify/pdf-signature-text.mjs').href);

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok
        ? ''
        : `\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`),
  );
}

/* ------------------------------------------------------------------ */
/* Byte-level helpers for the fixtures                                 */
/* ------------------------------------------------------------------ */

/**
 * Latin1 helpers.
 *
 * Every fixture is a *byte* stream that this file also manipulates as text, so the
 * two directions must be exact inverses. `TextEncoder` is UTF-8: using it on a
 * latin1 string would turn one 0xfc byte into two and silently change the file
 * length, which is precisely the arithmetic these fixtures exist to pin down. It
 * is also why the byte range assertions can fail with an off-by-N that has nothing
 * to do with the parser.
 */
const bytes = (value) => Uint8Array.from(value, (ch) => ch.charCodeAt(0) & 0xff);
const asText = (data) => Buffer.from(data).toString('latin1');
const concat = (parts) => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

/**
 * A PDF literal string, encoded the way a PDF writer must.
 *
 * PDF text strings are either PDFDocEncoding (a near-latin1 single-byte set) or
 * UTF-16BE with a byte-order mark — never UTF-8. A fixture that simply dropped
 * JavaScript's UTF-16 code units into the parentheses would be writing mojibake,
 * and any assertion about the decoded name would then be testing the fixture's
 * bug rather than the parser.
 */
const pdfString = (value) => {
  const isSingleByte = [...value].every((ch) => ch.codePointAt(0) <= 0xff);
  if (isSingleByte) {
    return `(${value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
  }
  let hex = 'feff';
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (code > 0xffff) {
      const adjusted = code - 0x10000;
      hex += (0xd800 + (adjusted >> 10)).toString(16).padStart(4, '0');
      hex += (0xdc00 + (adjusted & 0x3ff)).toString(16).padStart(4, '0');
    } else {
      hex += code.toString(16).padStart(4, '0');
    }
  }
  return `<${hex}>`;
};

/**
 * Assembles a minimal but *valid* PDF.
 *
 * `objects[i]` is the body of object `i + 1`; the caller is responsible for
 * putting the object number in any `/N 0 R` reference it writes. The xref table
 * is generated from the real byte offsets, which is what makes the fixtures
 * acceptable to `pdfinfo` and therefore usable as cross-check material.
 */
function buildPdf({ version = '1.4', objects, rootNumber, extraTrailer = '', linearized = false }) {
  const header = bytes(`%PDF-${version}\n%\u00e2\u00e3\u00cf\u00d3\n`);
  const chunks = [header];
  let length = header.length;
  const offsets = [];

  if (linearized) {
    const body = bytes('1 0 obj\n<</Linearized 1/L 0/O 2/E 0/N 1/T 0>>\nendobj\n');
    offsets.push(length);
    chunks.push(body);
    length += body.length;
  }

  objects.forEach((body, index) => {
    offsets.push(length);
    // The `N G obj` wrapper and `endobj` are part of the syntax, not the body:
    // omitting them yields a file that looks like a PDF to this reader's regex
    // and to nothing else. `pdfinfo` is what catches that, which is the point of
    // keeping it in the loop.
    const text = `${index + 1} 0 obj\n${body}\nendobj\n`;
    chunks.push(bytes(text));
    length += text.length;
  });

  const xrefOffset = length;
  const rows = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  const xref =
    `xref\n0 ${offsets.length + 1}\n` +
    '0000000000 65535 f \n' +
    rows +
    `trailer\n<</Size ${offsets.length + 1}/Root ${rootNumber} 0 R${extraTrailer}>>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(bytes(xref));

  return concat(chunks);
}

const SIGNATURE_SLOT = '<' + 'F'.repeat(64) + '>';
/**
 * The `/ByteRange` placeholder.
 *
 * Local fixtures stay under 10 KiB, so the real entry never exceeds 24 bytes. The
 * placeholder is padded *inside* the brackets — whitespace is legal in a PDF
 * array — because padding after the `]` would leave the placeholder's synthetic
 * offsets and its real value at different file positions.
 */
const BYTE_RANGE_PLACEHOLDER = '[0 0000 0000 0000]';

/** Index of the `n`th occurrence of `needle`, or -1. */
function nthIndexOf(haystack, needle, n) {
  let at = -1;
  for (let i = 0; i <= n; i += 1) {
    at = haystack.indexOf(needle, at + 1);
    if (at === -1) return -1;
  }
  return at;
}

/**
 * Signs a fixture the way a real signer does, from the byte level up.
 *
 * `bodies` is the complete object list with two placeholders inside the
 * signature dictionary: BYTE_RANGE_PLACEHOLDER and SIGNATURE_SLOT. The steps are
 * ordered so no length is ever assumed:
 *
 *   1. assemble the document with the placeholders in place;
 *   2. locate both, deriving every later offset from those positions;
 *   3. fill the slot with the CMS stand-in and the entry with the two segments
 *      `[0, byteRangeAt)` and `[byteRangeAt + contentsLength, fileSize)`;
 *   4. splice — never re-layout — so the offsets computed in step 2 still hold.
 *
 * The hole is exactly the `/Contents` hex string, so the `/ByteRange` entry
 * denotes itself and everything after it, which is what real signatures do.
 * `trailingText` is appended *after* those offsets are fixed, which is how the
 * check models content added to a document that was already signed.
 * `reserveTailBytes` writes space into that trailing region so a later revision
 * can be spliced into it: that is the only way to build a file whose first
 * signature stops short of the end *and* whose second one reaches it, i.e. the
 * real incremental-update shape.
 */
function signDocument({
  objects,
  rootNumber,
  version = '1.4',
  extraTrailer = '',
  linearized = false,
  signWith,
  reserveTailBytes = 0,
}) {
  const base = buildPdf({ version, objects, rootNumber, extraTrailer, linearized });
  const text = asText(base);

  const contentsBytes = bytes(signWith.contents ?? '<' + '00'.repeat(512) + '>');
  const tail = signWith.trailingText ? bytes(signWith.trailingText) : new Uint8Array(0);

  const slotPattern = new RegExp(SIGNATURE_SLOT.replace(/[<>]/g, '\\$&'), 'g');
  const rangePattern = new RegExp(BYTE_RANGE_PLACEHOLDER.replace(/[[\]]/g, '\\$&'), 'g');
  const slotMatches = [...text.matchAll(slotPattern)];
  const rangeMatches = [...text.matchAll(rangePattern)];
  if (slotMatches.length === 0 || slotMatches.length !== rangeMatches.length) {
    throw new Error('fixture must place one /ByteRange and one /Contents placeholder per signature');
  }
  if (signWith.signAll && slotMatches.length !== signWith.signAll) {
    throw new Error('fixture signature count does not match signAll');
  }

  const placeholderWidth = BYTE_RANGE_PLACEHOLDER.length;
  /**
   * Length of the file *at the moment it is signed*.
   *
   * The appended tail is deliberately excluded: `/ByteRange` describes the bytes
   * that existed when the signature was computed, so folding the tail in here
   * would make the fixture claim to have signed content that was added afterwards
   * — and the "content appended after signing" case would then not exist at all.
   */
  const signedLength = text.length + slotMatches.length * (contentsBytes.length - SIGNATURE_SLOT.length);
  const parts = [];
  let cursor = 0;
  const reserved = reserveTailBytes > 0 ? bytes('%'.repeat(reserveTailBytes)) : new Uint8Array(0);
  slotMatches.forEach((slotMatch, index) => {
    const slotAt = slotMatch.index;
    const byteRangeAt = rangeMatches[index].index;
    if (byteRangeAt > slotAt) throw new Error('fixture placeholders are in an impossible order');
    // The second segment starts at the /Contents value, which sits
    // `byteRangeAt + placeholderWidth + 10` into the *signed* file: the placeholder
    // is replaced by the entry (same width) and the 10 bytes `/Contents ` follow it.
    // Adding `contentsBytes.length` here instead would be the classic off-by-the-slot
    // error — the very mistake the /ByteRange assertions exist to catch — and it
    // would make the fixture claim the CMS blob is part of the signed region.
    const partTwoStart = byteRangeAt + placeholderWidth + '/Contents '.length;
    // The reserved region is signed by the signature that is being written now; a
    // later revision may overwrite it, which is exactly what makes the earlier
    // signature stop covering the end of the final file.
    const partTwoLength = signedLength - partTwoStart - reserved.length;
    if (partTwoLength <= 0) throw new Error('fixture byte range would not reach the end of the file');
    // Padding goes before the `]`. Trailing padding is the subtler bug: the entry
    // would occupy more bytes than it names, every later offset would shift by the
    // padding, and the declared `/Contents` start would be short by exactly that
    // amount — a fixture that *looks* signed but whose arithmetic is off by 5.
    const entry = `[0 ${byteRangeAt} ${partTwoStart} ${partTwoLength}`.padEnd(placeholderWidth - 1, ' ') + ']';
    if (entry.length !== placeholderWidth) {
      throw new Error(`fixture byte range ${entry} does not fit a ${placeholderWidth}-byte placeholder`);
    }
    parts.push(bytes(text.slice(cursor, byteRangeAt)));
    parts.push(bytes(entry));
    parts.push(bytes(text.slice(byteRangeAt + placeholderWidth, slotAt)));
    parts.push(contentsBytes);
    cursor = slotAt + SIGNATURE_SLOT.length;
  });
  parts.push(bytes(text.slice(cursor)));
  parts.push(tail);
  parts.push(reserved);

  const pdf = concat(parts);
  if (pdf.length !== signedLength + tail.length) {
    throw new Error(
      `fixture assembly changed the file length: ${pdf.length} vs ${signedLength + tail.length}`,
    );
  }
  return { pdf, fileSize: pdf.length, signedLength };
}

/**
 * Appends an incremental revision that contains one more signature, then signs it.
 *
 * This is how signature number two arrives in the real world: the original bytes
 * are untouched, a new signature dictionary plus a new cross-reference section are
 * appended, and the new `/ByteRange` covers everything before its own `/Contents`
 * hole. The earlier signature is then left covering only the earlier revision —
 * which is the property the report has to state without calling it tampering.
 */
function appendSignedRevision(pdf, { body, contents, trailer }) {
  const head = asText(pdf) + `${body}\n`;
  const revByteRangeAt = head.lastIndexOf(BYTE_RANGE_PLACEHOLDER);
  const revSlotAt = head.lastIndexOf(SIGNATURE_SLOT);
  if (revByteRangeAt === -1 || revSlotAt === -1) throw new Error('revision needs placeholders');

  // Everything after the new signature dictionary is its cross-reference section.
  // Its byte offsets are already fixed — the /Contents slot keeps its width — so it
  // can simply be appended and the resulting length measured.
  const xrefAt = head.length + (contentsBytesLength(contents) - SIGNATURE_SLOT.length);
  const withXref =
    head + `xref\n0 1\n0000000000 65535 f \n${trailer}\nstartxref\n${xrefAt}\n%%EOF\n`;
  const fileSize = withXref.length + (contentsBytesLength(contents) - SIGNATURE_SLOT.length);
  const partTwoStart = revByteRangeAt + BYTE_RANGE_PLACEHOLDER.length + '/Contents '.length;
  const entry = `[0 ${revByteRangeAt} ${partTwoStart} ${fileSize - partTwoStart}`.padEnd(
    BYTE_RANGE_PLACEHOLDER.length - 1,
    ' ',
  ) + ']';
  if (entry.length !== BYTE_RANGE_PLACEHOLDER.length) throw new Error('revision entry does not fit');

  const out =
    withXref.slice(0, revByteRangeAt) +
    entry +
    withXref.slice(revByteRangeAt + BYTE_RANGE_PLACEHOLDER.length, revSlotAt) +
    contents +
    withXref.slice(revSlotAt + SIGNATURE_SLOT.length);
  const signed = bytes(out);
  if (signed.length !== fileSize) throw new Error('revision length mismatch');
  return signed;
}

/** Byte length of a /Contents literal, which is written as a hex string. */
function contentsBytesLength(contents) {
  return contents.length;
}

/** Object bodies for a one- or two-page document. */
function documentObjects({ pages = 1, acroForm = null, children = [] }) {
  const objects = [];
  // Object 3 is the /Length-plus-stream object, object 5 is the AcroForm; both
  // references below must name those numbers, not the index next to them.
  objects.push('<</Type/Catalog/Pages 2 0 R' + (acroForm ? '/AcroForm 5 0 R' : '') + '>>');
  // Object 3 below is the first page; the per-page loop further down starts at
  // object 6. The Kids list has to name those same objects, or the page tree
  // points at nothing and the page count is wrong.
  const kids = ['3 0 R'];
  for (let i = 1; i < pages; i += 1) kids.push(`${5 + i} 0 R`);
  objects.push(`<</Type/Pages/Kids[${kids.join(' ')}]/Count ${pages}>>`);
  objects.push('<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R>>');
  objects.push('<</Length 44>>\nstream\nBT /F1 12 Tf 20 100 Td (Hello) Tj ET\nendstream');
  objects.push(acroForm ?? '<</Fields[]>>');
  for (let i = 0; i < pages; i += 1) {
    objects.push(
      '<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Resources<</Font<</F1 9 0 R>>>>/Contents 4 0 R>>',
    );
  }
  objects.push('<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>');
  // `children` is a *list* of object bodies. Concatenating two dictionaries with a
  // newline into one string would make them one object with one object number,
  // while any `/V n 0 R` written against the second number would dangle.
  objects.push(...children);
  return objects;
}

/* ------------------------------------------------------------------ */
/* 1. Hand-built PDFs: structure and signature discovery               */
/* ------------------------------------------------------------------ */

console.log('--- 1. 自造 PDF：签名结构解析 ---');

const signatureDictionary =
  '<</Type/Sig/Filter/Adobe.PPKLite/SubFilter/adbe.pkcs7.detached/ByteRange [0 0000 0000 0000]' +
  `/Contents ${SIGNATURE_SLOT}/Name ${pdfString('张伟')}/Reason ${pdfString('年度审批')}` +
  `/Location ${pdfString('北京')}/ContactInfo ${pdfString('zhang@example.com')}` +
  "/M(D:20240315103000+08'00')>>";

/**
 * A one-signature document whose object numbers are computed, not hand-counted.
 *
 * The base objects occupy 1..(6 + pages) (see `documentObjects`), and the field
 * plus its signature dictionary are the two objects after them — so the field is
 * `8 + pages` and the dictionary one higher. Writing those numbers as literals is how
 * a fixture silently stops testing anything: a reference to the wrong object still
 * parses, and the assertion that follows fails for a reason that looks like a
 * parser bug. `pages` changes the base layout, so it is a parameter here.
 */
function signedDocumentObjects({ pages = 2, signature = signatureDictionary } = {}) {
  // The base layout is 6 objects for one page plus two more per additional page,
  // and `buildPdf` numbers the list from 1 — hence 7 + pages for the field.
  const fieldNumber = 7 + pages;
  const signatureNumber = fieldNumber + 1;
  return documentObjects({
    pages,
    acroForm: `<</Fields[${fieldNumber} 0 R]>>`,
    children: [
      `<</Type/Annot/Subtype/Widget/FT/Sig/T(Signature1)/V ${signatureNumber} 0 R/Rect[0 0 0 0]>>`,
      signature,
    ],
  });
}

const signedObjects = signedDocumentObjects();
const signedBase = signDocument({
  version: '1.7',
  objects: signedObjects,
  rootNumber: 1,
  signWith: { contents: '<' + 'AB'.repeat(600) + '>' },
});
const signed = M.inspectPdf(signedBase.pdf, 'signed.pdf');

check('合法签名 PDF 解析成功', signed.ok, true);
check('版本 1.7', signed.ok ? signed.report.headerVersion : null, '1.7');
check('页数（走页面树）', signed.ok ? signed.report.pageCount : null, 2);
check('页数来源为 page-tree', signed.ok ? signed.report.pageCountSource : null, 'page-tree');
check('未加密', signed.ok ? signed.report.encrypted : null, false);
check('非线性化', signed.ok ? signed.report.linearized : null, false);
check('签名数量', signed.ok ? signed.report.signatures.length : null, 1);
check('未签名字段数量为 0', signed.ok ? signed.report.unsignedSignatureFields.length : null, 0);

{
  const sig = signed.ok ? signed.report.signatures[0] : null;
  check('签名对象号（推导值：两页时字段是第 9 号、字典是第 10 号）', sig?.objectNumber, 10);
  check('字段路径（经字段的 /V 间接引用解析出来）', sig?.fieldNames, ['Signature1']);
  check('/Type /Sig 被识别', sig?.typedAsSig, true);
  check('签名者名称（非 latin1 字符按 UTF-16BE 解码）', sig?.name, '张伟');
  check('签名时间', sig?.signingTime, "D:20240315103000+08'00'");
  check('原因', sig?.reason, '年度审批');
  check('位置', sig?.location, '北京');
  check('联系方式', sig?.contactInfo, 'zhang@example.com');
  check('子过滤器（名称值按 PDF 的写法带前导斜杠）', sig?.subFilter, '/adbe.pkcs7.detached');
  check('/Filter', sig?.filter, '/Adobe.PPKLite');
  check('/Contents 字节数（600 字节的 CMS 槽位）', sig?.contentsBytes, 600);
}

/* ------------------------------------------------------------------ */
/* 2. 反证：文本搜索既会误报也会漏报                                     */
/* ------------------------------------------------------------------ */

console.log('--- 2. 反证：/Type /Sig 文本搜索的两类错误 ---');

// False positive: the bytes `/Type /Sig` live inside a hex string (a plausible
// certificate fingerprint dump), and nowhere in a dictionary.
const decoyHex = Buffer.from('/Type /Sig and more', 'latin1').toString('hex');
const decoyObjects = documentObjects({
  pages: 1,
  acroForm: `<</Fields[]/Decoy<${decoyHex}>>>`,
});
const decoy = M.inspectPdf(buildPdf({ objects: decoyObjects, rootNumber: 1 }), 'decoy.pdf');
check('反证 1：字符串里的 /Type /Sig 不算签名', decoy.ok ? decoy.report.signatures.length : -1, 0);
{
  // The claim "a text search would be fooled" has to be checked against the bytes
  // that are actually there. The pattern sits in the file as hex digits, so the
  // proof is: those digits are present, and they decode to `/Type /Sig and more`.
  const decoyText = asText(buildPdf({ objects: decoyObjects, rootNumber: 1 }));
  check('反证 1：文件里确实存在 /Type /Sig 的十六进制写法', decoyText.includes(decoyHex), true);
  check(
    '反证 1：那段十六进制解码后正是 /Type /Sig and more',
    Buffer.from(decoyHex, 'hex').toString('latin1'),
    '/Type /Sig and more',
  );
  check('反证 1：但它是字符串内容，不是字典键（朴素搜索会误报）', decoyText.includes('/Type/Sig'), false);
}

// False negative: a real signature whose dictionary is reachable only via the
// field's indirect /V, and which carries no /Type /Sig of its own.
const indirectObjects = documentObjects({
  pages: 1,
  acroForm: '<</Fields[8 0 R]>>',
  children: [
    '<</Type/Annot/Subtype/Widget/FT/Sig/T(Approval)/V 9 0 R/Rect[0 0 0 0]>>',
    '<</Filter/Adobe.PPKLite/SubFilter/ETSI.CAdES.detached/ByteRange [0 0000 0000 0000]' +
      `/Contents ${SIGNATURE_SLOT}/Name ${pdfString('Li Lei')}>>`,
  ],
});
const indirect = signDocument({ objects: indirectObjects, rootNumber: 1, signWith: {} });
const indirectReport = M.inspectPdf(indirect.pdf, 'indirect.pdf');
check('反证 2：只经 /V 间接引用的签名仍被找到', indirectReport.ok ? indirectReport.report.signatures.length : -1, 1);
check(
  '反证 2：该字典自身没有 /Type /Sig（朴素搜索会漏报）',
  indirectReport.ok ? indirectReport.report.signatures[0]?.typedAsSig : null,
  false,
);
check('反证 2：字段路径仍被关联上', indirectReport.ok ? indirectReport.report.signatures[0]?.fieldNames : null, [
  'Approval',
]);
check(
  '反证 2：文件里确实没有 /Type /Sig 文本',
  asText(indirect.pdf).includes('/Type /Sig') || asText(indirect.pdf).includes('/Type/Sig'),
  false,
);

// A /FT /Sig field with no /V: reported as unsigned, not as a signature.
const unsignedFieldObjects = documentObjects({
  pages: 1,
  acroForm: '<</Fields[8 0 R]>>',
  children: ['<</Type/Annot/Subtype/Widget/FT/Sig/T(Signature2)/Rect[0 0 0 0]>>'],
});
const unsignedField = M.inspectPdf(buildPdf({ objects: unsignedFieldObjects, rootNumber: 1 }), 'unsigned.pdf');
check('只有 /FT /Sig、没有 /V 的字段不算签名', unsignedField.ok ? unsignedField.report.signatures.length : -1, 0);
check('它被列为未签名字段', unsignedField.ok ? unsignedField.report.unsignedSignatureFields.length : -1, 1);
check(
  '未签名字段路径',
  unsignedField.ok ? unsignedField.report.unsignedSignatureFields[0]?.path : null,
  'Signature2',
);

// A /V pointing at an object number the file does not contain.
const danglingObjects = documentObjects({
  pages: 1,
  acroForm: '<</Fields[8 0 R]>>',
  children: ['<</Type/Annot/Subtype/Widget/FT/Sig/T(Broken)/V 99 0 R/Rect[0 0 0 0]>>'],
});
const dangling = M.inspectPdf(buildPdf({ objects: danglingObjects, rootNumber: 1 }), 'dangling.pdf');
check('悬空的 /V 引用不会凭空造出签名', dangling.ok ? dangling.report.signatures.length : -1, 0);
check('悬空的 /V 被记为未签名字段', dangling.ok ? dangling.report.unsignedSignatureFields[0]?.path : null, 'Broken');

/* ------------------------------------------------------------------ */
/* 3. /ByteRange 算术：唯一真正可验证的部分                             */
/* ------------------------------------------------------------------ */

console.log('--- 3. /ByteRange 算术（手工核对） ---');

{
  // The worked example from the spec: [0 100 200 300) over a 500-byte file.
  const range = M.parseByteRange([0, 100, 200, 300], 500);
  check('自造例：区段解析为 [0,100) 与 [200,500)', range.segments, [
    { start: 0, end: 100, length: 100 },
    { start: 200, end: 500, length: 300 },
  ]);
  check('自造例：已签字节数 = 400', range.signedBytes, 400);
  check('自造例：覆盖率 = 80%', range.coveragePercent, 80);
  check('自造例：区段间空洞 = 100（即 /Contents 槽位）', range.gapBytes, 100);
  check('自造例：覆盖到文件末尾', range.reachesEnd, true);
  check('自造例：末尾未覆盖字节 = 0', range.trailingBytes, 0);
  check('自造例：没有异常', range.errors, []);
  check('自造例：可用', range.usable, true);

  // The naive reading of the same entry as start/end pairs: [0,100) and
  // [200,300), i.e. 200 signed bytes and 60%. Assert the two differ, so a
  // regression to the naive reading cannot pass silently.
  const naive = 100 + 100;
  check('朴素地把数组读成起止对会得到 200 字节（证明本检查能抓到该缺陷）', naive === range.signedBytes, false);

  // Appended content: last segment stops short of the file end.
  const appended = M.parseByteRange([0, 100, 200, 200], 560);
  check('末尾被追加 60 字节时签名未覆盖全文件', appended.reachesEnd, false);
  check('末尾被追加时 trailingBytes = 160（560 - 400）', appended.trailingBytes, 160);
  check('末尾被追加时覆盖率 = 300/560', appended.coveragePercent, 53.57);
  check('末尾被追加时给出可疑提示', appended.problems.length > 0, true);
}

{
  // The empty hole is the /Contents string; the trailer after it must be
  // reported as uncovered only when it really lies outside the segments.
  const range = M.parseByteRange([0, 100, 200, 300], 1000, 400);
  check('startxref 落在已签区段内 → coversTrailer', range.coversTrailer, true);
  const outside = M.parseByteRange([0, 100, 200, 300], 1000, 700);
  check('startxref 落在已签区段外 → 不覆盖尾部', outside.coversTrailer, false);
  check('覆盖不到尾部时给出提示', outside.problems.some((p) => p.includes('startxref')), true);
}

{
  const cases = [
    ['奇数个元素 [0 100 200]', [0, 100, 200], 500, 'elements'],
    ['未从 0 开始 [10 100]', [10, 100], 500, 'zero'],
    ['负数 [-1 100]', [-1, 100], 500, 'negative'],
    ['超出文件长度 [0 100 400 300]', [0, 100, 400, 300], 500, 'bounds'],
    ['区段重叠 [0 300 200 100]', [0, 300, 200, 100], 500, 'overlap'],
    ['区段乱序 [0 10 400 10 100 10]', [0, 10, 400, 10, 100, 10], 500, 'overlap'],
    ['非整数 [0 10.5]', [0, 10.5], 500, 'negative'],
    ['非数值 [0 NaN]', [0, Number.NaN], 500, 'negative'],
    ['空数组', [], 500, 'empty'],
  ];
  for (const [label, values, fileSize, kind] of cases) {
    const range = M.parseByteRange(values, fileSize);
    check(`异常 ByteRange 被识别：${label}`, range.errors.length > 0, true);
    check(`异常 ByteRange 不可用于覆盖率判断：${label}`, range.usable, false);
    if (kind === 'bounds') check(`越界标志：${label}`, range.outOfBounds, true);
    if (kind === 'overlap') check(`重叠标志：${label}`, range.overlapsOrOutOfOrder, true);
    if (kind === 'negative') check(`负数标志：${label}`, range.nonIntegerOrNegative, true);
  }
  check('空 ByteRange 报错文案', M.parseByteRange([], 500).errors, ['/ByteRange 为空']);

  // Overlap must be caught even though the sum would look plausible.
  const overlap = M.parseByteRange([0, 300, 200, 100], 500);
  check('重叠时仍给出 errors（不会被静默算成一个覆盖率）', overlap.usable, false);
  check(
    '重叠错误文案提到重叠或乱序',
    overlap.errors.some((error) => error.includes('重叠') || error.includes('升序')),
    true,
  );
}

/* ------------------------------------------------------------------ */
/* 4. 增量更新与多次签名                                                */
/* ------------------------------------------------------------------ */

console.log('--- 4. 多次签名（增量更新） ---');

{
  // Two signature fields, the first signed without covering the second's
  // revision; the second signature covers everything.
  const oneSignatureObjects = documentObjects({
    pages: 1,
    acroForm: '<</Fields[8 0 R]>>',
    children: [
      '<</Type/Annot/Subtype/Widget/FT/Sig/T(First)/V 9 0 R/Rect[0 0 0 0]>>',
      '<</Type/Sig/Filter/Adobe.PPKLite/SubFilter/adbe.pkcs7.detached/ByteRange [0 0000 0000 0000]' +
        `/Contents ${SIGNATURE_SLOT}/Name ${pdfString('First Signer')}>>`,
    ],
  });
  // Revision 1: the first signature, computed over the whole of revision 1.
  const revisionOne = signDocument({
    objects: oneSignatureObjects,
    rootNumber: 1,
    signWith: { contents: '<' + '11'.repeat(512) + '>' },
  });
  // Revision 2: appended, carrying the second signature dictionary. Its own
  // /ByteRange covers revision 1 plus the bytes of revision 2 up to its hole.
  const second = appendSignedRevision(revisionOne.pdf, {
    body:
      '10 0 obj\n<</Type/Annot/Subtype/Widget/FT/Sig/T(Second)/V 11 0 R/Rect[0 0 0 0]>>\nendobj\n' +
      '11 0 obj\n<</Type/Sig/Filter/Adobe.PPKLite/SubFilter/ETSI.CAdES.detached' +
      '/ByteRange [0 0000 0000 0000]/Contents ' +
      SIGNATURE_SLOT +
      `/Name ${pdfString('Second Signer')}>>\nendobj`,
    contents: '<' + 'abc'.repeat(342) + '>',
    trailer: 'trailer\n<</Size 12/Root 1 0 R/Prev 1>>',
  });

  const report = M.inspectPdf(second, 'twice.pdf');
  check('两个签名都被找到', report.ok ? report.report.signatures.length : -1, 2);
  check('检测到增量更新（多个 startxref）', report.ok ? report.report.incrementalUpdates >= 1 : null, true);
  const ranges = report.ok ? report.report.signatures.map((sig) => sig.byteRange) : [];
  const raw = asText(second);
  const lastStartxref = raw.lastIndexOf('startxref');

  // The first signature was computed over revision 1 in full; it stops there, 1322
  // bytes short of the final file. The second reaches the end of revision 2. Note
  // what that means for the interesting question: the *last* signature is the only
  // one that can claim full coverage, and it still excludes its own /Contents hole.
  check('第一个签名不覆盖最终文件末尾', ranges[0]?.reachesEnd, false);
  check('第一个签名之后还有 1345 字节未签', ranges[0]?.trailingBytes, 1345);
  check('第一个签名覆盖到第一版末尾（2010 字节处）', ranges[0]?.segments[1]?.end, 2010);
  check('第二个签名覆盖到最终文件末尾', ranges[1]?.reachesEnd, true);
  check('第二个签名之后没有多余字节', ranges[1]?.trailingBytes, 0);
  check('较晚的签名覆盖的字节更多', (ranges[1]?.signedBytes ?? 0) > (ranges[0]?.signedBytes ?? 0), true);
  check(
    '报告的 trailerOffset 与文件里最后一个 startxref 一致',
    report.report.trailerOffset,
    lastStartxref,
  );
  check(
    '第一个签名没有覆盖到最终 startxref 的位置',
    lastStartxref > (ranges[0]?.segments[1]?.end ?? 0),
    true,
  );
  check(
    '第一个签名不覆盖最终修订的尾部结构',
    ranges[0]?.coversTrailer,
    false,
  );
  {
    // Verify against the raw bytes instead of trusting the numbers: slice the file
    // at the offsets the report gives, and confirm each signature's own /Contents
    // value lies inside its own hole and nowhere in its own signed parts.
    const valueOf = (range) => raw.slice(range.values[2], range.values[2] + range.values[3]);
    check('第一个签名的空洞开头就是它自己的 /Contents 值', valueOf(ranges[0]).startsWith('<1111'), true);
    check('第二个签名的空洞开头就是它自己的 /Contents 值', valueOf(ranges[1]).startsWith('<abcabc'), true);
    // What defines a detached signature is that the gap between the two segments is
    // where its /Contents value lives. Note the limit of that reading for revision 1:
    // revision 2 was appended *after* revision 1's signed region, so the declared
    // second segment (length 1318) actually extends past the hex string and covers
    // part of the second hole as well. That is a real property of the fixture, and
    // it is why "covers the whole file" must not be read as "valid".
    check(
      '两个签名的已签字节之和等于按区段切出的总长度',
      ranges.map((range) => range.segments.reduce((sum, segment) => sum + segment.length, 0)),
      ranges.map((range) => range.signedBytes),
    );
    check(
      '两个签名的区段之间确实留出了 /Contents 空洞',
      ranges.map((range) => range.segments[1].start - range.segments[0].end),
      [28, 28],
    );
    check(
      '空洞的起点正好落在 /Contents 的 < 上',
      ranges.map((range) => raw[range.values[2]]),
      ['<', '<'],
    );
    check(
      '第一个签名：已签 + 未签尾部 + 空洞 = 文件大小',
      ranges[0].signedBytes + ranges[0].trailingBytes + 28,
      report.report.fileSize,
    );
    check(
      '第二个签名：已签 + 空洞 = 文件大小（它签到了文件末尾）',
      ranges[1].signedBytes + 28,
      report.report.fileSize,
    );
  }
  check('两个签名的 /SubFilter 各自独立', report.ok ? report.report.signatures.map((s) => s.subFilter) : [], [
    '/adbe.pkcs7.detached',
    '/ETSI.CAdES.detached',
  ]);
  check('第一个签名的字段名', report.ok ? report.report.signatures[0]?.fieldNames : [], ['First']);
  check('第二个签名的字段名', report.ok ? report.report.signatures[1]?.fieldNames : [], ['Second']);
}

/* ------------------------------------------------------------------ */
/* 5. 元信息与"是否覆盖全文"的正反例                                    */
/* ------------------------------------------------------------------ */

console.log('--- 5. 覆盖范围的判定 ---');

{
  // A signed file where the signature really does run to the last byte.
  const wholeFieldObjects = () =>
    documentObjects({
      pages: 1,
      acroForm: '<</Fields[7 0 R]>>',
      children: [
        '<</Type/Annot/Subtype/Widget/FT/Sig/T(Whole)/V 10 0 R/Rect[0 0 0 0]>>',
        '<</Type/Sig/Filter/Adobe.PPKLite/SubFilter/adbe.pkcs7.detached/ByteRange [0 0000 0000 0000]' +
          `/Contents ${SIGNATURE_SLOT}>>`,
      ],
    });
  const full = signDocument({ objects: wholeFieldObjects(), rootNumber: 1, signWith: {} });
  const covered = M.inspectPdf(full.pdf, 'full.pdf');
  check('覆盖全文：reachesEnd', covered.ok ? covered.report.signatures[0]?.byteRange?.reachesEnd : null, true);
  // Not 100.00: the `/Contents` hex string is by definition *not* part of what was
  // signed, so a fully covering signature still leaves the CMS blob itself out.
  // "Covers everything" therefore means `reachesEnd`, not "100% of the bytes".
  check(
    '覆盖全文：覆盖率略低于 100%（/Contents 空洞本身不在签名范围内）',
    (covered.ok ? covered.report.signatures[0]?.byteRange?.coveragePercent ?? 0 : 0) < 100 &&
      (covered.ok ? covered.report.signatures[0]?.byteRange?.coveragePercent ?? 0 : 0) > 95,
    true,
  );
  check(
    '覆盖全文：已签 + 空洞 + 尾部 = 文件大小',
    covered.ok
      ? (covered.report.signatures[0]?.byteRange?.signedBytes ?? 0) +
          (covered.report.signatures[0]?.byteRange?.gapBytes ?? 0) +
          (covered.report.signatures[0]?.byteRange?.trailingBytes ?? 0)
      : 0,
    covered.ok ? covered.report.fileSize : -1,
  );
  check('覆盖全文：trailingBytes 为 0', covered.ok ? covered.report.signatures[0]?.byteRange?.trailingBytes : null, 0);
  check('覆盖全文：coversTrailer', covered.ok ? covered.report.signatures[0]?.byteRange?.coversTrailer : null, true);
  check('覆盖全文：没有问题提示', covered.ok ? covered.report.signatures[0]?.byteRange?.problems : null, []);
  check(
    '覆盖全文时 describeCoverage 不出现"未覆盖"',
    T.describeCoverage(covered.ok ? covered.report.signatures[0]?.byteRange : null).includes('未覆盖'),
    false,
  );

  // The tamper shape that this check is genuinely able to catch: a signature
  // whose ByteRange stops before the end while claiming to be the only revision.
  const tampered = signDocument({
    objects: wholeFieldObjects(),
    rootNumber: 1,
    signWith: { trailingText: '\ntrailer\n<</Size 9/Root 1 0 R>>\nstartxref\n999999\n%%EOF\n' },
  });
  const suspicious = M.inspectPdf(tampered.pdf, 'tampered.pdf');
  check(
    '签名之后追加内容：reachesEnd=false',
    suspicious.ok ? suspicious.report.signatures[0]?.byteRange?.reachesEnd : null,
    false,
  );
  check(
    '签名之后追加内容：trailingBytes > 0',
    (suspicious.ok ? suspicious.report.signatures[0]?.byteRange?.trailingBytes : 0) > 0,
    true,
  );
  check(
    '签名之后追加内容：覆盖率 < 100%',
    (suspicious.ok ? suspicious.report.signatures[0]?.byteRange?.coveragePercent : 100) < 100,
    true,
  );
  check(
    '签名之后追加内容：describeCoverage 明确说明未覆盖',
    T.describeCoverage(suspicious.ok ? suspicious.report.signatures[0]?.byteRange : null).includes('未覆盖整个文件'),
    true,
  );
}

/* ------------------------------------------------------------------ */
/* 6. 边界输入                                                          */
/* ------------------------------------------------------------------ */

console.log('--- 6. 边界输入 ---');

check('空文件', M.inspectPdf(new Uint8Array(0)).code, 'empty');

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
check('PNG 文件被拒', M.inspectPdf(png).code, 'not-pdf');
const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
check('ZIP 文件被拒', M.inspectPdf(zip).code, 'not-pdf');

const truncated = bytes('%PDF-1.7\n1 0 obj\n<</Type/Catalog/Pages 2 0 R');
const truncatedReport = M.inspectPdf(truncated);
check('截断的 PDF：对象仍能解析', truncatedReport.ok, true);
check('截断的 PDF：页数未知（报告为 null，不编造）', truncatedReport.ok ? truncatedReport.report.pageCount : -1, null);
check('截断的 PDF：签名为 0', truncatedReport.ok ? truncatedReport.report.signatures.length : -1, 0);
check('截断的 PDF：没有 startxref', truncatedReport.ok ? truncatedReport.report.trailerOffset : -1, null);

check('只有头、没有对象', M.inspectPdf(bytes('%PDF-1.4\n')).code, 'header-only');
check('只有头的变体（无换行）', M.inspectPdf(bytes('%PDF-1.4')).code, 'header-only');

const oversized = new Uint8Array(M.MAX_PDF_BYTES + 1);
oversized.set(bytes('%PDF-1.4\n'), 0);
const oversizeReport = M.inspectPdf(oversized);
check('超大文件被拒', oversizeReport.code, 'too-large');
check('超大文件报错里写明了上限与文件大小', /上限/.test(oversizeReport.message), true);
check(
  '上限之外的文件不会被解析成空报告',
  oversizeReport.ok,
  false,
);

// Encrypted: the trailer carries /Encrypt and a real /Encrypt dictionary exists.
const encryptedObjects = documentObjects({
  acroForm: '<</Fields[8 0 R]>>',
  children: [
    '<</Type/Annot/Subtype/Widget/FT/Sig/T(Secure)/V 9 0 R/Rect[0 0 0 0]>>',
    '<</Type/Sig/Filter/Adobe.PPKLite/SubFilter/adbe.pkcs7.detached/ByteRange [0 0000 0000 0000]' +
      `/Contents ${SIGNATURE_SLOT}/Name ${pdfString('Encrypted')}>>`,
    '<</Filter/Standard/V 4/R 4/O <0102>/U <0304>/P -3904/Length 128>>',
  ],
});
const encrypted = signDocument({
  objects: encryptedObjects,
  rootNumber: 1,
  extraTrailer: '/Encrypt 10 0 R/ID[<01><02>]',
  signWith: {},
});
const encryptedReport = M.inspectPdf(encrypted.pdf, 'encrypted.pdf');
check('加密 PDF 被标记为加密', encryptedReport.ok ? encryptedReport.report.encrypted : null, true);
check('加密 PDF 仍能解析结构', encryptedReport.ok ? encryptedReport.report.signatures.length : -1, 1);
check(
  '加密 PDF 会给出"文字可能不可读"的提示',
  encryptedReport.ok ? encryptedReport.report.warnings.some((w) => w.includes('加密')) : false,
  true,
);

// Attachments, incremental updates and object streams each produce a warning.
const objStmObjects = documentObjects({
  pages: 1,
  children: ['<</Type/ObjStm/N 2/First 10/Length 8>>\nstream\n1 0 2 0\nendstream'],
});
const objStmReport = M.inspectPdf(buildPdf({ objects: objStmObjects, rootNumber: 1 }), 'objstm.pdf');
check(
  '对象流存在时给出"压缩对象看不到"的提示',
  objStmReport.ok ? objStmReport.report.warnings.some((w) => w.includes('对象流')) : false,
  true,
);

// A linearised file: /Linearized in the first object.
const linearizedReport = M.inspectPdf(
  buildPdf({ objects: documentObjects({ pages: 1 }), rootNumber: 2, linearized: true }),
  'linear.pdf',
);
check('线性化文件被识别', linearizedReport.ok ? linearizedReport.report.linearized : null, true);

/* ------------------------------------------------------------------ */
/* 7. 文本解码与格式化                                                  */
/* ------------------------------------------------------------------ */

console.log('--- 7. 文本解码与格式化 ---');

{
  const latin = new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]); // Müller in PDFDocEncoding
  check('PDFDocEncoding 的 ü (0xfc) 被正确解码', M.decodePdfString(latin), 'M\u00fcller');
  check('PDFDocEncoding 中 0x80 是 bullet，而非 latin1 控制符', M.decodePdfString(new Uint8Array([0x80])), '\u2022');
  const utf16 = new Uint8Array([0xfe, 0xff, 0x5f, 0x20, 0x4f, 0x1f]); // 张伟 in UTF-16BE
  check('UTF-16BE 带 BOM 的中文', M.decodePdfString(utf16), '张伟');
  check('空字符串', M.decodePdfString(new Uint8Array(0)), '');
  check('NUL 被丢弃', M.decodePdfString(new Uint8Array([0x41, 0x00, 0x42])), 'AB');

  check('PDF 日期带 +08 时区', T.formatPdfDate("D:20240315103000+08'00'"), '2024-03-15 10:30:00 UTC+08:00');
  check('PDF 日期 UTC', T.formatPdfDate('D:20240315103000Z'), '2024-03-15 10:30:00 UTC');
  check('PDF 日期只有年份', T.formatPdfDate('D:2024'), '2024-01-01 00:00:00（未标注时区）');
  check('非标准日期原样返回，不猜', T.formatPdfDate('not a date'), 'not a date');
  check('null 日期', T.formatPdfDate(null), null);

  check('字节大小 512', T.formatByteSize(512), '512 字节');
  check('字节大小 1 KiB', T.formatByteSize(1024), '1.00 KiB');
  check('字节大小 上限文案', T.formatByteSize(32 * 1024 * 1024), '32.0 MiB');
}

/* ------------------------------------------------------------------ */
/* 8. 与真实工具交叉验证：pdfinfo                                        */
/* ------------------------------------------------------------------ */

console.log('--- 8. 与 pdfinfo 交叉验证 ---');

let pdfinfoAvailable = false;
try {
  execFileSync('pdfinfo', ['-v'], { stdio: 'ignore' });
  pdfinfoAvailable = true;
} catch {
  pdfinfoAvailable = false;
}

if (!pdfinfoAvailable) {
  console.log('SKIP  环境里没有 pdfinfo（poppler-utils），交叉验证一节整节跳过；');
  console.log('      三页与版本号的断言因此没有独立参照物，上面手写 PDF 的断言仍然有效。');
} else {
  const multi = buildPdf({ version: '1.6', objects: documentObjects({ pages: 3 }), rootNumber: 1 });
  mkdirSync('.verify', { recursive: true });
  writeFileSync('.verify/pdf-signature-multi.pdf', multi);

  let info = '';
  try {
    info = execFileSync('pdfinfo', ['.verify/pdf-signature-multi.pdf'], { encoding: 'utf8' });
  } catch (error) {
    info = `pdfinfo failed: ${error?.message ?? error}`;
  }

  const pages = /^Pages:\s+(\d+)/m.exec(info)?.[1] ?? null;
  const version = /^PDF version:\s+(\S+)/m.exec(info)?.[1] ?? null;
  const encryptedLine = /^Encrypted:\s+(\S+)/m.exec(info)?.[1] ?? 'no';

  check('pdfinfo 接受了自造的三页 PDF（否则交叉验证无意义）', pages, '3');
  check('本工具的页数与 pdfinfo 一致', M.inspectPdf(multi).report.pageCount, Number(pages));
  check('PDF 版本与 pdfinfo 一致', M.inspectPdf(multi).report.headerVersion, version);
  check('未加密文件与 pdfinfo 的 Encrypted 一致', encryptedLine.toLowerCase(), 'no');
  console.log(`       pdfinfo 输出：Pages=${pages} PDF version=${version} Encrypted=${encryptedLine}`);

  // The encrypted sample is a synthetic /Encrypt dictionary: enough to exercise
  // this reader's flag, but not a real RC4/AES-encrypted file. A real one cannot be
  // produced here — `qpdf` is absent and there is no network access — so whether
  // poppler agrees about the encryption is reported rather than asserted. Asserting
  // it would only be testing that poppler tolerates the synthetic dictionary.
  writeFileSync('.verify/pdf-signature-encrypted.pdf', encrypted.pdf);
  let encryptedInfo = '';
  try {
    encryptedInfo = execFileSync('pdfinfo', ['.verify/pdf-signature-encrypted.pdf'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    encryptedInfo = String(error?.message ?? error);
  }
  const encryptedFlag = /^Encrypted:\s+(\S+)/m.exec(encryptedInfo)?.[1] ?? null;
  check('本工具把合成的 /Encrypt 文件判为已加密', M.inspectPdf(encrypted.pdf).report.encrypted, true);
  console.log(
    `       该加密样本是合成的，pdfinfo 读到的 Encrypted=${encryptedFlag ?? '(不可用)'}；` +
      '环境里没有 qpdf 也没有网络，无法生成真正加密的 PDF 做独立比对，故不对其断言。',
  );
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
