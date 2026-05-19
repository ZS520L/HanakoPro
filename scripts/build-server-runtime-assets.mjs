import fs from "fs";
import path from "path";

export const SERVER_RUNTIME_ASSET_FILES = [
  "Hanako.png",
  "Butter.png",
  "Ming.png",
  "Kong.png",
];

export const SERVER_RUNTIME_ASSET_DIRS = [
  "character-cards",
];

function assertRequiredAssetExists(fsImpl, sourcePath, label) {
  if (!fsImpl.existsSync(sourcePath)) {
    throw new Error(`[build-server] required runtime asset missing: ${label}`);
  }
}

export function copyServerRuntimeAssets({ rootDir, outDir, fsImpl = fs }) {
  const copied = [];
  const sourceAssetsDir = path.join(rootDir, "desktop", "src", "assets");
  const targetAssetsDir = path.join(outDir, "desktop", "src", "assets");
  fsImpl.mkdirSync(targetAssetsDir, { recursive: true });

  for (const fileName of SERVER_RUNTIME_ASSET_FILES) {
    const sourcePath = path.join(sourceAssetsDir, fileName);
    assertRequiredAssetExists(fsImpl, sourcePath, path.join("desktop", "src", "assets", fileName));
    fsImpl.copyFileSync(sourcePath, path.join(targetAssetsDir, fileName));
    copied.push(path.join("desktop", "src", "assets", fileName));
  }

  for (const dirName of SERVER_RUNTIME_ASSET_DIRS) {
    const sourcePath = path.join(sourceAssetsDir, dirName);
    assertRequiredAssetExists(fsImpl, sourcePath, path.join("desktop", "src", "assets", dirName));
    fsImpl.cpSync(sourcePath, path.join(targetAssetsDir, dirName), { recursive: true });
    copied.push(path.join("desktop", "src", "assets", dirName) + path.sep);
  }

  return copied;
}
