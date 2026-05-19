import { describe, expect, it } from "vitest";
import {
  formatTelegramHtml,
  formatTelegramMessageChunks,
} from "../lib/bridge/telegram-format.js";

describe("telegram Markdown formatting", () => {
  it("renders Markdown through Telegram's supported HTML subset", () => {
    expect(formatTelegramHtml("# Title\n\n**bold** _em_ `code`")).toBe(
      "<b>Title</b>\n\n<b>bold</b> <i>em</i> <code>code</code>",
    );
  });

  it("escapes raw HTML and unsafe links before sending parse_mode HTML", () => {
    expect(formatTelegramHtml("<script>alert(1)</script> [x](javascript:alert(1))")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt; x",
    );
  });

  it("chunks before rendering so Telegram HTML tags and entities are not sliced", () => {
    const chunks = formatTelegramMessageChunks("**" + "a & b ".repeat(900) + "**", { maxLength: 4096 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
      expect(chunk).not.toMatch(/&(amp|lt|gt|quot)?$/);
      expect(chunk).not.toMatch(/<[^>]*$/);
    }
  });
});
