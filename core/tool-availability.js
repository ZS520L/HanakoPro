import {
  computeToolSnapshot,
  DEFAULT_DISABLED_TOOL_NAMES,
} from "../shared/tool-categories.js";

export function toolNamesFromObjects(tools, { includePluginTools = true } = {}) {
  return (tools || [])
    .filter((tool) => includePluginTools || !tool?._pluginId)
    .map((tool) => tool?.name)
    .filter(Boolean);
}

export function getStableFeatureDisabledToolNames({ channelsEnabled } = {}) {
  const disabled = [];
  if (channelsEnabled === false) disabled.push("channel");
  return disabled;
}

export function computeRuntimeDisabledToolNames(tools, agentConfig, context = {}, options = {}) {
  const disabled = [];
  const warn = typeof options.warn === "function" ? options.warn : null;
  for (const tool of tools || []) {
    if (!tool?.name || typeof tool.isEnabledForAgentConfig !== "function") continue;
    try {
      if (!tool.isEnabledForAgentConfig(agentConfig, context)) {
        disabled.push(tool.name);
      }
    } catch (err) {
      warn?.(`tool "${tool.name}" runtime enablement check failed, disabling for fresh session: ${err.message}`);
      disabled.push(tool.name);
    }
  }
  return disabled;
}

export function computeAvailableToolNames(tools, agentConfig, context = {}, options = {}) {
  const disabled = agentConfig?.tools?.disabled ?? DEFAULT_DISABLED_TOOL_NAMES;
  const runtimeDisabled = options.includeRuntimeEnablement === false
    ? []
    : computeRuntimeDisabledToolNames(tools, agentConfig, context, options);
  const extraDisabled = [
    ...getStableFeatureDisabledToolNames(context),
    ...runtimeDisabled,
    ...(Array.isArray(options.extraDisabled) ? options.extraDisabled : []),
  ];
  return computeToolSnapshot(
    toolNamesFromObjects(tools, { includePluginTools: options.includePluginTools !== false }),
    disabled,
    { extraDisabled },
  );
}

export function filterToolObjectsByAvailability(tools, agentConfig, context = {}, options = {}) {
  const availableNames = new Set(computeAvailableToolNames(tools, agentConfig, context, options));
  return (tools || []).filter((tool) => tool?.name && availableNames.has(tool.name));
}
