---
name: appareil-android
description: Use when running, installing or debugging an app on a physical Android device or emulator from this machine — adb, flutter run, flutter devices, APK install, logcat, "no devices found", "adb protocol fault", "ADB exited with exit code -15". Explains that this is a Lima VM on macOS whose adb server belongs to the host. Déclencher aussi sur "tester sur le téléphone", "Pixel", "appareil physique", "brancher", "installer l'APK", "adb ne voit rien".
---

# Tester sur un appareil Android

## Limite de la VM

Cette machine est une VM Lima sur macOS. Le téléphone est branché au Mac, pas
à la VM. Le serveur adb accessible sur `127.0.0.1:5037` depuis la VM appartient
à l'hôte et tient l'USB. L'absence de `/dev/bus/usb` ou un `lsusb` vide ne
prouve donc pas l'absence d'appareil.

En cas de doute :

```bash
systemd-detect-virt        # apple
ip -4 addr show scope global | grep lima0
```

## Quand adb ne voit rien

`adb: failed to check server version: protocol fault` signifie généralement que
le forward Lima répond, mais que le daemon adb de l'hôte est arrêté. Depuis la
VM, distingue les cas :

```bash
ss -ltn | grep 5037
python3 -c "import socket; c=socket.create_connection(('127.0.0.1',5037),timeout=3); c.sendall(b'000chost:version'); print(repr(c.recv(64)))"
```

- `OKAY0004...` : serveur vivant.
- `Connection reset by peer` : forward vivant, daemon hôte mort.
- `Connection refused` : aucun forward.

Dans le cas reset, demande à l'utilisateur d'exécuter `adb devices` sur le Mac.
Ne pars pas vers le wireless debugging avant cette vérification côté hôte.

## Variables adb

`ANDROID_ADB_SERVER_PORT` est ignorée. `adb -P <port>` cible un serveur local.
`ADB_SERVER_SOCKET=tcp:h:p` cible un serveur distant déjà lancé. Flutter
n'honore que `ADB_SERVER_SOCKET`.

Avant `adb` ou `flutter build`, vérifier que `ANDROID_SDK_ROOT` désigne un SDK
existant et que `$ANDROID_SDK_ROOT/platform-tools` est dans le `PATH`. Le chemin
concret et la valeur de `ADB_SERVER_SOCKET` sont propres à la machine et doivent
être lus dans `AGENTS.local.md`, jamais devinés ni recopiés dans un dépôt.

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
