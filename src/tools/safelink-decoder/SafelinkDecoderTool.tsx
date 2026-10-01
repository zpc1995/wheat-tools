import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Radio,
  RadioGroup,
  Text,
  Toast,
  ToastTitle,
  Toaster,
  Tooltip,
  makeStyles,
  tokens,
  useId,
  useToastController,
} from '@fluentui/react-components';
import {
  Checkmark16Regular,
  Copy16Regular,
  Dismiss16Regular,
  Eye16Regular,
  Lightbulb16Regular,
  ShieldQuestion16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  MAX_WRAPPER_LAYERS,
  decodeSafelink,
  splitDataFields,
  type SafelinkParam,
  type SafelinkResult,
  type PlusMode,
} from './safelinkUtils';

/**
 * Sample links.
 *
 * They are constructed here rather than copied from a real mailbox: a real
 * sample would carry someone's tenant, mailbox and signature, and the encoding
 * scheme is stable enough that a constructed link exercises the same code path.
 */
const SAMPLES: Array<{ label: string; value: string; note: string }> = [
  {
    label: '普通链接',
    note: '最常见的形态：一层编码，四个标准参数。',
    value:
      'https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.com%2Fdocs%3Fid%3D42%26lang%3Dzh-CN%23section-3&data=05%7C01%7Cuser%40contoso.com%7C6e0bfede3fcb4518a16565dc14fe5620%7C0&sdata=SYE9eiOYbZb5HG8EPKlo%2FGsvhL9sJQ%2BpSpVr4TjZJbI%3D&reserved=0',
  },
  {
    label: '双重编码 + 嵌套',
    note: 'url 参数被编码两次，且第一层解出来仍是 SafeLink。',
    value:
      'https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fnam01.safelinks.protection.outlook.com%2F%3Furl%3Dhttps%253A%252F%252Fexample.com%252F%25E4%25B8%25AD%252F%253Fq%253Da%252Bb%26data%3D01%257C01%257Cuser%2540contoso.com%26sdata%3Dabc%252Fdef%253D%26reserved%3D0&data=05%7C01%7Cuser%40contoso.com%7C6e0bfede3fcb4518a16565dc14fe5620%7C0&sdata=SYE9eiOYbZb5HG8EPKlo%2FGsvhL9sJQ%2BpSpVr4TjZJbI%3D&reserved=0',
  },
];

/** Regional prefixes seen on the SafeLink hosts, shown as a reference only. */
const HOST_VARIANTS = [
  'na01.safelinks.protection.outlook.com',
  'nam01 / nam02 / nam04 / nam10 / nam11 / nam12.safelinks.protection.outlook.com',
  'eur01 / eur04.safelinks.protection.outlook.com',
  'emea01.safelinks.protection.outlook.com',
  'apc01.safelinks.protection.outlook.com',
  'outlook.office.com/mail/... （带 url 参数的邮件包装链接）',
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
    gap: '10px',
    padding: '10px 14px',
    width: '100%',
  },
  spacer: {
    flex: '1 1 auto',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    gap: '10px',
    padding: '12px 14px',
  },
  targetBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    width: '100%',
    padding: '14px',
    borderRadius: '6px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  target: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.6,
    overflowWrap: 'anywhere',
    userSelect: 'all',
    wordBreak: 'break-all',
  },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    padding: '8px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  rowLabel: {
    flex: 'none',
    width: '110px',
    color: tokens.colorNeutralForeground3,
  },
  rowValue: {
    flex: '1 1 auto',
    minWidth: 0,
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12.5px',
    fontVariantNumeric: 'tabular-nums',
  },
  paramName: {
    flex: 'none',
    width: '110px',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12.5px',
    color: tokens.colorBrandForeground1,
    userSelect: 'all',
  },
  paramBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    flex: '1 1 auto',
    minWidth: 0,
  },
  warning: {
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-start',
    padding: '8px 14px',
    width: '100%',
  },
  bullet: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '12px 14px',
    width: '100%',
  },
});

function ParamRow({ param }: { param: SafelinkParam }) {
  const styles = useStyles();
  return (
    <div className={styles.row}>
      <span className={styles.paramName}>{param.name}</span>
      <span className={styles.paramBody}>
        <span>
          {param.info.title}{' '}
          {param.info.documented ? null : (
            <Badge appearance="outline" size="small" color="warning">
              微软未文档化
            </Badge>
          )}
          {/^sdata$/i.test(param.name) ? (
            <>
              {' '}
              <Badge appearance="tint" size="small" color="danger">
                本工具不验证
              </Badge>
            </>
          ) : null}
        </span>
        <Caption1 className={styles.hint}>{param.info.detail}</Caption1>
        <span className={`${styles.mono} ${styles.rowValue}`}>{param.formValue || '（空）'}</span>
        {param.ambiguousPlus ? (
          <Caption1 className={styles.hint}>
            含未转义的 +：按表单规则读作 {JSON.stringify(param.formValue)}，按严格规则读作{' '}
            {JSON.stringify(param.literalValue)}
          </Caption1>
        ) : null}
      </span>
    </div>
  );
}

export function SafelinkDecoderTool() {
  const styles = useStyles();
  const toasterId = useId('safelink-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [input, setInput] = useState('');
  const [plusMode, setPlusMode] = useState<PlusMode>('space');
  const [copied, setCopied] = useState<string | null>(null);

  const notify = useCallback(
    (message: string) => {
      dispatchToast(
        <Toast>
          <ToastTitle>{message}</ToastTitle>
        </Toast>,
        { timeout: 1400 },
      );
    },
    [dispatchToast],
  );

  const copy = useCallback(
    async (value: string, key: string) => {
      const ok = await copyText(value);
      if (ok) {
        setCopied(key);
        window.setTimeout(() => setCopied(null), 1400);
        notify('已复制');
      } else {
        notify('复制失败');
      }
    },
    [notify],
  );

  const result: SafelinkResult | null = useMemo(
    () => (input.trim() === '' ? null : decodeSafelink(input, { plusMode })),
    [input, plusMode],
  );

  const ok = result?.ok === true ? result : null;
  const dataParam = ok?.params.find((param) => param.key === 'data');
  const dataFields = dataParam ? splitDataFields(dataParam.formValue) : [];
  const literalDiffers = Boolean(ok && ok.targetLiteral !== ok.target);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>它做什么，以及不做什么</MessageBarTitle>
            把 Microsoft Defender for Office 365 改写过的那种链接（
            <span className={styles.mono}>https://nam12.safelinks.protection.outlook.com/?url=...</span>
            ）还原成真实目标地址，并逐个说明 url、data、sdata、reserved 参数。
            <strong>不验证 sdata 签名</strong>——验证需要微软未公开的公钥与算法，纯前端做不到，
            所以这里只原样展示；<strong>也不会访问、请求或预览任何 URL</strong>，
            全部在本地按文本处理。
          </MessageBarBody>
        </MessageBar>

        <section className="wt-surface" aria-label="SafeLink 输入">
          <div className="wt-surface__header">
            <Eye16Regular />
            <Text as="h2" size={300} weight="semibold">
              SafeLink URL
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              {input.length > 0 ? `${input.length} 个字符` : '等待粘贴'}
            </Caption1>
          </div>
          <div className={styles.toolbar}>
            {SAMPLES.map((sample) => (
              <Tooltip key={sample.label} content={sample.note} relationship="description" withArrow>
                <Button appearance="secondary" size="small" onClick={() => setInput(sample.value)}>
                  {sample.label}
                </Button>
              </Tooltip>
            ))}
            <Button
              appearance="subtle"
              size="small"
              icon={<Dismiss16Regular />}
              onClick={() => setInput('')}
              disabled={input === ''}
            >
              清空
            </Button>
            <span className={styles.spacer} />
            <RadioGroup
              layout="horizontal"
              value={plusMode}
              onChange={(_, data) => setPlusMode(data.value as PlusMode)}
              aria-label="url 参数里 + 号的解读方式"
            >
              <Radio value="space" label="+ 视为空格（表单规则，默认）" />
              <Radio value="literal" label="+ 视为字面加号（严格 RFC 3986）" />
            </RadioGroup>
          </div>
          <div className={`wt-surface__body ${styles.column}`}>
            <textarea
              className="wt-code-area"
              style={{ minHeight: '120px' }}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              aria-label="SafeLink URL 输入"
              spellCheck={false}
              placeholder="把邮件里的 SafeLink 整条粘贴到这里，例如：https://nam12.safelinks.protection.outlook.com/?url=...&data=...&sdata=...&reserved=0"
            />
          </div>
        </section>

        {result === null ? (
          <div className="wt-empty">
            <Lightbulb16Regular />
            <span>粘贴一条 SafeLink，或点上面的「普通链接」看一个构造出来的样例。</span>
          </div>
        ) : null}

        {result && !result.ok ? (
          <>
            <MessageBar intent="error">
              <MessageBarBody>
                <MessageBarTitle>无法还原</MessageBarTitle>
                {result.error}
              </MessageBarBody>
            </MessageBar>
            {result.warnings.length > 0 ? (
              <section className="wt-surface" aria-label="解析提示">
                <div className="wt-surface__header">
                  <Warning16Regular />
                  <Text as="h2" size={300} weight="semibold">
                    解析提示
                  </Text>
                </div>
                <div className={`wt-surface__body ${styles.bullet}`}>
                  {result.warnings.map((warning) => (
                    <Caption1 key={warning.code} className={styles.hint}>
                      {warning.message}
                    </Caption1>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        ) : null}

        {ok ? (
          <>
            <MessageBar intent="warning">
              <MessageBarBody>
                <MessageBarTitle>解码成功不等于链接安全</MessageBarTitle>
                这里只是把编码还原成原文，<strong>没有</strong>查询信誉库、没有验证签名、也没有打开过它。
                还原出来的地址完全可能指向钓鱼站点，请自己核对域名——尤其是看起来像但拼写不同的域名。
              </MessageBarBody>
            </MessageBar>

            <section className="wt-surface" aria-label="真实目标">
              <div className="wt-surface__header">
                <Text as="h2" size={300} weight="semibold">
                  真实目标
                </Text>
                <span className={styles.spacer} />
                <Caption1 className={styles.hint}>
                  共 {ok.layers.length} 层包装
                  {ok.layers[0].passes > 1 ? ` · 第一层解码 ${ok.layers[0].passes} 次` : ''}
                  {ok.truncated ? ' · 已达递归上限' : ''}
                </Caption1>
              </div>
              <div className={`wt-surface__body ${styles.column}`}>
                <div className={styles.targetBox}>
                  <span className={styles.target}>{ok.target}</span>
                  <Tooltip content="复制目标地址" relationship="label" withArrow>
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={copied === 'target' ? <Checkmark16Regular /> : <Copy16Regular />}
                      onClick={() => copy(ok.target, 'target')}
                      aria-label="复制真实目标地址"
                    />
                  </Tooltip>
                </div>
                {literalDiffers ? (
                  <MessageBar intent="warning">
                    <MessageBarBody>
                      <MessageBarTitle>这个链接里的 + 有两种读法</MessageBarTitle>
                      url 参数含未转义的 <span className={styles.mono}>+</span>。
                      按表单规则它是空格，得到上面的结果；按严格规则它是字面加号，结果为：
                      <br />
                      <span className={styles.mono}>{ok.targetLiteral}</span>
                      <br />
                      正规编码器会把字面加号写成 <span className={styles.mono}>%2B</span>，
                      所以默认按空格解读；两种结果都给出，请结合上下文自行判断。
                    </MessageBarBody>
                  </MessageBar>
                ) : null}
              </div>
            </section>

            <section className="wt-surface" aria-label="包装层级">
              <div className="wt-surface__header">
                <Text as="h2" size={300} weight="semibold">
                  包装层级
                </Text>
                <span className={styles.spacer} />
                <Caption1 className={styles.hint}>
                  从外到内，最多还原 {MAX_WRAPPER_LAYERS} 层
                </Caption1>
              </div>
              <div className={`wt-surface__body ${styles.column}`}>
                {ok.layers.map((layer) => (
                  <div key={layer.layer} className={styles.row}>
                    <span className={styles.rowLabel}>第 {layer.layer} 层</span>
                    <span className={styles.paramBody}>
                      <span>
                        <span className={styles.mono}>{layer.host}</span>{' '}
                        <Badge appearance="tint" size="small" color="informative">
                          {layer.kind === 'safelinks-host' ? 'SafeLink 域名' : 'Outlook 邮件包装'}
                        </Badge>{' '}
                        <Badge appearance="outline" size="small">
                          解码 {layer.passes} 次
                        </Badge>
                      </span>
                      <Caption1 className={styles.hint}>url 参数原文：</Caption1>
                      <span className={`${styles.mono} ${styles.rowValue}`}>{layer.rawUrl}</span>
                      <Caption1 className={styles.hint}>还原为：</Caption1>
                      <span className={`${styles.mono} ${styles.rowValue}`}>{layer.target}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="wt-surface" aria-label="查询参数">
              <div className="wt-surface__header">
                <ShieldQuestion16Regular />
                <Text as="h2" size={300} weight="semibold">
                  查询参数
                </Text>
                <span className={styles.spacer} />
                <Caption1 className={styles.hint}>
                  大小写不敏感；这里展示的是最外层包装的参数
                </Caption1>
              </div>
              <div className={`wt-surface__body ${styles.column}`} style={{ gap: 0, padding: 0 }}>
                {ok.params.map((param, index) => (
                  <ParamRow key={`${param.name}-${index}`} param={param} />
                ))}
              </div>
            </section>

            {dataFields.length > 0 ? (
              <section className="wt-surface" aria-label="data 字段">
                <div className="wt-surface__header">
                  <Text as="h2" size={300} weight="semibold">
                    data 字段
                  </Text>
                  <span className={styles.spacer} />
                  <Caption1 className={styles.hint}>
                    解出 {dataFields.length} 段，含义微软未公开
                  </Caption1>
                </div>
                <div className={`wt-surface__body ${styles.bullet}`}>
                  {dataFields.map((field, index) => (
                    <div key={`field-${index}`} className={styles.row}>
                      <span className={styles.rowLabel}>字段 {index + 1}</span>
                      <span className={`${styles.mono} ${styles.rowValue}`}>
                        {field === '' ? '（空）' : field}
                      </span>
                    </div>
                  ))}
                  <Caption1 className={styles.hint}>
                    不做字段语义推断：这些段看起来像版本号、GUID、地址与数字，但没有官方文档，
                    把它们当成已知信息会误导判断。
                  </Caption1>
                </div>
              </section>
            ) : null}

            <section className="wt-surface" aria-label="解码提示">
              <div className="wt-surface__header">
                <Warning16Regular />
                <Text as="h2" size={300} weight="semibold">
                  解码提示
                </Text>
                <span className={styles.spacer} />
                <Caption1 className={styles.hint}>{ok.warnings.length} 条</Caption1>
              </div>
              <div className={`wt-surface__body ${styles.bullet}`}>
                {ok.warnings.length === 0 ? (
                  <Caption1 className={styles.hint}>
                    没有异常：结构标准，url 参数一层编码即可还原，也没有 + 号歧义。
                  </Caption1>
                ) : (
                  ok.warnings.map((warning) => (
                    <div key={warning.code} className={styles.warning}>
                      <Warning16Regular
                        style={{ flex: 'none', marginTop: '2px', color: tokens.colorPaletteMarigoldForeground1 }}
                      />
                      <Caption1>{warning.message}</Caption1>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        ) : null}

        <section className="wt-surface" aria-label="域名与参数说明">
          <div className="wt-surface__header">
            <Text as="h2" size={300} weight="semibold">
              域名形态与参数
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>参照公开观察到的结构，不是微软的正式文档</Caption1>
          </div>
          <div className={`wt-surface__body ${styles.bullet}`}>
            <Caption1 className={styles.hint}>
              识别方式是<strong>后缀匹配</strong>，不依赖固定的地区前缀表，因此任何
              {' '}
              <span className={styles.mono}>*.safelinks.protection.outlook.com</span>
              {' '}
              都能识别。下面这些前缀是公开资料里出现过的：
            </Caption1>
            {HOST_VARIANTS.map((host) => (
              <span key={host} className={`${styles.mono} ${styles.hint}`}>
                {host}
              </span>
            ))}
            <Divider />
            <Caption1 className={styles.hint}>
              url 是真实目标；data 是一串未公开的元数据；sdata 是完整性签名，本工具不验证；
              reserved 观察值几乎总是 0。微软没有为这四个参数发布正式说明，
              所以这里对未公开的部分一律标注「未文档化」，而不是编一个解释。
            </Caption1>
          </div>
        </section>

        <Caption1 className={styles.hint} style={{ padding: '0 4px' }}>
          想手工核对编码层级？「URL 编解码」工具可以正反向转换百分号编码，
          本工具的往返一致性也由 scripts/check-safelink-decoder.mjs 覆盖。
        </Caption1>

        <Divider />
      </div>
    </>
  );
}
