import { describe, expect, it } from "vitest";
import { htmlToMarkdownDocument } from "../lib/tools/web-reader.js";

describe("web reader markdown extraction", () => {
  it("extracts the readable article body as Markdown and removes page chrome", async () => {
    const doc = await htmlToMarkdownDocument(`
      <!doctype html>
      <html>
        <head>
          <title>Fallback page title</title>
          <meta property="og:site_name" content="Example Site">
        </head>
        <body>
          <nav>Home Pricing Login</nav>
          <article>
            <h1>Readable Title</h1>
            <p>Useful paragraph for the model.</p>
            <p><a href="/source">source link</a></p>
          </article>
          <footer>Cookie settings and copyright links</footer>
        </body>
      </html>
    `, "https://example.com/articles/post");

    expect(doc).toMatchObject({
      url: "https://example.com/articles/post",
      title: "Readable Title",
      format: "markdown",
      metadata: {
        reader: "html-reader",
        site_name: "Example Site",
      },
    });
    expect(doc.content).toContain("Useful paragraph for the model.");
    expect(doc.content).toContain("[source link](https://example.com/source)");
    expect(doc.content).not.toContain("Home Pricing Login");
    expect(doc.content).not.toContain("Cookie settings");
  });
});
