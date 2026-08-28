# Changelog

**English** | [中文](CHANGELOG.zh.md)

This file records **behaviour changes** only — what looks different after you upgrade. For installing, configuring and troubleshooting, see the [README](README.md).

Upgrading from 0.1.0 has one pitfall that breaks every tool call in the profile. That section stays in the [README](README.md#upgrading-from-010-read-this), because it is something you need at install time rather than while reading a changelog.

## 0.2.1

- **A failed automatic screenshot now says why, in the conversation.** Both automatic timings used to swallow every failure into the log, so the plugin looked like it was silently doing nothing — even though the most common failure (`uvx` is not on PATH) carries instructions you can act on. The reason now rides along as plugin context: beside the tool result for `autoAfterTools`, injected for `autoOnTurnStop`. The decision itself is still passed through untouched, and a turn-end failure only ever injects — it never steers, so it cannot prolong a turn that was ending. The same reason is reported once and then stays quiet until it changes, and the memo is cleared after a success so a relapse is reported again. A gate that cannot be checked at all (the model catalog is unreachable) is still log-only: it has no advice to offer.

## 0.2.0

- **Screenshots now stay on disk.** `take_screenshot`'s result declares a `path`, and that file is now a real, readable one — you can read it again. Before 0.2.0 the file was deleted before the tool returned, so the declared `path` always pointed at nothing. The plugin keeps the 20 most recent shots under the temp directory and prunes older ones; a failed capture leaves nothing behind.
- **`delay_ms` is bounded.** A model asking for a very long wait can no longer push past the operator's `captureTimeoutMs`. The ceiling is 10000 ms, or the configured `delayMs` if that is larger, and a capped request says so in the result's warnings.
- **The image-capability gate tells its two refusals apart.** "This model declares no image input" and "the route could not be resolved" are now budgeted separately, so the first — the one that tells you how to switch models — can no longer be crowded out by the second. A transient failure while querying the model catalog counts as neither; it is logged and skipped.
- **Cancellation and timeout are reported distinctly** instead of both surfacing as "the screenshot command produced no output".

## 0.1.1

- **No dsh runtime packages are installed into the profile any more.** Every `@deepseek-ai/*` moved to `peerDependencies`, fixing the 0.1.0 duplicate-runtime failure that made **every** tool call in the profile die with `Cannot read properties of undefined (reading 'prepare')`. Coming from 0.1.0 needs a one-off `node_modules` cleanup — steps in the [README](README.md#upgrading-from-010-read-this).

## 0.1.0

- First release: the `take_screenshot` and `list_monitors` tools, the two automatic capture timings (`tools/post-execute` and `agent/turn-stopping`, both off by default), and the configuration card in the settings page.
