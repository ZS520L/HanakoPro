import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Bold } from '@tiptap/extension-bold';
import Placeholder, { type PlaceholderOptions } from '@tiptap/extension-placeholder';
import { SkillBadge } from './extensions/skill-badge';
import { FileBadge } from './extensions/file-badge';

export type InputEditorPlaceholder = PlaceholderOptions['placeholder'];

const ChatInputBold = Bold.extend({
  inclusive: false,
  keepOnSplit: false,
});

export function createInputEditorExtensions(placeholder: InputEditorPlaceholder): Extensions {
  return [
    StarterKit.configure({
      heading: false,
      blockquote: false,
      codeBlock: false,
      horizontalRule: false,
      dropcursor: false,
      gapcursor: false,
      link: false,
      bold: false,
    }),
    ChatInputBold,
    Placeholder.configure({ placeholder }),
    SkillBadge,
    FileBadge,
  ];
}
