# Reachy upstream acceptance

Stand: 2026-10-26. Diese Abnahme lief gegen den lokalen LOOI-Demo-Companion, ohne Hardware, Kamera, Mikrofon, Medien, Modellzugriff, API-Schlüssel oder kostenpflichtige Dienste.

## Gepinnte Quellen

| Projekt | Version | Quelle / Revision |
| --- | --- | --- |
| Offizielles `reachy_mini` Python-SDK | `1.13.0.dev0` | `pollen-robotics/reachy_mini`, `9fb2bfcbdf4c9800b0649acb8f0c18027673943f` |
| Offizielle Clock-App `reachy_mini_clock` | `0.1.0` | Hugging Face Space `pollen-robotics/reachy_mini_clock`, `e8b4a4ea44116d881b940b5ea210fe5e69e162e4` |
| Acceptance-Runtime | Python `3.12.13` | Isolierte temporäre Umgebung unter `/private/tmp/looi-upstream-reachy-acceptance/.venv` (nach Abschluss entfernt) |

Die Clock-App deklariert `reachy-mini` ohne Versionspin und `pytz==2025.2`. Sie registriert den unveränderten Python-Einstiegspunkt `reachy_mini_clock.main:ReachyMiniClock`. Ihr `run()`-Loop fragt die Gelenkpositionen ab und sendet Kopf-/Antennenbewegungen. Die App fordert keine Kamera oder Audio an.

## Ergebnisse

| Prüfung | Ergebnis | Nachweis |
| --- | --- | --- |
| Offizieller Reachy-SDK-Verbindungspfad | PASS | Ein echter SDK-Prozess lief über `ReachyMiniApp.wrapped_run()` gegen den LOOI-Demo-Companion. Startup-Status, Gelenk-/Kopfzustand, `wake_up`, `goto_target`, `set_target`, `RecordedMove`/`play_move`, `goto_sleep` und Kontext-Close wurden ausgeführt. |
| `set_target`-Wire-Vertrag | PASS | Das SDK sendet für optionale Felder unter anderem `body_yaw: null`. Der Adapter akzeptiert diese Wire-Nullwerte als ausgelassen, übernimmt die übrigen Antennen-/Kopfwerte in den Demo-State und weist ungültige numerische Werte weiterhin zurück. Regressionen liegen in `scripts/robot-bridge-reachy.test.mjs`. |
| Unveränderte Clock-App über den echten Runner-Lifecycle | PASS (begrenzte Installation) | Das unveränderte App-Paket wurde lokal mit `pip install --no-cache-dir --no-deps --no-build-isolation --force-reinstall` in der isolierten SDK-Umgebung installiert. Die echte `createAppRunner`-Hydration, der offizielle Entry-Point/`ReachyMiniApp`-Start, ein adaptiertes Bewegungskommando und `runner.stop()` liefen gegen den Demo-Companion. Runner-Medienbackend: `no_media`; App-Prozess während des Laufs: `running`; Demo-Resultat: `adapted`; Stop: `stopped`; `measuredPose`: `null` (simuliertes Backend). |
| App-Store-Auflösung | PASS | Der Live-Katalog löste `pollen-robotics/reachy_mini_clock` mit der erwarteten Revision und `kind=python` auf. |
| Vollständiger App-Store-Installationspfad mit allen Abhängigkeiten | FAIL (Platzmangel) | `createAppRunner.install(spaceId,{revision})` startete den echten Venv-/Pip-Installationspfad. Pip wählte wegen des ungebundenen `reachy-mini` die stabile Version `1.13.0`; der Install scheiterte mit `OSError: [Errno 28] No space left on device` beim Wheel `gstreamer_gtk==1.28.8` (20,4 MB; erst etwa 0,5 MB verarbeitet). |
| Kamera, Audio und WebRTC der App | NICHT GEPRÜFT | Die Clock-App verwendet diese APIs nicht; der erfolgreiche Lauf war ausdrücklich `no_media`. Das ist kein Nachweis für Reachy-Apps, die Video-/Audio-Streams oder WebRTC tatsächlich konsumieren. |

Der vollständige Installationsversuch hatte nach dem Fehler ungefähr 215 MiB frei. Damit ist der exakte Platzbedarf des vollständigen Environments nicht bestimmt: Schon für das genannte Wheel fehlten mindestens 19,9 MB Downloadplatz; zusätzlich sind Entpacken und die übrigen SDK-/GStreamer-Abhängigkeiten erforderlich. Der fehlgeschlagene Install hatte unter anderem bereits Wheels für `reachy_mini==1.13.0` (24,3 MB) und `onnxruntime==1.27.0` (18,4 MB) abgerufen. Nach dem Aufräumen zeigte `df -h /private/tmp` 874 MiB frei; diese Messung ist ein Momentwert und keine Zusage, dass ein vollständiger Install hineinpasst.

Der erfolgreiche App-Lauf verwendete absichtlich das vorhandene gepinnte SDK `1.13.0.dev0`, installierte das App-Paket aber ohne transitive Abhängigkeiten und nutzte das bereits vorhandene `pytz==2025.2`. Für den App-Webserver wurde ausschließlich im Test-Bootstrap die Bind-Adresse `0.0.0.0:8080` auf Loopback geändert; der offizielle App-Quelltext blieb unverändert. Der App-Runner seedete für diese begrenzte Probe sein Installed-Registry-/Venv-Verzeichnis, damit sein echter `start`-/`stop`-Pfad und der originale Entry-Point laufen konnten. Deshalb belegt diese PASS-Prüfung **nicht** den vollständigen Download-/Installationspfad.

## Befehle

Die Quelltrees und Skripte bleiben unter `/private/tmp/looi-upstream-reachy-acceptance` beziehungsweise im Repository. Die 1,2-GiB-Acceptance-`.venv` wurde nach den Tests auf Anweisung entfernt. Ein erneuter Start benötigt zuerst eine neue isolierte Python-3.12-Umgebung mit dem SDK und `pytz`:

```sh
ACCEPT=/private/tmp/looi-upstream-reachy-acceptance
uv python install 3.12
uv venv --python 3.12 "$ACCEPT/.venv"
uv pip install --python "$ACCEPT/.venv/bin/python" --no-cache -e "$ACCEPT/reachy_mini"
uv pip install --python "$ACCEPT/.venv/bin/python" --no-cache 'pytz==2025.2'
"$ACCEPT/.venv/bin/python" -m pip install --no-cache-dir --no-deps --no-build-isolation --editable "$ACCEPT/reachy_mini_clock"
```

Die beiden bereits ausgeführten SDK-/App-Probes lassen sich anschließend so wiederholen:

```sh
REACHY_UPSTREAM_PYTHON="$ACCEPT/.venv/bin/python" node scripts/robot-bridge-upstream-reachy.test.mjs
REACHY_UPSTREAM_PYTHON="$ACCEPT/.venv/bin/python" node scripts/robot-bridge-upstream-reachy-app.test.mjs
```

Der erste Befehl führt den SDK-/RecordedMove-Pfad aus. Der zweite löst erneut den Live-Katalog auf, installiert nur das lokale App-Paket mit `--no-deps`, seedet das Runner-Registry für die begrenzte Probe und startet/stoppt die offizielle App. Für einen erneuten **vollständigen** App-Store-Installationsversuch gibt es den expliziten Probe-Entrypoint:

```sh
node scripts/robot-bridge-upstream-reachy-install-probe.mjs
```

Er ruft `createAppRunner.install(spaceId,{revision})` auf; der Runner führt dafür intern `python -m venv <app>/venv` und danach `python -m pip install --no-input --disable-pip-version-check git+https://huggingface.co/spaces/<spaceId>@<revision>` aus. Er nutzt `PYTHON` oder andernfalls `python3` und löscht sein ausschließlich dafür vorgesehenes temporäres Runner-Verzeichnis nach Ausgabe des Ergebnisses. Der Befehl kann das vollständige SDK-/GStreamer-Abhängigkeitsset herunterladen; wegen des dokumentierten ENOSPC-Fehlers wurde er nach dem ersten Lauf nicht wiederholt.

## Akzeptanzgrenze

Nachgewiesen ist die Kompatibilität des gepinnten offiziellen Reachy-SDK-Bewegungspfads sowie einer echten offiziellen Python-App im Runner-Lifecycle auf dem LOOI-Demo-Backend. Für ein vollständiges „App-Store-App installieren und ausführen“ fehlt noch ein Installationslauf mit ausreichend freiem Speicher; Medienkompatibilität erfordert zusätzlich eine Reachy-App, die Kamera, Audio oder WebRTC verwendet. Ein reales LOOI-Gerät war nicht angeschlossen, daher ist keine Hardwarebewegung nachgewiesen.
