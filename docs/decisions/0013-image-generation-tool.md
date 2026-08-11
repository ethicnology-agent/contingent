# ADR-0013: Delegate image generation through a constrained Codex tool

- Status: Proposed
- Date: 2026-08-11
- Owners: ethicnology
- Applies to: `opencode/tools/imagegen.ts`, `opencode/opencode.jsonc`

## Problem

OpenCode has no first-party image-generation tool in this setup, while the
authenticated Codex CLI can invoke GPT-Image through its `$imagegen` skill.
Giving an agent a generic shell recipe would also give the nested process the
entire OpenCode environment, make cancellation unreliable, and leave output
paths to prompt compliance alone.

## Decision

Expose a local `imagegen` tool that accepts a bounded prompt, a new lowercase
PNG filename, and up to eight optional reference images. The tool:

- requires an explicit permission approval for primary agents and is denied to
  `plan`; deny-by-default explorers and workers cannot invoke it;
- writes only under `~/debian/generated-images`, refuses an existing filename,
  and uses an exclusive lock to prevent concurrent calls from racing on the
  same output;
- resolves references canonically and accepts only files inside the active Git
  worktree or the generated-image directory. If OpenCode reports `/` as the
  worktree for a non-repository session, the current project directory becomes
  the boundary instead;
- launches the pinned local Codex CLI in `workspace-write` sandbox mode with an
  allowlisted environment. In particular, OpenCode's provider credentials and
  forwarded SSH agent are not copied into the child process;
- starts Codex in its own process group and kills that group on user
  cancellation or after ten minutes, so descendants cannot outlive the tool;
- removes partial output on failure and verifies that the final path is a
  regular file with a PNG signature before returning it.

The Codex executable and output directory are machine-local dependencies under
`~/debian`. The portable config deliberately does not install either one.

## Alternatives considered

### Tell the primary agent to run Codex through `bash`

Rejected. It duplicates command construction in prompts, bypasses a dedicated
permission key, inherits every environment variable by default, and has no
single implementation point for path or lifecycle checks.

### Call an image API directly from the plugin

Rejected for now. It would add another credential and API integration even
though the authenticated Codex account already provides the required service.

### Allow arbitrary output paths

Rejected. A generated asset is untrusted model output. Keeping it in a single
reviewable directory prevents accidental writes into source trees and makes an
explicit later copy or edit the integration boundary.

## Consequences

Positive: image generation has a narrow permission prompt, bounded filesystem
surface, sanitized subprocess environment, and deterministic cancellation.

Negative / known limits:

- Prompts and reference images are sent to OpenAI through the authenticated
  Codex account; this path is not local or confidential inference.
- The Codex sandbox is part of the trusted computing base. The host tool checks
  the requested and final paths, but it cannot prove that a compromised Codex
  binary never touched another file inside its allowed output workspace.
- Filesystem checks cannot eliminate a same-user time-of-check/time-of-use race
  against a separate malicious local process. The threat model excludes an
  attacker already able to mutate this user's home directory concurrently.
- A failed or interrupted call can leave Codex's own cache state, although the
  requested output and filename lock are cleaned up.
- An external hard kill can leave a stale `.lock` file next to the requested
  output; removing that lock manually is safer than guessing that its owner is
  dead while another process may still be writing.

## Evidence

- `npm run typecheck` validates the tool against
  `@opencode-ai/plugin@1.18.16`, including the typed `ToolContext` fields used
  for directory, worktree, and cancellation handling.
- `tests/check-coherence.py` validates the official OpenCode schema, checks
  that local tools are permission-gated and denied to `plan`, and syntax-checks
  both plugin and tool sources when `esbuild` is available.
- `opencode debug agent` confirms that capable primaries see `imagegen`, while
  `plan`, explorers, and workers do not.

**Not verified yet**: a paid end-to-end image generation and cancellation
during a live generation. The record remains `Proposed` until both have been
observed with the installed Codex CLI.

## Revisit when

- OpenCode provides a native image-generation tool with equivalent path,
  environment, and cancellation guarantees.
- The Codex CLI changes its authentication location, sandbox contract, model
  identifier, or image attachment interface.
