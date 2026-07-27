import type { Plugin } from "@opencode-ai/plugin"

// yknotify — notifications bureau pour opencode, via le meme canal OSC 777
// que les demandes de touch YubiKey (voir bin/yknotify-agent).
//
// Choix deliberé : un hook, pas une regle AGENTS.md. Une consigne de prompt
// est consultative — le modele peut l'oublier, elle coute des tokens a chaque
// tour, et elle ne se declenche que s'il y pense. Ici le declenchement est
// deterministe et ne depend pas du modele.
//
// Trois declencheurs seulement, pour ne pas transformer le canal en bruit :
//   - fin de tour, et uniquement si le tour a dure plus que le seuil
//   - l'agent pose une question et attend une reponse        (urgent)
//   - validation reellement demandee, si elle est encore "ask" (urgent)
//
// Le cas « question » couvre l'attente explicite d'une reponse. Les demandes
// d'autorisation utilisent l'evenement runtime permission.asked : le hook
// historique permission.ask est encore type mais n'est plus declenche en 1.18.5.
//
// session.error est volontairement absent : les erreurs transitoires sont
// frequentes (le SessionStatus prevoit un etat "retry", et anthropic-fallback
// existe justement pour absorber les quotas). Notifier dessus produirait une
// rafale a chaque incident reseau ou limite de debit.

const seuilConfigure = Number(process.env.YKNOTIFY_SEUIL_MS ?? 30_000)
const SEUIL_MS = Number.isFinite(seuilConfigure) && seuilConfigure >= 0
  ? seuilConfigure
  : 30_000
const REFRACTAIRE_MS = 5_000
const DELAI_IDLE_MS = 750

export const YknotifyPlugin: Plugin = async ({ client, directory, $ }) => {
  try {
    await $`which yknotify-agent`.quiet()
  } catch {
    console.warn("[yknotify] yknotify-agent absent du PATH — plugin desactive")
    return {}
  }

  const projet = directory.split("/").filter(Boolean).pop() || "opencode"
  const titre = `opencode — ${projet}`

  const derniereNotif = new Map<string, number>()
  const debutOccupe = new Map<string, number>()
  const estRacineCache = new Map<string, boolean>()
  const idleEnAttente = new Map<string, ReturnType<typeof setTimeout>>()

  // `urgent` = l'agent est bloque et t'attend. Ces notifications ignorent la
  // periode refractaire : sans ca, un « termine » emis 2 s plus tot etoufferait
  // le « une question t'attend » qui suit — le moins utile masquant le plus
  // utile, exactement l'inverse de ce qu'on veut.
  const notifier = async (sessionID: string, corps: string, urgent = false) => {
    const maintenant = Date.now()
    const precedente = derniereNotif.get(sessionID) ?? 0
    if (!urgent && maintenant - precedente < REFRACTAIRE_MS) return
    derniereNotif.set(sessionID, maintenant)
    // process.pid : yknotify-agent remonte les parents jusqu'au pts de la
    // session, et retombe sur le pts le plus actif si le serveur est detache.
    try {
      await $`timeout 2 yknotify-agent notify ${titre} ${corps} ${process.pid}`
        .quiet()
        .nothrow()
    } catch {
      // Une notification ne doit jamais bloquer ni faire echouer un hook.
    }
  }

  // Les sous-agents emettent aussi session.idle : sans ce filtre, un explore
  // qui se termine declencherait une notification.
  const estRacine = async (id: string): Promise<boolean> => {
    const connu = estRacineCache.get(id)
    if (connu !== undefined) return connu
    let racine = true // en cas de doute, on prefere notifier
    try {
      const reponse = await client.session.get({ path: { id } })
      const resultat = reponse as { data?: { parentID?: string }; error?: unknown }
      if (resultat.error) return false
      const donnees = resultat.data
      if (donnees) racine = !donnees.parentID
    } catch {
      // API injoignable : on garde la valeur par defaut
    }
    estRacineCache.set(id, racine)
    return racine
  }

  return {
    "tool.execute.before": async (input) => {
      if (String(input?.tool ?? "").toLowerCase() !== "question") return
      void notifier(input.sessionID, "une question t'attend", true)
    },

    event: async ({ event }) => {
      if (event.type === "session.status") {
        // On n'enregistre que le passage a "busy", et on ne purge JAMAIS ici :
        // si session.status{idle} precede session.idle, purger a cet endroit
        // effacerait l'horodatage avant qu'il ne serve. La purge appartient au
        // traitement de session.idle, seul consommateur de la valeur.
        const { sessionID, status } = event.properties
        if (status.type === "busy" && !debutOccupe.has(sessionID)) {
          debutOccupe.set(sessionID, Date.now())
        }
        if (status.type === "busy") {
          const attente = idleEnAttente.get(sessionID)
          if (attente) clearTimeout(attente)
          idleEnAttente.delete(sessionID)
        }
        return
      }

      if (event.type === "session.idle") {
        const { sessionID } = event.properties
        const debut = debutOccupe.get(sessionID)
        debutOccupe.delete(sessionID)
        if (debut === undefined) return
        const duree = Date.now() - debut
        if (duree < SEUIL_MS) return // tour trop court : pas la peine
        if (!(await estRacine(sessionID))) return
        // abort/retry peut emettre idle juste avant de relancer la session. Un
        // bref delai annulable evite d'annoncer une fin pendant le fallback.
        const attente = setTimeout(() => {
          idleEnAttente.delete(sessionID)
          void notifier(sessionID, `terminé · ${Math.round(duree / 1000)} s`)
        }, DELAI_IDLE_MS)
        idleEnAttente.set(sessionID, attente)
        return
      }

      // Le runtime 1.18.5 emet permission.asked, mais l'union Event du SDK
      // historique ne l'expose encore que dans les types v2.
      const runtimeEvent = event as unknown as {
        type: string
        properties: Record<string, unknown>
      }
      if (runtimeEvent.type === "permission.asked") {
        const demande = runtimeEvent.properties as unknown as {
          sessionID: string
          permission: string
          patterns?: string[]
        }
        // Le garde de Permission.ask est par appel d'outil, pas par pattern :
        // un seul pattern encore en "ask" publie l'evenement avec TOUTE la
        // liste, y compris les patterns deja autorises. Et la charge utile ne
        // porte aucune action par pattern, donc le bloqueur est indeterminable.
        // Afficher patterns[0] nommait donc regulierement une commande deja
        // autorisee — mesure sur une requete bash de neuf patterns dont le
        // premier, un "rtk ls ...", etait couvert par une regle "rtk *", alors
        // que les vrais bloqueurs ("echo ...", "tail -12") suivaient dans la
        // liste. Un pattern unique est en revanche forcement le bloqueur.
        const patterns = demande.patterns ?? []
        const detail = patterns.length === 1
          ? patterns[0]
          : patterns.length > 1
            ? `${patterns.length} commandes`
            : undefined
        const corps = detail
          ? `validation requise · ${demande.permission} · ${detail}`
          : `validation requise · ${demande.permission}`
        void notifier(demande.sessionID, corps, true)
        return
      }

      if (event.type === "session.deleted") {
        const sessionID = event.properties.info.id
        const attente = idleEnAttente.get(sessionID)
        if (attente) clearTimeout(attente)
        idleEnAttente.delete(sessionID)
        debutOccupe.delete(sessionID)
        estRacineCache.delete(sessionID)
        derniereNotif.delete(sessionID)
      }
    },
  }
}
