# ADR-0007: Slice commits and PRs for the reviewer, not the writer

- Status: Accepted (as advisory guidance; not mechanically enforced)
- Date: 2026-07-26
- Owners: ethicnology
- Applies to: `skills/decoupage-livraison/SKILL.md`

## Problem

Writing code is not the bottleneck; reviewing it is. A branch that mixes
refactoring with a behavior change, or a migration bundled with unrelated
cleanup, forces a reviewer to either reconstruct the author's context from
scratch or approve without really reading it. Left to its own judgment, an
agent tends to produce one commit per session rather than one commit per
reviewable idea.

## Decision

Ship a loaded-on-demand skill (`decoupage-livraison`, triggered by "PR",
"commits", "découper", "revue") encoding concrete, testable rules rather than
a vague size limit:

- Every commit must stand alone (tree builds, tests pass), have exactly one
  reason to exist, and be rejectable without forcing rejection of everything
  after it.
- Pure refactors are separated from behavior changes — the single highest-
  leverage rule, since a diff that both moves 400 lines and fixes a bug
  forces the reviewer to read all 400 lines to find the fix.
- Database migrations that aren't backward-compatible follow an
  expand/contract sequence (expand → dual-write if needed → backfill →
  switch → contract later), rather than a single "migration + model + code"
  commit — Git-level atomicity is not deployment-level atomicity, and a
  rolling deployment can straddle old and new code simultaneously.
- No absolute line-count threshold. Google's own published guidance (cited
  directly, not paraphrased from memory) says ~100 lines is reasonable, ~1000
  is almost always too large, and file count matters as much as line count —
  200 lines in one file review very differently from 200 lines spread across
  fifty files.

## Alternatives considered

### A hard line-count limit (e.g. "under 400 lines")

Rejected outright: this was an earlier, invented number with no source. When
actually checked against Google's `eng-practices` documentation, the real
guidance explicitly rejects a single hard threshold in favor of "one
self-contained change".

### "Migration and model must always ship together"

Rejected as an absolute rule after considering rolling deployments: it
conflates the atomicity of a single Git commit with the atomicity of a
deployment rollout, which are different problems. Replaced with the
expand/contract sequencing above.

### Enforcing this mechanically (CI line-count check, commit linter)

Not implemented. The rules here are heuristics about reviewability, which a
line-count linter cannot reliably capture (see the file-count vs line-count
point above). Left as agent/human judgment, loaded on demand rather than
baked into every turn's context.

## Consequences

Positive: an agent asked to plan multi-commit work has a concrete checklist
instead of ad hoc judgment, and the OpenCode `plan` agent's prompt explicitly
requires loading this skill before finishing a plan with more than one
commit.

Negative: nothing prevents an agent from ignoring the skill's guidance if it
isn't loaded — it's advisory, not a gate. There is no automated check in this
repo's own `tests/` that verifies a *given* PR actually follows these rules;
only that the skill file itself is well-formed and internally consistent.

## Evidence

- The Google Testing Blog / `eng-practices` "Small CLs" guidance was fetched
  and quoted directly, not reproduced from memory; several claims made in an
  earlier draft of this skill (a 400-line threshold, "always bundle
  migration+model", "unused abstractions are fine as prep work") were found
  to contradict that source and were corrected.
- `rebase.updateRefs`'s actual scope (moves local branches on a full-stack
  rebase from the top; does not touch remote refs or other worktrees) was
  verified against real disposable branch stacks, not assumed from the
  option's name.

## Revisit when

- A mechanical enforcement mechanism (CI-based diff shape linting) is judged
  worth building; until then this remains guidance, not a gate.
