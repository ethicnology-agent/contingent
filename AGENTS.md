# Agent instructions for this repository

This file governs work **on** this repo (`contingent` itself). It is separate
from `opencode/AGENTS.md`, which is the config payload installed *into*
someone's OpenCode setup.

## Before modifying this repository

Do not infer the rationale for security, permission, Git, or notification
behavior from code alone. Read the relevant decision record first:

- OpenCode permission model: [docs/decisions/0002](docs/decisions/0002-opencode-permission-model.md)
- Untrusted repositories: [docs/decisions/0003](docs/decisions/0003-untrusted-repositories.md)
- SSH-agent / security-key proxy: [docs/decisions/0004](docs/decisions/0004-yubikey-agent-proxy.md)
- Desktop notifications (OSC 777): [docs/decisions/0005](docs/decisions/0005-warp-osc-notifications.md)
- Git history policy: [docs/decisions/0006](docs/decisions/0006-git-history-policy.md)
- Review-oriented delivery: [docs/decisions/0007](docs/decisions/0007-review-oriented-delivery.md)
- Dependency pinning: [docs/decisions/0008](docs/decisions/0008-supply-chain-pinning.md)
- Anthropic → OpenAI fallback: [docs/decisions/0009](docs/decisions/0009-anthropic-openai-fallback.md)
- rtk command rewriting: [docs/decisions/0010](docs/decisions/0010-rtk-command-rewriting.md)
- Machine-local instructions: [docs/decisions/0012](docs/decisions/0012-machine-local-instructions.md)

Load only the records relevant to the current task, not all of them.

## Non-negotiable invariants

- Never commit secrets, tokens, private keys, or machine-specific identity
  (Git name/email/signing key). These belong on the installing machine, not
  in this repo — see the README's "What's deliberately NOT in here".
- Never claim an installer or automation exists unless it has actually been
  built and tested in this repo. There is currently no `bootstrap` script —
  say so if asked, don't improvise one silently.
- In `bin/yknotify-agent`: never let context extraction (reading `.git`,
  `HEAD`, `COMMIT_EDITMSG`) block or delay forwarding a `SIGN_REQUEST` to the
  upstream agent. A blocked filesystem must never delay a signature.
- Never weaken `plan` or `explore*` agent permissions in `opencode/opencode.jsonc`
  without updating [0002](docs/decisions/0002-opencode-permission-model.md).
- Never rewrite shared Git history without coordination and
  `--force-with-lease`, never bare `--force`.
- Distinguish measured behavior from assumptions, and say so explicitly. This
  repo's own `opencode/AGENTS.md` states this rule for a reason: an earlier
  audit pass found real bugs (a wrong Git version claim, a race condition, a
  dead permission hook) purely by testing instead of reasoning from the code.

## Making a change

1. If the change touches trust boundaries, permissions, the SSH-agent proxy's
   invariants, supported platforms, or the Git/review policy: update or add
   an ADR in `docs/decisions/` in the same change. Status is `Proposed` until
   verified, `Accepted` once tested.
2. Run `tests/check-coherence.py` and, for plugin changes,
   `cd opencode && npm run typecheck`.
3. For anything beyond a trivial fix, load the skill `decoupage-livraison`
   before deciding how to split commits.

## Preserve the problem, not necessarily the implementation

If a simpler mechanism preserves the same verified guarantees as an existing
one, propose replacing the implementation — after updating the relevant ADR,
not instead of it. Nothing here is sacred except the invariants above.
