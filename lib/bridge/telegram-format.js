import MarkdownIt from "markdown-it";

const TELEGRAM_MAX_HTML_LENGTH = 4096;
const SOURCE_CHUNK_HEADROOM = 256;

const md = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: false,
});

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeHref(raw) {
  try {
    const url = new URL(String(raw || ""));
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {}
  return "";
}

function stripUnsafeMarkdownLinks(source) {
  return String(source || "")
    .replace(/\[([^\]\n]+)\]\(\s*javascript:[^\n]*\)/gi, "$1")
    .replace(
      /\[([^\]\n]+)\]\(\s*([^)]+?)\s*\)/g,
      (match, label, href) => safeHref(href) ? match : label,
    );
}

function renderInline(tokens = []) {
  const out = [];
  const linkStack = [];

  for (const token of tokens) {
    switch (token.type) {
      case "text":
        out.push(escapeHtml(token.content));
        break;
      case "code_inline":
        out.push(`<code>${escapeHtml(token.content)}</code>`);
        break;
      case "softbreak":
      case "hardbreak":
        out.push("\n");
        break;
      case "strong_open":
        out.push("<b>");
        break;
      case "strong_close":
        out.push("</b>");
        break;
      case "em_open":
        out.push("<i>");
        break;
      case "em_close":
        out.push("</i>");
        break;
      case "s_open":
        out.push("<s>");
        break;
      case "s_close":
        out.push("</s>");
        break;
      case "link_open": {
        const href = safeHref(token.attrGet?.("href"));
        linkStack.push(!!href);
        if (href) out.push(`<a href="${escapeHtml(href)}">`);
        break;
      }
      case "link_close": {
        const enabled = linkStack.pop();
        if (enabled) out.push("</a>");
        break;
      }
      case "image":
        out.push(escapeHtml(token.content || token.attrGet?.("alt") || ""));
        break;
      default:
        if (token.content) out.push(escapeHtml(token.content));
        break;
    }
  }

  return out.join("");
}

function trimBlockBreaks(value) {
  return value
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatTelegramHtml(markdown) {
  const tokens = md.parse(stripUnsafeMarkdownLinks(markdown), {});
  const out = [];
  const listStack = [];
  let headingDepth = 0;
  let listItemDepth = 0;

  for (const token of tokens) {
    switch (token.type) {
      case "heading_open":
        headingDepth += 1;
        break;
      case "heading_close":
        headingDepth = Math.max(0, headingDepth - 1);
        out.push("\n\n");
        break;
      case "paragraph_open":
        break;
      case "paragraph_close":
        if (listItemDepth === 0) out.push("\n\n");
        break;
      case "inline": {
        const rendered = renderInline(token.children || []);
        out.push(headingDepth > 0 ? `<b>${rendered}</b>` : rendered);
        break;
      }
      case "bullet_list_open":
        listStack.push({ type: "bullet", next: 1 });
        break;
      case "ordered_list_open": {
        const start = Number(token.attrGet?.("start") || 1);
        listStack.push({ type: "ordered", next: Number.isFinite(start) ? start : 1 });
        break;
      }
      case "bullet_list_close":
      case "ordered_list_close":
        listStack.pop();
        out.push("\n");
        break;
      case "list_item_open": {
        listItemDepth += 1;
        const list = listStack[listStack.length - 1];
        if (list?.type === "ordered") {
          out.push(`${list.next}. `);
          list.next += 1;
        } else {
          out.push("- ");
        }
        break;
      }
      case "list_item_close":
        listItemDepth = Math.max(0, listItemDepth - 1);
        out.push("\n");
        break;
      case "fence":
      case "code_block":
        out.push(`<pre><code>${escapeHtml(token.content)}</code></pre>\n\n`);
        break;
      case "blockquote_open":
        out.push("<blockquote>");
        break;
      case "blockquote_close":
        out.push("</blockquote>\n\n");
        break;
      case "hr":
        out.push("-----\n\n");
        break;
      default:
        break;
    }
  }

  return trimBlockBreaks(out.join(""));
}

function splitSource(source, limit) {
  const chunks = [];
  let rest = String(source || "");
  while (rest.length > limit) {
    let idx = rest.lastIndexOf("\n\n", limit);
    if (idx < Math.floor(limit * 0.4)) idx = rest.lastIndexOf("\n", limit);
    if (idx < Math.floor(limit * 0.4)) idx = rest.lastIndexOf(" ", limit);
    if (idx < Math.floor(limit * 0.4)) idx = limit;

    const chunk = rest.slice(0, idx).trimEnd();
    if (chunk) chunks.push(chunk);
    rest = rest.slice(idx).trimStart();
  }
  if (rest.trim()) chunks.push(rest.trim());
  return chunks;
}

export function formatTelegramMessageChunks(markdown, options = {}) {
  const maxLength = Math.max(64, Number(options.maxLength) || TELEGRAM_MAX_HTML_LENGTH);
  const initialSourceLimit = Math.max(32, maxLength - SOURCE_CHUNK_HEADROOM);
  const queue = splitSource(String(markdown || ""), initialSourceLimit);
  const chunks = [];

  while (queue.length > 0) {
    const source = queue.shift();
    const rendered = formatTelegramHtml(source);
    if (!rendered) continue;
    if (rendered.length <= maxLength) {
      chunks.push(rendered);
      continue;
    }
    if (source.length <= 1) {
      chunks.push(rendered.slice(0, maxLength));
      continue;
    }
    queue.unshift(...splitSource(source, Math.max(1, Math.floor(source.length / 2))));
  }

  return chunks;
}
