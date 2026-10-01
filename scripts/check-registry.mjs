/**
 * Verifies that every tool directory is actually registered.
 *
 * The registry discovers tools by globbing for `./<dir>/index.ts`, so a tool
 * directory without that file is silently invisible in the app — it compiles,
 * type-checks and even passes a per-tool smoke test (which only visits tools
 * that *are* registered), yet users can never open it. That happened once with
 * `text-toolkit`, hence this check.
 *
 * Usage: node scripts/check-registry.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const TOOLS_DIR = 'src/tools';

const entries = readdirSync(TOOLS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

let problems = 0;

const registered = [];

for (const name of entries) {
  const dir = `${TOOLS_DIR}/${name}`;
  const index = `${dir}/index.ts`;

  if (!existsSync(index)) {
    problems += 1;
    console.log(`FAIL  ${name}  缺少 index.ts，该工具不会被注册`);
    continue;
  }

  const source = readFileSync(index, 'utf8');

  // `manifest.id` must equal the directory name: the sidebar and the usage
  // statistics key off the id, so a mismatch would scatter the data.
  const idMatch = /id:\s*'([^']+)'/.exec(source);
  if (!idMatch) {
    problems += 1;
    console.log(`FAIL  ${name}  index.ts 中找不到 manifest.id`);
    continue;
  }
  if (idMatch[1] !== name) {
    problems += 1;
    console.log(
      `FAIL  ${name}  manifest.id 为 "${idMatch[1]}"，必须与目录名一致`,
    );
    continue;
  }

  if (!/category:\s*'[a-z]+'/.test(source)) {
    problems += 1;
    console.log(`FAIL  ${name}  manifest 缺少 category`);
    continue;
  }

  if (!/export default/.test(source)) {
    problems += 1;
    console.log(`FAIL  ${name}  index.ts 没有默认导出组件`);
    continue;
  }

  registered.push(idMatch[1]);
}

// Every id must be unique, or routes would collide.
const duplicates = registered.filter(
  (id, index) => registered.indexOf(id) !== index,
);
if (duplicates.length > 0) {
  problems += 1;
  console.log(`FAIL  重复的工具 id：${[...new Set(duplicates)].join(', ')}`);
}

console.log(
  problems === 0
    ? `PASS  ${entries.length} 个工具目录全部正确注册（id 唯一、含分类与默认导出）`
    : `\n共 ${problems} 处问题`,
);
process.exit(problems === 0 ? 0 : 1);
