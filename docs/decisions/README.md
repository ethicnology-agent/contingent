# Decision records

Each file here is an Architecture Decision Record (ADR): the problem it
solves, the decision, the alternatives rejected and why, and — critically —
what was actually verified versus what remains assumed.

`0001` is reserved for a future transactional bootstrap/release mechanism.
It doesn't exist yet: today's install is the manual symlink procedure in the
[README](../../README.md#manual-install). Don't write an ADR claiming a
bootstrap script works until one has actually been built and tested.

| ADR | Decision |
|---|---|
| [0002](0002-opencode-permission-model.md) | OpenCode permission model, per agent role |
| [0003](0003-untrusted-repositories.md) | How to open untrusted repositories |
| [0004](0004-yubikey-agent-proxy.md) | SSH-agent proxy for security-key notification context |
| [0005](0005-warp-osc-notifications.md) | OSC 777 desktop notifications via Warp |
| [0006](0006-git-history-policy.md) | Fixup/amend history policy |
| [0007](0007-review-oriented-delivery.md) | Review-oriented commit and PR slicing |
| [0008](0008-supply-chain-pinning.md) | Pinning plugin and dependency versions |

## Status values

- **Proposed** — decided, not yet verified in practice.
- **Accepted** — verified by the evidence listed in the record.
- **Superseded** — replaced by a later ADR, kept for history.

## When to add or update one

A change to trust boundaries, permissions, the SSH-agent proxy's invariants,
supported platforms, dependency pinning policy, or Git/review policy requires
touching the relevant ADR in the same change. See the repo's root
[AGENTS.md](../../AGENTS.md).
