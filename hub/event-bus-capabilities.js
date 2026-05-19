const OBJECT_SCHEMA = Object.freeze({ type: "object", additionalProperties: true });

export const EVENT_BUS_ERROR_CODES = Object.freeze({
  NO_HANDLER: "NO_HANDLER",
  TIMEOUT: "TIMEOUT",
  INVALID_PAYLOAD: "INVALID_PAYLOAD",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  INTERNAL_ERROR: "INTERNAL_ERROR",
});

export const BUILTIN_EVENT_BUS_CAPABILITIES = Object.freeze([
  {
    type: "session:send",
    title: "Send session message",
    description: "Send text into a Hana session on behalf of a plugin.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        sessionPath: { type: "string" },
      },
      required: ["text"],
      additionalProperties: true,
    },
    outputSchema: OBJECT_SCHEMA,
    permission: "session.write",
    errors: ["NO_HANDLER", "TIMEOUT", "INVALID_PAYLOAD", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "session:abort",
    title: "Abort session work",
    description: "Abort the active work for a session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionPath: { type: "string" },
      },
      additionalProperties: false,
    },
    outputSchema: OBJECT_SCHEMA,
    permission: "session.write",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "session:history",
    title: "Read session history",
    description: "Read recent messages from a session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionPath: { type: "string" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
    outputSchema: OBJECT_SCHEMA,
    permission: "session.read",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "session:list",
    title: "List sessions",
    description: "List sessions available to an agent.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string" },
      },
      additionalProperties: false,
    },
    outputSchema: OBJECT_SCHEMA,
    permission: "session.read",
    errors: ["NO_HANDLER", "TIMEOUT", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "session:get-titles",
    title: "Read session titles",
    description: "Resolve display titles for session paths.",
    inputSchema: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" } },
      },
      required: ["paths"],
      additionalProperties: false,
    },
    outputSchema: OBJECT_SCHEMA,
    permission: "session.read",
    errors: ["NO_HANDLER", "TIMEOUT", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "agent:list",
    title: "List agents",
    description: "List configured Hana agents.",
    inputSchema: { type: "object", additionalProperties: false },
    outputSchema: OBJECT_SCHEMA,
    permission: "agent.read",
    errors: ["NO_HANDLER", "TIMEOUT", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "agent:config",
    title: "Read agent config",
    description: "Read public configuration for one agent.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string" },
      },
      required: ["agentId"],
      additionalProperties: false,
    },
    outputSchema: OBJECT_SCHEMA,
    permission: "agent.read",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "agent:update-config",
    title: "Update agent config",
    description: "Update selected configuration fields for one agent.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string" },
        partial: { type: "object" },
      },
      required: ["agentId", "partial"],
      additionalProperties: false,
    },
    outputSchema: OBJECT_SCHEMA,
    permission: "agent.write",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "FORBIDDEN", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "provider:credentials",
    title: "Read provider credentials",
    description: "Resolve credentials for a configured provider.",
    inputSchema: {
      type: "object",
      properties: {
        providerId: { type: "string" },
      },
      required: ["providerId"],
      additionalProperties: false,
    },
    outputSchema: OBJECT_SCHEMA,
    permission: "provider.credentials.read",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "FORBIDDEN", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "provider:models-by-type",
    title: "List provider models by type",
    description: "List configured models for a capability type such as image.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string" },
        providerId: { type: "string" },
      },
      required: ["type"],
      additionalProperties: false,
    },
    outputSchema: OBJECT_SCHEMA,
    permission: "provider.read",
    errors: ["NO_HANDLER", "TIMEOUT", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "provider:media-providers",
    title: "List media-capable providers",
    description: "List providers that expose media capabilities such as image_generation.",
    inputSchema: {
      type: "object",
      properties: {
        capability: { type: "string" },
      },
      additionalProperties: false,
    },
    outputSchema: OBJECT_SCHEMA,
    permission: "provider.read",
    errors: ["NO_HANDLER", "TIMEOUT", "INTERNAL_ERROR"],
    stability: "experimental",
    owner: "system",
  },
  {
    type: "deferred:register",
    title: "Register deferred result",
    description: "Register a long-running task result placeholder for a session.",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    permission: "task.write",
    errors: ["NO_HANDLER", "TIMEOUT", "INVALID_PAYLOAD", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "deferred:resolve",
    title: "Resolve deferred result",
    description: "Resolve a deferred task result.",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    permission: "task.write",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "deferred:fail",
    title: "Fail deferred result",
    description: "Mark a deferred task result as failed.",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    permission: "task.write",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "deferred:query",
    title: "Query deferred result",
    description: "Read the current state of a deferred task result.",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    permission: "task.read",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "deferred:list-pending",
    title: "List pending deferred results",
    description: "List pending deferred task results for a session.",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    permission: "task.read",
    errors: ["NO_HANDLER", "TIMEOUT", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "deferred:abort",
    title: "Abort deferred result",
    description: "Abort a deferred task result.",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    permission: "task.control",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "task:register-handler",
    title: "Register task abort handler",
    description: "Register a task-type abort handler.",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    permission: "task.control",
    errors: ["NO_HANDLER", "TIMEOUT", "INVALID_PAYLOAD", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "task:unregister-handler",
    title: "Unregister task abort handler",
    description: "Unregister a task-type abort handler.",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    permission: "task.control",
    errors: ["NO_HANDLER", "TIMEOUT", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "task:register",
    title: "Register task",
    description: "Register a visible background task.",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    permission: "task.write",
    errors: ["NO_HANDLER", "TIMEOUT", "INVALID_PAYLOAD", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "task:update",
    title: "Update task",
    description: "Update status, progress, metadata, or diagnostic details for a background task.",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    permission: "task.write",
    errors: ["NO_HANDLER", "TIMEOUT", "INVALID_PAYLOAD", "NOT_FOUND", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "task:complete",
    title: "Complete task",
    description: "Mark a background task as completed and attach a result payload.",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    permission: "task.write",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "task:fail",
    title: "Fail task",
    description: "Mark a background task as failed with a reason.",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    permission: "task.write",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "task:remove",
    title: "Remove task",
    description: "Remove a visible background task.",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    permission: "task.write",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "task:query",
    title: "Query task",
    description: "Read one background task record.",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    permission: "task.read",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "task:list",
    title: "List tasks",
    description: "List background task records with optional filters.",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    permission: "task.read",
    errors: ["NO_HANDLER", "TIMEOUT", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "task:abort",
    title: "Abort task",
    description: "Abort a visible background task.",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    permission: "task.control",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "task:cancel",
    title: "Cancel task",
    description: "Request cancellation and mark a successfully aborted task as canceled.",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    permission: "task.control",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "INTERNAL_ERROR"],
    stability: "stable",
    owner: "system",
  },
  {
    type: "task:schedule",
    title: "Schedule task",
    description: "Create or update a persisted plugin schedule handled by a task type runner.",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    permission: "task.write",
    errors: ["NO_HANDLER", "TIMEOUT", "INVALID_PAYLOAD", "INTERNAL_ERROR"],
    stability: "experimental",
    owner: "system",
  },
  {
    type: "task:unschedule",
    title: "Unschedule task",
    description: "Remove a persisted plugin schedule.",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    permission: "task.write",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "INTERNAL_ERROR"],
    stability: "experimental",
    owner: "system",
  },
  {
    type: "task:list-schedules",
    title: "List task schedules",
    description: "List persisted plugin schedules with optional filters.",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    permission: "task.read",
    errors: ["NO_HANDLER", "TIMEOUT", "INTERNAL_ERROR"],
    stability: "experimental",
    owner: "system",
  },
]);

export class EventBusCapabilityDirectory {
  constructor(capabilities = BUILTIN_EVENT_BUS_CAPABILITIES) {
    this._capabilities = new Map();
    for (const capability of capabilities) {
      this.register(capability);
    }
  }

  register(capability) {
    const normalized = normalizeEventBusCapability(capability);
    this._capabilities.set(normalized.type, normalized);
    return normalized;
  }

  unregister(type) {
    this._capabilities.delete(type);
  }

  get(type) {
    const capability = this._capabilities.get(type);
    return capability ? cloneCapability(capability) : null;
  }

  list() {
    return [...this._capabilities.values()]
      .map(cloneCapability)
      .sort((a, b) => a.type.localeCompare(b.type));
  }

  clear() {
    this._capabilities.clear();
  }
}

export function normalizeEventBusCapability(capability = {}) {
  const type = typeof capability.type === "string" ? capability.type.trim() : "";
  if (!type) throw new Error("EventBus capability requires type");
  return {
    type,
    title: textOrDefault(capability.title, type),
    description: textOrDefault(capability.description, ""),
    inputSchema: objectOrDefault(capability.inputSchema, OBJECT_SCHEMA),
    outputSchema: objectOrDefault(capability.outputSchema, OBJECT_SCHEMA),
    permission: textOrDefault(capability.permission, "plugin.bus.request"),
    errors: normalizeErrors(capability.errors),
    stability: textOrDefault(capability.stability, "experimental"),
    owner: textOrDefault(capability.owner, "plugin"),
    since: typeof capability.since === "string" ? capability.since : undefined,
  };
}

function cloneCapability(capability) {
  return structuredClone(capability);
}

function objectOrDefault(value, fallback) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return structuredClone(value);
  }
  return structuredClone(fallback);
}

function textOrDefault(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeErrors(errors) {
  const list = Array.isArray(errors) && errors.length > 0
    ? errors
    : ["NO_HANDLER", "TIMEOUT", "INTERNAL_ERROR"];
  return [...new Set(list.map((item) => String(item).trim()).filter(Boolean))];
}
