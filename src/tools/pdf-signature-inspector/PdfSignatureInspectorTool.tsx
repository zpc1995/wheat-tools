import {
  Badge,
  Button,
  Caption1,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowUploadRegular,
  BroomRegular,
  CopyRegular,
  DocumentPdfRegular,
  ShieldQuestionRegular,
  WarningRegular,
} from '@fluentui/react-icons';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import {
  MAX_PDF_BYTES,
  inspectPdf,
  type PdfInspection,
  type SignatureInfo,
} from './pdfSignatureUtils';
import {
  describeByteRangeValues,
  describeCoverage,
  describeSegments,
  formatByteSize,
  formatPdfDate,
} from './pdfTextUtils';

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    width: '100%',
    minWidth: 0,
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  spacer: {
    flex: 1,
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '10px 20px',
    width: '100%',
  },
  metaItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minWidth: 0,
  },
  metaLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: '12px',
  },
  metaValue: {
    fontFamily: 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace',
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
  },
  signature: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '14px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '8px',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  signatureHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  coverageLine: {
    padding: '10px 12px',
    borderRadius: '6px',
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontVariantNumeric: 'tabular-nums',
  },
  headCell: {
    textAlign: 'left',
    padding: '6px 10px',
    color: tokens.colorNeutralForeground3,
    fontWeight: 600,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    whiteSpace: 'nowrap',
  },
  cell: {
    padding: '6px 10px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    fontFamily: 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace',
    overflowWrap: 'anywhere',
  },
  verdict: {
    fontWeight: 600,
  },
  list: {
    margin: 0,
    paddingLeft: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  notice: {
    color: tokens.colorNeutralForeground3,
    fontSize: '13px',
    lineHeight: 1.6,
  },
});

/** Files larger than this are refused before any parsing happens. */
const FILE_INPUT_ACCEPT = 'application/pdf,.pdf';

/**
 * Copies text, falling back to a hidden textarea.
 *
 * The async Clipboard API is unavailable on insecure origins, and this app is
 * routinely opened over plain HTTP on a LAN address. Reporting "copied" when the
 * copy silently did nothing would be worse than failing.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

function MetaItem({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <div className={styles.metaItem}>
      <Caption1 className={styles.metaLabel}>{label}</Caption1>
      <Text className={styles.metaValue}>{value}</Text>
    </div>
  );
}

/**
 * One label/value row, omitted entirely when the signature does not declare it.
 *
 * `cellClass` is passed in rather than obtained from `useStyles()` here: calling a
 * hook inside a component that returns early is legal only while the early return
 * comes after every hook, and a reader cannot be expected to hold that in mind for
 * a four-line helper.
 */
function FieldRow({
  label,
  value,
  cellClass,
}: {
  label: string;
  value: string | null;
  cellClass: string;
}) {
  if (!value) return null;
  return (
    <tr>
      <td className={cellClass} style={{ width: '170px' }}>
        {label}
      </td>
      <td className={cellClass}>{value}</td>
    </tr>
  );
}

/**
 * The coverage verdict for one signature.
 *
 * Worded with care: `reachesEnd` means the signature was computed over every byte
 * up to the end of the file. It does **not** mean the signature is trustworthy, so
 * the wording never uses the word "valid" and always names what was measured.
 */
function CoverageVerdict({ signature }: { signature: SignatureInfo }) {
  const styles = useStyles();
  const range = signature.byteRange;

  if (!range) {
    return (
      <MessageBar intent="warning">
        <MessageBarBody>
          这个签名对象里没有 /ByteRange，无法判断它覆盖了哪些字节。缺少 /ByteRange 的“签名”结构不完整。
        </MessageBarBody>
      </MessageBar>
    );
  }

  if (!range.usable) {
    return (
      <MessageBar intent="error">
        <MessageBarBody>
          <MessageBarTitle>/ByteRange 结构异常</MessageBarTitle>
          {range.errors.join('；')}。这一段无法参与覆盖范围计算。
        </MessageBarBody>
      </MessageBar>
    );
  }

  const reachesEnd = range.reachesEnd;
  return (
    <MessageBar intent={reachesEnd ? 'success' : 'warning'}>
      <MessageBarBody>
        <MessageBarTitle>
          {reachesEnd ? '签名覆盖到文件末尾' : '签名未覆盖整个文件'}
        </MessageBarTitle>
        <div className={styles.coverageLine}>
          {describeCoverage(range)}
          {' '}
          （已签 {range.signedBytes} 字节，约 {formatByteSize(range.signedBytes)}；区段间空洞{' '}
          {range.gapBytes} 字节。）
        </div>
        {!reachesEnd && (
          <div style={{ marginTop: 6 }}>
            末尾 {range.trailingBytes} 字节不在本签名的范围内。这可能是正常的增量更新（例如后来又补签了一次），
            也可能是签名之后被追加了内容——仅凭结构无法区分，只有做密码学验证才能。
          </div>
        )}
        {!range.coversTrailer && (
          <div style={{ marginTop: 6 }}>
            本文件的尾部结构（startxref）也不在这个签名的范围内，说明它对应的是更早的一版文件。
          </div>
        )}
        {range.problems.length > 0 && (
          <ul className={styles.list} style={{ marginTop: 6 }}>
            {range.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
      </MessageBarBody>
    </MessageBar>
  );
}

function SignatureCard({ signature, index }: { signature: SignatureInfo; index: number }) {
  const styles = useStyles();
  const range = signature.byteRange;

  return (
    <div className={styles.signature}>
      <div className={styles.signatureHead}>
        <Text as="h3" size={300} weight="semibold" style={{ margin: 0 }}>
          签名 {index + 1}
        </Text>
        {signature.objectNumber >= 0 && (
          <Badge appearance="tint" color="informative" size="small">
            对象 {signature.objectNumber}
          </Badge>
        )}
        {signature.typedAsSig && (
          <Badge appearance="tint" color="brand" size="small">
            /Type /Sig
          </Badge>
        )}
        <span className={styles.spacer} />
        {range?.usable && (
          <Badge
            appearance="tint"
            color={range.reachesEnd ? 'success' : 'warning'}
            size="small"
          >
            覆盖 {range.coveragePercent}%
          </Badge>
        )}
      </div>

      <CoverageVerdict signature={signature} />

      <table className={styles.table}>
        <tbody>
          <FieldRow cellClass={styles.cell} label="签名者名称 /Name" value={signature.name} />
          <FieldRow
            cellClass={styles.cell}
            label="签名时间 /M"
            value={
              signature.signingTime
                ? `${formatPdfDate(signature.signingTime) ?? signature.signingTime}（原值 ${signature.signingTime}）`
                : null
            }
          />
          <FieldRow cellClass={styles.cell} label="原因 /Reason" value={signature.reason} />
          <FieldRow cellClass={styles.cell} label="位置 /Location" value={signature.location} />
          <FieldRow cellClass={styles.cell} label="联系方式 /ContactInfo" value={signature.contactInfo} />
          <FieldRow
            cellClass={styles.cell}
            label="子过滤器 /SubFilter"
            value={signature.subFilter ?? '未声明'}
          />
          <FieldRow
            cellClass={styles.cell}
            label="处理器 /Filter"
            value={signature.filter ?? '未声明'}
          />
          <FieldRow
            cellClass={styles.cell}
            label="字段路径"
            value={signature.fieldNames.length > 0 ? signature.fieldNames.join('、') : '（没有字段引用这个对象）'}
          />
        </tbody>
      </table>

      {range && (
        <div>
          <Caption1 className={styles.metaLabel}>/ByteRange 覆盖范围</Caption1>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.headCell}>原始 /ByteRange</th>
                <th className={styles.headCell}>解析为区段</th>
                <th className={styles.headCell}>已签字节</th>
                <th className={styles.headCell}>占全文</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={styles.cell}>{describeByteRangeValues(range.values)}</td>
                <td className={styles.cell}>{describeSegments(range)}</td>
                <td className={styles.cell}>{range.signedBytes}</td>
                <td className={styles.cell}>{range.coveragePercent}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <Caption1 className={styles.notice}>
        /Contents 里是 {signature.contentsBytes ?? '未知'}
        字节的 CMS 数据，本工具**没有打开它**：签名值、证书、时间戳都没有被解析或验证。
        {signature.otherKeys.length > 0 && ` 另有本工具未解读的键：${signature.otherKeys.join('、')}。`}
      </Caption1>
    </div>
  );
}

/**
 * The standing disclaimer.
 *
 * Deliberately the first thing on the page and impossible to miss: this tool reads
 * *structure* only. A reader who mistakes it for a verifier would treat "covers the
 * whole file" as "the signature is good", and those are different claims.
 */
function NoVerificationNotice() {
  const styles = useStyles();
  return (
    <MessageBar intent="warning" icon={<ShieldQuestionRegular />}>
      <MessageBarBody>
        <MessageBarTitle>本工具只读结构，不做密码学验证</MessageBarTitle>
        <div className={styles.notice}>
          它不会、也无法回答“这个签名是否有效”。具体来说，下面这些**一律没有做**：
          <ul className={styles.list}>
            <li>不解析签名值本身（不打开 CMS / PKCS#7，不算摘要，不验签名数学）</li>
            <li>不验证书链、不判断证书是否可信、是否过期、是否被吊销</li>
            <li>不验证时间戳签名，也不判断签名时间是否可信</li>
            <li>不检查文档权限（DocMDP）或认证签名状态</li>
          </ul>
          所以：<strong>“覆盖整个文件”不等于“签名有效”</strong>
          ，它只说明这段签名的字节范围一直算到了文件末尾；字段里显示的签名者名称、时间、原因也都是文档自己写的字符串，
          任何人都可以在签名之后的新版本里写上去。需要有效性结论时，请用 Acrobat、pdfsig、qpdf
          这类带完整密码学栈的工具。
        </div>
      </MessageBarBody>
    </MessageBar>
  );
}

function InspectionReport({ report }: { report: PdfInspection }) {
  const styles = useStyles();

  const pageText =
    report.pageCount === null
      ? '未能确定'
      : `${report.pageCount}${report.pageCountSource === 'pages-only' ? '（按 /Type /Page 计数，页面树不可达）' : ''}`;

  return (
    <div className={styles.stack}>
      <Text as="h2" size={300} weight="semibold">
        PDF 元信息
      </Text>
      <div className={styles.metaGrid}>
        <MetaItem label="版本" value={report.headerVersion ?? '未知'} />
        <MetaItem label="页数" value={pageText} />
        <MetaItem label="文件大小" value={formatByteSize(report.fileSize)} />
        <MetaItem label="是否加密" value={report.encrypted ? '已加密' : '未加密'} />
        <MetaItem label="是否线性化" value={report.linearized ? '是' : '否'} />
        <MetaItem
          label="增量更新次数"
          value={report.incrementalUpdates > 0 ? `${report.incrementalUpdates} 次` : '无'}
        />
        <MetaItem label="签名数量" value={String(report.signatures.length)} />
        <MetaItem label="未签名的签名字段" value={String(report.unsignedSignatureFields.length)} />
        {report.catalogVersion && (
          <MetaItem label="目录 /Version" value={`${report.catalogVersion}（高于文件头）`} />
        )}
      </div>

      {report.warnings.length > 0 && (
        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>解析限制</MessageBarTitle>
            <ul className={styles.list}>
              {report.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </MessageBarBody>
        </MessageBar>
      )}

      <Divider />

      <Text as="h2" size={300} weight="semibold">
        签名字段
      </Text>
      {report.signatures.length === 0 ? (
        <MessageBar intent="info">
          <MessageBarBody>
            没有找到签名对象。这份 PDF 里不存在 /Type /Sig 字典，也没有任何 /FT /Sig 字段的 /V
            指向签名字典——也就是说它没有被签署（或者签署信息已被移除）。
          </MessageBarBody>
        </MessageBar>
      ) : (
        report.signatures.map((signature, index) => (
          <SignatureCard
            key={`${signature.objectNumber}-${index}`}
            signature={signature}
            index={index}
          />
        ))
      )}

      {report.unsignedSignatureFields.length > 0 && (
        <>
          <Divider />
          <Text as="h2" size={300} weight="semibold">
            尚未签名的签名字段
          </Text>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.headCell}>字段路径</th>
                <th className={styles.headCell}>说明</th>
              </tr>
            </thead>
            <tbody>
              {report.unsignedSignatureFields.map((field) => (
                <tr key={field.path}>
                  <td className={styles.cell}>{field.path}</td>
                  <td className={styles.cell}>{field.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export function PdfSignatureInspectorTool() {
  const styles = useStyles();
  const { t } = useI18n();
  const picker = useRef<HTMLInputElement>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => (bytes ? inspectPdf(bytes, fileName) : null), [bytes, fileName]);

  const load = useCallback(async (file: File) => {
    setError(null);
    setCopied(false);
    if (file.size > MAX_PDF_BYTES) {
      setBytes(null);
      setFileName('');
      setError(
        `文件 ${formatByteSize(file.size)} 超过本工具的 ${formatByteSize(MAX_PDF_BYTES)} 上限，已拒绝读取。` +
          '更大的文件请用命令行工具（如 pdfsig / qpdf）检查。',
      );
      return;
    }
    setBusy(true);
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      setBytes(data);
      setFileName(file.name);
    } catch {
      setBytes(null);
      setFileName('');
      setError('读取文件失败。');
    } finally {
      setBusy(false);
    }
  }, []);

  const copySummary = useCallback(async () => {
    if (!result || !result.ok) return;
    const lines: string[] = [
      `文件：${result.report.fileName || '未命名'}`,
      `版本：${result.report.headerVersion ?? '未知'}　页数：${result.report.pageCount ?? '未知'}　大小：${formatByteSize(result.report.fileSize)}`,
      `加密：${result.report.encrypted ? '是' : '否'}　线性化：${result.report.linearized ? '是' : '否'}　增量更新：${result.report.incrementalUpdates}`,
      `签名数量：${result.report.signatures.length}`,
      '注意：本结果只反映文档结构，未做任何密码学验证。',
    ];
    result.report.signatures.forEach((signature, index) => {
      lines.push(
        '',
        `签名 ${index + 1}（对象 ${signature.objectNumber}）`,
        `  字段：${signature.fieldNames.join('、') || '（无）'}`,
        `  名称：${signature.name ?? '（未声明）'}`,
        `  时间：${signature.signingTime ?? '（未声明）'}`,
        `  原因：${signature.reason ?? '（未声明）'}`,
        `  位置：${signature.location ?? '（未声明）'}`,
        `  SubFilter：${signature.subFilter ?? '（未声明）'}`,
        `  ByteRange：${describeByteRangeValues(signature.byteRange?.values ?? null)}`,
        `  覆盖：${describeCoverage(signature.byteRange)}`,
      );
    });
    const ok = await copyText(lines.join('\n'));
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 1600);
  }, [result]);

  return (
    <>
      <input
        ref={picker}
        type="file"
        accept={FILE_INPUT_ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void load(file);
          event.target.value = '';
        }}
      />

      <div className={styles.stack}>
        <NoVerificationNotice />

        <div className={styles.toolbar}>
          <Button
            appearance="primary"
            icon={<ArrowUploadRegular />}
            onClick={() => picker.current?.click()}
            disabled={busy}
          >
            选择 PDF 文件
          </Button>
          {busy && <Spinner size="tiny" label="读取中" />}
          {bytes && (
            <Badge appearance="tint" color="brand" size="medium">
              {fileName || '未命名'}
            </Badge>
          )}
          {bytes && (
            <Caption1 className={styles.hint}>
              {formatByteSize(bytes.length)} · {bytes.length.toLocaleString()} 字节
            </Caption1>
          )}
          <span className={styles.spacer} />
          <Button
            appearance="subtle"
            icon={<CopyRegular />}
            onClick={() => void copySummary()}
            disabled={!result || !result.ok}
          >
            {copied ? t('common.copied') : '复制摘要'}
          </Button>
          <Button
            appearance="subtle"
            icon={<BroomRegular />}
            onClick={() => {
              setBytes(null);
              setFileName('');
              setError(null);
            }}
            disabled={!bytes && !error}
          >
            清除
          </Button>
        </div>

        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}

        {result && !result.ok && (
          <MessageBar intent="error" icon={<WarningRegular />}>
            <MessageBarBody>
              <MessageBarTitle>无法解析</MessageBarTitle>
              {result.message}
            </MessageBarBody>
          </MessageBar>
        )}

        {!bytes && !error && (
          <section className="wt-surface">
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className="wt-empty">
                <DocumentPdfRegular />
                <Text weight="semibold">选择一个 PDF 文件开始检查</Text>
                <Caption1>
                  文件只在本地读取，不会上传。上限 {formatByteSize(MAX_PDF_BYTES)}。
                </Caption1>
              </div>
            </div>
          </section>
        )}

        {result && result.ok && <InspectionReport report={result.report} />}
      </div>
    </>
  );
}
