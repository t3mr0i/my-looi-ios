# Mock-Auswahl im Simulator nach Neustart erhalten

Stand: 26. Oktober 2026. Begrenzte Verbesserung des vorhandenen Mock-Testablaufs
nach erneuter Anwendung von `better-function`.

## Ausgangspunkt und Auftrag

Der Mac war wieder bedienbar. Die tatsächliche native App im eigenen Simulator
„LOOI Expression Review“ zeigte beim Lesen und Speichern in SecureStore
`KeyChainException: A required entitlement isn't present`. Die Auswahl
„Simulierter Roboter“ funktionierte im Arbeitsspeicher; nach Beenden und erneutem
Start war wieder „Hardware“ ausgewählt. Damit war ein erfolgreicher Build noch
kein brauchbarer Test der gespeicherten Roboterverbindung.

Der relevante Engpass liegt hier im Testpaket: Der kanonische Befehl in
`scripts/build-ios-simulator.sh` setzte `CODE_SIGNING_ALLOWED=NO`. Die installierte
App war nur linker-signiert, hatte den Signaturbezeichner `MyLOOI` und keine
gebundenen Ressourcen. Die lokale Expo-SecureStore-Implementierung verwendet
Apples Keychain; die Verbindungseinstellung wird dort bereits gespeichert.
Ein Austausch der Speicherimplementierung würde am falschen Ende ansetzen.

Der Arbeitsauftrag lautet: Ein lokal signiertes Simulatorpaket bauen, das die
vorhandene Speicherung tatsächlich verwenden kann, und den kanonischen
Buildpfad entsprechend korrigieren. Erfolg bedeutet dieselbe ausgewählte
Mock-Verbindung vor und nach einem vollständigen App-Neustart, ohne den
beobachteten Keychain-Fehler. Geräte-Signierung, Speicherformat und
Roboterbefehle gehören nicht zur Änderung.

Die Rohmaterialien sind der Build-Befehl, die Xcode-Einstellungen, die tatsächliche
Paket-Signatur, `expo-secure-store/ios/SecureStoreModule.swift` sowie die native
Roboterdiagnose. Der unabhängige Nachweis ist die vorher fehlgeschlagene und
anschließend erfolgreiche Speicherung über einen Neustart hinweg.

## Umsetzung und beobachtetes Ergebnis

Der Simulator-Build verwendet jetzt:

```sh
CODE_SIGNING_ALLOWED=YES 'CODE_SIGN_LOCAL_EXECUTION_IDENTITY=Ad Hoc'
```

Die vorhandene leere Quell-Entitlements-Datei bleibt bestehen. Xcode erzeugte
für dieses Paket die `application-identifier` in der simulierten Entitlements-
Datei. Die Ausgabe von `codesign -d --entitlements -` war dabei ein leeres
Dictionary; sie darf für diese Simulatorfassung nicht allein als Gegenbeweis
interpretiert werden. Die tatsächlich installierte App entscheidet den Test.

Nach dem Build zeigt `codesign -dv` den Bezeichner
`io.github.razor79.mylooi`, eine Ad-hoc-Signatur und versiegelte Ressourcen.
`codesign --verify --deep --strict` besteht. Das neu installierte Paket liest
den leeren Schlüsselzustand korrekt und öffnet die Einrichtung. Von dort ist
die Roboterdiagnose weiterhin ohne API-Schlüssel erreichbar.

| Native Bedienfolge | Vorher | Nachher |
|---|---|---|
| Roboterdiagnose öffnen | Fehler bei `getValueWithKeyAsync` | Kein Keychain-Fehler |
| „Simulierter Roboter“ wählen | Verbunden, aber Fehler bei `setValueWithKeyAsync` | Ausgewählt und verbunden, ohne Speicherfehler |
| App vollständig beenden und neu starten | Auswahl zurück auf „Hardware“, nicht verbunden | „Simulierter Roboter“ bleibt ausgewählt und verbunden |
| Offline-Szenario „Neugier“ ausführen | Bereits im Arbeitsspeicher ausführbar | „Bestanden“, eine simulierte Entscheidung und ein Gestenversuch |

Die [native Vorher-Beobachtung](evidence/simulator-mock-persistence-before-2026-10-26.txt)
und [Nachher-Beobachtung nach Neustart](evidence/simulator-mock-persistence-after-2026-10-26.txt)
sind gespeichert. Die [Nachher-Ansicht](evidence/simulator-mock-persistence-after-2026-10-26.png)
zeigt die native Diagnose. Eine weitere
[Aufnahme](evidence/simulator-native-face-replay-2026-10-26.png) zeigt die
native Gesichtsansicht nach der langsamen Phasenwiedergabe; sie ist kein
Nachweis aller Zwischenbilder oder sozialer Wirkung. Der Replay-Start zeigte
„Vorbereitung“ und kehrte anschließend zum bereiten Zustand zurück.

Der kanonische Simulator-Befehl behält Vorbereitung, Pods, Debug-Konfiguration,
Jobs und Buildlog bei. Er prüft nun zusätzlich die tatsächliche App mit
`codesign --verify --deep --strict`. Die bestehende CI-Stufe ist passend
umbenannt; `docs/ios.md` beschreibt die lokale Signierung.

## Ausgeführte Prüfungen und Grenzen

- Tatsächlicher Release-Simulatorbuild mit den oben genannten Signieroptionen:
  `BUILD SUCCEEDED`; Log `/private/tmp/my-looi-simulator-keychain-signing-build.log`.
- Installation und native Bedienung im eigenen Simulator; vollständiger
  Neustart vor und nach der Korrektur mit beobachteter Modusauswahl.
- Native Einrichtung im Hochformat: Schlüssel-Eingabefeld sichtbar und
  fokussierbar. Softwaretastatur und tatsächliche Schlüssel-Eingabe wurden
  in diesem Lauf nicht abgenommen.
- `bash -n scripts/build-ios-simulator.sh` und die Diff-Whitespace-Prüfung bestehen.
  Der vollständige kanonische Debug-Aufruf einschließlich erneuter Modell-
  Vorbereitung und Pods wurde nicht wiederholt. Der native Release-Aufruf
  prüfte die tatsächlichen Signieroptionen und das installierte Paket.

Zusätzlich war das physische iPhone wieder erreichbar. Das vorbereitete
Gerätepaket 2.1.151 (Build 41) wurde dort erfolgreich installiert und
gestartet. Die eingeschränkte lokale Signaturprüfung lieferte zunächst
`CSSMERR_TP_NOT_TRUSTED`; derselbe Befehl außerhalb der eingeschränkten
Ausführungsumgebung bestand. Es wurde keine Vertrauenseinstellung verändert. Die anschließende
Bildschirmprüfung zeigte den Sperrbildschirm des iPhones. Die neue native
Bedienfolge auf dem physischen Gerät bleibt deshalb offen.

Diese Korrektur macht den Mock-Test über App-Neustarts hinweg brauchbar.
Sie verändert weder die gemessene Wahrnehmungsgrenze bei ähnlichen Gegenständen
noch die ausstehende Sprach-, Kamera- oder Hardwareabnahme.
