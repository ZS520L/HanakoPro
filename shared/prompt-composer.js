import { BUILTIN_SIMPLE_PROMPT_TEMPLATES } from "./builtin-simple-prompt-templates.js";

export { BUILTIN_SIMPLE_PROMPT_TEMPLATES };

export const DEFAULT_PROMPT_BLOCK_ORDER = [
  "platform",
  "environment",
  "task-management",
  "experience",
  "tool-discipline",
  "current-view",
  "session-files",
  "desktop-app-control",
  "failure-handling",
  "action-safety",
  "web-tool-priority",
  "settings-changes",
  "mcp-config",
  "proactive-skill-acquisition",
  "team",
  "user-profile",
  "personality",
  "skill-file-identity",
];

export const SYSTEM_GENERATED_PROMPT_BLOCK_IDS = [];

export const DEFAULT_SIMPLE_PROMPT_TEMPLATE_ID = "hanako-agentic-coding-assistant";

export const PROMPT_COMPOSER_MODES = ["blocks", "simple"];

export const BUILTIN_PROMPT_BLOCKS = [
  { id: "platform", label: "平台声明", labelEn: "Platform" },
  { id: "environment", label: "执行环境", labelEn: "Environment" },
  { id: "task-management", label: "任务管理", labelEn: "Task Management" },
  { id: "experience", label: "经验库", labelEn: "Experience Library" },
  { id: "tool-discipline", label: "工具使用纪律", labelEn: "Tool Discipline" },
  { id: "current-view", label: "当前视野", labelEn: "Current View" },
  { id: "session-files", label: "Session 文件与交付", labelEn: "Session Files" },
  { id: "desktop-app-control", label: "本机应用控制", labelEn: "Desktop App Control" },
  { id: "failure-handling", label: "失败处理", labelEn: "Failure Handling" },
  { id: "action-safety", label: "操作安全", labelEn: "Action Safety" },
  { id: "web-tool-priority", label: "网页工具优先级", labelEn: "Web Tool Priority" },
  { id: "settings-changes", label: "设置修改", labelEn: "Settings Changes" },
  { id: "mcp-config", label: "MCP 配置", labelEn: "MCP Configuration" },
  { id: "proactive-skill-acquisition", label: "主动技能获取", labelEn: "Proactive Skill Acquisition" },
  { id: "team", label: "团队", labelEn: "Team" },
  { id: "user-profile", label: "用户档案", labelEn: "User Profile" },
  { id: "personality", label: "人格与意识", labelEn: "Personality" },
  { id: "skill-file-identity", label: "技能文件身份", labelEn: "Skill File Identity" },
];

function normalizeId(value, fallback) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return fallback;
  return raw.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || fallback;
}

function normalizeText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
}

function normalizePromptBlockIds(value) {
  const result = [];
  const seen = new Set();
  for (const id of normalizeStringArray(value)) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function normalizeBlockOverrides(value, systemGeneratedBlockIds) {
  const rawBlockOverrides = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value).map(([id, item]) => ({ id, ...(item && typeof item === "object" ? item : { content: item }) }))
      : [];
  const seenOverrideIds = new Set();
  const blockOverrides = [];
  for (const item of rawBlockOverrides) {
    if (!item || typeof item !== "object") continue;
    const id = normalizeId(item.id, "");
    if (systemGeneratedBlockIds.has(id)) continue;
    if (!id || seenOverrideIds.has(id)) continue;
    seenOverrideIds.add(id);
    blockOverrides.push({
      id,
      content: normalizeText(item.content),
      enabled: item.enabled !== false,
    });
  }
  return blockOverrides;
}

function isBuiltinSimplePromptTemplateId(id) {
  return BUILTIN_SIMPLE_PROMPT_TEMPLATES.some((template) => template.id === id);
}

function getBuiltinSimplePromptTemplate(id) {
  return BUILTIN_SIMPLE_PROMPT_TEMPLATES.find((template) => template.id === id) || null;
}

function uniqueCustomSimplePresetId(id, usedIds) {
  const base = normalizeId(id, `custom-template-${usedIds.size + 1}`);
  let next = isBuiltinSimplePromptTemplateId(base) ? `custom-${base}` : base;
  let index = 2;
  while (usedIds.has(next) || isBuiltinSimplePromptTemplateId(next)) {
    next = `${base}-${index}`;
    index += 1;
  }
  usedIds.add(next);
  return next;
}

function normalizeSimplePresets(value) {
  const raw = Array.isArray(value) ? value : [];
  const usedIds = new Set();
  const presets = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const id = uniqueCustomSimplePresetId(item.id, usedIds);
    presets.push({
      id,
      name: normalizeText(item.name, "自定义模板").trim() || "自定义模板",
      content: normalizeText(item.content),
    });
  }
  return presets;
}

function normalizeComposerMode(value) {
  return PROMPT_COMPOSER_MODES.includes(value) ? value : "blocks";
}

function inferComposerMode(raw, defaults) {
  if (Object.prototype.hasOwnProperty.call(raw, "mode")) return normalizeComposerMode(raw.mode);
  if (
    Array.isArray(raw.blocks) ||
    Array.isArray(raw.blockOverrides) ||
    Array.isArray(raw.routes) ||
    Array.isArray(raw.toolOverrides) ||
    Object.prototype.hasOwnProperty.call(raw, "activeRouteId")
  ) {
    return "blocks";
  }
  return defaults.mode;
}

export function createDefaultPromptComposerConfig() {
  return {
    enabled: true,
    mode: "simple",
    activeRouteId: "default",
    activeSimplePresetId: DEFAULT_SIMPLE_PROMPT_TEMPLATE_ID,
    simpleContent: "",
    simplePresets: [],
    blockOverrides: [],
    blocks: [],
    routes: [
      {
        id: "default",
        name: "默认路线",
        blockIds: [...DEFAULT_PROMPT_BLOCK_ORDER],
      },
    ],
    toolOverrides: [],
  };
}

export function normalizePromptComposerConfig(value) {
  const defaults = createDefaultPromptComposerConfig();
  const raw = value && typeof value === "object" ? value : {};
  const seenBlockIds = new Set();
  const blocks = [];
  const systemGeneratedBlockIds = new Set(SYSTEM_GENERATED_PROMPT_BLOCK_IDS);
  for (const item of Array.isArray(raw.blocks) ? raw.blocks : []) {
    if (!item || typeof item !== "object") continue;
    const id = normalizeId(item.id, `custom-${blocks.length + 1}`);
    if (systemGeneratedBlockIds.has(id)) continue;
    if (seenBlockIds.has(id)) continue;
    seenBlockIds.add(id);
    blocks.push({
      id,
      title: normalizeText(item.title, "自定义模块").trim() || "自定义模块",
      content: normalizeText(item.content),
      enabled: item.enabled !== false,
    });
  }

  const blockOverrides = normalizeBlockOverrides(raw.blockOverrides, systemGeneratedBlockIds);
  const rawSimpleContent = normalizeText(raw.simpleContent);
  const simplePresets = normalizeSimplePresets(raw.simplePresets);
  let activeSimplePresetId = normalizeId(raw.activeSimplePresetId, "");
  const hasActiveCustomSimplePreset = simplePresets.some((preset) => preset.id === activeSimplePresetId);
  if (!hasActiveCustomSimplePreset && !isBuiltinSimplePromptTemplateId(activeSimplePresetId)) {
    if (rawSimpleContent.trim()) {
      const legacyId = uniqueCustomSimplePresetId("custom-current", new Set(simplePresets.map((preset) => preset.id)));
      simplePresets.push({
        id: legacyId,
        name: "当前自定义模板",
        content: rawSimpleContent,
      });
      activeSimplePresetId = legacyId;
    } else {
      activeSimplePresetId = DEFAULT_SIMPLE_PROMPT_TEMPLATE_ID;
    }
  }
  const activeSimplePreset = simplePresets.find((preset) => preset.id === activeSimplePresetId);
  const activeBuiltinSimpleTemplate = getBuiltinSimplePromptTemplate(activeSimplePresetId);
  const simpleContent = activeSimplePreset?.content
    ?? activeBuiltinSimpleTemplate?.content
    ?? rawSimpleContent;

  const seenRouteIds = new Set();
  const routes = [];
  for (const item of Array.isArray(raw.routes) ? raw.routes : []) {
    if (!item || typeof item !== "object") continue;
    const id = normalizeId(item.id, `route-${routes.length + 1}`);
    if (seenRouteIds.has(id)) continue;
    seenRouteIds.add(id);
    const blockIds = normalizePromptBlockIds(item.blockIds);
    routes.push({
      id,
      name: normalizeText(item.name, "组合路线").trim() || "组合路线",
      blockIds: blockIds.length ? blockIds : [...DEFAULT_PROMPT_BLOCK_ORDER],
      blockOverrides: normalizeBlockOverrides(item.blockOverrides, systemGeneratedBlockIds),
    });
  }
  if (!routes.length) routes.push(defaults.routes[0]);

  const activeRouteId = routes.some((route) => route.id === raw.activeRouteId)
    ? raw.activeRouteId
    : routes[0].id;

  return {
    enabled: Object.prototype.hasOwnProperty.call(raw, "enabled") ? raw.enabled === true : defaults.enabled,
    mode: inferComposerMode(raw, defaults),
    activeRouteId,
    activeSimplePresetId,
    simpleContent,
    simplePresets,
    blockOverrides,
    blocks,
    routes,
    toolOverrides: normalizeToolOverrides(raw.toolOverrides),
  };
}

function normalizeToolOverrides(value) {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value).map(([name, item]) => ({ name, ...(item && typeof item === "object" ? item : {}) }))
      : [];
  const seen = new Set();
  const result = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const rawParameters = Array.isArray(item.parameters)
      ? item.parameters
      : item.parameters && typeof item.parameters === "object"
        ? Object.entries(item.parameters).map(([path, param]) => ({ path, description: param && typeof param === "object" ? param.description : param }))
        : [];
    const seenParameters = new Set();
    const parameters = [];
    for (const param of rawParameters) {
      if (!param || typeof param !== "object") continue;
      const path = typeof param.path === "string" ? param.path.trim() : "";
      if (!path || seenParameters.has(path)) continue;
      seenParameters.add(path);
      parameters.push({ path, description: normalizeText(param.description) });
    }
    result.push({
      name,
      description: Object.prototype.hasOwnProperty.call(item, "description") ? normalizeText(item.description) : undefined,
      enabled: !Object.prototype.hasOwnProperty.call(item, "enabled") || item.enabled !== false,
      parameters,
    });
  }
  return result;
}

function renderTemplate(content, variables = {}) {
  return String(content || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(variables, key)) return match;
    const value = variables[key];
    return value == null ? "" : String(value);
  });
}

export function composePromptFromBlocks({ config, builtInBlocks, variables } = {}) {
  const normalized = normalizePromptComposerConfig(config);
  if (!normalized.enabled) return null;

  if (normalized.mode === "simple") {
    const content = renderTemplate(normalized.simpleContent, variables).trim();
    if (!content) return null;
    return content;
  }

  const route = normalized.routes.find((item) => item.id === normalized.activeRouteId) || normalized.routes[0];
  const routeOverrides = Array.isArray(route.blockOverrides) ? route.blockOverrides : [];
  const useGlobalOverrides = route.id === "default";
  const overrideMap = new Map([
    ...(useGlobalOverrides ? normalized.blockOverrides : []),
    ...routeOverrides,
  ].map((block) => [block.id, block]));
  const blockMap = new Map();
  const systemGeneratedBlockIds = new Set(SYSTEM_GENERATED_PROMPT_BLOCK_IDS);
  for (const block of Array.isArray(builtInBlocks) ? builtInBlocks : []) {
    if (!block?.id || typeof block.content !== "string" || !block.content.trim()) continue;
    const override = systemGeneratedBlockIds.has(block.id) ? null : overrideMap.get(block.id);
    if (override?.enabled === false) continue;
    const content = override ? renderTemplate(override.content, variables) : block.content;
    blockMap.set(block.id, content);
  }
  for (const block of normalized.blocks) {
    if (systemGeneratedBlockIds.has(block.id)) continue;
    if (!block.enabled || !block.content.trim()) continue;
    blockMap.set(block.id, renderTemplate(block.content, variables));
  }

  const parts = [];
  for (const id of route.blockIds) {
    const content = blockMap.get(id);
    if (typeof content === "string" && content.trim()) parts.push(content.trim());
  }
  return parts.length ? parts.join("\n\n") : null;
}
