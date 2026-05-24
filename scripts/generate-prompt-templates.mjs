import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(rootDir, "shared", "prompt-templates");
const targetFile = join(rootDir, "shared", "builtin-simple-prompt-templates.js");

const templateFiles = [
  "hanako-agentic-coding-assistant.md",
];

function parseTemplateMarkdown(fileName, markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error(`${fileName}: missing frontmatter`);
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    meta[key] = value;
  }
  for (const key of ["id", "name", "description"]) {
    if (!meta[key]) throw new Error(`${fileName}: missing ${key}`);
  }
  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    content: match[2].trimEnd(),
  };
}

const templates = [];
for (const fileName of templateFiles) {
  const markdown = await readFile(join(sourceDir, fileName), "utf8");
  templates.push(parseTemplateMarkdown(fileName, markdown));
}

const output = `export const BUILTIN_SIMPLE_PROMPT_TEMPLATES = ${JSON.stringify(templates, null, 2)};\n`;
await writeFile(targetFile, output, "utf8");
