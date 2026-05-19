export type FileKind =
  | 'image'
  | 'svg'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'doc'
  | 'code'
  | 'markdown'
  | 'other';

export type FileSource =
  | 'desk'
  | 'session-attachment'
  | 'session-registry'
  | 'session-block-file'
  | 'session-block-legacy-artifact'
  | 'session-block-screenshot';

export interface FileRef {
  id: string;
  fileId?: string;
  kind: FileKind;
  source: FileSource;
  name: string;
  /** 当 source === 'session-block-screenshot' 时为 '' */
  path: string;
  ext?: string;
  mime?: string;
  status?: 'available' | 'expired' | string;
  missingAt?: number | null;
  origin?: string;
  operations?: string[];
  createdAt?: number;
  timestamp?: number;
  sessionMessageId?: string;
  sessionBlockIdx?: number;
  inlineData?: { base64: string; mimeType: string };
}
