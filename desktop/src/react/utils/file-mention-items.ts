import type { AttachedFile } from '../stores/input-slice';
import type { DeskFile, DeskSearchResult } from '../types';
import type { FileRef } from '../types/file-ref';
import type { EditorFileRef } from './editor-serializer';

export type FileMentionSource = 'attached' | 'session' | 'workspace';

export interface FileMentionItem {
  id: string;
  source: FileMentionSource;
  fileId?: string;
  path: string;
  name: string;
  isDirectory?: boolean;
  mimeType?: string;
  detail: string;
}

interface BuildFileMentionItemsParams {
  query: string;
  attachedFiles: readonly AttachedFile[];
  sessionFiles: readonly FileRef[];
  deskFiles: readonly DeskFile[];
  deskBasePath: string;
  deskCurrentPath: string;
  searchResults: readonly DeskSearchResult[];
  limit?: number;
}

function joinWorkspacePath(base: string, subdir: string, name: string): string {
  const joined = [base, subdir, name].filter(Boolean).join('/');
  return joined.startsWith('//')
    ? '//' + joined.slice(2).replace(/\/+/g, '/')
    : joined.replace(/\/+/g, '/');
}

function dedupeKey(fileId: string | undefined, path: string): string {
  return fileId ? `id:${fileId}` : `path:${path}`;
}

function matchesQuery(query: string, name: string, path: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return name.toLowerCase().includes(needle) || path.toLowerCase().includes(needle);
}

function pushUnique(items: FileMentionItem[], seen: Set<string>, item: FileMentionItem): void {
  const key = dedupeKey(item.fileId, item.path);
  if (seen.has(key)) return;
  seen.add(key);
  items.push(item);
}

export function buildFileMentionItems({
  query,
  attachedFiles,
  sessionFiles,
  deskFiles,
  deskBasePath,
  deskCurrentPath,
  searchResults,
  limit = 20,
}: BuildFileMentionItemsParams): FileMentionItem[] {
  const items: FileMentionItem[] = [];
  const seen = new Set<string>();

  for (const file of attachedFiles) {
    if (!matchesQuery(query, file.name, file.path)) continue;
    pushUnique(items, seen, {
      id: `attached:${dedupeKey(file.fileId, file.path)}`,
      source: 'attached',
      fileId: file.fileId,
      path: file.path,
      name: file.name,
      isDirectory: file.isDirectory,
      mimeType: file.mimeType,
      detail: file.path,
    });
  }

  for (const file of sessionFiles) {
    if (!file.path || file.status === 'expired') continue;
    if (!matchesQuery(query, file.name, file.path)) continue;
    pushUnique(items, seen, {
      id: `session:${file.id}`,
      source: 'session',
      fileId: file.fileId,
      path: file.path,
      name: file.name,
      isDirectory: false,
      mimeType: file.mime,
      detail: file.path,
    });
  }

  const workspaceItems = query.trim()
    ? searchResults.map((file) => ({
      name: file.name,
      path: joinWorkspacePath(deskBasePath, '', file.relativePath),
      isDirectory: file.isDir,
      detail: file.parentSubdir || '/',
    }))
    : deskFiles.map((file) => ({
      name: file.name,
      path: joinWorkspacePath(deskBasePath, deskCurrentPath, file.name),
      isDirectory: file.isDir,
      detail: deskCurrentPath || '/',
    }));

  for (const file of workspaceItems) {
    if (!file.path || !matchesQuery(query, file.name, file.path)) continue;
    pushUnique(items, seen, {
      id: `workspace:${file.path}`,
      source: 'workspace',
      path: file.path,
      name: file.name,
      isDirectory: file.isDirectory,
      detail: file.detail,
    });
  }

  return items.slice(0, limit);
}

export function mergeEditorFileRefs(
  attachedFiles: readonly AttachedFile[],
  fileRefs: readonly EditorFileRef[],
): AttachedFile[] {
  const merged: AttachedFile[] = [];
  const seen = new Set<string>();

  for (const file of [...attachedFiles, ...fileRefs]) {
    if (!file.path && !file.fileId) continue;
    const key = dedupeKey(file.fileId, file.path);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      ...(file.fileId ? { fileId: file.fileId } : {}),
      path: file.path,
      name: file.name || file.path,
      ...(file.isDirectory ? { isDirectory: true } : {}),
      ...(file.mimeType ? { mimeType: file.mimeType } : {}),
    });
  }

  return merged;
}
