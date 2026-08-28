# dsh-screenshot-feedback-hook-mcp

**English** | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that lets your agent **see the screen it just produced** — a web page, an EasyEDA/CAD drawing, any desktop app — and correct itself from what it sees.

It is the dsh half of [screenshot-feedback-hook-mcp](https://github.com/lkh081231/screenshot-feedback-hook-mcp); the Python package still owns capture and compression (mss + Pillow, Windows/Linux/macOS), and this plugin owns the dsh wiring.

![The agent calls take_screenshot and the image arrives in the conversation](https://raw.githubusercontent.com/lkh081231/screenshot-feedback-hook-mcp/main/dsh-plugin/docs/screenshot-in-context.png)

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

### Installing from GitHub, and why not from a working tree

The plugin registry lists a git spec, and it works: pnpm clones the repo, runs this package's `prepare` script to build `lib/`, then packs the result and installs that.

```sh
dsh plugin --profile web add github:lkh081231/screenshot-feedback-hook-mcp#path:/dsh-plugin
```

> **pnpm 10 and later gate build scripts.** The first install — before the built package is in pnpm's content-addressable store — can stop with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`. Allow it in `~/.dsh/profiles/<name>/pnpm-workspace.yaml` under `onlyBuiltDependencies`, copying the exact entry pnpm's error prints, then run the command again. Once the built package is cached the gate no longer applies.

**Do not point `dsh plugin add` at a working tree.** `dsh plugin --profile web add ./screenshot-feedback-hook-mcp/dsh-plugin` installs the directory as a pnpm `link:`, and that fails two different ways:

- **`lib/` is a build product and is not in git.** pnpm does not run `prepare` for linked packages, so `main: "lib/index.js"` points at nothing and dsh dies at boot:

  ```
  dsh: plugin tree failed to load: ... Cannot find module
  '~/.dsh/profiles/web/node_modules/dsh-screenshot-feedback-hook-mcp/lib/index.js'
  ```

- **Building in place fixes that and causes something worse.** Node resolves a linked package from its real path, so after `npm install` the `@deepseek-ai/dsh-*` copies sitting in `dsh-plugin/node_modules/` shadow the host's — the duplicate-instance failure described in [Upgrading from 0.1.0](#upgrading-from-010-read-this), which breaks **every** tool call in that profile, not just screenshots.

To install from a checkout, pack it first so only the `files` allowlist reaches the profile:

```sh
git clone https://github.com/lkh081231/screenshot-feedback-hook-mcp.git
cd screenshot-feedback-hook-mcp/dsh-plugin
npm install && npm run build && npm pack
dsh plugin --profile web add ./dsh-screenshot-feedback-hook-mcp-0.2.1.tgz
```

Whichever route you take, confirm `~/.dsh/profiles/<name>/node_modules/@deepseek-ai/` holds **no `dsh-*` package** — only `schemastery` and `cosmokit` belong there.

### What changed in 0.2.1

- **A failed automatic screenshot now says why, in the conversation.** Both automatic timings used to swallow every failure into the log, so the plugin looked like it was silently doing nothing — even though the most common failure (`uvx` is not on PATH) carries instructions you can act on. The reason now rides along as plugin context: beside the tool result for `autoAfterTools`, injected for `autoOnTurnStop`. The decision itself is still passed through untouched, and a turn-end failure only ever injects — it never steers, so it cannot prolong a turn that was ending. The same reason is reported once and then stays quiet until it changes, and the memo is cleared after a success so a relapse is reported again. A gate that cannot be checked at all (the model catalog is unreachable) is still log-only: it has no advice to offer.

### What changed in 0.2.0

- **Screenshots now stay on disk.** `take_screenshot`'s result declares a `path`, and that file is now a real, readable one — you can read it again. Before 0.2.0 the file was deleted before the tool returned, so the declared `path` always pointed at nothing. The plugin keeps the 20 most recent shots under the temp directory and prunes older ones; a failed capture leaves nothing behind.
- **`delay_ms` is bounded.** A model asking for a very long wait can no longer push past the operator's `captureTimeoutMs`. The ceiling is 10000 ms, or the configured `delayMs` if that is larger, and a capped request says so in the result's warnings.
- **The image-capability gate tells its two refusals apart.** "This model declares no image input" and "the route could not be resolved" are now budgeted separately, so the first — the one that tells you how to switch models — can no longer be crowded out by the second. A transient failure while querying the model catalog counts as neither; it is logged and skipped.
- **Cancellation and timeout are reported distinctly** instead of both surfacing as "the screenshot command produced no output".

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

![The plugin's card in Settings → Plugins → Plugin configuration](https://raw.githubusercontent.com/lkh081231/screenshot-feedback-hook-mcp/main/dsh-plugin/docs/settings-card.png)

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
| `warnOnTextOnlyModel` | `true` | ✓ | Explain how to reach an image-capable model when the gate refuses. Once per reason, per session. |
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

> [!IMPORTANT]
> **The Settings page cannot declare modalities.** The model card under **Settings → Models** only edits `id` / name / context window / max tokens — there is no modality field, so any model you add there is treated as **text-only** and this plugin refuses to capture. After adding a custom model, click **Open config file** on that page and add the modality to it by hand in `settings.yaml`: `input: [text, image]` (or `inputModalities: [text, image]` under `llm-deepseek`). Hand-written fields survive later edits made from the Settings page.

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
