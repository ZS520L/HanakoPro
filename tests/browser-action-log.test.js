import { describe, expect, it } from "vitest";
import { summarizeBrowserActionParams } from "../lib/tools/browser-action-log.js";

describe("browser action log summaries", () => {
  it("does not keep typed text in browser action logs", () => {
    const summary = summarizeBrowserActionParams("type", {
      ref: "email",
      text: "my-private-email@example.com",
      pressEnter: true,
    });

    expect(summary).toEqual({
      ref: "email",
      textLength: 28,
      pressEnter: true,
    });
    expect(JSON.stringify(summary)).not.toContain("my-private-email@example.com");
  });

  it("does not keep evaluate expressions in browser action logs", () => {
    const summary = summarizeBrowserActionParams("evaluate", {
      expression: "localStorage.getItem('secret-token')",
    });

    expect(summary).toEqual({ expressionLength: 36 });
    expect(JSON.stringify(summary)).not.toContain("secret-token");
  });

  it("redacts navigate URLs before storing them", () => {
    const summary = summarizeBrowserActionParams("navigate", {
      url: "https://user:pass@example.com/cb?token=super-secret&ok=1",
    });

    expect(summary.url).toContain("token=[redacted]");
    expect(summary.url).not.toContain("super-secret");
    expect(summary.url).not.toContain("user:pass");
  });
});
