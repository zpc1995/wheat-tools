import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Checkbox,
  Divider,
  MessageBar,
  MessageBarBody,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  Checkmark16Regular,
  Copy16Regular,
  EraserRegular,
  Link16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  FIELD_ORDER,
  analyzeUrl,
  removeTrackingParams,
  type Diagnostic,
  type QueryParam,
} from './urlParserUtils';

const SAMPLE = 'https://user:s3cr3t@例え.テスト:443/a//b%20c?utm_source=newsletter&q=a+b&q&empty=&next=https%3A%2F%2Fevil.example%2Fx#/route/deep';

const SAMPLES: Array<{ label: string; url: string; base: string }> = [
  { label: '认证信息 + 冗余端口 + IDN', url: SAMPLE, base: '' },
  { label: 'IPv6 主机', url: 'http://[2001:db8::1]:8080/a//b?x=1', base: '' },
  { label: '只有查询串', url: '?q=%E4%B8%AD%E6%96%87&page=2', base: 'https://example.com/list/1' },
  { label: '相对路径', url: '../up/../here', base: 'https://example.com/a/b/c?keep=1' },
  { label: '危险协议', url: 'javascript:alert(1)', base: '' },
  { label: '邮件地址（非层级 URL）', url: 'mailto:someone@example.com?subject=%E4%BD%A0%E5%A5%BD', base: '' },
];

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  caption: {
    color: tokens.colorNeutralForeground3,
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: '8px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  fieldLabel: {
    flex: 'none',
    width: '190px',
    color: tokens.colorNeutralForeground3,
  },
  value: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  empty: {
    flex: '1 1 auto',
    color: tokens.colorNeutralForeground4,
  },
  fieldBody: {
    flex: '1 1 auto',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  fieldValueRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minWidth: 0,
  },
  note: {
    color: tokens.colorNeutralForeground3,
    fontSize: '12px',
  },
  segment: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '10px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  headCell: {
    textAlign: 'left',
    padding: '8px 10px',
    color: tokens.colorNeutralForeground3,
    fontWeight: 600,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    whiteSpace: 'nowrap',
  },
  cell: {
    padding: '6px 10px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    verticalAlign: 'top',
    overflowWrap: 'anywhere',
  },
  cellMono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
  },
  flags: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
  },
  diagnostic: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: '10px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  diagnosticBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minWidth: 0,
  },
  queryScroll: {
    width: '100%',
    maxHeight: '340px',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
});

/** A monospace value with a copy button; the value itself stays selectable. */
function CopyValue({ value, label }: { value: string; label: string }) {
  const styles = useStyles();
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    const ok = await copyText(value);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1400);
  }, [value]);

  return (
    <>
      <span className={styles.value}>{value}</span>
      <Button
        appearance="subtle"
        size="small"
        icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
        onClick={copy}
        aria-label={`复制${label}`}
      />
    </>
  );
}

const LEVEL_META: Record<Diagnostic['level'], { label: string; color: 'informative' | 'warning' | 'danger' }> = {
  info: { label: '提示', color: 'informative' },
  warning: { label: '注意', color: 'warning' },
  error: { label: '危险', color: 'danger' },
};

function QueryFlag({ param }: { param: QueryParam }) {
  const styles = useStyles();
  const flags: Array<{ text: string; color: 'informative' | 'warning' | 'danger' | 'success' | 'important' }> = [];
  if (param.duplicateOf !== null) {
    flags.push({ text: `重复（同第 ${param.duplicateOf + 1} 个）`, color: 'warning' });
  }
  if (!param.hasEquals) flags.push({ text: '无值键（没有 =）', color: 'important' });
  else if (param.value === '') flags.push({ text: '空值键（有 = 但为空）', color: 'informative' });
  if (param.tracking) flags.push({ text: '追踪参数', color: 'danger' });

  return (
    <div className={styles.flags}>
      {flags.length === 0 ? (
        <Caption1 className={styles.caption}>普通参数</Caption1>
      ) : (
        flags.map((flag) => (
          <Badge key={flag.text} appearance="tint" color={flag.color} size="small">
            {flag.text}
          </Badge>
        ))
      )}
    </div>
  );
}

export function UrlParserTool() {
  const styles = useStyles();
  const [input, setInput] = useState(SAMPLE);
  const [base, setBase] = useState('');
  const [revealPassword, setRevealPassword] = useState(false);

  const result = useMemo(() => analyzeUrl(input, base), [input, base]);
  const displayPassword = useMemo(() => {
    if (!result.ok) return '';
    const { password } = result.fields;
    if (password === '') return '';
    // Masking by character count leaks the length, so a fixed-width mask is used
    // instead. The point of the mask is that a screenshot or a pasted log does
    // not hand over the credential, and a length hint is still a hint.
    return revealPassword ? password : '••••••••';
  }, [result, revealPassword]);

  const passwordNote = result.ok && result.fields.password !== ''
    ? '默认打码：整条 URL 经常被直接粘进聊天、issue 和日志里，密码随 URL 泄露就等于凭据泄露。需要核对时再点右侧的「显示密码」。'
    : undefined;

  return (
    <div className="wt-surface">
      <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
        <Text as="h2" size={300} weight="semibold">
          输入
        </Text>
        <div className={styles.toolbar}>
          <input
            className="wt-inline-input"
            style={{ flex: '1 1 420px', minWidth: 240, fontSize: 14 }}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="粘贴完整 URL，或配合 base 填相对地址"
            aria-label="要分析的 URL"
            spellCheck={false}
          />
        </div>
        <div className={styles.toolbar}>
          <Caption1 className={styles.caption}>base（可选，用于解析相对地址）</Caption1>
          <input
            className="wt-inline-input"
            style={{ flex: '1 1 320px', minWidth: 200 }}
            value={base}
            onChange={(event) => setBase(event.target.value)}
            placeholder="https://example.com/dir/page?z=1"
            aria-label="解析相对地址时使用的 base URL"
            spellCheck={false}
          />
          <Button
            appearance="subtle"
            icon={<EraserRegular />}
            onClick={() => {
              setInput('');
              setBase('');
            }}
          >
            清空
          </Button>
        </div>
        <div className={styles.toolbar}>
          <Caption1 className={styles.caption}>示例：</Caption1>
          {SAMPLES.map((sample) => (
            <Button
              key={sample.label}
              appearance="secondary"
              size="small"
              onClick={() => {
                setInput(sample.url);
                setBase(sample.base);
              }}
            >
              {sample.label}
            </Button>
          ))}
        </div>
      </div>

      {!result.ok && (
        <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
          <MessageBar intent="error">
            <MessageBarBody>{result.error}</MessageBarBody>
          </MessageBar>
        </div>
      )}

      {result.ok && (
        <>
          <section className="wt-surface" aria-label="字段拆解">
            <div className="wt-surface__header">
              <Link16Regular />
              <Text as="h2" size={300} weight="semibold">
                字段拆解
              </Text>
              <span className={styles.spacer} />
              <Caption1 className={styles.caption}>
                {result.usedBase
                  ? `相对地址，已按 base 解析为：${result.href}`
                  : '各字段均由浏览器原生 new URL() 给出'}
              </Caption1>
            </div>
            <div className={`wt-surface__body ${styles.rows}`}>
              {FIELD_ORDER.map((field) => {
                const raw = result.fields[field.key];
                const isPassword = field.key === 'password';
                const value = isPassword ? displayPassword : raw;
                const isEmpty = value === '';
                let note: string | undefined;
                if (isPassword) note = passwordNote;
                else if (field.key === 'port' && isEmpty && result.defaultPortForScheme) {
                  note = `${result.fields.protocol} 的默认端口是 ${result.defaultPortForScheme}，会被 new URL() 规范化掉，因此这里为空${
                    result.redundantPort !== null ? '——但输入里其实显式写了它' : ''
                  }。`;
                } else if (field.key === 'origin' && raw === 'null') {
                  note = '该协议没有源（origin），浏览器返回字符串 "null"。';
                } else if (field.key === 'username' && raw !== '') {
                  note = '这是百分号编码后的形式；用户名里的 @ 会变成 %40，所以认证信息不能靠数 @ 来拆。';
                }
                return (
                  <div key={field.key} className={styles.row}>
                    <Text className={styles.fieldLabel} size={200}>
                      {field.label}
                    </Text>
                    <div className={styles.fieldBody}>
                      <div className={styles.fieldValueRow}>
                        {isEmpty ? (
                          <span className={styles.empty}>（空）</span>
                        ) : (
                          <CopyValue value={value} label={field.label} />
                        )}
                      </div>
                      {note && <Caption1 className={styles.note}>{note}</Caption1>}
                    </div>
                  </div>
                );
              })}
              {result.fields.password !== '' && (
                <div className={styles.row}>
                  <span className={styles.fieldLabel} />
                  <Checkbox
                    checked={revealPassword}
                    onChange={(_, data) => setRevealPassword(Boolean(data.checked))}
                    label="显示密码"
                  />
                </div>
              )}
            </div>
          </section>

          <section className="wt-surface" aria-label="逐段解码">
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                逐段解码
              </Text>
              <span className={styles.spacer} />
              <Caption1 className={styles.caption}>三段用的是不同的解码规则</Caption1>
            </div>
            <div className={`wt-surface__body ${styles.rows}`}>
              {result.segments.map((segment) => (
                <div key={segment.key} className={styles.segment}>
                  <Caption1 className={styles.caption}>{segment.label}</Caption1>
                  <Text className={styles.mono}>原始：{segment.raw === '' ? '（空）' : segment.raw}</Text>
                  <Text className={styles.mono}>解码：{segment.decoded === '' ? '（空）' : segment.decoded}</Text>
                  {segment.error && (
                    <MessageBar intent="warning">
                      <MessageBarBody>{segment.error}</MessageBarBody>
                    </MessageBar>
                  )}
                  <Caption1 className={styles.caption}>{segment.note}</Caption1>
                </div>
              ))}
            </div>
          </section>

          <section className="wt-surface" aria-label="查询参数">
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                查询参数 · {result.query.length}
              </Text>
              <span className={styles.spacer} />
              <Button
                appearance="primary"
                size="small"
                icon={<EraserRegular />}
                onClick={() => setInput(removeTrackingParams(result.href))}
                disabled={result.trackingKeys.length === 0}
              >
                {result.trackingKeys.length === 0
                  ? '没有追踪参数'
                  : `移除 ${result.trackingKeys.length} 类追踪参数`}
              </Button>
            </div>
            <div className={`wt-surface__body ${styles.rows}`}>
              {result.query.length === 0 ? (
                <Caption1 className={styles.note} style={{ padding: '12px 14px' }}>
                  这条 URL 没有查询参数。
                </Caption1>
              ) : (
                <div className={styles.queryScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.headCell}>#</th>
                        <th className={styles.headCell}>键（解码后）</th>
                        <th className={styles.headCell}>值（解码后）</th>
                        <th className={styles.headCell}>原始片段</th>
                        <th className={styles.headCell}>标记</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.query.map((param) => (
                        <tr key={`${param.index}-${param.raw}`}>
                          <td className={`${styles.cell} ${styles.cellMono}`}>{param.index + 1}</td>
                          <td className={`${styles.cell} ${styles.cellMono}`}>{param.key === '' ? '（空键）' : param.key}</td>
                          <td className={`${styles.cell} ${styles.cellMono}`}>
                            {param.value === null ? '（没有 =，无值）' : param.value === '' ? '（= 后为空）' : param.value}
                          </td>
                          <td className={`${styles.cell} ${styles.cellMono}`}>{param.raw}</td>
                          <td className={styles.cell}>
                            <QueryFlag param={param} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          <section className="wt-surface" aria-label="诊断">
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                诊断 · {result.diagnostics.length}
              </Text>
            </div>
            <div className={`wt-surface__body ${styles.rows}`}>
              {result.diagnostics.length === 0 ? (
                <Caption1 className={styles.note} style={{ padding: '12px 14px' }}>
                  没有发现需要提醒的问题。
                </Caption1>
              ) : (
                result.diagnostics.map((diagnostic) => (
                  <div key={diagnostic.id} className={styles.diagnostic}>
                    <Badge appearance="tint" color={LEVEL_META[diagnostic.level].color} size="small">
                      {LEVEL_META[diagnostic.level].label}
                    </Badge>
                    <div className={styles.diagnosticBody}>
                      <Text weight="semibold">{diagnostic.title}</Text>
                      <Caption1 className={styles.caption}>{diagnostic.detail}</Caption1>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="wt-surface" aria-label="关于本工具">
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                关于本工具
              </Text>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <Caption1 className={styles.caption}>
                拆解结果完全来自浏览器原生的 new URL() 与 URLSearchParams，因此与地址栏的行为一致：
                默认端口会被规范化掉、非 ASCII 主机名会转成 Punycode、非 ASCII 路径与查询会百分号编码。
              </Caption1>
              <Caption1 className={styles.caption}>
                本工具只做本地解析与诊断：不会向该地址发送任何请求，因此无法检测链接是否可访问、状态码是多少，
                也不会展开短链（重定向只能由网络请求得知），亦不校验域名是否已注册或是否含恶意内容。
              </Caption1>
            </div>
          </section>
        </>
      )}

      <Divider />
    </div>
  );
}
