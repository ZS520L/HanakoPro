---
name: hana-plugin-creator
description: Create Hana plugin scaffolds and guide users through beginner or developer plugin planning, capability checks, manifest setup, runtime tools, iframe UI, SDK templates, and install-ready plugin directories. Use when Hanako/Codex needs to explain what Hana plugins can do, help a user describe a plugin idea, check whether the SDK supports it, or generate/update a Hana plugin with @hana/plugin-runtime, @hana/plugin-sdk, and @hana/plugin-components.
metadata:
  default-enabled: false
---

# Hana Plugin Creator

Use this skill for Hana application plugins, not Codex `.codex-plugin` bundles.

## First Contact

On first use, give a map, not an encyclopedia. Explain what Hana plugins can add, ask what the user wants to build, and invite follow-up questions. Expand details only after the user asks or after the chosen scaffold needs them.

Choose the user mode this way:

- If the user explicitly says they are new, non-technical, or wants hand-holding, use beginner mode.
- If the user explicitly asks for SDK/API/build details or gives code-level requirements, use developer mode.
- If memory is unavailable, disabled, or uncertain, ask: `你想我用哪种方式帮你创建插件？A. 边讲边做 B. 开发者模式`

Beginner mode tone: encouraging, concrete, and guided. Say that the user can describe the feature in plain language, Hanako will help turn it into a plugin plan and scaffold, and Hanako can answer questions at any step. Ask:

1. 你希望 Hanako 多一个什么能力？
2. 这个能力是让 Agent 自动调用，还是让你点界面使用？
3. 它需要界面、文件、联网、外部平台、账号权限吗？

Developer mode tone: concise and collaborative. Lead with the capability surface, then ask for the target contribution and integration boundary.

After delivering a plugin, encourage with grounded product value. Name the real situation where the plugin helps, such as reducing repeated steps, making an external service available inside Hana, turning a manual workflow into an Agent-callable tool, or giving a recurring task a stable UI. Use natural wording such as `这个想法挺实用，适合把每周重复整理的步骤固定下来` or `这个方向比较适合做成工具型插件，因为 Agent 可以在对话里直接调用`. Avoid inflated praise like `你的设想太棒了`.

## Capability Map

Hana plugins can provide:

- Agent-callable tools and slash-style actions.
- Skills, agents, and knowledge that guide model behavior.
- Iframe pages, widgets, and cards using Hana theme and host capabilities.
- Lifecycle and EventBus handlers for full-access integrations.
- Provider contributions for chat and media capabilities, including image/video/speech providers backed by HTTP, OAuth HTTP, local CLI, browser CLI, or plugin runtimes.
- Extension-style integrations where the app has explicit extension points.
- SessionFile-backed outputs for files and media.

Hana provides install/enable/reload, per-agent skill toggles, manifest capability checks, iframe host messaging, theme tokens, toast/clipboard/external host APIs, EventBus, data directories, and SDK packages.

Current boundaries: iframe UI is the stable extension surface. Native renderer components and code sandboxing are not the default path yet. If a request depends on those, explain the gap and propose the closest supported shape.

## Workflow

1. Find the Hana repo root. Prefer the current workspace if it contains `PLUGIN_SDK.md`, `PLUGINS.md`, and `packages/plugin-runtime`.
2. Read `.docs/PLUGIN-DEVELOPMENT.md`, `PLUGIN_SDK.md`, and relevant sections of `PLUGINS.md` before changing plugin code. For React UI, also read `packages/plugin-sdk/README.md` and `packages/plugin-components/README.md`.
3. Pick a template:
   - `direct`: no npm install, no build step, best for a beginner's first runnable plugin.
   - `guided-react`: React/Vite/SDK starter with shared Hana components and a gentler README.
   - `professional-react`: React/Vite/SDK starter for developers who expect package scripts and typed UI code.
4. Pick the contribution kind:
   - `tool`: restricted plugin with `tools/*.js`.
   - `ui`: full-access iframe page/widget.
   - `full`: tool, lifecycle/EventBus entry, and iframe UI.
   - `provider`: full-access provider declaration under `providers/*.js`.
5. Pick the target location:
   - Built-in plugin shipped with Hana: `plugins/<plugin-id>`.
   - Example or template plugin: `examples/plugins/<plugin-id>`.
   - User-installed plugin: the directory reported by `/api/plugins/settings` or `${HANA_HOME}/plugins`.
6. Generate the scaffold with the bundled script, then adjust names, descriptions, tools, routes, capabilities, and UI to the user's request.
7. Use the Plugin Dev Loop when available:
   - confirm the user has enabled Settings -> Plugins -> "Allow Agent plugin dev tools";
   - install source with `plugin.dev.install`;
   - reload with `plugin.dev.reload` after edits;
   - keep the returned `devRunId` and pass it to lifecycle controls when available;
   - enable, disable, reset, or uninstall only through `plugin.dev.enable`, `plugin.dev.disable`, `plugin.dev.reset`, and `plugin.dev.uninstall`;
   - inspect `plugin.dev.diagnostics`;
   - smoke-test tools with `plugin.dev.invokeTool`;
   - list UI surfaces with `plugin.dev.listSurfaces`;
   - run `manifest.dev.scenarios` with `plugin.dev.runScenario`.
8. For UI debugging, prefer element-first inspection: read accessible elements, role, label, text, and stable locators before screenshots. Use screenshots for visual polish, clipping, theme fit, or fallback.
9. If the user wants publication, choose one channel:
   - local debug: keep source local and install through the dev loop;
   - human review bundle: create zip, README, manifest, screenshots, and sha256 for email/group/issue review;
   - official OH-Plugins release: prepare catalog entry and release zip, then run privacy-push before any remote push.
10. Run focused verification. When editing this skill, at minimum validate the skill and run the scaffold script against a temp directory.

## Scaffold Commands

Beginner starter:

```bash
python3 skills2set/hana-plugin-creator/scripts/create_hana_plugin.py "My Plugin" --path examples/plugins --audience beginner --template direct
```

Developer React starter:

```bash
python3 skills2set/hana-plugin-creator/scripts/create_hana_plugin.py "My Plugin" --path examples/plugins --audience developer --template professional-react --sdk-mode workspace
```

Useful options:

- `--kind tool`: restricted plugin with a static `tools/create-note.js`.
- `--kind ui`: full-access plugin with `page` and `widget` iframe UI.
- `--kind full`: tool, lifecycle/EventBus entry, and iframe UI.
- `--kind provider`: full-access provider contribution with a media-capability provider declaration.
- `--sdk-mode workspace`: use repo-local SDK packages.
- `--sdk-mode bundled`: copy SDK tarballs from this skill into the generated plugin.
- `--dev-scenario`: add a first-phase `manifest.dev.scenarios` smoke test.
- `--force`: replace an existing generated directory only when the user explicitly wants overwrite.

Provider contribution starter:

```bash
python3 skills2set/hana-plugin-creator/scripts/create_hana_plugin.py "Jimeng Provider" --path examples/plugins --kind provider --audience developer
```

## SDK Rules

- Static `tools/*.js` must export `name`, `description`, `parameters`, and `execute`.
- React templates may use `@hana/plugin-runtime`, `@hana/plugin-sdk`, and `@hana/plugin-components`.
- Dev authority is not a manifest permission. Hana grants it from the remembered dev install slot under `${HANA_HOME}/plugins-dev/`, and Agent dev tools are hidden until the user enables the dev tools setting.
- Local files returned to users must go through `toolCtx.stageFile({ sessionPath, filePath, label })`, then media details. Do not hand-build local `MEDIA:` or `file://` output.
- Page and widget contributions require `"trust": "full-access"` and route-backed iframe UI.
- Declare only the iframe host capabilities actually used.
- EventBus handlers should return `HANA_BUS_SKIP` for payloads that do not belong to them.
- Keep iframe UI self-contained. Do not import renderer internals from `desktop/src/react`.
- Provider declarations live in `providers/*.js` and require `"trust": "full-access"`.
- Keep `capabilities.chat` separate from `capabilities.media.*`. Media-only providers must set `chat.projection = "none"` so they never appear in chat model selectors.
- CLI-backed providers must declare `runtime.kind = "local-cli"` or `"browser-cli"` with structured arg bindings and output contracts. Do not build shell command strings.

## Marketplace Rules

- Marketplace metadata lives in the `OH-Plugins` repository, not inside `project-hana`.
- Official source plugins may live in `OH-Plugins/official-plugins/<plugin-id>/` with a matching `plugins/<plugin-id>.yaml`.
- Each marketplace entry needs one README source: `readme`, `readmePath`, or `readmeUrl`. Use `readmePath` only for local file marketplaces; use inline `readme` or HTTPS `readmeUrl` for URL marketplaces.
- Prefer `versions[]` once a plugin has more than one release line. Each version item declares `version`, `compatibility.minAppVersion`, and its own `distribution`.
- For a single release, root `version`, `compatibility`, and `distribution` remain valid; Hana normalizes them into a single version entry.
- Hana selects the highest SemVer version compatible with the current app and exposes update, reinstall, incompatible, and downgrade states to the UI.
- If the selected compatible version is lower than the installed version, install requires explicit downgrade confirmation with `allowDowngrade: true`.
- Release installs are backed up before replacement and rolled back when the new plugin fails to load.
- Local file marketplaces can install `distribution.kind = "source"` entries because paths resolve on disk.
- URL marketplaces browse entries, show README content, and install release packages by downloading the zip and verifying `sha256`.
- Before pushing `OH-Plugins`, run privacy-push and wait for explicit user confirmation.

## UI Rules

- Default React plugin UI to `HanaThemeProvider mode="inherit"` so it follows the host theme.
- Use `mode="hana"` for a named Hana theme, and `mode="custom"` only for explicit token overrides.
- Route shells should read `hana-theme` and `hana-css` query params, include the theme CSS link when present, and escape values inserted into HTML attributes.
- Direct templates may use small no-build host messaging helpers, but should stay compatible with the public iframe protocol.
