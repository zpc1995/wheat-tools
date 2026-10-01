import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Text,
  Tooltip,
  makeStyles,
  tokens,
  Toast,
  ToastTitle,
  Toaster,
  useId,
  useToastController,
} from '@fluentui/react-components';
import {
  ArrowUpload16Regular,
  QrCodeRegular,
  Broom16Regular,
  Checkmark16Regular,
  Copy16Regular,
  DocumentText16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import { JsonTree, type JsonValue } from '../json-formatter/JsonTree';
import {
  MAX_DECODE_DIMENSION,
  MAX_IMAGE_BYTES,
  classify,
  decodeImage,
  toTextReport,
  type Classification,
} from './qrReadUtils';

interface Loaded {
  name: string;
  bytes: number;
  /** Data URL for the preview. */
  preview: string;
  width: number;
  height: number;
}

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
  },
  spacer: {
    flex: '1 1 auto',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  preview: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    width: '100%',
    minHeight: '200px',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  previewImg: {
    maxWidth: '100%',
    maxHeight: '320px',
    objectFit: 'contain',
  },
  result: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  field: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    padding: '8px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  fieldLabel: {
    flex: 'none',
    width: '150px',
    color: tokens.colorNeutralForeground3,
  },
  fieldValue: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  raw: {
    padding: '12px 14px',
    width: '100%',
    maxHeight: '300px',
    overflow: 'auto',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12.5px',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    userSelect: 'text',
  },
  notes: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '14px',
    width: '100%',
  },
  note: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
  },
});

export function QrcodeReaderTool() {
  const styles = useStyles();
  const toasterId = useId('qrr-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [image, setImage] = useState<Loaded | null>(null);
  const [decoded, setDecoded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'fields' | 'raw'>('fields');
  const [copied, setCopied] = useState<string | null>(null);

  const picker = useRef<HTMLInputElement>(null);

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

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setDecoded(null);

      if (!file.type.startsWith('image/')) {
        setError(`不支持的文件类型 ${file.type || '（未知）'}，请选择图片。`);
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError(
          `图片 ${(file.size / 1024 / 1024).toFixed(1)} MB 超过上限 ` +
            `${MAX_IMAGE_BYTES / 1024 / 1024} MB。`,
        );
        return;
      }

      setBusy(true);
      const objectUrl = URL.createObjectURL(file);
      try {
        const element = await new Promise<HTMLImageElement>((resolve, reject) => {
          const node = new Image();
          node.onload = () => resolve(node);
          node.onerror = () => reject(new Error('无法解码该图片'));
          node.src = objectUrl;
        });

        // Decode at as close to native resolution as the cap allows. Resizing
        // down is what makes dense codes unreadable, so it is a last resort
        // rather than the default.
        const longest = Math.max(element.naturalWidth, element.naturalHeight);
        const scale = longest > MAX_DECODE_DIMENSION ? MAX_DECODE_DIMENSION / longest : 1;
        const width = Math.max(1, Math.round(element.naturalWidth * scale));
        const height = Math.max(1, Math.round(element.naturalHeight * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法创建画布上下文');
        context.drawImage(element, 0, 0, width, height);

        const pixels = context.getImageData(0, 0, width, height);
        const result = decodeImage({
          data: pixels.data,
          width,
          height,
        });

        setImage({
          name: file.name,
          bytes: file.size,
          preview: canvas.toDataURL('image/png'),
          width: element.naturalWidth,
          height: element.naturalHeight,
        });

        if (result.ok) {
          setDecoded(result.text);
          setView('fields');
        } else {
          setError(result.error);
        }
      } catch (caught) {
        setImage(null);
        setError(caught instanceof Error ? caught.message : '读取失败');
      } finally {
        URL.revokeObjectURL(objectUrl);
        setBusy(false);
      }
    },
    [],
  );

  const classification: Classification | null = useMemo(
    () => (decoded === null ? null : classify(decoded)),
    [decoded],
  );

  /** JSON payloads get the tree view; everything else shows fields. */
  const jsonValue = useMemo(() => {
    if (decoded === null || classification?.kind !== 'json') return null;
    try {
      return JSON.parse(decoded) as JsonValue;
    } catch {
      return null;
    }
  }, [decoded, classification]);

  const dangerous = classification?.kind === 'unknown-scheme';

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <input
        ref={picker}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          event.target.value = '';
        }}
      />

      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <Button
            appearance="primary"
            icon={<ArrowUpload16Regular />}
            onClick={() => picker.current?.click()}
          >
            选择二维码图片
          </Button>
          {image && (
            <Badge appearance="tint" color="brand" size="medium">
              {image.name} · {image.width}×{image.height}
            </Badge>
          )}
          {busy && <Caption1 className={styles.hint}>识别中…</Caption1>}
          <span className={styles.spacer} />
          <Button
            appearance="subtle"
            icon={<Broom16Regular />}
            onClick={() => {
              setImage(null);
              setDecoded(null);
              setError(null);
            }}
            disabled={!image && !error}
          >
            清除
          </Button>
        </div>

        {/* The reason this tool shows labelled fields instead of a bare string. */}
        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>
              <Warning16Regular /> 二维码的内容无法用眼睛预读
            </MessageBarTitle>
            这正是二维码钓鱼成立的原因：地址被编码进图形，你无法在扫之前看出它指向哪里。
            所以本工具把内容拆成带标签的字段展示，并且不会把结果变成
            可点击的链接——尤其是 <code>javascript:</code> 这类协议会被单独标出并拦下。
            识别在浏览器本地完成，图片不会上传。
          </MessageBarBody>
        </MessageBar>

        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}

        {!image && !error && (
          <section className="wt-surface">
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className="wt-empty">
                <QrCodeRegular />
                <Text weight="semibold">选择一张包含二维码的图片</Text>
                <Caption1>
                  支持 PNG / JPEG / WebP 等；会自动尝试反色（浅色码）情况。
                  信息量大的二维码需要足够分辨率——低分辨率原图放大也无法补回细节。
                </Caption1>
              </div>
            </div>
          </section>
        )}

        {image && (
          <div className="wt-split">
            <section className="wt-surface" aria-label="图片预览">
              <div className="wt-surface__header">
                <Text size={300} weight="semibold">
                  图片
                </Text>
                <span className={styles.spacer} />
                <Caption1 className={styles.hint}>
                  {(image.bytes / 1024).toFixed(0)} KB
                </Caption1>
              </div>
              <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                <div className={styles.preview}>
                  <img className={styles.previewImg} src={image.preview} alt="上传的二维码图片" />
                </div>
              </div>
            </section>

            <section className="wt-surface" aria-label="识别结果">
              <div className="wt-surface__header">
                <DocumentText16Regular />
                <Text size={300} weight="semibold">
                  识别结果
                </Text>
                {classification && (
                  <Badge
                    appearance="tint"
                    size="small"
                    color={
                      dangerous
                        ? 'danger'
                        : classification.kind === 'url'
                          ? 'warning'
                          : 'success'
                    }
                  >
                    {classification.label}
                  </Badge>
                )}
                <span className={styles.spacer} />
                {decoded !== null && (
                  <>
                    {jsonValue && (
                      <Tooltip content="切换字段/结构视图" relationship="label" withArrow>
                        <Button
                          appearance="subtle"
                          size="small"
                          onClick={() =>
                            setView((current) => (current === 'fields' ? 'raw' : 'fields'))
                          }
                        >
                          {view === 'fields' ? '结构' : '字段'}
                        </Button>
                      </Tooltip>
                    )}
                    <Tooltip content="复制完整报告" relationship="label" withArrow>
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={copied === 'r' ? <Checkmark16Regular /> : <Copy16Regular />}
                        onClick={() =>
                          copy(
                            classification
                              ? toTextReport(decoded, classification)
                              : decoded,
                            'r',
                          )
                        }
                        aria-label="复制完整报告"
                      />
                    </Tooltip>
                    <Tooltip content="仅复制原始内容" relationship="label" withArrow>
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={copied === 'raw' ? <Checkmark16Regular /> : <Copy16Regular />}
                        onClick={() => copy(decoded, 'raw')}
                        aria-label="仅复制原始内容"
                      />
                    </Tooltip>
                  </>
                )}
              </div>

              <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                {decoded === null || !classification ? (
                  <div style={{ padding: '16px 14px' }}>
                    <Caption1 className={styles.hint}>
                      未能识别出二维码内容。
                    </Caption1>
                  </div>
                ) : view === 'raw' && jsonValue ? (
                  <div className={styles.raw}>
                    <JsonTree value={jsonValue} defaultExpandDepth={4} />
                  </div>
                ) : (
                  <div className={styles.result}>
                    {classification.fields.map((field) => (
                      <div key={`${field.label}-${field.value}`} className={styles.field}>
                        <span className={styles.fieldLabel}>{field.label}</span>
                        <span
                          className={styles.fieldValue}
                          style={
                            field.sensitive
                              ? { color: tokens.colorPaletteRedForeground1 }
                              : undefined
                          }
                        >
                          {field.value}
                        </span>
                        <Tooltip content="复制该值" relationship="label" withArrow>
                          <Button
                            appearance="subtle"
                            size="small"
                            icon={
                              copied === field.label ? (
                                <Checkmark16Regular />
                              ) : (
                                <Copy16Regular />
                              )
                            }
                            onClick={() => copy(field.value, field.label)}
                            aria-label="复制该值"
                          />
                        </Tooltip>
                      </div>
                    ))}

                    <Divider />

                    <div className={styles.raw}>{decoded}</div>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {classification && classification.notes.length > 0 && (
          <section className="wt-surface" aria-label="安全提示">
            <div className="wt-surface__header">
              <Warning16Regular />
              <Text size={300} weight="semibold">
                安全提示
              </Text>
              <span className={styles.spacer} />
              <Caption1 className={styles.hint}>{classification.notes.length} 条</Caption1>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.notes}>
                {classification.notes.map((note) => (
                  <div key={note} className={styles.note}>
                    <Warning16Regular
                      style={{ flex: 'none', marginTop: 2, color: tokens.colorPaletteMarigoldForeground1 }}
                    />
                    <Caption1 className={styles.hint}>{note}</Caption1>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        <Divider />
      </div>
    </>
  );
}
