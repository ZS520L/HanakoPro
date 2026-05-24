import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState: Record<string, any> = {};
const mockHanaFetch = vi.fn();

vi.mock('../../stores', () => ({
  useStore: {
    getState: () => mockState,
    setState: (patch: Record<string, any>) => {
      Object.assign(mockState, patch);
    },
  },
}));

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: mockHanaFetch,
}));

vi.mock('../../../../../shared/error-bus.js', () => ({
  errorBus: { report: vi.fn() },
}));

vi.mock('../../../../../shared/errors.js', () => ({
  AppError: class AppError {
    constructor(public code: string, public details: Record<string, unknown>) {}
  },
}));

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as unknown as Response;
}

describe('loadModels', () => {
  beforeEach(() => {
    Object.keys(mockState).forEach(key => delete mockState[key]);
    Object.assign(mockState, { pendingNewSession: true });
    mockHanaFetch.mockReset();
    vi.resetModules();
  });

  it('uses a bounded timeout and marks the model list ready', async () => {
    mockHanaFetch.mockResolvedValueOnce(jsonResponse({
      models: [{ id: 'deepseek-v4-pro', provider: 'deepseek', isCurrent: true }],
    }));

    const { loadModels } = await import('../../utils/ui-helpers');
    await loadModels();

    expect(mockHanaFetch).toHaveBeenCalledWith('/api/models', { timeout: 10000 });
    expect(mockState.modelsLoadState).toBe('ready');
    expect(mockState.currentModel).toEqual({ id: 'deepseek-v4-pro', provider: 'deepseek' });
  });

  it('settles failed model loading into error instead of staying loading forever', async () => {
    mockHanaFetch.mockRejectedValueOnce(new Error('timeout'));

    const { loadModels } = await import('../../utils/ui-helpers');
    await loadModels();

    expect(mockState.modelsLoadState).toBe('error');
  });
});
