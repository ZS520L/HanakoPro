# Community Plugin Development Guide

> This document is for community developers who want to build user-installable plugins.
> System plugins (built-in features) use the same plugin format, placed in the project's `plugins/` directory and bundled with the app.

## Quick Start

1. Create a folder with a tool file:

```text
my-plugin/
└── tools/
    └── hello.js
```

```js
// tools/hello.js
export const name = "hello";
export const description = "Say hello to someone";
export const parameters = {
  type: "object",
  properties: { name: { type: "string" } },
  required: ["name"],
};
export async function execute(input) {
  return `Hello, ${input.name}!`;
}
```

2. Open Hanako → Settings → Plugins, drag the folder into the install area (or drag a .zip)
3. After installation, the Agent can immediately call `my-plugin_hello`
4. Uninstall: click the delete button on the plugins page

## From Idea To Plugin

Read `.docs/PLUGIN-DEVELOPMENT.md` for the end-to-end workflow. Pick the plugin shape first:

| Shape | Best for | Permission |
|------|----------|------------|
| Tool-only | No UI, adds Agent-callable tools | `restricted` |
| Runtime | Lifecycle, EventBus, background tasks, dynamic tools | `full-access` |
| UI | Page / widget / iframe card | `full-access` |
| Marketplace entry | Makes the plugin discoverable in the marketplace | `OH-Plugins/plugins/<id>.yaml` |

Start with the `hana-plugin-creator` scaffold, then delete what you do not need:

```bash
python3 skills2set/hana-plugin-creator/scripts/create_hana_plugin.py "My Plugin" --path examples/plugins --kind full
```

Debug order: install the local folder, inspect Settings diagnostics, finish README/manifest, then add an `OH-Plugins` marketplace entry when the plugin is ready to publish.

## Installation & Management

### Installation Methods

- **Drag-and-drop**: Drag a plugin folder or .zip into Settings → Plugins install area
- **File picker**: Click the install area and select a plugin folder or .zip via the file picker
- **Manual**: Place the plugin directory in `${HANA_HOME}/plugins/`. The actual path is shown in Settings → Plugins or via `/api/plugins/settings` as `plugins_dir`

### Management

All operations take effect immediately, no restart required:

- **Enable/Disable**: Each plugin has its own toggle
- **Delete**: Removes plugin code; plugin data (`plugin-data/{pluginId}/`) is preserved
- **Upgrade**: Dragging in a new version with the same name unloads the old plugin and loads the new one; lifecycle resources should be cleaned up via `onunload` / disposables

### Plugin Data

Plugin private data is stored in `${HANA_HOME}/plugin-data/{pluginId}/`. This directory is preserved when the plugin is deleted, so config persists across reinstalls.

## Directory Structure

```text
my-plugin/
├── manifest.json          # Optional, only needed for complex declarations
├── tools/                 # Tools (called by Agent)
│   └── *.js
├── skills/                # Knowledge injection (Markdown)
│   └── my-skill/
│       └── SKILL.md
├── commands/              # User commands (slash-triggered)
│   └── *.js
├── agents/                # Agent templates (JSON)
│   └── *.json
├── routes/                # HTTP routes (requires full-access)
│   └── *.js
├── providers/             # Provider declarations: chat/media capabilities (requires full-access)
│   └── *.js
├── extensions/            # Pi SDK extension factories (requires full-access)
│   └── *.js
└── index.js               # Optional, stateful plugin entry point, loaded last (requires full-access)
```

Contribution types marked "requires full-access" only take effect when the manifest declares `"trust": "full-access"` and the user enables the full-access toggle.

## Permission Model

Community plugins have two permission levels. This determines which system capabilities a plugin can access.

### Restricted (default)

No manifest declaration needed; community plugins default to restricted.

**What you can do:**

| Capability | Description |
|------------|-------------|
| `tools/*.js` | Declare tools for Agent to call |
| `skills/` | Markdown knowledge injection |
| `commands/*.js` | User commands |
| `agents/*.json` | Agent templates (JSON declarations) |
| `ctx.config` | Read/write own configuration |
| `ctx.dataDir` | Own data directory |
| `bus.emit / subscribe / request` | Publish events, subscribe to events, call others' capabilities |
| `contributes.configuration` | JSON Schema config declarations |

**What you cannot do:** `bus.handle`, routes, extensions, providers, `registerTool`, lifecycle (onload/onunload).

Restricted plugin tool/command code runs in the main process with full Node.js API access. The permission model controls "which system extension points you get", not code-level sandboxing.

### Full-access

Declare `"trust": "full-access"` in manifest:

```json
{
  "id": "my-advanced-plugin",
  "trust": "full-access",
  "minAppVersion": "0.82.0"
}
```

`minAppVersion` (optional) declares the minimum Hanako version required to run the plugin. If the current app version is lower, the plugin will not load and its status is set to `incompatible`. All plugins should declare this field to prevent compatibility issues on older versions.

The user must enable the "Allow full-access plugins" toggle in Settings → Plugins. **When the toggle is off, full-access plugins are not loaded at all** (no partial loading) until the user explicitly enables it.

In addition to restricted capabilities:

| Capability | Description |
|------------|-------------|
| `bus.handle` | Register capabilities for other plugins to call |
| `routes/*.js` | HTTP endpoints |
| `extensions/*.js` | Pi SDK event interception (tool calls, provider requests, etc.) |
| `providers/*.js` | Provider declarations: chat/media capabilities |
| `ctx.registerTool` | Dynamically register tools at runtime |
| `onload` / `onunload` | Lifecycle hooks |

**Plugins without `trust` or with any other value are treated as restricted.**

## Contribution Types

### Tools

`tools/*.js` each file exports:

```js
export const name = "search";           // required
export const description = "...";       // required
export const parameters = { ... };      // JSON Schema, optional
export async function execute(input, toolCtx) {  // required
  // input: user-provided parameters
  // toolCtx: { pluginId, pluginDir, dataDir, sessionPath, bus, config, log, registerSessionFile, stageFile }
  return "result";
}
```

- Automatically namespaced: `pluginId_name` (e.g. `my-plugin_search`)
- Restricted plugins' `toolCtx.bus` only has `emit/subscribe/request`, not `handle`
- New plugins can use `defineTool()` from `@hana/plugin-runtime` for types and default parameters. The current static `tools/*.js` loader still reads named exports.

```js
import { defineTool } from '@hana/plugin-runtime';

const tool = defineTool({
  name: "search",
  description: "Search project data",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"]
  },
  async execute(input, ctx) {
    ctx.log.info("search", input.query);
    return `results for ${input.query}`;
  }
});

export const { name, description, parameters, execute } = tool;
```

#### Media Delivery

When a tool needs to deliver files, first stage the local file as a `SessionFile` for the current session, then return the staged media item through `details.media.items`:

```js
import { createMediaDetails } from "@hana/plugin-runtime";

const staged = toolCtx.stageFile({
  sessionPath: toolCtx.sessionPath,
  filePath: "/path/to/image.png",
  label: "image.png",
});

return {
  content: [{ type: "text", text: "Image generated" }],
  details: createMediaDetails([staged]),
};
```

The framework automatically extracts `details.media` and delivers files according to context: desktop renders file cards, Bridge sends through the target platform, and future mobile surfaces can consume the same `SessionFile` identity. The new protocol prefers structured `session_file` entries in `details.media.items`; `mediaUrls` remains only as a compatibility field for old tools and remote URLs, and is planned for removal no earlier than v0.133. Local files must not bypass StageFile through `MEDIA:/path`, `file://`, or `mediaUrls`; register them as `session_file` entries first. Do not create private plugin file cards as a substitute for `SessionFile`.

When a plugin produces local files directly, call `toolCtx.stageFile({ sessionPath, filePath, label })` to attach them to the current session and obtain a ready-to-return media item. `registerSessionFile` remains available as a lower-level compatibility API, but new plugins should use `stageFile` so file ownership and media delivery stay coupled. `sessionPath` is explicit and `filePath` must be absolute. Hana records these files as `storageKind: "plugin_data"`, so they are treated as plugin data or generated output and are not removed by the session temporary-cache cleaner. Plugins should not assign temporary-cache lifecycle to arbitrary local paths; that lifecycle belongs to the framework.

Boundaries:

- Plugin-generated files: `origin: "plugin_output"`, `storageKind: "plugin_data"`
- Async plugin-generated files must still be registered as `SessionFile` when the background task finishes; a card may show task state and result references, but it does not own the file lifecycle
- User uploads, Bridge inbound attachments, browser screenshots, and legacy `create_artifact` compatibility outputs are registered by the framework as `managed_cache`
- Install sources such as `.skill`, plugin folders, or zip files are registered by install routes as `install_source`
- Cards own interactive presentation; files remain resources. If a card needs a file, reference the `SessionFile` instead of embedding file bytes in the card payload

#### Visual Cards

Tools can automatically render visual cards (iframes) in the chat by declaring `card` in the return value's `details`:

```js
return {
  content: [{ type: "text", text: "Data summary..." }],
  details: {
    card: {
      type: "iframe",
      route: "/card/chart?symbol=sh600519&period=daily",
      title: "Kweichow Moutai Daily K",
      description: "Kweichow Moutai price 1450.00 change +2.11%",
    },
  },
};
```

- `route`: Plugin route path; the iframe fetches data and renders from this path
- `title`: Card title (optional)
- `description`: Plain text summary, used for IM platform fallback and when the plugin is uninstalled
- `pluginId` is auto-injected by the framework; tools don't need to set it
- Cards render immediately when the tool completes, independent of LLM behavior
- Card data is stored in JSONL with the toolResult and auto-restored on session reload
- Cards can be adapted by Bridge or future mobile clients, while their related files still restore through the `SessionFile` lifecycle

### Skills (Knowledge Injection)

`skills/*/SKILL.md`, standard frontmatter format:

```markdown
---
name: my-skill
description: What this skill does
---
# Content
The Agent loads this knowledge automatically when needed.
```

Zero code, same pattern as Claude Code skills.

### Commands (User Commands)

`commands/*.js` each file exports:

```js
export const name = "focus";
export const description = "Start focus mode";
export async function execute(args, cmdCtx) {
  // args: user input text
  // cmdCtx: { sessionPath, agentId, bus, config, log }
}
```

### Agents (Agent Templates)

`agents/*.json`:

```json
{
  "name": "Translator",
  "systemPrompt": "You are a translator.",
  "defaultModel": "gpt-4o",
  "defaultTools": ["web-search"]
}
```

### Routes (HTTP Routes) ⚡ full-access

`routes/*.js` supports three patterns, auto-mounted at `/api/plugins/{pluginId}/...`:

**Pattern A: Factory function** (recommended, ctx available as parameter)

```js
// routes/chat.js
export default function (app, ctx) {
  app.post("/send", async (c) => {
    const { text } = await c.req.json();
    const result = await ctx.bus.request("session:send", {
      text,
      sessionPath: "/path/to/session.jsonl",  // required
    });
    return c.json(result);
  });
}
```

**Pattern B: Static Hono app** (get ctx via middleware)

```js
// routes/webhook.js
import { Hono } from "hono";
const route = new Hono();
route.get("/webhook", (c) => {
  const ctx = c.get("pluginCtx");
  return c.json({ ok: true, plugin: ctx.pluginId });
});
export default route;
```

**Pattern C: Register export**

```js
// routes/status.js
export function register(app, ctx) {
  app.get("/status", (c) => c.json({ pluginId: ctx.pluginId }));
}
```

All three patterns are backward-compatible: plugins that don't use ctx need no changes. `ctx.bus` can directly call built-in session operations: `session:send`, `session:abort`, `session:history`, `session:list`, `agent:list`. All session-related operations must include a `sessionPath` parameter. See the Route Context and Session Bus Handlers sections below for the full API.

### Extensions (Pi SDK Event Interception) ⚡ full-access

Each `.js` file in the `extensions/` directory exports a factory function that receives Pi SDK's `ExtensionAPI` and subscribes to LLM pipeline events:

```js
// extensions/strip-empty-tools.js
export default function(pi) {
  pi.on("before_provider_request", (event) => {
    const p = event.payload;
    if (p && Array.isArray(p.tools) && p.tools.length === 0) {
      delete p.tools;
    }
    return p;
  });
}
```

Common events:

| Event | Timing | What you can do |
|-------|--------|-----------------|
| `tool_call` | Before tool execution | Modify args, block the call |
| `tool_result` | After tool returns | Modify the result |
| `before_provider_request` | Before HTTP request | Rewrite payload |
| `context` | Before each LLM call | Filter/inject messages |
| `before_agent_start` | After user input | Inject system prompt |
| `input` | When user input arrives | Intercept/transform input |

Factory functions are invoked by Pi SDK at session creation time; handlers fire when the corresponding event occurs. See Pi SDK extension documentation for the full event list.

### Providers (Provider Contribution) ⚡ full-access

`providers/*.js` export a ProviderPlugin data object:

```js
export const id = "my-llm";
export const displayName = "My LLM Service";
export const authType = "api-key";
export const defaultBaseUrl = "https://api.my-llm.com/v1";
export const defaultApi = "openai-completions";
```

Providers can declare multiple capabilities. Chat surfaces consume `capabilities.chat`; image/video/speech tools consume `capabilities.media.*`. Media-only providers should set `chat.projection = "none"` so they never appear in the chat model selector.

```js
export const id = "my-image-cli";
export const displayName = "My Image CLI";
export const authType = "none";

export const runtime = {
  kind: "local-cli",
  protocolId: "local-cli-media",
  command: {
    executable: "my-image-cli",
    args: [
      { literal: "generate" },
      { option: "--prompt", from: "prompt" },
      { option: "--model", from: "modelId" },
      { option: "--output", from: "outputDir" },
    ],
    timeoutMs: 120000,
    output: { kind: "file_glob", directory: "outputDir", pattern: "*.png" },
  },
};

export const capabilities = {
  chat: { projection: "none" },
  media: {
    imageGeneration: {
      models: [
        {
          id: "my-image-model",
          displayName: "My Image Model",
          protocolId: "local-cli-media",
          inputs: ["text"],
          outputs: ["image"],
        },
      ],
    },
  },
};
```

CLI providers must use structured argument bindings. Do not build shell command strings; Hana runs commands through non-shell `execFile` / `spawn` paths and collects outputs into the media task directory.

### Configuration (Config Schema)

Declare in `manifest.json` under `contributes.configuration` using JSON Schema:

```json
{
  "contributes": {
    "configuration": {
      "properties": {
        "interval": { "type": "number", "default": 25, "title": "Work interval (minutes)" },
        "sound": { "type": "boolean", "default": true, "title": "Completion sound" }
      }
    }
  }
}
```

Read/write config via `ctx.config.get(key)` / `ctx.config.set(key, value)`, persisted in `plugin-data/{pluginId}/config.json`.

### Page (Plugin Page) ⚡ full-access

A plugin can register a full-page view in the top tab bar, at the same level as "Chat/Channel". When the user switches to that tab, the plugin's iframe occupies the entire window space.

Declare in `manifest.json` under `contributes`:

```json
{
  "contributes": {
    "page": {
      "title": { "zh": "金融", "en": "Finance" },
      "icon": "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.5'><polyline points='22 12 18 12 15 21 9 3 6 12 2 12'/></svg>",
      "route": "/dashboard"
    }
  }
}
```

- `title`: Display name. Accepts a plain string or an i18n object `{ zh, en, ... }`
- `icon`: Strongly recommended to provide an inline SVG (stroke style, `currentColor`). Falls back to the first character of the title if omitted
- `route`: Relative path for the plugin route. The actual URL is `/api/plugins/{pluginId}{route}`
- A plugin can declare both a `page` and a `widget` simultaneously — they are independent
- Hovering over the tab shows the plugin's full name (tooltip)
- When there are more than 5 tabs, extras are collapsed into an overflow dropdown menu; users can drag to reorder

Plugin pages are rendered via iframe. New plugins should use `@hana/plugin-sdk` for handshake and host requests:

```js
import { hana } from '@hana/plugin-sdk';

hana.ready();
hana.ui.resize({ height: 320 });
await hana.toast.show({ message: 'Refreshed', type: 'success' });
await hana.external.open('https://example.com');
await hana.clipboard.writeText('Copied text');
```

The lower-level `hana.host.request(type, payload)` remains available for future or experimental capabilities. Prefer typed helpers for stable capabilities.

For compatibility, the host still accepts the legacy handshake:

```js
window.parent.postMessage({ type: 'ready' }, '*');
```

The host accepts messages only from the current iframe window and matching origin. SDK requests go through the capability registry. Current built-in capabilities include `toast.show` (no grant required), `external.open` (grant required), and `clipboard.writeText` (grant required).

Grant-required iframe host capabilities must be declared in the manifest:

```json
{
  "manifestVersion": 1,
  "ui": {
    "hostCapabilities": ["external.open", "clipboard.writeText"]
  }
}
```

Sensitive capabilities that are not declared return `CAPABILITY_DENIED`. Unknown capability names are ignored at load time; `toast.show` does not need to be declared.

The host appends `hana-theme` and `hana-css` query parameters to the iframe URL. Plugins can optionally reference the theme CSS for visual consistency:

```html
<link rel="stylesheet" href="${new URLSearchParams(location.search).get('hana-css')}">
```

React plugin UIs should use `@hana/plugin-components`. It provides Button, IconButton, TextInput, Textarea, Select, Switch, SettingRow, CardShell, List, EmptyState, and related primitives that match Hana's current controls:

```tsx
import { Button, CardShell, HanaThemeProvider, SettingRow, Switch } from "@hana/plugin-components";
import "@hana/plugin-components/styles.css";

export function PluginPanel() {
  return (
    <HanaThemeProvider mode="inherit">
      <CardShell title="Sync">
        <SettingRow label="Enabled" control={<Switch checked label="On" />} />
        <Button variant="primary">Run</Button>
      </CardShell>
    </HanaThemeProvider>
  );
}
```

`HanaThemeProvider` supports three modes: `inherit` reads host CSS variables and then uses SDK fallback tokens; `hana` pins the UI to a named Hana theme token set; `custom` only overrides explicitly provided tokens and lets missing fields continue through the fallback chain. Components depend only on `hana-plugin-*` classes and CSS variables, not renderer internals.

### Widget (Sidebar Component) ⚡ full-access

A plugin can register a component in the right-side Jian sidebar. A widget and a page can be declared simultaneously in the same plugin — they are independent and do not conflict.

```json
{
  "contributes": {
    "widget": {
      "title": { "zh": "盯盘", "en": "Monitor" },
      "icon": "<svg viewBox='0 0 24 24' .../>",
      "route": "/sidebar"
    }
  }
}
```

Field rules are the same as Page. The widget appears alongside the desk in the Jian sidebar, controlled by a button on the right side of the titlebar. When no widgets are registered, the button area is automatically hidden.

Widgets are also rendered via iframe and must send the `ready` handshake signal.

### SettingsTab (Native Settings Page, Built-ins Only) ⚡ full-access

Bundled built-in plugins can register a native settings page shown in the settings sidebar, at the same level as "Skills" and "Plugins". This contribution only works for built-in plugins under the packaged `plugins/` directory; community plugins are ignored even if they declare it. The renderer maps `nativeComponent` through a host whitelist, so plugins declare a component id rather than shipping frontend code.

```json
{
  "hidden": true,
  "trust": "full-access",
  "contributes": {
    "settingsTab": {
      "id": "mcp",
      "title": { "zh": "连接器", "en": "Connectors" },
      "nativeComponent": "mcp.settings"
    }
  }
}
```

- `id`: Settings tab id, globally unique
- `title`: Display name. Accepts a plain string or an i18n object `{ zh, en, ... }`
- `nativeComponent`: Host-registered native component id, such as `mcp.settings`
- Use this when a hidden bundled feature needs native settings UI while keeping runtime logic removable as a plugin-shaped module

## Manifest

Most plugins don't need a manifest. Only required for:

- Declaring `trust: "full-access"` for full permissions
- Declaring iframe UI host capabilities (`ui.hostCapabilities`)
- Configuration schema (JSON Schema declarations)
- Plugin metadata (name, version, description for the management UI)
- Soft dependency declarations

```json
{
  "manifestVersion": 1,
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "What this plugin does",
  "trust": "full-access",
  "ui": {
    "hostCapabilities": ["external.open"]
  },
  "contributes": {
    "configuration": { ... }
  },
  "depends": {
    "capabilities": ["bridge:send"]
  }
}
```

Without a manifest, `id` is derived from the directory name, other fields default to empty, and permission is restricted.

## Stateful Plugins (Lifecycle) ⚡ full-access

If a plugin needs persistent connections, scheduled tasks, or bus handlers, create `index.js`:

New plugins should use `definePlugin()` from `@hana/plugin-runtime`. It returns a class-compatible value for the current PluginManager:

```js
import { definePlugin } from '@hana/plugin-runtime';

export default definePlugin({
  async onload(ctx, { register }) {
    register(ctx.bus.handle("bridge:send", async (payload) => {
      return { sent: true, payload };
    }));
  },
});
```

The traditional class form is still supported:

```js
import { HANA_BUS_SKIP } from "@hana/plugin-runtime";

export default class MyPlugin {
  async onload() {
    // ctx is injected by PluginManager:
    // this.ctx.bus          — EventBus (full: emit/subscribe/request/handle)
    // this.ctx.config       — Config read/write (get/set)
    // this.ctx.dataDir      — Private data directory path
    // this.ctx.log          — Logger with pluginId prefix
    // this.ctx.pluginId     — Plugin ID
    // this.ctx.pluginDir    — Plugin installation directory
    // this.ctx.registerTool — Dynamic tool registration (returns cleanup function)

    // Resources registered via register() are auto-cleaned on unload (reverse order)
    this.register(
      this.ctx.bus.handle("bridge:send", async (payload) => {
        if (payload.platform !== "feishu") return HANA_BUS_SKIP;
        await this.sendToFeishu(payload);
        return { sent: true };
      })
    );

    this.ws = await this.connect();
  }

  async onunload() {
    // Resources from register() are auto-cleaned, no manual unhandle needed
    // Only clean up things the framework can't manage
    this.ws?.close();
  }
}
```

## Bus Communication (bus.request / bus.handle)

Inter-plugin communication uses EventBus request-response. `bus.handle` requires full-access permission; `bus.request` is available to all plugins. New plugins should use `defineBusHandler()`, `requestBus()`, and `HANA_BUS_SKIP` from `@hana/plugin-runtime` so handler types, request arguments, and chained skip semantics come from the SDK instead of hand-written conventions.

```js
import { defineBusHandler, HANA_BUS_SKIP, requestBus } from "@hana/plugin-runtime";

// Plugin A (full-access): register a capability
const bridgeSend = defineBusHandler({
  type: "bridge:send",
  async handle(payload) {
    if (payload.platform !== "telegram") return HANA_BUS_SKIP;
    await telegramBot.send(payload.chatId, payload.text);
    return { sent: true };
  },
});

this.register(this.ctx.bus.handle(bridgeSend.type, (payload) => bridgeSend.handle(payload, this.ctx)));

// Plugin B (any permission): call the capability
if (this.ctx.bus.hasHandler("bridge:send")) {
  const result = await requestBus(this.ctx, "bridge:send", {
    platform: "telegram",
    chatId: "123",
    text: "Hello",
  }, { timeout: 5000 });
}
```

**Naming convention**: `domain:action`, colon-separated. E.g. `bridge:send`, `memory:query`, `timer:schedule`.

**SKIP chain**: Multiple handlers can be registered for the same event type. The system calls them in registration order until one returns a value other than `HANA_BUS_SKIP`. Returning `HANA_BUS_SKIP` means "I don't handle this, pass it on":

```js
this.register(
  this.ctx.bus.handle("bridge:send", async (payload) => {
    if (payload.platform !== "telegram") return HANA_BUS_SKIP;
    await telegramBot.send(payload.chatId, payload.text);
    return { sent: true };
  })
);
```

**Error handling**:
- No handler → throws `BusNoHandlerError`
- Timeout (default 30s) → throws `BusTimeoutError`
- Handler business errors → propagated directly

**Soft dependencies**: `depends.capabilities` in manifest is advisory only; the system won't block installation if capabilities are missing. Plugin code uses `bus.hasHandler()` for graceful degradation at runtime.

### Dynamic Tool Registration ⚡ full-access

Plugins can dynamically register tools in `onload()` via `ctx.registerTool()`, useful when tools are discovered at runtime (for example, the bundled Connectors MCP bridge):

```js
this.register(this.ctx.registerTool({
  name: "dynamic-search",
  description: "Dynamically registered tool",
  parameters: { type: "object", properties: { query: { type: "string" } } },
  execute: async (input) => { ... },
}));
```

Tool names are auto-prefixed with `pluginId_` and auto-removed on unload via `register()`.

### Background Tasks ⚡ full-access

Plugins can register background tasks so Hanako can track and abort them. Runtime lifecycle is managed by `TaskRegistry`.

**Register a task type handler** once in `onload()`:

```js
await this.ctx.bus.request("task:register-handler", {
  type: "my-task-type",
  abort: (taskId) => {
    // cancel polling, abort a request, stop a worker, etc.
  },
});

this.register(() => {
  this.ctx.bus.request("task:unregister-handler", { type: "my-task-type" }).catch(() => {});
});
```

**Register a task instance** every time a background task starts:

```js
await this.ctx.bus.request("task:register", {
  taskId: "my-task-123",
  type: "my-task-type",
  parentSessionPath: sessionPath,
  meta: { type: "my-task", prompt: "..." },
});
```

**Remove the task when complete**:

```js
await this.ctx.bus.request("task:remove", { taskId: "my-task-123" });
```

**Result delivery** usually combines `task:*` with `deferred:*`: `task:*` tracks runtime lifecycle, while `deferred:*` tracks result delivery back to the parent session. A long task commonly calls `deferred:register` and `task:register` at start, then `deferred:resolve` and `task:remove` at completion.

`TaskRegistry` is runtime-only and not persisted. If a plugin wants restart recovery, it must restore pending jobs from its own storage in `onload()` and call `task:register` again.

### Official Plugin Marketplace

The "Open plugin marketplace" button in Settings -> Plugins opens a full marketplace subpage that reads `/api/plugins/marketplace`. Hana follows the Obsidian-style official community catalog model: third-party authors submit plugins to `OH-Plugins`, while users browse, install, enable, and disable plugins without managing marketplace sources.

Default official catalog:

```text
https://raw.githubusercontent.com/liliMozi/OH-Plugins/main/marketplace.json
```

Developer overrides remain available:

- `HANA_PLUGIN_MARKETPLACE_FILE=/path/to/marketplace.json`
- `HANA_PLUGIN_MARKETPLACE_URL=https://.../marketplace.json`

Without either environment variable, Hana first tries `${HANA_HOME}/plugin-marketplace/marketplace.json` for local development. If it does not exist, Hana reads the official `OH-Plugins` URL. The marketplace index shape matches the `OH-Plugins` repository:

```json
{
  "schemaVersion": 1,
  "plugins": [{
    "schemaVersion": 1,
    "id": "demo",
    "name": "Demo",
    "publisher": "Hana",
    "version": "1.0.0",
    "description": "Demo plugin",
    "repository": "https://example.com/demo",
    "compatibility": { "minAppVersion": "0.170.0" },
    "trust": "restricted",
    "permissions": ["task.read"],
    "contributions": ["tools"],
    "distribution": {
      "kind": "release",
      "packageUrl": "https://github.com/liliMozi/OH-Plugins/releases/download/demo-v1.0.0/demo.zip",
      "sha256": "..."
    },
    "versions": [
      {
        "version": "1.0.0",
        "compatibility": { "minAppVersion": "0.170.0" },
        "distribution": {
          "kind": "release",
          "packageUrl": "https://github.com/liliMozi/OH-Plugins/releases/download/demo-v1.0.0/demo.zip",
          "sha256": "..."
        }
      }
    ],
    "readmePath": "plugins/demo/README.md"
  }]
}
```

The marketplace UI shows the plugin list and README in a wider settings subpage. Selecting a plugin reads `/api/plugins/marketplace/:id/readme`. `distribution.kind: "release"` downloads the zip package, verifies `sha256`, then installs it into the user's plugin directory. `distribution.kind: "source"` is only for local file marketplace development because the source path must resolve to a directory on the user's machine.

Marketplace version management uses `versions[]` as the long-term contract: each item declares `version`, that version's `compatibility.minAppVersion`, and its own `distribution`. If `versions[]` is absent, Hana treats the root-level `version` / `compatibility` / `distribution` as a single version entry. The client chooses the highest SemVer version compatible with the current app, while exposing `latestVersion`, `selectedVersion`, `installedVersion`, `updateAvailable`, `downgrade`, `reinstall`, `compatible`, `installAction`, and `canInstall` for UI state.

If the installed version is newer than the highest compatible marketplace version, the action is marked as `downgrade` and install requires explicit `allowDowngrade: true`. Drag-and-drop / local path installs also reject implicit downgrades. Updates back up the previous plugin directory under `${HANA_HOME}/plugin-backups/<pluginId>/`; if the new version fails to load, Hana restores and reloads the old directory. Successful installs are recorded in `${HANA_HOME}/plugin-installs.json` with source, version, release URL, and sha256 so later marketplace state is explicit.

## Forward Compatibility

The system ignores unrecognized directories and manifest fields. Old plugins always work on new systems; new plugins on old systems simply have new contribution types silently ignored. No `manifestVersion` needed, no version migration required.

## Error Isolation

- A single plugin's `onload()` failure does not block other plugins or system startup
- A syntax error in a single tool/route/command file only affects that file
- Failed plugins are marked `status: "failed"` and show error info on the plugins page

## Concurrency

Hana supports multiple sessions and multiple agents running in parallel. Keep the following in mind when developing plugins:

- All session-related EventBus events (`session:send`, `session:abort`, etc.) must include a `sessionPath` parameter to identify the target session
- Tools can obtain the current session path via `ctx.sessionManager.getSessionFile()`
- Do not use `engine.currentSessionPath` or `engine.currentAgentId` (these are UI focus pointers and do not represent the currently executing session)

```js
// Correct: explicitly specify sessionPath
await bus.request("session:send", {
  text: "Hello",
  sessionPath: "/path/to/session.jsonl",
});

await bus.request("session:abort", {
  sessionPath: "/path/to/session.jsonl",
});

// Wrong: omitting sessionPath may target the wrong session under concurrency
await bus.request("session:send", { text: "Hello" });
```
