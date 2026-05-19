// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InputStatusBars } from '../../components/input/InputStatusBars';

describe('InputStatusBars', () => {
  it('shows an indeterminate screenshot progress bar above the chat input', () => {
    render(
      <InputStatusBars
        slashBusy={null}
        slashBusyLabel="执行中..."
        compacting={false}
        compactingLabel="上下文压缩中"
        screenshotBusy
        screenshotLabel="正在截图"
        screenshotPageLabel="正在截图，第 2/4 页"
        screenshotProgress={{
          completedBlocks: 12,
          totalBlocks: 37,
          currentPage: 2,
          totalPages: 4,
        }}
        inlineError={null}
        slashResult={null}
        onResultClick={undefined}
      />,
    );

    expect(screen.getByText('正在截图，第 2/4 页')).toBeInTheDocument();
    const progress = screen.getByRole('progressbar', { name: '正在截图，第 2/4 页' });
    expect(progress).toHaveAttribute('aria-valuenow', '12');
    expect(progress).toHaveAttribute('aria-valuemax', '37');
  });
});
