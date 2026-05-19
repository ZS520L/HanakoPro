/**
 * PreviewRenderer — PreviewItem 内容的声明式渲染
 *
 * 替代 PreviewPanel 中命令式 DOM 构建的 switch/case useEffect。
 * 每种 previewItem 类型对应一个 JSX 分支或子组件。
 */

import { useEffect, useMemo, useRef } from 'react';
import { renderMarkdownPreview } from '../../utils/markdown';
import { parseCSV, injectCopyButtons } from '../../utils/format';
import { fileIconSvg } from '../../utils/icons';
import { openFilePreview } from '../../utils/file-preview';
import { useStore } from '../../stores';
import { useMermaidDiagrams } from '../../hooks/use-mermaid-diagrams';
import type { PreviewItem } from '../../types';

// ── LegacyMediaFallback ──
// image / svg 旧类型 previewItem 的隔离渲染组件。
// currentSessionPath 订阅收窄到此组件，不影响 html/markdown/code/csv 等主流路径。

function LegacyMediaFallback({ previewItem }: { previewItem: PreviewItem }) {
  const currentSessionPath = useStore(s => s.currentSessionPath);

  if (process.env.NODE_ENV !== 'production') {
    console.warn('[PreviewRenderer] 旧类型 image/svg previewItem，走 fallback，请通过文件重新打开以使用新 MediaViewer');
  }

  const onOpen = () => {
    if (!previewItem.filePath || !previewItem.ext) return;
    const context = currentSessionPath
      ? { origin: 'session' as const, sessionPath: currentSessionPath }
      : { origin: 'desk' as const };
    openFilePreview(previewItem.filePath, previewItem.title, previewItem.ext, context);
  };

  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 200,
        color: 'var(--text-muted)',
        cursor: 'pointer',
        fontSize: '0.85rem',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
    >
      <span>此图片预览已升级，点此在新查看器打开</span>
    </div>
  );
}

interface PreviewRendererProps {
  previewItem: PreviewItem;
}

// ── MarkdownPreview ──

function MarkdownPreview({ content, filePath }: { content: string; filePath?: string }) {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (divRef.current) {
      injectCopyButtons(divRef.current);
    }
  }, [content]);
  useMermaidDiagrams(divRef, [content]);

  return (
    <div
      ref={divRef}
      className="preview-markdown md-content"
      dangerouslySetInnerHTML={{
        __html: renderMarkdownPreview(content, {
          filePath,
          getFileUrl: window.platform?.getFileUrl,
        }),
      }}
    />
  );
}

// ── CsvPreview ──

function CsvPreview({ content }: { content: string }) {
  const rows = parseCSV(content);
  if (rows.length === 0) {
    return <div className="preview-csv"><table /></div>;
  }

  const headerRow = rows[0];
  const bodyRows = rows.slice(1);

  return (
    <div className="preview-csv">
      <table>
        <thead>
          <tr>
            {headerRow.map((cell, i) => (
              <th key={`csv-h-${i}`}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, ri) => (
            <tr key={`csv-r-${ri}`}>
              {row.map((cell, ci) => (
                <td key={`csv-c-${ri}-${ci}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── PdfPreview ──
// data: URL 在 Electron 中无法渲染大 PDF，改用 blob URL 触发 Chromium 内置查看器

function PdfPreview({ content }: { content: string }) {
  const url = useMemo(() => {
    const raw = atob(content);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  }, [content]);

  useEffect(() => {
    return () => URL.revokeObjectURL(url);
  }, [url]);

  return <iframe className="preview-pdf" src={`${url}#toolbar=0&navpanes=0`} />;
}

// ── FileInfoPreview ──

function FileInfoPreview({ previewItem }: { previewItem: PreviewItem }) {
  const t = window.t ?? ((p: string) => p);
  const ext = previewItem.ext || '';

  return (
    <div className="preview-file-info">
      <div
        className="preview-file-icon"
        dangerouslySetInnerHTML={{ __html: fileIconSvg(ext) }}
      />
      <div className="preview-file-name">{previewItem.title}</div>
      <div className="preview-file-ext">
        {ext.toUpperCase()} {t('desk.fileLabel')}
      </div>
      <button
        className="preview-file-open-btn"
        onClick={() => {
          if (previewItem.filePath) window.platform?.openFile?.(previewItem.filePath);
        }}
      >
        {t('desk.openWithDefault')}
      </button>
    </div>
  );
}

// ── PreviewRenderer ──

export function PreviewRenderer({ previewItem }: PreviewRendererProps) {
  switch (previewItem.type) {
    case 'html':
      return (
        <iframe
          sandbox="allow-scripts"
          srcDoc={previewItem.content}
        />
      );

    case 'markdown':
      return <MarkdownPreview content={previewItem.content} filePath={previewItem.filePath} />;

    case 'code':
      return (
        <pre className="preview-code">
          <code className={previewItem.language ? `language-${previewItem.language}` : undefined}>
            {previewItem.content}
          </code>
        </pre>
      );

    case 'csv':
      return <CsvPreview content={previewItem.content} />;

    // image / svg：旧类型 previewItem 的 fallback。新路径不再产生此类 previewItem，
    // 持久化或旧 session 恢复时可能命中。点击后按 owner 路由到统一的 MediaViewer。
    case 'image':
    case 'svg':
      return <LegacyMediaFallback previewItem={previewItem} />;

    case 'pdf':
      return <PdfPreview content={previewItem.content} />;

    case 'docx':
      return (
        <div
          className="preview-docx md-content"
          dangerouslySetInnerHTML={{ __html: previewItem.content }}
        />
      );

    case 'xlsx':
      return (
        <div
          className="preview-csv"
          dangerouslySetInnerHTML={{ __html: previewItem.content }}
        />
      );

    case 'file-info':
      return <FileInfoPreview previewItem={previewItem} />;

    default:
      return (
        <pre className="preview-code">{previewItem.content}</pre>
      );
  }
}
