/**
 * web-reader.js — HTML → Markdown reader for LLM-friendly web_fetch output.
 *
 * This is intentionally small and dependency-light. It uses jsdom as the HTML
 * parser, removes page chrome, chooses the most likely content root, then emits
 * Markdown so the model does not have to reason over raw navigation/footer DOM.
 */
import { JSDOM } from "jsdom";

const CHROME_SELECTOR = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "nav",
  "footer",
  "header",
  "aside",
  "form",
  "button",
  "[role='navigation']",
  "[aria-hidden='true']",
].join(",");

const BLOCK_TAGS = new Set([
  "ARTICLE", "MAIN", "SECTION", "DIV", "P", "UL", "OL", "LI",
  "BLOCKQUOTE", "PRE", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH",
  "H1", "H2", "H3", "H4", "H5", "H6",
]);

function cleanWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function escapeMarkdown(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/`/g, "\\`")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function absoluteUrl(raw, baseUrl) {
  if (!raw) return "";
  try {
    const url = new URL(raw, baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.href;
  } catch {
    return "";
  }
}

function removePageChrome(document) {
  for (const el of Array.from(document.querySelectorAll(CHROME_SELECTOR))) {
    el.remove();
  }
}

function textLength(el) {
  return cleanWhitespace(el.textContent).length;
}

function linkDensity(el) {
  const textLen = Math.max(1, textLength(el));
  const linkText = Array.from(el.querySelectorAll("a"))
    .map((a) => cleanWhitespace(a.textContent))
    .join(" ");
  return linkText.length / textLen;
}

function chooseContentRoot(document) {
  const direct = document.querySelector("article")
    || document.querySelector("main")
    || document.querySelector("[role='main']");
  if (direct && textLength(direct) > 80) return direct;

  const candidates = Array.from(document.querySelectorAll("article, main, [role='main'], section, div"))
    .filter((el) => textLength(el) > 80)
    .map((el) => {
      const headings = el.querySelectorAll("h1,h2,h3").length;
      const paragraphs = el.querySelectorAll("p").length;
      const links = linkDensity(el);
      return {
        el,
        score: textLength(el) + paragraphs * 120 + headings * 80 - links * 300,
      };
    })
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.el || document.body;
}

function metadataFrom(document) {
  const meta = (selector, attr = "content") => document.querySelector(selector)?.getAttribute(attr)?.trim() || "";
  return {
    site_name: meta("meta[property='og:site_name']") || meta("meta[name='application-name']"),
    excerpt: meta("meta[property='og:description']") || meta("meta[name='description']"),
    byline: meta("meta[name='author']") || meta("meta[property='article:author']"),
  };
}

function titleFrom(document, root) {
  return cleanWhitespace(
    root.querySelector("h1")?.textContent
    || document.querySelector("meta[property='og:title']")?.getAttribute("content")
    || document.title
  );
}

function renderChildren(node, baseUrl, opts = {}) {
  return Array.from(node.childNodes)
    .map((child) => renderNode(child, baseUrl, opts))
    .filter(Boolean)
    .join("");
}

function block(text) {
  const cleaned = String(text || "").trim();
  return cleaned ? `${cleaned}\n\n` : "";
}

function renderListItems(node, baseUrl, ordered) {
  return Array.from(node.children)
    .filter((child) => child.tagName === "LI")
    .map((li, index) => {
      const marker = ordered ? `${index + 1}.` : "-";
      const body = renderChildren(li, baseUrl, { inline: false }).trim().replace(/\n{2,}/g, "\n");
      return body ? `${marker} ${body}` : "";
    })
    .filter(Boolean)
    .join("\n") + "\n\n";
}

function renderNode(node, baseUrl, opts = {}) {
  if (node.nodeType === 3) {
    const text = cleanWhitespace(node.nodeValue);
    if (!text) return "";
    return opts.inline ? escapeMarkdown(text) : `${escapeMarkdown(text)} `;
  }
  if (node.nodeType !== 1) return "";

  const tag = node.tagName;
  if (tag === "BR") return "\n";
  if (tag === "A") {
    const text = cleanWhitespace(node.textContent);
    const href = absoluteUrl(node.getAttribute("href"), baseUrl);
    if (!text) return "";
    if (!href) return escapeMarkdown(text);
    return `[${escapeMarkdown(text)}](${href})`;
  }
  if (tag === "IMG") {
    const alt = cleanWhitespace(node.getAttribute("alt") || "");
    const src = absoluteUrl(node.getAttribute("src"), baseUrl);
    return src ? `![${escapeMarkdown(alt)}](${src})` : "";
  }
  if (tag === "STRONG" || tag === "B") {
    const body = renderChildren(node, baseUrl, { inline: true }).trim();
    return body ? `**${body}**` : "";
  }
  if (tag === "EM" || tag === "I") {
    const body = renderChildren(node, baseUrl, { inline: true }).trim();
    return body ? `_${body}_` : "";
  }
  if (tag === "CODE") {
    return `\`${cleanWhitespace(node.textContent).replace(/`/g, "\\`")}\``;
  }
  if (tag === "PRE") {
    return `\`\`\`\n${String(node.textContent || "").trim()}\n\`\`\`\n\n`;
  }
  if (/^H[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    return block(`${"#".repeat(level)} ${renderChildren(node, baseUrl, { inline: true }).trim()}`);
  }
  if (tag === "UL") return renderListItems(node, baseUrl, false);
  if (tag === "OL") return renderListItems(node, baseUrl, true);
  if (tag === "BLOCKQUOTE") {
    const body = renderChildren(node, baseUrl).trim().split("\n").map((line) => `> ${line}`).join("\n");
    return block(body);
  }

  const body = renderChildren(node, baseUrl, { inline: !BLOCK_TAGS.has(tag) }).trim();
  if (!body) return "";
  return BLOCK_TAGS.has(tag) ? block(body) : body;
}

function normalizeMarkdown(markdown) {
  return String(markdown || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function htmlToMarkdownDocument(html, url) {
  const dom = new JSDOM(String(html || ""), { url });
  const { document } = dom.window;
  removePageChrome(document);
  const root = chooseContentRoot(document);
  const title = titleFrom(document, root);
  const metadata = metadataFrom(document);
  const content = normalizeMarkdown(renderNode(root, url));

  return {
    url,
    title,
    content,
    format: "markdown",
    metadata: {
      reader: "html-reader",
      ...Object.fromEntries(Object.entries(metadata).filter(([, value]) => value)),
    },
  };
}
