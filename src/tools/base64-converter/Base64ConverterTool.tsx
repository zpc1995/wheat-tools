import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Checkbox,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Switch,
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
  ArrowSwap16Regular,
  ArrowUpload16Regular,
  Broom16Regular,
  Checkmark16Regular,
  Copy16Regular,
  DocumentText16Regular,
  Image16Regular,
  Wand16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  bytesToDataUrl,
  classify,
  decodeBase64,
  detectMime,
  encodeBase64,
  encodeBytesToBase64,
  tryFormatJson,
} from './base64Utils';

type Mode = 'encode' | 'decode';

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
  preview: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '14px',
    alignItems: 'flex-start',
  },
  previewImage: {
    maxWidth: '100%',
    maxHeight: '220px',
    borderRadius: '6px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  outputArea: {
    minHeight: '220px',
    maxHeight: '420px',
  },
});

export function Base64ConverterTool() {
  const styles = useStyles();
  const toasterId = useId('b64-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [mode, setMode] = useState<Mode>('encode');
  const [input, setInput] = useState('');
  const [urlSafe, setUrlSafe] = useState(false);
  const [padding, setPadding] = useState(true);
  const [formatJson, setFormatJson] = useState(true);
  const [copied, setCopied] = useState(false);
  const filePicker = useRef<HTMLInputElement>(null);

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
    async (value: string) => {
      const ok = await copyText(value);
      if (ok) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
        notify('已复制');
      } else {
        notify('复制失败，请手动选择');
      }
    },
    [notify],
  );

  const encoded = useMemo(
    () =>
      mode === 'encode'
        ? encodeBase64(input, {
            alphabet: urlSafe ? 'url' : 'standard',
            padding,
          })
        : '',
    [mode, input, urlSafe, padding],
  );

  const decoded = useMemo(
    () => (mode === 'decode' ? decodeBase64(input) : null),
    [mode, input],
  );

  const kind = useMemo(() => {
    if (!decoded?.ok) return null;
    return classify(decoded.bytes, decoded.text);
  }, [decoded]);

  const outputText = useMemo(() => {
    if (mode === 'encode') return encoded;
    if (!decoded?.ok || decoded.text === null) return '';
    if (kind === 'json' && formatJson) {
      return tryFormatJson(decoded.text) ?? decoded.text;
    }
    return decoded.text;
  }, [mode, encoded, decoded, kind, formatJson]);

  const imageUrl = useMemo(() => {
    if (kind !== 'image' || !decoded?.ok) return null;
    return bytesToDataUrl(decoded.bytes, detectMime(decoded.bytes) ?? 'image/png');
  }, [kind, decoded]);

  const swap = useCallback(() => {
    // Carry the current output over as the new input, so encode/decode
    // round-trips do not require manual copy-paste.
    const next = mode === 'encode' ? encoded : outputText;
    setInput(next);
    setMode((current) => (current === 'encode' ? 'decode' : 'encode'));
  }, [mode, encoded, outputText]);

  const download = useCallback(
    (bytes: Uint8Array, mime: string) => {
      const blob = new Blob([bytes as BlobPart], { type: mime });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'decoded.bin';
      link.click();
      URL.revokeObjectURL(url);
    },
    [],
  );

  const handleFile = useCallback(
    async (file: File) => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        setMode('encode');
        setInput(encodeBytesToBase64(bytes));
        notify(`已编码 ${file.name}`);
      } catch {
        notify('读取文件失败');
      }
    },
    [notify],
  );

  const inputLabel = mode === 'encode' ? '原始文本' : 'Base64 文本';
  const outputLabel = mode === 'encode' ? 'Base64 结果' : '解码结果';

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <Switch
            checked={mode === 'decode'}
            onChange={(_, data) => setMode(data.checked ? 'decode' : 'encode')}
            label={mode === 'encode' ? '当前：编码' : '当前：解码'}
          />
          <Tooltip content="把输出填回输入并切换方向" relationship="description" withArrow>
            <Button
              appearance="secondary"
              icon={<ArrowSwap16Regular />}
              onClick={swap}
              disabled={!input}
            >
              交换方向
            </Button>
          </Tooltip>

          {mode === 'encode' && (
            <>
              <Checkbox
                checked={urlSafe}
                onChange={(_, data) => setUrlSafe(Boolean(data.checked))}
                label="URL 安全字符集"
              />
              <Checkbox
                checked={padding}
                onChange={(_, data) => setPadding(Boolean(data.checked))}
                label="保留 = 填充"
              />
            </>
          )}

          {mode === 'decode' && kind === 'json' && (
            <Checkbox
              checked={formatJson}
              onChange={(_, data) => setFormatJson(Boolean(data.checked))}
              label="格式化 JSON"
            />
          )}

          <span className={styles.spacer} />

          {mode === 'encode' && (
            <>
              <input
                ref={filePicker}
                type="file"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFile(file);
                  event.target.value = '';
                }}
              />
              <Button
                appearance="secondary"
                icon={<ArrowUpload16Regular />}
                onClick={() => filePicker.current?.click()}
              >
                文件转 Base64
              </Button>
            </>
          )}
          <Tooltip content="清空" relationship="label" withArrow>
            <Button
              appearance="subtle"
              icon={<Broom16Regular />}
              onClick={() => setInput('')}
              disabled={!input}
              aria-label="清空"
            />
          </Tooltip>
        </div>

        <div className="wt-split">
          <section className="wt-surface" aria-label={inputLabel}>
            <div className="wt-surface__header">
              <DocumentText16Regular />
              <Text as="h2" size={300} weight="semibold">
                {inputLabel}
              </Text>
            </div>
            <div className="wt-surface__body">
              <textarea
                className="wt-code-area"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={
                  mode === 'encode'
                    ? '在此输入要编码的文本…'
                    : '在此粘贴 Base64（支持 URL 安全字符集、无填充、含换行）'
                }
                aria-label={inputLabel}
                spellCheck={false}
              />
            </div>
          </section>

          <section className="wt-surface" aria-label={outputLabel}>
            <div className="wt-surface__header">
              {kind === 'image' ? <Image16Regular /> : <Wand16Regular />}
              <Text as="h2" size={300} weight="semibold">
                {outputLabel}
              </Text>
              {mode === 'decode' && decoded?.ok && (
                <>
                  <Badge
                    appearance="tint"
                    color={kind === 'binary' ? 'warning' : 'brand'}
                    size="small"
                  >
                    {kind === 'json'
                      ? 'JSON'
                      : kind === 'text'
                        ? '文本'
                        : kind === 'image'
                          ? '图片'
                          : kind === 'pdf'
                            ? 'PDF'
                            : kind === 'empty'
                              ? '空'
                              : '二进制'}
                  </Badge>
                  <Caption1>{decoded.bytes.length} 字节</Caption1>
                </>
              )}
              <span className={styles.spacer} />
              {outputText && (
                <Tooltip content="复制结果" relationship="label" withArrow>
                  <Button
                    appearance="subtle"
                    icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
                    onClick={() => copy(outputText)}
                    aria-label="复制结果"
                  />
                </Tooltip>
              )}
              {mode === 'decode' && kind === 'binary' && decoded?.ok && (
                <Button
                  appearance="secondary"
                  size="small"
                  onClick={() =>
                    download(decoded.bytes, detectMime(decoded.bytes) ?? 'application/octet-stream')
                  }
                >
                  下载二进制
                </Button>
              )}
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              {mode === 'decode' && !decoded?.ok ? (
                <MessageBar intent="error">
                  <MessageBarBody>
                    <MessageBarTitle>解码失败</MessageBarTitle>
                    {decoded?.ok === false ? decoded.error : null}
                  </MessageBarBody>
                </MessageBar>
              ) : imageUrl ? (
                <div className={styles.preview}>
                  <img src={imageUrl} alt="解码后的图片预览" className={styles.previewImage} />
                  <Caption1 className={styles.hint}>
                    Base64 里包含图片，可直接预览
                  </Caption1>
                </div>
              ) : outputText ? (
                <textarea
                  className={`wt-code-area ${styles.outputArea}`}
                  value={outputText}
                  readOnly
                  aria-label={outputLabel}
                  spellCheck={false}
                />
              ) : (
                <div className="wt-empty">
                  <Wand16Regular />
                  <Text weight="semibold">等待输入</Text>
                  <Caption1>
                    {mode === 'encode'
                      ? '输入文本后，这里会显示 Base64 结果。'
                      : '粘贴 Base64 后，这里会显示解码内容；图片会直接预览。'}
                  </Caption1>
                </div>
              )}
            </div>
          </section>
        </div>

        {mode === 'decode' && kind === 'binary' && (
          <MessageBar intent="warning">
            <MessageBarBody>
              <MessageBarTitle>解码结果不是有效 UTF-8</MessageBarTitle>
              内容可能是二进制（图片、压缩包等）。可以下载后用对应程序打开。
            </MessageBarBody>
          </MessageBar>
        )}
      </div>
    </>
  );
}
