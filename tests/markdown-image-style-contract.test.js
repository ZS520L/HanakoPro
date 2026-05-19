import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const stylesPath = path.resolve("desktop/src/styles.css");

function getCssRule(selector) {
  const css = fs.readFileSync(stylesPath, "utf-8");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] || "";
}

describe("Markdown image style contract", () => {
  it("keeps normal markdown images inside the content column", () => {
    const rule = getCssRule(".md-content img");

    expect(rule).toMatch(/max-width\s*:\s*100%/);
    expect(rule).toMatch(/height\s*:\s*auto/);
    expect(rule).toMatch(/object-fit\s*:\s*contain/);
  });
});
