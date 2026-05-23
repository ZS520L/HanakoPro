import { describe, expect, it } from "vitest";
import {
  applyToolDescriptionOverrides,
  collectToolDescriptionEntries,
  summarizeToolDescriptions,
} from "../shared/tool-description-overrides.js";

describe("tool description overrides", () => {
  it("collects tool and nested parameter descriptions", () => {
    const entries = collectToolDescriptionEntries({
      name: "todo_write",
      description: "Tool description",
      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            description: "Todos array",
            items: {
              type: "object",
              properties: {
                content: { type: "string", description: "Todo content" },
              },
            },
          },
        },
      },
    });

    expect(entries).toEqual([
      { kind: "tool", path: "", description: "Tool description" },
      { kind: "parameter", path: "todos", description: "Todos array" },
      { kind: "parameter", path: "todos[].content", description: "Todo content" },
    ]);
  });

  it("applies tool and parameter description overrides without mutating the source", () => {
    const tool = {
      name: "web_search",
      description: "Default search",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Default query" },
        },
      },
    };

    const [updated] = applyToolDescriptionOverrides([tool], [
      {
        name: "web_search",
        description: "Edited search",
        parameters: [{ path: "query", description: "Edited query" }],
      },
    ]);

    expect(updated.description).toBe("Edited search");
    expect(updated.parameters.properties.query.description).toBe("Edited query");
    expect(tool.description).toBe("Default search");
    expect(tool.parameters.properties.query.description).toBe("Default query");
  });

  it("summarizes tools for the settings UI", () => {
    const summary = summarizeToolDescriptions([
      {
        name: "read",
        label: "Read",
        description: "Read file",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path" },
          },
        },
      },
    ]);

    expect(summary).toEqual([
      {
        name: "read",
        label: "Read",
        description: "Read file",
        parameters: [{ kind: "parameter", path: "path", description: "File path" }],
      },
    ]);
  });
});
