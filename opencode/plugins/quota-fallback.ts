import type { Plugin } from "@opencode-ai/plugin"

// Replay the last user message on the counterpart contingent after a confirmed
// OpenAI or Anthropic quota error.
//
// Two observations measured on OpenCode 1.18.5 govern this file; see
// docs/decisions/0009 for the evidence.
//
// 1. `input.messageID` from the `chat.message` hook is optional in the SDK and
//    absent at runtime. Requiring it leaves `requests` permanently empty and
//    turns the plugin into a silent no-op. `output.message` is authoritative;
//    its `id`, `agent`, `model`, and `sessionID` fields are required.
//
// 2. A retryable rate limit does not persist an error on the assistant message.
//    Upstream, `session/retry.ts` calls `SessionStatus.set`, which publishes a
//    `retry` session status carrying the quota message. That is the primary
//    trigger. Because the retry loops indefinitely (anomalyco/opencode#30510),
//    `recovering` and `attempted` bound concurrency and failovers per request.

type Model = {
  providerID: string
  modelID: string
}

type Fallback = {
  agent: string
  model: Model
}

type Request = {
  agent: string
  messageID: string
  model: Model
  parts: Array<Record<string, unknown>>
}

type ReplayablePart =
  | { type: "text"; text: string }
  | { type: "file"; url: string; mime: string; filename?: string }

const fallbacks: Record<string, Fallback> = {
  codex: {
    agent: "claude",
    model: { providerID: "anthropic", modelID: "claude-opus-5" },
  },
  claude: {
    agent: "codex",
    model: { providerID: "openai", modelID: "gpt-5.6-sol" },
  },
  "analyst-openai": {
    agent: "analyst-anthropic",
    model: { providerID: "anthropic", modelID: "claude-sonnet-5" },
  },
  "analyst-anthropic": {
    agent: "analyst-openai",
    model: { providerID: "openai", modelID: "gpt-5.6-luna" },
  },
  "worker-openai": {
    agent: "worker-anthropic",
    model: { providerID: "anthropic", modelID: "claude-sonnet-5" },
  },
  "worker-anthropic": {
    agent: "worker-openai",
    model: { providerID: "openai", modelID: "gpt-5.6-luna" },
  },
}

// "Overloaded" is deliberately absent: it is a transient 529 already retried
// by the runtime, and switching providers for it would waste fallback quota.
const quotaPatterns = [
  "rate limit",
  "usage limit",
  "quota exceeded",
  "usage exceeded",
  "too many requests",
]

const isQuotaError = (error: unknown) => {
  const data = (error as { data?: { message?: unknown; statusCode?: unknown } })?.data
  if (data?.statusCode === 429) return true

  const message = String(data?.message ?? error ?? "").toLowerCase()
  return quotaPatterns.some((pattern) => message.includes(pattern))
}

const retryMessageIsQuotaError = (message: string) => {
  const normalized = message.toLowerCase()
  return quotaPatterns.some((pattern) => normalized.includes(pattern))
}

const replayableParts = (parts: Array<Record<string, unknown>>): ReplayablePart[] => {
  const result: ReplayablePart[] = []
  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string") {
      result.push({ type: "text", text: part.text })
      continue
    }

    if (part.type === "file" && typeof part.url === "string" && typeof part.mime === "string") {
      result.push({
        type: "file",
        url: part.url,
        mime: part.mime,
        ...(typeof part.filename === "string" ? { filename: part.filename } : {}),
      })
    }
  }
  return result
}

export const QuotaFallbackPlugin: Plugin = async ({ client, directory }) => {
  const requests = new Map<string, Request>()
  const recovering = new Set<string>()
  const attempted = new Set<string>()

  const requireSuccess = <T>(operation: string, response: T): T => {
    const error = (response as { error?: unknown })?.error
    if (error) throw new Error(`${operation}: ${JSON.stringify(error)}`)
    return response
  }

  const recover = async (sessionID: string) => {
    const request = requests.get(sessionID)
    if (
      !request ||
      recovering.has(sessionID) ||
      attempted.has(sessionID)
    ) return

    const fallback = fallbacks[request.agent]
    const parts = replayableParts(request.parts)
    if (
      !fallback ||
      fallback.model.providerID === request.model.providerID ||
      parts.length === 0
    ) return

    recovering.add(sessionID)
    attempted.add(sessionID)
    try {
      // A failed request is usually no longer active, so abort may legitimately
      // fail. It still protects against a race but must not block the replay.
      try {
        await client.session.abort({
          path: { id: sessionID },
          query: { directory },
        })
      } catch {
        // Best effort only; see the comment above.
      }
      requireSuccess("revert", await client.session.revert({
        path: { id: sessionID },
        query: { directory },
        body: { messageID: request.messageID },
      }))
      requireSuccess("promptAsync", await client.session.promptAsync({
        path: { id: sessionID },
        query: { directory },
        body: { agent: fallback.agent, model: fallback.model, parts },
      }))
      requests.delete(sessionID)
      try {
        await client.tui.showToast({
          query: { directory },
          body: {
            title: "Quota fallback",
            message: `${request.agent} reached its quota; continuing with ${fallback.agent}.`,
            variant: "warning",
            duration: 8000,
          },
        })
      } catch {
        // Headless clients have no TUI; the structured log below remains.
      }
      await client.app.log({
        body: {
          service: "quota-fallback",
          level: "warn",
          message: "Provider quota reached; replayed the request with the counterpart contingent.",
          extra: {
            sessionID,
            fromAgent: request.agent,
            toAgent: fallback.agent,
            fromModel: request.model,
            toModel: fallback.model,
          },
        },
      })
    } catch (error) {
      await client.app.log({
        body: {
          service: "quota-fallback",
          level: "error",
          message: "Could not replay the request with the fallback model.",
          extra: { sessionID, error: String(error) },
        },
      })
    } finally {
      recovering.delete(sessionID)
    }
  }

  return {
    "chat.message": async (input, output) => {
      // Observation 1: never depend on optional `input` fields.
      const message = output.message
      const agent = input.agent ?? message?.agent
      const model = input.model ?? message?.model
      const messageID = input.messageID ?? message?.id
      const sessionID = input.sessionID ?? message?.sessionID

      if (!agent || !model || !messageID || !sessionID) return

      // A new user request gets one fresh recovery attempt. A replay enters
      // this hook while `recovering` is set and must not reset the guard, or a
      // second provider failure could ping-pong indefinitely.
      if (!recovering.has(sessionID)) attempted.delete(sessionID)

      requests.set(sessionID, {
        agent,
        messageID,
        model,
        parts: output.parts as Array<Record<string, unknown>>,
      })
    },

    event: async ({ event }) => {
      // Observation 2: primary trigger.
      if (event.type === "session.status" && event.properties.status.type === "retry") {
        if (retryMessageIsQuotaError(event.properties.status.message)) {
          await recover(event.properties.sessionID)
        }
        return
      }

      // Defensive paths for non-retryable failures that publish no retry status.
      // They have only been tested offline, not observed live on this runtime.
      if (event.type === "session.error" && event.properties.sessionID && isQuotaError(event.properties.error)) {
        await recover(event.properties.sessionID)
        return
      }

      if (
        event.type === "message.updated" &&
        event.properties.info.role === "assistant" &&
        isQuotaError(event.properties.info.error)
      ) {
        await recover(event.properties.info.sessionID)
        return
      }

      if (
        event.type === "session.idle" ||
        (event.type === "session.status" && event.properties.status.type === "idle")
      ) {
        requests.delete(event.properties.sessionID)
        attempted.delete(event.properties.sessionID)
        return
      }

      if (event.type === "session.deleted") {
        requests.delete(event.properties.info.id)
        recovering.delete(event.properties.info.id)
        attempted.delete(event.properties.info.id)
      }
    },
  }
}
