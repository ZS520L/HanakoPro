import { describe, expect, it, vi } from "vitest";

describe("server i18n default loading", () => {
  it("translates known keys before an explicit loadLocale call", async () => {
    vi.resetModules();
    const { t } = await import("../server/i18n.js");

    expect(t("error.defaultChannelName")).not.toBe("error.defaultChannelName");
    expect(t("error.defaultChannelDesc")).not.toBe("error.defaultChannelDesc");
  });
});
