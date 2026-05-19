# SDK Showcase Plugin

This example demonstrates the four SDK layers together:

- `@hana/plugin-runtime` for lifecycle, EventBus, tools, and SessionFile media details.
- `@hana/plugin-sdk` for iframe handshake and host capabilities.
- `@hana/plugin-components` for Hana-styled React iframe UI.
- `@hana/plugin-protocol` indirectly through the iframe SDK.

The `routes/page.js` file serves a minimal iframe shell. In a real plugin, bundle the UI from `ui/Panel.tsx` into `assets/panel.js` and `assets/panel.css`, then copy this directory into `${HANA_HOME}/plugins/sdk-showcase`.

Useful checks from the repo root:

```bash
npm test -- tests/plugin-sdk-examples.test.js
npm run build:packages
```

The example requests `external.open` and `clipboard.writeText` in `manifest.json`. `toast.show` is available without a grant.
