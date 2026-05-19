export type AppFileDragSource = 'workspace' | 'session-file';

export interface AppDraggedFile {
  id: string;
  name: string;
  path: string;
  fileId?: string;
  isDirectory?: boolean;
  mimeType?: string;
  base64Data?: string;
  sourceSubdir?: string;
}

export interface AppFileDragPayload {
  dragId: string;
  source: AppFileDragSource;
  files: AppDraggedFile[];
}

export type AppFileDragPayloadInput = Omit<AppFileDragPayload, 'dragId'> & {
  dragId?: string;
};

const APP_FILE_DRAG_MIME = 'application/x-hana-file-drag';

let dragSeq = 0;
let activeDragId: string | null = null;
const dragPayloads = new Map<string, AppFileDragPayload>();
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

function nextDragId(): string {
  dragSeq += 1;
  return `hana-drag-${Date.now().toString(36)}-${dragSeq.toString(36)}`;
}

export function writeAppFileDragPayload(
  dataTransfer: DataTransfer | null | undefined,
  input: AppFileDragPayloadInput,
): AppFileDragPayload {
  const payload: AppFileDragPayload = {
    ...input,
    dragId: input.dragId || nextDragId(),
    files: input.files.map(file => ({ ...file })),
  };
  dragPayloads.set(payload.dragId, payload);
  activeDragId = payload.dragId;
  const previousTimer = cleanupTimers.get(payload.dragId);
  if (previousTimer) clearTimeout(previousTimer);
  cleanupTimers.set(payload.dragId, setTimeout(() => clearAppFileDragPayload(payload.dragId), 60_000));
  if (dataTransfer) {
    dataTransfer.effectAllowed = payload.source === 'workspace' ? 'copyMove' : 'copy';
    dataTransfer.setData(APP_FILE_DRAG_MIME, payload.dragId);
    dataTransfer.setData('text/plain', payload.files.map(file => file.path || file.name).join('\n'));
  }
  return payload;
}

export function readAppFileDragPayload(dataTransfer?: DataTransfer | null): AppFileDragPayload | null {
  const dragId = dataTransfer?.getData(APP_FILE_DRAG_MIME) || activeDragId;
  if (!dragId) return null;
  return dragPayloads.get(dragId) || null;
}

export function getActiveAppFileDragPayload(): AppFileDragPayload | null {
  return activeDragId ? dragPayloads.get(activeDragId) || null : null;
}

export function clearAppFileDragPayload(dragId?: string | null): void {
  const id = dragId || activeDragId;
  if (!id) return;
  dragPayloads.delete(id);
  const timer = cleanupTimers.get(id);
  if (timer) clearTimeout(timer);
  cleanupTimers.delete(id);
  if (activeDragId === id) activeDragId = null;
}
