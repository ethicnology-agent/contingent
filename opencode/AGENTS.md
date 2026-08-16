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
- N'écris jamais `sudo rtk <cmd>` : `rtk` n'existe pas dans le PATH de root et
  la commande échoue avec `sudo: rtk: command not found`. Écris `sudo <cmd>`
  directement (ex. `sudo /usr/bin/find ...`); le plugin réécrit la commande
  globale, pas ce qui suit `sudo`.

Détail des commandes couvertes et des cas limites : charge la skill `rtk`.

Le groupe de process est tué à la fin de chaque commande. `nohup … &` n'y
survit pas — le fichier de log peut même ne jamais être créé. Pour un build,
un serveur ou un watcher qui doit durer au-delà de l'appel :

```
setsid nohup <cmd> > /tmp/opencode/x.log 2>&1 < /dev/null & disown
```

puis consulte le log dans un appel séparé. Une commande longue coupée en vol
laisse un état partiel, pas une erreur propre : `adb install` interrompu produit
un paquet à moitié installé, un `git` interrompu un verrou.

## Disque et builds lourds

Cette VM a déjà été rendue inutilisable par l'accumulation silencieuse
d'artefacts multi-architectures. Avant un build Flutter/Android ou Rust lourd,
un téléchargement de toolchain, un clone, ou un diagnostic/nettoyage disque :
charge la skill `espace-disque-builds` et suis ses seuils.

En particulier : vérifie l'espace avant de produire plusieurs Go, limite les
builds Android debug à `android-arm64`, ne redirige pas les racines de build ou
de cache, ne défais pas la configuration Cargo/Gradle globale, et ne lance
jamais `cargo clean` puisque le target Cargo est partagé. N'efface jamais
plusieurs Go, un cache global ou les artefacts d'un autre checkout sans avoir
présenté une liste précise et obtenu une validation.

Les clones, worktrees, builds, caches et autres artefacts de travail doivent
vivre sous `~/debian/`, le volume hôte. N'utilise jamais `/tmp` ou
`/tmp/opencode` pour un worktree ou un build : `/tmp` est un tmpfs limité.
Réserve-le aux petits fichiers temporaires et journaux éphémères.

## Tests Android en développement

Pour tester sur un téléphone Android pendant le développement, construis
uniquement un APK debug pour l'ABI de l'appareil, normalement `arm64-v8a`
(`--debug --target-platform android-arm64`). Ne lance pas `make android`, la
chaîne Podman de reproductibilité, une release, ni un build multi-architecture
sauf demande explicite de l'utilisateur. Ces commandes consomment inutilement
du temps et de l'espace disque pour un test local.

Avant un build ou une commande `adb`, vérifie que `ANDROID_SDK_ROOT` est défini
et que `platform-tools` est dans le `PATH`. Le chemin concret du SDK et le
serveur ADB de cette machine sont dans `AGENTS.local.md`; ne suppose jamais que
`flutter`, `adb` ou le SDK sont configurés par le shell de l'agent.

## Fixtures des tests d'intégration

Les tests d'intégration financés de bullbitcoin-mobile (payjoin, coins)
attendent deux mnemonics testnet dans `TEST_ALICE_MNEMONIC` et
`TEST_BOB_MNEMONIC`. Leurs valeurs sont dans `AGENTS.local.md` : ne les
recopie jamais dans un fichier versionné, un ticket ou une CI publique, et ne
redemande pas à l'utilisateur de les partager.

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

Avant toute réécriture d'une branche courante déjà publiée qui devra finir par
un `git push --force-with-lease`, commence par synchroniser cette branche avec
son upstream via `git pull --rebase`, puis contrôle `git status` et le journal
local/distant **avant** de toucher à l'historique. Ne fais jamais ce pull après
la réécriture : il réintroduirait l'ancien historique. Juste avant le push,
refais un `git fetch` et vérifie que le remote n'a pas avancé depuis cette
synchronisation ; s'il a avancé, intègre ces commits avant de pousser.

`pull.rebase=true` réécrit les commits locaux et `rebase.autostash` peut créer
un conflit lors de la réapplication finale. Pour une opération d'historique,
préfère `git fetch` suivi d'un rebase explicite, et contrôle `git status` avant
et après.

## Langue des contributions

Nos échanges se font en français ; les artefacts publics, non. Code,
identifiants, commentaires, messages de commit, titres et descriptions de PR ou
d'issue, réponses de revue : tout est rédigé en anglais, quelle que soit la
langue de la conversation. Une chaîne française oubliée dans un test ou un
commentaire est un motif de rejet en revue.

Avant de rédiger pour un dépôt qui n'est pas le nôtre, lis quelques PR et issues
déjà fusionnées pour en reprendre les conventions : format des titres, niveau de
détail des descriptions, ton des commentaires, présence ou non d'un changelog.
Les standards du projet priment sur nos habitudes.

## Découpage des commits et des PR

La revue est le goulot d'étranglement, pas l'écriture. Quand tu planifies plus
d'un commit, ou une PR : charge la skill `decoupage-livraison`.

## Délégation parallèle

Quand plusieurs unités de travail sont réellement indépendantes, l'agent
primaire lance autant de sous-agents que nécessaire en parallèle, dans le même
appel groupé. Il n'impose pas de limite arbitraire à leur nombre et ne
sérialise pas un travail parallélisable, sauf si le coût de délégation dépasse
le gain attendu.

Chaque délégation reste cohérente, bornée et suffisamment détaillée : périmètre,
résultat attendu et vérification. Elle peut contenir plusieurs étapes étroitement
liées et toucher plusieurs fichiers ; un commit n'est pas une frontière de
délégation. Ne lance jamais en parallèle des agents susceptibles de modifier les
mêmes fichiers ou le même état mutable. Les sous-agents ne redélèguent pas ;
l'agent primaire reste responsable de l'intégration, de la vérification globale
et du découpage final des commits.

L'indépendance couvre aussi les ressources d'exécution, pas seulement les
fichiers source. Deux workers parallèles ne doivent jamais partager un processus
long, un port, un appareil, un émulateur, une base de données mutable, l'index
Git, une installation de dépendances, un générateur de code (`build_runner`) ou
le même répertoire de build. Désigne un seul propriétaire pour toute ressource
exclusive et indique-le dans sa délégation ; les autres workers reportent la
vérification concernée. Les builds et vérifications globales s'exécutent une
seule fois, en série, après intégration par l'agent primaire.

Un worker ne lance ni watcher ni serveur persistant sauf demande explicite. Une
commande susceptible d'attendre un verrou doit avoir une durée bornée. En cas de
contention, de verrou occupé ou d'absence de progression, arrête et remonte le
blocage : ne relance pas en boucle et ne démarre pas un second processus
concurrent.

## Notes de travail

Les plans d'enquête, comptes rendus de tests, listes de pistes et documents de
travail créés pendant une session restent hors du dépôt. Ne les ajoute jamais à
un commit ou une PR sans demande explicite de l'utilisateur de les versionner.
Seule la documentation utilisateur, opératoire ou d'architecture demandée et
maintenue par le projet mérite d'être committée.

## Vérification

N'affirme pas qu'une chose fonctionne sans l'avoir exécutée. Si tu ne peux pas
la vérifier, dis-le explicitement plutôt que de la présenter comme acquise.
Distingue toujours ce que tu as mesuré de ce que tu supposes.

## Avancement visible

La todo est le seul endroit où l'utilisateur voit où tu en es pendant une tâche
longue. Tiens-la à jour **au fil de l'eau**, pas en fin de course : une entrée
passe à `in_progress` avant de commencer, à `completed` dès que c'est fini, et
les découvertes en route deviennent de nouvelles entrées. Sur une opération qui
s'étale (rebase, migration, build, audit), le libellé doit dire *où* tu en es —
« vérification: cargo test + clippy » vaut mieux que « vérifier ».

Une todo mise à jour d'un bloc à la fin ne sert à rien : au moment où elle
arrive, l'utilisateur a déjà attendu sans savoir.

## Périmètre de la machine

Tu tournes dans une VM Linux sur hôte macOS (`systemd-detect-virt` → `apple`).
Le matériel — USB, téléphone branché, périphérique Bluetooth — appartient à
l'hôte, pas à toi. Un périphérique absent de `/dev`, de `lsusb` ou d'un scan
réseau depuis l'invité n'est donc **pas** un périphérique absent : c'est un
angle mort.

Avant de bâtir un contournement sur un constat matériel ou réseau, pose-toi
deux questions : « est-ce que je peux voir ça d'ici ? », puis « l'utilisateur
peut-il le vérifier côté hôte en une commande ? ». Demander coûte un message ;
un contournement construit sur un faux négatif coûte une session.

Pour Android et adb en particulier : charge la skill `appareil-android`.

Des reverse-forwards SSH exposent dans la VM des services qui tournent sur le
poste client, notamment un serveur adb et le port du runner Flutter. Ne remplace
pas ce mécanisme par du wireless debugging. Les valeurs concrètes — hôte, ports,
utilisateur — sont propres à la machine et vivent dans `AGENTS.local.md`, qui
n'est pas versionné : ne les recopie jamais ici.

Aucun téléphone n'est branché sur cette VM, et plusieurs serveurs adb distincts
peuvent en tenir un selon la machine où il est connecté. Deux serveurs adb ne se
fusionnent jamais : on bascule de profil. Ne démarre aucun serveur adb ici —
celui que tu créerais serait vide et volerait le port d'un forward.

## GitHub en lecture seule

Le token `gh` de cette machine est **volontairement** en lecture seule (PAT
fine-grained sans droit d'écriture). Une mutation — `gh pr edit`, `gh api` en
POST/PATCH, mutation GraphQL — échoue avec `Resource not accessible by
personal access token` : ce n'est ni un défaut de configuration ni quelque
chose à contourner. Prépare le contenu (titre, corps de PR, commentaire) dans
un fichier et remets-le à l'utilisateur pour qu'il le colle lui-même.

Bonus si un jour le token écrit : `gh pr edit` échoue sur la requête GraphQL
Projects-classic dépréciée — passer par une mutation `updatePullRequest`
directe via `gh api graphql`.

## Secrets

Les jetons et clés restent hors des dépôts. Les permissions réduisent leur
exposition mais ne constituent pas une sandbox : ne contourne jamais un refus
par `bash`, et ne recopie jamais un secret dans un fichier, un log ou un message
de commit.

Les commits sont signés par une clé de sécurité : un contact physique est
demandé dans cet environnement. Un amend ou rebase peut resigner plusieurs
commits et demander plusieurs contacts. Regroupe les opérations plutôt que de
multiplier les sollicitations.

Pour déterminer si un commit SSH est signé, ne te fie jamais uniquement à
`git log --show-signature` : il peut afficher `No signature` quand la
vérification locale SSH n'est pas configurée, même si la signature est bien
présente. Inspecte d'abord l'objet brut avec `git cat-file -p <commit>` et
cherche le bloc `gpgsig -----BEGIN SSH SIGNATURE-----`. Sa présence prouve que
le commit contient une signature ; `gpg.ssh.allowedSignersFile` sert ensuite à
vérifier l'identité associée, pas la présence de la signature.

Quand une signature échoue — `agent refused operation`, `signing failed`,
`Permission denied (publickey)` — ce n'est pas un défaut de configuration. Une
notification bureau demandait un contact et elle n'a pas été vue. Ne pars donc
pas enquêter sur les clés, le remote, l'agent ou les droits d'accès : dis qu'un
contact est en attente, et propose de relancer l'opération telle quelle.
