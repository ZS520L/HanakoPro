import {
  defineBusHandler,
  definePlugin,
  HANA_BUS_SKIP,
  requestBus,
} from "@hana/plugin-runtime";

const previewHandler = defineBusHandler({
  type: "sdk-showcase:preview",
  async handle(payload, ctx) {
    if (!payload || payload.pluginId !== ctx.pluginId) return HANA_BUS_SKIP;
    return {
      title: "SDK Showcase",
      text: "Runtime handler is alive.",
    };
  },
});

export default definePlugin({
  async onload(ctx, { register }) {
    if (ctx.bus.handle) {
      register(ctx.bus.handle(previewHandler.type, (payload) => previewHandler.handle(payload, ctx)));
    }

    if (ctx.bus.hasHandler?.("session:send")) {
      requestBus(ctx, "session:send", {
        sessionPath: ctx.sessionPath,
        text: "SDK showcase loaded.",
      }).catch((err) => ctx.log.debug("session:send skipped", err.message));
    }

    ctx.log.info("SDK showcase loaded");
  },

  async onunload(ctx) {
    ctx.log.info("SDK showcase unloaded");
  },
});
