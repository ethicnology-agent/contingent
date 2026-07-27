# ADR-0006: Fixup and amend instead of "fix typo" commits

- Status: Accepted
- Date: 2026-07-26
- Owners: ethicnology
- Applies to: `git/agentic.gitconfig`, `opencode/AGENTS.md`

## Problem

Agents (and humans) that notice they forgot something in a not-yet-merged
branch tend to add a new commit: "fix typo", "oops", "address review". This
multiplies noise, breaks `git bisect`, and makes commit-by-commit review
meaningless — none of these commits are independently reviewable, which
directly contradicts ADR-0007's review-oriented delivery goal.

## Decision

Configure Git so that fixing an earlier, unmerged commit is as easy as adding
a new one, and document the two-command flow:

```bash
git amend                  # alias: commit --amend --no-edit
git fixup <sha>             # alias: commit --fixup
git ri <base>                # alias: rebase --autosquash
```

```ini
[rebase]
    autosquash = true
    autostash = true
    updateRefs = true
[rerere]
    enabled = true
    autoupdate = false
```

`rerere.autoupdate` is deliberately `false`: `rerere` remembers a conflict
resolution and re-applies it to the working tree, but does **not** stage it
automatically. A resolution reapplied blindly, without review, would let a
past mistake silently repeat. Requiring the user (or agent) to look before
`git add` is the point.

## Alternatives considered

### `git rebase -i --autosquash`

This is what most tutorials show, and it's wrong for an agent-driven flow:
it opens an interactive editor. Rejected in favor of `rebase --autosquash`
without `-i`, which is fully non-interactive.

### Letting agents freely amend/rebase shared branches

Rejected. `opencode/AGENTS.md` explicitly requires coordination and
`--force-with-lease` (never bare `--force`) before rewriting history that has
already been pushed and might be relied on by someone else.

## Consequences

Positive: an agent can absorb its own oversight into the right commit without
opening an editor, and without manual `git rebase -i` babysitting.

Negative:

- `pull.rebase=true` rewrites local commits on every `git pull`; combined
  with `rebase.autostash`, an autostash reapplied after a rebase can itself
  produce a conflict — a clean working tree before/after history operations
  should be verified, not assumed.
- A rebase that hits a real conflict still stops mid-flight. The repo's rule
  is explicit: never leave it there, resolve then `--continue`, or `--abort`,
  never `git commit` while a rebase is in progress.
- Every resigned commit re-triggers the signing key if commits are GPG/SSH
  signed (see the security-key notification in ADR-0004) — an autosquash
  across N commits can mean N touches, not one.

## Evidence

All of the following were tested against disposable repositories, not assumed
from documentation alone:

- `git rebase --autosquash <base>` (no `-i`) absorbs a `fixup!` commit with
  **zero** editor invocations, confirmed by making both `$GIT_EDITOR` and
  `$GIT_SEQUENCE_EDITOR` fail loudly if called — neither was called. This
  behavior requires **Git ≥ 2.44** (a first draft of this policy incorrectly
  cited 2.38, which only introduced `rebase.updateRefs`; corrected after
  testing on the actual installed Git 2.47.3).
- `rebase.updateRefs` does move local branches that point at rewritten
  commits, but **only** when the rebase is launched from the top of a stack
  and spans the full commit range — a naive test rebasing from the middle of
  a three-branch stack initially showed no effect until re-run correctly from
  the base.
- `git pull` (with `pull.rebase=true` and `rebase.autosquash=true` both set)
  does **not** silently autosquash a pending fixup commit against an
  unrelated incoming commit — tested with a real remote, a pending fixup, and
  a colleague's simulated concurrent push.
- The simple git alias forms (`fixup = commit --fixup`, not a shell function)
  correctly forward extra arguments like `--no-verify`; an earlier shell
  function only passed the first argument and silently dropped the rest.

## Revisit when

- The minimum supported Git version drops below 2.44, which would break the
  non-interactive autosquash guarantee this policy relies on.
