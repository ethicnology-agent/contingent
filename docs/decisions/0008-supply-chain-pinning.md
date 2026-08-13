# ADR-0008: Pin plugin and SDK versions; typecheck before shipping

- Status: Accepted
- Date: 2026-07-26
- Owners: ethicnology
- Applies to: `opencode/opencode.jsonc`, `opencode/package.json`,
  `opencode/package-lock.json`

## Problem

`opencode/opencode.jsonc` loads `@ex-machina/opencode-anthropic-auth`, a
third-party plugin that manipulates OAuth tokens and rewrites outgoing
requests. Left unpinned (`"plugin": ["@ex-machina/opencode-anthropic-auth"]`),
OpenCode resolves and runs whatever version is latest on npm *at every
startup* — including a version published after a package-maintainer account
compromise. The plugin's own README independently warns that unpinned use is
a "massive vulnerability". Separately, the local `@opencode-ai/plugin`/`sdk`
type packages had drifted to `1.18.1` while the actual OpenCode binary in use
was `1.18.5`, and one fallback model reference (`gpt-5.4-mini-fast`) turned
out not to exist in the upstream model catalog at all — a config that looked
fine string-wise but would fail at the first real fallback attempt.

## Decision

- Pin the Anthropic auth plugin to an explicit, reviewed version:
  `@ex-machina/opencode-anthropic-auth@1.8.1`.
- Keep `@opencode-ai/plugin` aligned to the actual installed OpenCode version,
  bumped deliberately in its own commit, not silently. It is declared under
  `dependencies` because the plugins import its types directly;
  `@opencode-ai/sdk` is not a direct entry at all — it arrives as a dependency
  of `@opencode-ai/plugin` and is pinned transitively by the lockfile, which
  is why the lockfile is the thing that actually has to be committed.
- Commit `package.json` **and** `package-lock.json` to this repo (an earlier
  `.gitignore` excluded both, which would have left a fresh clone with no
  way to reproducibly restore plugin types).
- Require `npm run typecheck` (`tsc --noEmit` against a pinned TypeScript
  version) to pass before any plugin change ships — not just `esbuild`
  syntax-only validation, which does not catch missing Node type
  declarations or unsound union types.

## Alternatives considered

### Trust `latest` for convenience

Rejected: the plugin author's own documentation flags this as dangerous, and
it silently breaks reproducibility between machines installed at different
times.

### Syntax-only validation (`esbuild`) as the only gate

Used as a fast first pass, but proven insufficient on its own: a first real
`tsc` run caught a missing Node type environment (`process`, `Buffer` not
declared) and an unsound array-union type in `anthropic-fallback.ts` that
`esbuild` had accepted without complaint.

### Not committing `package-lock.json` (keep it generated)

Rejected: without it, a fresh install of `@opencode-ai/plugin@1.18.5`'s
transitive dependencies (`effect`, `zod`, `msgpackr`, ...) is not guaranteed
reproducible across machines or time, defeating the point of pinning at all.

## Consequences

Positive: a fresh clone gets the exact same plugin behavior, on any machine,
until a version bump is made and reviewed deliberately. Plugin authors get
real type errors before a broken plugin reaches a running OpenCode session.

Negative:

- Version bumps are now a manual, deliberate action (a good thing for
  security, a small amount of extra maintenance).
- `node` is required for `typecheck`, even though OpenCode itself can run
  plugins without a local Node install at all — this is purely a
  development-time requirement, not a runtime one. A standalone `npm` is *not*
  required: `corepack` provisions the exact `npm` named in `packageManager`,
  so `corepack npm ci` and `corepack npm run typecheck` work on a machine with
  no `npm` on `PATH`. Measured on a machine where `npm`, `npx`, `pnpm`, `yarn`
  and `bun` were all absent and only `corepack` and `node` were present.
- The declared `engines.node` (`>= 22.22.2`, inherited from a transitive
  dependency) is stricter than what `typecheck` actually needs: it passes on
  node 20.19.2, with `EBADENGINE` warnings during install. Treat the warnings
  as a signal to upgrade, not as a failed gate.

## Evidence

- The exact npm registry metadata for
  `@opencode-ai/plugin@1.18.5`/`@opencode-ai/sdk@1.18.5` (dependency graph,
  integrity hashes) was fetched directly from `registry.npmjs.org`, not
  guessed, and used to hand-align `package-lock.json` before confirming with
  a real `npm install --ignore-scripts`.
- `openai/gpt-5.4-mini-fast` was confirmed absent from the live Models.dev
  catalog by fetching its actual model-schema enum; the correct identifier
  (`openai/gpt-5.4-mini`, with `-fast` actually being a separate `variant`
  field) was found the same way and applied everywhere it was referenced
  (main config and the fallback plugin, which still had the old value after
  the main config was fixed).
- `npm run typecheck` was run for real against the pinned TypeScript version
  and passed after fixing the type issues above; this is re-runnable from
  `opencode/` in this repo.
- **The drift this ADR exists to prevent recurred and was caught by audit, not
  by tooling.** The pin sat at `1.18.5` while the installed binary had moved to
  `1.18.7` — the same failure mode as the original `1.18.1` vs `1.18.5` gap.
  Realigning it was verified end to end: `corepack npm install` regenerated the
  lockfile to `1.18.7` for both `@opencode-ai/plugin` and its transitive
  `@opencode-ai/sdk`, a `rm -rf node_modules` followed by `corepack npm ci`
  restored the tree reproducibly from that lockfile, and `typecheck` passed at
  each step. `tests/check-coherence.py` now compares the pin against
  `opencode --version` so the next drift fails a check instead of waiting for
  a reader.
- The pin was subsequently realigned from `1.18.16` to the installed OpenCode
  `1.18.18` while adding a typed local tool. `npm install --ignore-scripts`
  updated both plugin and SDK lock entries, `npm run typecheck` passed, and the
  coherence check confirmed the binary/package versions match.
- `opencode.jsonc` was validated against the officially published JSON Schema
  (`https://opencode.ai/config.json`) after every change, not just visually
  inspected.

## Revisit when

- Bumping OpenCode itself: `@opencode-ai/plugin`/`sdk` dev-dependency
  versions should move in the same commit, and `npm run typecheck` re-run
  before merging.
- Bumping `@ex-machina/opencode-anthropic-auth`: review the diff between
  versions before pinning to a new one; never move to `latest`.
