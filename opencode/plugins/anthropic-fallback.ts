import type { Plugin } from "@opencode-ai/plugin"

// Rejoue le dernier message utilisateur sur un equivalent OpenAI apres une
// erreur de quota Anthropic.
//
// Deux constats mesures sur opencode 1.18.5 gouvernent ce fichier — voir
// docs/decisions/0009 pour la demarche et les preuves.
//
// 1. `input.messageID` du hook `chat.message` est optionnel dans le SDK, et
//    ABSENT a l'execution. Un garde qui l'exige laisse la map `requests` vide
//    en permanence, et le plugin devient un no-op silencieux. La source fiable
//    est `output.message`, dont `id`, `agent`, `model` et `sessionID` sont des
//    champs obligatoires.
//
// 2. Un rate limit retryable ne produit pas d'erreur persistee sur le message
//    assistant. En amont, `session/retry.ts` appelle `SessionStatus.set`, qui
//    publie un `session.status` de type `retry` portant le message de quota :
//    c'est le declencheur principal. Comme ce retry boucle sans limite
//    (anomalyco/opencode#30510), l'evenement est republie a chaque tentative,
//    d'ou les gardes `recovering` et `attempted` qui bornent respectivement la
//    concurrence et le nombre de bascules par requete.

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
  opus: { providerID: "openai", modelID: "gpt-5.6-sol" },
  plan: { providerID: "openai", modelID: "gpt-5.6-sol" },
  explore: { providerID: "openai", modelID: "gpt-5.6-luna" },
  "worker-anthropic": { providerID: "openai", modelID: "gpt-5.6-luna" },
}

// "Overloaded" est volontairement absent : c'est un 529 transitoire que le
// runtime reessaie deja, et basculer dessus gaspillerait le quota OpenAI.
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

export const AnthropicFallbackPlugin: Plugin = async ({ client, directory }) => {
  const requests = new Map<string, Request>()
  const recovering = new Set<string>()
  const attempted = new Set<string>()

  const exigerSucces = <T>(operation: string, response: T): T => {
    const error = (response as { error?: unknown })?.error
    if (error) throw new Error(`${operation}: ${JSON.stringify(error)}`)
    return response
  }

  const recover = async (sessionID: string) => {
    const request = requests.get(sessionID)
    if (
      !request ||
      request.model.providerID !== "anthropic" ||
      recovering.has(sessionID) ||
      attempted.has(sessionID)
    ) return

    const fallback = fallbacks[request.agent]
    const parts = replayableParts(request.parts)
    if (!fallback || parts.length === 0) return

    recovering.add(sessionID)
    attempted.add(sessionID)
    try {
      // Une requete qui vient d'echouer n'est generalement plus active, donc
      // `abort` peut legitimement retourner une erreur. Il reste utile contre
      // une course, mais ne doit jamais empecher le revert et le replay.
      try {
        await client.session.abort({
          path: { id: sessionID },
          query: { directory },
        })
      } catch {
        // Best effort seulement : voir le commentaire ci-dessus.
      }
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
      // Constat 1 : ne jamais dependre des champs optionnels de `input`.
      const message = output.message
      const agent = input.agent ?? message?.agent
      const model = input.model ?? message?.model
      const messageID = input.messageID ?? message?.id
      const sessionID = input.sessionID ?? message?.sessionID

      if (!agent || !model || !messageID || !sessionID) return

      // A new Anthropic request gets one fresh recovery attempt. The replay
      // itself uses OpenAI and therefore cannot accidentally reset this guard.
      if (model.providerID === "anthropic") attempted.delete(sessionID)

      requests.set(sessionID, {
        agent,
        messageID,
        model,
        parts: output.parts as Array<Record<string, unknown>>,
      })
    },

    event: async ({ event }) => {
      // Constat 2 : declencheur principal.
      if (event.type === "session.status" && event.properties.status.type === "retry") {
        if (retryMessageIsQuotaError(event.properties.status.message)) {
          await recover(event.properties.sessionID)
        }
        return
      }

      // Chemins defensifs : ils couvrent les erreurs non retryables, pour
      // lesquelles aucun `session.status` de type retry n'est publie. Ils n'ont
      // pas ete observes en direct sur ce runtime, seulement testes hors ligne.
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
