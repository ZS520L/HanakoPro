/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputContextMenu } from '../../components/InputContextMenu';

function Harness({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <InputContextMenu />
    </>
  );
}

describe('InputContextMenu', () => {
  const runEditCommand = vi.fn(async () => true);

  beforeEach(() => {
    runEditCommand.mockClear();
    window.t = ((key: string) => key) as typeof window.t;
    window.platform = {
      runEditCommand,
    } as unknown as typeof window.platform;
  });

  afterEach(() => {
    cleanup();
  });

  it('input 选区使用 selectionStart/selectionEnd，而不是 window.getSelection()', () => {
    render(
      <Harness>
        <input data-testid="input" defaultValue="hello world" />
      </Harness>,
    );

    const input = screen.getByTestId('input') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(0, 5);

    fireEvent.contextMenu(input, { clientX: 20, clientY: 20 });

    const copyItem = screen.getByText('ctx.copy');
    expect(copyItem.className).not.toContain('disabled');

    fireEvent.click(copyItem);
    expect(runEditCommand).toHaveBeenCalledWith('copy');
  });

  it('无选区时 cut/copy 禁用，不会误触发命令', () => {
    render(
      <Harness>
        <textarea data-testid="textarea" defaultValue="hello world" />
      </Harness>,
    );

    const textarea = screen.getByTestId('textarea') as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(0, 0);

    fireEvent.contextMenu(textarea, { clientX: 16, clientY: 16 });

    const cutItem = screen.getByText('ctx.cut');
    const copyItem = screen.getByText('ctx.copy');
    expect(cutItem.className).toContain('disabled');
    expect(copyItem.className).toContain('disabled');

    fireEvent.click(copyItem);
    expect(runEditCommand).not.toHaveBeenCalled();
  });

  it('CodeMirror 子节点右键也能走同一条编辑命令入口', () => {
    render(
      <Harness>
        <div className="cm-content" contentEditable suppressContentEditableWarning>
          <span data-testid="cm-child">hello</span>
        </div>
      </Harness>,
    );

    const child = screen.getByTestId('cm-child');
    const sel = window.getSelection();
    sel?.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(child);
    sel?.addRange(range);

    fireEvent.contextMenu(child, { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByText('ctx.copy'));

    expect(runEditCommand).toHaveBeenCalledWith('copy');
  });

  it('粘贴和全选也复用同一条编辑命令通道', () => {
    render(
      <Harness>
        <input data-testid="input" defaultValue="hello world" />
      </Harness>,
    );

    const input = screen.getByTestId('input') as HTMLInputElement;
    input.focus();

    fireEvent.contextMenu(input, { clientX: 8, clientY: 8 });
    fireEvent.click(screen.getByText('ctx.paste'));
    fireEvent.contextMenu(input, { clientX: 12, clientY: 12 });
    fireEvent.click(screen.getByText('ctx.selectAll'));

    expect(runEditCommand).toHaveBeenNthCalledWith(1, 'paste');
    expect(runEditCommand).toHaveBeenNthCalledWith(2, 'selectAll');
  });
});
