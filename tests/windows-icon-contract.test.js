import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

function readIcoEntries(filePath) {
  const buf = fs.readFileSync(filePath);
  const reserved = buf.readUInt16LE(0);
  const type = buf.readUInt16LE(2);
  const count = buf.readUInt16LE(4);

  expect(reserved).toBe(0);
  expect(type).toBe(1);

  return Array.from({ length: count }, (_, i) => {
    const offset = 6 + i * 16;
    const width = buf[offset] || 256;
    const height = buf[offset + 1] || 256;
    const bitDepth = buf.readUInt16LE(offset + 6);
    const size = buf.readUInt32LE(offset + 8);
    const imageOffset = buf.readUInt32LE(offset + 12);
    const png = buf.subarray(imageOffset, imageOffset + size);

    return {
      width,
      height,
      bitDepth,
      pngColorType: png.subarray(1, 4).toString("ascii") === "PNG" ? png[25] : null,
    };
  });
}

describe("Windows icon contract", () => {
  it("uses the app ICO for Windows packaging and installer surfaces", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));

    expect(pkg.build.win.icon).toBe("desktop/src/icon.ico");
    expect(pkg.build.nsis.installerIcon).toBe("desktop/src/icon.ico");
    expect(pkg.build.nsis.uninstallerIcon).toBe("desktop/src/icon.ico");
    expect(pkg.build.files).toContain("desktop/src/**/*.{html,icns,ico,png,svg,json}");
    expect(pkg.scripts["dist:win"]).toContain("npm run generate:windows-icon");
  });

  it("keeps Windows app icon layers transparent for rounded taskbar rendering", () => {
    const entries = readIcoEntries(path.join(ROOT, "desktop", "src", "icon.ico"));
    const sizes = entries.map((entry) => entry.width).sort((a, b) => b - a);

    expect(sizes).toEqual([256, 128, 64, 48, 32, 24, 16]);
    for (const entry of entries) {
      expect(entry.width).toBe(entry.height);
      expect(entry.bitDepth).toBe(32);
      expect(entry.pngColorType).toBe(6);
    }
  });

  it("separates app window icon from tray icon and sets Windows taskbar identity", () => {
    const main = fs.readFileSync(path.join(ROOT, "desktop", "main.cjs"), "utf-8");

    expect(main).toContain("app.setAppUserModelId");
    expect(main).toContain("com.hanako.app");
    expect(main).toContain('"icon.ico"');
    expect(main).toContain('"tray.ico"');
    expect(main).not.toMatch(/titleBarOpts[\s\S]*?"tray\.ico"[\s\S]*?return\s+\{\s*frame:\s*false,\s*icon:/);
  });
});
