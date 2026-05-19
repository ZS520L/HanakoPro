type FileChangeHandler = (filePath: string) => void;

const handlers = new Set<FileChangeHandler>();
let attachedApi: typeof window.platform | null = null;

function ensureBridgeAttached(): void {
  if (typeof window === 'undefined') return;
  const api = window.platform;
  if (!api?.onFileChanged) return;
  if (attachedApi === api) return;

  attachedApi = api;
  api.onFileChanged((filePath: string) => {
    for (const handler of [...handlers]) {
      handler(filePath);
    }
  });
}

export function subscribeFileChanges(handler: FileChangeHandler): () => void {
  ensureBridgeAttached();
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}
