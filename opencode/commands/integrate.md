---
description: Use Ines as the sole Git owner for explicitly requested commits, rebases, branch integration, or delivery preparation.
---

Use `PROFILE: integrate` for $ARGUMENTS. Delegate mutable Git work to exactly one
allowed worker and run no concurrent task that shares the repository index or
history. Inspect repository conventions and remote state first, optimize commit
history for review, preserve unrelated changes, finish or abort every rebase,
and never rewrite a published branch or push unless the user's authorization is
explicit.
