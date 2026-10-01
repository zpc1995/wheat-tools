import {
  Badge,
  Button,
  Caption1,
  Dropdown,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  Switch,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowSwap16Regular,
  Checkmark16Regular,
  Code16Regular,
  Copy16Regular,
  Key16Regular,
  LockClosed16Regular,
  ShieldError16Regular,
} from '@fluentui/react-icons';
import { useCallback, useMemo, useState } from 'react';
import {
  buildCurlCommands,
  buildFetchSnippet,
  buildNodeSnippet,
  bytesToHex,
  encodeBasicAuth,
  parseAuthorizationHeader,
  type Charset,
  type EncodeIssue,
  type ParseIssue,
} from './basicAuthUtils';

const CHARSETS: Array<{ value: Charset; label: string; short: string; note: string }> = [
  {
    value: 'utf-8',
    label: 'UTF-8（推荐，绝大多数服务）',
    short: 'UTF-8',
    note: '把凭据按 UTF-8 转成字节再 Base64。非 ASCII 用户名/密码在现代服务上基本都按这个解释。',
  },
  {
    value: 'iso-8859-1',
    label: 'ISO-8859-1（老服务，RFC 的历史默认）',
    short: 'ISO-8859-1',
    note: '每个字符一个字节。只能表示 U+0000–U+00FF，中文等字符无法编码，会直接报错而不是悄悄丢字。',
  },
];

const ENCODE_ISSUE_TEXT: Record<EncodeIssue, string> = {
  'colon-in-username': '用户名里不能有冒号：RFC 7617 规定第一个冒号分隔用户名与密码，含冒号的用户名无法表示。',
  'latin1-unrepresentable': 'ISO-8859-1 无法表示凭据中的某些字符（如中文、emoji），请改用 UTF-8。',
  'control-characters': '凭据里含控制字符（RFC 7617 明确禁止 user-id 与 password 出现控制字符）。',
  'empty-username': '用户名为空。RFC 7617 没有禁止，但多数服务会拒绝。',
  'empty-password': '密码为空。RFC 7617 没有禁止，但多数服务会拒绝。',
  'non-ascii': '凭据含非 ASCII 字符：能否登录取决于服务端按哪种编码解释这些字节。',
};

const PARSE_ISSUE_TEXT: Record<ParseIssue, string> = {
  empty: '请输入 Authorization 头或 Base64 令牌。',
  'unknown-scheme': '这不是 Basic 认证。本工具只处理 Basic，不处理 Digest（RFC 7616）等方案。',
  'invalid-base64': 'Base64 部分无效：含有非法字符，或长度不可能是 Base64。',
  'missing-colon': '解出的文本里没有冒号，不是合法的 user-pass 字符串。',
};

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    minWidth: 0,
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '14px 16px',
    minWidth: 0,
  },
  form: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '12px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: 0,
  },
  label: {
    color: tokens.colorNeutralForeground3,
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px 14px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  codeBlock: {
    padding: '10px 12px',
    borderRadius: '6px',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    backgroundColor: tokens.colorNeutralBackground2,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
    lineHeight: 1.65,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    userSelect: 'text',
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  facts: {
    display: 'grid',
    gridTemplateColumns: 'minmax(112px, max-content) minmax(0, 1fr)',
    rowGap: '6px',
    columnGap: '16px',
    alignItems: 'baseline',
  },
  factLabel: {
    color: tokens.colorNeutralForeground3,
  },
  notes: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    margin: 0,
    paddingLeft: '22px',
  },
  note: {
    color: tokens.colorNeutralForeground2,
    lineHeight: 1.7,
  },
});

const DEFAULT_URL = 'https://example.com/';

export function BasicAuthTool() {
  const styles = useStyles();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [charset, setCharset] = useState<Charset>('utf-8');
  const [target, setTarget] = useState(DEFAULT_URL);
  const [reveal, setReveal] = useState(false);
  const [headerInput, setHeaderInput] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const built = useMemo(
    () => encodeBasicAuth(username, password, { charset }),
    [charset, password, username],
  );
  const parsed = useMemo(() => parseAuthorizationHeader(headerInput), [headerInput]);
  const curl = useMemo(
    () => buildCurlCommands(username, password, target, { charset }),
    [charset, password, target, username],
  );
  const fetchSnippet = useMemo(
    () => buildFetchSnippet(username, password, target, { charset }),
    [charset, password, target, username],
  );
  const nodeSnippet = useMemo(() => buildNodeSnippet(username, password), [password, username]);

  const activeCharset = CHARSETS.find((item) => item.value === charset) ?? CHARSETS[0];

  const copy = useCallback(async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      // Clipboard access can be denied; not claiming a copy is the honest result.
      setCopied(null);
    }
  }, []);

  const copyIcon = (key: string) => (copied === key ? <Checkmark16Regular /> : <Copy16Regular />);

  /** Pushes a parsed header back into the form, charset guess included. */
  const adoptParsed = useCallback(() => {
    if (!parsed.ok || parsed.username === null) return;
    setUsername(parsed.username);
    setPassword(parsed.password ?? '');
    if (parsed.byteEncoding === 'iso-8859-1') setCharset('iso-8859-1');
  }, [parsed]);

  return (
    <div className={styles.stack}>
      <section className="wt-surface" aria-label="生成认证头">
        <div className="wt-surface__header">
          <Key16Regular />
          <Text as="h2" size={300} weight="semibold">
            凭据 → Authorization 头
          </Text>
          <span className={styles.spacer} />
          <Caption1 className={styles.hint}>{'Base64(user-id ":" password)，RFC 7617'}</Caption1>
        </div>
        <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
          <div className={styles.body}>
            <div className={styles.form}>
              <label className={styles.field}>
                <Text size={200} className={styles.label}>
                  用户名（user-id，不能含冒号）
                </Text>
                <input
                  className="wt-inline-input"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  aria-label="用户名"
                  placeholder="Aladdin"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <label className={styles.field}>
                <Text size={200} className={styles.label}>
                  密码（password，可以含冒号）
                </Text>
                <input
                  className="wt-inline-input"
                  type={reveal ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-label="密码"
                  placeholder="open sesame"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
            </div>

            <div className={styles.toolbar}>
              <Switch
                checked={reveal}
                onChange={(_, data) => setReveal(data.checked)}
                label="显示密码"
              />
              <Dropdown
                style={{ minWidth: 260 }}
                value={activeCharset.label}
                selectedOptions={[charset]}
                onOptionSelect={(_, data) => setCharset(data.optionValue as Charset)}
                aria-label="字符编码"
              >
                {CHARSETS.map((item) => (
                  <Option key={item.value} value={item.value} text={item.label}>
                    {item.label}
                  </Option>
                ))}
              </Dropdown>
              <label className={styles.field} style={{ flex: '1 1 260px' }}>
                <Text size={200} className={styles.label}>
                  目标地址（只用于下面的代码片段）
                </Text>
                <input
                  className="wt-inline-input"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  aria-label="目标地址"
                  placeholder={DEFAULT_URL}
                  spellCheck={false}
                />
              </label>
            </div>

            {built.errors.map((issue) => (
              <MessageBar key={issue} intent="error">
                <MessageBarBody>
                  <MessageBarTitle>无法生成有效的认证头</MessageBarTitle>
                  {ENCODE_ISSUE_TEXT[issue]}
                </MessageBarBody>
              </MessageBar>
            ))}
            {built.warnings.map((issue) => (
              <MessageBar key={issue} intent="warning">
                <MessageBarBody>{ENCODE_ISSUE_TEXT[issue]}</MessageBarBody>
              </MessageBar>
            ))}

            <div className={styles.toolbar}>
              <Badge appearance="tint" color={built.ok ? 'brand' : 'danger'} size="small">
                {built.header ? 'Authorization 头' : '无法编码'}
              </Badge>
              <span className={styles.spacer} />
              <Tooltip content="复制认证头" relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={copyIcon('header')}
                  onClick={() => copy(built.header, 'header')}
                  disabled={!built.header}
                  aria-label="复制认证头"
                >
                  复制
                </Button>
              </Tooltip>
            </div>
            <div className={styles.codeBlock}>{built.header || '（没有可输出的内容）'}</div>

            <div className={styles.facts}>
              <Text size={200} className={styles.factLabel}>
                Base64 令牌
              </Text>
              <span className={styles.mono}>{built.base64 || '—'}</span>
              <Text size={200} className={styles.factLabel}>
                编码方式
              </Text>
              <span className={styles.mono}>{activeCharset.short}</span>
              <Text size={200} className={styles.factLabel}>
                字节数
              </Text>
              <span className={styles.mono}>{built.bytes.length}</span>
              <Text size={200} className={styles.factLabel}>
                字节（十六进制）
              </Text>
              <span className={styles.mono}>{bytesToHex(built.bytes) || '—'}</span>
            </div>

            <MessageBar intent="info">
              <MessageBarBody>
                <MessageBarTitle>charset 歧义：这是本工具最需要你知道的一件事</MessageBarTitle>
                RFC 7617 第 2 节把 user-pass 的字符编码<strong>留作未定义</strong>（原文：多数实现选择
                ISO-8859-1 或 UTF-8 这类本地编码），只在服务端的{' '}
                <code>WWW-Authenticate</code> 挑战里定义了一个可选的{' '}
                <code>charset=&quot;UTF-8&quot;</code>，而且它只是建议。授权请求本身不能带 charset
                参数（凭据是单一 token68，不可扩展），所以客户端只能猜：
                <strong>现代服务几乎都按 UTF-8 解码</strong>，只有老服务可能按 ISO-8859-1/本地编码。
                登录失败或出现乱码时，切换编码再看一次。{activeCharset.note}
              </MessageBarBody>
            </MessageBar>
          </div>
        </div>
      </section>

      <section className="wt-surface" aria-label="解析认证头">
        <div className="wt-surface__header">
          <LockClosed16Regular />
          <Text as="h2" size={300} weight="semibold">
            粘贴认证头 → 凭据
          </Text>
          <span className={styles.spacer} />
          <Caption1 className={styles.hint}>接受完整头、Basic 令牌或裸 Base64</Caption1>
        </div>
        <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
          <div className={styles.body}>
            <input
              className="wt-inline-input"
              value={headerInput}
              onChange={(event) => setHeaderInput(event.target.value)}
              aria-label="认证头输入"
              placeholder="Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=="
              spellCheck={false}
              autoComplete="off"
            />

            {headerInput.trim() !== '' && !parsed.ok && (
              <MessageBar intent="error">
                <MessageBarBody>{PARSE_ISSUE_TEXT[parsed.issue ?? 'empty']}</MessageBarBody>
              </MessageBar>
            )}

            {headerInput.trim() !== '' && parsed.ok && (
              <>
                <div className={styles.facts}>
                  <Text size={200} className={styles.factLabel}>
                    方案
                  </Text>
                  <span className={styles.mono}>{parsed.scheme ?? '(未写，按 Basic 处理)'}</span>
                  <Text size={200} className={styles.factLabel}>
                    用户名
                  </Text>
                  <span className={styles.mono}>{parsed.username}</span>
                  <Text size={200} className={styles.factLabel}>
                    密码
                  </Text>
                  <span className={styles.mono}>{parsed.password}</span>
                  <Text size={200} className={styles.factLabel}>
                    解码字节的猜测
                  </Text>
                  <span className={styles.mono}>
                    {parsed.byteEncoding === 'utf-8' ? 'UTF-8' : 'ISO-8859-1（不是合法 UTF-8）'}
                    {parsed.asciiOnly ? ' · 纯 ASCII，两种编码结果相同' : ''}
                  </span>
                  <Text size={200} className={styles.factLabel}>
                    字节（十六进制）
                  </Text>
                  <span className={styles.mono}>{bytesToHex(parsed.bytes)}</span>
                </div>

                {parsed.hasControlCharacters && (
                  <MessageBar intent="warning">
                    <MessageBarBody>解出的凭据含控制字符，RFC 7617 禁止在 user-id 与密码中出现。</MessageBarBody>
                  </MessageBar>
                )}

                {!parsed.asciiOnly && (
                  <Caption1 className={styles.hint}>
                    头里只有字节，没有编码信息。这里的判断规则是：字节是合法 UTF-8 就按
                    UTF-8 解释，否则退回 ISO-8859-1。如果发件人用 ISO-8859-1
                    编码的字节恰好也是合法 UTF-8（例如 Latin-1 的 &quot;Ã©&quot; 就是 UTF-8 的
                    &quot;é&quot;），任何工具都无法分辨——这不是本工具的缺陷，是协议本身没有携带这个信息。
                  </Caption1>
                )}

                <div className={styles.toolbar}>
                  <Button
                    appearance="secondary"
                    icon={<ArrowSwap16Regular />}
                    onClick={adoptParsed}
                  >
                    把用户名与密码填到上方
                  </Button>
                  {parsed.byteEncoding === 'iso-8859-1' && (
                    <Caption1 className={styles.hint}>将同时把上方编码切换为 ISO-8859-1</Caption1>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="wt-surface" aria-label="命令行片段">
        <div className="wt-surface__header">
          <Code16Regular />
          <Text as="h2" size={300} weight="semibold">
            curl 命令
          </Text>
          <span className={styles.spacer} />
          <Caption1 className={styles.hint}>两种写法并不等价</Caption1>
        </div>
        <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
          <div className={styles.body}>
            <div className={styles.toolbar}>
              <Text size={200} weight="semibold">
                {`--user（由 curl 自己编码；只有当服务端按 ${activeCharset.short} 解释时才对）`}
              </Text>
              <span className={styles.spacer} />
              <Tooltip content="复制命令" relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={copyIcon('curl-user')}
                  onClick={() => copy(curl.userFlag, 'curl-user')}
                  aria-label="复制 curl --user 命令"
                />
              </Tooltip>
            </div>
            <div className={styles.codeBlock}>{curl.userFlag}</div>

            {curl.headerFlag ? (
              <>
                <div className={styles.toolbar}>
                  <Text size={200} weight="semibold">
                    --header（字节已在本页确定，不依赖 shell 的编码）
                  </Text>
                  <span className={styles.spacer} />
                  <Tooltip content="复制命令" relationship="label" withArrow>
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={copyIcon('curl-header')}
                      onClick={() => copy(curl.headerFlag, 'curl-header')}
                      aria-label="复制 curl --header 命令"
                    />
                  </Tooltip>
                </div>
                <div className={styles.codeBlock}>{curl.headerFlag}</div>
              </>
            ) : (
              <Caption1 className={styles.hint}>
                当前凭据在该编码下无法表示，因此没有 --header 形式。
              </Caption1>
            )}
          </div>
        </div>
      </section>

      <section className="wt-surface" aria-label="代码片段">
        <div className="wt-surface__header">
          <Code16Regular />
          <Text as="h2" size={300} weight="semibold">
            fetch / Node 代码片段
          </Text>
          <span className={styles.spacer} />
          <Caption1 className={styles.hint}>非 ASCII 凭据必须先把字符转成字节</Caption1>
        </div>
        <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
          <div className={styles.body}>
            <div className={styles.toolbar}>
              <Text size={200} weight="semibold">
                浏览器 fetch
              </Text>
              <span className={styles.spacer} />
              <Tooltip content="复制片段" relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={copyIcon('fetch')}
                  onClick={() => copy(fetchSnippet, 'fetch')}
                  aria-label="复制 fetch 片段"
                />
              </Tooltip>
            </div>
            <div className={styles.codeBlock}>{fetchSnippet}</div>

            <div className={styles.toolbar}>
              <Text size={200} weight="semibold">
                Node
              </Text>
              <span className={styles.spacer} />
              <Tooltip content="复制片段" relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={copyIcon('node')}
                  onClick={() => copy(nodeSnippet, 'node')}
                  aria-label="复制 Node 片段"
                />
              </Tooltip>
            </div>
            <div className={styles.codeBlock}>{nodeSnippet}</div>

            <Caption1 className={styles.hint}>
              <code>btoa(&quot;中文&quot;)</code> 会抛
              InvalidCharacterError —— 它只接受每个字符一字节的字符串，所以上面先把凭据转成字节再逐字节拼成
              Latin-1 字符串。浏览器里直接对非 ASCII 用 btoa 是最常见的一个坑。
            </Caption1>
          </div>
        </div>
      </section>

      <section className="wt-surface" aria-label="安全提示">
        <div className="wt-surface__header">
          <ShieldError16Regular />
          <Text as="h2" size={300} weight="semibold">
            安全提示
          </Text>
          <span className={styles.spacer} />
          <Caption1 className={styles.hint}>RFC 7617 第 1 与第 4 节</Caption1>
        </div>
        <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
          <div className={styles.body}>
            <MessageBar intent="warning">
              <MessageBarBody>
                <MessageBarTitle>Base64 不是加密，Basic 认证不是安全方案</MessageBarTitle>
                任何人拿到这个头（网络中间人、日志、代理、开发者工具、错误上报）都能立刻还原出用户名和密码——
                解码不需要密钥。RFC 7617 的原话是：该方案会把密码以明文形式在物理网络上传输，
                <strong>除非配合 TLS 之类的机制，否则不应使用</strong>。
              </MessageBarBody>
            </MessageBar>
            <ul className={styles.notes}>
              <li className={styles.note}>
                <strong>必须配 HTTPS。</strong>没有 TLS 时，Base64 只是让密码看起来不像密码，
                对攻击者毫无阻碍。
              </li>
              <li className={styles.note}>
                <strong>不要放进 URL。</strong>
                <code>https://user:pass@host/</code> 这种写法会出现在浏览器历史、Referer、代理与服务器访问日志里。
                请只放在 <code>Authorization</code> 请求头中。
              </li>
              <li className={styles.note}>
                <strong>注意 401 挑战的陷阱。</strong>
                服务端会先回 <code>401</code> 与 <code>WWW-Authenticate: Basic realm=&quot;…&quot;</code>，
                凭据随后按 realm（protection space）复用；伪造的服务器也能发同样的挑战来骗取密码。
              </li>
              <li className={styles.note}>
                <strong>本工具明确不做的事：</strong>
                不生成 Digest 认证（RFC 7616，那是另一套方案，需要 nonce 与哈希）；
                不发起任何网络请求（没有 fetch、没有 XHR，凭据只留在页面里）；
                不保存、不上传、不写 localStorage。刷新页面即清空。
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
