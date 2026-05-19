/**
 * file-preview.ts — 文件预览工具函数
 *
 * 从 file-cards-shim.ts 提取，供 React 组件直接 import。
 */

import type { PreviewItem } from '../types';
import { openPreview } from '../stores/preview-actions';
import { inferKindByExt, isMediaKind } from './file-kind';
import { openMediaViewerFromContext } from './open-media-viewer';
import { showError } from './ui-helpers';


// ── 可在 Preview 面板中预览的文件类型 ──
// 注意：image / svg 类型由 MediaViewer 处理，不再进入 Preview 面板。

export const PREVIEWABLE_EXTS: Record<string, string> = {
  html: 'html', htm: 'html',
  md: 'markdown', markdown: 'markdown',
  js: 'code', ts: 'code', jsx: 'code', tsx: 'code',
  py: 'code', css: 'code', json: 'code', yaml: 'code', yml: 'code',
  xml: 'code', sql: 'code', sh: 'code', bash: 'code',
  txt: 'code',
  c: 'code', cpp: 'code', h: 'code', java: 'code',
  rs: 'code', go: 'code', rb: 'code', php: 'code',
  csv: 'csv', pdf: 'pdf',
  docx: 'docx', xlsx: 'xlsx', xls: 'xlsx',
};

export const BINARY_PREVIEW_TYPES = new Set(['pdf']);

interface PreviewReadResult {
  content: string;
  fileVersion?: PreviewItem['fileVersion'];
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function readFileForPreviewWithVersion(filePath: string, ext: string): Promise<PreviewReadResult | null> {
  const previewType = PREVIEWABLE_EXTS[ext];
  if (!previewType) return null;
  const p = window.platform;
  if (!p) return null;
  if (previewType === 'docx') {
    const content = await p.readDocxHtml?.(filePath);
    return content == null ? null : { content };
  }
  if (previewType === 'xlsx') {
    const content = await p.readXlsxHtml?.(filePath);
    return content == null ? null : { content };
  }
  if (BINARY_PREVIEW_TYPES.has(previewType)) {
    const content = await p.readFileBase64?.(filePath);
    return content == null ? null : { content };
  }

  const snapshot = await p.readFileSnapshot?.(filePath);
  if (snapshot) return { content: snapshot.content, fileVersion: snapshot.version };

  const content = await p.readFile?.(filePath);
  return content == null ? null : { content };
}

export async function readFileForPreview(filePath: string, ext: string): Promise<string | null> {
  return (await readFileForPreviewWithVersion(filePath, ext))?.content ?? null;
}

/**
 * 打开文件预览：读取文件内容 → 创建 PreviewItem → 打开预览面板
 *
 * @param context 调用上下文。media 类型（image/svg/video）会按 context 分流到 MediaViewer；
 *   其它类型走 Preview 面板。context 必须由调用方显式提供，不从 store 推导。
 */
export async function openFilePreview(
  filePath: string,
  label: string,
  ext: string,
  context?: {
    origin?: 'desk' | 'session';
    sessionPath?: string;
    messageId?: string;
    blockIdx?: number;
  },
): Promise<void> {
  const fileName = label || filePath.split('/').pop() || filePath;

  try {
    if (ext === 'skill') {
      // .skill 文件可能是纯文本也可能是 zip，先尝试读取内容在预览面板展示
      const name = fileName.replace(/\.skill$/, '');
      const content = await window.platform?.readFile?.(filePath);
      if (content != null) {
        const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
        const previewItem: PreviewItem = {
          id: `skill-${name}`,
          type: 'markdown',
          title: name,
          content: body,
        };
        openPreview(previewItem);
        return;
      }
      // 读取失败（可能是 zip 格式），尝试 skill viewer
      window.platform?.openSkillViewer?.({ skillPath: filePath });
      return;
    }

    // Media 类型（image / svg / video）分流到 MediaViewer，不经过 Preview 面板。
    const mediaKind = inferKindByExt(ext);
    if (isMediaKind(mediaKind)) {
      openMediaViewerFromContext({
        ext,
        filePath,
        label: fileName,
        kind: mediaKind,
        origin: context?.origin,
        sessionPath: context?.sessionPath,
        messageId: context?.messageId,
        blockIdx: context?.blockIdx,
      });
      return;
    }

    const canPreview = ext in PREVIEWABLE_EXTS;
    if (canPreview) {
      const readResult = await readFileForPreviewWithVersion(filePath, ext);
      if (readResult != null) {
        const previewType = PREVIEWABLE_EXTS[ext];
        const previewItem: PreviewItem = {
          id: `file-${filePath}`,
          type: previewType,
          title: fileName,
          content: readResult.content,
          filePath,
          ext,
          fileVersion: readResult.fileVersion,
          language: previewType === 'code' ? ext : undefined,
        };
        openPreview(previewItem);
        return;
      }
    }

    // 无法预览的文件类型
    const previewItem: PreviewItem = {
      id: `file-${filePath}`,
      type: 'file-info',
      title: fileName,
      content: '',
      filePath,
      ext,
    };
    openPreview(previewItem);
  } catch (err) {
    console.error('[file-preview] open preview failed:', err);
    showError(getErrorMessage(err));
  }
}

/**
 * 打开 Skill 预览：读取 skill 文件 → 创建 markdown PreviewItem → 打开预览面板
 */
export async function openSkillPreview(skillName: string, skillFilePath: string): Promise<void> {
  try {
    const content = await window.platform?.readFile?.(skillFilePath);
    if (content != null) {
      const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
      const previewItem: PreviewItem = {
        id: `skill-${skillName}`,
        type: 'markdown',
        title: skillName,
        content: body,
      };
      openPreview(previewItem);
    }
  } catch (err) {
    console.error('[file-preview] open skill preview failed:', err);
    showError(getErrorMessage(err));
  }
}
