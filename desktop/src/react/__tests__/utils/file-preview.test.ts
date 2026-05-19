/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openPreview: vi.fn(),
  showError: vi.fn(),
  openMediaViewerFromContext: vi.fn(),
}));

vi.mock('../../stores/preview-actions', () => ({
  openPreview: mocks.openPreview,
}));

vi.mock('../../utils/ui-helpers', () => ({
  showError: mocks.showError,
}));

vi.mock('../../utils/open-media-viewer', () => ({
  openMediaViewerFromContext: mocks.openMediaViewerFromContext,
}));

import { openFilePreview, openSkillPreview } from '../../utils/file-preview';

describe('file-preview IPC error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).platform = {
      readFile: vi.fn(),
      readDocxHtml: vi.fn(),
      readXlsxHtml: vi.fn(),
      readFileBase64: vi.fn(),
      openSkillViewer: vi.fn(),
    };
  });

  afterEach(() => {
    delete (window as any).platform;
  });

  it('预览读取异常时向用户报错，并且不再把 Promise 泄漏到全局', async () => {
    (window as any).platform.readFile.mockRejectedValue(new Error('preview exploded'));

    await expect(openFilePreview('/tmp/demo.md', 'demo.md', 'md', { origin: 'desk' })).resolves.toBeUndefined();

    expect(mocks.showError).toHaveBeenCalledWith('preview exploded');
    expect(mocks.openPreview).not.toHaveBeenCalled();
    expect(mocks.openMediaViewerFromContext).not.toHaveBeenCalled();
  });

  it('技能预览读取异常时也会显式报错', async () => {
    (window as any).platform.readFile.mockRejectedValue(new Error('skill exploded'));

    await expect(openSkillPreview('demo-skill', '/tmp/demo-skill/SKILL.md')).resolves.toBeUndefined();

    expect(mocks.showError).toHaveBeenCalledWith('skill exploded');
    expect(mocks.openPreview).not.toHaveBeenCalled();
  });
});
