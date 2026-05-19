import fs from "fs";
import path from "path";

function getLockedPackageVersion(rootLock, packageName) {
  const packagePath = `node_modules/${packageName}`;
  const lockedPackage = rootLock?.packages?.[packagePath];
  if (!lockedPackage?.version) {
    throw new Error(`[build-server] package-lock.json does not contain ${packagePath}`);
  }
  return lockedPackage.version;
}

export function buildExternalPackage(
  rootPkg,
  externalDeps,
  { rootLock, pinnedTransitiveDeps = [] } = {},
) {
  const dependencies = {};

  for (const [packageName, requestedVersion] of Object.entries(externalDeps)) {
    dependencies[packageName] = rootLock
      ? getLockedPackageVersion(rootLock, packageName)
      : requestedVersion;
  }

  for (const packageName of pinnedTransitiveDeps) {
    dependencies[packageName] = getLockedPackageVersion(rootLock, packageName);
  }

  return {
    name: "hanako-server",
    version: rootPkg.version,
    type: "module",
    dependencies,
  };
}

function collectRuntimeExportTargets(exportValue, targets = []) {
  if (typeof exportValue === "string") {
    targets.push(exportValue);
    return targets;
  }

  if (!exportValue || typeof exportValue !== "object") {
    return targets;
  }

  for (const [condition, value] of Object.entries(exportValue)) {
    if (condition === "types") continue;
    collectRuntimeExportTargets(value, targets);
  }

  return targets;
}

function getRootExport(exportsField) {
  if (!exportsField || typeof exportsField !== "object" || Array.isArray(exportsField)) {
    return exportsField;
  }

  if (Object.hasOwn(exportsField, ".")) {
    return exportsField["."];
  }

  const keys = Object.keys(exportsField);
  const isSubpathMap = keys.some((key) => key.startsWith("."));
  return isSubpathMap ? undefined : exportsField;
}

export function verifyExternalEntrypoints(outDir, packageNames) {
  const failures = [];

  for (const packageName of packageNames) {
    const packageDir = path.join(outDir, "node_modules", packageName);
    const packageJsonPath = path.join(packageDir, "package.json");

    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      const rootExport = getRootExport(pkg.exports);
      const targets = rootExport === undefined
        ? [pkg.main, pkg.module].filter(Boolean)
        : collectRuntimeExportTargets(rootExport);

      for (const target of targets) {
        if (typeof target !== "string" || !target.startsWith("./") || target.includes("*")) {
          continue;
        }

        const targetPath = path.join(packageDir, target);
        if (!fs.existsSync(targetPath)) {
          failures.push(`${packageName}: ${target} resolves to missing file ${targetPath}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${packageName}: ${msg}`);
    }
  }

  if (failures.length > 0) {
    throw new Error([
      "[build-server] external package entrypoint verification failed:",
      ...failures.map((failure) => `  - ${failure}`),
    ].join("\n"));
  }
}
