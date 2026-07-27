# ADR-0009: Fall back to OpenAI on an Anthropic quota error

- Status: Proposed
- Date: 2026-07-27
- Owners: ethicnology
- Applies to: `opencode/plugins/anthropic-fallback.ts`

## Problem

Hitting the Anthropic subscription plan limit mid-session leaves OpenCode
waiting. The retry policy backs off using the server's `retry-after` header,
capped at `RETRY_MAX_DELAY` (~24 days), and has no maximum attempt count
(anomalyco/opencode#30510). In practice the session simply stops producing
output until the user notices, presses escape, and switches provider by hand.

The equivalent OpenAI models are configured and idle during that wait.

## Decision

A plugin records the last user message per session, and on an Anthropic quota
error aborts (best effort), reverts to that message, and replays it once on
the OpenAI counterpart for the same agent role.

Two runtime facts, both measured rather than inferred, determine how it is
wired:

1. **Capture must not depend on `input`.** In the `chat.message` hook,
   `agent`, `model` and `messageID` are all optional in the SDK type, and
   `messageID` is absent at runtime. Requiring it made the plugin a silent
   no-op. `output.message` carries `id`, `agent`, `model` and `sessionID` as
   required fields and is used as the source of truth.

2. **The trigger is `session.status`, not the message error.** A retryable
   rate limit is never persisted onto the assistant message. Upstream,
   `session/retry.ts` passes the quota text to `SessionStatus.set`, which
   publishes a `session.status` event of type `retry`. Because the retry loop
   is unbounded, that event repeats on every attempt, so a `recovering` guard
   bounds the switch to a single replay.

`"Overloaded"` (HTTP 529) is deliberately excluded from the quota patterns: it
is a transient server condition the runtime already retries, and burning
OpenAI quota on it would be wasteful.

## Alternatives considered

### Configure a provider-level fallback in OpenCode

Not available: per-provider fallback ordering is an open feature request
(anomalyco/opencode#32423), not a shipped capability.

### Instruct the agent to switch models via AGENTS.md

Rejected: a prompt rule is advisory, costs tokens every turn, and cannot fire
when the model itself is the thing being rate limited.

### Trigger on `message.updated` carrying the error

Implemented first, on the strength of the SDK type definitions alone, and
found to be wrong: exporting a session that had really been rate limited
showed only `MessageAbortedError` entries, all from manual cancellation. Kept
only as a defensive path for non-retryable errors, which publish no retry
status.

## Consequences

Positive: a plan limit costs one replay instead of a stalled session and a
manual provider switch.

Negative / known limits:

- The fallback table covers `analyse`, `plan`, `build` and `explore` only.
  Rate limits also occur on the `general` subagent and on the internal
  `title` / `summary` / `compaction` agents, which will not switch.
- Only text and file parts are replayed; other part types are dropped.
- The replay silently changes which model answered. The switch is logged at
  `warn` level under service `anthropic-fallback`, but the session itself
  carries no marker.
- OpenAI quota is consumed without asking.

## Evidence

- The `chat.message` shape was measured on a live 1.18.5 process, not read
  from types: a diagnostic logged `inputMessageID=false`,
  `messageMessageID=true`, `capture=true`, confirming both the defect and the
  fix. Verified in a fresh headless `opencode run` process, so plugin reload
  was genuine.
- The trigger path was read directly in upstream `session/retry.ts` and
  `session/status.ts` on branch `dev`: `retryable()` → `policy()` →
  `opts.set({ message })` → `SessionStatus.set` → published event.
- Log forensics on a real plan rate limit showed a single `stream error`, no
  persisted message error, then 77 seconds of silence ending in a manual
  cancel — consistent with a long `retry-after` backoff.
- Offline tests against the measured input shape cover: replay on a quota
  retry, no replay on `Overloaded`, and exactly one replay when the retry
  event repeats four times.

## Revisit when

- **The `session.status` trigger is observed on a real quota event.** It is
  currently supported by upstream source reading and offline tests, not by a
  live observation. Until then this record stays `Proposed`.
- OpenCode ships native provider fallback (#32423), which would make the
  plugin redundant.
- The retry loop gains a maximum attempt count (#30510), which would change
  how many times the trigger fires.
