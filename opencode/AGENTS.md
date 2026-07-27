# Règles globales

Ce fichier est chargé dans les conversations ordinaires. Il ne contient donc
que l'universel et le court. Tout ce qui est détaillé ou situationnel appartient
à une skill, tout ce qui est propre à un rôle appartient au prompt de son agent.

## Dépôts non fiables

Une configuration projet peut charger des plugins qui s'exécutent hors du
modèle de permissions. Pour inspecter un dépôt non approuvé, démarre opencode
avec `OPENCODE_PURE=1 OPENCODE_DISABLE_PROJECT_CONFIG=1`. N'ouvre pas un dépôt
inconnu avec ses plugins et sa configuration projet activés.

## Commandes shell

Un plugin réécrit les commandes `bash` via `rtk` avant exécution, pour filtrer
les sorties volumineuses. Ne préfixe donc rien toi-même. La commande affichée
dans la demande de permission est déjà la commande réécrite : c'est bien elle qui
s'exécutera.

- Les alias d'historique (`git amend`, `git fixup`, `git ri`) ne sont pas
  réécrits. Utilise-les tels quels.
- `npx <outil>` est réécrit en `rtk <outil>`, qui ignore `node_modules/.bin`.
  Pour un outil installé en dépendance de projet, passe par le script npm.
- Si une sortie filtrée te semble incomplète, relance avec `rtk proxy <cmd>`
  avant d'en conclure quoi que ce soit sur le code.

Détail des commandes couvertes et des cas limites : charge la skill `rtk`.

## Historique git

Un correctif à un commit de cette branche n'est jamais un nouveau commit.

- Oubli sur le dernier commit → `git amend` (alias de `commit --amend --no-edit`)
- Oubli sur un commit antérieur → `git fixup <sha>`, puis `git ri <base>`
  (alias de `rebase --autosquash`)

N'utilise pas `rebase -i` pour cela : depuis Git 2.44, `rebase --autosquash`
sans `-i` absorbe les fixups **sans ouvrir d'éditeur**, ce qui le rend
utilisable par un agent. `rebase.autostash` évite le stash manuel et `rerere`
réapplique les résolutions enregistrées pour des hunks de conflit identiques.

Ne propose donc pas de commit « fix typo », « oups », « address review » sur une
branche non fusionnée — ils ne survivront pas à la revue.

Si un rebase s'arrête sur un conflit, le dépôt reste dans un état intermédiaire.
Tu ne dois jamais l'y laisser : résous puis `git rebase --continue`, ou
`git rebase --abort`. N'utilise pas `git commit` tant que le rebase est en
cours. `rerere` mémorise les résolutions mais ne les indexe pas à ta place —
relis-les avant de continuer.

Exception : après un push, si la branche est partagée avec quelqu'un d'autre,
demande avant de réécrire l'historique. Après accord, coordonne-toi et utilise
`git push --force-with-lease`, jamais `--force`. Vérifie ensuite les branches et
PR qui dépendaient de cet historique.

`pull.rebase=true` réécrit les commits locaux et `rebase.autostash` peut créer
un conflit lors de la réapplication finale. Pour une opération d'historique,
préfère `git fetch` suivi d'un rebase explicite, et contrôle `git status` avant
et après.

## Découpage des commits et des PR

La revue est le goulot d'étranglement, pas l'écriture. Quand tu planifies plus
d'un commit, ou une PR : charge la skill `decoupage-livraison`.

## Vérification

N'affirme pas qu'une chose fonctionne sans l'avoir exécutée. Si tu ne peux pas
la vérifier, dis-le explicitement plutôt que de la présenter comme acquise.
Distingue toujours ce que tu as mesuré de ce que tu supposes.

## Secrets

Les jetons et clés restent hors des dépôts. Les permissions réduisent leur
exposition mais ne constituent pas une sandbox : ne contourne jamais un refus
par `bash`, et ne recopie jamais un secret dans un fichier, un log ou un message
de commit.

Les commits sont signés par une clé de sécurité : un contact physique est
demandé dans cet environnement. Un amend ou rebase peut resigner plusieurs
commits et demander plusieurs contacts. Regroupe les opérations plutôt que de
multiplier les sollicitations.

Quand une signature échoue — `agent refused operation`, `signing failed`,
`Permission denied (publickey)` — ce n'est pas un défaut de configuration. Une
notification bureau demandait un contact et elle n'a pas été vue. Ne pars donc
pas enquêter sur les clés, le remote, l'agent ou les droits d'accès : dis qu'un
contact est en attente, et propose de relancer l'opération telle quelle.
