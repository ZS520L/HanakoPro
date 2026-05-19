import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_HEARTBEAT_INTERVAL_MINUTES,
  DEFAULT_WORKSPACE_DIRNAME,
  resolveDefaultWorkspacePath,
} from "../shared/default-workspace.js";

describe("default workspace contract", () => {
  it("places the default workspace under the user's Desktop", () => {
    const homeDir = path.join(os.tmpdir(), "hana-default-workspace-home");

    expect(DEFAULT_WORKSPACE_DIRNAME).toBe("OH-WorkSpace");
    expect(resolveDefaultWorkspacePath(homeDir)).toBe(
      path.join(homeDir, "Desktop", "OH-WorkSpace"),
    );
  });

  it("uses 31 minutes as the patrol interval default", () => {
    expect(DEFAULT_HEARTBEAT_INTERVAL_MINUTES).toBe(31);
  });
});
