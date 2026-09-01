# ADR-0015: Separate agent commit identity and GitHub transport

- Status: Accepted
- Date: 2026-09-02
- Owners: ethicnology
- Applies to: `opencode/plugins/git-identity.ts`, `opencode/AGENTS.md`

## Problem

An agent must leave an auditable author/committer distinction without inheriting the human's signing defaults, and must not use the human's SSH key when accessing GitHub. Git accepts both SCP-style URLs (`git@github.com:owner/repo.git`) and explicit SSH URLs (`ssh://git@github.com/owner/repo.git`); protecting only one form leaves a transport bypass.

## Decision

The agent shell environment sets the accountable human as the author and the dedicated agent identity as the committer. Commits are unsigned by default, while an explicit `git -c commit.gpgsign=true` remains the documented opt-in. The plugin adds Git `url.https://github.com/.insteadOf` rules for both GitHub SSH URL forms, and uses the GitHub credential helper for the agent token. The human's terminal is not affected by these shell-local overrides.

## Consequences

Agent GitHub traffic uses HTTPS regardless of whether a remote was written in SCP or explicit SSH syntax, so it cannot silently select the human SSH identity. The token and local author configuration remain machine-local and are not stored in this repository.

## Evidence

`opencode/plugins/git-identity.test.mjs` runs real `git ls-remote` resolution with tracing enabled and verifies that both URL forms invoke the HTTPS transport. The repository coherence checks pass; the requested TypeScript check could not run because the checkout has no installed `tsc` binary.
