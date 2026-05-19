# @hana/plugin-sdk

Browser-side SDK for Hana iframe plugins.

```ts
import { hana } from '@hana/plugin-sdk';

hana.ready();
hana.ui.resize({ height: 320 });

await hana.toast.show({ message: 'Saved', type: 'success' });
await hana.external.open('https://example.com');
await hana.clipboard.writeText('Copied text');
```

## Host Requests

Stable helpers are thin wrappers around `hana.host.request(type, payload)`.

| Helper | Capability | Grant |
| --- | --- | --- |
| `hana.toast.show(input)` | `toast.show` | no |
| `hana.external.open(input)` | `external.open` | yes |
| `hana.clipboard.writeText(input)` | `clipboard.writeText` | yes |

Grant-required capabilities must be declared in `manifest.json`:

```json
{
  "manifestVersion": 1,
  "ui": {
    "hostCapabilities": ["external.open", "clipboard.writeText"]
  }
}
```

## Theme

Use `hana.theme.getSnapshot()` for initial theme data and `hana.theme.subscribe(callback)` for host theme updates. The host also passes `hana-theme` and `hana-css` query parameters for compatibility with simple iframe pages.
