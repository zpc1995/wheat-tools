/**
 * Verifies the Git cheat sheet.
 *
 * The claim worth defending is that the danger levels match reality. A
 * reference that shows `git reset --hard` and `git status` in the same neutral
 * tone is worse than no reference at all, so the classification is asserted
 * against the command's semantics in two ways:
 *
 *   1. an explicit list of commands whose behaviour is destructive must be
 *      `danger`, and an explicit list of read-only commands must be `safe`;
 *   2. a pattern rule over the whole table, so a future entry that adds
 *      `--hard`, `clean -f`, `--force`, `rebase` and so on cannot quietly ship
 *      with a soft level.
 *
 * Command semantics follow the official manual at https://git-scm.com/docs
 * (git-reset, git-clean, git-restore, git-rebase, git-push, git-reflog,
 * git-bisect, ...): `git-clean` removes untracked files from the working tree
 * and `-n` only shows what would be done; `git-restore` rebuilds the working
 * tree from the index and `--staged` moves the index instead; `git reset --hard`
 * resets index and working tree together.
 *
 * The other half is mechanical: every `<占位符>` must be declared, the search
 * must actually reach the command name and the Chinese description, and nothing
 * in the tool may spawn a process — this is a reference, not a runner.
 *
 * Usage: node scripts/check-git-cheatsheet.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const DATA_PATH = 'src/tools/git-cheatsheet/gitCheatsheetData.ts';
const COMPONENT_PATH = 'src/tools/git-cheatsheet/GitCheatsheetTool.tsx';

const dataSource = readFileSync(DATA_PATH, 'utf8');
const compiled = ts.transpileModule(dataSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/git-cheatsheet.mjs', compiled);
const M = await import(pathToFileURL('.verify/git-cheatsheet.mjs').href);

let passed = 0;
let failed = 0;
const failures = [];

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else {
    failed += 1;
    failures.push(label);
  }
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`),
  );
}

function checkTrue(label, condition) {
  check(label, condition, true);
}

const all = M.flattenCommands();
const commands = all.map(({ entry }) => entry.command);

console.log('--- 数据完整性 ---');
{
  check('分组数量为 7（按场景划分）', M.GIT_GROUPS.length, 7);
  check('分组 id 唯一', new Set(M.GIT_GROUPS.map((g) => g.id)).size, M.GIT_GROUPS.length);
  check('分组标题唯一', new Set(M.GIT_GROUPS.map((g) => g.title)).size, M.GIT_GROUPS.length);
  checkTrue(`条目总数足够多（当前 ${all.length} 条）`, all.length >= 55);
  check('每组至少有 6 条', M.GIT_GROUPS.filter((g) => g.entries.length < 6).map((g) => g.id), []);

  const duplicates = commands.filter((command, index) => commands.indexOf(command) !== index);
  check('命令没有重复条目', duplicates, []);

  check('每条命令都以 git 开头', commands.filter((command) => !command.startsWith('git ')), []);
  check(
    '每条都有非空的说明',
    all.filter(({ entry }) => typeof entry.summary !== 'string' || entry.summary.trim() === '').map(({ entry }) => entry.command),
    [],
  );
  check(
    '每条都有非空的使用场景',
    all.filter(({ entry }) => typeof entry.scenario !== 'string' || entry.scenario.trim() === '').map(({ entry }) => entry.command),
    [],
  );
  check(
    '危险等级取值合法',
    all.filter(({ entry }) => !['safe', 'caution', 'danger'].includes(entry.danger)).map(({ entry }) => entry.command),
    [],
  );
  checkTrue('三个等级都有元信息', ['safe', 'caution', 'danger'].every((level) => Boolean(M.DANGER_META[level]?.label && M.DANGER_META[level]?.detail)));
}

console.log('--- 危险性分级必须与命令语义一致 ---');
{
  const byCommand = new Map(all.map(({ entry }) => [entry.command, entry]));

  const expectLevel = (command, level) => {
    const entry = byCommand.get(command);
    check(`「${command}」应为${M.DANGER_META[level].label}`, entry ? entry.danger : '命令不存在', level);
  };

  // Commands that throw work away. Per the manual: reset --hard resets index
  // and working tree, clean removes untracked files, restore/checkout rebuild
  // the working tree from the index, rebase rewrites commits, --force replaces
  // the remote history.
  expectLevel('git reset --hard <提交>', 'danger');
  expectLevel('git clean -fd', 'danger');
  expectLevel('git checkout .', 'danger');
  expectLevel('git checkout -- <文件>', 'danger');
  expectLevel('git restore <文件>', 'danger');
  expectLevel('git restore .', 'danger');
  expectLevel('git rebase <分支名>', 'danger');
  expectLevel('git branch -D <分支名>', 'danger');
  expectLevel('git push --force', 'danger');
  expectLevel('git push --force-with-lease', 'danger');
  expectLevel('git stash drop', 'danger');
  expectLevel('git stash clear', 'danger');

  // Read-only inspection must never be dressed up as risky, or the levels stop
  // meaning anything.
  expectLevel('git status', 'safe');
  expectLevel('git log', 'safe');
  expectLevel('git diff', 'safe');
  expectLevel('git show <提交>', 'safe');
  expectLevel('git blame <文件>', 'safe');
  expectLevel('git reflog', 'safe');
  expectLevel('git clean -n', 'safe');
  expectLevel('git fetch <远程名>', 'safe');

  // Undoing published history by adding a commit is not destructive; the
  // inverse is the whole reason revert exists.
  expectLevel('git revert <提交>', 'safe');
  // Unstaging keeps the working tree, so it is not in the same class as
  // discarding it.
  expectLevel('git restore --staged <文件>', 'caution');

  // Rule 1: anything destructive by pattern must be danger.
  const DESTRUCTIVE_PATTERNS = [
    ['--hard', /--hard\b/],
    ['clean 带 -f', /\bclean\b[^\n]*-[a-z]*f/],
    ['push --force', /\bpush\b[^\n]*--force/],
    ['checkout . 或 checkout -- <文件>', /\bcheckout\s+(\.|--\s)/],
    ['restore 覆盖工作区', /\brestore\s+(?!--staged)/],
    ['rebase 改写历史', /\brebase\b/],
    ['branch -D 强制删除', /\bbranch\s+-[a-zA-Z]*D/],
    ['stash drop 或 clear', /\bstash\s+(drop|clear)/],
  ];
  const levelViolations = [];
  for (const { entry } of all) {
    for (const [name, pattern] of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(entry.command) && entry.danger !== 'danger') {
        levelViolations.push(`${entry.command}（命中「${name}」却是 ${entry.danger}）`);
      }
    }
  }
  check('按语义规则：所有会丢数据或改写历史的命令都标为危险', levelViolations, []);

  // Rule 2: read-only verbs must be safe.
  const READ_ONLY_PREFIXES = [
    /^git status\b/,
    /^git log\b/,
    /^git diff\b/,
    /^git show\b/,
    /^git blame\b/,
    /^git reflog\b/,
    /^git shortlog\b/,
    /^git describe\b/,
    /^git grep\b/,
    /^git remote -v$/,
    /^git branch$/,
    /^git branch -a$/,
    /^git stash list$/,
  ];
  const safeViolations = all
    .filter(({ entry }) => READ_ONLY_PREFIXES.some((pattern) => pattern.test(entry.command)))
    .filter(({ entry }) => entry.danger !== 'safe')
    .map(({ entry }) => `${entry.command} 是只读命令却标为 ${entry.danger}`);
  check('按语义规则：所有只读命令都标为安全', safeViolations, []);

  // A dangerous verdict without a way out is just noise.
  const dangerEntries = all.filter(({ entry }) => entry.danger === 'danger');
  checkTrue(`危险条目数量合理（当前 ${dangerEntries.length} 条）`, dangerEntries.length >= 10);
  check(
    '每条危险命令都写明了补救办法',
    dangerEntries.filter(({ entry }) => !entry.recovery || entry.recovery.trim() === '').map(({ entry }) => entry.command),
    [],
  );
  check(
    '危险条目的补救说明给出具体手段（reflog、fsck、备份，或明确说明无法恢复）',
    dangerEntries
      .filter(({ entry }) => !/reflog|fsck|备份|无法|不能|没有|不存在|未进入对象库/.test(entry.recovery ?? ''))
      .map(({ entry }) => entry.command),
    [],
  );
  checkTrue(
    '至少有三条危险命令点名 reflog',
    dangerEntries.filter(({ entry }) => /reflog/.test(entry.recovery ?? '')).length >= 3,
  );
  checkTrue(
    '至少一条危险命令诚实说明无法恢复',
    dangerEntries.some(({ entry }) => /无法|不能|没有|不存在/.test(entry.recovery ?? '')),
  );
  const safeEntries = all.filter(({ entry }) => entry.danger === 'safe');
  checkTrue(`安全条目数量合理（当前 ${safeEntries.length} 条）`, safeEntries.length >= 10);

  // The classification has to be presented too, not just stored.
  const componentSource = readFileSync(COMPONENT_PATH, 'utf8');
  checkTrue('界面展示了分级规则', /危险性分级/.test(componentSource));
  checkTrue('界面展示了每条命令的补救说明', /recovery/.test(componentSource));
}

console.log('--- 占位符约定 ---');
{
  const declared = new Set(M.PLACEHOLDERS.map((item) => item.token));
  checkTrue('占位符数量合理', M.PLACEHOLDERS.length >= 8);
  checkTrue('占位符含义都非空', M.PLACEHOLDERS.every((item) => item.meaning.trim() !== ''));
  check('占位符本身不重复', new Set(M.PLACEHOLDERS.map((item) => item.token)).size, M.PLACEHOLDERS.length);

  const used = new Map();
  for (const { entry } of all) {
    for (const token of M.placeholdersIn(`${entry.command} ${entry.recovery ?? ''}`)) {
      used.set(token, (used.get(token) ?? 0) + 1);
    }
  }

  check(
    '所有用到的占位符都已声明',
    [...used.keys()].filter((token) => !declared.has(token)).sort(),
    [],
  );
  check(
    '声明的占位符都真的被用到',
    M.PLACEHOLDERS.map((item) => item.token).filter((token) => !used.has(token)),
    [],
  );
  checkTrue(
    '占位符命名统一为中文小写尖括号（没有 <BRANCH> 这类写法）',
    [...used.keys()].every((token) => /^<[\u4e00-\u9fa5]+>$/.test(token)),
  );
  checkTrue('确实有多条命令用到 <分支名>', (used.get('<分支名>') ?? 0) >= 5);
  checkTrue('确实有多条命令用到 <提交>', (used.get('<提交>') ?? 0) >= 5);
}

console.log('--- 搜索 ---');
{
  check('空查询返回全部条目', M.searchCommands('').length, all.length);
  check('全量结果与条目总数一致', M.searchCommands('   ').length, all.length);
  checkTrue('结果都带有所属分组', M.searchCommands('').every((hit) => Boolean(hit.group?.title)));

  const hasCommand = (query, command) => M.searchCommands(query).some((hit) => hit.entry.command === command);

  checkTrue('按命令名搜索：reset', hasCommand('reset', 'git reset --hard <提交>'));
  checkTrue('按命令名搜索：bisect', hasCommand('bisect', 'git bisect start'));
  checkTrue('按命令名搜索：reflog', hasCommand('reflog', 'git reflog'));
  checkTrue('按命令名搜索：stash', hasCommand('stash', 'git stash list'));
  checkTrue('按中文说明搜索：撤销', M.searchCommands('撤销').length >= 3);
  checkTrue('按中文说明搜索：暂存', M.searchCommands('暂存').length >= 4);
  checkTrue('按中文说明搜索：分支', M.searchCommands('分支').length >= 8);
  checkTrue('按场景搜索：冲突（该词只出现在场景与补救说明里）', M.searchCommands('冲突').length >= 3);
  checkTrue(
    '场景搜索命中的条目的命令本身不含该词',
    M.searchCommands('冲突').every((hit) => !hit.entry.command.includes('冲突')),
  );
  checkTrue('按分组名搜索：排查问题', M.searchCommands('排查').length >= 3);
  checkTrue('按危险等级标签搜索：危险', M.searchCommands('危险').length >= 5);

  check('搜索大小写不敏感', M.searchCommands('RESET').length, M.searchCommands('reset').length);
  check('无匹配时返回空数组', M.searchCommands('zzz-绝对不存在的词-zzz').length, 0);

  const single = M.searchCommands('撤销').length;
  const andQuery = M.searchCommands('撤销 提交').length;
  checkTrue('多词查询是 AND，结果更窄且非空', andQuery > 0 && andQuery <= single);
  checkTrue('AND 查询确实比单词查询更窄', andQuery < single);
}

console.log('--- 明确不做：不执行任何 git 命令 ---');
{
  const componentSource = readFileSync(COMPONENT_PATH, 'utf8');
  const forbiddenInData = [
    ['data 不引用 child_process', /child_process/],
    ['data 不使用 exec', /\bexec\s*\(/],
    ['data 不使用 spawn', /\bspawn\s*\(/],
    ['data 不使用 require', /\brequire\s*\(/],
    ['data 不使用 eval', /\beval\s*\(/],
  ];
  for (const [label, pattern] of forbiddenInData) {
    check(label, pattern.test(dataSource), false);
  }
  const forbiddenInComponent = [
    ['组件不引用 child_process', /child_process/],
    ['组件不使用 exec', /\bexec\s*\(/],
    ['组件不使用 spawn', /\bspawn\s*\(/],
    ['组件不调用 fetch', /fetch\s*\(/],
  ];
  for (const [label, pattern] of forbiddenInComponent) {
    check(label, pattern.test(componentSource), false);
  }
  checkTrue('组件确实渲染了命令文本', /entry\.command/.test(componentSource));
  checkTrue('组件确实渲染了使用场景', /entry\.scenario/.test(componentSource));
  checkTrue('组件确实渲染了危险性分级', /DANGER_META/.test(componentSource));
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
if (failures.length) console.log('失败项：\n  ' + failures.join('\n  '));
process.exit(failed === 0 ? 0 : 1);
