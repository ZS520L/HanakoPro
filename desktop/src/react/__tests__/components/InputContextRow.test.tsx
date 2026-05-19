// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputContextRow } from '../../components/input/InputContextRow';

vi.mock('../../components/input/AttachedFilesBar', () => ({
  AttachedFilesBar: () => null,
}));

vi.mock('../../components/input/QuotedSelectionCard', () => ({
  QuotedSelectionCard: () => null,
}));

describe('InputContextRow', () => {
  beforeEach(() => {
    window.t = ((key: string) => {
      if (key === 'common.allDone') return '全部完成';
      if (key === 'common.markAllComplete') return '全部标记为已完成';
      return key;
    }) as typeof window.t;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('passes complete-todos disabled state to TodoDisplay', () => {
    const onCompleteTodos = vi.fn();

    render(
      <InputContextRow
        attachedFiles={[]}
        removeAttachedFile={vi.fn()}
        hasQuotedSelection={false}
        sessionTodos={[{ content: '跑这个 1.py 看输出', activeForm: '跑这个 1.py 看输出', status: 'in_progress' }]}
        onCompleteTodos={onCompleteTodos}
        completeTodosDisabled
        completeTodosDisabledTitle="当前会话正在运行"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /跑这个 1\.py 看输出/ }));
    const button = screen.getByRole('button', { name: '全部标记为已完成' });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', '当前会话正在运行');

    fireEvent.click(button);

    expect(onCompleteTodos).not.toHaveBeenCalled();
  });
});
