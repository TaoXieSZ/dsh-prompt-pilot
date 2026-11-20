# Prompt Pilot

Context-aware next-step suggestions above the DeepSeek Harness composer.

The rail above the message box offers the thing you would most likely do next — derived from real
session and repository state, plus a small model-written set. Picking a prompt chip fills the
composer; a pull request chip opens its diff in the right sidebar. The row hides as soon as the
draft has content, so it never competes with what you are typing, and it holds at most four chips
with repository signals first.

## What it shows

| Chip | Signal | Click |
| --- | --- | --- |
| **Resume** | Last Turn ended `interrupted`, `max-tokens`, `error`, `blocked`, or a non-user `aborted` — never after Stop or a fork | Fills a prompt that continues from the stopping point |
| **Open PR #N diff** | `gh pr list --head <branch> --state open` finds one | Opens the diff in a right-sidebar tab |
| **Review changes** | `git status --porcelain` is non-empty | Fills a review request naming the count |
| **Model prompts** | Written against the same signals and the last few messages, only while the row is on screen | Fills the composer |

## Layout

```
index.js             Host half: signals, PR lookup, model call, HTTP resource route
client.js            Client half: the rail and the PR diff tab
cordis.patch.yml     One row, `prompt-pilot`
locale/{en,zh}.json  Plugin Manager title and description
docs/DETAIL.md       Detail page (functionality, usage, limits)
```

### Host half

Registers one read-only resource route under `/plugin/prompt-pilot`:

- `GET /suggest?sessionId=<id>&ai=1&debug=1` — rail payload. `ai=0` skips the model call, `debug=1`
  adds the resolved working directory, repository root, model route, and the raw reply when
  parsing found nothing.
- `GET /pr?sessionId=<id>&number=<n>` — pull-request metadata plus the unified diff.

Signals come from `ctx.sessions` and `git`/`gh` spawned with a hard timeout. The model call uses
`ctx.llm` on the profile's default route via `ctx.agentDefaultModel`, capped at 12 s, and is keyed
by session sequence number, so repeated requests for one session state reuse a single reply. The
Client asks for signals with `ai=0` on a poll and asks for the model set only while the rail is
visible.

### Client half

Registers into `conversation.input.dock` (`id: prompt-pilot`, `order: 15`) and, when the right
Sidebar is present, a page tab type `prompt-pilot.pr` with its body in `sidebar.right.pane.tab` and
its chip title in `sidebar.right.pane.tab.title`.

It reads composer state through the slot's `useInput` selector and writes through
`inputActions.setDraft`, so it uses the same draft path as typing. The right-Sidebar handle comes
from the scope that resolved `sidebarRight` in this plugin's optional `inject`, because Cordis
throws on reading a service the context did not inject.

## Tests

`node test/host.test.mjs` drives the real Host module through a fake context and a throwaway git
repository: resume detection, the rail cap, repository facts, model parsing, and every degradation
path (no model, prose reply, unknown session, no pull request).

## Diagnosing "I don't see the row"

The row renders only while the message box is empty and the input is not mid-submission — start
typing and it hides. If it still is not there, the Host half answers two local diagnostic routes:

- `GET /plugin/prompt-pilot/diag` — request count plus the last 20 self-reports from the browser
  half, each carrying the session, draft length, input phase, chip count and load status. A missing
  `apply` report means the browser never loaded this module; an `apply` report with no chip reports
  means the component never rendered.
- `GET /plugin/prompt-pilot/suggest?sessionId=<id>&debug=1` — the same payload with the resolved
  working directory, repository root, model route, and the raw model reply when parsing found
  nothing.

## Requirements

- `git` on `PATH` for repository signals.
- The GitHub CLI (`gh`), installed and authenticated, for the PR chip and diff panel. Without it
  those two chips simply never appear.
- A configured default model route for model-written prompts. Without one the rail still shows the
  deterministic chips.

## Notes

- No Harness Client package is imported; only React from the browser module table.
- Styles use `--dsw-alias-*` theme tokens, so light and dark themes both work.
