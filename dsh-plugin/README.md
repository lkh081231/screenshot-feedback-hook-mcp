# dsh-screenshot-feedback-hook-mcp

**English** | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that lets your agent **see the screen it just produced** — a web page, an EasyEDA/CAD drawing, any desktop app — and correct itself from what it sees.

It is the dsh half of [screenshot-feedback-hook-mcp](https://github.com/lkh081231/screenshot-feedback-hook-mcp); the Python package still owns capture and compression (mss + Pillow, Windows/Linux/macOS), and this plugin owns the dsh wiring.

## Why a native plugin instead of the Claude Code hook bridge

A Claude Code hook can only return **text**, so the best it can do is hand back a file path and hope the agent reads it. dsh has a durable image-attachment service, so a native plugin can commit the screenshot and put a real **image block** into the conversation — the agent does not have to call anything.

| Path | How the image arrives |
|---|---|
| `take_screenshot` tool | the tool result carries the image block |
| after a tool runs (opt-in) | the screenshot rides the tool result as additional context |
| at the end of a turn (opt-in) | the screenshot is steered/injected into the next step |

## Requirements

- **dsh `v0.1.0-rc.8` or later** — every API this plugin uses was verified against that tag.
- **pnpm** on PATH — `dsh plugin` forwards to it.
- **The Python package `screenshot-feedback-hook-mcp` >= 0.3.0**, reachable as `uvx screenshot-feedback-hook-mcp` (needs [uv](https://docs.astral.sh/uv/)) or installed with `pipx`/`uv tool`. Older releases have no `capture --json`; the plugin detects that and tells you to upgrade.
- **A model that accepts image input** — see [Image-capable models](#image-capable-models). Without one the plugin refuses to capture and explains how to switch.

## Install

```sh
dsh plugin --profile web add dsh-screenshot-feedback-hook-mcp
dsh web
```

Ask the agent to "take a screenshot and tell me what is on screen". Use `--profile <name>` for whichever profile you boot.

To install from a checkout instead:

```sh
git clone https://github.com/lkh081231/screenshot-feedback-hook-mcp.git
dsh plugin --profile web add ./screenshot-feedback-hook-mcp/dsh-plugin
```

### Upgrading from 0.1.0 (read this)

**0.1.0 installed dsh's runtime packages into the profile as ordinary dependencies**, putting a second `@deepseek-ai/dsh-tools` in front of the one dsh itself loads. The damage is not limited to screenshots — **every** tool call in that profile dies with:

```
Cannot read properties of undefined (reading 'prepare')
```

0.1.1 declares them as peers, so nothing dsh-related is installed into the profile any more. If you already have 0.1.0, clear the polluted `node_modules` along with it:

```sh
dsh plugin --profile web remove dsh-screenshot-feedback-hook-mcp
rm -rf ~/.dsh/profiles/web/node_modules
dsh plugin --profile web add dsh-screenshot-feedback-hook-mcp
```

Then confirm `~/.dsh/profiles/<name>/node_modules/@deepseek-ai/` holds **no `dsh-*` package at all** — only `schemastery` and `cosmokit` belong there.

## How it registers with dsh

This package is a dsh **bundle** — an npm package that carries a configuration layer, so you never hand-write a patch. Its `package.json` declares what it contributes:

```json
{
  "name": "dsh-screenshot-feedback-hook-mcp",
  "main": "lib/index.js",
  "files": ["lib", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

That `cordis.patch.yml` is the layer. It references the plugin module **by package name** — not by relative path, or Node could not resolve the installed code:

```yaml
- insert:
    - id: screenshot-feedback
      name: dsh-screenshot-feedback-hook-mcp
      config:
        command: uvx
        args: ['screenshot-feedback-hook-mcp']
        monitor: 0
```

`dsh plugin --profile <name> add ...` forwards to pnpm inside the profile directory, sees the `dsh.bundle` manifest, and appends the package to that profile's `dsh.profile.bundles`:

```json
{
  "name": "dsh-profile-web",
  "dependencies": { "dsh-screenshot-feedback-hook-mcp": "..." },
  "dsh": { "profile": { "bundles": [
    "@deepseek-ai/dsh-base",
    "@deepseek-ai/dsh-web-app",
    "dsh-screenshot-feedback-hook-mcp"
  ] } }
}
```

Inspect the layer before booting anything:

```sh
dsh --profile web --dump-config   # shows a `# == dsh-screenshot-feedback-hook-mcp` layer with its id: screenshot-feedback row
```

To uninstall: `dsh plugin --profile web remove dsh-screenshot-feedback-hook-mcp` drops both the dependency and its layer.

Layers compose in this order: each bundle's patch in `dsh.profile.bundles` order (`@deepseek-ai/dsh-base` first) → the profile's own `cordis.patch.yml` → the home-level `$DSH_HOME/cordis.patch.yml` → every `--patch` overlay. So **you can override this package's row from your own profile layer without touching the package**.

## Configuration

Day to day, tune it from the card at **Settings → Plugins → Plugin configuration → Screenshot feedback**. It writes `$DSH_HOME/settings.yaml`, layered over the composition entry, with no restart. Every field on the card says whether you have overridden it and resets back to the composed value in one click.

The bundle inserts one plugin row with id `screenshot-feedback` — the right place for fixed deployment facts. To change it, add a row with the same id to your profile's `$DSH_HOME/profiles/<name>/cordis.patch.yml`. **A later layer replaces the whole `config` value**, so restate every key you want:

```yaml
- id: screenshot-feedback
  name: dsh-screenshot-feedback-hook-mcp
  config:
    command: uvx
    args: ['screenshot-feedback-hook-mcp']
    monitor: 1
    autoAfterTools: true
    autoAfterToolsDelayMs: 2000
```

| Field | Default | On the card | Meaning |
|---|---|:--:|---|
| `command` | `uvx` | | The screenshot executable. Installed with pipx/uv tool? Set it to `screenshot-feedback-hook-mcp` and clear `args`. |
| `args` | `['screenshot-feedback-hook-mcp']` | | Fixed arguments placed before the subcommand. |
| `cwd` | `''` | | Working directory for the child process; empty means the host's cwd. |
| `monitor` | `0` | ✓ | `0` stitches every monitor, `1..N` picks one. `list_monitors` shows the indices. |
| `delayMs` | `0` | ✓ | Wait before a manual capture, so a page or drawing finishes rendering. |
| `maxEdge` | `1568` | ✓ | Longest edge in pixels. **Do not exceed 2000** — the attachment store refuses larger images. |
| `targetKb` | `80` | ✓ | Byte budget. dsh has no 25k-token MCP output cap, so raise it when you need more detail. |
| `captureTimeoutMs` | `30000` | ✓ | Per-capture timeout, on top of the configured delay. |
| `warnOnTextOnlyModel` | `true` | ✓ | Explain once per session how to switch to an image-capable model. |
| `autoAfterTools` | `false` | ✓ | Capture after a matching tool call. |
| `autoAfterToolsMatcher` | `edit\|write\|str_replace_editor` | ✓ | Tool names. A plain `[A-Za-z0-9_|]+` pattern is exact alternation; anything else is a regex. |
| `autoAfterToolsDelayMs` | `1500` | ✓ | Wait before the automatic capture. |
| `autoOnTurnStop` | `false` | ✓ | Capture as a turn is about to close. |
| `autoOnTurnStopDelayMs` | `1500` | ✓ | Wait before the automatic capture. |
| `autoOnTurnStopSteer` | `true` | ✓ | `true` steers the model into one more step to look at it; `false` only injects it as context. |

`command` / `args` / `cwd` are deliberately off the card: they decide where the executable is found, which is deployment composition rather than user preference. Editing `config` hot-swaps the plugin; editing the card needs not even that — every trigger re-reads the configuration.

### How the settings card is wired

dsh's **Plugin configuration** tab renders the intersection of two ledgers: which settings namespaces the Host serves, and which cards the browser registered under those keys. So this package ships both halves, paired by the single namespace `screenshot-feedback`:

- **The Host half** (`src/index.ts`) registers the namespace through `installSettingsSection` from `@deepseek-ai/dsh-settings`, with the `cordis.yml` row as the composition `base`, and points its configuration source at the resolved scope. With no settings service mounted it falls back to the composition entry and behaves exactly as before.
- **The browser half** (`src/client/`) registers a React card into the `settings.plugin.item` keyed slot under that same namespace. It reads and writes through `ctx.settingsScope`, which fences each write with the revision it read, so a form that has drifted from the document is refused rather than overwriting a concurrent change.

The browser half is discovered through the `dsh.client` declaration in `package.json`, and its artifact is `lib/client.js`:

```jsonc
{
  "exports": { "./client": { "default": "./lib/client.js" } },
  "dsh": { "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-settings-plugins"] } }
}
```

> [!NOTE]
> dsh's own `clientBundle` preset that produces this artifact is **not published to npm** (its README lists this as a known limitation), so [tsdown.config.ts](tsdown.config.ts) reproduces the contract here: the lazy-CJS closure factory, the `window.__ModuleLoader__.load` banner/footer, and keeping only module-table specifiers as `require()`. When upgrading dsh, re-check `packages/client/tsdown.client.ts` and `packages/client/web/src/platform.ts` against it.

### About the automatic timings

Both are **off by default**: each screenshot is an image that rides every later request in the session until compaction.

- `autoAfterTools` hooks `tools/post-execute` and attaches the screenshot to the tool result. It cannot loop, and it skips failed tool calls (their screen proves nothing).
- `autoOnTurnStop` hooks `agent/turn-stopping`. Steering there forces another step, which reaches the same stop boundary again — dsh's Claude Code hook bridge pins `stop_hook_active` to `false` and has no consecutive-block cap, so a naive Stop hook keeps the agent running forever. This plugin dedupes on `payload.turn`: **at most one capture per turn**.

A failing screenshot never blocks anything — it is logged and the tool pipeline or turn continues unchanged.

## Image-capable models

dsh only puts an image into the conversation when the exact route declares image input (`ctx.llm.resolveModelInfo(...).inputModalities`) — the same gate as the built-in `read_image` tool. On dsh `v0.1.0-rc.8`, the built-in `deepseek-official` route publishes only `deepseek-v4-flash` and `deepseek-v4-pro`, and **both are text-only**.

To get an image-capable route:

1. Add an Anthropic/OpenAI-style catalog provider under **Settings → Models** and pick one of its vision models.
2. For a custom provider, declare the modality in `$DSH_HOME/settings.yaml`:

   ```yaml
   llm-pi-ai:
     providers:
       my-gateway:
         apiKeyEnv: GATEWAY_API_KEY
         api: openai-completions
         baseURL: https://gateway.example/v1
         models:
           - id: vision-model
             input: [text, image]
   ```

   Catalog providers use `modelOverrides.<model-id>.input` instead; a whole route can fall back with `defaultInput: [text, image]`.
3. If your DeepSeek endpoint really serves a vision model, list it under `llm-deepseek.models` with `inputModalities: [text, image]`.

These fields **assert** what your endpoint supports; they do not add capability it lacks.

## Alternatives without this plugin

- **Bridge the MCP server**: `@deepseek-ai/dsh-mcp-client` can run the same Python package as an MCP server, exposing `mcp__screenshot__take_screenshot`. Same image gate, but no automatic capture.
- **Bridge your Claude Code hooks**: `@deepseek-ai/dsh-hooks-claude-code` runs an existing `hooks.json`. Use `PostToolUse` only, with lowercase dsh tool names in the matcher and `--image-tool read_image` so the agent is pointed at a tool that exists. **Do not use a `Stop` hook there** — `stop_hook_active` is always `false` on dsh, so the CLI's loop guard cannot fire.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```

The real-capture integration test is skipped unless you point it at an installed CLI:

```sh
DSH_SCREENSHOT_CLI=../.venv/Scripts/screenshot-feedback-hook-mcp.exe npx vitest run
```

> [!WARNING]
> **Every `@deepseek-ai/dsh-*` package (and `@deepseek-ai/cordis`) is a peer dependency, never a `dependency`.** Local development gets them from `devDependencies`; at runtime they must come from the host installation. Moving one back into `dependencies` makes pnpm materialize a second copy inside the profile, which shadows the symlinks dsh keeps in `~/.dsh/profiles/node_modules/`. dsh-tools keys its scheduler with a module-local `Symbol`, so two copies mean `ctx.tools[TOOL_RUNTIME_SCHEDULER]` is `undefined` and **every tool call in that profile** — `read`, `write`, `bash`, all of them — dies with `Cannot read properties of undefined (reading 'prepare')`. `tests/packaging.spec.ts` guards this.

MIT License.
