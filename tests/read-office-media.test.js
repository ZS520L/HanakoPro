import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VISION_CONTEXT_START } from "../core/vision-bridge.js";
import { wrapReadOfficeMedia } from "../lib/sandbox/read-office-media.js";

const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

let tmpDir;

function makeReadTool(result) {
  return {
    name: "read",
    execute: vi.fn(async () => result),
  };
}

function makeCtx(sessionPath, model) {
  return {
    model,
    sessionManager: {
      getSessionFile: () => sessionPath,
    },
  };
}

async function writeDocxWithEmbeddedPng(filePath) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    <w:p>
      <w:r><w:t>Doc text</w:t></w:r>
      <w:r>
        <w:drawing>
          <wp:inline>
            <wp:docPr id="1" name="Picture 1"/>
            <a:graphic>
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic>
                  <pic:blipFill>
                    <a:blip r:embed="rIdImage1"/>
                  </pic:blipFill>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>
  </w:body>
</w:document>`);
  zip.file("word/media/image1.png", Buffer.from(TINY_PNG_BASE64, "base64"));
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
  await fsp.writeFile(filePath, buffer);
}

describe("wrapReadOfficeMedia", () => {
  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hana-read-office-"));
  });

  afterEach(async () => {
    if (tmpDir) await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it("registers docx embedded images as session files and keeps native image blocks for image-capable models", async () => {
    const sessionPath = path.join(tmpDir, "sessions", "read.jsonl");
    const docxPath = path.join(tmpDir, "embedded.docx");
    await writeDocxWithEmbeddedPng(docxPath);

    const base = makeReadTool({ content: [{ type: "text", text: "Doc text" }] });
    const recordFileOperation = vi.fn((entry) => ({
      id: `sf_${path.basename(entry.filePath)}`,
      fileId: `sf_${path.basename(entry.filePath)}`,
      sessionPath: entry.sessionPath,
      filePath: entry.filePath,
      label: entry.label,
      filename: entry.label,
      mime: "image/png",
      kind: "image",
      size: fs.statSync(entry.filePath).size,
      status: "available",
    }));
    const wrapped = wrapReadOfficeMedia(base, tmpDir, {
      hanakoHome: tmpDir,
      getSessionPath: () => sessionPath,
      recordFileOperation,
      getVisionBridge: () => null,
      isVisionAuxiliaryEnabled: () => false,
    });

    const result = await wrapped.execute(
      "call-1",
      { path: docxPath },
      null,
      null,
      makeCtx(sessionPath, { id: "gpt-4o", provider: "openai", input: ["text", "image"] }),
    );

    expect(recordFileOperation).toHaveBeenCalledWith(expect.objectContaining({
      sessionPath,
      origin: "agent_read_docx_media",
      operation: "read",
      storageKind: "managed_cache",
    }));
    expect(result.content).toEqual([
      { type: "text", text: "Doc text" },
      expect.objectContaining({ type: "image", mimeType: "image/png", data: TINY_PNG_BASE64 }),
    ]);
    expect(result.content[0].text).not.toContain(TINY_PNG_BASE64);
    expect(result.details.media.items).toEqual([
      expect.objectContaining({ type: "session_file", kind: "image", mime: "image/png" }),
    ]);
  });

  it("returns auxiliary vision notes for docx embedded images on text-only models", async () => {
    const sessionPath = path.join(tmpDir, "sessions", "read.jsonl");
    const docxPath = path.join(tmpDir, "embedded.docx");
    await writeDocxWithEmbeddedPng(docxPath);

    const prepareResources = vi.fn(async () => ({
      notes: [{ key: "visual-resource:docx:test", label: "embedded.docx#1", note: "image_overview: A tiny embedded image." }],
    }));
    const recordFileOperation = vi.fn((entry) => ({
      id: `sf_${path.basename(entry.filePath)}`,
      fileId: `sf_${path.basename(entry.filePath)}`,
      sessionPath: entry.sessionPath,
      filePath: entry.filePath,
      label: entry.label,
      filename: entry.label,
      mime: "image/png",
      kind: "image",
      size: fs.statSync(entry.filePath).size,
      status: "available",
    }));
    const wrapped = wrapReadOfficeMedia(makeReadTool({ content: [{ type: "text", text: "Doc text" }] }), tmpDir, {
      hanakoHome: tmpDir,
      getSessionPath: () => sessionPath,
      recordFileOperation,
      getVisionBridge: () => ({ prepareResources }),
      isVisionAuxiliaryEnabled: () => true,
    });

    const result = await wrapped.execute(
      "call-1",
      { path: docxPath },
      null,
      null,
      makeCtx(sessionPath, { id: "deepseek-chat", provider: "deepseek", input: ["text"] }),
    );

    expect(prepareResources).toHaveBeenCalledWith(expect.objectContaining({
      sessionPath,
      targetModel: expect.objectContaining({ id: "deepseek-chat" }),
      resources: [expect.objectContaining({
        label: "embedded-image-1.png",
        image: expect.objectContaining({ type: "image", mimeType: "image/png", data: TINY_PNG_BASE64 }),
      })],
    }));
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain(VISION_CONTEXT_START);
    expect(result.content[0].text).toContain("image_overview: A tiny embedded image.");
    expect(result.details.visionAdapted).toBe(true);
    expect(result.details.media.items).toHaveLength(1);
  });
});
