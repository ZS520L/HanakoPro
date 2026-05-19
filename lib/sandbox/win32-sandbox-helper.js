import { existsSync as defaultExistsSync } from "fs";
import path from "path";

export const WIN32_SANDBOX_HELPER_NAME = "hana-win-sandbox.exe";

export function resourceSiblingDir(name, { env = process.env, resourcesPath = process.resourcesPath } = {}) {
  const candidates = [];
  if (resourcesPath) candidates.push(path.join(resourcesPath, name));
  if (env.HANA_ROOT) candidates.push(path.resolve(env.HANA_ROOT, "..", name));
  return candidates.find((candidate) => defaultExistsSync(candidate)) || candidates[0] || null;
}

export function resolveWin32SandboxHelper({
  env = process.env,
  resourcesPath = process.resourcesPath,
  cwd = process.cwd(),
  arch = process.arch,
  existsSync = defaultExistsSync,
} = {}) {
  const candidates = [
    env.HANA_WIN32_SANDBOX_HELPER,
    resourcesPath ? path.join(resourcesPath, "sandbox", "windows", WIN32_SANDBOX_HELPER_NAME) : null,
    env.HANA_ROOT ? path.resolve(env.HANA_ROOT, "..", "sandbox", "windows", WIN32_SANDBOX_HELPER_NAME) : null,
    path.join(cwd, "dist-sandbox", `win-${arch}`, WIN32_SANDBOX_HELPER_NAME),
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) || null;
}

export function buildWin32SandboxHelperArgs({
  cwd,
  network = {},
  grants = {},
  executable,
  args = [],
} = {}) {
  if (!cwd) throw new Error("win32 sandbox helper requires cwd");
  if (!executable) throw new Error("win32 sandbox helper requires executable");

  const out = ["--cwd", cwd];
  if (network.internetClient === true) out.push("--network", "internet-client");
  if (network.internetClientServer === true) out.push("--network", "internet-client-server");
  if (network.privateNetworkClientServer === true) out.push("--network", "private-network-client-server");
  for (const p of grants.readPaths || []) out.push("--grant-read", p);
  for (const p of grants.optionalReadPaths || []) out.push("--grant-read-optional", p);
  for (const p of grants.writePaths || []) out.push("--grant-write", p);
  for (const p of grants.optionalWritePaths || []) out.push("--grant-write-optional", p);
  for (const p of grants.denyWritePaths || []) out.push("--deny-write", p);
  out.push("--", executable, ...args);
  return out;
}
