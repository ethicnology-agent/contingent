# ADR-0002: Per-role OpenCode permissions, not a blanket allow

- Status: Accepted
- Date: 2026-07-26
- Owners: ethicnology
- Applies to: `opencode/opencode.jsonc`

## Problem

A global `"permission": "allow"` is the OpenCode default posture many people
land on. It's frictionless, but it means an agent whose job is to *plan* or
*explore* can also run arbitrary shell commands and edit files — including
under prompt injection from a README, an issue, or fetched web content. There
is no separation between "reasoning about code" and "changing code".

## Decision

Give each agent role the permissions its job actually needs, evaluated with
OpenCode's documented last-match-wins rule (`"*"` first, specific patterns
after):

- `plan`: `bash: deny`, `edit` denied except plan files. It reasons, it does
  not touch the tree.
- `analyse` (the default agent): `edit: ask`, `bash: ask`, except the bounded
  `yknotify-agent notify *` command (and the plugin's `timeout 2` form), which
  is allowed. It discusses and diagnoses; a keystroke confirms if it needs to
  fix something inline, but desktop notifications do not need confirmation.
- `build` / `build-openai`: full `edit`/`bash` — this is the implementation
  role.
- `explore` / `explore-openai`: `edit: deny`, `bash: deny`. Read-only
  subagents are the easiest link to compromise via injection because their
  actions aren't reviewed turn by turn.
- Global `bash: ask`, global `external_directory` keeps its native `ask`
  default with hard `deny` added for `~/.ssh`, `~/.gnupg`, `~/.aws`,
  `~/.config/gh`, and OpenCode's own `auth.json` directory (the only
  permission key documented to also gate many shell commands, not just the
  `read`/`edit`/`grep` tools).

## Alternatives considered

### Global `allow`, rely on the user reading diffs

Rejected: it means every subagent, including throwaway `explore` calls, can
silently write files or run destructive commands. Diff review after the fact
doesn't prevent exfiltration via `bash cat/curl`.

### Sandbox / container isolation instead of tool permissions

Not rejected, but out of scope here — see ADR-0003. OpenCode's permission
system is a policy layer inside a single trusted process; it reduces exposure,
it does not replace a real sandbox.

## Consequences

Positive: a compromised or careless `plan`/`explore` turn cannot silently
mutate the repo or exfiltrate via bash. The default agent (`analyse`) is not
Build in disguise.

Negative / known limits:

- `bash: ask` is not a sandbox. A user who reflexively approves `ask` prompts
  gets no real protection.
- `external_directory` denies are the only ones with partial coverage against
  shell-command path detection; `read`/`edit`/`grep` denies are easily
  bypassed by `bash cat <path>` since `bash` itself isn't restricted to safe
  commands.
- `question: allow` had to be added explicitly to non-default agents; OpenCode
  built-ins allow it, custom-named agents default to deny.
- The notification exception only permits the `notify` subcommand. It cannot
  invoke the SSH-agent proxy mode or arbitrary shell commands; its arguments
  are rendered as terminal OSC 777 notification text.

## Evidence

- `opencode debug config` was run against the actual installed OpenCode
  (1.18.5) and the resolved `permission` block for every agent matched what
  this file declares (`analyse: bash=ask edit=ask`, `plan: bash=deny`,
  `build: bash=allow edit=allow`, `explore*: bash=deny edit=deny`).
- A real `question` tool call from a live session produced the expected
  desktop notification (see ADR-0005).
- A real bash command triggered an actual `permission.asked` event with
  `action=ask`, confirmed in `opencode`'s own log
  (`~/.local/share/opencode/log/opencode.log`).
- The permission-pattern semantics (last match wins, `~` expansion, simple
  globs not glob-globs) were cross-checked against OpenCode's published
  `/docs/permissions/` page, not assumed from a bundled skill summary alone —
  that summary was independently found to be incomplete on `agents/` vs
  `agent/` naming and on `tools:` deprecation.

## Revisit when

- OpenCode ships real per-tool sandboxing (process or filesystem isolation),
  which would let `bash: allow` be safe again for non-Build agents.
- A future version changes default permission inheritance between
  differently-named agents (today, `analyse-openai` does **not** inherit
  `analyse`'s permissions merely by naming convention — each agent's block is
  independent and must be set explicitly).
