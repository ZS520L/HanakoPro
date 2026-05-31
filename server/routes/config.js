/**
 * 配置管理 REST 路由
 */
import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { Hono } from "hono";
import { emitAppEvent } from "../app-events.js";
import { safeJson } from "../hono-helpers.js";
import { t } from "../i18n.js";
import { debugLog } from "../../lib/debug-log.js";
import { getRawConfig, clearConfigCache } from "../../lib/memory/config-loader.js";
import { FactStore } from "../../lib/memory/fact-store.js";
import {
  writeCompiledResetMarker,
  clearCompiledMemoryArtifacts,
  clearCompiledSummarySources,
} from "../../lib/memory/compiled-memory-state.js";
import { assemble } from "../../lib/memory/compile.js";
import {
  ensureDefaultWorkspace,
  resolveDefaultWorkspacePath,
} from "../../shared/default-workspace.js";
import { splitByScope, injectGlobalFields } from '../../shared/config-scope.js';
import { mergeWorkspaceHistory, normalizeWorkspacePath } from "../../shared/workspace-history.js";
import { resolveAgent, resolveAgentStrict, AgentNotFoundError } from "../utils/resolve-agent.js";
import {
  buildInlineProviderCredentialUpdate,
  clearInlineProviderCredentialFields,
  hasInlineProviderCredentialPatch,
} from "./provider-credentials.js";

function hasOwn(value, key) {
  return !!value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key);
}

function getGlobalValue(globalFields, key) {
  return globalFields.find((field) => field.key === key)?.value;
}

const COMPILED_MEMORY_SOURCES = [
  { source: "facts", file: "facts.md", title: "重要事实", englishTitle: "Key facts" },
  { source: "today", file: "today.md", title: "今天", englishTitle: "Today" },
  { source: "week", file: "week.md", title: "本周早些时候", englishTitle: "Earlier this week" },
  { source: "longterm", file: "longterm.md", title: "长期情况", englishTitle: "Long-term context" },
];

function splitMemoryItems(content) {
  return String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^#{1,6}\s+/.test(line))
    .map((line) => line.replace(/^[-*+]\s+/, "").trim())
    .filter((line) => line && line !== "（暂无）" && line !== "(none)" && line !== "（暂无记忆）" && line !== "(No memory yet)");
}

function serializeMemoryItems(items) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") + "\n" : "";
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

function getCompiledSourceMeta(source) {
  return COMPILED_MEMORY_SOURCES.find((entry) => entry.source === source) || null;
}

function emitConfigAppEvents(engine, { globalFields, agentPartial, providersChanged }) {
  const agentId = engine.currentAgentId || null;
  if (
    providersChanged
    || hasOwn(agentPartial, "api")
    || hasOwn(agentPartial, "embedding_api")
    || hasOwn(agentPartial, "utility_api")
    || hasOwn(agentPartial, "models")
  ) {
    emitAppEvent(engine, "models-changed", { agentId });
  }

  const locale = getGlobalValue(globalFields, "locale");
  if (locale !== undefined) {
    emitAppEvent(engine, "locale-changed", { locale });
  }

  const editor = getGlobalValue(globalFields, "editor");
  if (editor !== undefined) {
    emitAppEvent(engine, "editor-typography-changed", {
      editor: typeof engine.getEditor === "function" ? engine.getEditor() : editor,
    });
  }
}

export function createConfigRoute(engine) {
  const route = new Hono();

  // 读取配置（脱敏：隐藏 API key，附带 _raw 原始结构 + providers）
  route.get("/config", async (c) => {
    try {
      const config = { ...engine.config };
      const raw = getRawConfig(engine.configPath) || {};

      // 本地应用，直接返回完整 key（前端用 type="password" 控制显隐）

      // 附带原始配置结构（未经 fallback 解析，让前端知道用户显式设了什么）
      config._raw = {
        api: { provider: raw.api?.provider || "", base_url: raw.api?.base_url || "" },
        embedding_api: { provider: raw.embedding_api?.provider || "", base_url: raw.embedding_api?.base_url || "" },
        utility_api: { provider: raw.utility_api?.provider || "", base_url: raw.utility_api?.base_url || "" },
      };

      // 供应商列表（附带 model_count）
      const rawProviders = engine.providerRegistry.getAllProvidersRaw();
      const providerEntries = {};
      for (const [name, p] of Object.entries(rawProviders)) {
        const entry = engine.providerRegistry.get(name);
        providerEntries[name] = {
          base_url: p.base_url || entry?.baseUrl || "",
          api: p.api || entry?.api || "",
          api_key: p.api_key || "",
          deepseek_beta_strict_tools: p.deepseek_beta_strict_tools === true,
          models: p.models || [],
          model_count: (p.models || []).length,
        };
      }
      config.providers = providerEntries;

      // 自动注入全局字段（schema-driven）
      injectGlobalFields(config, engine);
      // cwd_history 过滤（agent-scope，但需要 existsSync 验证）
      if (Array.isArray(config.cwd_history)) {
        config.cwd_history = mergeWorkspaceHistory(
          config.cwd_history.filter(p => typeof p === "string" && existsSync(p)),
          [],
        );
      }

      return c.json(config);
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.post("/config/workspaces/recent", async (c) => {
    try {
      const body = await safeJson(c);
      const folder = normalizeWorkspacePath(body?.path);
      if (!folder) return c.json({ error: "path must be a non-empty string" }, 400);
      const stat = await fs.stat(folder).catch(() => null);
      if (!stat?.isDirectory()) return c.json({ error: "path must be an existing directory" }, 400);
      const cwdHistory = mergeWorkspaceHistory(engine.config.cwd_history, [folder]);
      await engine.updateConfig({ cwd_history: cwdHistory });
      return c.json({ ok: true, cwd_history: cwdHistory });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.get("/config/default-workspace", async (c) => {
    return c.json({ path: resolveDefaultWorkspacePath() });
  });

  route.post("/config/default-workspace", async (c) => {
    try {
      return c.json({ ok: true, path: ensureDefaultWorkspace() });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // 更新配置
  route.put("/config", async (c) => {
    try {
      const partial = await safeJson(c);
      if (!partial || typeof partial !== "object") {
        return c.json({ error: t("error.invalidJson") }, 400);
      }
      // ── schema-driven 全局字段分流 ──
      const { global: globalFields, agent: agentPartial } = splitByScope(partial);
      for (const { setter, value } of globalFields) {
        engine[setter](value);
      }

      // providers 块 → 全局 added-models.yaml
      let providersChanged = false;
      if (agentPartial.providers) {
        for (const [name, data] of Object.entries(agentPartial.providers)) {
          if (data === null) {
            engine.providerRegistry.removeProvider(name);
          } else {
            engine.providerRegistry.saveProvider(name, data);
          }
        }
        delete agentPartial.providers;
        providersChanged = true;
      }

      // 内联 API 凭证 → 全局 added-models.yaml 对应条目
      const rawConfig = getRawConfig(engine.configPath) || {};
      for (const blockName of ["api", "embedding_api", "utility_api"]) {
        const block = agentPartial[blockName];
        if (hasInlineProviderCredentialPatch(block)) {
          const { provider: provName, update: provUpdate } = buildInlineProviderCredentialUpdate(
            block,
            rawConfig?.[blockName]?.provider || "",
          );
          if (!provName) {
            return c.json({ error: `${blockName}.provider is required when saving credentials` }, 400);
          }
          engine.providerRegistry.saveProvider(provName, provUpdate);
          clearInlineProviderCredentialFields(block);
          providersChanged = true;
        }
      }

      // providers 变更后确保运行时刷新
      if (providersChanged) {
        await engine.onProviderChanged();
        debugLog()?.log("api", `onProviderChanged OK after provider change (${engine.availableModels?.length ?? 0} models)`);
      }

      if (providersChanged && Object.keys(agentPartial).length === 0) {
        clearConfigCache();
        await engine.updateConfig({});
        emitConfigAppEvents(engine, { globalFields, agentPartial, providersChanged });
        return c.json({ ok: true });
      }

      if (Object.keys(agentPartial).length === 0) {
        emitConfigAppEvents(engine, { globalFields, agentPartial, providersChanged });
        return c.json({ ok: true });
      }
      debugLog()?.log("api", `PUT /api/config keys=[${Object.keys(agentPartial).join(",")}]`);
      if (providersChanged) clearConfigCache();
      await engine.updateConfig(agentPartial);
      emitConfigAppEvents(engine, { globalFields, agentPartial, providersChanged });
      return c.json({ ok: true });
    } catch (err) {
      debugLog()?.error("api", `PUT /api/config failed: ${err.message}`);
      return c.json({ error: err.message }, err.statusCode || 500);
    }
  });

  // ── System Prompt（只读，供 DevTools 查看）──
  route.get("/system-prompt", async (c) => {
    try {
      const agent = resolveAgent(engine, c);
      const content = agent.systemPrompt || "";
      return c.json({ content });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // ── 人格文件（ishiki.md）──

  // 读取 ishiki.md 内容
  route.get("/ishiki", async (c) => {
    try {
      const ishikiPath = path.join(resolveAgent(engine, c).agentDir, "ishiki.md");
      const content = await fs.readFile(ishikiPath, "utf-8");
      return c.json({ content });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // 保存 ishiki.md 内容，并触发 system prompt 重建
  route.put("/ishiki", async (c) => {
    try {
      const body = await safeJson(c);
      const { content } = body;
      if (typeof content !== "string") {
        return c.json({ error: "content must be a string" }, 400);
      }
      const agent = resolveAgentStrict(engine, c);
      const ishikiPath = path.join(agent.agentDir, "ishiki.md");
      await fs.writeFile(ishikiPath, content, "utf-8");
      debugLog()?.log("api", `PUT /api/ishiki (saved, ${content.length} chars)`);
      // 触发 system prompt 重建（updateConfig 内部会重新读取 ishiki.md）
      await engine.updateConfig({}, { agentId: agent.id, refreshDescription: true });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof AgentNotFoundError) return c.json({ error: err.message }, 404);
      debugLog()?.error("api", `PUT /api/ishiki failed: ${err.message}`);
      return c.json({ error: err.message }, 500);
    }
  });

  // ── 身份简介（identity.md）──

  route.get("/identity", async (c) => {
    try {
      const identityPath = path.join(resolveAgent(engine, c).agentDir, "identity.md");
      const content = await fs.readFile(identityPath, "utf-8");
      return c.json({ content });
    } catch (err) {
      if (err.code === "ENOENT") return c.json({ content: "" });
      return c.json({ error: err.message }, 500);
    }
  });

  route.put("/identity", async (c) => {
    try {
      const body = await safeJson(c);
      const { content } = body;
      if (typeof content !== "string") {
        return c.json({ error: "content must be a string" }, 400);
      }
      const agent = resolveAgentStrict(engine, c);
      const identityPath = path.join(agent.agentDir, "identity.md");
      await fs.writeFile(identityPath, content, "utf-8");
      debugLog()?.log("api", `PUT /api/identity (saved, ${content.length} chars)`);
      await engine.updateConfig({}, { agentId: agent.id, refreshDescription: true });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof AgentNotFoundError) return c.json({ error: err.message }, 404);
      debugLog()?.error("api", `PUT /api/identity failed: ${err.message}`);
      return c.json({ error: err.message }, 500);
    }
  });

  // ── 用户档案（user.md）──

  // 读取 user.md 内容
  route.get("/user-profile", async (c) => {
    try {
      const userPath = path.join(engine.userDir, "user.md");
      const content = await fs.readFile(userPath, "utf-8");
      return c.json({ content });
    } catch (err) {
      // 文件不存在时返回空字符串（user.md 是可选的）
      if (err.code === "ENOENT") return c.json({ content: "" });
      return c.json({ error: err.message }, 500);
    }
  });

  // 保存 user.md 内容，并触发 system prompt 重建
  route.put("/user-profile", async (c) => {
    try {
      const body = await safeJson(c);
      const { content } = body;
      if (typeof content !== "string") {
        return c.json({ error: "content must be a string" }, 400);
      }
      const userPath = path.join(engine.userDir, "user.md");
      await fs.writeFile(userPath, content, "utf-8");
      debugLog()?.log("api", `PUT /api/user-profile (saved, ${content.length} chars)`);
      await engine.updateConfig({});
      return c.json({ ok: true });
    } catch (err) {
      debugLog()?.error("api", `PUT /api/user-profile failed: ${err.message}`);
      return c.json({ error: err.message }, 500);
    }
  });

  // ── 置顶记忆（pinned.md）──

  // 读取 pinned.md，解析为逐条数组
  route.get("/pinned", async (c) => {
    try {
      const pinnedPath = path.join(resolveAgent(engine, c).agentDir, "pinned.md");
      let content = "";
      try {
        content = await fs.readFile(pinnedPath, "utf-8");
      } catch (err) {
        if (err.code === "ENOENT") return c.json({ pins: [] });
        throw err;
      }
      const pins = content
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => line.replace(/^-\s*/, ""));
      return c.json({ pins });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // 保存 pinned.md（覆盖写入），触发 system prompt 重建
  route.put("/pinned", async (c) => {
    try {
      const body = await safeJson(c);
      const { pins } = body;
      if (!Array.isArray(pins)) {
        return c.json({ error: "pins must be an array" }, 400);
      }
      const content = pins
        .map(p => (typeof p === "string" ? p.trim() : ""))
        .filter(p => p.length > 0)
        .map(p => `- ${p}`)
        .join("\n")
        + "\n";
      const agent = resolveAgentStrict(engine, c);
      const pinnedPath = path.join(agent.agentDir, "pinned.md");
      await fs.writeFile(pinnedPath, content, "utf-8");
      debugLog()?.log("api", `PUT /api/pinned (${pins.length} items)`);
      // 触发 system prompt 重建（updateConfig 内部会重新读取 pinned.md）
      await engine.updateConfig({}, { agentId: agent.id });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof AgentNotFoundError) return c.json({ error: err.message }, 404);
      debugLog()?.error("api", `PUT /api/pinned failed: ${err.message}`);
      return c.json({ error: err.message }, 500);
    }
  });

  // ── 记忆管理 ──

  /**
   * 获取指定 agent 的 FactStore。
   * 如果 agentId 就是当前 active agent，直接用 engine.factStore；
   * 否则临时打开那个 agent 的 facts.db。
   * 返回 { store, isTemp }，调用方用完 isTemp===true 的 store 需要 close。
   */
  function getStoreForAgent(agentId) {
    if (!agentId) throw new Error("agentId is required");
    const resolvedId = agentId;
    const agent = engine.getAgent(resolvedId);
    if (agent?.factStore) {
      return { store: agent.factStore, isTemp: false };
    }
    if (/[\/\\.]/.test(resolvedId)) throw new Error("Invalid agent ID");
    const dbPath = path.join(engine.agentsDir, resolvedId, "memory", "facts.db");
    try {
      const store = new FactStore(dbPath);
      return { store, isTemp: true };
    } catch (err) {
      throw new Error(`Cannot open fact DB for agent "${resolvedId}": ${err.message}`);
    }
  }

  // 获取所有元事实
  route.get("/memories", async (c) => {
    let tempStore = null;
    try {
      const { store, isTemp } = getStoreForAgent(c.req.query("agentId"));
      if (isTemp) tempStore = store;
      return c.json({ memories: store.exportAll() });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    } finally {
      tempStore?.close();
    }
  });

  route.get("/memories/visible", async (c) => {
    let tempStore = null;
    try {
      const agent = resolveAgent(engine, c);
      const { store, isTemp } = getStoreForAgent(agent.id);
      if (isTemp) tempStore = store;
      const memoryDir = path.dirname(agent.memoryMdPath);
      const pinnedPath = path.join(agent.agentDir, "pinned.md");
      const pinnedRaw = await readTextIfExists(pinnedPath);
      const compiledRaw = await readTextIfExists(agent.memoryMdPath);
      const compiledSections = [];
      for (const meta of COMPILED_MEMORY_SOURCES) {
        const content = await readTextIfExists(path.join(memoryDir, meta.file));
        compiledSections.push({
          source: meta.source,
          title: meta.title,
          englishTitle: meta.englishTitle,
          items: splitMemoryItems(content).map((text, index) => ({
            id: `${meta.source}:${index}`,
            source: meta.source,
            index,
            text,
          })),
        });
      }
      const pinned = splitMemoryItems(pinnedRaw).map((text, index) => ({ id: `pinned:${index}`, index, text }));
      const facts = store.exportAll();
      const hasCompiledMemory = compiledSections.some((section) => section.items.length > 0);
      const hasPinnedMemory = pinned.length > 0;
      const memoryMasterEnabled = agent.memoryMasterEnabled !== false;
      return c.json({
        agentId: agent.id,
        memoryMasterEnabled,
        promptRuntimeMemoryEnabled: false,
        willInjectMemory: false,
        hasCompiledMemory,
        hasPinnedMemory,
        pinned,
        compiledSections,
        compiledRaw,
        facts,
      });
    } catch (err) {
      if (err instanceof AgentNotFoundError) return c.json({ error: err.message }, 404);
      return c.json({ error: err.message }, 500);
    } finally {
      tempStore?.close();
    }
  });

  // 读取编译后的 memory.md
  route.get("/memories/compiled", async (c) => {
    try {
      const agent = resolveAgent(engine, c);
      const mdPath = agent.memoryMdPath;
      const content = await fs.readFile(mdPath, "utf-8").catch(() => "");
      return c.json({ content });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.delete("/memories/compiled-items/:source/:index", async (c) => {
    try {
      const agent = resolveAgentStrict(engine, c);
      const meta = getCompiledSourceMeta(c.req.param("source"));
      if (!meta) return c.json({ error: "invalid compiled memory source" }, 400);
      const index = Number(c.req.param("index"));
      if (!Number.isInteger(index) || index < 0) return c.json({ error: "invalid compiled memory index" }, 400);
      const memoryDir = path.dirname(agent.memoryMdPath);
      const sourcePath = path.join(memoryDir, meta.file);
      const items = splitMemoryItems(await readTextIfExists(sourcePath));
      if (index >= items.length) return c.json({ error: "compiled memory item not found" }, 404);
      const [removed] = items.splice(index, 1);
      await fs.writeFile(sourcePath, serializeMemoryItems(items), "utf-8");
      assemble(
        path.join(memoryDir, "facts.md"),
        path.join(memoryDir, "today.md"),
        path.join(memoryDir, "week.md"),
        path.join(memoryDir, "longterm.md"),
        agent.memoryMdPath,
      );
      debugLog()?.log("api", `DELETE /api/memories/compiled-items/${meta.source}/${index} agent=${agent.id}`);
      await engine.updateConfig({}, { agentId: agent.id });
      return c.json({ ok: true, removed });
    } catch (err) {
      if (err instanceof AgentNotFoundError) return c.json({ error: err.message }, 404);
      return c.json({ error: err.message }, 500);
    }
  });

  // 清除编译产物（today/week/longterm/facts/memory.md + fingerprints）
  route.delete("/memories/compiled", async (c) => {
    try {
      const agent = resolveAgentStrict(engine, c);
      const memDir = path.dirname(agent.memoryMdPath);
      writeCompiledResetMarker(memDir);
      clearCompiledMemoryArtifacts(memDir);
      clearCompiledSummarySources(agent.summariesDir, agent.summaryManager);
      debugLog()?.log("api", `DELETE /api/memories/compiled agent=${agent.id}`);
      await engine.updateConfig({}, { agentId: agent.id });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof AgentNotFoundError) return c.json({ error: err.message }, 404);
      return c.json({ error: err.message }, 500);
    }
  });

  // 清除所有记忆（facts.db + memory.md）
  route.delete("/memories", async (c) => {
    let tempStore = null;
    try {
      const agent = resolveAgentStrict(engine, c);
      const { store, isTemp } = getStoreForAgent(agent.id);
      if (isTemp) tempStore = store;
      const memDir = path.dirname(agent.memoryMdPath);
      writeCompiledResetMarker(memDir);
      store.clearAll();
      clearCompiledMemoryArtifacts(memDir);
      clearCompiledSummarySources(agent.summariesDir, agent.summaryManager);
      debugLog()?.log("api", `DELETE /api/memories agent=${agent.id}`);
      await engine.updateConfig({}, { agentId: agent.id });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof AgentNotFoundError) return c.json({ error: err.message }, 404);
      return c.json({ error: err.message }, 500);
    } finally {
      tempStore?.close();
    }
  });

  route.put("/memories/:id", async (c) => {
    let tempStore = null;
    try {
      const agent = resolveAgentStrict(engine, c);
      const id = Number(c.req.param("id"));
      if (!Number.isInteger(id) || id <= 0) return c.json({ error: "invalid memory id" }, 400);
      const body = await safeJson(c);
      const fact = typeof body.fact === "string" ? body.fact.trim() : "";
      if (!fact) return c.json({ error: "fact must be a non-empty string" }, 400);
      if (body.tags !== undefined && !Array.isArray(body.tags)) return c.json({ error: "tags must be an array" }, 400);
      if (body.time !== undefined && body.time !== null && typeof body.time !== "string") {
        return c.json({ error: "time must be a string or null" }, 400);
      }
      const { store, isTemp } = getStoreForAgent(agent.id);
      if (isTemp) tempStore = store;
      const updated = store.update(id, {
        fact,
        tags: body.tags,
        time: body.time,
      });
      if (!updated) return c.json({ error: "memory not found" }, 404);
      debugLog()?.log("api", `PUT /api/memories/${id} agent=${agent.id}`);
      await engine.updateConfig({}, { agentId: agent.id });
      return c.json({ ok: true, memory: updated });
    } catch (err) {
      if (err instanceof AgentNotFoundError) return c.json({ error: err.message }, 404);
      return c.json({ error: err.message }, 500);
    } finally {
      tempStore?.close();
    }
  });

  route.delete("/memories/:id", async (c) => {
    let tempStore = null;
    try {
      const agent = resolveAgentStrict(engine, c);
      const id = Number(c.req.param("id"));
      if (!Number.isInteger(id) || id <= 0) return c.json({ error: "invalid memory id" }, 400);
      const { store, isTemp } = getStoreForAgent(agent.id);
      if (isTemp) tempStore = store;
      const deleted = store.delete(id);
      if (!deleted) return c.json({ error: "memory not found" }, 404);
      debugLog()?.log("api", `DELETE /api/memories/${id} agent=${agent.id}`);
      await engine.updateConfig({}, { agentId: agent.id });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof AgentNotFoundError) return c.json({ error: err.message }, 404);
      return c.json({ error: err.message }, 500);
    } finally {
      tempStore?.close();
    }
  });

  // 导出记忆（JSON）
  route.get("/memories/export", async (c) => {
    let tempStore = null;
    try {
      const { store, isTemp } = getStoreForAgent(c.req.query("agentId"));
      if (isTemp) tempStore = store;
      return c.json({
        version: 2,
        exportedAt: new Date().toISOString(),
        facts: store.exportAll(),
      });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    } finally {
      tempStore?.close();
    }
  });

  // 导入记忆（直接写入，无需 embedding）
  route.post("/memories/import", async (c) => {
    let tempStore = null;
    try {
      const body = await safeJson(c);
      const { facts, memories } = body;
      // 兼容 v1 导出格式（memories 字段）和 v2 格式（facts 字段）
      const entries = facts || memories;
      if (!Array.isArray(entries) || entries.length === 0) {
        return c.json({ error: "facts must be a non-empty array" }, 400);
      }

      const importEntries = entries.map((e) => ({
        fact: e.fact || e.content || "",
        tags: e.tags || [],
        time: e.time || e.date || null,
        session_id: e.session_id || "imported",
      }));

      const { store, isTemp } = getStoreForAgent(c.req.query("agentId"));
      if (isTemp) tempStore = store;
      store.importAll(importEntries);
      debugLog()?.log("api", `POST /api/memories/import: ${importEntries.length} entries`);
      return c.json({ ok: true, imported: importEntries.length });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    } finally {
      tempStore?.close();
    }
  });

  // ── 搜索 API Key 验证 ──

  route.post("/search/verify", async (c) => {
    const body = await safeJson(c);
    const { provider, api_key } = body;
    if (!provider) {
      return c.json({ ok: false, error: "provider is required" }, 400);
    }
    try {
      const { searchProviderRequiresApiKey, verifySearchKey } = await import("../../lib/tools/web-search.js");
      if (searchProviderRequiresApiKey(provider) && !api_key) {
        return c.json({ ok: false, error: "api_key is required" }, 400);
      }
      await verifySearchKey(provider, api_key);
      const storedApiKey = searchProviderRequiresApiKey(provider) ? api_key : "";
      engine.setSearchConfig({ provider, api_key: storedApiKey });
      await engine.updateConfig({ search: { provider, api_key: storedApiKey } });
      debugLog()?.log("api", `POST /api/search/verify provider=${provider} (ok)`);
      return c.json({ ok: true });
    } catch (err) {
      debugLog()?.warn("api", `POST /api/search/verify provider=${provider} failed: ${err.message}`);
      return c.json({ ok: false, error: err.message });
    }
  });

  return route;
}
