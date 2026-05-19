// tests/package-build-boundary.test.js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
);

describe('package build boundary', () => {
  it('declares plugin packages as npm workspaces without packaging their source into the app', () => {
    expect(packageJson.workspaces).toEqual(['packages/*']);
    expect(packageJson.build?.files).toContain('!packages/**');
  });
});
