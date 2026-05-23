function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value) {
  return typeof value === "string" ? value : "";
}

export function normalizeToolDescriptionOverrides(value) {
  const raw = Array.isArray(value)
    ? value
    : isObject(value)
      ? Object.entries(value).map(([name, item]) => ({ name, ...(isObject(item) ? item : {}) }))
      : [];
  const seen = new Set();
  const result = [];
  for (const item of raw) {
    if (!isObject(item)) continue;
    const name = normalizeName(item.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const rawParameters = Array.isArray(item.parameters)
      ? item.parameters
      : isObject(item.parameters)
        ? Object.entries(item.parameters).map(([path, param]) => ({ path, description: isObject(param) ? param.description : param }))
        : [];
    const parameters = [];
    const seenPaths = new Set();
    for (const param of rawParameters) {
      if (!isObject(param)) continue;
      const path = normalizeName(param.path);
      if (!path || seenPaths.has(path)) continue;
      seenPaths.add(path);
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

function hasOwn(value, key) {
  return isObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function childPath(basePath, key) {
  return basePath ? `${basePath}.${key}` : key;
}

function arrayItemPath(basePath) {
  return basePath ? `${basePath}[]` : "[]";
}

export function collectToolDescriptionEntries(tool) {
  if (!isObject(tool)) return [];
  const entries = [];
  if (typeof tool.description === "string") {
    entries.push({ kind: "tool", path: "", description: tool.description });
  }
  const schema = tool.parameters || tool.inputSchema || tool.input_schema;
  collectSchemaDescriptionEntries(schema, "", entries);
  return entries;
}

function collectSchemaDescriptionEntries(schema, basePath, entries) {
  if (!isObject(schema)) return;
  if (basePath && typeof schema.description === "string") {
    entries.push({ kind: "parameter", path: basePath, description: schema.description });
  }
  if (isObject(schema.properties)) {
    for (const [key, child] of Object.entries(schema.properties)) {
      collectSchemaDescriptionEntries(child, childPath(basePath, key), entries);
    }
  }
  if (isObject(schema.items)) {
    collectSchemaDescriptionEntries(schema.items, arrayItemPath(basePath), entries);
  }
  for (const unionKey of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(schema[unionKey])) {
      for (const child of schema[unionKey]) collectSchemaDescriptionEntries(child, basePath, entries);
    }
  }
}

export function summarizeToolDescriptions(tools = []) {
  return (Array.isArray(tools) ? tools : [])
    .filter((tool) => tool?.name)
    .map((tool) => ({
      name: tool.name,
      label: tool.label || tool.userFacingName || tool.name,
      description: typeof tool.description === "string" ? tool.description : "",
      parameters: collectToolDescriptionEntries(tool).filter((entry) => entry.kind === "parameter"),
    }));
}

export function applyToolDescriptionOverrides(tools = [], overrides = []) {
  const normalized = normalizeToolDescriptionOverrides(overrides);
  if (!normalized.length) return tools;
  const overrideMap = new Map(normalized.map((item) => [item.name, item]));
  return (Array.isArray(tools) ? tools : []).map((tool) => applyToolDescriptionOverride(tool, overrideMap.get(tool?.name)));
}

function applyToolDescriptionOverride(tool, override) {
  if (!isObject(tool) || !override) return tool;
  const next = { ...tool };
  if (Object.prototype.hasOwnProperty.call(override, "description") && override.description !== undefined) {
    next.description = override.description;
  }
  if (Array.isArray(override.parameters) && override.parameters.length) {
    const parameterMap = new Map(override.parameters.map((item) => [item.path, item.description]));
    for (const key of ["parameters", "inputSchema", "input_schema"]) {
      if (hasOwn(next, key)) next[key] = applySchemaDescriptionOverrides(next[key], parameterMap, "");
    }
  }
  return next;
}

function applySchemaDescriptionOverrides(schema, parameterMap, basePath) {
  if (!isObject(schema)) return schema;
  let next = schema;
  if (basePath && parameterMap.has(basePath)) {
    next = { ...next, description: parameterMap.get(basePath) };
  }
  if (isObject(schema.properties)) {
    const properties = {};
    let changed = false;
    for (const [key, child] of Object.entries(schema.properties)) {
      const updated = applySchemaDescriptionOverrides(child, parameterMap, childPath(basePath, key));
      properties[key] = updated;
      if (updated !== child) changed = true;
    }
    if (changed) next = { ...next, properties };
  }
  if (isObject(schema.items)) {
    const updated = applySchemaDescriptionOverrides(schema.items, parameterMap, arrayItemPath(basePath));
    if (updated !== schema.items) next = { ...next, items: updated };
  }
  for (const unionKey of ["anyOf", "oneOf", "allOf"]) {
    if (!Array.isArray(schema[unionKey])) continue;
    let changed = false;
    const updatedItems = schema[unionKey].map((child) => {
      const updated = applySchemaDescriptionOverrides(child, parameterMap, basePath);
      if (updated !== child) changed = true;
      return updated;
    });
    if (changed) next = { ...next, [unionKey]: updatedItems };
  }
  return next;
}
