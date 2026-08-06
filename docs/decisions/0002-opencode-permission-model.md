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
- `analyse` (the default agent) and `analyse-openai`: `edit: ask`,
  `bash: ask`, with no exception. They discuss and diagnose; a keystroke
  confirms if one needs to fix something inline. The two allowances that once
  let the local notification plugin shell out to `yknotify-agent notify` were
  dropped with that plugin (ADR-0005): notifications now come from an upstream
  plugin that writes OSC 777 itself and never invokes `bash`.
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
- Because a `*` in these patterns spans several path segments, the deny on
  `~/.local/share/opencode/*` must be followed by a narrow re-allow of
  `~/.local/share/opencode/plans/*`, or `plan`'s own fallback plan directory
  becomes unreachable. `auth.json` stays denied.

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
- **A session-scoped blanket allow does not override this file.** The resolved
  ruleset observed at runtime begins with a session-level
  `{permission: "*", pattern: "*", action: "allow"}` entry that is absent from
  `opencode debug config`; since evaluation is `findLast`, every rule declared
  here comes after it and wins. Per-request "always" approvals behave the
  opposite way — they land in the request's `approved` list, which is
  concatenated *after* the ruleset, so they do take effect. Granting broad
  session permissions therefore does not silence prompts for anything
  explicitly configured, and that asymmetry is upstream behavior, not
  something this file can change.
- No agent carries a `bash` allowance any more. The only one that ever existed
  was the bounded `yknotify-agent notify *` exception, and removing the plugin
  that needed it (ADR-0005) removed the last hole in the global `bash: ask`.

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
- **Every `deny` rule was exercised for real**, which had never been done: the
  same log showed 22 708 `bash`, 2 024 `read` and 1 171 `external_directory`
  evaluations with *zero* `deny` outcomes, meaning the security-relevant half
  of this file had only ever been checked as configuration. Each was then
  triggered deliberately and returned `PermissionDeniedError`: `read` on a
  throwaway `.env` and `.env.local`, and `external_directory` on
  `~/.aws/…`, `~/.ssh/…`, `~/.gnupg/…`, `~/.config/gh/…` — all four using
  deliberately non-existent filenames, so a missing deny would have surfaced
  as `ENOENT` instead and no real secret could be read either way.
- **The `*.env.example` exception was confirmed not to be shadowed** by the
  `*.env.*` deny that precedes it, which is the same last-match-wins ordering
  the plans re-allow relies on.
- **A `*` spans multiple path segments**: a request for
  `/tmp/opencode/bull-payjoin-fix/lib/core/payjoin/*` matched the rule
  `/tmp/opencode/*`. This is why the `~/.local/share/opencode/*` deny reached
  `plans/` too, and it was confirmed directly: reading
  `~/.local/share/opencode/plans/<nonexistent>.md` was denied before the fix.
  OpenCode itself relies on the same ordering, re-allowing
  `~/.local/share/opencode/tool-output/*` after a user deny.

- The re-allow **resolves** correctly: a fresh `opencode debug config` lists
  `~/.local/share/opencode/plans/*: allow` after the parent `deny`, which is
  the ordering the fix depends on.

**Not verified**: the re-allow's runtime effect. OpenCode does not hot-reload
its configuration, so the rule cannot be *exercised* in the session that
introduced it — only its resolution was confirmed. Note that resolution itself
is not guaranteed either: while auditing this, `~/.config/opencode` turned out
to be a stale copy rather than the symlink the README prescribes, so nothing
committed here reached the running agent at all. `tests/check-coherence.py` now
fails on that case.
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
