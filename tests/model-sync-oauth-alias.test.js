import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncModels } from "../core/model-sync.js";

let tmpHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "hana-model-sync-alias-"));
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("model sync OAuth aliases", () => {
  it("does not project sdk-auth-alias providers into models.json", () => {
    const modelsJsonPath = path.join(tmpHome, "models.json");
    const authJsonPath = path.join(tmpHome, "auth.json");
    fs.writeFileSync(authJsonPath, JSON.stringify({
      "openai-codex": { access: "test-token" },
    }));

    syncModels({
      "openai-codex-oauth": {
        base_url: "https://chatgpt.com/backend-api",
        api: "openai-codex-responses",
        auth_type: "oauth",
        models: [
          "gpt-5.4",
          "gpt-5.5",
          { id: "gpt-image-2", type: "image", name: "GPT Image 2" },
        ],
      },
      openai: {
        base_url: "https://api.openai.com/v1",
        api: "openai-completions",
        auth_type: "api-key",
        api_key: "sk-test",
        models: ["gpt-5.5"],
      },
    }, {
      modelsJsonPath,
      authJsonPath,
      oauthKeyMap: { "openai-codex-oauth": "openai-codex" },
      chatProjectionMap: { "openai-codex-oauth": "sdk-auth-alias" },
    });

    const written = JSON.parse(fs.readFileSync(modelsJsonPath, "utf-8"));
    expect(written.providers).not.toHaveProperty("openai-codex-oauth");
    expect(written.providers).toHaveProperty("openai");
  });
});
