/**
 * Checks the SQL formatter.
 *
 * The claim worth defending is narrow but strong: **formatting must not change
 * what the SQL means**. "Looks right to me" is not evidence, so the oracle is
 * CPython's own `sqlite3` module. Every query is executed twice against a fresh
 * in-memory database — once as written, once after formatting — and the result
 * rows must be identical (or both must fail). The statements are split on the
 * Python side with `sqlite3.complete_statement`, so the splitter is not the
 * formatter's own tokenizer.
 *
 * Three further oracles back it up:
 *
 *   1. Literal preservation — every string, quoted identifier and comment is
 *      pulled out before and after formatting and compared byte for byte.
 *   2. Token-sequence preservation — the token stream, normalised for the
 *      documented case-folding, must be identical.
 *   3. A deliberately naive regex-based uppercase pass is run on the same
 *      input and fed to sqlite3 too. It *does* change the result, which proves
 *      these checks can fail: they are not merely passing.
 *
 * If `python3` is missing the sqlite3 assertions are skipped loudly rather than
 * silently passing.
 *
 * Usage: node scripts/check-sql-formatter.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const compiled = ts.transpileModule(
  readFileSync('src/tools/sql-formatter/sqlFormatterUtils.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;
mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/sql-formatter.mjs', compiled);
const M = await import(pathToFileURL('.verify/sql-formatter.mjs').href);

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`),
  );
}
const checkTrue = (label, value) => check(label, Boolean(value), true);

/* ------------------------------------------------------------------ */
/* sqlite3 参照物                                                       */
/* ------------------------------------------------------------------ */

const ORACLE = `
import json, sqlite3, sys

payload = json.load(sys.stdin)
setup = payload["setup"]

def split(sql):
    """Split with the stdlib's own statement scanner, not the formatter's."""
    parts, buf = [], ""
    for ch in sql:
        buf += ch
        if ch == ";" and sqlite3.complete_statement(buf):
            parts.append(buf)
            buf = ""
    if buf.strip():
        parts.append(buf)
    return parts

results = {}
for case in payload["cases"]:
    cid, sql = case["id"], case["sql"]
    con = sqlite3.connect(":memory:")
    try:
        cur = con.cursor()
        for stmt in setup:
            cur.execute(stmt)
        rows = []
        for stmt in split(sql):
            cur.execute(stmt)
            if cur.description is not None:
                rows.append([list(r) for r in cur.fetchall()])
        results[cid] = {"ok": True, "rows": rows}
    except Exception as exc:
        results[cid] = {"ok": False, "kind": type(exc).__name__, "error": str(exc)}
    finally:
        con.close()

sys.stdout.write(json.dumps({"version": sqlite3.sqlite_version, "results": results}, ensure_ascii=False, default=str))
`;

writeFileSync('.verify/sf-oracle.py', ORACLE);

const probe = spawnSync('python3', ['-c', 'import sqlite3;print(sqlite3.sqlite_version)'], {
  encoding: 'utf8',
});
const HAS_SQLITE = probe.status === 0 && probe.stdout.trim() !== '';
let sqliteVersion = '';
if (!HAS_SQLITE) {
  console.log('SKIP  python3 不可用，跳过全部 sqlite3 语义参照断言（下面用别的断言兜底）\n');
} else {
  sqliteVersion = probe.stdout.trim();
  console.log(`--- sqlite3 参照（SQLite ${sqliteVersion}，CPython sqlite3）---`);
}

const SETUP = [
  'CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, created_at TEXT, note TEXT)',
  'CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, total REAL, status TEXT)',
  'CREATE TABLE "order" ("select" INTEGER, "from" TEXT, [where] TEXT)',
  "INSERT INTO customers VALUES (1,'Alice','2024-01-01','from where select'), (2,'Bob','2024-02-15','ok'), (3,'Carol','2024-03-20','ok')",
  "INSERT INTO orders VALUES (1,1,100.5,'paid'),(2,1,50.0,'cancelled'),(3,2,200.0,'paid'),(4,2,25.0,'paid'),(5,3,10.0,'pending')",
  "INSERT INTO \"order\" VALUES (1,'a','b')",
];

/** Run every variant through sqlite3 in one process. */
function runOracle(cases) {
  const out = spawnSync('python3', ['.verify/sf-oracle.py'], {
    input: JSON.stringify({ setup: SETUP, cases }),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (out.status !== 0) {
    throw new Error(`oracle failed: ${out.stderr || out.stdout}`);
  }
  return JSON.parse(out.stdout).results;
}

/* ------------------------------------------------------------------ */
/* 语料                                                                */
/* ------------------------------------------------------------------ */

const QUERIES = [
  {
    label: '简单查询',
    sql: 'select id, name from customers where id = 1',
  },
  {
    label: '聚合 + JOIN + GROUP BY + HAVING + ORDER BY + LIMIT',
    sql:
      "select c.id, c.name, count(o.id) as orders, coalesce(sum(o.total), 0) as amount " +
      "from customers c left join orders o on o.customer_id = c.id and o.status = 'paid' " +
      "where c.created_at >= '2024-01-01' group by c.id, c.name having count(o.id) > 0 " +
      'order by amount desc, c.name asc limit 10',
  },
  {
    label: '字符串字面量里的关键字与转义单引号',
    sql: "SELECT 'from where select' AS note, id FROM customers WHERE name = 'it''s Alice'",
  },
  {
    label: '双引号 / 反引号 / 方括号标识符',
    sql: 'SELECT "select", `from`, [where] FROM "order"',
  },
  {
    label: '行注释与块注释（注释里的关键字）',
    sql: 'SELECT /* from where select */ id\n-- join on group by order by\nFROM customers WHERE id = 1',
  },
  {
    label: 'FROM 里的子查询',
    sql: 'select t.name from (select name from customers where id > 1) t order by t.name',
  },
  {
    label: 'WHERE 里的 IN 子查询',
    sql: 'select name from customers where id in (select customer_id from orders where total > 30) order by name',
  },
  {
    label: 'CTE（WITH ... AS）',
    sql:
      "with paid as (select customer_id, sum(total) as amount from orders where status = 'paid' group by customer_id) " +
      'select c.name, p.amount from customers c join paid p on p.customer_id = c.id order by p.amount desc, c.name',
  },
  {
    label: 'UNION ALL',
    sql: 'select name from customers where id = 1 union all select name from customers where id = 2',
  },
  {
    label: 'IN 列表与 BETWEEN',
    sql: 'select id from orders where customer_id in (1, 2, 3) and total between 10 and 200 order by id',
  },
  {
    label: 'CASE WHEN',
    sql:
      "select id, case when total > 100 then 'big' when total > 20 then 'mid' else 'small' end as bucket " +
      'from orders order by id',
  },
  {
    label: '窗口函数 OVER (PARTITION BY ... ORDER BY ...)',
    sql: 'select id, row_number() over (partition by customer_id order by total desc) as rn from orders order by id',
  },
  {
    label: '比较与逻辑运算符',
    sql: "select id from orders where total >= 25 and total <> 50 or status like 'p%' order by id",
  },
  {
    label: 'DISTINCT + 表别名 + 列别名',
    sql: 'select distinct c.id as cid, c.name as cname from customers c where c.id is not null order by c.id',
  },
  {
    label: '多语句（INSERT 后接 SELECT）',
    sql: "INSERT INTO customers (id, name) VALUES (99, 'Zoe'); SELECT name FROM customers WHERE id = 99;",
  },
  {
    label: '多语句（UPDATE 后接 SELECT）',
    sql: "UPDATE customers SET note = 'updated' WHERE id = 2; SELECT note FROM customers WHERE id = 2;",
  },
  {
    label: '多语句（DELETE 后接 COUNT）',
    sql: "DELETE FROM orders WHERE status = 'pending'; SELECT count(*) FROM orders;",
  },
  {
    label: 'DDL：CREATE TABLE 列定义列表',
    sql: "CREATE TABLE tmp_items (a INTEGER, b TEXT, c REAL); INSERT INTO tmp_items VALUES (1, 'x', 2.5); SELECT * FROM tmp_items;",
  },
  {
    label: 'Unicode 字面量（中文 + emoji + 关键字）',
    sql: "select '中文 😀 from where select' as label union all select name from customers where id = 1",
  },
  {
    label: '带分号与关键字的字符串字面量',
    sql: "select 'a;b select from where' as s, 1 as one",
  },
  {
    label: 'EXCEPT / INTERSECT',
    sql:
      'select id from orders where total > 20 except select id from orders where status = \'cancelled\' order by id',
  },
  {
    label: '数值字面量（小数、指数、十六进制）',
    sql: 'select 1.5 as a, 1e3 as b, 0x1F as c, -2 as d',
  },
];

/** 四种排版变体，都要与原文语义一致。 */
const VARIANTS = [
  { label: '美化', make: (sql) => M.formatSql(sql) },
  { label: '美化（缩进 4、逗号在前）', make: (sql) => M.formatSql(sql, { indent: 4, comma: 'leading' }) },
  { label: '美化（缩进 8）', make: (sql) => M.formatSql(sql, { indent: 8 }) },
  // 压缩默认丢弃注释（注释掉的代码不该被塞回一行），这是文档化的行为，
  // 因此比对字面量时把注释排除在外。
  { label: '压缩成单行', make: (sql) => M.compactSql(sql, false), dropsComments: true },
];

/** 逐字节取出字符串 / 引用标识符 / 注释原文。 */
function literalsOf(sql, { keepComments = true } = {}) {
  const scanned = M.tokenize(sql);
  if (!scanned.ok) return [{ error: scanned.error.message }];
  const all = M.collectLiterals(scanned.tokens);
  return keepComments ? all : all.filter((item) => item.kind !== 'comment');
}

/** token 序列，只按文档说明的"关键字大写"归一化；注释另算。 */
function normalisedTokens(sql) {
  const scanned = M.tokenize(sql);
  if (!scanned.ok) return null;
  return scanned.tokens
    .filter((token) => token.kind !== 'comment')
    .map((token) => (token.kind === 'string' ? token.text : token.text.toUpperCase()));
}

console.log('\n--- 1. 排版语义不变（sqlite3 执行结果比对）---');
if (HAS_SQLITE) {
  const cases = [];
  for (const [qi, query] of QUERIES.entries()) {
    cases.push({ id: `q${qi}:raw`, sql: query.sql });
    for (const [vi, variant] of VARIANTS.entries()) {
      const r = variant.make(query.sql);
      if (!r.ok) {
        cases.push({ id: `q${qi}:v${vi}`, sql: `/* 格式化失败: ${r.error.message} */ SELECT 1` });
      } else {
        cases.push({ id: `q${qi}:v${vi}`, sql: r.sql });
      }
    }
  }
  const results = runOracle(cases);

  let semanticMismatch = 0;
  let formatFailures = 0;
  let executedOk = 0;
  for (const [qi, query] of QUERIES.entries()) {
    const base = results[`q${qi}:raw`];
    for (const [vi, variant] of VARIANTS.entries()) {
      const r = variant.make(query.sql);
      if (!r.ok) {
        formatFailures += 1;
        console.log(`FAIL  [${query.label}] ${variant.label} 格式化失败：${r.error.message}`);
        continue;
      }
      const got = results[`q${qi}:v${vi}`];
      // 允许"两者同样报错"：只要求 ok 标志一致；都成功时行必须逐行相同。
      const same = got.ok === base.ok && (!base.ok || JSON.stringify(got.rows) === JSON.stringify(base.rows));
      if (same) executedOk += 1;
      else {
        semanticMismatch += 1;
        console.log(
          `FAIL  [${query.label}] ${variant.label} 语义变了\n        原文 ${base.ok ? JSON.stringify(base.rows) : `错误 ${base.error}`}` +
            `\n        排版 ${got.ok ? JSON.stringify(got.rows) : `错误 ${got.error}`}`,
        );
      }
    }
  }
  check(
    `${QUERIES.length} 条查询 × ${VARIANTS.length} 种排版 = ${QUERIES.length * VARIANTS.length} 次 sqlite3 执行结果与原文一致`,
    { semanticMismatch, formatFailures },
    { semanticMismatch: 0, formatFailures: 0 },
  );
  check('参照物确实执行了查询（不是空转）', executedOk, QUERIES.length * VARIANTS.length);

  // 断言参照物对"确实不同"的输入会报出差异，证明比对逻辑不是恒真。
  const control = runOracle([
    { id: 'a', sql: 'select count(*) from orders' },
    { id: 'b', sql: "select count(*) from orders where status = 'paid'" },
  ]);
  checkTrue(
    '对照：不同的查询在参照物里得到不同结果（证明比对有分辨力）',
    JSON.stringify(control.a.rows) !== JSON.stringify(control.b.rows),
  );

  // 错误输入：原文与排版后必须同样报错。
  const badPairs = [
    { label: '未知表', sql: 'select * from nope' },
    { label: '未知列', sql: 'select missing_column from customers' },
  ];
  const badCases = [];
  for (const [bi, bad] of badPairs.entries()) {
    badCases.push({ id: `b${bi}:raw`, sql: bad.sql });
    badCases.push({ id: `b${bi}:fmt`, sql: M.formatSql(bad.sql).sql });
  }
  const badResults = runOracle(badCases);
  const errorAgreement = badPairs.every(
    (_, bi) => badResults[`b${bi}:raw`].ok === false && badResults[`b${bi}:fmt`].ok === false,
  );
  checkTrue('非法 SQL 在原文与排版后同样报错（错误不会被排版掩盖）', errorAgreement);
}

console.log('\n--- 2. 字面量与注释逐字节不变 ---');
{
  const literals = [
    "SELECT 'from where select' AS note FROM t WHERE label = 'it''s fine'",
    'SELECT "select", `from`, [where] FROM "order"',
    'SELECT a /* from where */ FROM t; -- select and where here',
    "SELECT $$from where select$$ AS body, $tag$it's$tag$ AS other",
    "SELECT '中文 😀 select from where' AS x, 'a;b' AS y",
    "SELECT 'line1\nline2' AS multi",
  ];
  let mismatch = 0;
  for (const [li, sql] of literals.entries()) {
    for (const variant of VARIANTS) {
      const r = variant.make(sql);
      if (!r.ok) {
        console.log(`FAIL  变体 ${variant.label} 在语料 ${li} 上失败：${r.error.message}`);
        mismatch += 1;
        continue;
      }
      const before = literalsOf(sql, { keepComments: !variant.dropsComments });
      const after = literalsOf(r.sql, { keepComments: !variant.dropsComments });
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        mismatch += 1;
        console.log(
          `FAIL  语料 ${li} 变体 ${variant.label} 字面量被改写\n        前 ${JSON.stringify(before)}\n        后 ${JSON.stringify(after)}`,
        );
      }
    }
  }
  check(`6 段含字面量/注释的 SQL × ${VARIANTS.length} 种排版，全部逐字节不变`, mismatch, 0);

  // 具体到最危险的那一条：字符串里的关键字必须原样保留。
  const formatted = M.formatSql("SELECT 'from where select' AS note FROM t").sql;
  checkTrue("格式化后在原文里能原样找到 'from where select'", formatted.includes("'from where select'"));
  checkTrue('同一个字符串里的小写 from/where/select 没有被大写', !formatted.includes("'FROM WHERE SELECT'"));

  // 美元引用整段原样（含内部换行与引号）。
  const dollar = "SELECT $tag$It's\nfrom where$tag$ AS body";
  check(
    '美元引用整段原样保留',
    literalsOf(M.formatSql(dollar).sql),
    literalsOf(dollar),
  );

  // 行注释与块注释的内容逐字节保留（压缩时按选项丢弃，不算改写）。
  const commented = M.formatSql('SELECT a /* from where */ FROM t -- select and where').sql;
  checkTrue('块注释内容原样保留', commented.includes('/* from where */'));
  checkTrue('行注释内容原样保留', commented.includes('-- select and where'));

  const compact = M.compactSql('SELECT a /* from where select */ FROM t', false).sql;
  checkTrue('压缩丢弃注释后仍是同一条语句', !compact.includes('from where select'));
  checkTrue('压缩结果不含换行', !compact.includes('\n'));
  checkTrue('压缩时保留注释的选项生效', M.compactSql('SELECT a /* keep */ FROM t', true).sql.includes('/* keep */'));
}

console.log('\n--- 3. token 序列与幂等 ---');
{
  let tokenMismatch = 0;
  let idempotentMismatch = 0;
  for (const query of QUERIES) {
    const before = normalisedTokens(query.sql);
    for (const variant of VARIANTS) {
      const r = variant.make(query.sql);
      if (!r.ok) continue;
      const after = normalisedTokens(r.sql);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        tokenMismatch += 1;
        console.log(`FAIL  [${query.label}] ${variant.label} token 序列变化`);
      }
    }
    const once = M.formatSql(query.sql);
    if (once.ok) {
      const twice = M.formatSql(once.sql);
      if (!twice.ok || twice.sql !== once.sql) {
        idempotentMismatch += 1;
        console.log(`FAIL  [${query.label}] 格式化不幂等`);
      }
    }
  }
  check(`22 条查询 × ${VARIANTS.length} 种排版的 token 序列不变`, tokenMismatch, 0);
  check('22 条查询再格式化一次结果不变（幂等）', idempotentMismatch, 0);
  check('空输入返回空结果而不是报错', M.formatSql(''), { ok: true, sql: '', tokens: 0, lines: 0 });
  check('纯空白输入', M.formatSql('   \n\t '), { ok: true, sql: '', tokens: 0, lines: 0 });
  check('纯注释输入不报错', M.formatSql('-- nothing here').ok, true);
}

console.log('\n--- 4. 关键字大写与子句换行 ---');
{
  const r = M.formatSql('select a, b from t where a = 1 group by a order by b limit 5');
  check(
    '子句各自成行、关键字大写、列表项缩进一级',
    r.sql,
    'SELECT a,\n  b\nFROM t\nWHERE a = 1\nGROUP BY a\nORDER BY b\nLIMIT 5',
  );
  const join = M.formatSql('select * from a left join b on b.id = a.id inner join c on c.id = b.id').sql;
  checkTrue('LEFT JOIN 连写成一行', join.includes('LEFT JOIN b'));
  checkTrue('INNER JOIN 连写成一行', join.includes('INNER JOIN c'));
  checkTrue('ON 单独成行', /\nON b\.id = a\.id/.test(join));
  checkTrue('关键字全部大写', !/\bselect\b|\bfrom\b|\bwhere\b/.test(join));

  check('缩进宽度生效', M.formatSql('select a, b from t', { indent: 4 }).sql, 'SELECT a,\n    b\nFROM t');
  check(
    '逗号前置生效',
    M.formatSql('select a, b from t', { comma: 'leading' }).sql,
    'SELECT a\n  , b\nFROM t',
  );
  check('压缩成单行', M.compactSql('select a,\n b\nfrom t where x = 1').sql, 'SELECT a, b FROM t WHERE x = 1');

  // 引号里的内容不能当关键字：小写 select 是列名时不该动它之外的东西。
  const dotted = M.formatSql('select t.select from t').sql;
  checkTrue('点号后的 select 不被当成关键字（保持原大小写）', dotted.includes('t.select'));
}

console.log('\n--- 5. 括号配平与引号闭合报错并定位 ---');
{
  const cases = [
    ['SELECT (1 + 2', 1, 8, '左括号'],
    ['SELECT 1)', 1, 9, '右括号'],
    ['SELECT a FROM t WHERE x IN (1, 2', 1, 28, '左括号'],
    ['SELECT 1,\n  (2\n', 2, 3, '左括号'],
    ["SELECT 'abc", 1, 8, '引号'],
    ['SELECT [a)', 1, 8, '引号'],
    ['SELECT /* abc', 1, 8, '块注释'],
    ['SELECT $tag$ abc', 1, 8, '美元引用'],
    ['SELECT {1', 1, 8, '左括号'],
    ['SELECT 1 + ) 2', 1, 12, '右括号'],
  ];
  let wrong = 0;
  for (const [sql, line, column, needle] of cases) {
    const r = M.formatSql(sql);
    const ok =
      !r.ok && r.error.line === line && r.error.column === column && r.error.message.includes(needle);
    if (!ok) {
      wrong += 1;
      console.log(
        `FAIL  ${JSON.stringify(sql)} 期望 ${line}:${column} 含"${needle}"，得到 ` +
          (r.ok ? '成功' : `${r.error.line}:${r.error.column} ${r.error.message}`),
      );
    }
  }
  check('10 种不配平输入的报错行号/列号/原因全部正确', wrong, 0);

  const err = M.formatSql('SELECT (1 + 2');
  checkTrue('报错附带指向列号的小尖号', typeof err.error.snippet === 'string' && err.error.snippet.includes('^'));
  checkTrue('报错附带出错偏移量', typeof err.error.index === 'number' && err.error.index === 7);
  check('validateSql 与 formatSql 报同一种错', M.validateSql('SELECT ), 1').ok, false);
  check('validateSql 对合法 SQL 通过', M.validateSql('SELECT a FROM t').ok, true);
  check('validateSql 报出 token 数', M.validateSql('SELECT a FROM t').tokens, 4);

  // 括号出现在字符串里不算括号。
  check('字符串里的括号不参与配平', M.formatSql("SELECT ')' AS x, '(' AS y").ok, true);
  check('注释里的括号不参与配平', M.formatSql('SELECT 1 -- )))\n+ 2').ok, true);
}

console.log('\n--- 6. 反证：朴素正则替换会改写字符串里的内容 ---');
{
  const sql = "SELECT 'from where select' AS note";
  const naive = M.naiveUppercaseKeywords(sql);
  checkTrue('朴素正则确实把字符串里的关键字大写了（说明该缺陷真实存在）', naive.includes("'FROM WHERE SELECT'"));
  checkTrue('本实现不会（同一输入对比）', !M.formatSql(sql).sql.includes("'FROM WHERE SELECT'"));

  if (HAS_SQLITE) {
    const results = runOracle([
      { id: 'raw', sql },
      { id: 'naive', sql: naive },
      { id: 'fmt', sql: M.formatSql(sql).sql },
    ]);
    check('原文执行结果', results.raw.rows, [[['from where select']]]);
    checkTrue('朴素正则替换改变了 sqlite3 的执行结果（本检查能抓到它）', JSON.stringify(results.naive.rows) !== JSON.stringify(results.raw.rows));
    check('本实现的执行结果与原文完全一致', results.fmt.rows, results.raw.rows);
  }
}

console.log('\n--- 7. 词法边界 ---');
{
  const t = (sql) => M.tokenize(sql);
  check('空串没有 token', t('').tokens, []);
  check('字符串末的转义不越界', t("SELECT '\\''").ok, true);
  check(
    '双写单引号算一个字符串',
    M.collectLiterals(t("SELECT 'it''s'").tokens),
    [{ kind: 'string', text: "'it''s'" }],
  );
  check(
    '双写双引号算一个标识符',
    M.collectLiterals(t('SELECT "a""b"').tokens),
    [{ kind: 'string', text: '"a""b"' }],
  );
  check(
    '方括号标识符配对',
    M.collectLiterals(t('SELECT [a]]b]').tokens),
    [{ kind: 'string', text: '[a]]b]' }],
  );
  check(
    '嵌套块注释整段取出',
    M.collectLiterals(t('SELECT 1 /* a /* b */ c */ + 2').tokens),
    [{ kind: 'comment', text: '/* a /* b */ c */' }],
  );
  check('超长输入不崩', M.formatSql(`SELECT ${'1 + '.repeat(20000)}1`).ok, true);
  check('超长字符串字面量原样保留', M.formatSql(`SELECT '${'x'.repeat(50000)}'`).sql.length > 50000, true);
  const longLiterals = M.collectLiterals(
    M.tokenize(`SELECT '${'from where '.repeat(5000)}' AS x`).tokens,
  );
  checkTrue('超长字符串里的关键字一个都没改', longLiterals[0].text.includes('from where from where'));

  // 操作符最长匹配：`->>` 不能被拆成 `->` 加 `>`。
  check(
    'PostgreSQL ->> 操作符整体识别',
    M.tokenize("SELECT a->>'b' FROM t").tokens.filter((x) => x.kind === 'operator').map((x) => x.text),
    ['->>'],
  );
  check(':: 类型转换整体识别', M.tokenize('SELECT a::int').tokens.filter((x) => x.kind === 'operator').map((x) => x.text), ['::']);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
if (HAS_SQLITE) console.log(`sqlite3 参照物版本：SQLite ${sqliteVersion}`);
else console.log('注意：未找到可用的 python3 + sqlite3，第 1、6 节的 sqlite3 参照断言已跳过。');
process.exit(failed === 0 ? 0 : 1);
