import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Card,
  Divider,
  MessageBar,
  MessageBarBody,
  Switch,
  Tab,
  TabList,
  Text,
  makeStyles,
  tokens,
  Toast,
  ToastTitle,
  Toaster,
  useId,
  useToastController,
  type SelectTabData,
} from '@fluentui/react-components';
import {
  Checkmark16Regular,
  Copy16Regular,
  MailRegular,
  ShieldTask16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  DISPOSABLE_EMAIL_DOMAINS,
  FREE_EMAIL_DOMAINS,
  LOCAL_DOT,
  LOCAL_SPECIALS,
  RULE_SUMMARY,
  normaliseBatch,
  normaliseEmail,
  parseEmail,
  type NormaliseOptions,
} from './emailNormalizerUtils';

const MONO = "'Cascadia Code', 'Cascadia Mono', Consolas, 'SF Mono', Menlo, monospace";

const EXAMPLES = [
  'first.last+tag@gmail.com',
  'User@EXAMPLE.com',
  'user@münchen.de',
  '用户@例え.jp',
  'user@mailinator.com',
  'user@[192.168.1.1]',
  'bad@@address',
];

const BATCH_PLACEHOLDER = [
  'alice@Example.com',
  'Alice <alice@example.com>',
  'first.last+news@gmail.com',
  'user@münchen.de',
  'throwaway@mailinator.com',
].join('\n');

const KIND_LABEL: Record<string, string> = {
  free: '免费邮箱',
  disposable: '一次性邮箱',
  'disposable+free': '一次性且免费',
  other: '其它（自有域名或未被列表收录）',
};

const useStyles = makeStyles({
  column: {
    flexDirection: 'column',
  },
  stack: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  inputRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
    padding: '14px 14px 10px',
  },
  input: {
    flex: '1 1 280px',
    minWidth: '240px',
    fontFamily: MONO,
    fontSize: '15px',
  },
  examples: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    padding: '0 14px 12px',
  },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: '9px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  rowLabel: {
    flex: 'none',
    width: '170px',
    color: tokens.colorNeutralForeground3,
    paddingTop: '2px',
  },
  rowValue: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: MONO,
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  caption: {
    color: tokens.colorNeutralForeground3,
  },
  rules: {
    padding: '12px 14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    color: tokens.colorNeutralForeground2,
  },
  switchRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '18px',
    padding: '12px 14px',
    alignItems: 'flex-start',
  },
  switchHint: {
    display: 'block',
    color: tokens.colorNeutralForeground3,
    maxWidth: '360px',
    marginTop: '2px',
  },
  batchArea: {
    width: '100%',
    minHeight: '170px',
    fontVariantNumeric: 'tabular-nums',
  },
  batchTable: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxHeight: '360px',
    overflow: 'auto',
  },
  batchRow: {
    display: 'grid',
    gridTemplateColumns: '48px minmax(0, 1.2fr) minmax(0, 1.2fr) minmax(0, 1fr)',
    gap: '10px',
    padding: '7px 14px',
    alignItems: 'baseline',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    fontFamily: MONO,
    fontSize: '13px',
    ':last-child': { borderBottom: 'none' },
  },
  batchHead: {
    fontWeight: 600,
    color: tokens.colorNeutralForeground3,
    position: 'sticky',
    top: 0,
    backgroundColor: tokens.colorNeutralBackground2,
    zIndex: 1,
  },
  batchCell: {
    overflowWrap: 'anywhere',
    minWidth: 0,
  },
  invalidText: {
    color: tokens.colorPaletteRedForeground1,
  },
  badgeRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    padding: '0 14px 14px',
  },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '8px',
    padding: '14px',
    width: '100%',
  },
  statCard: {
    padding: '10px 12px',
  },
  statValue: {
    fontFamily: MONO,
    fontSize: '20px',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  code: {
    fontFamily: MONO,
    fontSize: '13px',
    overflowWrap: 'anywhere',
  },
});

export function EmailNormalizerTool() {
  const styles = useStyles();
  const toasterId = useId('email-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [tab, setTab] = useState<'single' | 'batch'>('single');
  const [input, setInput] = useState(EXAMPLES[0]);
  const [batchText, setBatchText] = useState(BATCH_PLACEHOLDER);
  const [lowercaseLocal, setLowercaseLocal] = useState(false);
  const [applyGmailRules, setApplyGmailRules] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const options: NormaliseOptions = useMemo(
    () => ({ lowercaseLocal, applyGmailRules }),
    [lowercaseLocal, applyGmailRules],
  );

  const notify = useCallback(
    (title: string, intent: 'success' | 'error' = 'success') => {
      dispatchToast(
        <Toast>
          <ToastTitle>{title}</ToastTitle>
        </Toast>,
        { intent, timeout: 1500 },
      );
    },
    [dispatchToast],
  );

  const copy = useCallback(
    async (key: string, value: string) => {
      const done = await copyText(value);
      if (done) {
        setCopied(key);
        window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);
        notify('已复制');
      } else {
        notify('复制失败，请手动选择', 'error');
      }
    },
    [notify],
  );

  const parsed = useMemo(() => parseEmail(input), [input]);
  const normalised = useMemo(() => normaliseEmail(input, options), [input, options]);
  const batch = useMemo(() => normaliseBatch(batchText, options), [batchText, options]);

  // The ASCII form differs from the Unicode form exactly when the input was an
  // internationalised domain, so this needs no extra field on the result.
  const isIdn =
    normalised.ok && normalised.domainAscii !== normalised.domainUnicode.toLowerCase();

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <section className="wt-surface" aria-label="邮箱规范化">
        <div className="wt-surface__header">
          <MailRegular />
          <Text as="h2" size={300} weight="semibold">
            邮箱规范化与校验
          </Text>
          <Caption1 className={styles.caption} style={{ marginLeft: 'auto' }}>
            规则写在页面上，不用那条“完整 RFC 5322”正则
          </Caption1>
        </div>

        <div className={`wt-surface__body ${styles.column}`}>
          <div className={styles.stack}>
            <div className={styles.inputRow}>
              <input
                className={`wt-inline-input ${styles.input}`}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="粘贴一个邮箱地址"
                aria-label="要规范化与校验的邮箱地址"
                spellCheck={false}
                autoComplete="off"
              />
              <Button appearance="secondary" onClick={() => setInput('')}>
                清空
              </Button>
              <Badge
                appearance="tint"
                color={parsed.ok ? 'success' : 'danger'}
                size="large"
              >
                {parsed.ok ? '格式合法' : '格式不合法'}
              </Badge>
            </div>

            <div className={styles.examples}>
              {EXAMPLES.map((example) => (
                <Button
                  key={example}
                  appearance="subtle"
                  size="small"
                  onClick={() => setInput(example)}
                >
                  {example}
                </Button>
              ))}
            </div>

            <Divider />

            <div className={styles.switchRow}>
              <Switch
                checked={lowercaseLocal}
                onChange={(_, data) => setLowercaseLocal(data.checked)}
                label="本地部分转小写"
                aria-label="是否把本地部分转为小写"
              />
              <Caption1 className={styles.switchHint}>
                RFC 5321 规定 @ 之前的部分<strong>大小写敏感</strong>，理论上
                <code> Alice@example.com</code> 与 <code>alice@example.com</code>
                可以是两个信箱，所以默认不动它。但绝大多数服务商实际都按不区分大小写处理，需要合并时再打开。
              </Caption1>
            </div>

            <div className={styles.switchRow}>
              <Switch
                checked={applyGmailRules}
                onChange={(_, data) => setApplyGmailRules(data.checked)}
                label="套用 Gmail 规则（忽略点号与 + 后缀）"
                aria-label="是否套用 Gmail 的点号与加号后缀规则"
              />
              <Caption1 className={styles.switchHint}>
                只对 gmail.com 与 googlemail.com 成立：<code>first.last+tag@gmail.com</code> 与
                <code> firstlast@gmail.com</code> 是同一个信箱。对其它域名套用会误伤 ——
                很多域名把点号与 + 后缀当真，所以默认关闭。
              </Caption1>
            </div>

            <Divider />

            {!normalised.ok ? (
              <div style={{ padding: '0 14px 14px' }}>
                <MessageBar intent="error">
                  <MessageBarBody>
                    {normalised.message}（错误代码：{normalised.code}）
                  </MessageBarBody>
                </MessageBar>
              </div>
            ) : (
              <div className={styles.stack}>
                <div className={styles.row}>
                  <Text className={styles.rowLabel}>规范化结果</Text>
                  <Text className={styles.rowValue}>{normalised.normalised}</Text>
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={copied === 'normalised' ? <Checkmark16Regular /> : <Copy16Regular />}
                    onClick={() => copy('normalised', normalised.normalised)}
                    aria-label="复制规范化结果"
                  />
                </div>

                <div className={styles.row}>
                  <Text className={styles.rowLabel}>ASCII 形式（可用于 SMTP）</Text>
                  <Text className={styles.rowValue}>{normalised.asciiAddress}</Text>
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={copied === 'ascii' ? <Checkmark16Regular /> : <Copy16Regular />}
                    onClick={() => copy('ascii', normalised.asciiAddress)}
                    aria-label="复制 ASCII 形式"
                  />
                </div>

                <div className={styles.row}>
                  <Text className={styles.rowLabel}>本地部分</Text>
                  <Text className={styles.rowValue}>{normalised.local}</Text>
                </div>

                <div className={styles.row}>
                  <Text className={styles.rowLabel}>域名（ASCII / Punycode）</Text>
                  <Text className={styles.rowValue}>{normalised.domainAscii}</Text>
                </div>

                <div className={styles.row}>
                  <Text className={styles.rowLabel}>域名（Unicode）</Text>
                  <Text className={styles.rowValue}>
                    {normalised.domainUnicode}
                    {isIdn ? '（输入是 IDN，已按 WHATWG URL 标准转换）' : ''}
                  </Text>
                </div>

                <div className={styles.row}>
                  <Text className={styles.rowLabel}>顶级域名（TLD）</Text>
                  <Text className={styles.rowValue}>
                    {normalised.tld || '（地址字面量，无 TLD）'}
                  </Text>
                </div>

                <div className={styles.row}>
                  <Text className={styles.rowLabel}>域名类别</Text>
                  <Text className={styles.rowValue} style={{ fontFamily: 'inherit' }}>
                    {KIND_LABEL[normalised.classification.kind]}
                    {normalised.classification.matchedBySuffix ? '（按子域后缀匹配）' : ''}
                    {normalised.classification.disposableMatch
                      ? ` · 命中一次性列表：${normalised.classification.disposableMatch}`
                      : ''}
                    {normalised.classification.freeMatch
                      ? ` · 命中免费列表：${normalised.classification.freeMatch}`
                      : ''}
                  </Text>
                </div>

                <div className={styles.row}>
                  <Text className={styles.rowLabel}>Gmail 规范化</Text>
                  <Text className={styles.rowValue} style={{ fontFamily: 'inherit' }}>
                    {normalised.gmail.isGmail
                      ? `去点号：${normalised.gmail.withoutDots} · 去 + 后缀：${normalised.gmail.withoutTag} · 规范形式：${normalised.gmail.canonical}`
                      : '不是 Gmail 域名，点号与 + 后缀规则不适用'}
                  </Text>
                </div>

                <div className={styles.row}>
                  <Text className={styles.rowLabel}>改动</Text>
                  <Text className={styles.rowValue} style={{ fontFamily: 'inherit' }}>
                    {normalised.changed
                      ? normalised.changes.join('；')
                      : normalised.changes.length > 0
                        ? `没有改动（提示：${normalised.changes.join('；')}）`
                        : '没有改动'}
                  </Text>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="wt-surface" aria-label="批量处理">
        <div className="wt-surface__header">
          <MailRegular />
          <Text as="h2" size={300} weight="semibold">
            批量模式
          </Text>
          <TabList
            size="small"
            selectedValue={tab}
            onTabSelect={(_, data: SelectTabData) => setTab(data.value as 'single' | 'batch')}
            style={{ marginLeft: 'auto' }}
          >
            <Tab value="single">单条</Tab>
            <Tab value="batch">批量</Tab>
          </TabList>
        </div>

        <div className={`wt-surface__body ${styles.column}`}>
          {tab === 'batch' && (
            <>
              <textarea
                className={`wt-code-area ${styles.batchArea}`}
                value={batchText}
                onChange={(event) => setBatchText(event.target.value)}
                placeholder="每行一个地址；空行会被跳过，带「名字 <地址>」的写法会自动剥掉名字"
                aria-label="批量邮箱地址，每行一个"
                spellCheck={false}
              />
              <Divider />
            </>
          )}

          <div className={styles.stats}>
            <Card className={styles.statCard}>
              <Caption1 className={styles.caption}>有效 / 总数</Caption1>
              <Text className={styles.statValue}>
                {batch.valid} / {batch.total}
              </Text>
            </Card>
            <Card className={styles.statCard}>
              <Caption1 className={styles.caption}>不合法</Caption1>
              <Text className={styles.statValue}>{batch.invalid}</Text>
            </Card>
            <Card className={styles.statCard}>
              <Caption1 className={styles.caption}>唯一地址</Caption1>
              <Text className={styles.statValue}>{batch.uniqueNormalised}</Text>
            </Card>
            <Card className={styles.statCard}>
              <Caption1 className={styles.caption}>重复</Caption1>
              <Text className={styles.statValue}>{batch.duplicates.length}</Text>
            </Card>
            <Card className={styles.statCard}>
              <Caption1 className={styles.caption}>免费邮箱</Caption1>
              <Text className={styles.statValue}>{batch.free}</Text>
            </Card>
            <Card className={styles.statCard}>
              <Caption1 className={styles.caption}>一次性邮箱</Caption1>
              <Text className={styles.statValue}>{batch.disposable}</Text>
            </Card>
          </div>

          {batch.duplicates.length > 0 && (
            <div className={styles.badgeRow}>
              <Caption1 className={styles.caption}>重复：</Caption1>
              {batch.duplicates.map((item) => (
                <Badge key={item} appearance="tint" color="warning" size="small">
                  {item}
                </Badge>
              ))}
            </div>
          )}

          <div className={styles.batchTable}>
            <div className={`${styles.batchRow} ${styles.batchHead}`}>
              <Text>行</Text>
              <Text>原始输入</Text>
              <Text>规范化结果</Text>
              <Text>说明</Text>
            </div>
            {batch.rows.map((row) => (
              <div key={`${row.line}-${row.input}`} className={styles.batchRow}>
                <Text className={styles.batchCell}>{row.line}</Text>
                <Text className={styles.batchCell}>{row.input}</Text>
                {row.result.ok ? (
                  <Text className={styles.batchCell}>{row.result.normalised}</Text>
                ) : (
                  <Text className={styles.invalidText}>—</Text>
                )}
                <Text className={styles.batchCell}>
                  {row.result.ok
                    ? [
                        row.result.classification.isDisposable ? '一次性' : '',
                        row.result.classification.isFree ? '免费' : '',
                        row.result.gmail.isGmail ? 'Gmail' : '',
                        row.result.changed ? '已改动' : '',
                      ]
                        .filter(Boolean)
                        .join(' · ') || '正常'
                    : row.result.message}
                </Text>
              </div>
            ))}
          </div>

          <div className={styles.inputRow}>
            <Button
              appearance="secondary"
              icon={copied === 'batch' ? <Checkmark16Regular /> : <Copy16Regular />}
              onClick={() =>
                copy(
                  'batch',
                  batch.rows
                    .map((row) => (row.result.ok ? row.result.normalised : `# ${row.input}`))
                    .join('\n'),
                )
              }
              disabled={batch.rows.length === 0}
            >
              复制规范化结果
            </Button>
            <Caption1 className={styles.caption}>
              无效行以 # 开头复制，方便回原表核对。
            </Caption1>
          </div>
        </div>
      </section>

      <section className="wt-surface" aria-label="校验规则">
        <div className="wt-surface__header">
          <ShieldTask16Regular />
          <Text as="h2" size={300} weight="semibold">
            采用的规则（就是这些，没有隐藏的正则）
          </Text>
        </div>
        <div className={`wt-surface__body ${styles.column}`}>
          <div className={styles.rules}>
            {RULE_SUMMARY.map((rule) => (
              <Text key={rule}>· {rule}</Text>
            ))}
            <Divider />
            <Text>
              本地部分允许的特殊字符：<span className={styles.code}>{LOCAL_SPECIALS}</span>
              ，外加分隔符 <span className={styles.code}>{LOCAL_DOT}</span>
              （共 20 个 ASCII 符号）。非 ASCII 字符按 Unicode 类别判断：字母、组合标记、数字可以，emoji
              与标点不可以。
            </Text>
            <Text>
              为什么不用那条著名的“完整 RFC 5322 正则”：它会把 <span className={styles.code}>a@b.c</span>
              （TLD 只有 1 个字符）、<span className={styles.code}>a@example.123</span>
              （纯数字 TLD）判为合法，去掉锚点后还会把一整串 <span className={styles.code}>
              a@x.com, b@y.com</span> 当成一个地址；反过来它又会拒绝
              <span className={styles.code}> user@[192.168.1.1]</span>、
              <span className={styles.code}> user@例え.jp</span> 这些真实存在的写法。检查脚本里把它作为反证跑了。
            </Text>
            <Text>
              免费邮箱列表内置 {FREE_EMAIL_DOMAINS.length} 个常见域名，一次性邮箱列表内置{' '}
              {DISPOSABLE_EMAIL_DOMAINS.length} 个 —— 后者<strong>明确不完整</strong>
              ：一次性域名每月新增与停用都以千计，静态列表只能覆盖最常见的那些，真要拦截需要持续维护的订阅源。
            </Text>
            <Text>
              本工具能说的只有“格式与域名写法合法”。它不验证邮箱是否真实存在（需要 SMTP 会话，而且
              catch-all 域名连 RCPT TO 都会撒谎），也不做 MX 查询（需要联网），因此校验通过不代表能收到信。
            </Text>
          </div>
        </div>
      </section>
    </>
  );
}
