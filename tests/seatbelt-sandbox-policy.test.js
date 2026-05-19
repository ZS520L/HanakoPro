import { describe, expect, it } from "vitest";
import { __testing } from "../lib/sandbox/seatbelt.js";

describe("macOS seatbelt sandbox policy projection", () => {
  const policy = {
    mode: "standard",
    writablePaths: [],
    readablePaths: [],
    protectedPaths: [],
    denyReadPaths: [],
  };

  it("denies network by default", () => {
    const profile = __testing.generateProfile(policy);

    expect(profile).toContain("(deny network*)");
    expect(profile).not.toContain("(allow network-outbound)");
  });

  it("allows outbound network when sandbox network is enabled", () => {
    const profile = __testing.generateProfile(policy, { allowNetwork: true });

    expect(profile).toContain("(allow network-outbound)");
    expect(profile).not.toContain("(deny network*)");
  });
});
