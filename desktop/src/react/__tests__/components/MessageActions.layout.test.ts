import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('MessageActions layout', () => {
  it('anchors the select checkbox group to the lower right of the message block', () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), 'desktop/src/react/components/chat/Chat.module.css'),
      'utf8',
    );
    const block = css.match(/\.msgActions\s*\{(?<body>[^}]*)\}/)?.groups?.body || '';

    expect(block).toMatch(/bottom:\s*4px/);
    expect(block).toMatch(/right:\s*4px/);
    expect(block).not.toMatch(/top:\s*4px/);
  });

  it('keeps active message action styling when the button is hovered', () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), 'desktop/src/react/components/chat/Chat.module.css'),
      'utf8',
    );
    const block = css.match(/\.msgActionBtnActive:hover\s*\{(?<body>[^}]*)\}/)?.groups?.body || '';

    expect(block).toMatch(/color:\s*var\(--accent\)\s*!important/);
    expect(block).toMatch(/background:\s*rgba\(var\(--accent-rgb\),\s*0\.16\)/);
  });

  it('renders file output cards as block-level rows instead of inline siblings', () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), 'desktop/src/react/components/chat/Chat.module.css'),
      'utf8',
    );
    const block = css.match(/\.fileOutputCard\s*\{(?<body>[^}]*)\}/)?.groups?.body || '';

    expect(block).toMatch(/display:\s*flex/);
    expect(block).not.toMatch(/display:\s*inline-flex/);
  });
});
