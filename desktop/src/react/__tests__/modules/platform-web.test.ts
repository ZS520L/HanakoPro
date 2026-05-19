/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function runPlatformScript(): void {
  const source = fs.readFileSync(path.join(process.cwd(), 'desktop/src/modules/platform.js'), 'utf-8');
  new Function(source)();
}

describe('web platform fallback capability contract', () => {
  beforeEach(() => {
    delete (window as any).hana;
    delete (window as any).platform;
    (globalThis as any).localStorage = {
      getItem: () => '',
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    };
  });

  it('does not expose system trash when the browser environment cannot provide it', () => {
    runPlatformScript();

    expect((window as any).platform.trashItem).toBeUndefined();
  });
});
