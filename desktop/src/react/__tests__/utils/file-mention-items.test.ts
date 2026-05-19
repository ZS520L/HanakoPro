import { describe, expect, it } from 'vitest';
import {
  buildFileMentionItems,
  mergeEditorFileRefs,
} from '../../utils/file-mention-items';

describe('file mention items', () => {
  it('builds mention options from input attachments, session files, and workspace results without duplicates', () => {
    const items = buildFileMentionItems({
      query: 'read',
      attachedFiles: [{
        fileId: 'sf_readme',
        path: '/workspace/README.md',
        name: 'README.md',
      }],
      sessionFiles: [{
        id: 'ref-1',
        fileId: 'sf_readme',
        source: 'session-attachment',
        kind: 'markdown',
        path: '/workspace/README.md',
        name: 'README.md',
      }, {
        id: 'ref-2',
        source: 'session-block-file',
        kind: 'other',
        path: '/workspace/notes/read-later.txt',
        name: 'read-later.txt',
      }],
      deskFiles: [],
      deskBasePath: '/workspace',
      deskCurrentPath: '',
      searchResults: [{
        name: 'reader.ts',
        relativePath: 'src/reader.ts',
        parentSubdir: 'src',
        isDir: false,
      }],
    });

    expect(items.map(item => ({
      source: item.source,
      name: item.name,
      path: item.path,
      fileId: item.fileId,
    }))).toEqual([
      { source: 'attached', name: 'README.md', path: '/workspace/README.md', fileId: 'sf_readme' },
      { source: 'session', name: 'read-later.txt', path: '/workspace/notes/read-later.txt', fileId: undefined },
      { source: 'workspace', name: 'reader.ts', path: '/workspace/src/reader.ts', fileId: undefined },
    ]);
  });

  it('merges editor file refs into attachments without duplicating already attached files', () => {
    const merged = mergeEditorFileRefs(
      [{ fileId: 'sf_readme', path: '/workspace/README.md', name: 'README.md' }],
      [
        { fileId: 'sf_readme', path: '/workspace/README.md', name: 'README.md' },
        { path: '/workspace/src', name: 'src', isDirectory: true },
      ],
    );

    expect(merged).toEqual([
      { fileId: 'sf_readme', path: '/workspace/README.md', name: 'README.md' },
      { path: '/workspace/src', name: 'src', isDirectory: true },
    ]);
  });
});
