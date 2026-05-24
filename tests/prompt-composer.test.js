import { describe, expect, it } from "vitest";
import {
  BUILTIN_SIMPLE_PROMPT_TEMPLATES,
  DEFAULT_PROMPT_BLOCK_ORDER,
  DEFAULT_SIMPLE_PROMPT_TEMPLATE_ID,
  SYSTEM_GENERATED_PROMPT_BLOCK_IDS,
  composePromptFromBlocks,
  normalizePromptComposerConfig,
} from "../shared/prompt-composer.js";

describe("prompt composer", () => {
  it("enables simple prompt composition by default", () => {
    const cfg = normalizePromptComposerConfig(undefined);
    expect(cfg.enabled).toBe(true);
    expect(cfg.mode).toBe("simple");
    expect(cfg.routes[0].blockIds).toEqual(DEFAULT_PROMPT_BLOCK_ORDER);
    expect(cfg.activeSimplePresetId).toBe(DEFAULT_SIMPLE_PROMPT_TEMPLATE_ID);
    expect(cfg.simpleContent).toBe(BUILTIN_SIMPLE_PROMPT_TEMPLATES[0].content);
    expect(composePromptFromBlocks({ config: cfg, builtInBlocks: [] })).toBe(BUILTIN_SIMPLE_PROMPT_TEMPLATES[0].content);
  });

  it("respects explicit disabled and blocks mode configuration", () => {
    const cfg = normalizePromptComposerConfig({ enabled: false, mode: "blocks" });
    expect(cfg.enabled).toBe(false);
    expect(cfg.mode).toBe("blocks");
    expect(composePromptFromBlocks({ config: cfg, builtInBlocks: [{ id: "platform", content: "default" }] })).toBeNull();
  });

  it("composes enabled routes in order with builtin and custom blocks", () => {
    const content = composePromptFromBlocks({
      config: {
        enabled: true,
        activeRouteId: "main",
        blocks: [
          { id: "custom-tone", title: "Tone", content: "Tone for {{agentName}} and {{userName}}", enabled: true },
        ],
        routes: [
          { id: "main", name: "Main", blockIds: ["platform", "custom-tone", "workspace"] },
        ],
      },
      builtInBlocks: [
        { id: "platform", content: "Platform block" },
        { id: "workspace", content: "Workspace block" },
      ],
      variables: { agentName: "Hanako", userName: "User" },
    });

    expect(content).toBe("Platform block\n\nTone for Hanako and User\n\nWorkspace block");
  });

  it("skips missing and disabled blocks", () => {
    const content = composePromptFromBlocks({
      config: {
        enabled: true,
        activeRouteId: "main",
        blocks: [
          { id: "off", title: "Off", content: "Hidden", enabled: false },
        ],
        routes: [
          { id: "main", name: "Main", blockIds: ["missing", "off", "platform"] },
        ],
      },
      builtInBlocks: [{ id: "platform", content: "Visible" }],
    });

    expect(content).toBe("Visible");
  });

  it("overrides builtin prompt block content when enabled", () => {
    const content = composePromptFromBlocks({
      config: {
        enabled: true,
        activeRouteId: "default",
        blockOverrides: [
          { id: "platform", content: "Edited platform for {{userName}}", enabled: true },
        ],
        routes: [
          { id: "default", name: "Default", blockIds: ["platform"] },
        ],
      },
      builtInBlocks: [{ id: "platform", content: "Default platform" }],
      variables: { userName: "User" },
    });

    expect(content).toBe("Edited platform for User");
  });

  it("keeps route-specific block overrides isolated from the default route", () => {
    const builtInBlocks = [{ id: "platform", content: "Default platform" }];
    const config = {
      enabled: true,
      mode: "blocks",
      blockOverrides: [
        { id: "platform", content: "Default route edit", enabled: true },
      ],
      routes: [
        { id: "default", name: "Default", blockIds: ["platform"] },
        {
          id: "route-2",
          name: "Route 2",
          blockIds: ["platform"],
          blockOverrides: [
            { id: "platform", content: "Route 2 edit", enabled: true },
          ],
        },
      ],
    };

    expect(composePromptFromBlocks({
      config: { ...config, activeRouteId: "default" },
      builtInBlocks,
    })).toBe("Default route edit");
    expect(composePromptFromBlocks({
      config: { ...config, activeRouteId: "route-2" },
      builtInBlocks,
    })).toBe("Route 2 edit");
  });

  it("does not reserve runtime variable blocks as system-generated blocks", () => {
    expect(SYSTEM_GENERATED_PROMPT_BLOCK_IDS).toEqual([]);

    const normalized = normalizePromptComposerConfig({
      blockOverrides: [
        { id: "workspace", content: "Fake workspace", enabled: true },
        { id: "current-time", content: "Fake time", enabled: true },
        { id: "pinned-memory", content: "Fake pinned memory", enabled: true },
        { id: "memory", content: "Fake memory", enabled: true },
        { id: "memory-rules", content: "Editable memory rules", enabled: true },
      ],
      blocks: [
        { id: "workspace", title: "Fake", content: "Custom fake workspace", enabled: true },
        { id: "current-time", title: "Fake", content: "Custom fake time", enabled: true },
        { id: "memory", title: "Fake", content: "Custom fake memory", enabled: true },
      ],
    });
    expect(normalized.blockOverrides).toEqual([
      { id: "workspace", content: "Fake workspace", enabled: true },
      { id: "current-time", content: "Fake time", enabled: true },
      { id: "pinned-memory", content: "Fake pinned memory", enabled: true },
      { id: "memory", content: "Fake memory", enabled: true },
      { id: "memory-rules", content: "Editable memory rules", enabled: true },
    ]);
    expect(normalized.blocks).toEqual([
      { id: "workspace", title: "Fake", content: "Custom fake workspace", enabled: true },
      { id: "current-time", title: "Fake", content: "Custom fake time", enabled: true },
      { id: "memory", title: "Fake", content: "Custom fake memory", enabled: true },
    ]);

    const content = composePromptFromBlocks({
      config: {
        enabled: true,
        activeRouteId: "main",
        blockOverrides: [
          { id: "workspace", content: "Fake workspace", enabled: false },
          { id: "current-time", content: "Fake time", enabled: false },
          { id: "memory", content: "Fake memory", enabled: false },
          { id: "memory-rules", content: "Edited memory rules", enabled: true },
        ],
        blocks: [
          { id: "workspace", title: "Fake", content: "Custom fake workspace", enabled: true },
          { id: "current-time", title: "Fake", content: "Custom fake time", enabled: true },
          { id: "memory", title: "Fake", content: "Custom fake memory", enabled: true },
        ],
        routes: [
          {
            id: "main",
            name: "Main",
            blockIds: ["workspace", "memory-rules", "memory", "current-time"],
            blockOverrides: [
              { id: "memory-rules", content: "Edited memory rules", enabled: true },
            ],
          },
        ],
      },
      builtInBlocks: [
        { id: "workspace", content: "System workspace" },
        { id: "memory-rules", content: "Default memory rules" },
        { id: "memory", content: "System memory" },
        { id: "current-time", content: "System time" },
      ],
    });

    expect(content).toBe("Custom fake workspace\n\nEdited memory rules\n\nCustom fake memory\n\nCustom fake time");
  });

  it("keeps legacy route ids without expanding runtime memory blocks", () => {
    const normalized = normalizePromptComposerConfig({
      mode: "blocks",
      routes: [
        { id: "legacy", name: "Legacy", blockIds: ["platform", "memory", "current-time"] },
      ],
    });

    expect(normalized.routes[0].blockIds).toEqual([
      "platform",
      "memory",
      "current-time",
    ]);
  });

  it("uses one simple system.content body without appending runtime blocks in simple mode", () => {
    const normalized = normalizePromptComposerConfig({
      enabled: true,
      mode: "simple",
      simpleContent: "Simple prompt for {{agentName}}",
      activeRouteId: "default",
      blockOverrides: [
        { id: "platform", content: "Edited platform", enabled: true },
      ],
      routes: [
        { id: "default", name: "Default", blockIds: ["platform", "workspace"] },
      ],
    });

    expect(normalized.mode).toBe("simple");
    expect(normalized.simpleContent).toBe("Simple prompt for {{agentName}}");
    expect(composePromptFromBlocks({
      config: normalized,
      builtInBlocks: [
        { id: "platform", content: "Platform block" },
        { id: "workspace", content: "Workspace block" },
        { id: "memory-rules", content: "Memory rules" },
        { id: "pinned-memory", content: "Pinned memory" },
        { id: "memory", content: "Memory block" },
        { id: "current-time", content: "Time block" },
      ],
      variables: { agentName: "Hanako" },
    })).toBe("Simple prompt for Hanako");
  });

  it("supports built-in simple prompt templates", () => {
    const template = BUILTIN_SIMPLE_PROMPT_TEMPLATES[0];
    const normalized = normalizePromptComposerConfig({
      enabled: true,
      mode: "simple",
      activeSimplePresetId: template.id,
      simpleContent: "Ignored legacy content",
    });

    expect(normalized.activeSimplePresetId).toBe(template.id);
    expect(normalized.simpleContent).toBe(template.content);
    expect(composePromptFromBlocks({
      config: normalized,
      builtInBlocks: [],
      variables: { agentName: "Hanako", userName: "User" },
    })).toContain("Hanako");
  });

  it("preserves legacy simpleContent as a custom template", () => {
    const normalized = normalizePromptComposerConfig({
      enabled: true,
      mode: "simple",
      simpleContent: "Legacy prompt for {{userName}}",
    });

    expect(normalized.activeSimplePresetId).toBe("custom-current");
    expect(normalized.simplePresets).toEqual([
      { id: "custom-current", name: "当前自定义模板", content: "Legacy prompt for {{userName}}" },
    ]);
    expect(composePromptFromBlocks({
      config: normalized,
      builtInBlocks: [],
      variables: { userName: "User" },
    })).toBe("Legacy prompt for User");
  });

  it("supports multiple custom simple prompt presets", () => {
    const normalized = normalizePromptComposerConfig({
      enabled: true,
      mode: "simple",
      activeSimplePresetId: "reviewer",
      simplePresets: [
        { id: "coder", name: "Coder", content: "Coder prompt" },
        { id: "reviewer", name: "Reviewer", content: "Review prompt for {{agentName}}" },
      ],
    });

    expect(normalized.simplePresets).toHaveLength(2);
    expect(normalized.simpleContent).toBe("Review prompt for {{agentName}}");
    expect(composePromptFromBlocks({
      config: normalized,
      builtInBlocks: [],
      variables: { agentName: "Hanako" },
    })).toBe("Review prompt for Hanako");
  });

  it("renders dynamic content only through template variables", () => {
    const normalized = normalizePromptComposerConfig({
      enabled: true,
      mode: "simple",
      simpleContent: [
        "Workspace: {{workspace}}",
        "Skills: {{skills}}",
        "Memory: {{pinnedMemory}}",
        "Append: {{appendSystemPrompt}}",
        "Mood: {{mood}}",
      ].join("\n"),
    });

    const content = composePromptFromBlocks({
      config: normalized,
      builtInBlocks: [
        { id: "platform", content: "Platform block" },
        { id: "workspace", content: "Workspace block" },
        { id: "memory-rules", content: "Memory rules" },
        { id: "pinned-memory", content: "Pinned memory" },
        { id: "memory", content: "Memory block" },
        { id: "current-time", content: "Time block" },
      ],
      variables: {
        workspace: "CWD context",
        skills: "<available_skills />",
        pinnedMemory: "Pinned fact",
        appendSystemPrompt: "Append rules",
        mood: "Mood rules",
      },
    });

    expect(content).toBe([
      "Workspace: CWD context",
      "Skills: <available_skills />",
      "Memory: Pinned fact",
      "Append: Append rules",
      "Mood: Mood rules",
    ].join("\n"));
  });
});
