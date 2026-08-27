# dsh-plugin-catalog

The DeepSeek Harness plugin catalog as a single JSON file — the same
`plugins.json` served at <https://awesome-dsh-plugin.com/plugins.json>,
published to npm so it can be fetched from a registry mirror.

It exists because the canonical copy is served from GitHub Pages, which is
slow to reach from some networks, and the public GitHub proxies that would
otherwise help refuse non-github.com hostnames.

```js
import catalog from 'dsh-plugin-catalog/plugins.json' with { type: 'json' }
```

- **Entries:** 2189
- **Version:** `2026.826.2432` (`YYYY.MDD.BUILD`, published only when the catalog changes)
- **Source:** <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>
- **License:** CC0-1.0

The schema is documented by its producer, `scripts/build-site.mjs`, in the
source repository. Published automatically; do not open pull requests here.
