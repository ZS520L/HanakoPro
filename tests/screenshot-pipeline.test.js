import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("screenshot pipeline", () => {
  it("keeps long screenshot stitching in the main process", () => {
    const mainSource = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf-8");
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
    const files = packageJson.build?.files || [];

    expect(mainSource).not.toContain("screenshot-stitch-worker");
    expect(mainSource).not.toContain("runScreenshotStitchWorker");
    expect(files).not.toContain("desktop/screenshot-stitch-worker.cjs");
  });

  it("pins offscreen screenshots to an explicit 2x scale", () => {
    const mainSource = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf-8");

    expect(mainSource).toMatch(/webPreferences:\s*{\s*offscreen:\s*{\s*deviceScaleFactor:\s*2\s*}/);
    expect(mainSource).not.toMatch(/offscreen:\s*true,\s*deviceScaleFactor:\s*2/);
  });

  it("captures explicit screenshot bounds instead of the whole visible page", () => {
    const mainSource = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf-8");

    expect(mainSource).toContain("capturePage({ x: 0, y: 0, width, height: totalHeight }");
    expect(mainSource).toContain("capturePage({ x: 0, y: 0, width, height: segH }");
  });

  it("does not treat Windows display-surface capture failures as fatal browser host errors", () => {
    const mainSource = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf-8");
    const fatalList = mainSource.match(/const FATAL_BROWSER_HOST_ERROR_PATTERNS = \[[\s\S]*?\];/)?.[0];

    expect(fatalList).toBeTruthy();
    expect(fatalList).not.toMatch(/current display surface not available/i);
    expect(fatalList).not.toMatch(/display surface .*not available/i);
  });

  it("keeps long screenshot bitmap stitching scale-aware", () => {
    const mainSource = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf-8");

    expect(mainSource).toContain("image.toPNG({ scaleFactor: scale })");
    expect(mainSource).toContain("PNG.sync.read(seg.toPNG({ scaleFactor: scale }))");
    expect(mainSource).not.toContain("Unexpected screenshot segment bitmap size");
    expect(mainSource).not.toContain("bitmap.length % partRowBytes");
  });

  it("caps long screenshot segments to the current screen work area", () => {
    const mainSource = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf-8");

    expect(mainSource).toContain("resolveScreenshotMaxSegmentHeight(screen)");
    expect(mainSource).toContain("if (totalHeight <= maxSegmentHeight)");
    expect(mainSource).toContain("const segH = Math.min(maxSegmentHeight, totalHeight - captured)");
    expect(mainSource).not.toContain("if (totalHeight <= SCREENSHOT_MAX_SEGMENT)");
    expect(mainSource).not.toContain("const segH = Math.min(SCREENSHOT_MAX_SEGMENT, totalHeight - captured)");
  });

  it("paints a deterministic page background before PNG export", () => {
    const mainSource = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf-8");

    expect(mainSource).toContain("backgroundColor:");
    expect(mainSource).toContain("--screenshot-page-bg");
    expect(mainSource).toContain("background: var(--screenshot-page-bg)");
  });

  it("uses the current app icon for the screenshot watermark", () => {
    const mainSource = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf-8");

    expect(mainSource).toContain('path.join(__dirname, "src", "icon.png")');
    expect(mainSource).not.toContain('path.join(__dirname, "src", "assets", "Hanako.png")');
  });

  it("pins screenshot image width by layout", () => {
    const mainSource = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf-8");

    expect(mainSource).toContain('.chat-image { width: ${themeName.endsWith("-desktop") ? "66.666%" : "100%"};');
    expect(mainSource).toContain("height: auto; border-radius: 6px;");
  });
});
