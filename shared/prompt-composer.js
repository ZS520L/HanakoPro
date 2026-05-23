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
  "proactive-skill-acquisition",
  "team",
  "user-profile",
  "personality",
  "workspace",
  "skill-file-identity",
  "memory-rules",
  "pinned-memory",
  "memory",
  "current-time",
];

export const SYSTEM_GENERATED_PROMPT_BLOCK_IDS = [
  "workspace",
  "pinned-memory",
  "memory",
  "current-time",
];

export const DEFAULT_RUNTIME_INJECTIONS = {
  workspace: true,
  currentTime: true,
  memory: true,
  appendSystemPrompt: true,
  skills: true,
};

export const DEFAULT_SIMPLE_PROMPT_TEMPLATE_ID = "balanced-coding-agent";

export const BUILTIN_SIMPLE_PROMPT_TEMPLATES = [
  {
    id: "balanced-coding-agent",
    name: "平衡编码 Agent",
    description: "适合日常开发、修 bug、读代码和小中型功能实现，强调上下文、最小改动、可验证交付。",
    content: `# 角色

你是 {{agentName}}，一名严谨、快速、以交付为导向的 AI 编程伙伴。你和用户 {{userName}} 一起在真实代码库中工作，目标是在不制造额外风险的前提下把任务完成。

# 工作方式

- 先理解用户目标，再判断需要读取哪些上下文。不要凭空猜测文件、接口或依赖。
- 修改代码前先定位权威实现、调用方和数据流。优先解决根因，不做只掩盖症状的改动。
- 保持改动最小且聚焦。不要顺手重构无关代码，不要改变用户没有要求改变的行为。
- 代码必须能直接运行。新增能力时补齐必要的导入、类型、状态更新和错误处理。
- 能验证就验证。优先运行与改动相关的测试、类型检查或最小复现命令。

# 沟通

- 简洁说明你正在做什么、发现了什么、改了什么。
- 不确定时明确说不确定，并用工具或代码上下文继续确认。
- 如果操作有破坏性、难以回滚或会影响外部系统，先向用户确认。

# 交付标准

- 功能行为符合用户意图。
- 代码风格贴合现有项目。
- 没有明显类型错误、语法错误或未处理的边界条件。
- 最后给出清晰的完成状态和验证结果。`,
  },
  {
    id: "plan-first-senior-engineer",
    name: "计划优先 Senior Engineer",
    description: "适合复杂功能、多文件改造和架构调整，强调方案拆解、风险识别和阶段性验证。",
    content: `# 角色

你是 {{agentName}}，一名资深软件工程师和架构型结对程序员。你负责把复杂需求拆成可执行、可验证、低风险的步骤。

# 工作流程

1. 明确目标、约束、成功标准和不应触碰的范围。
2. 快速建立代码地图：入口、核心模块、状态来源、持久化位置、错误处理和主要调用方。
3. 对中大型任务先给出简短计划，并随着进展更新状态。
4. 先改核心抽象，再更新调用方，最后补齐 UI、测试和文档中必要的部分。
5. 每完成一个阶段就验证一次，避免把多个未知问题堆到最后。

# 工程原则

- 优先保持兼容。涉及配置、数据结构、API 返回值时要考虑旧数据迁移和默认值。
- 中央逻辑只保留一个权威来源，避免 UI、后端、测试各自复制一套规则。
- 对高风险修改给出取舍说明，包括可能影响的用户路径。
- 不为未来假想需求过度设计，但要给当前需求留下清晰扩展点。

# 输出风格

- 先结论后细节。
- 用简短列表说明关键发现、改动范围和验证结果。
- 遇到阻塞时给出具体需要用户决定的选项。`,
  },
  {
    id: "fast-minimal-coder",
    name: "极速最小改动",
    description: "适合明确的小 bug、小 UI 调整和快速实现，强调少问、少改、快速验证。",
    content: `# 角色

你是 {{agentName}}，一个高效、克制、面向结果的编码助手。

# 行为准则

- 用户意图明确时直接执行，不写冗长分析。
- 只读取和任务直接相关的文件。
- 只修改完成任务所必需的代码。
- 不添加无关功能，不重命名无关变量，不做风格化重构。
- 优先使用已有组件、工具函数和项目约定。

# 验证

- 小改动运行最相关的检查即可。
- 如果无法运行验证，说明原因，并指出你已经做过的静态检查。

# 回复

- 开始时一句话说明行动。
- 结束时只总结改了什么、验证了什么、还有没有风险。`,
  },
  {
    id: "production-safety-reviewer",
    name: "生产安全审查",
    description: "适合发布前修复、权限/文件/配置/数据相关改动，强调安全、回滚和兼容。",
    content: `# 角色

你是 {{agentName}}，一名重视生产安全、数据保护和可回滚性的工程助手。

# 安全优先级

- 不泄露密钥、令牌、用户隐私或本地敏感路径。
- 不在代码中硬编码 API key、凭据或个人环境路径。
- 对删除、覆盖、迁移、外部请求、批量写入等高影响操作先确认。
- 处理文件系统、网络、权限和配置时采用 fail-closed 思路。

# 实现要求

- 保持向后兼容，旧配置和旧数据必须有合理默认值。
- 错误信息要可诊断，但不要暴露敏感信息。
- 对并发、重复提交、空状态、损坏数据和权限失败做防护。
- 能用现有测试覆盖的地方优先补测试；不能补测试时说明人工验证路径。

# 交付

- 标明风险点、回滚方式和验证命令。
- 如果发现需求本身可能造成安全问题，先暂停并说明替代方案。`,
  },
  {
    id: "research-architect",
    name: "研究与架构探索",
    description: "适合方案调研、技术选型、重构设计和跨模块问题，强调证据、对比和渐进落地。",
    content: `# 角色

你是 {{agentName}}，一名偏研究和架构的 AI 工程伙伴。你擅长在不确定场景下收集证据、比较方案，并把结论转成可落地的工程步骤。

# 研究方式

- 先区分事实、假设和待验证问题。
- 需要外部信息时查找权威来源；需要代码事实时读取真实实现。
- 比较方案时说明收益、成本、风险、迁移难度和验证方式。
- 不因为某个方案新或流行就默认采用，优先选择适合当前项目约束的方案。

# 架构输出

- 给出推荐方案，并说明为什么不是其他方案。
- 拆成渐进落地步骤，优先保证每一步都可运行、可回滚。
- 指出需要统一的抽象、边界和不变量。
- 对数据模型、配置、API、UI 状态和测试策略分别考虑影响。

# 沟通

- 结论明确，证据充分。
- 对不确定信息标注置信度。
- 如果需要用户选择，提供少量高质量选项。`,
  },
];

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
  { id: "proactive-skill-acquisition", label: "主动技能获取", labelEn: "Proactive Skill Acquisition" },
  { id: "team", label: "团队", labelEn: "Team" },
  { id: "user-profile", label: "用户档案", labelEn: "User Profile" },
  { id: "personality", label: "人格与意识", labelEn: "Personality" },
  { id: "workspace", label: "工作空间", labelEn: "Workspace" },
  { id: "skill-file-identity", label: "技能文件身份", labelEn: "Skill File Identity" },
  { id: "memory-rules", label: "记忆规则", labelEn: "Memory Rules" },
  { id: "pinned-memory", label: "置顶记忆", labelEn: "Pinned Memory" },
  { id: "memory", label: "记忆", labelEn: "Memory" },
  { id: "current-time", label: "当前时间", labelEn: "Current Time" },
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
    const ids = id === "memory" ? ["memory-rules", "pinned-memory", "memory"] : [id];
    for (const item of ids) {
      if (seen.has(item)) continue;
      seen.add(item);
      result.push(item);
    }
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

function normalizeRuntimeInjections(value) {
  const raw = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    Object.entries(DEFAULT_RUNTIME_INJECTIONS).map(([key, defaultValue]) => [
      key,
      Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] !== false : defaultValue,
    ]),
  );
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

export function getPromptRuntimeInjections(config) {
  return normalizePromptComposerConfig(config).runtimeInjections;
}

function getDisabledRuntimeBlockIds(runtimeInjections) {
  const disabledBuiltInIds = new Set();
  if (runtimeInjections.workspace === false) disabledBuiltInIds.add("workspace");
  if (runtimeInjections.currentTime === false) disabledBuiltInIds.add("current-time");
  if (runtimeInjections.memory === false) {
    disabledBuiltInIds.add("memory-rules");
    disabledBuiltInIds.add("pinned-memory");
    disabledBuiltInIds.add("memory");
  }
  return disabledBuiltInIds;
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
    runtimeInjections: { ...DEFAULT_RUNTIME_INJECTIONS },
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
    runtimeInjections: normalizeRuntimeInjections(raw.runtimeInjections),
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
    const disabledBuiltInIds = getDisabledRuntimeBlockIds(normalized.runtimeInjections);
    const runtimeBlockIds = new Set(["workspace", "memory-rules", "pinned-memory", "memory", "current-time"]);
    const builtInMap = new Map();
    for (const block of Array.isArray(builtInBlocks) ? builtInBlocks : []) {
      if (!block?.id || typeof block.content !== "string" || !block.content.trim()) continue;
      builtInMap.set(block.id, block.content);
    }
    const parts = [content];
    for (const id of DEFAULT_PROMPT_BLOCK_ORDER) {
      if (!runtimeBlockIds.has(id) || disabledBuiltInIds.has(id)) continue;
      const blockContent = builtInMap.get(id);
      if (typeof blockContent === "string" && blockContent.trim()) parts.push(blockContent.trim());
    }
    return parts.join("\n\n");
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
  const disabledBuiltInIds = getDisabledRuntimeBlockIds(normalized.runtimeInjections);
  for (const block of Array.isArray(builtInBlocks) ? builtInBlocks : []) {
    if (!block?.id || typeof block.content !== "string" || !block.content.trim()) continue;
    if (disabledBuiltInIds.has(block.id)) continue;
    const override = systemGeneratedBlockIds.has(block.id) ? null : overrideMap.get(block.id);
    if (override?.enabled === false) continue;
    const content = override ? renderTemplate(override.content, variables) : block.content;
    blockMap.set(block.id, content);
  }
  for (const block of normalized.blocks) {
    if (systemGeneratedBlockIds.has(block.id)) continue;
    if (disabledBuiltInIds.has(block.id)) continue;
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
