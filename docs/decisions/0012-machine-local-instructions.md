# ADR-0012: Machine-local agent instructions outside the repository

- Status: Accepted
- Date: 2026-08-06
- Owners: ethicnology
- Applies to: `opencode/opencode.jsonc`, `opencode/AGENTS.md`, `.gitignore`

## Problem

`~/.config/opencode` is a symlink to this repository's `opencode/` directory,
so `opencode/AGENTS.md` is simultaneously the portable, published instruction
file *and* the only place to put an instruction the running agent will read.

That collision has a failure mode that already happened: a block describing
this machine's SSH access — hostname, port, user, `ProxyJump`, reverse-forward
ports — was written straight into `opencode/AGENTS.md`, because that is where
the agent reads. It sat in the working tree ready to be committed, which the
README's "What's deliberately NOT in here" and this repo's own invariants
forbid. Nothing in the tooling would have objected.

Genericising every such instruction is not an answer either. "Don't replace the
reverse-forwards with wireless debugging" is portable advice; the actual host,
ports and user are what make it actionable, and they are exactly the part that
must not be published.

## Decision

Split the two roles across two files:

- `opencode/AGENTS.md` — versioned, portable. Carries the *constraint* and no
  machine-specific value.
- `opencode/AGENTS.local.md` — never committed, listed in `.gitignore`. Carries
  hostnames, ports, users, forwards, and anything else identifying this
  machine. Loaded via `"instructions": ["AGENTS.local.md"]` in
  `opencode/opencode.jsonc`, whose paths resolve relative to the declaring
  config.

The *pointer* is public and versioned; the *content* is local. A reader of the
repository learns that the mechanism exists without learning anyone's topology.

## Consequences

Positive: there is now a correct destination for machine-specific instructions,
so the tempting-but-wrong one is no longer the only option. The rule in the
README stops being a rule with nowhere to comply.

Negative:

- Nothing *enforces* the split. An instruction can still be written into the
  wrong file; this ADR and the README are the only guard. A pre-commit hook
  scanning for host patterns was considered and not built — it would be a
  guess at what counts as private, and this repo does not ship untested
  automation.
- `AGENTS.local.md` is unversioned by construction, so it is not backed up by
  cloning the repository and is lost with the machine.
- Being invisible to a reviewer, its content is never reviewed. It must stay
  short and factual, not accumulate policy.

## Evidence

- With `instructions: ["AGENTS.local.md"]` pointing at a **nonexistent** file,
  `opencode run` in a throwaway directory started and completed a turn
  normally, exit code 0. A fresh clone therefore does not need to create the
  file, and the missing-file case is not an error path.
- `git grep` over `HEAD` and `git log -S` over all refs for `ProxyJump` and the
  VM hostname returned nothing, confirming the block that prompted this ADR
  never entered history and only ever existed in the working tree.
- `tests/check-coherence.py` reads every `*.md` under the repository root for
  its relative-link check, so an uncommitted `AGENTS.local.md` is scanned
  locally but has no committed links to resolve.

## Revisit when

- OpenCode gains a first-class machine-local instruction scope, making the
  `instructions` indirection unnecessary.
- A tested secret/topology scanner exists that could enforce the split instead
  of documenting it.
