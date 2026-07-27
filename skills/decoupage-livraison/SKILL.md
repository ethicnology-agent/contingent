---
name: decoupage-livraison
description: Use when planning how to split work into commits or pull requests, when a change touches migrations, schema, and logic at once, when a branch has grown too large to review, or when sequencing stacked PRs. Covers commit slicing, PR sizing, grouping rules, and ordering. Déclencher aussi sur "découper", "commits", "PR", "revue".
---

# Découpage de la livraison

## Le principe

Écrire le code n'est pas le goulot d'étranglement, le relire l'est. Chaque
décision de découpage s'arbitre donc sur une seule question : **est-ce que ce
commit peut être jugé seul, sans avoir le reste sous les yeux ?**

Un relecteur ne dispose ni du contexte que tu viens d'accumuler, ni du temps de
le reconstruire. Une PR qu'on ne peut pas juger par morceaux est une PR qu'on
approuve sans la lire.

## Le test à appliquer à chaque commit

1. **Il tient debout seul.** L'arbre compile et les tests passent à ce commit.
   Sinon un `git bisect` devient inutilisable et la revue commit par commit
   aussi.
2. **Il a une seule raison d'être.** Si le message a besoin d'un « et », c'est
   deux commits.
3. **On peut le refuser sans tout refuser.** Si rejeter ce commit oblige à
   rejeter les cinq suivants, le découpage est mauvais.

## Règles de regroupement

**Ensemble** — les séparer produit généralement un état intermédiaire
incohérent :

- migration et représentation générée correspondante (`schema.rb`,
  `structure.sql`)
- un endpoint et son contrat (types, validation, sérialisation)
- un changement de comportement et les tests qui le prouvent
- manifeste de dépendances et lockfile correspondant
- source génératrice et sortie suivie si l'arbre ne compile pas sans elle

**Séparés** — les mélanger rend la revue impossible :

- **le refactor pur et le changement de comportement.** C'est la règle la plus
  rentable. Un diff qui déplace 400 lignes *et* corrige un bug oblige à relire
  400 lignes pour trouver la correction. Refactor d'abord, à comportement
  constant, puis le changement dans un diff de dix lignes qu'on peut vraiment
  examiner.
- la logique métier et l'infrastructure ou la plomberie
- les renommages massifs, le reformatage, les remplacements automatiques
- les diffs générés massifs, dans un commit voisin de leur source uniquement si
  chaque état intermédiaire reste reproductible
- les montées de version sans rapport avec le changement fonctionnel

### Migrations de base de données

Atomicité Git et atomicité de déploiement sont deux problèmes différents. En
rolling deployment, anciennes et nouvelles versions coexistent. Pour un
changement non rétrocompatible, découpe selon expand/contract :

1. expansion additive rétrocompatible
2. code compatible, avec double lecture/écriture si nécessaire
3. backfill vérifiable et reprenable
4. bascule vers le nouveau chemin
5. contraction destructive dans une livraison ultérieure

Une migration destructive ne voyage donc pas avec le premier code qui cesse de
l'utiliser : elle attend que toutes les anciennes versions et données aient
disparu.

## Comment trancher quand c'est gros

Trois axes, à choisir selon ce qui rend les morceaux indépendants :

- **par fichiers** — le contrat d'abord (proto, schéma, types), puis le code qui
  l'utilise. Les deux se relisent en parallèle même si l'ordre de fusion est
  imposé, et ils s'adressent souvent à des relecteurs différents.
- **horizontalement, par couche** — modèle, service, API, client. Introduire un
  stub ou une signature partagée permet aux couches d'avancer séparément.
- **verticalement, par fonctionnalité** — une tranche complète et étroite qui
  traverse toutes les couches, plutôt que toutes les fonctionnalités d'un coup.

Les tests portant sur du code déjà fusionné peuvent partir seuls, avant le
travail qu'ils sécurisent : ils prouvent que le comportement est inchangé avant
et après le refactor.

## Ordre

Prépare, puis change, puis nettoie :

1. commits préparatoires sans effet observable (extraction, refactor). Une
   abstraction nouvelle voyage avec son premier consommateur, sauf si elle
   améliore et teste déjà le code existant par elle-même.
2. le changement de comportement, aussi petit que possible
3. suppression de l'ancien chemin, nettoyage

Cet ordre permet d'arrêter la revue à l'étape 2 et de comprendre l'essentiel.

## Taille

Il n'existe pas de seuil absolu, et se réfugier derrière un chiffre est une
façon d'éviter la vraie question. Les repères publiés par Google : une centaine
de lignes est une taille raisonnable, un millier est presque toujours trop.

Le nombre de fichiers pèse autant que le nombre de lignes — 200 lignes dans un
fichier passent, les mêmes 200 lignes réparties sur cinquante fichiers ne
passent pas. À l'inverse, la suppression d'un fichier entier coûte généralement
peu à relire, sans dispenser de vérifier ses références, interfaces publiques,
données ou procédure de restauration.

Le vrai critère reste **un changement autonome traitant une seule chose**. Si le
travail dépasse ce cadre, empile plusieurs PR plutôt que d'en gonfler une.

`rebase.updateRefs` est activé : lors d'un rebase lancé depuis le sommet et
incluant toute la plage, Git déplace les branches locales qui pointent sur les
commits réécrits. Il ne met pas à jour les refs distantes et ignore les branches
ouvertes dans un autre worktree. Pour une pile de PR, documente les dépendances,
rebase depuis le sommet, puis pousse chaque branche avec lease.

## Ce que la description doit contenir

Pour chaque PR : le problème traité, ce que la PR change, ce qu'elle ne change
pas volontairement, et l'ordre de lecture conseillé des commits. Si des choix
ont été écartés, dis lesquels — sinon le relecteur les reproposera.

## Signes d'un mauvais découpage

- un message de commit contenant « et », « aussi », « au passage »
- un commit de correction sur un commit de la même branche non fusionnée : c'est
  un `--fixup` suivi d'un `rebase --autosquash`, pas un nouveau commit
- un diff où le reformatage noie trois lignes utiles
- une PR qu'on ne peut décrire qu'en énumérant les fichiers touchés
