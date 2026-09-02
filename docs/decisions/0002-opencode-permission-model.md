# ADR-0002: Allow capable primaries, constrain specialized roles

- Status: Accepted
- Date: 2026-08-11
- Owners: ethicnology
- Applies to: `opencode/opencode.jsonc`

## Problem

A global `"permission": "allow"` is the OpenCode default posture many people
land on. It's frictionless, but it means an agent whose job is to *plan* or
*explore* can also run arbitrary shell commands and edit files — including
under prompt injection from a README, an issue, or fetched web content. There
is no separation between "reasoning about code" and "changing code".

## Decision

Use an allow-by-default posture for the three flagship primary agents
(`codex`, `claude`, and `open`), which are expected
to implement complete tasks without stopping for routine approvals. Constrain
specialized roles explicitly, evaluated with OpenCode's documented
last-match-wins rule (`"*"` first, specific rules after):

- `codex`, `claude`, and `open`: full in-worktree `edit`/`bash`; `doom_loop` is
  denied and `task` is restricted to the analyst and worker agents named for
  that primary.
- `analyst-openai`, `analyst-anthropic`, and `analyst-open`, plus their matching
  `worker-*` agents: wildcard deny followed by the tools needed for their
  bounded role. Their wildcard deny covers every local image tool (`imagegen`,
  `image-display`, `image-warp`, and `image-warp-close`) unless a future
  explicit tool rule overrides it.
- The built-in `build`, `general`, `plan`, `explore`, and `scout` profiles are
  disabled; they are not active roles and are not part of the permission
  contract.
- Global `imagegen`, `image-display`, `image-warp`, and `image-warp-close`
  permissions are `ask`, keeping local image operations human-approved for
  capable primaries.
- Global `external_directory` allows ordinary work but hard-denies credential
  roots: `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.config/gh`, `~/.secrets`,
  `~/.codex`, and OpenCode's own state directory.
- Because a `*` in these patterns spans several path segments, the deny on
  `~/.local/share/opencode/*` must be followed by a narrow re-allow of
  `~/.local/share/opencode/plans/*`, or `plan`'s own fallback plan directory
  becomes unreachable. `auth.json` stays denied.

## Alternatives considered

### Ask before every primary edit and shell command

Rejected after use: it turns capable implementation agents into confirmation
loops without creating a sandbox. The trusted-primary boundary is explicit;
read-only and bounded roles retain deny-by-default permissions.

### Sandbox / container isolation instead of tool permissions

Not rejected, but out of scope here — see ADR-0003. OpenCode's permission
system is a policy layer inside a single trusted process; it reduces exposure,
it does not replace a real sandbox.

## Consequences

Positive: primary agents can complete implementation work autonomously, while a
compromised or careless read-only analyst cannot silently mutate the repo,
execute shell commands, or invoke local image tools. Workers have enough tools
to implement their delegation but cannot recursively fan out.

Negative / known limits:

- `bash: allow` is intentionally not a sandbox. Primary agents and workers are
  trusted with arbitrary shell execution inside the process and can bypass
  tool-level `read` rules. Untrusted repositories therefore require the startup
  flags in ADR-0003.
- `external_directory` denies are the only ones with partial coverage against
  shell-command path detection; `read`/`edit`/`grep` denies are easily
  bypassed by shell commands when no external-directory boundary is crossed.
- Plugins and custom tools execute in the OpenCode process, outside this policy
  layer. Their own code and subprocess environments are part of the trusted
  computing base.
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

## Evidence

- The current configuration defines OpenCode 1.18.26-compatible primary,
  analyst, and worker profiles. Primaries expose `task`; workers expose
  `read`/search/LSP/skill/edit/bash but not `task`, `question`, or `imagegen`.
- The built-in `plan` profile is disabled, and the three analyst and three worker
  profiles resolve every local image tool to `deny` through their wildcard rule
  in the static coherence check below.
- `tests/check-coherence.py` schema-validates the config and now asserts that
  every local custom tool is globally `ask`/`deny`, while active analyst and
  worker profiles resolve each one to `deny` (specific rules take precedence
  over `*`).
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

**Not verified in this change**: an attempted runtime read of each newly denied
credential path. Resolution was checked in a fresh `opencode debug agent`
process; OpenCode does not hot-reload permission changes into an existing
session.
- The permission-pattern semantics (last match wins, `~` expansion, simple
  globs not glob-globs) were cross-checked against OpenCode's published
  `/docs/permissions/` page, not assumed from a bundled skill summary alone —
  that summary was independently found to be incomplete on `agents/` vs
  `agent/` naming and on `tools:` deprecation.

## Revisit when

- OpenCode ships real per-tool sandboxing (process or filesystem isolation),
  which would reduce the trust currently placed in primaries and workers.
- A future version changes default permission inheritance between
  differently named agents; each custom agent block is currently independent
  and must remain explicit.
