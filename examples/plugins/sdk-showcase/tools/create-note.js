import fs from "node:fs";
import path from "node:path";
import { createMediaDetails, defineTool } from "@hana/plugin-runtime";

const tool = defineTool({
  name: "sdk_showcase_create_note",
  description: "Create a markdown note and return it as SessionFile media.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      body: { type: "string" }
    }
  },
  async execute(input = {}, toolCtx) {
    if (!toolCtx.sessionPath) {
      throw new Error("sdk_showcase_create_note requires sessionPath");
    }
    if (!toolCtx.stageFile) {
      throw new Error("sdk_showcase_create_note requires stageFile");
    }

    const title = typeof input.title === "string" && input.title.trim()
      ? input.title.trim()
      : "SDK Showcase Note";
    const body = typeof input.body === "string" ? input.body : "Generated from the Hana plugin runtime SDK.";
    const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "note";
    const outputDir = path.join(toolCtx.dataDir, "notes");
    const filePath = path.join(outputDir, `${safeName}.md`);

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(filePath, `# ${title}\n\n${body}\n`, "utf-8");

    const staged = toolCtx.stageFile({
      sessionPath: toolCtx.sessionPath,
      filePath,
      label: `${safeName}.md`,
    });

    return {
      content: [{ type: "text", text: `Created ${safeName}.md` }],
      details: createMediaDetails([staged]),
    };
  },
});

export const { name, description, parameters, execute } = tool;
