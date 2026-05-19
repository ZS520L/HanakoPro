import { describe, expect, it } from "vitest";
import { extractMentionedAgentIds } from "../lib/channels/channel-mentions.js";

describe("channel mention extraction", () => {
  it("resolves multi-word display names without also matching a shorter prefix alias", () => {
    const agents = [
      { id: "yui", name: "Yui" },
      { id: "yui-ray", name: "Yui Ray" },
      { id: "hana", name: "Hana" },
    ];

    expect(extractMentionedAgentIds("@Yui Ray 你看看", {
      channelMembers: ["yui", "yui-ray", "hana"],
      agents,
    })).toEqual(["yui-ray"]);
  });

  it("does not resolve ambiguous display-name mentions by list order", () => {
    const agents = [
      { id: "hana-a", name: "Hana" },
      { id: "hana-b", name: "Hana" },
    ];

    expect(extractMentionedAgentIds("@Hana 看看", {
      channelMembers: ["hana-a", "hana-b"],
      agents,
    })).toEqual([]);
  });
});
