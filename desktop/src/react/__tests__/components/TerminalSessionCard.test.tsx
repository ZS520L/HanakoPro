// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TerminalSessionCard,
  normalizeTerminalOutput,
  normalizeTerminalOutputChunk,
} from '../../components/chat/TerminalSessionCard';

describe('TerminalSessionCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('normalizes isolated carriage returns as line breaks', () => {
    expect(normalizeTerminalOutput('one\rtwo\r\nthree\u001b[31m!\u001b[0m')).toBe('one\ntwo\nthree!');
  });

  it('normalizes carriage-return line feeds split across chunks without adding blank lines', () => {
    const first = normalizeTerminalOutputChunk('one\r', false);
    const second = normalizeTerminalOutputChunk('\ntwo\rthree', first.endsWithCarriageReturn);

    expect(`${first.text}${second.text}`).toBe('one\ntwo\nthree');
  });

  it('turns Windows cursor moves to column 1 into line breaks', () => {
    expect(normalizeTerminalOutput('(c) Microsoft\u001b[4;1HC:\\Work>python 1.py')).toBe('(c) Microsoft\nC:\\Work>python 1.py');
    expect(normalizeTerminalOutput('fib(10) = 55\u001b[16;1HC:\\Work>')).toBe('fib(10) = 55\nC:\\Work>');
  });

  it('renders static output without joining carriage-return separated lines', () => {
    const { container } = render(
      <TerminalSessionCard
        termId="term-1"
        title="demo"
        staticOutput={'Microsoft Windows\r(c) Microsoft Corporation\rC:\\Work>python 1.py\rF(1) = 1\rF(2) = 1'}
        staticAlive={false}
      />,
    );

    expect(container.querySelector('pre')?.textContent).toBe([
      'Microsoft Windows',
      '(c) Microsoft Corporation',
      'C:\\Work>python 1.py',
      'F(1) = 1',
      'F(2) = 1',
    ].join('\n'));
  });
});
