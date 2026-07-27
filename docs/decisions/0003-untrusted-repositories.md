# ADR-0003: How to open a repository you don't trust

- Status: Accepted (documented OpenCode behavior; see Evidence for what was
  and wasn't independently re-run in this repo)
- Date: 2026-07-26
- Owners: ethicnology
- Applies to: anyone using this config to open a third-party repository

## Problem

OpenCode project configs (`.opencode/opencode.json`, `.opencode/plugins/*.ts`)
are merged on top of the global config, and project plugins are auto-loaded.
Plugins execute inside the OpenCode process itself, entirely outside the tool
permission model from ADR-0002. Opening an unfamiliar repository with default
settings means its `.opencode/plugins/evil.ts` runs with full process access
— filesystem, network, environment — regardless of how tightly `bash`/`edit`
are locked down globally.

## Decision

Never open an unreviewed repository with its project config and plugins
active. Use OpenCode's own escape hatches:

```bash
# Keep this repo's global plugins (yknotify, rtk, anthropic-fallback),
# but skip the *project's* opencode.json/plugins entirely.
OPENCODE_DISABLE_PROJECT_CONFIG=1 opencode

# Hostile repo: also skip the global plugins.
OPENCODE_PURE=1 OPENCODE_DISABLE_PROJECT_CONFIG=1 opencode
```

`opencode/AGENTS.md` states this as a standing rule so an agent working
inside a session is reminded not to casually `cd` into and fully trust an
unrelated checkout.

## Alternatives considered

### Manually reading every project's `.opencode/` before opening it

Doesn't scale, and doesn't protect against a plugin added *after* first
review (a subsequent `git pull` inside that project could reintroduce one).

### Running OpenCode itself inside a container/VM for untrusted repos

Stronger isolation, genuinely better for high-risk cases, but heavier than
needed for "let me just look at this PR". Not exclusive with the flags above:
combine them if the repo is actively hostile, not merely unfamiliar.

## Consequences

Positive: a one-line env-var prefix removes the main OpenCode-specific attack
surface (project plugins) without disabling OpenCode entirely.

Negative: `OPENCODE_PURE=1` also disables this repo's own global plugins
(`yknotify`, `rtk`, `anthropic-fallback`) — you lose YubiKey-context
notifications and the Anthropic quota fallback for that session. The
underlying SSH-agent proxy (`bin/yknotify-agent`) is unaffected since it's
started by the shell, not by OpenCode.

## Evidence

- OpenCode's documented config precedence and plugin auto-discovery
  (`.opencode/plugins/*.{ts,js}` loaded with no config entry needed) were
  read directly from the published docs and the installed
  `@opencode-ai/plugin`/`@opencode-ai/sdk` sources at `1.18.5`.
- The behavior table (which flag disables which plugin class) was verified
  against documented semantics of `OPENCODE_DISABLE_PROJECT_CONFIG` and
  `OPENCODE_PURE`. Actually launching OpenCode against a deliberately hostile
  fixture repo with each flag combination was **not** performed in this repo;
  treat the exact flag behavior as documented-and-reasoned, not
  empirically re-verified here.

## Revisit when

- OpenCode adds a first-class "restricted mode" for plugin execution
  (e.g. running plugins out-of-process), which would remove the need for
  these flags entirely.
