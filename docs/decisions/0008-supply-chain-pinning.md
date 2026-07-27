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
- Keep `@opencode-ai/plugin`/`@opencode-ai/sdk` (dev dependencies used only
  for typechecking plugins locally) aligned to the actual installed OpenCode
  version (`1.18.5`), bumped deliberately in its own commit, not silently.
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
- `npm`/`node` (≥ 22.22.2 for the packages actually used here) are required
  for `typecheck`, even though OpenCode itself can run plugins without a
  local Node/npm install at all — this is purely a development-time
  requirement, not a runtime one.

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
- `opencode.jsonc` was validated against the officially published JSON Schema
  (`https://opencode.ai/config.json`) after every change, not just visually
  inspected.

## Revisit when

- Bumping OpenCode itself: `@opencode-ai/plugin`/`sdk` dev-dependency
  versions should move in the same commit, and `npm run typecheck` re-run
  before merging.
- Bumping `@ex-machina/opencode-anthropic-auth`: review the diff between
  versions before pinning to a new one; never move to `latest`.
