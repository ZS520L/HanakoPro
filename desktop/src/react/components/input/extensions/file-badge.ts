import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { FileBadgeView } from '../FileBadgeView';

export const FileBadge = Node.create({
  name: 'fileBadge',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      fileId: { default: null },
      path: { default: '' },
      name: { default: '' },
      isDirectory: { default: false },
      mimeType: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-file-badge]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, {
      class: 'file-badge',
      'data-file-badge': '',
      'data-file-id': HTMLAttributes.fileId || '',
      'data-path': HTMLAttributes.path || '',
      'data-name': HTMLAttributes.name || '',
      'data-is-directory': HTMLAttributes.isDirectory ? 'true' : 'false',
      'data-mime-type': HTMLAttributes.mimeType || '',
    })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileBadgeView);
  },
});
