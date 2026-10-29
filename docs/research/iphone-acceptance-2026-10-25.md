# iPhone- und LOOI-Abnahme am 25. Oktober 2026

Umgebung: iPhone 16, iOS 27.0, Xcode 27.1, CocoaPods 1.16.2.
App: My LOOI 2.1.151, Build 41, signierter Release-Build mit eingebettetem
JavaScript-Bundle. Gerätekennungen, Signierungsdetails und API-Schlüssel sind
nicht Teil dieses Protokolls.

## Nachgewiesen

- Vollständiges `ios:check` einschließlich Decisions-, Behavior-, Audio-, BLE-
  und Lifecycle-Prüfungen bestanden. Diese Tests simulieren ihre externen
  Schnittstellen und ersetzen keine Hardware-Abnahme.
- Nativer Release-Build und Installation auf dem verbundenen iPhone bestanden.
- Der erste Start reproduzierte einen Fehler vor dem App-Einstieg:
  `EXC_BAD_ACCESS` in OpenFST-Flag-Initialisierern. Vosk und Sherpa brachten
  kollidierende C++-Symbole in dasselbe App-Binary ein.
- Der isolierte Vosk-Framework-Build beseitigte diesen Fehler. Alle 35 Vosk-
  C-Einstiegspunkte bleiben in den Geräte-/Simulator-Slices exportiert; interne
  C++-Symbole werden nicht exportiert. Vosk und Sherpa bleiben enthalten.
- Der nächste Start erreichte UIKit und reproduzierte einen zweiten Fehler:
  `UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`, `SIGTRAP`.
  Der Config-Plugin-Backport ergänzt das unter iOS 27 erforderliche Scene-Modell
  im gepinnten Expo-56-Template. Sechs gezielte Transformationsprüfungen
  einschließlich Idempotenz, Linking und Lifecycle-Weitergabe bestehen.
- Der Release-Build mit beiden Korrekturen und seine Signaturprüfung bestehen.
  Beim Update meldete iOS zu wenig freien Speicher für die temporäre zweite
  App-Kopie. Die frisch installierte, noch nicht eingerichtete Test-App enthielt
  laut Container-Dateiliste nur System-Caches und leere Dokument-/Einstellungs-
  Verzeichnisse. Sie wurde deshalb vor der Neuinstallation entfernt. Andere
  Apps oder persönliche Dateien wurden nicht verändert.
- Neuinstallation mit beiden Korrekturen bestanden. Die App startet auf dem
  iPhone und zeigt die englische Ersteinrichtung. Der Prozess bleibt am Leben;
  der Vosk-Decoder lädt ein Modell und baut seine Grammatiken ohne den früheren
  nativen Initialisierungsfehler auf.
- Der Einrichtungslink `mylooi://onboarding?step=openai` öffnet den vorgesehenen
  Schritt in der laufenden App. Die Rückkehr vom iPhone-Homebildschirm zur App
  ist sichtbar gelungen. Audio-/Kamera-Unterbrechungen sind damit noch nicht
  geprüft.

## Noch zu prüfen

| Abnahme | Status |
|---|---|
| Kaltstart mit beiden nativen Korrekturen | PASS: Ersteinrichtung sichtbar, kein erneuter nativer Absturz |
| Einstellungen visuell prüfen und Active aktivieren | Ausstehend |
| API-Schlüsselstatus und echte Decisions-Antwort | Schlüssel fehlt; Eingabe durch Nutzer angefragt. Echte API-Antwort ausstehend |
| Hintergrund/Vordergrund auf dem iPhone | UI-Rückkehr PASS; laufende Audio-/Kamera-Session noch nicht geprüft |
| BLE-Verbindung, Kopfgesten und STOP am echten LOOI | Ausstehend: Nutzer meldet Roboter noch nicht bereit |
| Natürlichkeit, Latenz, Unterbrechung, Kamera, Spiel | Ausstehend |

Es wurde bisher keine erfolgreiche physische Verhaltensabnahme und kein
gemessener Natürlichkeitsgewinn behauptet. Die aktuelle Testbereitschaft des
Roboters muss vor Bewegungen bestätigt sein.
