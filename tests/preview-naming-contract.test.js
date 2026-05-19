import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = path.resolve(process.cwd(), "desktop/src/react");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe("preview naming contract", () => {
  it("uses Preview naming for the current preview surface, leaving Artifact only to legacy protocol blocks", () => {
    const productionFiles = walk(root);
    const artifactNamedFiles = productionFiles
      .map((file) => path.relative(root, file))
      .filter((file) => /artifact/i.test(file));

    expect(artifactNamedFiles).toEqual([]);
    expect(fs.existsSync(path.join(root, "stores", "preview-slice.ts"))).toBe(true);
    expect(fs.existsSync(path.join(root, "stores", "preview-actions.ts"))).toBe(true);
    expect(fs.existsSync(path.join(root, "components", "PreviewEditor.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(root, "components", "preview", "PreviewRenderer.tsx"))).toBe(true);
  });
});
