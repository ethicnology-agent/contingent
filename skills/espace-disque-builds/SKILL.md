---
name: espace-disque-builds
description: Use before heavy Flutter/Android or Rust builds, appbundle/APK builds, toolchain downloads, pub get from scratch, repository clones/worktrees, or any disk-space diagnosis and cleanup on this Lima VM. Also trigger on "no space left", "disk full", "espace disque", `df`, `du`, `cargo clean`, build caches, target directories, ABI filters, and multi-architecture builds.
---

# Espace disque et builds dans Lima

## Topologie

Cette machine est une VM Lima sur macOS. `/` et le home hors `~/debian` sont
sur l'image ext4 de la VM. `~/debian/` est un montage virtiofs du dossier hôte.
Ne cumule jamais leurs tailles : ce ne sont pas deux copies des mêmes fichiers.

## Avant une opération lourde

Avant un build Flutter/Rust, un téléchargement de toolchain, un clone ou un
`pub get` massif, vérifie les deux systèmes de fichiers :

```bash
df -h / ~/debian/
```

- Moins de 30 Go libres sur `/` : ne lance pas l'opération.
- Moins de 15 Go libres sur `/` : situation critique, ne produis plus d'artefacts.
- Moins de 60 Go libres sur `~/debian/` : avertis avant de poursuivre.
- Pour une mesure APFS native, demande `df -h /System/Volumes/Data` sur le Mac.

## Flutter et Android

Pour un APK ou App Bundle debug, cible seulement arm64 :

```bash
flutter build apk --debug --target-platform android-arm64
```

Adapte uniquement le binaire Flutter et les options du projet, comme
`--flavor`. Ne construis toutes les architectures que pour une release
explicitement demandée. Ne modifie pas les filtres ABI globaux ou du projet.

## Rust

`~/.cargo/config.toml` centralise le target partagé. Ne le contourne pas et ne
définis pas `CARGO_TARGET_DIR` vers un chemin ad hoc. N'active ni build
incrémental ni informations de debug sans besoin explicite. Ne lance jamais
`cargo clean`, qui peut vider le target partagé de tous les projets.

## Caches et nettoyage

Ne redirige pas une racine de build ou de cache avec `--build-dir`,
`CARGO_TARGET_DIR`, `XDG_CACHE_HOME` ou un `--out-dir` global. Les artefacts
intermédiaires restent dans leurs emplacements habituels.

Avant tout nettoyage : établis une liste précise, relis-la, affiche tailles et
chemins, puis demande validation pour plusieurs Go, un cache global ou un autre
checkout. Réutilise exactement cette liste validée.

Ne supprime jamais sans validation : code source, `.git/`, fichiers non
commités, `~/.local/share/opencode/`, toolchains, `~/.ssh`, `~/.config`, ou un
cache global.

## Diagnostic

```bash
df -h / ~/debian/
du -xhd 1 ~ 2>/dev/null | sort -h
du -xhd 1 ~/debian/ 2>/dev/null | sort -h
```

Le premier `du` reste dans l'image de la VM ; le second inspecte le volume hôte.
Descends ensuite un niveau à la fois. Après une grosse suppression sur `/` ou
dans le home hors `~/debian/`, exécute `sudo fstrim -av`. Cela ne sert pas pour
une suppression limitée à `~/debian/`.
