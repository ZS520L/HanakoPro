// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TodoDisplay } from '../../components/input/TodoDisplay';

describe('TodoDisplay', () => {
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

  it('shows the complete-all action only after expanding the todo list', () => {
    const onCompleteAll = vi.fn();
    render(
      <TodoDisplay
        todos={[{ content: '写测试', activeForm: '正在写测试', status: 'in_progress' }]}
        onCompleteAll={onCompleteAll}
      />,
    );

    expect(screen.queryByRole('button', { name: '全部标记为已完成' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /正在写测试/ }));
    fireEvent.click(screen.getByRole('button', { name: '全部标记为已完成' }));

    expect(onCompleteAll).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('正在写测试')).toHaveLength(2);
  });

  it('disables the complete-all action while completion is blocked', () => {
    const onCompleteAll = vi.fn();
    render(
      <TodoDisplay
        todos={[{ content: '跑脚本', activeForm: '正在跑脚本', status: 'in_progress' }]}
        onCompleteAll={onCompleteAll}
        completeAllDisabled
        completeAllDisabledTitle="当前会话正在运行"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /正在跑脚本/ }));
    const button = screen.getByRole('button', { name: '全部标记为已完成' });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', '当前会话正在运行');

    fireEvent.click(button);

    expect(onCompleteAll).not.toHaveBeenCalled();
  });
});
