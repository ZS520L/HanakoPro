import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("desktop pet packaging contract", () => {
  it("includes the desktop pet renderer entry in Vite and packaged HTML files", () => {
    const vite = read("vite.config.ts");
    const pkg = read("package.json");

    expect(vite).toContain("desktop-pet.html");
    expect(vite).toContain("desktop-pet': path.resolve");
    expect(pkg).toContain("desktop/src/**/*.{html,icns,ico,png,svg,json}");
  });

  it("ships one replaceable image per pet mood", () => {
    const petDir = path.join(root, "desktop", "src", "assets", "desktop-pet", "hanako");
    for (const name of ["idle", "thinking", "talking", "working", "happy", "error", "cute", "sad", "missing"]) {
      expect(fs.existsSync(path.join(petDir, `${name}.png`))).toBe(true);
    }
    expect(JSON.parse(fs.readFileSync(path.join(petDir, "manifest.json"), "utf8")).moods).toEqual(expect.objectContaining({
      idle: "idle.png",
      thinking: "thinking.png",
      talking: "talking.png",
      working: "working.png",
      happy: "happy.png",
      error: "error.png",
      cute: "cute.png",
      sad: "sad.png",
      missing: "missing.png",
    }));
  });

  it("exposes desktop pet IPC through preload", () => {
    const preload = read("desktop/preload.cjs");
    expect(preload).toContain("desktopPetGetState");
    expect(preload).toContain("desktopPetSelectCustomImage");
    expect(preload).toContain("desktopPetResetCustomImage");
    expect(preload).toContain("desktop-pet-forward-event");
    expect(preload).toContain("onDesktopPetState");
  });
});
