import { describe, expect, it, vi } from 'vitest';
import { getUserAttachmentImageSrc } from '../../utils/user-attachment-media';

describe('getUserAttachmentImageSrc', () => {
  it('优先使用已有 base64 inline 数据', () => {
    const platform = { getFileUrl: vi.fn(() => 'file:///tmp/pic.png') };

    expect(getUserAttachmentImageSrc({
      path: '/tmp/pic.png',
      base64Data: 'BASE64',
      mimeType: 'image/png',
    }, platform)).toBe('data:image/png;base64,BASE64');
    expect(platform.getFileUrl).not.toHaveBeenCalled();
  });

  it('没有 base64 时用 preload 的 file URL 恢复本地图片', () => {
    const platform = { getFileUrl: vi.fn((p: string) => `file://${p}`) };

    expect(getUserAttachmentImageSrc({
      path: '/Users/test/.hanako/attachments/upload-abc.png',
    }, platform)).toBe('file:///Users/test/.hanako/attachments/upload-abc.png');
  });
});
