# ADR-0010: Rewrite shell commands through rtk, rather than instructing the agent to

- Status: Proposed
- Date: 2026-07-27
- Owners: ethicnology
- Applies to: `opencode/plugins/rtk.ts`, `opencode/AGENTS.md`, `skills/rtk/`

## Problem

Command output is a large share of what fills an agent's context: a directory
listing, a diff, a test run, a build log. [rtk](https://github.com/rtk-ai/rtk)
filters that output before it reaches the model, but only if the command is
actually invoked as `rtk <cmd>` instead of `<cmd>`.

`rtk init` solves this with a prompt: it writes ~138 lines into `CLAUDE.md` /
`AGENTS.md` stating a "golden rule" (always prefix with `rtk`) followed by a
catalogue of subcommands and claimed savings. That text is loaded on every turn
of every conversation, and it is advisory — the model may forget it, and it
cannot be verified.

This repo already shipped `opencode/plugins/rtk.ts`, which does the same job by
rewriting commands, but nothing documented why the prompt block was absent. An
absent recommendation and a deliberate rejection look identical in a diff.

## Decision

Keep the rewrite mechanical, and split the prose in two:

1. **The plugin is the enforcement point.** `tool.execute.before` mutates the
   `bash`/`shell` argument in place with the output of `rtk rewrite`. The
   rewrite table lives in rtk's Rust registry, not in this repo and not in a
   prompt.
2. **`opencode/AGENTS.md` carries only what changes the agent's behavior**: that
   it must not prefix commands itself, and the three cases where the rewrite is
   absent or changes semantics.
3. **The catalogue goes in the `rtk` skill**, loaded on demand, because knowing
   that `rtk gain` exists is situational and does not need to cost tokens on
   every turn.

## Alternatives considered

### Paste the `rtk init` block into `opencode/AGENTS.md`

Rejected. It costs roughly 1.5k tokens per conversation to instruct the model to
do something a plugin already does deterministically, and its central claim is
false in this repo: the Git aliases mandated by
[0006](0006-git-history-policy.md) are not rewritten at all (see Evidence). A
guide whose golden rule does not hold trains the agent to distrust the guide.

### Ship the plugin with no prose at all

Rejected — this was the status quo. The rewrite is silent, so an agent seeing
`rtk: Failed to run tsc` has no way to attribute the failure to a rewrite it
did not request, and a reviewer has no way to know the permission prompt shows a
command the model never wrote.

### Put everything in the skill, nothing in `AGENTS.md`

Rejected. A skill loads after the agent decides what to run. The rules that must
hold *before* the first command — do not prefix manually, use npm scripts rather
than `npx` — arrive too late to be useful.

## Consequences

Positive: filtering applies whether or not the model cooperates, costs ~15 lines
of permanent prompt instead of ~138, and the rewrite table stays upstream in rtk
where it is tested.

Negative / known limits, all measured (see Evidence):

- **Permission allow-patterns must match the rewritten form.** A rule like
  `"git status": "allow"` would never fire, because the tool sees
  `rtk git status`. The existing `yknotify-agent notify *` allowances in
  `opencode/opencode.jsonc` are unaffected only because rtk leaves those
  commands alone.
- **`npx` is dropped**: `npx tsc` becomes `rtk tsc`, which does not resolve
  `node_modules/.bin`. For a tool installed as a devDependency — the normal
  case, including this repo's own `typecheck` — the rewritten command fails to
  spawn. Going through the npm script keeps the rewrite harmless.
- **The Git workflow this repo mandates gains nothing.** `git amend`,
  `git fixup`, `git ri`, and even `git rebase --autosquash` are outside rtk's
  registry.
- **rtk's percentage claims are not reproduced here.** They are upstream
  marketing figures; no token measurement was made in this repo.
- The plugin disables itself when `rtk` is not in `PATH`, so the config stays
  portable to a machine without it — but then no filtering happens and nothing
  says so beyond one `warn` line at startup.

## Evidence

- **Ordering of rewrite and permission prompt**, read in the compiled OpenCode
  1.18.7 binary (`SessionTools.resolve`): the sequence is
  `trigger("tool.execute.before", …, {args: b})` then `u.execute(b, F)`, with
  the permission `ask` invoked inside `execute`. The plugin mutates `args` in
  place, so `b` is already rewritten when the prompt is shown. The user
  therefore approves the command that will actually run. Source reading, not a
  runtime measurement.
- **Rewrite table**, obtained by running `rtk rewrite` (rtk 0.43.0) on each
  command:

  | input | output |
  |---|---|
  | `ls -la`, `cat f`, `grep -rn p .`, `find . -name x` | `rtk ls`, `rtk read`, `rtk grep`, `rtk find` |
  | `git status`, `git diff`, `git show`, `git push`, `git stash list` | prefixed with `rtk` |
  | `git amend`, `git fixup <sha>`, `git ri <base>` | *unchanged* |
  | `git rebase --autosquash`, `git bisect start`, `git blame`, `git cherry-pick` | *unchanged* |
  | `npm run typecheck` | `rtk npm run typecheck` |
  | `npm test`, `echo hi`, `./script.sh`, `python3 x.py` | *unchanged* |
  | `npx tsc`, `npx eslint .`, `npx vitest run` | `rtk tsc`, `rtk lint .`, `rtk vitest` |

  A non-matching command produces empty output, and the plugin's
  `rewritten && rewritten !== command` guard leaves it untouched.
- **`yknotify-agent notify hi` and `timeout 2 yknotify-agent notify hi` are not
  rewritten**, so the `allow` rules in `opencode/opencode.jsonc` still match.
- **Argument handling under rewrite**, measured by putting stub executables that
  log their own `argv` on `PATH`: `rtk vitest` invokes
  `vitest run --reporter=json`, so the `run` dropped by
  `rtk rewrite "vitest run"` is restored and watch mode is not entered;
  `rtk jest` invokes `jest --no-watch --json`; `rtk lint .` invokes
  `eslint -f json .`; `rtk tsc --noEmit` invokes `tsc --noEmit` unchanged.
- **`rtk tsc` does not fall back to a project-local binary**: with an executable
  `node_modules/.bin/tsc` present and no `tsc` on `PATH`, it exits 1 with
  `Failed to spawn process: No such file or directory`.

## Revisit when

- **The plugin is observed rewriting a command in a live session.** Everything
  above tests `rtk rewrite` and OpenCode's hook ordering separately; the two
  have not been observed working together end to end. The record stays
  `Proposed` until they are.
- rtk's registry starts covering user-defined Git aliases, which would remove
  the largest gap for this repo.
- OpenCode changes when the permission `ask` runs relative to
  `tool.execute.before`, which would invalidate the guarantee that the approved
  command is the executed one.
