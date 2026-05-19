import type { JSONContent } from '@tiptap/core';

export interface EditorFileRef {
  fileId?: string;
  path: string;
  name: string;
  isDirectory?: boolean;
  mimeType?: string;
}

/**
 * Walk TipTap JSON document, extract input badges and plain text.
 */
export function serializeEditor(json: JSONContent): { text: string; skills: string[]; fileRefs: EditorFileRef[] } {
  const skills: string[] = [];
  const fileRefs: EditorFileRef[] = [];
  const textParts: string[] = [];

  function walk(node: JSONContent) {
    if (node.type === 'skillBadge' && node.attrs?.name) {
      skills.push(node.attrs.name as string);
      return;
    }
    if (node.type === 'fileBadge' && node.attrs) {
      const name = typeof node.attrs.name === 'string' ? node.attrs.name : '';
      const path = typeof node.attrs.path === 'string' ? node.attrs.path : '';
      if (name || path) {
        const label = name || path.split('/').pop() || path;
        textParts.push(`@${label}`);
        fileRefs.push({
          ...(typeof node.attrs.fileId === 'string' && node.attrs.fileId ? { fileId: node.attrs.fileId } : {}),
          path,
          name: label,
          isDirectory: node.attrs.isDirectory === true,
          ...(typeof node.attrs.mimeType === 'string' && node.attrs.mimeType ? { mimeType: node.attrs.mimeType } : {}),
        });
      }
      return;
    }
    if (node.type === 'text' && node.text) {
      textParts.push(node.text);
      return;
    }
    if (node.type === 'hardBreak') {
      textParts.push('\n');
      return;
    }
    if (node.content) {
      for (const child of node.content) walk(child);
    }
    if (node.type === 'paragraph' && textParts.length > 0) {
      textParts.push('\n');
    }
  }

  walk(json);

  const text = textParts.join('').replace(/\n+$/, '').trim();

  return { text, skills, fileRefs };
}
