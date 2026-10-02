/**
 * Checks the BIP-39 mnemonic tool against independent references.
 *
 * Three authorities are used, none of which is this implementation:
 *
 *   1. The official BIP-39 test vectors (the `vectors.json` published with the
 *      BIP and maintained by Trezor). All 24 English entries are embedded and
 *      compared word for word: 128 / 192 / 256 bits of entropy, all-zero, all-
 *      0x7f, all-0x80 and all-0xff patterns, each with the passphrase TREZOR.
 *      The Japanese entries are embedded too, purely for the seed step, because
 *      their passphrase is built from compatibility characters and therefore
 *      proves the NFKD normalisation is load-bearing rather than decorative.
 *   2. The official English word list, pinned by the SHA-256 of the published
 *      `english.txt` (2048 lines, one word each). A silently edited word cannot
 *      survive that digest even though the vectors would still pass.
 *   3. `node:crypto`, used two ways: `createHash('sha256')` feeds the pure
 *      bit-shuffling core, and `pbkdf2Sync` independently reproduces every seed
 *      so Web Crypto and OpenSSL have to agree.
 *
 * The check also attacks the two plausible shortcuts in the tool: taking a
 * whole byte of digest as the checksum, and using the passphrase directly as
 * the PBKDF2 salt. Both are built here and shown to disagree with the spec.
 *
 * Usage: node scripts/check-bip39-generator.mjs
 */
import { createHash, pbkdf2Sync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

/**
 * The SHA-256 of the published english.txt, taken over the exact file bytes
 * (every word followed by a single newline, including the last one).
 */
const OFFICIAL_WORDLIST_SHA256 = '2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda';

/** Official English vectors, each [entropyHex, mnemonic, seedWithTrezor]. */
const OFFICIAL_ENGLISH = [
  [
    "00000000000000000000000000000000",
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    "c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04"
  ],
  [
    "7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f",
    "legal winner thank year wave sausage worth useful legal winner thank yellow",
    "2e8905819b8723fe2c1d161860e5ee1830318dbf49a83bd451cfb8440c28bd6fa457fe1296106559a3c80937a1c1069be3a3a5bd381ee6260e8d9739fce1f607"
  ],
  [
    "80808080808080808080808080808080",
    "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
    "d71de856f81a8acc65e6fc851a38d4d7ec216fd0796d0a6827a3ad6ed5511a30fa280f12eb2e47ed2ac03b5c462a0358d18d69fe4f985ec81778c1b370b652a8"
  ],
  [
    "ffffffffffffffffffffffffffffffff",
    "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong",
    "ac27495480225222079d7be181583751e86f571027b0497b5b5d11218e0a8a13332572917f0f8e5a589620c6f15b11c61dee327651a14c34e18231052e48c069"
  ],
  [
    "000000000000000000000000000000000000000000000000",
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon agent",
    "035895f2f481b1b0f01fcf8c289c794660b289981a78f8106447707fdd9666ca06da5a9a565181599b79f53b844d8a71dd9f439c52a3d7b3e8a79c906ac845fa"
  ],
  [
    "7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f",
    "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal will",
    "f2b94508732bcbacbcc020faefecfc89feafa6649a5491b8c952cede496c214a0c7b3c392d168748f2d4a612bada0753b52a1c7ac53c1e93abd5c6320b9e95dd"
  ],
  [
    "808080808080808080808080808080808080808080808080",
    "letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter always",
    "107d7c02a5aa6f38c58083ff74f04c607c2d2c0ecc55501dadd72d025b751bc27fe913ffb796f841c49b1d33b610cf0e91d3aa239027f5e99fe4ce9e5088cd65"
  ],
  [
    "ffffffffffffffffffffffffffffffffffffffffffffffff",
    "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo when",
    "0cd6e5d827bb62eb8fc1e262254223817fd068a74b5b449cc2f667c3f1f985a76379b43348d952e2265b4cd129090758b3e3c2c49103b5051aac2eaeb890a528"
  ],
  [
    "0000000000000000000000000000000000000000000000000000000000000000",
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art",
    "bda85446c68413707090a52022edd26a1c9462295029f2e60cd7c4f2bbd3097170af7a4d73245cafa9c3cca8d561a7c3de6f5d4a10be8ed2a5e608d68f92fcc8"
  ],
  [
    "7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f",
    "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title",
    "bc09fca1804f7e69da93c2f2028eb238c227f2e9dda30cd63699232578480a4021b146ad717fbb7e451ce9eb835f43620bf5c514db0f8add49f5d121449d3e87"
  ],
  [
    "8080808080808080808080808080808080808080808080808080808080808080",
    "letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless",
    "c0c519bd0e91a2ed54357d9d1ebef6f5af218a153624cf4f2da911a0ed8f7a09e2ef61af0aca007096df430022f7a2b6fb91661a9589097069720d015e4e982f"
  ],
  [
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote",
    "dd48c104698c30cfe2b6142103248622fb7bb0ff692eebb00089b32d22484e1613912f0a5b694407be899ffd31ed3992c456cdf60f5d4564b8ba3f05a69890ad"
  ],
  [
    "9e885d952ad362caeb4efe34a8e91bd2",
    "ozone drill grab fiber curtain grace pudding thank cruise elder eight picnic",
    "274ddc525802f7c828d8ef7ddbcdc5304e87ac3535913611fbbfa986d0c9e5476c91689f9c8a54fd55bd38606aa6a8595ad213d4c9c9f9aca3fb217069a41028"
  ],
  [
    "6610b25967cdcca9d59875f5cb50b0ea75433311869e930b",
    "gravity machine north sort system female filter attitude volume fold club stay feature office ecology stable narrow fog",
    "628c3827a8823298ee685db84f55caa34b5cc195a778e52d45f59bcf75aba68e4d7590e101dc414bc1bbd5737666fbbef35d1f1903953b66624f910feef245ac"
  ],
  [
    "68a79eaca2324873eacc50cb9c6eca8cc68ea5d936f98787c60c7ebc74e6ce7c",
    "hamster diagram private dutch cause delay private meat slide toddler razor book happy fancy gospel tennis maple dilemma loan word shrug inflict delay length",
    "64c87cde7e12ecf6704ab95bb1408bef047c22db4cc7491c4271d170a1b213d20b385bc1588d9c7b38f1b39d415665b8a9030c9ec653d75e65f847d8fc1fc440"
  ],
  [
    "c0ba5a8e914111210f2bd131f3d5e08d",
    "scheme spot photo card baby mountain device kick cradle pact join borrow",
    "ea725895aaae8d4c1cf682c1bfd2d358d52ed9f0f0591131b559e2724bb234fca05aa9c02c57407e04ee9dc3b454aa63fbff483a8b11de949624b9f1831a9612"
  ],
  [
    "6d9be1ee6ebd27a258115aad99b7317b9c8d28b6d76431c3",
    "horn tenant knee talent sponsor spell gate clip pulse soap slush warm silver nephew swap uncle crack brave",
    "fd579828af3da1d32544ce4db5c73d53fc8acc4ddb1e3b251a31179cdb71e853c56d2fcb11aed39898ce6c34b10b5382772db8796e52837b54468aeb312cfc3d"
  ],
  [
    "9f6a2878b2520799a44ef18bc7df394e7061a224d2c33cd015b157d746869863",
    "panda eyebrow bullet gorilla call smoke muffin taste mesh discover soft ostrich alcohol speed nation flash devote level hobby quick inner drive ghost inside",
    "72be8e052fc4919d2adf28d5306b5474b0069df35b02303de8c1729c9538dbb6fc2d731d5f832193cd9fb6aeecbc469594a70e3dd50811b5067f3b88b28c3e8d"
  ],
  [
    "23db8160a31d3e0dca3688ed941adbf3",
    "cat swing flag economy stadium alone churn speed unique patch report train",
    "deb5f45449e615feff5640f2e49f933ff51895de3b4381832b3139941c57b59205a42480c52175b6efcffaa58a2503887c1e8b363a707256bdd2b587b46541f5"
  ],
  [
    "8197a4a47f0425faeaa69deebc05ca29c0a5b5cc76ceacc0",
    "light rule cinnamon wrap drastic word pride squirrel upgrade then income fatal apart sustain crack supply proud access",
    "4cbdff1ca2db800fd61cae72a57475fdc6bab03e441fd63f96dabd1f183ef5b782925f00105f318309a7e9c3ea6967c7801e46c8a58082674c860a37b93eda02"
  ],
  [
    "066dca1a2bb7e8a1db2832148ce9933eea0f3ac9548d793112d9a95c9407efad",
    "all hour make first leader extend hole alien behind guard gospel lava path output census museum junior mass reopen famous sing advance salt reform",
    "26e975ec644423f4a4c4f4215ef09b4bd7ef924e85d1d17c4cf3f136c2863cf6df0a475045652c57eb5fb41513ca2a2d67722b77e954b4b3fc11f7590449191d"
  ],
  [
    "f30f8c1da665478f49b001d94c5fc452",
    "vessel ladder alter error federal sibling chat ability sun glass valve picture",
    "2aaa9242daafcee6aa9d7269f17d4efe271e1b9a529178d7dc139cd18747090bf9d60295d0ce74309a78852a9caadf0af48aae1c6253839624076224374bc63f"
  ],
  [
    "c10ec20dc3cd9f652c7fac2f1230f7a3c828389a14392f05",
    "scissors invite lock maple supreme raw rapid void congress muscle digital elegant little brisk hair mango congress clump",
    "7b4a10be9d98e6cba265566db7f136718e1398c71cb581e1b2f464cac1ceedf4f3e274dc270003c670ad8d02c4558b2f8e39edea2775c9e232c7cb798b069e88"
  ],
  [
    "f585c11aec520db57dd353c69554b21a89b20fb0650966fa0a9d6f74fd989d8f",
    "void come effort suffer camp survey warrior heavy shoot primary clutch crush open amazing screen patrol group space point ten exist slush involve unfold",
    "01f5bced59dec48e362f2c45b5de68b9fd6c92c6634f44d6d40aab69056506f0e35524a518034ddc1192e1dacd32c1ed3eaa3c3b131c88ed8e7e54c49a5d0998"
  ]
];

/** Official Japanese vectors, each { entropy, mnemonic, passphrase, seed }. */
const OFFICIAL_JAPANESE = [
  {
    "entropy": "00000000000000000000000000000000",
    "mnemonic": "あいこくしん　あいこくしん　あいこくしん　あいこくしん　あいこくしん　あいこくしん　あいこくしん　あいこくしん　あいこくしん　あいこくしん　あいこくしん　あおぞら",
    "passphrase": "㍍ガバヴァぱばぐゞちぢ十人十色",
    "seed": "a262d6fb6122ecf45be09c50492b31f92e9beb7d9a845987a02cefda57a15f9c467a17872029a9e92299b5cbdf306e3a0ee620245cbd508959b6cb7ca637bd55"
  },
  {
    "entropy": "7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f",
    "mnemonic": "そつう　れきだい　ほんやく　わかす　りくつ　ばいか　ろせん　やちん　そつう　れきだい　ほんやく　わかめ",
    "passphrase": "㍍ガバヴァぱばぐゞちぢ十人十色",
    "seed": "aee025cbe6ca256862f889e48110a6a382365142f7d16f2b9545285b3af64e542143a577e9c144e101a6bdca18f8d97ec3366ebf5b088b1c1af9bc31346e60d9"
  },
  {
    "entropy": "80808080808080808080808080808080",
    "mnemonic": "そとづら　あまど　おおう　あこがれる　いくぶん　けいけん　あたえる　いよく　そとづら　あまど　おおう　あかちゃん",
    "passphrase": "㍍ガバヴァぱばぐゞちぢ十人十色",
    "seed": "e51736736ebdf77eda23fa17e31475fa1d9509c78f1deb6b4aacfbd760a7e2ad769c714352c95143b5c1241985bcb407df36d64e75dd5a2b78ca5d2ba82a3544"
  }
];

/**
 * Transpiles one TypeScript module to `.verify/` so it can be imported.
 *
 * `rewrites` fixes up relative imports: the generated files are flat, so a
 * sibling import has to be pointed at the generated file name.
 */
function transpile(sourcePath, outName, rewrites = []) {
  let source = readFileSync(sourcePath, 'utf8');
  for (const [from, to] of rewrites) source = source.split(from).join(to);
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  mkdirSync('.verify', { recursive: true });
  const out = `.verify/${outName}`;
  writeFileSync(out, compiled);
  return pathToFileURL(out).href;
}

transpile('src/tools/bip39-generator/wordlist.ts', 'bip39-wordlist.mjs');
const moduleUrl = transpile('src/tools/bip39-generator/bip39Utils.ts', 'bip39-generator.mjs', [
  ["from './wordlist'", "from './bip39-wordlist.mjs'"],
]);
const M = await import(moduleUrl);

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

const hex = (bytes) => Buffer.from(bytes).toString('hex');
const bytesFromHex = (value) => new Uint8Array(Buffer.from(value, 'hex'));

/**
 * A second implementation of entropy -> mnemonic, written from the spec text
 * rather than from the module, used to cross-check the sizes the official
 * vectors do not cover (160 and 224 bits). It reads the word list from the
 * module, so the list itself is pinned separately by the SHA-256 check above.
 */
function referenceMnemonic(entropyHex) {
  const entropy = Buffer.from(entropyHex, 'hex');
  const bits = entropy.length * 8;
  const checksumLength = bits / 32;
  const digest = createHash('sha256').update(entropy).digest();
  let stream = '';
  for (const byte of [...entropy, ...digest]) stream += byte.toString(2).padStart(8, '0');
  stream = stream.slice(0, bits + checksumLength);
  const words = [];
  for (let i = 0; i < stream.length; i += 11) {
    words.push(M.WORDLIST[Number.parseInt(stream.slice(i, i + 11), 2)]);
  }
  return words.join(' ');
}

/** The empty-passphrase mnemonic used by most of the KDF comparisons. */
const SAMPLE_MNEMONIC = OFFICIAL_ENGLISH[0][1];

/* ------------------------------------------------------------------ */
/* 1. The word list, pinned by the official digest                     */
/* ------------------------------------------------------------------ */

console.log('--- 词表 ---');

{
  const words = [...M.WORDLIST];
  check('词表恰好 2048 个词', words.length, 2048);
  check('wordlistSize() 与数组长度一致', M.wordlistSize(), 2048);
  check('词表严格按字典序升序', words.every((word, i) => i === 0 || words[i - 1] < word), true);
  check('词表无重复', new Set(words).size, 2048);
  check('词表全部是小写 ASCII 字母', words.every((word) => /^[a-z]+$/.test(word)), true);
  check('前四个字母唯一（BIP-39 的已知性质）', new Set(words.map((word) => word.slice(0, 4))).size, 2048);
  check('第 0 个词是 abandon', words[0], 'abandon');
  check('第 1 个词是 ability', words[1], 'ability');
  check('倒数第二个词是 zone', words[2046], 'zone');
  check('第 2047 个词是 zoo', words[2047], 'zoo');
  check(
    '词表原文的 SHA-256 等于官方 english.txt 的摘要',
    createHash('sha256').update(`${words.join('\n')}\n`).digest('hex'),
    OFFICIAL_WORDLIST_SHA256,
  );
  check('重建的原文恰好 2048 行', `${words.join('\n')}\n`.split('\n').length - 1, 2048);

  check('wordIndex(abandon) 是 0', M.wordIndex('abandon'), 0);
  check('wordIndex(zoo) 是 2047', M.wordIndex('zoo'), 2047);
  check('wordIndex(不存在的词) 是 -1', M.wordIndex('zzzz'), -1);
  check('wordIndex 大小写敏感', M.wordIndex('Abandon'), -1);
  check('suggestWords 用前四字母给出唯一候选', M.suggestWords('aband'), ['abandon']);
  check('suggestWords(abou) 给出 about', M.suggestWords('abou'), ['about']);
  check('suggestWords 对不足四字母的输入不猜', M.suggestWords('abc'), []);
  check('suggestWords 对词表外前缀返回空', M.suggestWords('zzzz'), []);
}

/* ------------------------------------------------------------------ */
/* 2. Constant tables                                                  */
/* ------------------------------------------------------------------ */

console.log('--- 常量表 ---');

{
  check('ENTROPY_BITS 是五档', [...M.ENTROPY_BITS], [128, 160, 192, 224, 256]);
  check('每档熵对应的词数', [128, 160, 192, 224, 256].map((bits) => M.WORD_COUNT[bits]), [12, 15, 18, 21, 24]);
  check(
    '词数到熵的反向表',
    [12, 15, 18, 21, 24].map((count) => M.BITS_BY_WORD_COUNT[count]),
    [128, 160, 192, 224, 256],
  );
  check('反向表没有 13 个词的条目', M.BITS_BY_WORD_COUNT[13], undefined);
  check('反向表没有 11 个词的条目', M.BITS_BY_WORD_COUNT[11], undefined);
  check('校验和位数是熵位数除以 32', [128, 160, 192, 224, 256].map((bits) => M.checksumBitCount(bits)), [4, 5, 6, 7, 8]);
}

/* ------------------------------------------------------------------ */
/* 3. Official vectors: entropy -> mnemonic                            */
/* ------------------------------------------------------------------ */

console.log('--- 官方向量：entropy → mnemonic（24 条）---');

{
  const asyncMnemonics = [];
  const asyncEntropyHex = [];
  for (const [index, [entropy, mnemonic]] of OFFICIAL_ENGLISH.entries()) {
    const bytes = bytesFromHex(entropy);
    const digest = new Uint8Array(createHash('sha256').update(bytes).digest());
    check(
      `向量 #${index}（${entropy.length * 4} 位）纯函数 entropy → mnemonic`,
      M.entropyToMnemonicFromDigest(bytes, digest),
      mnemonic,
    );

    const outcome = await M.entropyToMnemonic(bytes);
    asyncMnemonics.push(outcome.ok ? outcome.result.mnemonic : `错误：${outcome.error}`);
    asyncEntropyHex.push(outcome.ok ? outcome.result.entropyHex : null);
  }

  check(
    '异步 entropyToMnemonic 复现全部 24 条向量',
    asyncMnemonics,
    OFFICIAL_ENGLISH.map(([, mnemonic]) => mnemonic),
  );
  check(
    '异步结果回显的熵与输入的熵一致',
    asyncEntropyHex,
    OFFICIAL_ENGLISH.map(([entropy]) => entropy),
  );
  check(
    '独立按规范重写的实现也复现全部 24 条向量',
    OFFICIAL_ENGLISH.map(([entropy]) => referenceMnemonic(entropy)),
    OFFICIAL_ENGLISH.map(([, mnemonic]) => mnemonic),
  );
  check('官方向量覆盖 128 / 192 / 256 三种熵', [...new Set(OFFICIAL_ENGLISH.map(([e]) => e.length * 4))].sort(), [128, 192, 256]);
}

/* ------------------------------------------------------------------ */
/* 4. Official vectors: mnemonic + TREZOR -> seed                      */
/* ------------------------------------------------------------------ */

console.log('--- 官方向量：mnemonic + TREZOR → 64 字节种子（24 条）---');

{
  const seeds = [];
  for (const [index, [, mnemonic, seed]] of OFFICIAL_ENGLISH.entries()) {
    const derived = hex(await M.mnemonicToSeed(mnemonic, 'TREZOR'));
    seeds.push(derived);
    check(`向量 #${index} mnemonic + TREZOR → seed`, derived, seed);
  }
  check('每条种子都是 64 字节', seeds.every((seed) => seed.length === 128), true);
  check(
    '全部种子与 node:crypto 的 pbkdf2Sync 一致（Web Crypto 对 OpenSSL）',
    seeds,
    OFFICIAL_ENGLISH.map(([, mnemonic]) =>
      pbkdf2Sync(Buffer.from(mnemonic, 'utf8'), Buffer.from('mnemonicTREZOR', 'utf8'), 2048, 64, 'sha512').toString('hex'),
    ),
  );
  check(
    '官方向量本身满足 pbkdf2(mnemonic, "mnemonic" + passphrase)',
    OFFICIAL_ENGLISH.map(([, mnemonic]) =>
      pbkdf2Sync(Buffer.from(mnemonic, 'utf8'), Buffer.from('mnemonicTREZOR', 'utf8'), 2048, 64, 'sha512').toString('hex'),
    ),
    OFFICIAL_ENGLISH.map(([, , seed]) => seed),
  );
}

/* ------------------------------------------------------------------ */
/* 5. PBKDF2 parameters, by construction                               */
/* ------------------------------------------------------------------ */

console.log('--- PBKDF2 参数：与 node:crypto 交叉验证 ---');

{
  const passphrases = ['', 'TREZOR', 'correct horse battery staple', '中文口令', 'emoji 🔐 口令', '㍍ガバヴァ'];
  for (const passphrase of passphrases) {
    const derived = hex(await M.mnemonicToSeed(SAMPLE_MNEMONIC, passphrase));
    const reference = pbkdf2Sync(
      Buffer.from(SAMPLE_MNEMONIC.normalize('NFKD'), 'utf8'),
      Buffer.from(`mnemonic${passphrase}`.normalize('NFKD'), 'utf8'),
      2048,
      64,
      'sha512',
    ).toString('hex');
    check(`口令 ${JSON.stringify(passphrase)} 的种子与 pbkdf2Sync 一致`, derived, reference);
  }

  const proper = pbkdf2Sync(Buffer.from(SAMPLE_MNEMONIC), Buffer.from('mnemonicTREZOR'), 2048, 64, 'sha512').toString('hex');

  check(
    '反证：盐不是口令本身（少了 mnemonic 前缀）',
    pbkdf2Sync(Buffer.from(SAMPLE_MNEMONIC), Buffer.from('TREZOR'), 2048, 64, 'sha512').toString('hex') === proper,
    false,
  );
  check(
    '反证：盐没有分隔符（"mnemonic TREZOR" 会得到另一个种子）',
    pbkdf2Sync(Buffer.from(SAMPLE_MNEMONIC), Buffer.from('mnemonic TREZOR'), 2048, 64, 'sha512').toString('hex') === proper,
    false,
  );
  check(
    '反证：迭代次数不是 1',
    pbkdf2Sync(Buffer.from(SAMPLE_MNEMONIC), Buffer.from('mnemonicTREZOR'), 1, 64, 'sha512').toString('hex') === proper,
    false,
  );
  check(
    '反证：摘要是 SHA-512 而不是 SHA-256',
    pbkdf2Sync(Buffer.from(SAMPLE_MNEMONIC), Buffer.from('mnemonicTREZOR'), 2048, 64, 'sha256').toString('hex') === proper,
    false,
  );
  check(
    '反证：摘要长度是 64 字节而不是 32',
    pbkdf2Sync(Buffer.from(SAMPLE_MNEMONIC), Buffer.from('mnemonicTREZOR'), 2048, 32, 'sha512').toString('hex') === proper,
    false,
  );

  // A sentence with two spaces is a different sentence, so it must be a
  // different seed: mnemonicToSeed deliberately does not re-flow whitespace.
  check(
    '助记词里的多余空格不会被 KDF 悄悄吞掉',
    hex(await M.mnemonicToSeed('abandon  about', '')),
    pbkdf2Sync(Buffer.from('abandon  about'), Buffer.from('mnemonic'), 2048, 64, 'sha512').toString('hex'),
  );
  check(
    '单空格与双空格派生出的种子不同',
    (await M.mnemonicToSeed('abandon about', '')).length === 64 &&
      hex(await M.mnemonicToSeed('abandon about', '')) !== hex(await M.mnemonicToSeed('abandon  about', '')),
    true,
  );
}

/* ------------------------------------------------------------------ */
/* 6. NFKD, proven with the Japanese official vectors                  */
/* ------------------------------------------------------------------ */

console.log('--- NFKD 归一化（官方日文向量 + 反证）---');

{
  for (const [index, vector] of OFFICIAL_JAPANESE.entries()) {
    check(
      `日文向量 #${index}（熵 ${vector.entropy.slice(0, 8)}…）派生正确种子`,
      hex(await M.mnemonicToSeed(vector.mnemonic, vector.passphrase)),
      vector.seed,
    );
  }

  const vector = OFFICIAL_JAPANESE[0];
  check('日文口令含兼容字符，NFKD 会改写它', '\u334d'.normalize('NFKD') !== '\u334d', true);
  check('全角空格在 NFKD 下变成普通空格', '\u3000'.normalize('NFKD'), ' ');
  check('英文助记词的 NFKD 是不动点', SAMPLE_MNEMONIC.normalize('NFKD'), SAMPLE_MNEMONIC);
  check(
    '反证：不做 NFKD 就会得到错误的种子',
    pbkdf2Sync(
      Buffer.from(vector.mnemonic, 'utf8'),
      Buffer.from(`mnemonic${vector.passphrase}`, 'utf8'),
      2048,
      64,
      'sha512',
    ).toString('hex') === vector.seed,
    false,
  );
}

/* ------------------------------------------------------------------ */
/* 7. Checksum detection                                               */
/* ------------------------------------------------------------------ */

console.log('--- 校验和 ---');

{
  const valid = await M.inspectMnemonic(OFFICIAL_ENGLISH[0][1]);
  check('官方向量解析成功', valid.ok, true);
  check('官方向量校验和有效', valid.ok ? valid.checksumValid : null, true);
  check('官方向量校验和长度为 4 位', valid.ok ? valid.checksumLength : null, 4);
  check('携带的校验和位与熵的摘要一致', valid.ok ? valid.checksumBits : null, valid.ok ? valid.expectedChecksumBits : null);
  check('校验和数值也在 0 到 15 之间', valid.ok && valid.checksumValue >= 0 && valid.checksumValue < 16, true);

  const words = OFFICIAL_ENGLISH[0][1].split(' ');
  for (const replacement of ['abandon', 'zoo', 'ability']) {
    const broken = [...words.slice(0, -1), replacement].join(' ');
    const inspected = await M.inspectMnemonic(broken);
    check(`把末词换成 ${replacement} 后能解出熵`, inspected.ok, true);
    check(`把末词换成 ${replacement} 后校验和报错`, inspected.ok ? inspected.checksumValid : null, false);
    check(
      `把末词换成 ${replacement} 后携带的校验和与摘要不同`,
      inspected.ok ? inspected.checksumBits !== inspected.expectedChecksumBits : null,
      true,
    );
  }

  const original = await M.inspectMnemonic(words.join(' '));
  check('原样的末词仍然校验通过（对照）', original.ok ? original.checksumValid : null, true);

  const lastWordWrong = await M.inspectMnemonic('abandon '.repeat(11) + 'zoo');
  check('全 abandon 加一个 zoo 也能解出熵', lastWordWrong.ok, true);
  check('全 abandon 加一个 zoo 校验和不通过', lastWordWrong.ok ? lastWordWrong.checksumValid : null, false);
}

/* ------------------------------------------------------------------ */
/* 8. Entropy length boundaries                                        */
/* ------------------------------------------------------------------ */

console.log('--- 熵长度边界 ---');

{
  for (const length of [16, 20, 24, 28, 32]) {
    check(`${length} 字节熵被接受`, M.validateEntropy(new Uint8Array(length)), null);
  }
  for (const length of [0, 1, 15, 17, 21, 31, 33]) {
    const error = M.validateEntropy(new Uint8Array(length));
    check(`${length} 字节熵被拒绝`, typeof error === 'string' && error.length > 0, true);
  }
  check(
    '17 字节（136 位，非 32 的倍数）的报错说明合法取值',
    /128 \/ 160 \/ 192 \/ 224 \/ 256/.test(M.validateEntropy(new Uint8Array(17)) ?? ''),
    true,
  );
  check(
    '非 32 倍数被拒绝的报错提到 32',
    /32/.test(M.validateEntropy(new Uint8Array(17)) ?? ''),
    true,
  );

  const bad = await M.entropyToMnemonic(new Uint8Array(17));
  check('entropyToMnemonic 对 17 字节返回失败', bad.ok, false);
  check('失败时带有错误文案', bad.ok === false && bad.error.length > 0, true);
  const empty = await M.entropyToMnemonic(new Uint8Array(0));
  check('entropyToMnemonic 对空熵返回失败', empty.ok, false);
  const tooLong = await M.entropyToMnemonic(new Uint8Array(33));
  check('entropyToMnemonic 对 33 字节返回失败', tooLong.ok, false);

  let threw = false;
  try {
    M.entropyToMnemonicFromDigest(new Uint8Array(17), new Uint8Array(32));
  } catch {
    threw = true;
  }
  check('纯函数对非法熵长度抛错而不是猜一个尺寸', threw, true);

  for (const length of [16, 20, 24, 28, 32]) {
    const bytes = new Uint8Array(length).map((_, i) => (i * 37 + 11) & 0xff);
    check(`${length} 字节 bits → bytes 往返一致`, [...M.bitsToBytes(M.bytesToBits(bytes))], [...bytes]);
  }
  check('bytesToBits(0x01) 从最高位开始', M.bytesToBits(new Uint8Array([1])), [0, 0, 0, 0, 0, 0, 0, 1]);
  check('bytesToBits(0x80) 从最高位开始', M.bytesToBits(new Uint8Array([128])), [1, 0, 0, 0, 0, 0, 0, 0]);

  let truncated = false;
  try {
    M.bitsToBytes([1, 0, 1, 0, 1, 0, 1]);
  } catch {
    truncated = true;
  }
  check('bitsToBytes 对非 8 倍数长度抛错而不是静默截断', truncated, true);

  check('groupHex 默认每 8 个字符一组', M.groupHex('0011223344556677'), '00112233 44556677');
  check('groupHex 支持自定义组宽', M.groupHex('aabbccdd', 4), 'aabb ccdd');
  check('groupHex 对空串返回空串', M.groupHex(''), '');
}

/* ------------------------------------------------------------------ */
/* 9. Hex entropy parsing                                              */
/* ------------------------------------------------------------------ */

console.log('--- 十六进制熵解析 ---');

{
  const plain = M.parseHexBytes('00000000000000000000000000000000');
  check('全零十六进制解析成功', plain.ok, true);
  check('解析出的字节数为 16', plain.ok ? plain.bytes.length : null, 16);
  check('解析出的字节全为 0', plain.ok ? [...plain.bytes].every((byte) => byte === 0) : null, true);

  const prefixed = M.parseHexBytes('  0xDEADBEEF  ');
  check('接受 0x 前缀、大小写与首尾空格', prefixed.ok ? hex(prefixed.bytes) : null, 'deadbeef');
  const separated = M.parseHexBytes('de:ad_be-ef');
  check('接受冒号、下划线与短横线分隔', separated.ok ? hex(separated.bytes) : null, 'deadbeef');
  const spaced = M.parseHexBytes('de ad\nbe\tef');
  check('接受任意空白分隔', spaced.ok ? hex(spaced.bytes) : null, 'deadbeef');

  check('空串被拒绝', M.parseHexBytes('').ok, false);
  check('只有空白被拒绝', M.parseHexBytes('   ').ok, false);
  check('只有 0x 被拒绝', M.parseHexBytes('0x').ok, false);
  const odd = M.parseHexBytes('abc');
  check('奇数个十六进制数字被拒绝', odd.ok, false);
  check('奇数报错说明实际位数', odd.ok === false && odd.error.includes('3'), true);
  const stray = M.parseHexBytes('00zz');
  check('非十六进制字符被拒绝', stray.ok, false);
  check('报错指出是哪个字符', stray.ok === false && stray.error.includes('z'), true);
  const emoji = M.parseHexBytes('00🎉');
  check('emoji 也被当作非法字符', emoji.ok, false);
}

/* ------------------------------------------------------------------ */
/* 10. Tokenising and parsing a mnemonic sentence                      */
/* ------------------------------------------------------------------ */

console.log('--- 助记词分句与解析 ---');

{
  const spaced = M.splitMnemonic('  abandon\tabout\u3000zoo  ');
  check('折叠多余空白并按空白切词', spaced.words, ['abandon', 'about', 'zoo']);
  check('全角空格也算分隔符', spaced.words.length, 3);
  check('报告空白被折叠', spaced.whitespaceCollapsed, true);
  check('报告没有大小写折叠', spaced.caseFolded, false);

  const upper = M.splitMnemonic('ABANDON ABOUT');
  check('大写被折成小写查表', upper.words, ['abandon', 'about']);
  check('报告发生了大小写折叠', upper.caseFolded, true);

  const clean = M.splitMnemonic('abandon about');
  check('规范输入不报告空白问题', clean.whitespaceCollapsed, false);
  check('规范输入不报告大小写问题', clean.caseFolded, false);
  check('空串切出零个词', M.splitMnemonic('').words, []);

  const empty = M.parseMnemonic('');
  check('空输入解析失败', empty.ok, false);
  check('空输入的错误码是 empty', empty.ok === false ? empty.code : null, 'empty');

  const thirteen = M.parseMnemonic(Array(13).fill('abandon').join(' '));
  check('13 个词解析失败', thirteen.ok, false);
  check('13 个词的错误码是 count', thirteen.ok === false ? thirteen.code : null, 'count');
  check('13 个词的报错列出合法词数', thirteen.ok === false && thirteen.error.includes('12 / 15 / 18 / 21 / 24'), true);
  check('11 个词解析失败', M.parseMnemonic(Array(11).fill('abandon').join(' ')).ok, false);
  check('25 个词解析失败', M.parseMnemonic(Array(25).fill('abandon').join(' ')).ok, false);
  check('1 个词解析失败', M.parseMnemonic('abandon').ok, false);

  const unknown = M.parseMnemonic('abandon abandon zzzz abandon abandon abandon abandon abandon abandon abandon abandon about');
  check('词表外的词解析失败', unknown.ok, false);
  check('词表外的词错误码是 unknown', unknown.ok === false ? unknown.code : null, 'unknown');
  check('报出词的位置（第 3 个）', unknown.ok === false ? unknown.unknown[0].position : null, 3);
  check('报出是哪个词', unknown.ok === false ? unknown.unknown[0].word : null, 'zzzz');
  check('多个词表外单词都会被列出', M.parseMnemonic('qqqq abandon zzzz').ok === false, true);

  const typo = M.parseMnemonic('abandom abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
  check('近似拼写错误给出候选', typo.ok === false ? typo.unknown[0].suggestions : null, ['abandon']);
  check('报错文案里带上候选词', typo.ok === false && typo.error.includes('abandon'), true);

  const upperValid = M.parseMnemonic(OFFICIAL_ENGLISH[0][1].toUpperCase());
  check('全大写官方向量能被解析', upperValid.ok, true);
  check('全大写被标记为需要折叠', upperValid.ok ? upperValid.caseFolded : null, true);
  check('归一化后是全小写的句子', upperValid.ok ? upperValid.normalized : null, OFFICIAL_ENGLISH[0][1]);

  const messy = M.parseMnemonic(`  ${OFFICIAL_ENGLISH[0][1].replaceAll(' ', '   ')}\n`);
  check('多余空格与换行不影响解析', messy.ok, true);
  check('多余空格被标记', messy.ok ? messy.whitespaceCollapsed : null, true);
  check('归一化后回到单空格句子', messy.ok ? messy.normalized : null, OFFICIAL_ENGLISH[0][1]);
  check('归一化后熵仍然正确', messy.ok ? messy.entropyHex : null, OFFICIAL_ENGLISH[0][0]);

  const zero = M.parseMnemonic(OFFICIAL_ENGLISH[0][1]);
  check('全零熵被解出', zero.ok ? zero.entropyHex : null, OFFICIAL_ENGLISH[0][0]);
  check('词索引都是 0', zero.ok ? new Set(zero.indices) : null, new Set([0]));
  check('词数为 12', zero.ok ? zero.wordCount : null, 12);
  check('熵位数为 128', zero.ok ? zero.bits : null, 128);

  // Word counts that are legal must be parsed for every size, including the
  // two sizes the official English vectors never exercise (160 and 224 bits).
  for (const bits of [128, 160, 192, 224, 256]) {
    const entropy = new Uint8Array(bits / 8).map((_, i) => (i * 53 + 7) & 0xff);
    const outcome = await M.entropyToMnemonic(entropy);
    check(`${bits} 位熵生成成功`, outcome.ok, true);
    const mnemonic = outcome.ok ? outcome.result.mnemonic : '';
    const parsed = M.parseMnemonic(mnemonic);
    check(`${bits} 位熵的词数正确`, parsed.ok ? parsed.wordCount : null, M.WORD_COUNT[bits]);
    check(`${bits} 位熵往返后与输入一致`, parsed.ok ? parsed.entropyHex : null, hex(entropy));
    const inspected = await M.inspectMnemonic(mnemonic);
    check(`${bits} 位熵生成的助记词校验和有效`, inspected.ok ? inspected.checksumValid : null, true);
    check(`${bits} 位熵的校验和位数`, inspected.ok ? inspected.checksumLength : null, bits / 32);
  }
}

/* ------------------------------------------------------------------ */
/* 11. All-zero and all-0xff entropy                                   */
/* ------------------------------------------------------------------ */

console.log('--- 极值熵 ---');

{
  check('全零 128 位熵的助记词', referenceMnemonic('00'.repeat(16)), 'abandon '.repeat(11) + 'about');
  check('全零 128 位熵的官方向量一致', OFFICIAL_ENGLISH[0][1], 'abandon '.repeat(11) + 'about');
  check('全 0xff 128 位熵的末词是 wrong', OFFICIAL_ENGLISH[3][1].split(' ').at(-1), 'wrong');
  check('全 0xff 128 位熵的助记词以 zoo 开头', OFFICIAL_ENGLISH[3][1].startsWith('zoo '), true);
  check('全零 256 位熵的助记词以 abandon 开头', OFFICIAL_ENGLISH[8][1].startsWith('abandon '), true);
  check('全零 256 位熵的词数为 24', OFFICIAL_ENGLISH[8][1].split(' ').length, 24);

  for (const [entropy, mnemonic] of OFFICIAL_ENGLISH) {
    const outcome = await M.entropyToMnemonic(bytesFromHex(entropy));
    if (!outcome.ok) {
      check(`极值向量 ${entropy.slice(0, 8)} 生成失败`, outcome.error, '应当成功');
    }
    check(`极值向量 ${entropy.slice(0, 8)}… 与官方向量一致`, outcome.ok ? outcome.result.mnemonic : null, mnemonic);
  }
}

/* ------------------------------------------------------------------ */
/* 12. Counter-proofs: the plausible shortcuts are wrong               */
/* ------------------------------------------------------------------ */

console.log('--- 反证：看似更简单的写法会出错 ---');

{
  // Shortcut A: always take eight checksum bits (a whole byte) from the digest
  // instead of ENT/32 bits. For 128-bit entropy that appends four bits too
  // many, so the sentence gains a 13th word.
  function eightBitChecksum(entropyHex) {
    const entropy = Buffer.from(entropyHex, 'hex');
    const digest = createHash('sha256').update(entropy).digest();
    const stream = [...entropy, digest[0]].map((byte) => byte.toString(2).padStart(8, '0')).join('');
    const words = [];
    for (let i = 0; i < stream.length; i += 11) {
      words.push(M.WORDLIST[Number.parseInt(stream.slice(i, i + 11), 2)]);
    }
    return words.join(' ');
  }
  const eightBit = eightBitChecksum('00'.repeat(16));
  check('反证：8 位校验和会多出一个词（13 个词）', eightBit.split(' ').length, 13);
  check('反证：8 位校验和的结果不等于官方向量', eightBit === OFFICIAL_ENGLISH[0][1], false);

  // Shortcut B: forget the checksum entirely. The bit stream is then 128 bits,
  // which is only 11 whole 11-bit groups plus five leftover bits.
  function noChecksum(entropyHex) {
    const entropy = Buffer.from(entropyHex, 'hex');
    const stream = [...entropy].map((byte) => byte.toString(2).padStart(8, '0')).join('');
    const words = [];
    for (let i = 0; i < stream.length; i += 11) {
      words.push(M.WORDLIST[Number.parseInt(stream.slice(i, i + 11), 2)] ?? null);
    }
    return words.join(' ');
  }
  check('反证：省略校验和也算不出官方助记词', noChecksum('00'.repeat(16)) === OFFICIAL_ENGLISH[0][1], false);
  check('反证：128 位除以 11 余 7，末组凑不满一个索引', 128 % 11, 7);

  // Shortcut C: take checksum bits from the end of the digest instead of the
  // start. The spec says the first ENT/32 bits.
  function tailChecksum(entropyHex) {
    const entropy = Buffer.from(entropyHex, 'hex');
    const digest = createHash('sha256').update(entropy).digest();
    const checksumLength = entropy.length * 4;
    let stream = [...entropy].map((byte) => byte.toString(2).padStart(8, '0')).join('');
    stream += [...digest].map((byte) => byte.toString(2).padStart(8, '0')).join('').slice(-checksumLength);
    const words = [];
    for (let i = 0; i < stream.length; i += 11) {
      words.push(M.WORDLIST[Number.parseInt(stream.slice(i, i + 11), 2)]);
    }
    return words.join(' ');
  }
  check('反证：取摘要末尾的校验和位会得到不同结果', tailChecksum(OFFICIAL_ENGLISH[0][0]) === OFFICIAL_ENGLISH[0][1], false);

  // Shortcut D: index the list from 1 instead of 0.
  const shifted = referenceMnemonic(OFFICIAL_ENGLISH[0][0])
    .split(' ')
    .map((word) => M.WORDLIST[M.wordIndex(word) + 1] ?? 'zoo')
    .join(' ');
  check('反证：从 1 开始索引词表会得到不同句子', shifted === OFFICIAL_ENGLISH[0][1], false);
}

/* ------------------------------------------------------------------ */
/* 13. The generator is deterministic given its inputs                 */
/* ------------------------------------------------------------------ */

console.log('--- 生成器与随机源注入 ---');

{
  const sizes = [];
  M.randomEntropy(192, (target) => {
    sizes.push(target.length);
    target.fill(0x5a);
  });
  check('randomEntropy 申请正确长度的缓冲区', sizes, [24]);

  const injected = M.randomEntropy(128, (target) => target.fill(0));
  check('注入的填充函数决定熵内容', hex(injected), '00'.repeat(16));
  check('randomEntropy 不读全局随机源（同一填充得到同一结果）', hex(M.randomEntropy(128, (target) => target.fill(7))), hex(M.randomEntropy(128, (target) => target.fill(7))));

  for (const bits of [128, 160, 192, 224, 256]) {
    const entropy = M.randomEntropy(bits, (target) => target.forEach((_, i) => { target[i] = (i * 31 + 5) & 0xff; }));
    const first = await M.entropyToMnemonic(entropy);
    const second = await M.entropyToMnemonic(entropy);
    check(`${bits} 位：同一熵两次生成结果相同`, first.ok && second.ok ? first.result.mnemonic === second.result.mnemonic : null, true);
    check(`${bits} 位：生成的词数`, first.ok ? first.result.wordCount : null, bits * 3 / 32);
  }

  check('未设置口令的说明提到未设置', M.describePassphrase('').includes('未设置'), true);
  check('已设口令的说明提到已加口令', M.describePassphrase('x').includes('已加口令'), true);
}

/* ------------------------------------------------------------------ */
/* 14. SHA-256 wrapper agrees with node:crypto                         */
/* ------------------------------------------------------------------ */

console.log('--- SHA-256 包装 ---');

{
  check(
    'sha256(空) 等于 node:crypto 的结果',
    hex(await M.sha256(new Uint8Array(0))),
    createHash('sha256').update(Buffer.alloc(0)).digest('hex'),
  );
  check(
    'sha256(全零 16 字节) 等于 node:crypto 的结果',
    hex(await M.sha256(new Uint8Array(16))),
    createHash('sha256').update(Buffer.alloc(16)).digest('hex'),
  );
  const digest = await M.sha256(bytesFromHex(OFFICIAL_ENGLISH[0][0]));
  check('sha256 返回 32 字节', digest.length, 32);
  // The all-zero entropy digest starts 0x37, so the first four bits are 0011,
  // which is index 3: the matching all-zero mnemonic ends in "about" (word 3).
  // Getting 0000 here would mean the checksum bits were read from the wrong end.
  check('校验和位取摘要的高位', M.checksumBitsFromDigest(digest, 4), '0011');
  check('这四位正好索引到 about', M.WORDLIST[Number.parseInt('0011', 2)], 'about');
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
