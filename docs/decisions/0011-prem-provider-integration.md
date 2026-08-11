# ADR-0011: Separate Prem confidential inference from Prem Router

- Status: Proposed
- Date: 2026-08-05
- Owners: ethicnology
- Applies to: `opencode/opencode.jsonc`, `README.md`

## Problem

OpenCode needs explicit provider definitions for the available Prem models.
Prem exposes two paths with very different trust properties. Treating them as
interchangeable would make it easy to send private repository code to the
ordinary Router by mistake. Credentials and the client KEK must also remain
machine-local rather than entering the portable configuration repository.

## Decision

Keep two providers in `opencode/opencode.jsonc`:

- `prem` talks only to the local OpenAI-compatible Confidential Proxy at
  `127.0.0.1:8787`. The proxy encrypts requests for Prem's confidential API.
  OpenCode reads its API key from `~/.secrets/prem-api-key`; the proxy receives
  the same key and the client KEK directly from machine-local files when it is
  started. Neither secret needs to remain in the OpenCode or shell environment.
- `prem-router` talks to `https://router.prem.io/v1` using a distinct
  key from `~/.secrets/prem-router-api-key`. It currently provides `kimi-k3`,
  including tool calls, images and reasoning. This is ordinary TLS, not
  end-to-end confidential inference.

Both use the documented `@ai-sdk/openai-compatible` adapter. The confidential
provider uses the documented 600-second request and 60-second stream-chunk
timeouts. Secret paths use `{file:...}` interpolation; no secret value is
versioned or exported to every agent-launched shell command.

Kimi remains the default agent by explicit operator choice because latency is
preferred for routine work. This accepts that a first turn with the default
agent sends prompts and project instructions to Prem Router in plaintext. For
a private repository, select GPT or Opus before the first turn. Commands do not
force Kimi: `/security-audit` follows the active agent so an explicit switch is
not silently undone.

## Consequences

Positive: the model picker makes the confidentiality boundary visible, and a
fresh clone receives the provider definitions without receiving credentials.

Negative: the confidential provider is unavailable until its local proxy has
started. Prem documents one active stream per confidential API key; do not use
it for parallel subagent work or concurrent requests can receive `429`.
The default Kimi route is deliberately not confidential; model selection is the
operator's trust-boundary decision.

## Evidence

- Prem's official OpenCode guide documents the local Confidential Proxy,
  OpenAI-compatible adapter, `--kek` startup flag, and timeout values.
- Prem's Router documentation identifies Kimi K3 capabilities and distinguishes
  Router from confidential inference.
- `opencode models prem` listed `prem/glm-5.2` and `prem/qwen36-27b`; `opencode
  models prem-router` listed `prem-router/kimi-k3` after the configuration was
  loaded.
- `tests/check-coherence.py` parsed and schema-validated the configuration.
- `~/.secrets/*` is denied by the effective `external_directory` permission
  rules. Provider `{file:...}` interpolation happens during config loading and
  is not an agent tool read.

## Revisit when

- A real confidential proxy request is tested end to end; then promote this ADR
  to Accepted if the documented behavior holds.
- Prem changes the endpoint contract, model capabilities, concurrency limits,
  or confidential-proxy CLI.
