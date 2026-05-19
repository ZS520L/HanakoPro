import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import browserSearch from "../lib/browser/browser-search-extractors.cjs";

const {
  BROWSER_SEARCH_PROVIDER_IDS,
  buildBrowserSearchExtractionScript,
  buildBrowserSearchLoadOptions,
  buildBrowserSearchUrl,
} = browserSearch;

function extract(provider, html, url) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  return dom.window.eval(buildBrowserSearchExtractionScript(provider, 5));
}

describe("browser search extractors", () => {
  it("declares Google, Bing, and DuckDuckGo browser providers", () => {
    expect(BROWSER_SEARCH_PROVIDER_IDS).toEqual([
      "bing_browser",
      "google_browser",
      "duckduckgo_browser",
    ]);
  });

  it("builds browser search URLs without API keys", () => {
    expect(buildBrowserSearchUrl("bing_browser", "hana search", 3)).toBe(
      "https://www.bing.com/search?q=hana+search&count=3",
    );
    expect(buildBrowserSearchUrl("google_browser", "hana search", 3)).toBe(
      "https://www.google.com/search?q=hana+search&num=3",
    );
    expect(buildBrowserSearchUrl("duckduckgo_browser", "hana search", 3)).toBe(
      "https://duckduckgo.com/?q=hana+search&kl=wt-wt",
    );
  });

  it("builds Bing browser searches with an explicit Chinese market contract", () => {
    expect(buildBrowserSearchUrl("bing_browser", "中文 搜索", 3, { locale: "zh-CN" })).toBe(
      "https://www.bing.com/search?q=%E4%B8%AD%E6%96%87+%E6%90%9C%E7%B4%A2&count=3&mkt=zh-CN&setlang=zh-CN&cc=CN",
    );

    expect(buildBrowserSearchLoadOptions("bing_browser", { locale: "zh-CN" })).toMatchObject({
      userAgent: expect.stringContaining("Chrome"),
      extraHeaders: expect.stringContaining("Accept-Language: zh-CN,zh;q=0.9,en;q=0.8"),
    });
  });

  it("extracts Bing results into a Tavily-like shape", () => {
    const result = extract("bing_browser", `
      <main>
        <ol>
          <li class="b_algo">
            <h2><a href="https://example.com/a">Alpha Result</a></h2>
            <div class="b_caption"><p>Alpha snippet for the model.</p></div>
            <cite>example.com/a</cite>
          </li>
        </ol>
      </main>
    `, "https://www.bing.com/search?q=hana");

    expect(result.blocked).toBe(false);
    expect(result.results).toEqual([
      {
        title: "Alpha Result",
        url: "https://example.com/a",
        content: "Alpha snippet for the model.",
        rank: 1,
        score: null,
        metadata: {
          display_url: "example.com/a",
          engine: "bing",
        },
      },
    ]);
  });

  it("unwraps Google result redirect URLs", () => {
    const result = extract("google_browser", `
      <div class="g">
        <a href="/url?q=https%3A%2F%2Fexample.com%2Fdoc&sa=U">
          <h3>Google Result</h3>
        </a>
        <div class="VwiC3b">Google snippet for the model.</div>
      </div>
    `, "https://www.google.com/search?q=hana");

    expect(result.results[0]).toMatchObject({
      title: "Google Result",
      url: "https://example.com/doc",
      content: "Google snippet for the model.",
      rank: 1,
      metadata: {
        engine: "google",
      },
    });
  });

  it("extracts DuckDuckGo result cards when that page is reachable", () => {
    const result = extract("duckduckgo_browser", `
      <article data-testid="result">
        <a data-testid="result-title-a" href="https://example.com/duck">
          Duck Result
        </a>
        <div data-result="snippet">Duck snippet for the model.</div>
      </article>
    `, "https://duckduckgo.com/?q=hana");

    expect(result.results[0]).toMatchObject({
      title: "Duck Result",
      url: "https://example.com/duck",
      content: "Duck snippet for the model.",
      rank: 1,
      metadata: {
        engine: "duckduckgo",
      },
    });
  });

  it("reports bot-block pages instead of returning empty results", () => {
    const result = extract("google_browser", `
      <body>
        <h1>Our systems have detected unusual traffic from your computer network</h1>
      </body>
    `, "https://www.google.com/sorry/index");

    expect(result.blocked).toBe(true);
    expect(result.captcha).toBe(true);
    expect(result.results).toEqual([]);
    expect(result.reason).toContain("verification");
  });

  it("distinguishes an extractor drift from a genuine Bing no-results page", () => {
    const drift = extract("bing_browser", `
      <main>
        <section id="b_results">
          <article>
            <a href="https://example.com/a">Organic result with an unknown card shape</a>
            <p>Snippet exists but selectors no longer match.</p>
          </article>
        </section>
      </main>
    `, "https://www.bing.com/search?q=hana");

    expect(drift.status).toBe("extraction_failed");
    expect(drift.blocked).toBe(false);
    expect(drift.reason).toContain("could not be extracted");

    const noResults = extract("bing_browser", `
      <main>
        <div id="b_results">没有与此相关的结果</div>
      </main>
    `, "https://www.bing.com/search?q=%E4%B8%8D%E5%AD%98%E5%9C%A8");

    expect(noResults.status).toBe("no_results");
    expect(noResults.results).toEqual([]);
  });
});
