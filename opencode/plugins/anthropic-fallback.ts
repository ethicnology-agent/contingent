import type { Plugin } from "@opencode-ai/plugin"

type Model = {
  providerID: string
  modelID: string
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

const fallbacks: Record<string, Model> = {
  analyse: { providerID: "openai", modelID: "gpt-5.6-sol" },
  plan: { providerID: "openai", modelID: "gpt-5.6-sol" },
  build: { providerID: "openai", modelID: "gpt-5.6-terra" },
  explore: { providerID: "openai", modelID: "gpt-5.4-mini" },
}

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
  const resultat: ReplayablePart[] = []
  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string") {
      resultat.push({ type: "text", text: part.text })
      continue
    }

    if (part.type === "file" && typeof part.url === "string" && typeof part.mime === "string") {
      resultat.push({
        type: "file",
        url: part.url,
        mime: part.mime,
        ...(typeof part.filename === "string" ? { filename: part.filename } : {}),
      })
    }
  }
  return resultat
}

// Replays the last user message once on an OpenAI equivalent after an Anthropic quota error.
export const AnthropicFallbackPlugin: Plugin = async ({ client, directory }) => {
  const requests = new Map<string, Request>()
  const recovering = new Set<string>()

  const exigerSucces = <T>(operation: string, response: T): T => {
    const error = (response as { error?: unknown })?.error
    if (error) throw new Error(`${operation}: ${JSON.stringify(error)}`)
    return response
  }

  const recover = async (sessionID: string) => {
    const request = requests.get(sessionID)
    if (!request || request.model.providerID !== "anthropic" || recovering.has(sessionID)) return

    const fallback = fallbacks[request.agent]
    const parts = replayableParts(request.parts)
    if (!fallback || parts.length === 0) return

    recovering.add(sessionID)
    try {
      exigerSucces("abort", await client.session.abort({
        path: { id: sessionID },
        query: { directory },
      }))
      exigerSucces("revert", await client.session.revert({
        path: { id: sessionID },
        query: { directory },
        body: { messageID: request.messageID },
      }))
      exigerSucces("promptAsync", await client.session.promptAsync({
        path: { id: sessionID },
        query: { directory },
        body: { agent: request.agent, model: fallback, parts },
      }))
      requests.delete(sessionID)
      await client.app.log({
        body: {
          service: "anthropic-fallback",
          level: "warn",
          message: "Anthropic quota reached; replayed the request with OpenAI.",
          extra: { sessionID, agent: request.agent, from: request.model, to: fallback },
        },
      })
    } catch (error) {
      await client.app.log({
        body: {
          service: "anthropic-fallback",
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
      if (!input.agent || !input.model || !input.messageID) return

      requests.set(input.sessionID, {
        agent: input.agent,
        messageID: input.messageID,
        model: input.model,
        parts: output.parts as Array<Record<string, unknown>>,
      })
    },
    event: async ({ event }) => {
      if (event.type === "session.error" && event.properties.sessionID && isQuotaError(event.properties.error)) {
        await recover(event.properties.sessionID)
      }

      if (event.type === "session.status" && event.properties.status.type === "retry") {
        if (retryMessageIsQuotaError(event.properties.status.message)) {
          await recover(event.properties.sessionID)
        }
      }

      if (event.type === "session.deleted") {
        requests.delete(event.properties.info.id)
        recovering.delete(event.properties.info.id)
      }
    },
  }
}
