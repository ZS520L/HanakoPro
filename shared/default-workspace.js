import fs from "fs";
import os from "os";
import path from "path";
import {
  DEFAULT_HEARTBEAT_INTERVAL_MINUTES,
  DEFAULT_WORKSPACE_DIRNAME,
} from "./default-workspace-constants.js";

export {
  DEFAULT_HEARTBEAT_INTERVAL_MINUTES,
  DEFAULT_WORKSPACE_DIRNAME,
};

export function resolveDefaultWorkspacePath(homeDir = os.homedir()) {
  return path.join(homeDir, "Desktop", DEFAULT_WORKSPACE_DIRNAME);
}

export function ensureDefaultWorkspace(homeDir = os.homedir()) {
  const workspacePath = resolveDefaultWorkspacePath(homeDir);
  fs.mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}
