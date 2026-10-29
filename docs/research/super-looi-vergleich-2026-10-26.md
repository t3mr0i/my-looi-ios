# Super LOOI und die integrierten LOOI-Apps

Stand: 26. Oktober 2026. Frage: Liefert `GrinZero/super-looi` weitere Bausteine
für unsere gemeinsame Reachy-/MicroDuck-Schicht, Medienintegration oder Apps?

Geprüft wurde der aktuelle Upstream-Stand
[`9985101d840e1ec1a6bbb022bccb1b0eb369b3d6`](https://github.com/GrinZero/super-looi/commit/9985101d840e1ec1a6bbb022bccb1b0eb369b3d6)
vom 30. Juni 2026. Der rekursive GitHub-Baum enthält 227 Einträge und wurde
vollständig geliefert. Vergleichsbasis ist der aktuelle My-LOOI-Arbeitsbaum.

## Ergebnis

Super LOOI ist bereits die Herkunft eines Teils unserer Implementierung. Die
Abstammung ist in unserem [README](../../README.md#origins-and-evolution) und
den [Acknowledgements](../../ACKNOWLEDGEMENTS.md) dokumentiert. Der aktuelle
Upstream bietet eine nützliche Protokollreferenz; ein zusätzlicher App-Host,
Python-App-Runner oder WebRTC-Stack wurde in diesem Stand nicht gefunden.
Der [Upstream-Überblick](https://github.com/GrinZero/super-looi/blob/9985101d840e1ec1a6bbb022bccb1b0eb369b3d6/README.md)
beschreibt das BLE-SDK, eine Expo-App und lokale Dienste für LLM, Memory und Tools.

## Abgleich der Bausteine

| Baustein | Upstream-Befund | Bereits in My LOOI / Bedeutung |
| --- | --- | --- |
| Roboter-SDK | `LooiTransport` trennt die Verbindung von `LooiRobot`; Bewegung, Kopf, Licht, Dock-Meldungen und Raw Writes. [Quelle](https://github.com/GrinZero/super-looi/blob/9985101d840e1ec1a6bbb022bccb1b0eb369b3d6/packages/looi-sdk/README.md) | Derselbe Ansatz steckt bereits im [Workspace-SDK](../../packages/looi-sdk/src/index.ts). Unser [LOOI-Backend](../../src/robot-bridge/looi-backend.ts) nutzt den lokalen Controller darüber. |
| BLE-Protokoll | FED0/FED1/FED2/FED9 sowie feste Richtungs-, Kopf- und Lichtwerte. [Quelle](https://github.com/GrinZero/super-looi/blob/9985101d840e1ec1a6bbb022bccb1b0eb369b3d6/packages/looi-sdk/src/index.ts#L1-L53) | Werte sind schon vorhanden. Der lokale SDK-Code ergänzt u. a. Handshake-Fallbacks und Abbruchschutz beim asynchronen Bewegungsstart. |
| Sensor-Lebenszyklus | `Perceiver`, `BasePerceiver` und `PerceiverManager` vereinheitlichen Start, Stop und Observations. [Schnittstelle](https://github.com/GrinZero/super-looi/blob/9985101d840e1ec1a6bbb022bccb1b0eb369b3d6/src/core/perceiver.ts), [Manager](https://github.com/GrinZero/super-looi/blob/9985101d840e1ec1a6bbb022bccb1b0eb369b3d6/src/core/perceiver-manager.ts) | Beide Dateien sind im Vergleich bytegleich vorhanden. Unsere Medienübergabe setzt auf diesem Lebenszyklus auf. |
| Tool-Aufrufe | Versionierter WebSocket mit `client.register`, `tool.call` und `tool.result` für fest registrierte Gerätefunktionen. [Quelle](https://github.com/GrinZero/super-looi/blob/9985101d840e1ec1a6bbb022bccb1b0eb369b3d6/docs/device-tools.md) | Brauchbares Referenzmuster für Geräteaufrufe. Unsere Robot-Core-Sitzungen und Protokolladapter übernehmen inzwischen die externe App-Steuerung. |
| Kamera und Audio | Kamera puffert Einzelbilder und fragt den Vision-Dienst ab; Audio-/Videoaufnahme-Tools sind im Upstream als Platzhalter bezeichnet. [Kamera](https://github.com/GrinZero/super-looi/blob/9985101d840e1ec1a6bbb022bccb1b0eb369b3d6/src/perceivers/camera-perceiver.ts), [Tool-Dokumentation](https://github.com/GrinZero/super-looi/blob/9985101d840e1ec1a6bbb022bccb1b0eb369b3d6/docs/device-tools.md) | Die aktuelle Medienintegration verwendet stattdessen unseren nativen Media-Broker und WebRTC-Peer. |
| Apps und Katalog | Im geprüften [Baum](https://github.com/GrinZero/super-looi/tree/9985101d840e1ec1a6bbb022bccb1b0eb369b3d6) und den untersuchten Quellen kein Reachy-/MicroDuck-App-Host, HF-Katalog oder Python-App-Lebenszyklus gefunden. | Diese Funktionen liegen in [src/robot-bridge](../../src/robot-bridge), [services/robot-bridge](../../services/robot-bridge) und der nativen [Apps-Seite](../../src/ui/RobotAppsScreen.tsx). |

Die Gleichheit der Perceiver-Dateien wurde mit Git-Blob-Hashes geprüft:

- `src/core/perceiver.ts`: `0e166a96c89e200af34a6d537ab1aafffa29a3e3`.
- `src/core/perceiver-manager.ts`: `a1f50b9f12e33890a648651e4171cd9af46ca843`.

Die lokale SDK-Datei ist bewusst weiterentwickelt: lokaler Blob
`a2b594355efd35f0e259f049422f462307bb2722`, Upstream
`18753008887f4c01016087565fed738440ff88e5`.

## Technische Einordnung

Aus dem Vergleich folgt: Die vorhandene LOOI-SDK-Basis weiterverwenden und die
Reachy-/MicroDuck-Übersetzung an unserem gemeinsamen Kern halten. Ein Import des
alten Upstream-Controllers würde keine neu entdeckte App-Funktion ergänzen.
Sein Wert liegt für diese Arbeit vor allem in der Herkunft und Dokumentation
des BLE-Protokolls und der Transport-Schnittstelle.

Der Upstream-Quellstand enthält keinen Nachweis für neue kalibrierte
Geschwindigkeitsbefehle oder gemessene Kopfposen. Die genannten Raw Writes
sind kein solcher Nachweis; dafür wären Firmware-Dokumentation oder Messungen
nötig. Das ist eine technische Feststellung für die Implementierung und keine
zusätzliche Meldung in der Apps-Oberfläche.

Diese Prüfung hat keine Produktionsdateien verändert und keinen externen Code
installiert oder ausgeführt. Sie bewertet den gepinnten öffentlichen `main`-Stand;
unveröffentlichte Firmware und lokale Änderungen des Upstream-Autors wurden
nicht untersucht.
