import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hanaFetch: vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
}));

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: mocks.hanaFetch,
}));

import { requestUserEditCheckpoint } from '../../utils/checkpoints';

describe('requestUserEditCheckpoint', () => {
  it('posts explicit user-edit checkpoint requests', async () => {
    await requestUserEditCheckpoint('/tmp/note.md', 'edit-start');

    expect(mocks.hanaFetch).toHaveBeenCalledWith('/api/checkpoints/user-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: '/tmp/note.md', reason: 'edit-start' }),
    });
  });
});
