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

## Configuration

The bundle inserts one plugin row with id `screenshot-feedback`. To change it, add a row with the same id to your profile's `$DSH_HOME/profiles/<name>/cordis.patch.yml`. **A later layer replaces the whole `config` value**, so restate every key you want, not only the changed one:

```yaml
- id: screenshot-feedback
  name: dsh-screenshot-feedback-hook-mcp
  config:
    command: uvx
    args: ['screenshot-feedback-hook-mcp']
    monitor: 1
    autoAfterTools:
      enabled: true
      delayMs: 2000
```

| Field | Default | Meaning |
|---|---|---|
| `command` | `uvx` | The screenshot executable. Installed with pipx/uv tool? Set it to `screenshot-feedback-hook-mcp` and clear `args`. |
| `args` | `['screenshot-feedback-hook-mcp']` | Fixed arguments placed before the subcommand. |
| `cwd` | `''` | Working directory for the child process; empty means the host's cwd. |
| `monitor` | `0` | `0` stitches every monitor, `1..N` picks one. `list_monitors` shows the indices. |
| `delayMs` | `0` | Wait before a manual capture, so a page or drawing finishes rendering. |
| `maxEdge` | `1568` | Longest edge in pixels. **Do not exceed 2000** — the attachment store refuses larger images. |
| `targetKb` | `80` | Byte budget. dsh has no 25k-token MCP output cap, so raise it when you need more detail. |
| `captureTimeoutMs` | `30000` | Per-capture timeout, on top of the configured delay. |
| `warnOnTextOnlyModel` | `true` | Explain once per session how to switch to an image-capable model. |
| `autoAfterTools.enabled` | `false` | Capture after a matching tool call. |
| `autoAfterTools.matcher` | `edit\|write\|str_replace_editor` | Tool names. A plain `[A-Za-z0-9_|]+` pattern is exact alternation; anything else is a regex. |
| `autoAfterTools.delayMs` | `1500` | Wait before the automatic capture. |
| `autoOnTurnStop.enabled` | `false` | Capture as a turn is about to close. |
| `autoOnTurnStop.delayMs` | `1500` | Wait before the automatic capture. |
| `autoOnTurnStop.steer` | `true` | `true` steers the model into one more step to look at it; `false` only injects it as context. |

Editing `config` hot-swaps the plugin — no restart.

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

MIT License.
