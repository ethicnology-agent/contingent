---
name: rtk
description: Use when a filtered command output looks truncated or wrong, when a rewritten command fails to spawn a project-local binary, when choosing how to run tests, builds, linters or git inspection so their output stays small, or when checking token savings. Covers what the rtk plugin rewrites automatically, what it leaves alone, and the escape hatches. Déclencher aussi sur "rtk", "sortie tronquée", "output filtré", "passthrough".
---

# rtk

## Ce qu'il faut savoir en premier

Tu n'as pas à préfixer tes commandes par `rtk`. Un plugin réécrit l'argument de
`bash` avant exécution, en déléguant à `rtk rewrite`. La table de réécriture vit
dans rtk lui-même, pas dans ce dépôt.

Conséquence utile : la commande affichée dans la demande de permission est déjà
la commande réécrite. Ce que tu vois approuver est ce qui s'exécute.

Conséquence gênante : tu peux voir échouer une commande que tu n'as pas écrite.
`rtk: Failed to run tsc: Failed to spawn process` sur un `npx tsc` n'est pas un
problème de ton projet, c'est la réécriture — voir « Pièges » plus bas.

Rationnel complet et mesures : `docs/decisions/0010-rtk-command-rewriting.md`
dans le dépôt `contingent`.

## Réécrit automatiquement

Mesuré avec rtk 0.43.0. La colonne de droite est ce qui s'exécute réellement.

| tu écris | s'exécute |
|---|---|
| `ls -la` | `rtk ls -la` |
| `cat f` | `rtk read f` |
| `grep -rn p .` / `rg p` | `rtk grep` / `rtk rg` |
| `find . -name '*.ts'` | `rtk find …` |
| `tree`, `wc -l f` | `rtk tree`, `rtk wc` |
| `git status`, `git diff`, `git show`, `git branch`, `git stash`, `git push` | préfixés `rtk` |
| `gh pr view 1`, `gh run list` | préfixés `rtk` |
| `cargo build`, `cargo test`, `make build` | préfixés `rtk` |
| `npm run <script>` | `rtk npm run <script>` |
| `jest`, `vitest`, `pytest`, `tsc`, `eslint`, `prettier` | filtres dédiés |
| `docker ps`, `kubectl get pods` | préfixés `rtk` |
| `curl <url>`, `wget <url>` | préfixés `rtk` |

Certains filtres ajoutent des arguments pour obtenir une sortie machine, ce qui
change la commande réelle sans changer la sémantique :

- `vitest` → `vitest run --reporter=json` (le `run` est ajouté : pas de mode
  watch, donc pas de blocage)
- `jest` → `jest --no-watch --json`
- `eslint .` → `eslint -f json .`

Si tu fournis déjà un `--reporter`, rtk ne le remplace pas — la sortie ne sera
alors pas compactée.

## Laissé tel quel

Une commande hors registre produit une réécriture vide, et le plugin la laisse
intacte. Vérifié pour :

- **les alias d'historique de ce dépôt** : `git amend`, `git fixup <sha>`,
  `git ri <base>`. Continue à les utiliser tels quels, ils ne gagnent rien mais
  ne perdent rien.
- **les commandes git à état ou interactives** : `git rebase --autosquash`,
  `git bisect`, `git blame`, `git cherry-pick`.
- `npm test`, `echo`, `./script.sh`, `python3 script.py`
- `yknotify-agent notify …`, y compris préfixé par `timeout 2` — c'est ce qui
  permet aux règles `allow` de `opencode.jsonc` de continuer à matcher.

## Pièges

**`npx` disparaît.** `npx tsc` devient `rtk tsc`, `npx eslint .` devient
`rtk lint .`, `npx vitest run` devient `rtk vitest`. Or `rtk tsc` ne résout pas
`node_modules/.bin` : avec un `tsc` local et aucun `tsc` global, il sort en
erreur `Failed to spawn process`. Pour un outil installé en dépendance de
projet, passe par le script npm (`npm run typecheck`), qui reste réécrit sans
perdre la résolution locale.

**Les patterns de permission portent sur la forme réécrite.** Une règle
`"git status": "allow"` ne déclenchera jamais, puisque l'outil voit
`rtk git status`. Écris le pattern sur la commande réécrite.

**Les pourcentages annoncés par rtk ne sont pas mesurés ici.** Ce sont des
chiffres amont. Ne les cite pas comme un résultat de ce dépôt.

## Échappatoires

```bash
rtk proxy <cmd>      # exécute sans filtrer, mais compte l'usage
rtk run <cmd>        # exécute brut : ni filtre, ni comptage
rtk gain             # gains cumulés
rtk gain --history   # historique commande par commande
rtk config           # configuration effective et son chemin
```

Quand une sortie filtrée te paraît incomplète, relance avec `rtk proxy` avant de
conclure quoi que ce soit sur le code. C'est le premier réflexe : ne débogue pas
un problème qui est peut-être un artefact de filtrage.

Le plugin se désactive tout seul si `rtk` est absent du `PATH` — il ne fait
alors qu'un `warn` au démarrage, et aucune commande n'est réécrite.
