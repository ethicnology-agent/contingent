---
name: appareil-android
description: Use when running, installing or debugging an app on a physical Android device or emulator from this machine — adb, flutter run, flutter devices, APK install, logcat, "no devices found", "adb protocol fault", "ADB exited with exit code -15". Explains that this is a Lima VM on macOS where no phone is ever attached, and where several adb servers may hold one. Déclencher aussi sur "tester sur le téléphone", "Pixel", "appareil physique", "brancher", "installer l'APK", "adb ne voit rien".
---

# Tester sur un appareil Android

## Limite de la VM

Cette machine est une VM Lima sur macOS. Aucun téléphone n'y est jamais
branché : l'USB appartient à une autre machine. L'absence de `/dev/bus/usb` ou
un `lsusb` vide ne prouve donc rien.

```bash
systemd-detect-virt        # apple
```

## Deux sources d'appareils, jamais fusionnées

Un client adb parle à **un** serveur, et les transports appartiennent au serveur
qui tient l'USB. Deux serveurs adb ne se fusionnent pas : selon la machine sur
laquelle le téléphone est branché, on bascule de profil. Les noms des profils et
leurs valeurs sont dans `AGENTS.local.md`.

Un profil pose deux variables solidaires — jamais l'une sans l'autre :

```bash
use-<profil>
flutter run --host-vmservice-port=$FLUTTER_VMSERVICE_PORT
```

`ADB_SERVER_SOCKET` désigne le serveur, `FLUTTER_VMSERVICE_PORT` le port par
lequel le runner Dart rejoint l'appareil. Ces fonctions n'existent que dans un
shell interactif : dans une session non interactive, exporte les deux à la main.

## Ne jamais démarrer un serveur adb ici

`adb` auto-démarre un serveur quand `ADB_SERVER_SOCKET` désigne une adresse
**loopback** qui ne répond pas — le cas d'un profil dont le tunnel SSH est
tombé. Ce serveur fantôme est vide, et il occupe le port que le forward voudra
binder à la reconnexion : la session SSH suivante échoue alors au lieu de
s'établir. C'est le mode de panne classique de cette machine.

Pour une cible non-loopback, adb refuse au contraire de lancer quoi que ce soit
(`cannot start server on remote host`) : ces profils-là sont immunisés.

Contrôle, qui ne doit jamais rien renvoyer :

```bash
pgrep -a adb
```

Ne passe pas au débogage sans fil : c'est le chemin lent, délibérément supprimé.

## Quand adb ne voit rien

Sonde le serveur sans invoquer `adb`, donc sans risquer d'en créer un :

```bash
python3 - <<'EOF'
import os, socket
h, p = os.environ["ADB_SERVER_SOCKET"].removeprefix("tcp:").rsplit(":", 1)
c = socket.create_connection((h, int(p)), timeout=3)
c.sendall(b"000chost:version")
print(repr(c.recv(64)))
EOF
```

- `OKAY0004…` : serveur vivant.
- `Connection reset by peer` : le tunnel répond, le serveur d'en face est mort.
- `Connection refused` : aucun tunnel — la session SSH qui le portait est tombée.

Une liste d'appareils **vide n'est pas une panne** : c'est la réponse correcte
quand rien n'est branché sur la machine de ce profil. Vérifie l'autre profil
avant de conclure. Si tous sont vides, le matériel appartient à l'hôte : demande
une vérification du câble plutôt que d'échafauder un contournement.

Piège de lecture : la réponse arrive en plusieurs segments TCP. Un `recv()`
unique sur `host:devices-l` peut ne rendre que `OKAY` et faire conclure à tort à
une liste vide. Lis le statut sur 4 octets, puis la longueur sur 4 octets
hexadécimaux, puis exactement ce nombre d'octets.

## forward et reverse ne bindent jamais ici

`adb forward` binde le port sur la machine du **serveur** adb, alors que Flutter
se connecte en dur à `127.0.0.1` sur la machine où il tourne. D'où le port fixe
par profil (`--host-vmservice-port`) et le relais qui l'amène jusqu'ici : selon
le profil, un `RemoteForward` SSH ou une unité socket systemd. Sans port fixe,
adb en choisit un dynamiquement, impossible à pré-router.

`adb reverse tcp:P tcp:Q` fait que le téléphone atteint `127.0.0.1:Q` sur la
machine du serveur adb, pas ici. Deux issues, selon que cette machine sait ou
non joindre la VM directement :

- elle le sait : vise la VM explicitement, `adb reverse tcp:P tcp:<ip-vm>:P` ;
- elle ne le sait pas : ouvre le forward à chaud depuis le poste,
  `ssh -O forward -L P:localhost:P <hôte>`, ce que le multiplexage SSH permet
  sans reconnexion.

## Variables adb

`ANDROID_ADB_SERVER_PORT` est ignorée. `adb -P <port>` cible un serveur local.
`ADB_SERVER_SOCKET=tcp:h:p` cible un serveur distant déjà lancé. Flutter
n'honore que `ADB_SERVER_SOCKET`.

Avant `adb` ou `flutter build`, vérifier que `ANDROID_SDK_ROOT` désigne un SDK
existant et que `$ANDROID_SDK_ROOT/platform-tools` est dans le `PATH`. Le chemin
concret et les valeurs des profils sont propres à la machine : lis-les dans
`AGENTS.local.md`, ne les devine pas et ne les recopie pas dans un dépôt.

## Processus longs

Le harness tue le groupe de processus à la fin d'une commande. Pour un build ou
une installation longue :

```bash
setsid nohup <commande> > /tmp/opencode/x.log 2>&1 < /dev/null & disown
```

Puis consulte le journal dans un appel séparé. Une installation interrompue peut
laisser un paquet fantôme : `pm list packages` le montre mais `pm path <pkg>`
est vide. Réinstalle avec `adb install -r -t <apk>`.

## Recette

```bash
use-<profil>
adb devices -l
setsid nohup fvm flutter build apk --debug --target-platform android-arm64 \
  --flavor <flavor> > /tmp/opencode/build.log 2>&1 < /dev/null & disown
adb install -r -t build/app/outputs/flutter-apk/app-<flavor>-debug.apk
adb shell monkey -p <pkg> -c android.intent.category.LAUNCHER 1
adb shell pidof <pkg>
adb logcat -s flutter
```

Compare l'horodatage de l'APK au dernier fichier modifié avant de conclure que
tu testes bien le code courant.
