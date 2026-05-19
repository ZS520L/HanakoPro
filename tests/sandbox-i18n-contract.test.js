import { describe, expect, it } from "vitest";
import { loadLocale, t } from "../server/i18n.js";

describe("sandbox i18n contract", () => {
  it("guides English agents to diagnose path boundaries before changing sandbox settings", () => {
    loadLocale("en");
    const text = t("sandbox.blocked", { reason: "Command accessed a restricted path: C:\\Users\\alice" });

    expect(text).toContain("Check the current workspace");
    expect(text).toContain("path syntax");
    expect(text).not.toContain("adjust sandbox policy");
  });

  it("guides Chinese agents to diagnose path boundaries before changing sandbox settings", () => {
    loadLocale("zh-CN");
    const text = t("sandbox.blocked", { reason: "命令访问了受限路径：C:\\Users\\alice" });

    expect(text).toContain("先检查当前工作区");
    expect(text).toContain("路径写法");
    expect(text).not.toContain("调整沙盒策略");
  });
});
