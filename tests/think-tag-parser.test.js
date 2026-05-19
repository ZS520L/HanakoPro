import { describe, expect, it } from "vitest";
import { ThinkTagParser } from "../core/events.js";

function collect(input, chunks = [input]) {
  const parser = new ThinkTagParser();
  const events = [];
  for (const chunk of chunks) parser.feed(chunk, (event) => events.push(event));
  parser.flush((event) => events.push(event));
  return events;
}

describe("ThinkTagParser", () => {
  it("parses provider-emitted leading think tags as thinking", () => {
    expect(collect("<think>internal</think>\nvisible")).toEqual([
      { type: "think_start" },
      { type: "think_text", data: "internal" },
      { type: "think_end" },
      { type: "text", data: "visible" },
    ]);
  });

  it("keeps inline literal think tags visible as normal text", () => {
    expect(collect("正文里提到 <think> 标签时，后续内容不能被吞。")).toEqual([
      { type: "text", data: "正文里提到 <think> 标签时，后续内容不能被吞。" },
    ]);
  });

  it("does not hold a trailing inline tag prefix after visible text", () => {
    const chunks = ["正文里提到 <thi", "nk> 标签"];
    expect(collect(chunks.join(""), chunks)).toEqual([
      { type: "text", data: "正文里提到 <thi" },
      { type: "text", data: "nk> 标签" },
    ]);
  });
});
