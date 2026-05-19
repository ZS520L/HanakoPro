import type { UserAttachment } from '../stores/chat-types';
import type { PlatformApi } from '../types';

type FileUrlPlatform = Pick<PlatformApi, 'getFileUrl'> | null | undefined;

export function getUserAttachmentImageSrc(
  attachment: Pick<UserAttachment, 'path' | 'base64Data' | 'mimeType'>,
  platform: FileUrlPlatform = typeof window !== 'undefined' ? window.platform : undefined,
): string | null {
  if (attachment.base64Data) {
    return `data:${attachment.mimeType || 'image/png'};base64,${attachment.base64Data}`;
  }
  if (attachment.path && typeof platform?.getFileUrl === 'function') {
    return platform.getFileUrl(attachment.path);
  }
  return null;
}
