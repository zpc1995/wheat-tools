import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Select,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Checkmark16Regular, Copy16Regular } from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  DEVICE_TYPE_LABELS,
  UA_SAMPLES,
  parseUserAgent,
  type UaAnalysis,
  type UaSegment,
} from './userAgentParserUtils';

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '12px 16px 16px',
    width: '100%',
  },
  sampleRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
  },
  sampleSelect: {
    minWidth: '260px',
  },
  highlight: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
    lineHeight: 1.8,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    padding: '10px 12px',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  mark: {
    borderRadius: '3px',
    padding: '0 2px',
    color: 'inherit',
  },
  legend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px',
    alignItems: 'center',
  },
  legendItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
  },
  swatch: {
    width: '12px',
    height: '12px',
    borderRadius: '3px',
    display: 'inline-block',
  },
  fieldGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '10px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '8px 10px',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    borderRadius: tokens.borderRadiusMedium,
    minWidth: 0,
  },
  fieldLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: '11.5px',
  },
  fieldValue: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '14px',
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
  },
  warnings: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  unrecognised: {
    padding: '10px 12px',
    border: `1px dashed ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    color: tokens.colorNeutralForeground2,
  },
});

/**
 * Background per highlight kind.
 *
 * Colour alone never carries the meaning: the legend below always spells out
 * what each colour means, and the parsed fields show the same values in text.
 */
const SEGMENT_COLORS: Record<UaSegment['kind'], keyof typeof tokens> = {
  browser: 'colorPaletteBlueBackground2',
  engine: 'colorPaletteTealBackground2',
  os: 'colorPaletteGreenBackground2',
  device: 'colorPalettePurpleBackground2',
  cpu: 'colorPaletteMarigoldBackground2',
  bot: 'colorPaletteRedBackground2',
};

const SEGMENT_LABELS: Record<UaSegment['kind'], string> = {
  browser: '浏览器',
  engine: '渲染引擎',
  os: '操作系统',
  device: '设备',
  cpu: 'CPU 架构',
  bot: '爬虫',
};

const KIND_ORDER: UaSegment['kind'][] = ['browser', 'bot', 'engine', 'os', 'device', 'cpu'];

function Field({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.fieldValue}>{value}</span>
    </div>
  );
}

function Parts({ analysis }: { analysis: UaAnalysis }) {
  const styles = useStyles();
  return (
    <div className={styles.fieldGrid}>
      <Field
        label="浏览器"
        value={analysis.browser ? `${analysis.browser.name} ${analysis.browser.version ?? ''}`.trim() : '（无法识别）'}
      />
      <Field
        label="渲染引擎"
        value={
          analysis.engine
            ? `${analysis.engine.name} ${analysis.engine.version ?? ''}${analysis.engine.inferred ? '（由浏览器推断，UA 里没有写）' : ''}`.trim()
            : '（无法识别）'
        }
      />
      <Field
        label="操作系统"
        value={analysis.os ? `${analysis.os.name} ${analysis.os.version ?? ''}`.trim() : '（无法识别）'}
      />
      <Field label="设备类型" value={DEVICE_TYPE_LABELS[analysis.device.type]} />
      <Field
        label="设备厂商 / 型号"
        value={[analysis.device.vendor, analysis.device.model].filter(Boolean).join(' ') || '（未提供）'}
      />
      <Field
        label="CPU 架构"
        value={
          analysis.cpu
            ? `${analysis.cpu.architecture}${analysis.cpu.bits ? ` ${analysis.cpu.bits} 位` : ''}`
            : '（未提供）'
        }
      />
      <Field label="是否爬虫" value={analysis.isBot ? '是' : '否'} />
      <Field label="爬虫名称" value={analysis.bot ? `${analysis.bot.name} ${analysis.bot.version ?? ''}`.trim() : '—'} />
    </div>
  );
}

/** Renders the raw UA with the matched runs highlighted. */
function Highlighted({ analysis }: { analysis: UaAnalysis }) {
  const styles = useStyles();
  if (analysis.segments.length === 0) {
    return <div className={styles.highlight}>{analysis.raw || '（空）'}</div>;
  }
  const pieces: Array<{ text: string; segment: UaSegment | null }> = [];
  let cursor = 0;
  for (const segment of analysis.segments) {
    if (segment.start > cursor) {
      pieces.push({ text: analysis.raw.slice(cursor, segment.start), segment: null });
    }
    pieces.push({ text: analysis.raw.slice(segment.start, segment.end), segment });
    cursor = segment.end;
  }
  if (cursor < analysis.raw.length) {
    pieces.push({ text: analysis.raw.slice(cursor), segment: null });
  }

  return (
    <div className={styles.highlight}>
      {pieces.map((piece, index) =>
        piece.segment === null ? (
          <span key={index}>{piece.text}</span>
        ) : (
          <mark
            key={index}
            className={styles.mark}
            style={{ backgroundColor: tokens[SEGMENT_COLORS[piece.segment.kind]] }}
            title={`${SEGMENT_LABELS[piece.segment.kind]}：${piece.segment.label}`}
          >
            {piece.text}
          </mark>
        ),
      )}
    </div>
  );
}

function buildReport(analysis: UaAnalysis): string {
  const lines = [
    `UA: ${analysis.raw}`,
    `浏览器: ${analysis.browser ? `${analysis.browser.name} ${analysis.browser.version ?? ''}`.trim() : '（无法识别）'}`,
    `渲染引擎: ${analysis.engine ? `${analysis.engine.name} ${analysis.engine.version ?? ''}`.trim() : '（无法识别）'}`,
    `操作系统: ${analysis.os ? `${analysis.os.name} ${analysis.os.version ?? ''}`.trim() : '（无法识别）'}`,
    `设备类型: ${DEVICE_TYPE_LABELS[analysis.device.type]}`,
    `设备型号: ${[analysis.device.vendor, analysis.device.model].filter(Boolean).join(' ') || '（未提供）'}`,
    `CPU 架构: ${analysis.cpu ? `${analysis.cpu.architecture}${analysis.cpu.bits ? ` ${analysis.cpu.bits} 位` : ''}` : '（未提供）'}`,
    `爬虫: ${analysis.isBot ? analysis.bot?.name ?? '是' : '否'}`,
  ];
  return lines.join('\n');
}

export function UserAgentParserTool() {
  const styles = useStyles();
  const [raw, setRaw] = useState(UA_SAMPLES[0].ua);
  const [sampleIndex, setSampleIndex] = useState('0');
  const [copied, setCopied] = useState(false);

  const analysis = useMemo(() => parseUserAgent(raw), [raw]);
  const selectedSample = UA_SAMPLES[Number(sampleIndex)] ?? UA_SAMPLES[0];

  const copyReport = async () => {
    const ok = await copyText(buildReport(analysis));
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className={styles.stack}>
      <MessageBar intent="warning">
        <MessageBarBody>
          <MessageBarTitle>
            这段字符串是客户端「自称」的，不是事实
          </MessageBarTitle>
          UA 由客户端自己填写，一行 <code>curl -A "…"</code>{' '}
          就能随便改。下面的字段只是把这串文本按惯例拆开，<strong>不能用作安全判断</strong>
          （不要用它放行、封禁或鉴权）。另外现代浏览器普遍主动少说：
          Chrome 从 110 起做 UA Reduction（版本冻结成 <code>120.0.0.0</code>，Android
          上统一写 <code>Android 10; K</code>），Safari 冻结 macOS 版本为{' '}
          <code>10_15_7</code> 且在 Apple Silicon 上仍写 Intel，
          Windows 10 与 11 都写 <code>Windows NT 10.0</code>。
          替代方案是 <strong>Client Hints</strong>（<code>Sec-CH-UA</code>、
          <code>Sec-CH-UA-Platform</code>，浏览器里是{' '}
          <code>navigator.userAgentData</code>）：结构化、可按需索取，但只覆盖部分浏览器，
          而且正是为了取代这整串 UA 才被发明出来的。
        </MessageBarBody>
      </MessageBar>

      <section className="wt-surface" aria-label="User Agent 输入">
        <div className="wt-surface__header">
          <Text as="h2" size={300} weight="semibold">
            输入与样本
          </Text>
          <span className={styles.spacer} />
          <Button
            appearance="subtle"
            size="small"
            icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
            onClick={() => void copyReport()}
          >
            {copied ? '已复制' : '复制解析结果'}
          </Button>
        </div>
        <div className={styles.body}>
          <div className={styles.sampleRow}>
            <Select
              className={styles.sampleSelect}
              aria-label="选择内置 UA 样本"
              value={sampleIndex}
              onChange={(event) => {
                const index = event.target.value;
                setSampleIndex(index);
                const sample = UA_SAMPLES[Number(index)];
                if (sample) setRaw(sample.ua);
              }}
            >
              {UA_SAMPLES.map((sample, index) => (
                <option key={sample.label} value={String(index)}>
                  {sample.label}
                </option>
              ))}
            </Select>
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
              {selectedSample.note}
            </Caption1>
          </div>

          <textarea
            className="wt-code-area"
            style={{ minHeight: 96 }}
            aria-label="要解析的 User Agent 字符串"
            value={raw}
            spellCheck={false}
            onChange={(event) => setRaw(event.target.value)}
            placeholder="粘贴一段 User Agent 字符串"
          />
        </div>
      </section>

      <section className="wt-surface" aria-label="解析结果">
        <div className="wt-surface__header">
          <Text as="h2" size={300} weight="semibold">
            解析结果
          </Text>
          <span className={styles.spacer} />
          <Badge appearance="tint" color={analysis.recognized ? 'success' : 'warning'} size="small">
            {analysis.recognized ? '已识别出字段' : '无法识别'}
          </Badge>
        </div>
        <div className={styles.body}>
          {!analysis.recognized ? (
            <div className={styles.unrecognised}>
              无法从这段字符串识别出任何已知的浏览器、操作系统或设备。它可能是伪造、被截断、缩减过，
              或来自一个非常规客户端。<strong>本工具不会猜一个结果给你</strong>
              ——空字段就是「不知道」。
            </div>
          ) : (
            <Parts analysis={analysis} />
          )}

          <div>
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
              原始串与匹配到的片段：
            </Caption1>
            <div style={{ marginTop: 6 }}>
              <Highlighted analysis={analysis} />
            </div>
            <div className={styles.legend} style={{ marginTop: 8 }}>
              {KIND_ORDER.map((kind) => (
                <span key={kind} className={styles.legendItem}>
                  <span
                    className={styles.swatch}
                    style={{ backgroundColor: tokens[SEGMENT_COLORS[kind]] }}
                  />
                  <Caption1>{SEGMENT_LABELS[kind]}</Caption1>
                </span>
              ))}
            </div>
          </div>

          <div className={styles.warnings}>
            {analysis.warnings.map((warning) => (
              <MessageBar key={warning} intent="info">
                <MessageBarBody>{warning}</MessageBarBody>
              </MessageBar>
            ))}
          </div>
        </div>
      </section>

      <Caption1 style={{ color: tokens.colorNeutralForeground3, padding: '0 4px' }}>
        边界：本工具只做字符串解析——不做浏览器指纹、不读取你的真实环境、不发任何网络请求、不根据 UA
        做安全判断。内置样本是真实客户端发布的字符串，但「真实存在过的字符串」不等于「当前就是你」：
        UA 可以照抄。要看请求真正带的头，请用「HTTP 客户端」；要看本机的真实环境，请用「设备信息」。
      </Caption1>

      <Divider />
    </div>
  );
}
