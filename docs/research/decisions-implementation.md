# Decisions-Verhaltensschicht: Umsetzung und Prüfung

Stand: 25. Oktober 2026. Ausgangspunkt ist die [Verhaltensarchitektur](decisions-verhaltensarchitektur.md); Bedienung und Datenfluss stehen im [Behavior Guide](../decisions-behavior.md).

Alle zehn vorgeschlagenen Mechanismen besitzen jetzt einen ausführbaren Softwarepfad. Der optionale Layer ist zunächst ausgeschaltet. Seine Wirkung auf Natürlichkeit, echte Netzwerklatenz und die konkrete Mechanik ist damit noch nicht gemessen.

## Abdeckung

| Mechanismus | Implementierung | Geprüfte Grenze |
|---|---|---|
| Gesprächshaltung | Akzeptierte Benutzerturns und tatsächlich beendete Audioausgabe liefern Ereignisse. Decisions wählt einen begrenzten Cue; die Engine führt Haltung und Wiederholungen fort. | Ein Cue pro Benutzerturn; 800-ms-Startfrist für Eingabe/Gesichter, nach hörbarem Antwortende bis zu 1.800 ms ab Ereignis (siehe [Timing-Korrektur](decisions-timing-2026-10-26.md)); neue Sprache verwirft alte Effekte. Kein Warten auf Decisions vor gewöhnlichen Sprachantworten. |
| Absicht über Unterbrechungen | Lokaler, versionierter Aufgabenstatus mit explizitem Pausieren, Fortsetzen und Verwerfen sowie Realtime-Kontext. | 24 Stunden Verfall; nach Neustart pausiert; keine Wiederaufnahme einer Motorsequenz. Fragen, Negationen und Zitate sind keine lokalen Befehle. |
| Zusammengehöriger Ausdruck | Eine Cue-ID verbindet Display-Mood, Blick und optionales Kopfmakro. | Gemeinsame Generation; neue Interaktion entfernt die Präsentation. Eine neuere manuelle Gesichtsreaktion bleibt erhalten. |
| Begründetes Suchen/Loslassen | Decisions kann Zielhalten, begrenzte Suche oder Freigabe wählen; lokale Social Attention führt aus. | Explizite Pause hat Vorrang. Freigabe unterdrückt physische Suche/Rezentrierung, während lokale Sichtung möglich bleibt. |
| Beobachtung verbessern | Der explizite PCM-Bildpfad fragt vor seiner Sprachantwort nach Task-Eignung des Einzelbilds. | Separates Opt-in, höchstens zwei Sekunden Wartezeit, kein automatischer Bildstrom. Alte Aufnahme-/Assessment-Fortsetzungen starten keine Antwort. |
| Rituale und eigener Stil | Ausdrücklich vereinbarte Begrüßungsmotive, Herkunft, Wiederholungszähler sowie „weniger nicken“/„spielerisch lebhafter“ werden lokal gespeichert. | Gerätepräferenz, keine Personenerkennung; Cooldown und Nod-Sperre schlagen eine Modellwahl. Lernen lässt sich löschen. |
| Selbstkorrektur | Explizite Korrektur erhöht die Referenzversion, verwirft den alten Cue/Aufmerksamkeitsplan und ergänzt Reparaturkontext für Realtime. | Kein behaupteter Objektort und keine daraus erfundene Bewegung. |
| Kandidatenvergleich | Optionale Scores vergleichen ruhiges Warten, Neugier und Freude im selben Request mit einer gemeinsamen 0–4-Rubrik. | Keine Multiplikation von Konfidenzen; Scores sind keine kalibrierte physische Wahrheit. |
| Mehrere Menschen | Native iOS-/Android-Detektoren exportieren mehrere Kandidaten; lokale temporäre Tracks erhalten das gewählte Ziel trotz Größen-/Reihenfolgewechsel. | Maximal acht JS-Kandidaten; veraltete Sichtung wird entfernt; keine Identität oder zuverlässige Sprecherzuordnung. |
| Gemeinsames Spiel | Ein ausdrücklich gestartetes Zahlenspiel 1–3 besitzt lokale Lösung, Versuche, Ergebnis und begrenzte Laufzeit. Realtime spricht den aktuellen Stand aus. | Lösung bleibt aus dem Sprachkontext. Nur im aktiven Spiel manuelle Antwortsteuerung; Start/Sieg jeweils eine Antwort nach Kontextupdate. Barge-in verhindert eine verspätete Antwort. |

## Technischer Unterbau

- `src/openai/decisions.ts`: typisierter `/v1/decisions`-Client mit Choice/Predicate/Score, striktem Request-/Response-Vertrag, begrenzten Größen, Abbruch und Gesamtdeadline. Keine API-Schlüssel oder Bildinhalte in Logs.
- `src/behavior/behavior-engine.ts`: injizierbare semantische Engine, ein logischer Request gleichzeitig, Zusammenfassen wartender Ereignisse, Rate-Abstand, Fehler-Backoff, Generationen, Budget und lokale Zustände.
- `src/behavior/behavior-runtime.ts`: App-/Screen-/Schlaf-/Sprech-/Fahrzustand, MMKV, Zustand für Display/Settings und begrenzte Aktionsausführung. Unveränderte Sensorevidenz führt nicht zu wiederholten Speicherwrites.
- `src/behavior/behavior-events.ts`: sessionspezifische Brücke für beide Realtime-Transporte. Veraltete Sessions und visuelle Revisionen werden verworfen.
- `src/device-tools/looi-robot.ts`: serialisierter Kopf-Writer mit Priorität explizit → sozial → Verhalten → Ambient. Jeder Schritt prüft Gültigkeit. Spätes Behavior-Cleanup kann einen neueren expliziten Besitzer nicht abbrechen. STOP/Disconnect können alle Besitzer abbrechen.
- `src/core/face-target-tracking.ts`: kurzlebige lokale Zuordnung von Gesichtskandidaten. Native und JS-Uhren werden nicht gegeneinander subtrahiert.

Observe sendet Requests und zeichnet Ergebnisse auf, führt aber keine Cues oder gesprochenen Verhaltenskontexte aus. Active verwendet denselben Unterbau für echte Effekte. Off sendet keine Decisions-Requests. Alle Modi behalten die vorhandenen lokalen Bewegungsinterlocks.

Die Budgetführung reserviert vor dem Request konservativ Kosten und verrechnet zurückgelieferte Usage genau einmal. Späte, bereits veraltete Antworten werden weiterhin abgerechnet. Unbekannte Kosten abgebrochener Requests bleiben konservativ im Tagesledger. Ein Lernreset setzt dieses Ledger nicht zurück. Das ist eine lokale Ausgabenbremse und kein harter OpenAI-Abrechnungscap.

## Durchgeführte Prüfungen

| Prüfung | Ergebnis und Aussage |
|---|---|
| `pnpm run ios:check` | PASS: vollständiges TypeScript-Checking sowie bestehende iOS-, Audio-, Session-, BLE-, Lifecycle-, Memory- und neue Behavior-Regressionsprüfungen. |
| `pnpm run behavior:test` / dieselben acht Skripte in `ios:check` | PASS: HTTP-Vertrag, Engine, Voice-Brücke, Runtime, echte PCM-/WebRTC-Serviceklassen mit simulierten Schnittstellen, Bewegungsarbitrierung, Face Tracks und mehrsprachige Absichtsregeln. |
| Engine → echter Client → simuliertes HTTP | PASS: ein gewöhnlicher Textturn passiert den strikten JSON-Vertrag und erzeugt nach validierter Antwort einen Cue. Keine echte API-Verbindung. |
| Character-, Cliff-, Deadman- und Social-Attention-Prüfungen | PASS: die vorhandenen Aktions-/Abbruch-/Kantenschutzpfade bleiben erhalten. |
| Expo iOS Export | PASS: Hermes-Bundle erfolgreich erzeugt. |
| Nativer generischer iOS-Simulator-Build | `BUILD SUCCEEDED`: Workspace `ios/MyLOOI.xcworkspace`, Scheme `MyLOOI`, Debug, `iphonesimulator`, ohne Signierung. Enthält die erweiterte Swift-Gesichtserkennung. |
| Gesamtes `pnpm test` | Nicht vollständig grün: v2.1.137 erwartet Android-JPEG-Aufnahme; v2.1.138 erwartet eine Rear-Camera-Auswahl-Signatur; v2.1.139/140 benötigen das fehlende Android-Modul `photo-picker-access`. Diese Android-Lücken bestehen bereits vor dem Behavior-Umbau. Die danach folgenden v2.1.143/144/151-Prüfungen wurden separat erfolgreich ausgeführt. |

Zusätzlich sind Gegenfälle abgedeckt: verspätetes Resultat nach neuem Turn/STOP/Sessionwechsel, wiederholter STOP mit gleichem Grund, verspätetes Transkript bei bereits neuer menschlicher Sprache, Visual-Barge-in, nicht endende API-Abhängigkeiten, Budget nach Neustart/Lernreset, Kopf-Übernahme während einer Verzögerung und zulässige explizite Restschritte nach spätem Behavior-Cleanup.

Der generische Simulator-Build ersetzte keine visuelle Abnahme. Bei der anschließenden Installation auf dem iPhone 16 mit iOS 27.0 wurden zwei native Startfehler behoben: kollidierende OpenFST-C++-Symbole von Vosk/Sherpa sowie das fehlende Scene-Modell des gepinnten Expo-56-Templates. Der korrigierte signierte Release-Build startet und zeigt die Ersteinrichtung; der Einrichtungslink und die Rückkehr zur App funktionieren. Settings-Aktivierung, echte API-Requests und Bewegungen auf dem Roboter stehen noch aus. Einzelheiten und aktueller Abnahmestand stehen im [iPhone-Prüfprotokoll](iphone-acceptance-2026-10-25.md).

## Physische Abnahme

Auf dem verbundenen Roboter in Active prüfen: ernstes Gespräch/spielerischer Satz, Pause/Fortsetzen, Korrektur, explizites Begrüßungsmotiv, Wechsel zwischen zwei sichtbaren Menschen, eine schlecht lesbare explizite Aufnahme sowie ein vollständiges Zahlenspiel. Jede Szene mit menschlichem Barge-in, STOP und App-Hintergrund unterbrechen. Erwartet werden ein verständlicher Anlass, höchstens ein kleiner Akzent und keine alte Fortsetzung nach Übernahme.

Mit echter Usage lassen sich anschließend Requestquote, Latenz, Verwerfungen und Kosten messen. Die in der Untersuchung beschriebenen A/B/C-Vergleiche und Menschenbewertungen bleiben erforderlich, um einen Natürlichkeitsgewinn gegenüber guten lokalen Regeln zu belegen. Raumverständnis, Objektlokalisierung, Navigation, kontinuierliche Motorregelung und neue Sensorhardware sind weiterhin eigenständige Erweiterungen.
