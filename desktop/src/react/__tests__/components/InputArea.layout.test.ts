import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function cssBlock(css: string, selector: string): string {
  return css.match(new RegExp(`${selector}\\s*\\{(?<body>[^}]*)\\}`))?.groups?.body || '';
}

describe('InputArea layout', () => {
  it('keeps chat, composer, welcome, and bridge widths in their intended lanes', () => {
    const globalCss = fs.readFileSync(path.join(process.cwd(), 'desktop/src/styles.css'), 'utf8');
    const chatCss = fs.readFileSync(
      path.join(process.cwd(), 'desktop/src/react/components/chat/Chat.module.css'),
      'utf8',
    );
    const floatingCss = fs.readFileSync(
      path.join(process.cwd(), 'desktop/src/react/components/FloatingPanels.module.css'),
      'utf8',
    );

    const inputAreaBlock = cssBlock(globalCss, String.raw`\.input-area > \*`);
    const welcomeInputAreaBlock = cssBlock(globalCss, String.raw`\.main-content\.welcome-mode \.input-area > \*`);
    const sessionMessagesBlock = cssBlock(chatCss, String.raw`\.sessionMessages`);

    expect(globalCss).toMatch(/--chat-column-width:\s*45rem/);
    expect(globalCss).toMatch(/--chat-input-column-extra:\s*1\.25rem/);
    expect(globalCss).toMatch(/--chat-input-column-width:\s*calc\(var\(--chat-column-width\) \+ var\(--chat-input-column-extra\)\)/);
    expect(globalCss).toMatch(/--welcome-chat-input-column-width:\s*40rem/);
    expect(inputAreaBlock).toMatch(/max-width:\s*var\(--chat-input-column-width\)/);
    expect(welcomeInputAreaBlock).toMatch(/max-width:\s*var\(--welcome-chat-input-column-width\)/);
    expect(sessionMessagesBlock).toMatch(/max-width:\s*var\(--chat-column-width\)/);
    expect(floatingCss).not.toMatch(/--chat-column-width:\s*var\(--bridge-chat-column-width\)/);
  });

  it('keeps composer horizontal padding symmetric with the left inset', () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), 'desktop/src/react/components/input/InputArea.module.css'),
      'utf8',
    );
    const inputWrapperBlock = cssBlock(css, String.raw`\.input-wrapper`);

    expect(inputWrapperBlock).toMatch(/padding:\s*var\(--space-md\)\s+var\(--space-md\)\s+var\(--space-sm\)/);
  });
});
