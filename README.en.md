# screenshot-feedback-hook-mcp 👁

[中文](README.md) | **English**

Let your coding agent **see what it builds** — a cross-platform (Windows / Linux / macOS) screenshot-feedback tool for AI agents, shipped as an MCP server plus a Claude Code hook helper.



## Why

When an agent builds a frontend or draws EasyEDA/CAD engineering diagrams, it's flying blind without visual feedback. Give it a "screenshot → look → self-correct" loop and the output quality changes immediately.

The technical reality: Claude Code **hooks can only return text**, while **MCP tools can return native images**. So this tool is built in two layers:

| Layer | How it triggers | How the image reaches the agent |
|---|---|---|
| **MCP server** | agent calls `take_screenshot` itself | tool returns a native image block directly (works across MCP clients) |
| **Claude Code hook** | fires automatically after an action | hook returns the screenshot's absolute path; agent reads it with the Read tool |
| **DeepSeek Harness plugin** | agent calls it, or it fires after a tool / at the end of a turn | the screenshot is committed to dsh's durable attachment store and enters the conversation as an image block — **the agent does nothing** |

Images are downscaled by default (longest edge 1568px) and JPEG-compressed to a **byte budget** (~80KB), staying under Claude Code's ~25k-token limit on MCP output.

> [!TIP]
> **Engineers and non-programmers: just let your AI agent install and configure this for you — don't need to hand-edit JSON.**
> Tell Claude Code something like "install and set up screenshot-feedback-hook-mcp for me." Following the [hook setup](#claude-code-hook-auto-screenshot-after-an-action) guidance below, the agent will first ask about your use case (what you want to see, how long it takes to render, when to capture), then write the MCP + hook config for you. Prefer doing it yourself? See the manual steps below.

## Install

Zero-install run (requires [uv](https://docs.astral.sh/uv/)):

```bash
# MCP server (no arguments = MCP server)
uvx screenshot-feedback-hook-mcp

# CLI screenshot (with a subcommand = CLI)
uvx screenshot-feedback-hook-mcp capture --monitor 0 --out shot.jpg
uvx screenshot-feedback-hook-mcp monitors
```

Or install persistently: `pipx install screenshot-feedback-hook-mcp` / `uv tool install screenshot-feedback-hook-mcp`.

## Connect via MCP (recommended starting point)

One line for Claude Code:

```bash
claude mcp add screenshot-feedback -- uvx screenshot-feedback-hook-mcp
```

Or in any MCP client (Cursor / Cline / Windsurf...) via mcp.json:

```json
{
  "mcpServers": {
    "screenshot-feedback": {
      "command": "uvx",
      "args": ["screenshot-feedback-hook-mcp"]
    }
  }
}
```

Tools:
- `take_screenshot(monitor=0)` — capture the screen, returns the image directly. 0 = all monitors stitched, 1..N = a single monitor.
- `list_monitors()` — list monitor indices / resolutions.

## Connect to DeepSeek Harness (native dsh plugin)

On [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), use the native plugin rather than the MCP route above: dsh has a durable image-attachment service, so the plugin can put the screenshot into the conversation as a real image block — **the agent does not have to call anything**.

```sh
dsh plugin --profile web add dsh-screenshot-feedback-hook-mcp
dsh web
```

This package is a dsh **bundle**: its `package.json` declares `dsh.bundle.patch`, pointing at the [cordis.patch.yml](dsh-plugin/cordis.patch.yml) it ships. `dsh plugin add` recognizes that manifest, appends the package to the profile's `dsh.profile.bundles`, and its patch layer composes into the config tree — **you never hand-write a patch**. After installing, `dsh --profile web --dump-config` shows the extra `# == dsh-screenshot-feedback-hook-mcp` layer with its `id: screenshot-feedback` row.

Requires dsh ≥ `v0.1.0-rc.8`, pnpm on PATH, the Python package ≥ 0.3.0, the plugin ≥ **0.2.0**, and **a model that accepts image input**.

> [!CAUTION]
> **Plugin 0.1.0 is broken: installing it makes every tool call in that profile fail**, not just screenshots. Upgrade to ≥ 0.2.0 — steps in [dsh-plugin/README.md](dsh-plugin/README.md#upgrading-from-010-read-this).

> [!IMPORTANT]
> **DeepSeek's `deepseek-v4-flash` and `deepseek-v4-pro` are both text-only**, and the built-in `deepseek-official` route on rc.8 ships no vision model at all. With those, a screenshot never reaches the conversation (dsh rejects it before the request), so the plugin skips the capture and tells you how to switch: add an Anthropic/OpenAI-style catalog provider under Settings → Models and pick a vision model, or declare `input: [text, image]` for your custom provider's model. Note that **the Settings page has no modality field** — after adding the model, click *Open config file* and add it by hand in `settings.yaml` (`inputModalities` under `llm-deepseek`).

Once installed, tune it from the card at **Settings → Plugins → Plugin configuration → Screenshot feedback** (monitor, the various delays, the two automatic timings that ship disabled); saves take effect without a restart. The full field table and how it works are in [dsh-plugin/README.md](dsh-plugin/README.md).

## Claude Code hook (auto-screenshot after an action)

> [!IMPORTANT]
> **If you are an AI agent setting this up for a user: ask about their use case before writing any hook config.** Correct hook configuration depends heavily on the scenario; configuring blindly will usually capture the wrong screen or fire at the wrong moment. At minimum, clarify:
> 1. **What should it see?** A frontend page (browser), an engineering drawing (EasyEDA/CAD or other desktop app), or something else? Determines `--monitor` (which screen the visual output is on).
> 2. **How long does rendering/refresh take?** Browser hot-reload ≈ 1–2s; EDA/CAD redraws can take longer → determines `--delay`.
> 3. **When to capture?** Every time Claude finishes (`Stop`, simplest) or after each file edit (`PostToolUse` + matcher, more frequent)?
> 4. **Which scope?** This project only (project `.claude/settings.json`) or all projects (user-level `~/.claude/settings.json`)?
>
> Only after clarifying, pick one of the templates below, fill in the parameters, and write it. Don't just copy the defaults.

### Manual setup

**Step 1 · Choose the trigger**

| Trigger | When it captures | Best for |
|---|---|---|
| `Stop` | one shot each time Claude finishes a reply | most scenarios — moderate frequency, low effort |
| `PostToolUse` | after each matched tool (e.g. `Edit`/`Write`) runs | seeing the effect right after every change |

**Step 2 · Fill in parameters for your scenario**

- `--monitor N`: the display the visual output is on. `0` = all stitched, `1..N` = single screen. Run `uvx screenshot-feedback-hook-mcp monitors` to see indices.
- `--delay SECONDS`: wait before capturing so rendering completes (frontend `1`, EDA/CAD `2`–`5` depending on redraw speed).
- `--max-edge PIXELS` / `--target-kb SIZE`: defaults are usually fine (longest edge 1568px, ~80KB).

**Step 3 · Write into `.claude/settings.json`**

Project-level config goes in the project root's `.claude/settings.json`; for global effect use the user-level `~/.claude/settings.json`. Templates below and in [examples/](examples/).

**Step 4 · Verify**

Restart the Claude Code session, trigger the corresponding event once, and confirm Claude receives "screenshot saved to …" and reads it with the Read tool.

### Template A: capture each time Claude finishes (`Stop`, recommended start)

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "uvx screenshot-feedback-hook-mcp capture --delay 1 --hook-output stop"
          }
        ]
      }
    ]
  }
}
```

### Template B: capture after each file edit (`PostToolUse`)

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "uvx screenshot-feedback-hook-mcp capture --delay 2 --hook-output post-tool-use"
          }
        ]
      }
    ]
  }
}
```

### How it works

The CLI emits the correct hook JSON (`Stop` uses `decision:block` to return text and automatically handles `stop_hook_active` to prevent infinite loops; `PostToolUse` uses `hookSpecificOutput.additionalContext`). The agent sees "screenshot saved to …, please read it with the Read tool" and reads the image. Because **hooks can only return text**, this path is "return the path + agent reads the image"; to give the agent the image block directly, use the MCP method above.

## Platform notes

- **Windows**: works out of the box.
- **macOS**: on first use, enable the terminal/IDE running the agent under System Settings → Privacy & Security → Screen Recording, then restart that app — otherwise you'll capture a black screen / wallpaper (the tool detects and warns).
- **Linux**: X11 works out of the box; **mss is limited under pure Wayland** — the tool probes and warns at startup (grim/portal backend on the roadmap).

## Roadmap

- [ ] Region capture (`--region x,y,w,h`)
- [ ] Capture by window title (Win EnumWindows / mac CGWindowList / Linux wmctrl)
- [ ] URL / headless-browser mode (deterministic frontend screenshots)
- [ ] Wayland backend (grim / xdg-desktop-portal)

## Development

```bash
uv sync           # install dependencies
uv run pytest     # tests
uv run screenshot-feedback-hook-mcp capture --out shot.jpg   # CLI
uv run screenshot-feedback-hook-mcp                          # MCP server
```

MIT License.
