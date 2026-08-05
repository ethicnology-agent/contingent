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
  Its configuration refers only to `PREM_API_KEY`; `CLIENT_KEK`, `PROXY_URL`,
  and `ENCLAVE_URL` remain environment variables. Start it with
  `confidential-proxy start --compat openai --kek "$CLIENT_KEK"`.
- `prem-router` talks to `https://router.prem.io/v1` using a distinct
  `PREM_ROUTER_API_KEY`. It currently provides `kimi-k3`, including tool calls,
  images and reasoning. This is ordinary TLS, not end-to-end confidential
  inference, so it is prohibited for private repository code.

Both use the documented `@ai-sdk/openai-compatible` adapter. The confidential
provider uses the documented 600-second request and 60-second stream-chunk
timeouts. API keys and KEKs are represented exclusively as `{env:...}`
references; no secret value is versioned.

## Consequences

Positive: the model picker makes the confidentiality boundary visible, and a
fresh clone receives the provider definitions without receiving credentials.

Negative: the confidential provider is unavailable until its local proxy has
started. Prem documents one active stream per confidential API key; do not use
it for parallel subagent work or concurrent requests can receive `429`.

## Evidence

- Prem's official OpenCode guide documents the local Confidential Proxy,
  OpenAI-compatible adapter, `--kek` startup flag, and timeout values.
- Prem's Router documentation identifies Kimi K3 capabilities and distinguishes
  Router from confidential inference.
- `opencode models prem` listed `prem/glm-5.2` and `prem/qwen36-27b`; `opencode
  models prem-router` listed `prem-router/kimi-k3` after the configuration was
  loaded.
- `tests/check-coherence.py` parsed and schema-validated the configuration.

## Revisit when

- A real confidential proxy request is tested end to end; then promote this ADR
  to Accepted if the documented behavior holds.
- Prem changes the endpoint contract, model capabilities, concurrency limits,
  or confidential-proxy CLI.
