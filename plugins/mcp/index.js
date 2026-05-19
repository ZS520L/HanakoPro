import { McpRuntime } from "./lib/mcp-runtime.js";

export default class McpPlugin {
  async onload() {
    const runtime = new McpRuntime(this.ctx);
    this.ctx._mcpRuntime = runtime;
    await runtime.load();
    this.register(() => runtime.dispose());
    this.ctx.log.info("mcp plugin loaded");
  }
}
