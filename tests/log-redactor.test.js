import { describe, expect, it } from "vitest";
import redactor from "../shared/log-redactor.cjs";

const {
  redactLogText,
  redactLogValue,
  redactLogLabel,
  formatLogArgs,
} = redactor;

describe("log redaction", () => {
  it("redacts secrets, auth headers, query tokens, and common key prefixes", () => {
    const raw = [
      "Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz123456",
      "url=https://user:pass@example.com/cb?token=secret-token&safe=1",
      "client_secret=abc123abc123abc123abc123",
      "api_key: gsk_abcdefghijklmnopqrstuvwxyz",
      "Cookie: sessionid=super-secret; theme=dark",
    ].join("\n");

    const cleaned = redactLogText(raw);

    expect(cleaned).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(cleaned).not.toContain("secret-token");
    expect(cleaned).not.toContain("abc123abc123abc123abc123");
    expect(cleaned).not.toContain("gsk_abcdefghijklmnopqrstuvwxyz");
    expect(cleaned).not.toContain("sessionid=super-secret");
    expect(cleaned).toContain("Authorization: Bearer [redacted]");
    expect(cleaned).toContain("token=[redacted]");
    expect(cleaned).toContain("client_secret=[redacted]");
    expect(cleaned).toContain("Cookie=[redacted]");
  });

  it("redacts local home paths across macOS, Linux, Windows, and file URLs", () => {
    const raw = [
      "/Users/alice/Desktop/private.txt",
      "file:///Users/alice/Desktop/private.txt",
      "/home/bob/.hanako/auth.json",
      "C:\\Users\\carol\\AppData\\Roaming\\Hanako\\crash.log",
      "C:/Users/dave/AppData/Roaming/Hanako/crash.log",
    ].join("\n");

    const cleaned = redactLogText(raw, { homeDir: "/Users/alice" });

    expect(cleaned).not.toContain("/Users/alice");
    expect(cleaned).not.toContain("/home/bob");
    expect(cleaned).not.toContain("Users\\carol");
    expect(cleaned).not.toContain("Users/dave");
    expect(cleaned).toContain("~/Desktop/private.txt");
    expect(cleaned).toContain("file://~/Desktop/private.txt");
  });

  it("redacts direct personal identifiers and long random strings", () => {
    const cleaned = redactLogText([
      "mail me@example.com",
      "ssn 123-45-6789",
      "id 110105199001011234",
      "card 4111 1111 1111 1111",
      "token qwertyuiopasdfghjklzxcvbnmqwertyuiopasdfghjklzxcvbnm",
    ].join("\n"));

    expect(cleaned).toContain("[email]");
    expect(cleaned).toContain("[ssn]");
    expect(cleaned).toContain("[id_card]");
    expect(cleaned).toContain("[credit_card]");
    expect(cleaned).toContain("[token]");
  });

  it("redacts object values by sensitive key without mutating the original object", () => {
    const raw = {
      userId: "u-123456",
      chatId: "chat-789",
      sessionPath: "/Users/alice/.hanako/agents/a/sessions/s.md",
      nested: {
        password: "secret-password",
        safe: "hello",
      },
    };

    const cleaned = redactLogValue(raw, { homeDir: "/Users/alice" });

    expect(cleaned).toEqual({
      userId: "[redacted]",
      chatId: "[redacted]",
      sessionPath: "~/.hanako/agents/a/sessions/s.md",
      nested: {
        password: "[redacted]",
        safe: "hello",
      },
    });
    expect(raw.userId).toBe("u-123456");
    expect(raw.nested.password).toBe("secret-password");
  });

  it("redacts Error messages and stacks", () => {
    const err = new Error("failed for token=abc123abc123abc123abc123");
    err.stack = "Error: failed\n    at /Users/alice/project/file.js:1:1";

    const cleaned = redactLogValue(err, { homeDir: "/Users/alice" });

    expect(cleaned.message).toBe("failed for token=[redacted]");
    expect(cleaned.stack).toContain("~/project/file.js");
    expect(cleaned.stack).not.toContain("/Users/alice");
  });

  it("formats console args with redaction and safe labels", () => {
    const label = redactLogLabel("bridge\nbad module!");
    const formatted = formatLogArgs([
      "token=abc123abc123abc123abc123",
      { authorization: "Bearer sk-abcdefghijklmnopqrstuvwxyz123456" },
    ]);

    expect(label).toBe("bridge_bad_module_");
    expect(formatted).not.toContain("abc123abc123abc123abc123");
    expect(formatted).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
  });
});
