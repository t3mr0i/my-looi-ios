# My LOOI — vollständiges Research- und Entscheidungsbriefing für Agenten

**Dokumenttyp:** eigenständig ausführbarer Rechercheauftrag mit Projektkontext, Vorrecherche, Quellenregister und Ausgabevorlagen. **Sprache:** Deutsch. **Erstellt:** 25. Oktober 2026. **Forschungshorizont:** heute bis 2028. Dieses Dokument ersetzt für diesen Auftrag die verstreuten Briefingfassungen aus dem Chat; der Chat wird zum Verständnis nicht benötigt.

**Repository:** [t3mr0i/my-looi-ios](https://github.com/t3mr0i/my-looi-ios). **Geprüfter Quellstand:** `09374b5904e5f0efdc89209e8dda0a9a78b35497`. Der Remote-Branch `origin/work` wurde am Dokumenttag konfliktfrei per Fast-Forward in die lokale `main` übernommen. Die frühere lokale `main` auf `c9d94ce` enthielt die iOS-Portierung noch nicht. Vor jeder Analyse den tatsächlichen Checkout feststellen. Branch-Namen allein sind kein Versionsnachweis.

**Wichtig:** Dies ist der Auftrag für die große Recherche, nicht deren fertiger Ergebnisbericht. Die vorhandene Vorrecherche belegt ausgewählte Ausgangsfakten. Kandidaten, Architekturvorschläge und Versuchsdesigns sind ausdrücklich zu prüfende Vorschläge. Eine Quelle im Register bedeutet nicht, dass bereits jede darin enthaltene Behauptung bewertet wurde.

## Inhaltsübersicht

1. Auftrag, Entscheidungen und Nutzerpräferenzen
2. Arbeitsweise, Grenzen und Evidenzregeln
3. Produktidee und gegenwärtiger Funktionsumfang
4. Repository, iOS-Portierung und technische Orientierung
5. LOOI-Hardware, Hersteller-App und Entwicklerzugang
6. OpenAI Decisions, GPT-Live und bestehendes Realtime
7. Systematische OpenAI-Recherche
8. Forschungsfelder und Startkandidaten
9. Architektur, Datenflüsse und Verhaltensschnittstellen
10. Experimente, Messung und Hardware-Abnahme
11. Kosten, Aufwand und Forschungshorizont
12. Arbeitspakete und Agentenübergaben
13. Verbindliche Ergebnisse und Vorlagen
14. Quellenregister, offene Fragen und Abschlussprüfung
15. Kurzer Startauftrag zum Weitergeben

## 1. Auftrag, Entscheidungen und Nutzerpräferenzen

Du bist Research Lead für KI-Produkte, mobile Anwendungen und Mensch-Roboter-Interaktion. Führe eine aktuelle, tiefgehende Recherche durch, die konkrete Entwicklungsentscheidungen für My LOOI ermöglicht. Suche außergewöhnlich nützliche Funktionen und ambitionierte technische Ansätze. Untersuche auch Fähigkeiten, deren erste Version heute erprobbar ist, deren zuverlässiger Alltagseinsatz aber weitere Fortschritte bis 2028 voraussetzt.

Die Hauptfrage lautet: **Welche Erweiterungen erzeugen gegenüber unserer bestehenden App einen überprüfbaren Nutzen, welche profitieren tatsächlich vom physischen Roboter, und welche kleinsten Experimente entscheiden, ob wir sie bauen sollten?**

Die Recherche soll insbesondere diese Entscheidungen ermöglichen:

- Welche drei Entwicklungs- oder Forschungsversuche sollten zuerst stattfinden?
- Welche Nutzerprobleme sind dafür plausibel genug, obwohl Zielgruppe und Geschäftsmodell noch nicht feststehen?
- Welche OpenAI-Fähigkeiten fehlen unserer heutigen Nutzung, und welche lohnen sich konkret?
- Brauchen ausgewählte Funktionen einen Backend-Dienst, einen anderen Sprachpfad oder zusätzliche Sensorzugriffe?
- Welche Voraussetzungen müssen wir schaffen, welche können bis zu einem positiven Versuch warten?
- Welche attraktiven Ideen sollten wir ausdrücklich zurückstellen?

### Verbindliche Präferenzen

Cloud-KI ist ausdrücklich erwünscht und darf bevorzugt werden, wenn dadurch das bessere Produkt entsteht. „Local first“ beschreibt die bisherige Architektur und ist keine Vorgabe für zukünftige Funktionen. Es gibt keinen grundsätzlichen Offline-Zwang. Vergib keinen pauschalen Bonus für lokale Verarbeitung.

OpenAI ist ein gewünschter Schwerpunkt. Untersuche Modelle, APIs, Werkzeuge und Entwicklungsinfrastruktur systematisch. Die Präferenz darf jedoch keine Eignung vortäuschen. Vergleiche Alternativen dort, wo sie eine konkrete Entscheidung verändern; ein vollständiger Marktvergleich aller Anbieter ist nicht erforderlich.

Ein eigener Backend-Dienst ist erlaubt, ebenso Cloud-Speicher, serverseitige Erinnerungen, Orchestrierung, Hintergrundaufgaben und hybride Verarbeitung. Begründe jede zusätzliche Komponente durch konkrete Funktionen, Datenflüsse, Kosten und Betriebsaufwand.

Lokale Verarbeitung ist dort sinnvoll, wo sie praktisch überlegen ist: unmittelbare Bewegungsgrenzen, schnelle Reaktionen, bestimmte Wahrnehmungsschritte oder Verhalten bei Verbindungsverlust. STOP und sicherheitsrelevante Bewegungsprüfungen müssen unabhängig von Cloud-Antworten funktionieren.

Der Produktinhaber möchte ambitionierte Möglichkeiten erkunden. Eine heutige Implementierungslücke ist kein generelles Verbot einer Idee. Benenne die notwendige Erweiterung und ihren Nachweis. Zusätzliche Hardware darf als gesonderte Option vorkommen, muss aber sichtbar bleiben.

## 2. Arbeitsweise, Grenzen und Evidenzregeln

### 2.1 Forschung statt Technologiekatalog

Arbeite in dieser Reihenfolge:

> konkrete Situation → heutige Einschränkung → gewünschte Veränderung → Wirkmechanismus → technische Fähigkeit → Integration → messbarer Nutzen → entscheidende Unsicherheit → begrenzter Versuch.

Bewerte jede starke Idee gegen zwei Vergleichsbasen: die vorhandene My-LOOI-App und dieselbe Funktion auf einem Smartphone ohne Roboter. Eine nützliche Funktion ohne Verkörperungsmehrwert ist weiterhin zulässig; sie gehört dann ehrlich in diese Kategorie.

Trenne Machbarkeit, Zuverlässigkeit und Nutzen. Eine dokumentierte API beweist keinen stabilen mobilen Betrieb. Ein laufender Prototyp beweist keinen nachhaltigen Nutzen. Eine positive erste Nutzerreaktion beweist keine langfristige Bindung oder Lernwirkung.

Suche bei den sechs stärksten Ideen aktiv nach Gegenbelegen. Prüfe, ob bessere Kontextauswahl, eine deterministische Regel, eine kleine Interaktionsänderung oder ein bestehender API-Aufruf denselben Nutzen erzielt. Erkläre komplexere Lösungen durch ihren zusätzlichen Effekt.

### 2.2 Was dieser Auftrag umfasst

Erlaubt sind öffentliche Webrecherche, lesender Repository-Zugriff, Auswertung bereitgestellter Dokumente, Quellenvergleich, Architekturentwürfe, Kostenmodelle und Planung reproduzierbarer Experimente. Schreibe den Ergebnisbericht und seine Arbeitsartefakte. Erforderliche projektlokale Anweisungen zuerst lesen.

Dieser Rechercheauftrag allein beauftragt keine Produktimplementierung, keine Firmwareänderung, keine Motoraktivierung, keine kostenpflichtigen API-Testserien, keine Veröffentlichung und keine Kontaktaufnahme mit Herstellern oder Nutzern. Falls zusätzliche Ausführung ausdrücklich beauftragt wird, gelten deren konkrete Grenzen. Plane ansonsten den Versuch so vollständig, dass er anschließend beauftragt werden kann.

Arbeite bei fehlenden Details mit benannten Annahmen weiter. Frage nur dann nach, wenn eine Antwort eine wesentliche Entscheidung verändert oder eine erforderliche Berechtigung fehlt. Unbekanntes iPhone-Modell verhindert beispielsweise eine Architekturvergleichstabelle nicht; es verhindert eine belastbare Aussage über gemessene Geräteleistung.

### 2.3 Evidenzkennzeichnung

Verwende im Bericht diese Begriffe konsistent:

| Kennzeichnung | Bedeutung |
|---|---|
| Nutzeranforderung | Verbindliche Präferenz aus diesem Auftrag |
| Briefingangabe | Übernommene Projektinformation, noch nicht unabhängig geprüft |
| Codebefund | Implementierung am benannten Commit gelesen |
| Testbefund | Benannter Test tatsächlich ausgeführt; Umgebung und Ergebnis angegeben |
| Hardwarebefund | Verhalten auf benannter Hardware mit Versuchsaufbau beobachtet |
| Herstellerdokumentation | Offiziell beschriebene Fähigkeit; keine unabhängige Messung |
| Community-Befund | Aussage oder Implementierung eines Dritten mit begrenzter Übertragbarkeit |
| Forschungsergebnis | Aussage einer konkreten Studie unter deren Versuchsbedingungen |
| Schlussfolgerung | Eigene Ableitung aus benannten Belegen |
| Hypothese | Noch zu prüfende Annahme |
| Unbekannt/Widerspruch | Fehlende oder unvereinbare Evidenz |

Reifegrad getrennt erfassen: öffentlich verfügbar, eingeschränkt verfügbar, angekündigt, Forschungsprototyp oder Zukunftshypothese. Ebenso getrennt erfassen: Zugriff im konkreten Account bestätigt oder nicht geprüft. „GA“ ersetzt keine Prüfung von Region, Berechtigungen, Modellfreigaben und Kontingenten.

Quellen direkt an die gestützte Aussage setzen. URL, Abrufdatum, relevante Version und möglichst Abschnitt notieren. Keine Aussagen allein aus Suchtreffertiteln ableiten. Veröffentlichungsdatum und tatsächliches Ereignisdatum auseinanderhalten. Bei nicht erreichbaren Quellen die Lücke nennen, nicht deren Inhalt rekonstruieren.

Modelle, Preise, Limits, Plattformregeln und Lizenzbedingungen bei Ausführung erneut prüfen. Vorrecherche ist ein Startpunkt, kein dauerhaft gültiger Vertrag. Dokumentierte Funktionen gemeinsam auf Kombinierbarkeit prüfen: Zwei einzeln verfügbare Fähigkeiten ergeben noch keine unterstützte gemeinsame Lösung.

## 3. Produktidee und gegenwärtiger Funktionsumfang

My LOOI ist eine unabhängige, inoffizielle Companion-App für den physischen LOOI-Roboter. Das Projekt ist nicht mit dem Hersteller verbunden. Ein Smartphone sitzt auf dem Roboter oder wird mit ihm verwendet. Es übernimmt Gespräch, Mikrofon, Lautsprecher, Kamera, animiertes Gesicht, Erinnerungen, Einstellungen und BLE-Steuerung.

Der angestrebte Begleiter spricht mit Menschen, erinnert relevante Dinge, reagiert auf gezeigte Inhalte und verbindet Sprache mit Blickrichtung, Gesicht und Bewegung. Besonders interessant ist Nutzen, der aus KI, Gedächtnis, Smartphone und physischer Präsenz gemeinsam entsteht.

Mögliche Felder: Alltagshilfe, persönliche Begleitung, gemeinsames Lernen, Sprachtraining, Kreativität und Zugänglichkeit. Keine endgültige Zielgruppe und kein verbindliches Geschäftsmodell. Kinder, ältere Menschen oder Menschen mit Behinderungen nicht ohne Begründung als festgelegte Zielgruppe behandeln. Medizinische oder psychologische Wirksamkeit nicht aus allgemeinen KI-Fähigkeiten ableiten.

### 3.1 Sprache

Der beschriebene Bestand umfasst natürliche Gespräche über OpenAI Realtime mit direkter Smartphone-Verbindung und nutzereigenem API-Key. Die App besitzt Audioaufnahme und Wiedergabe selbst. Barge-in unterbricht die Ausgabe; ungehörte Antwortteile sollen aus dem Modellkontext entfernt werden. Serverseitige Sprachaktivitätserkennung steuert Gesprächsabschnitte.

Lokale Wakeword- und Sprachkommandokomponenten ergänzen den Cloud-Pfad. Ukrainisch, Englisch und Russisch sind Kernsprachen. Oberfläche, Eingabe- und Antwortsprache sind getrennt einstellbar. Modell und Stimme sind konfigurierbar; eine gespeicherte Modellliste ist nicht automatisch aktuell oder für den Account verfügbar.

Die dokumentierte primäre Android-Pipeline lautet: 16-kHz-Mono-PCM16-Aufnahme → lokale Audioverarbeitung/AEC → Resampling auf 24 kHz → Realtime-WebSocket → 24-kHz-PCM16-Ausgabe → lokale Wiedergabe. WebRTC bleibt als alternativer Vergleichspfad. Diese Unterscheidung ist bei Vorschlägen zur Migration wesentlich.

### 3.2 Gedächtnis

Gesprächshistorie und dauerhafte extrahierte Fakten liegen in SQLite. Sitzungsbeginn erhält begrenzten Erinnerungskontext; gezielte lokale Suche ergänzt ihn. Sicherung und Wiederherstellung sind vorgesehen. Es ist keine ausgereifte episodische, multimodale oder cloudübergreifende Langzeitgedächtnisarchitektur anzunehmen.

Prüfe tatsächliche Extraktion, Suchverfahren, Begrenzung, Herkunft und Löschverhalten im Code. Ein gespeicherter Fakt ist keine garantiert korrekte Erinnerung. Ein Modell, das eine Vorliebe im Kontext erhält, hat dadurch keine Modellgewichte gelernt.

### 3.3 Visuelle Interaktion

Optionale lokale Gesichtserfassung dient Position und Aufmerksamkeit. Augen folgen einem Gesicht; begrenzte Kopf- und Körperkorrekturen unterstützen die Ausrichtung. Das ist nicht gleichbedeutend mit sicherer Personenidentifizierung.

Explizite Aufforderungen können ein Kamerabild zur aktuellen Unterhaltung hinzufügen. Ausgewählte Fotos können besprochen werden. Frontkamera, Rückkamera und System-Fotopicker haben unterschiedliche Ziele und Lebenszyklen. Die lokale Aufmerksamkeitserkennung ist vom ausdrücklich ausgelösten Bild-Upload getrennt.

Kontinuierliches Videoverständnis, verlässliche Raumkarten und ein dauerhaftes visuelles Weltmodell sind nicht vorhanden anzunehmen. Bei neuen visuellen Erinnerungen ist zu entscheiden, ob Bild, Beschreibung, Objektzustand oder nur ein Ereignis gespeichert werden muss.

### 3.4 Verkörperung und Zuverlässigkeit

Vorhanden sind animierte Gesichter mit Stilen und Farbpaletten, natürliche kleine Gesten, einstellbare beiläufige Bewegungen und Vorrang für menschliches Sprechen sowie ausdrückliche Kommandos. Explizit an LOOI gerichtete Bewegungsbefehle werden deterministisch ausgewertet. Das Sprachmodell besitzt bisher keine freie autonome Motorsteuerung.

BLE-Suche, Geräteauswahl, Wiederverbindung, eigenes TypeScript-SDK, STOP-Pfade, Deadman-Schutz, Zeitgrenzen und richtungsabhängige Kantenprüfungen bilden die Steuerungsgrundlage. Sitzungswechsel, Mikrofonbesitz und Lifecycle werden koordiniert; verspätete Rückmeldungen alter Sitzungen dürfen den aktuellen Zustand nicht verändern.

Kamera, Audio, Bewegung und BLE werden bei Hintergrund-/Schlafübergängen grundsätzlich suspendiert. Neue Hintergrundfunktionen sind möglich zu untersuchen, müssen aber anhand realer Plattformmöglichkeiten und des Nutzererlebnisses bewertet werden.

## 4. Repository, iOS-Portierung und technische Orientierung

### 4.1 Baseline richtig feststellen

Im ursprünglichen Briefing stand `work` bei `09374b5`. Am Dokumenttag war der lokale Checkout zunächst `main` bei `c9d94ce`. Nach Abruf und ausdrücklichem Mergeauftrag des Nutzers wurde `origin/work` in lokale `main` übernommen. Sechs zusätzliche Commits brachten unter anderem iOS-Module, BLE-Abbruchlogik, Scan-Eigentümerschaft, Sitzungsisolation und Voice-Recovery mit. Die frühere Aussage „hier fehlen iOS-Module“ beschreibt nur den Stand vor diesem Merge.

Zu Beginn der Recherche ausführen oder anhand des bereitgestellten Snapshots feststellen:

```bash
git status --short
git branch --show-current
git rev-parse HEAD
git log -5 --oneline
```

Nicht automatisch Branches wechseln oder neue Remote-Stände einmischen. Analysierten Stand angeben; spätere Abweichungen separat behandeln. Ohne Repository-Zugriff das Briefing verwenden und fehlende Codeverifikation markieren.

### 4.2 Stack

Am Ausgangsstand gelesen: TypeScript, React/React Native, Expo/Expo Router, Zustand, SQLite, SecureStore beziehungsweise Keychain, `react-native-ble-plx`, lokales `@sourcebug/looi-sdk` und native Expo-Module. `package.json` nennt Expo `~56.0.12`, React Native `0.85.3`, React `19.2.3`, TypeScript `~6.0.3` und pnpm `10.34.5`. Aufgelöste Versionen aus dem Lockfile prüfen, bevor Kompatibilität behauptet wird.

Lokale Sprachbausteine umfassen Vosk und sherpa-onnx; VAD-/Offline-STT-Pfade und Assets sind zu prüfen. Aus einer vorhandenen Datei nicht schließen, dass der Pfad zur Laufzeit aktiv oder auf beiden Plattformen unterstützt ist.

### 4.3 iOS-Status nach dem Merge

`docs/ios.md` bezeichnet die Portierung ausdrücklich als Quellcodeanpassung. Swift-/Objective-C++-Module sind vorhanden, ein erfolgreicher nativer Build und die vollständige iPhone-/Roboter-Abnahme werden dort nicht belegt. TypeScript- und Logiktests ersetzen weder Linkerprüfung noch Audio-/BLE-Verhalten auf Hardware.

Dokumentiert sind AVAudioEngine/VoiceProcessingIO, gemeinsamer Audio-Session-Besitz, 16-kHz-Aufnahmevertrag, 24-kHz-Wiedergabe, Vision/AVFoundation, PHPicker, Files-Zugriff über Security-Scoped Bookmarks, Vosk-Brücke sowie Diagnose- und Lifecycle-Code. Das genannte Mindestziel iOS 16.4 steht unter dem Vorbehalt des tatsächlichen Dependency-Builds.

Ein Mac mit Xcode, ein iPhone und ein physischer LOOI stehen laut Nutzer grundsätzlich für spätere Versuche bereit. Modell, Firmware, RAM-Budget, thermische Reserve und Entwicklungskapazität sind unbekannt. Expo Go ist laut Projektdokumentation für die lokalen nativen Module ungeeignet; ein Development Build ist erforderlich.

Die Portierungsdokumentation nennt vier bekannte Android-Quellregressionen: Tests v2.1.137/138 erwarten fehlende Still-Capture-/Rückkamera-Funktionen, v2.1.139/140 einen fehlenden Android-Fotopicker. Das ist ein dokumentierter Altbefund, kein in diesem Briefing neu ausgeführtes Testergebnis. Vor Aufwandsschätzung aktuellen Zustand feststellen. Historische Cloud-Downloadprobleme bei Vosk nicht als dauerhafte Netzsperre auf diesem Mac übernehmen.

**Aktuelle Prüfung beim Erstellen dieses Dokuments:** Nach `pnpm install --frozen-lockfile` wurde `pnpm run ios:check` am genannten Commit erfolgreich ausgeführt (macOS-Arbeitsumgebung, Node `v26.5.0`, pnpm `10.34.5`). Die Kette enthält `tsc --noEmit` und neun Testskripte für Capture-Profil, Vosk-STOP, iOS-Runtime, Realtime-Sitzungsisolation, BLE-Cancellation, Foreground-Retry, Discovery, Voice-Recovery und Lifecycle. Keine native Kompilierung und keine physische Geräteabnahme wurden dadurch ausgeführt. Die gesamte Android-Regressionssuite wurde hier nicht erneut gestartet. Das Lockfile löste unter anderem Expo `56.0.18` auf; die Versionsspanne in `package.json` ist davon zu unterscheiden.

### 4.4 Gezielte Lesekarte

Alle folgenden Pfade sind relativ zum Repository und bei anderem Checkout neu aufzulösen.

| Frage | Startdateien/Verzeichnisse |
|---|---|
| Produkt, Bedienung, Grenzen | `README.md`, `FEATURES.md`, `USER_GUIDE.md`, `PRIVACY.md` |
| Architektur und iOS-Abnahme | `docs/architecture.md`, `docs/ios.md`, `docs/robot-ble.md` |
| Versionen und native Konfiguration | `package.json`, `pnpm-lock.yaml`, `app.json`, `plugins/with-looi-ios.js` |
| Realtime-Pfad und Audiovertrag | `src/voice/realtime-pcm-conversation.ts`, `src/voice/realtime-config.ts`, `src/voice/audio-capture-profile.ts` |
| Mikrofonbesitz und Recovery | `src/voice/capture-owner.ts`, `src/core/voice-runtime-recovery.ts`, `src/core/app-bootstrap.ts` |
| Bestehende physische Befehle | `src/voice/realtime-physical-command.ts`, `src/voice/explicit-robot-command.ts`, `src/voice/driving-command-grammar.ts` |
| Native Audio-/Kamerapfade | `modules/local-realtime-audio-capture/`, `modules/local-face-attention/`, `modules/realtime-audio-route/` |
| Fotoauswahl und visuelle Anfrage | `modules/photo-picker-access/`, `src/vision/look-here.ts`, `src/vision/photo-picker-context.ts` |
| Gedächtnis und Retrieval | `src/memory/`, insbesondere `local-memory-database.ts`, `conversation-memory-context.ts`, `local-memory-search.ts` |
| Verhalten und Aufmerksamkeit | `src/core/social-attention.ts`, `src/core/ambient-motion.ts` |
| Roboter und Sensorinterpretation | `src/device-tools/looi-robot.ts`, `src/device-tools/fed9-sensors.ts`, `packages/looi-sdk/README.md` |
| BLE-Verbindungslebenszyklus | `src/device-tools/react-native-ble-transport.ts`, `src/device-tools/looi-robot-autoconnect.ts` |
| Tests und Abnahmehilfen | `scripts/`, Testbefehle aus aktuellem `package.json` |

Dateinamen wie `decision-engine.ts`, `speaker-id.ts` oder `perceiver.ts` beweisen keine bestimmte Modell-, Identifikations- oder Planungsfähigkeit. Ein-/Ausgänge und tatsächlich aufgerufene Pfade lesen. Querverweise sollen den Zugriff erleichtern, nicht eine vollständige Codeprüfung vortäuschen.

## 5. LOOI-Hardware, Hersteller-App und Entwicklerzugang

### 5.1 Vier Ebenen konsequent trennen

1. Physische Hardware: Motoren, mechanische Freiheitsgrade, Sensoren, Stromversorgung.
2. Offizielle Hersteller-App: deren KI, Spiele, Erinnerungen, Animationen und Dienste.
3. Zugängliches Protokoll: offizielle oder durch Community erschlossene Steuerung/Telemetrie.
4. My LOOI: eigene Implementierung, Schutzlogik und tatsächlich validiertes Verhalten.

Eine Funktion auf der Hersteller-Webseite ist keine automatisch aufrufbare BLE-Funktion. Ein akzeptierter BLE-Schreibzugriff ist kein Nachweis präziser physischer Ausführung. Ein gesendeter Kopfwert ist kein gemessener Kopfwinkel.

### 5.2 Herstellerinformationen aus der Vorrecherche

Die [Produktseite](https://looirobot.com/products/looi-robot) nennt LOOI L-01, 110 × 98 × 110 mm, 385 g, 6.000 mAh und maximal 10 W kabellose Ladeleistung. Beworben werden Kanten-/Hinderniserkennung, visuelle Interaktion, Erinnerungen, Tracking-Kamera, Bewegungsspiele und weitere Desktop-Funktionen. Das sind Herstellerangaben, keine hier gemessenen Leistungen. Die dortige iOS-17-/iPhone-12-Kompatibilitätsangabe betrifft die offizielle Produktlösung und legt nicht automatisch My LOOIs Mindestversion fest.

Die [Datenschutzerklärung](https://looirobot.com/pages/privacy-policy), Version 1.1 vom 5. August 2026, nennt TangibleFuture Inc. und beschreibt Cloud-Verarbeitung von Sprache, cloudgespeicherten Gesprächs-/Gedächtniskontext sowie optional hochgeladene Einzelbilder. Die Produktseite enthält zugleich eine pauschale Aussage gegen Cloud-Übertragung. Den Widerspruch dokumentieren; nicht zugunsten einer Marketingaussage auflösen. Keine Datenflüsse der Hersteller-App auf My LOOI übertragen.

Eine öffentliche offizielle Developer-API oder SDK-Dokumentation wurde in der bisherigen Suche nicht gefunden. Suche gezielt nach offiziellen Entwicklerzugängen, Supportdokumenten und Partnerprogrammen weiter, falls dies die Umsetzbarkeit verändert. „Nicht gefunden“ ist nicht „existiert nicht“. Ein Herstellerkontakt ist ein möglicher späterer Schritt, aber kein automatisch autorisierter Rechercheweg.

### 5.3 Community- und lokaler Zugang

Das [Super-LOOI-SDK](https://github.com/GrinZero/super-looi/blob/main/packages/looi-sdk/README.md) und das lokale SDK beschreiben frühe abstrahierte Steuerung für Fahrt, Stopp, Kopfposition, Licht, Dock-Ereignisse und Raw Writes. Der lokale React-Native-Transport liegt in der App. Die kleine SDK-Oberfläche bildet nicht sämtliche App-Gesten und Schutzmechanismen ab.

Die ausdrücklich inoffiziellen [Protokollnotizen von andrey-tut](https://github.com/andrey-tut/LOOI-Robot/blob/main/docs/PROTOCOL.md) beschreiben unter anderem `FED0` Bewegung, `FED1` Kopfneigung, `FED2` Licht, `FED8` Batterie, `FED9` Telemetrie und `FEDA` Initialisierung. `FE00`-Gesten sind experimentell. Kopfpositionsrückmeldung ist nicht bestätigt. „Verified“ bezeichnet die Tests dieses Projekts, nicht eine Herstellerfreigabe oder unsere Geräteabnahme. [SooperChargeForBots](https://github.com/splattydoesstuff/sooperchargeforbots) ist ein weiterer Herkunftsanker.

### 5.4 Konkreter Widerspruch: FED9 0E

Der lokale Decoder `src/device-tools/fed9-sensors.ts` interpretiert `0E x y` als vorderen ToF-Abstand mit Millimetersemantik. Die [Community-Telemetrienotizen](https://github.com/andrey-tut/LOOI-Robot/blob/main/docs/FED9_TELEMETRY.md) führen dasselbe Muster als nur teilweise geklärten bewegungs-/lagebezogenen Skalar. Sie beschreiben außerdem Touch-, Dock-, Kanten- und IMU-artige Ereignisse mit unterschiedlicher Sicherheit.

Daraus folgt keine erwiesene Fehlfunktion unserer App. Es folgt ein gezielter Prüfauftrag: Welche Firmware und Hardware wurden jeweils untersucht? Welche Rohmessungen stützen die Interpretation? Lassen sich Objektabstand und Roboterlage unabhängig variieren? Das Signal bis dahin nicht als verifizierte Distanzquelle für neue Produktversprechen verwenden. Bestehende Sicherheitslogik im Rahmen dieser Recherche nicht ändern.

Erstelle eine Matrix mit Fähigkeit, Quelle, Firmwarebezug, zugänglichem Signal, lokaler Implementierung, Messnachweis und offener Frage. Prüfe besonders Berührung, Docking, Stromstatus, begrenzte Kopfbewegung und Licht als mögliche zusätzliche Interaktionskanäle. Setze weder Arm noch LiDAR, globale Positionierung, sichere Odometrie oder frei verfügbare Firmware-Schnittstellen voraus.

## 6. OpenAI Decisions, GPT-Live und bestehendes Realtime

### 6.1 Belegter Ausgangspunkt

Der [Decisions-Guide](https://developers.openai.com/api/docs/guides/decisions) beschreibt eine eigenständige API `POST /v1/decisions`: gemeinsame Evidenz aus Text, Bildern oder strukturierten Daten wird anhand vorgegebener Fragen bewertet. Antworttypen sind `predicate`, `choice` und `score`; aktuell genanntes Modell ist `gpt-6-luna`. Roh-Audio ist kein dokumentierter Eingabetyp. Die API liefert Bewertungen, die Anwendung führt Aktionen aus. Status und Modellunterstützung bei Ausführung erneut prüfen.

Die [Create-Referenz](https://developers.openai.com/api/reference/resources/decisions/methods/create) ist maßgeblich für das Request-Schema. Die Vorrecherche fand dort kein `reasoning_effort`-Eingabefeld. „Luna mit Max Reasoning“ bezeichnete die Auswahl des recherchierenden Agenten; daraus folgt kein entsprechender Decisions-Parameter. Zusätzliche Felder nicht aus anderen APIs übertragen.

### 6.2 Sprachintegration ist eine gesonderte Architekturfrage

Der [Voice-Guide](https://developers.openai.com/api/docs/guides/decisions-voice) beschreibt native Decisions-Delegation und Transkript-Trigger für GPT-Live. Dies belegt keine entsprechende native Integration unserer separaten Realtime-API-Anwendung. Für den Bestand ist ein eigener Aufruf mit Transkript oder Bild ein zu prüfender Integrationsweg.

Der [GPT-Live-Einstieg](https://developers.openai.com/api/docs/guides/live) unterscheidet Sprachinteraktion und delegierte Arbeit. Der [Migrationsleitfaden](https://developers.openai.com/api/docs/guides/live-migration) verlangt Änderungen an Session-, Audio- und Eventbehandlung sowie der Promptaufteilung. Ein Wechsel der Modell-ID allein genügt nicht. Laut Leitfaden wird Roh-Audio bei Backend-Delegation nicht automatisch weitergereicht; prosodische Merkmale dürfen dann nicht aus reinem Transkript abgeleitet werden.

### 6.3 Fragen, die die große Recherche beantworten muss

- Welche Aufgaben passen tatsächlich zu begrenzten Entscheidungen, welche brauchen Planung oder freie Generierung?
- Kann eine Klassifikation das bestehende Verhalten verbessern, ohne unnötige Netzabhängigkeit einzuführen?
- Welche Fehlentscheidungen sind tolerierbar, welche müssen zu Rückfrage oder Nichtstun führen?
- Wie reagieren definierte Auswahlmöglichkeiten auf unvollständige Transkripte, Sprachwechsel und Widerruf?
- Wie vermeiden wir doppelte Ausführung, wenn ein Transkript mehrfach oder schrittweise ankommt?
- Welche Latenz entsteht vom beobachteten Ereignis bis zum nützlichen Verhalten, nicht nur im Modell?
- Welche Erlaubnisse und Schlüssel benötigt direkter Zugriff, welche ein delegierter Sprachpfad?
- Ist die gewünschte Kombination im konkreten Account verfügbar?

Vergleiche sechs Varianten am selben Szenario: heutiger Parser, deterministische Zustandsmaschine, vorhandenes Function Calling, strukturierte Modellausgabe über einen anderen geeigneten Endpunkt, eigenständiges Decisions und GPT-Live mit nativer Anbindung. Ein separates Planungsmodell ist nur für tatsächlich mehrstufige Aufgaben hinzuzunehmen.

Untersuche als Hypothesen etwa: „Rückfrage oder Antwort?“, „Erinnerungssuche nötig?“, „Welches vordefinierte Gesprächsverhalten passt?“, „Ist ein Bild zur Aufgabe brauchbar?“ und „Liegt eine explizite Aktionsabsicht vor?“. Das sind Forschungsfragen, keine bereits zugesagten Fähigkeiten in unserem Kontext.

Wahrscheinlichkeitswerte nicht ohne Kalibrierung als objektive Sicherheit behandeln. Auswahloptionen müssen Nichtstun, Unklarheit oder Rückfrage ermöglichen. Dokumentierte Ablehnung, Schemafehler, Timeout und veraltete Antworten gehören in den lokalen Fehlerpfad.

Beantworte ausdrücklich: **Welchen konkreten zusätzlichen Nutzen bietet Decisions für My LOOI, und wann ist es unnötige Komplexität?** Liefere dazu mindestens ein Szenario, in dem die einfachere Lösung voraussichtlich vorzuziehen ist.

## 7. Systematische OpenAI-Recherche

Erstelle eine aktuelle Fähigkeitenübersicht mit Nutzerbezug. Die folgenden Bereiche sind Suchaufträge, keine pauschale Behauptung ihrer heutigen Verfügbarkeit oder Kompatibilität.

| Bereich | Zu klärende Produktfrage |
|---|---|
| Realtime und GPT-Live | Gesprächsfluss, Unterbrechung, Full Duplex, Kontext und Werkzeuge |
| Responses und Reasoning | Welche Hintergrund- oder Planungsarbeit lohnt ein getrenntes Modell? |
| Decisions | Wo hilft eine begrenzte Bewertung oder Auswahl? |
| Function Calling/Structured Outputs | Welche Verträge können wir prüfen, welche Semantik bleibt unsicher? |
| Agents SDK und ggf. aktuelle Agents-Dienste | Welche Orchestrierung brauchen wir wirklich? |
| Websuche | Wie beantwortet LOOI aktuelle Fragen mit überprüfbaren Quellen? |
| File Search/Retrieval/Vector Stores | Welche Dokumente und Erinnerungen passen zu welchem Suchverfahren? |
| Gesprächs- und Zustandsverwaltung | Was bleibt über Sitzungen erhalten, was muss die App führen? |
| Bildverständnis und multimodale Eingaben | Einzelbild, Bildfolge, Video: was wird tatsächlich unterstützt? |
| STT und TTS | Sprachqualität, Mehrsprachigkeit, Timing und alternative Audiopfade |
| MCP und Werkzeuge | Welche persönlichen Integrationen sind zugänglich und kontrollierbar? |
| Asynchrone Aufgaben und Scheduling | Was kann weiterarbeiten, wenn die App suspendiert ist? |
| Evaluation und Tracing | Welche Fehler lassen sich reproduzieren und vergleichen? |
| Fine-Tuning/Distillation | Welches stabile Problem rechtfertigt Datenaufbereitung und Training? |
| Caching/Batch/Kostenoptimierung | Welche Arbeit ist zeitkritisch, welche verschiebbar? |

Pro interessanter Fähigkeit erfassen: exakter Name, Endpunkt/Modell, Verfügbarkeit, Zugangsbedingungen, unterstützte Modalitäten, konkrete Funktion, kombinierbare Werkzeuge, Integrationsansatz, Nutzenhypothese, Kostenstruktur, Grenzen und Quelle.

Wichtig sind Unterschiede zwischen gespeichertem Gesprächszustand, durchsuchbaren Dokumenten, persönlichen Fakten, episodischen Ereignissen, kontextbasierter Verhaltensanpassung und Änderungen an Modellgewichten. Eine langfristige Unterhaltung ist nicht automatisch ein verlässliches persönliches Gedächtnis.

Recherchiere bei identifiziertem Bedarf aktuelle Plattformfunktionen über die offizielle Dokumentationsnavigation. Halte dich nicht an eine alte Produktliste, wenn Angebote umbenannt oder ersetzt wurden. Vermeide umgekehrt neue Komponenten, die nur aufgenommen werden, weil sie existieren.

## 8. Forschungsfelder und Startkandidaten

### 8.1 Natürlichere Gespräche

Untersuche Gesprächswechsel, Full Duplex, kurze Rückmeldungen, Pausenverständnis, Prosodie, Unterbrechung und Mehrsprecher-Situationen. Kläre, welche Verbesserung vom Modell, welche von Audioqualität, VAD, Wiedergabe oder Interaktionsdesign abhängt. Eine schnellere Antwort kann bei Denkpausen schlechter sein. Ein bestätigendes Geräusch kann hilfreich wirken oder den Nutzer übertönen.

Berücksichtige gemischte Sprachen, Namen/Aliasse, leise Sprache, Hintergrundgespräche und Medienwiedergabe. Mehrsprecher-Erkennung ist nicht automatisch Sprecheridentität oder ein belastbares Benutzerprofil. Prüfe, welche Aufgaben Transkripttext lösen kann und welche akustische Merkmale benötigen.

Verbinde Sprache und Bewegung zeitlich: Ein Nicken sollte zum tatsächlich gehörten Satz passen, nicht zu bereits verworfenem Text. Vergleiche semantisch gewählte Gesten mit einfachen Timing-Regeln. Ein niedriger API-Mittelwert reicht nicht; relevant sind Ende-zu-Ende-Verteilung und störende Ausreißer.

### 8.2 Persönliches Gedächtnis

Untersuche episodische, semantische, zeitliche und multimodale Erinnerungen; Verdichtung, Herkunft, Widerspruchsauflösung, Korrektur, Vergessen und Retrieval. Vergleiche SQLite/FTS, Vektorsuche und hybride Verfahren an denselben Fragen. Eine Vektordatenbank ist kein Ersatz für Versions- und Löschsemantik.

Beispiel: „Ich mag Kaffee“ und später „Abends trinke ich keinen Kaffee mehr“ müssen als zeitlich und situativ differenzierte Aussagen behandelt werden. Eine Erinnerung soll Quelle und Gültigkeit kennen. Ein scherzhafter oder zitierter Satz darf nicht automatisch zur dauerhaften Nutzerpräferenz werden.

Prüfe die Trennung von beobachtet, ausdrücklich mitgeteilt und inferiert. Formuliere, wann die App nachfragt, statt einen Widerspruch still zu lösen. Prüfe lokale, cloudbasierte und hybride Varianten einschließlich Export, Löschung, Geräteaustausch und Offline-Verhalten. Prüfe auch, ob Erinnerungen verschiedener Personen versehentlich vermischt werden könnten.

### 8.3 Visuelles und situatives Verständnis

Untersuche gemeinsame Aufmerksamkeit, OCR, gezeigte Gegenstände, Bildfolgen, Zustandsänderungen und ereignisgesteuerte Wahrnehmung. Der Nutzen muss nicht kontinuierliches Video verlangen. Vergleiche ausdrückliches Foto, lokal ausgewähltes Ereignisbild und eine begrenzte Bildsequenz.

Prüfe mechanische Sichtgrenzen: Montage, Landschaftsausrichtung, Front-/Rückkamera, Sichtfeld, Fokus, Beleuchtung und Kopfneigung. Dass die Rückkamera besseren Text erfassen kann, bedeutet nicht, dass sie in der aktuellen Montage das Nutzerobjekt sieht. Zeigen oder Blickausrichten ist nur mit einer hinreichend kalibrierten Beziehung zwischen Bildkoordinaten und Bewegung sinnvoll.

Ein erkannter Gegenstand ist kein sicher verfolgter Gegenstand. Ein neues Kamerabild ist keine präzise räumliche Karte. Bei „Wo habe ich das hingelegt?“ muss nachvollziehbar sein, ob LOOI das Ereignis überhaupt gesehen hat. Leere Evidenz darf zu „Das habe ich nicht gesehen“ führen.

### 8.4 Verkörperte soziale Interaktion

Untersuche Blick, Gesten, Gesichtsausdruck, Berührung und Initiative als verständliche Kommunikationskanäle. Prüfe HRI-Literatur anhand von Versuchsbedingungen, tatsächlicher Robotergestalt, Vergleichsgruppen, Autonomiegrad und Dauer. Ein Wizard-of-Oz-Versuch belegt eine Interaktionsidee, nicht deren autonome technische Umsetzung.

Die Vorrecherche liefert Literaturanker zu physischer Präsenz, Anthropomorphismus und Lernwirkungen im Quellenregister. Sie begründen vor allem sorgfältige Vergleiche: Sympathie, wahrgenommene Präsenz, Aufgabenerfolg und Lernleistung sind verschiedene Ergebnisse. Übertrage keine allgemeine positive Wirkung auf LOOI, ukrainischsprachiges Training oder dauerhafte Alltagsnutzung.

Prüfe Reaktionen über mehrere Sitzungen. Anfangsfreude und Neuigkeitseffekt können später in Ablenkung umschlagen. Für Initiative sind Akzeptanz, Störungen pro Nutzungszeit und einfache Unterdrückbarkeit wichtig. Persönlichkeit sollte nicht auf erfundenen Beobachtungen oder behaupteten inneren Bedürfnissen beruhen.

### 8.5 Planung, Skills und Weltmodelle

Untersuche länger laufende Aufgaben, hierarchische Planung, wiederverwendbare Skills und zustandsabhängige Werkzeuge. Trenne Gesprächsplanung, digitale Aufgaben und physische Bewegung. Ein Plan zur Terminvorbereitung braucht keine Roboternavigation.

Bewerte VLA- und Weltmodellansätze nach tatsächlichem Aktionsraum, Sensorik, Trainingsdaten, Feedback und Rechenbedarf. Ein Ergebnis auf Roboterarmen oder mobilen Plattformen mit Raumkarten ist kein direkter Implementierungsweg für LOOI. Eine begrenzte, verständliche Verhaltensbibliothek kann heute der bessere Versuch sein.

### 8.6 Personalisierung und digitale Werkzeuge

Untersuche Vorlieben, korrigierbares Verhalten, individuelle Lernziele und wiederkehrende Abläufe. Trenne explizite Einstellungen, kontextuelle Anpassung, gelernte Policy und Fine-Tuning. Prüfe, wie der Nutzer eine unerwünschte Anpassung zurücknehmen kann.

Untersuche passende Werkzeuge, App Intents, Shortcuts, Erinnerungen und Smart-Home-Anbindungen. Verifiziere API-Zugriff, Berechtigungen, UI-Anforderungen und Hintergrundgrenzen. Lesen, Entwerfen und Ausführen müssen getrennte Möglichkeiten bleiben. Eine technische Werkzeugverbindung ist keine generelle Erlaubnis zum Versenden, Kaufen oder Ändern.

### 8.7 Entwicklung und Evaluation

Prüfe Gesprächssimulation, wiederholbare Ereignisfolgen, Instrumentierung, Szenariotests und einen einfachen digitalen Zwilling. Definiere präzise, was der Zwilling abbildet: gegebenenfalls nur Zustände und Befehlsreihenfolge, nicht reale Mechanik oder Sturzsicherheit.

Untersuche, welche OpenAI-Werkzeuge bei Tests, Tracing, Vergleich und Fehleranalyse helfen. Modellbasierte Bewertung kann Arbeit reduzieren, darf aber weder sich selbst unabhängig bestätigen noch allein die physische Sicherheit oder den Nutzernutzen beurteilen.

### 8.8 Zwanzig Startkandidaten als Hypothesen

Die folgende Liste eröffnet die Suche. Sie ist keine Priorisierung und keine Verpflichtung, genau diese Ideen zu empfehlen. Ersetze schwache Kandidaten durch besser belegte, substanziell andere Ideen. Vermeide bloß verschiedene Namen für denselben technischen Effekt.

| Nr. | Kandidat | Zu prüfende Nutzenhypothese | Entscheidende erste Frage |
|---|---|---|---|
| 1 | Gesprächspausen besser verstehen | Weniger Unterbrechungen bei Such- und Denkpausen | Fehlt akustische Information oder nur passende Turn-Konfiguration? |
| 2 | Sprachtraining mit gemeinsamen Objekten | Gesehene Alltagsgegenstände helfen beim aktiven Sprechen | Besser als dieselbe Bildaufgabe auf dem Telefon? |
| 3 | Gemeinsames Lernen durch Erklären | Nutzer erklärt LOOI einen Sachverhalt und erkennt Lücken | Führt die Interaktion zu überprüfbarem Behalten? |
| 4 | Sichtbarer Schritt-für-Schritt-Begleiter | LOOI verfolgt einen begrenzten Arbeitsablauf | Sind Zustandswechsel mit wenigen Bildern erkennbar? |
| 5 | Korrigierbares episodisches Gedächtnis | Frühere gemeinsame Aktivitäten werden zutreffend fortgesetzt | Bleiben Zeit, Person und Quelle korrekt? |
| 6 | Visuelle Notiz auf ausdrückliche Bitte | „Merk dir diese Anordnung“ wird später nutzbar | Reicht eine Beschreibung oder braucht es das Bild? |
| 7 | Erinnerung mit nachvollziehbarer Herkunft | Nutzer versteht, weshalb LOOI etwas erinnert | Hilft Herkunft beim Korrigieren statt zu überfordern? |
| 8 | Kontrollierte Initiative | Passende kleine Angebote ersetzen generisches Plaudern | Wie oft stört die Initiative im Alltag? |
| 9 | Berührung als Interaktionskanal | Kurzes Berühren bestätigt oder pausiert einfach | Sind die Ereignisse auf unserem Gerät zuverlässig zugänglich? |
| 10 | Sinnvoller Dock-/Undock-Wechsel | Gespräch und Darstellung passen sich dem Aufsetzen an | Welche Zustände lassen sich ohne Fehltrigger erkennen? |
| 11 | Zeitlich passende Gesprächsgesten | Nicken und Blick erklären den Gesprächsverlauf | Nutzen gegenüber einfacher deterministischer Animation? |
| 12 | Gemeinsame Aufmerksamkeit | LOOI macht erkennbar, welches Objekt gemeint ist | Reicht die geometrische Genauigkeit der vorhandenen Bewegung? |
| 13 | Quellenbasierte Alltagserklärung | Aktuelle Antworten bleiben überprüfbar | Wie werden Quellen in Sprache und Bildschirm brauchbar? |
| 14 | Dokumentbegleiter | Eigene freigegebene Unterlagen werden im Gespräch erschlossen | Vorteil gegenüber allgemeiner Dateisuche ohne Roboter? |
| 15 | Kreative Szenen mit Verhalten | Geschichten verbinden Stimme, Gesicht und begrenzte Gesten | Steigert Verkörperung Beteiligung ohne längere Wartezeiten? |
| 16 | Mehrsprachige gemeinsame Aktivität | Sprachwechsel und persönliche Ziele bleiben konsistent | Gelingt das auch bei gemischten Sätzen und Namen? |
| 17 | Zugängliche Bedienalternative | Sprache, große Anzeige und Berührung ergänzen sich | Für welche konkrete Einschränkung ist das tatsächlich hilfreich? |
| 18 | Fortsetzbare digitale Aufgabe | Ein klar umrissener Auftrag läuft mit sichtbarem Status weiter | Welche Arbeit darf ohne aktive App weiterlaufen? |
| 19 | Gewünschte persönliche Routine | Wiederkehrende Abläufe werden passend vorbereitet | Was wird geplant, was erinnert, was wirklich ausgeführt? |
| 20 | Werkzeug zum Testen verkörperten Verhaltens | Entwickler können Interaktionsfehler wiederholen | Welche Fehlerklassen deckt Ereignis-Replay tatsächlich ab? |

Die endgültige Kandidatenliste soll Nutzerszenarien, technische Chancen und wenige Entwicklungsgrundlagen ausgewogen behandeln. Eine Sammlung reiner Infrastrukturarbeiten erfüllt den Produktauftrag nicht.

## 9. Architektur, Datenflüsse und Verhaltensschnittstellen

### 9.1 Drei verpflichtende Architekturvergleiche

**A — Bestehende direkte Realtime-App ausbauen:** Lokaler Zustand und BLE bleiben, ausgewählte KI-Aufgaben werden vom Client ergänzt. Prüfe Schlüsselnutzung, Kontextduplikation, mobile Unterbrechungen und Grenzen für langfristige Aufgaben.

**B — Realtime plus eigener Backend-Orchestrierung:** Gespräch bleibt möglichst nah am Bestand; ein Backend übernimmt begründete Aufgaben wie Authentifizierung, Retrieval, Hintergrundarbeit oder Werkzeuge. Prüfe zusätzliche Betriebsverantwortung, Synchronisierung, Ausfallverhalten und Kosten.

**C — Weitergehende agentische/hybride Architektur:** Ein anderer Sprachpfad, GPT-Live oder andere dokumentierte Angebote koordinieren spezialisierte Verarbeitung. Prüfe den tatsächlichen Mehrwert gegenüber B, Migrationsumfang und neue Abhängigkeiten. Ein Backend kann deterministisch orchestrieren; mehrere Agenten sind keine notwendige Voraussetzung.

Vergleiche dieselben ausgewählten Nutzungsszenarien unter denselben Lastannahmen. Eine komplexe Architektur darf nicht mit einer künstlich eingeschränkten einfachen Lösung verglichen werden. Benenne den kleinsten sinnvollen Zwischenstand und mögliche Rückkehr zum bisherigen Pfad.

### 9.2 Vorgeschlagenes Verantwortungsmodell

Das folgende Modell ist ein Entwurf zur Bewertung, keine Beschreibung des gesamten aktuellen Codes:

```text
Telefon-/Roboterereignisse
  -> normalisierte Beobachtungen mit Zeit und Herkunft
  -> relevante Kontextauswahl
  -> Interpretation oder begrenzte KI-Entscheidung
  -> lokaler Verhaltensplan mit Verfallszeit
  -> Berechtigungs-, Zustands- und Bewegungsprüfung
  -> ausführender Adapter
  -> beobachtetes Ergebnis oder ausdrücklich unbekannter Ausgang
```

Unmittelbare STOP- und Kantenpfade müssen nicht durch die KI-Kette laufen. Neue Cloud-Verarbeitung darf deren Laufzeit nicht verlängern. Die App bleibt Eigentümerin von Mikrofon, Wiedergabe und physischer Ausführung, sofern eine begründete Architekturentscheidung nichts anderes vorsieht.

Für neue Verhaltensschnittstellen prüfen: Aktions-ID, Sitzungsgeneration, erlaubter Aktionstyp, Argumentgrenzen, Anlass, Ablaufzeit, Abbruchsignal, Vorbedingungen und Ergebnisstatus. Keine rohe BLE-Payload als frei erzeugbaren Modelloutput vorsehen. Ein alter Vorschlag nach Sessionwechsel darf nicht plötzlich ausgeführt werden.

„Befehl gesendet“, „vom Transport angenommen“ und „physisch ausgeführt“ getrennt modellieren. Ohne Rückmeldung kann das Ergebnis unbekannt bleiben. Wiederholte Aufrufe dürfen einen einmaligen Bewegungsauftrag nicht unabsichtlich vervielfachen. Bei Überlast sind Priorität und Verwerfen besser als eine lange Warteschlange veralteter Gesten.

### 9.3 Datenfluss pro vertiefter Idee

Dokumentiere mindestens diese Felder:

| Feld | Zu beschreiben |
|---|---|
| Auslöser | Nutzeraktion, Sensorereignis, Zeitplan oder laufendes Gespräch |
| Rohdaten | Audio, Bild, Transkript, BLE-Ereignis, Dokument, Präferenz |
| Lokale Verarbeitung | Filter, Auswahl, Kompression, Pseudonymisierung, temporärer Zustand |
| Cloud-Übertragung | Empfänger, Zweck, Umfang, Häufigkeit, Authentifizierung |
| Speicherung | Datenform, Ort, Dauer, Herkunft, Löschung und Export |
| Rückgabe | Text, Auswahl, Werkzeugaufruf, Erinnerung, Verhalten |
| Ausführung | Welche lokale oder externe Aktion folgt mit welcher Berechtigung? |
| Ausfall | Verhalten bei Timeout, Offline-Zustand, Suspend und Wiederaufnahme |

Erkläre API-Key-Modelle ausdrücklich: nutzereigener Schlüssel, Betreiber-Projektschlüssel und temporäre Clientberechtigung sind unterschiedliche Vertrauens- und Abrechnungsmodelle. Einen Betreiber-Schlüssel nicht fest in eine ausgelieferte App einbauen. Für BYOK Migration und Kostenverantwortung gesondert prüfen.

### 9.4 Hintergrund, Ressourcen und externe Inhalte

Trenne Betriebssystem-Hintergrundarbeit, weiterlaufende Cloud-Aufträge und normale Vordergrundinteraktion. Ein Backend kann einen Auftrag weiterbearbeiten, ohne dass das Telefon Kamera, Mikrofon oder BLE weiterbetreibt. Ein Kamera-Multitasking-API-Hinweis ist keine pauschale Zusage für gesperrte iPhones.

Prüfe Audio-Session-Unterbrechungen, Bluetooth-Routen, Telefonanrufe, Siri, Permissions, Displayzustand, thermische Drosselung und gleichzeitig aktive Kamera. Ladefunktion, Bildschirm und Modellverarbeitung können gemeinsam Ressourcen beanspruchen; messe auf dem gewählten Gerät, statt aus nomineller Akkukapazität Laufzeit abzuleiten.

Externe Webseiten, Fotos, Dokumente und Werkzeugresultate sind Daten, keine Berechtigungen. Falls ihre Inhalte Verhalten auslösen können, teste die Trennung zwischen gelesener Anweisung und Nutzerauftrag. Berücksichtige nur relevante Angriffspfade, nicht einen unverbundenen allgemeinen Security-Katalog.

## 10. Experimente, Messung und Hardware-Abnahme

### 10.1 Drei Evidenzstufen

**Stufe 1 — Dokument-/Codeprüfung:** Ist die benötigte Fähigkeit dokumentiert und der Integrationsweg plausibel? Ergebnis: begründete technische Hypothese.

**Stufe 2 — reproduzierbarer technischer Versuch:** Funktioniert sie unter benannten Eingaben, Fehlern und Ressourcenbedingungen? Ergebnis: gemessene technische Eignung mit Grenzen.

**Stufe 3 — geeigneter Nutzungsvergleich:** Hilft sie Menschen bei der konkreten Aufgabe über die Vergleichslösung hinaus? Ergebnis: vorläufige oder belastbarere Nutzenevidenz, abhängig von Umfang und Design.

Eine Stufe nicht als Ersatz für die nächste ausgeben. Dieser Rechercheauftrag soll vorhandene Evidenz auswerten und fehlende Versuche vollständig planen; ungeführte Versuche als geplant markieren.

### 10.2 Messdesign

Vor dem Versuch primären Endpunkt, Vergleichsbedingung und Abbruchregel festlegen. Stimme Prompt, Daten und Grenzwerte nicht auf denselben kleinen Datensatz ab, mit dem abschließend Erfolg behauptet wird. Entwicklungsszenarien und zurückgehaltene Prüfszenarien trennen.

Für Latenz Start und Ende definieren: beispielsweise Ende einer menschlichen Äußerung bis zum ersten hörbaren relevanten Wort oder bis zum Beginn einer passenden Geste. Netzwerk, Modell, Queue, Audio und BLE nach Möglichkeit getrennt protokollieren. Berichte Median und hohe Perzentile sowie Timeouts, statt nur den besten Durchlauf.

Für Klassifikation Fehlertypen unterscheiden: falscher positiver Befehl, übersehener Wunsch, unpassende Initiative, unnötige Rückfrage. Kosten dieser Fehler sind unterschiedlich. Bei Wahrscheinlichkeiten Kalibrierung oder mindestens Verhalten an mehreren Schwellen untersuchen; keine Genauigkeitszahl ohne Klassenverteilung und Datensatzbeschreibung.

Für Gedächtnis prüfen: korrekte Wiederauffindbarkeit, falsche Erinnerung, Aktualität, Quellenzuordnung, Widersprüche, Löschung und Personenverwechslung. Für visuelle Aufgaben Beleuchtung, Blickwinkel, Unschärfe, Verdeckung und Objektwechsel variieren. Für Sprache Kernsprachen und gemischte Eingaben berücksichtigen.

Für Nutzerstudien Aufgabe, Rekrutierung, Vergleich, Reihenfolge und Wiederholungsdauer beschreiben. Wo sinnvoll dieselben Personen beide Bedingungen in wechselnder Reihenfolge erleben lassen. Eine kleine explorative Stichprobe darf Probleme entdecken; sie rechtfertigt keine weitreichenden Wirksamkeitsversprechen. Langzeitaussagen brauchen wiederholte Nutzung, nicht nur die erste Vorführung.

### 10.3 Wiederholbare Szenarien

Nutze eine begrenzte Szenariosammlung, beispielsweise:

1. Nutzer unterbricht mitten im gesprochenen Satz; anschließender Kontext enthält nur den gehörten Anteil.
2. Nutzer nennt einen Befehl als Beispiel oder Zitat; LOOI soll ihn nicht ausführen.
3. Sprache wechselt innerhalb eines Gesprächs; Name und Adresse bleiben korrekt.
4. Cloud-Antwort trifft nach Hintergrundwechsel oder neuer Session ein; sie bleibt wirkungslos.
5. Ein Bild ist unlesbar oder zeigt das falsche Objekt; LOOI fragt nach.
6. Eine frühere Präferenz wird korrigiert; spätere Antworten verwenden den gültigen Kontext.
7. Netz fällt während einer digitalen Aufgabe aus; Status und Wiederaufnahme sind nachvollziehbar.
8. Dock-Zustand ändert sich während einer Interaktion; Verhalten folgt einer definierten Regel.
9. Eine harmlose Berührung wird mehrfach gemeldet; nur die beabsichtigte Aktion folgt.
10. Kamera- oder Audiostart scheitert; übrige Ressourcen werden sauber freigegeben.
11. Gleichzeitige Initiativen konkurrieren; die App wählt oder verwirft nachvollziehbar.
12. Ein unbekanntes Sensorsignal erscheint; die Anwendung behauptet keine erfundene Bedeutung.

Das ist ein Startsatz, kein fertiger Benchmark. Ergänze Szenarien aus tatsächlichen Fehlern und Nutzungssituationen. Private Gesprächsdaten nur mit passender Berechtigung verwenden; synthetische Beispiele als synthetisch kennzeichnen.

### 10.4 Physische Prüfung

Für spätere Hardwareversuche Gerät, OS, Firmware, Montage, Oberfläche, Netzwerk und App-Commit protokollieren. Erst reine Beobachtung und kontrollierte kleine Bewegungen, danach komplexere Abläufe. Unmittelbarer STOP und sichere Versuchsumgebung sind Voraussetzungen; keine absichtlichen Abstürze zur Validierung.

Den FED9-Widerspruch mit getrennt veränderten Einflussgrößen prüfen: Abstand, Neigung, Rotation und Bewegung. Rohbytes und Zeitpunkte zusammen mit dem tatsächlichen Aufbau erfassen. Eine gleichzeitige Änderung mehrerer Größen kann keine eindeutige Sensorsemantik belegen. Vorhandene Kalibrierungsaufzeichnungen zuerst suchen.

Die in `docs/ios.md` beschriebene physische Abnahme umfasst Berechtigungen, BLE, Audio/AEC, Unterbrechung, RU/UK/EN-Kommandos, Kameraorientierung, Fotoauswahl, Files/Backup und wiederholte Vordergrundwechsel. Neue Ideen dürfen diese Baseline nicht stillschweigend als bereits bestanden voraussetzen.

## 11. Kosten, Aufwand und Forschungshorizont

### 11.1 Transparentes Kostenmodell

Wähle ein gemeinsames Referenzszenario für die Architekturvarianten. Als frei veränderbare Planungsannahme kann dienen: eine Person, 30 Minuten Gespräch pro Tag, zehn explizite Bilder, 20 zusätzliche begrenzte Entscheidungen, fünf Werkzeugaufrufe und zwei Hintergrundzusammenfassungen. Diese Zahlen sind weder Nutzungsprognose noch gemessener Bedarf. Passe sie begründet an die ausgewählten Funktionen an.

Erfasse aktive Sitzungsdauer, tatsächliche Audioein-/ausgabe, Text- und Bildmengen, wachsenden Kontext, Wiederholungen, Werkzeuggebühren, Speicher und Datenverkehr. Verwende die tatsächlichen Abrechnungseinheiten der gewählten Angebote. Konvertiere Audiominuten nicht mit einer erfundenen universellen Tokenrate.

Eine mögliche Rechenstruktur:

```text
Monatskosten = Sprachpfad
             + zusätzliche Modellaufrufe
             + Such-/Werkzeuggebühren
             + Speicher und Infrastruktur
             + erwartete Wiederholungen/Fehlerkosten
```

Daneben getrennt ausweisen: Einrichtung in Personentagen und laufender Betriebsaufwand in Stunden pro Monat. Führe Preisdatum, Währung, Abrechnungseinheiten und Quelle an. Bei unbekannten Preisen eine Variable statt einer erfundenen Zahl verwenden.

Berechne mindestens sparsame, mittlere und intensive Nutzung. Zeige, welche Annahme die Empfehlung kippt, etwa eine dauerhaft aktive Sitzung, häufige Bilder oder stark wachsender Kontext. Für mehrere Nutzer nicht nur Modellkosten linear hochrechnen, sondern gemeinsame Infrastruktur und variable Last unterscheiden.

### 11.2 Aufwandsschätzung

Personentage als Bandbreite mit Annahmen angeben: vertrauter Entwickler oder Einarbeitung, native Erfahrung, vorhandener Build, benötigte Hardware, Datensammlung, Backendbetrieb und Abnahme. Portierungsreparatur, Forschung und Produktisierung getrennt schätzen. Ein zweitägiger Demoaufbau ist keine zweitägige veröffentlichungsfähige Funktion.

Für jeden Spike nennen, welche Entscheidung nach Ende getroffen werden kann. Aufwand für nicht entscheidungsrelevante Perfektion begrenzen. Ein kleiner Versuch soll Unsicherheit reduzieren, nicht verdeckt ein neues Framework bauen.

### 11.3 Zukunftswetten bis 2028

Für jede starke Zukunftsidee erfassen: heute funktionierender Kern, fehlender Baustein, notwendige Fortschritte, Voraussetzungen, heutige vereinfachte Version, sinnvoll vorzubereitende Schnittstelle und Auslöser für Neubewertung.

Beispiele für beobachtbare Auslöser: dokumentierte benötigte Modalität, reproduzierbar bessere Ende-zu-Ende-Latenz, ausreichende Qualität auf unseren Szenarien, tragbares Kostenprofil oder bestätigtes Sensorsignal. „Modelle werden besser“ ist keine hinreichende Begründung.

Vergleiche drei Zukunftsszenarien: keine wesentliche Verbesserung, schrittweise Verbesserung und großer Fortschritt. Bevorzuge Grundlagen, die schon heute ausgewählte Funktionen tragen und bei ausbleibendem Durchbruch nützlich bleiben. Keine zukünftigen Modellnamen, Releases oder garantierten Termine erfinden.

## 12. Arbeitspakete und Agentenübergaben

Das Dokument funktioniert für einen Agenten oder ein ausdrücklich beauftragtes Team. Bei Teamarbeit die folgenden Verantwortungen verwenden; bei Einzelarbeit dieselben Pakete nacheinander bearbeiten. Gemeinsamer Referenzstand und Evidenzregeln gelten für alle. Keine unabhängigen, widersprüchlichen Produktannahmen in Teilberichten verstecken.

| Paket | Verantwortung | Erwartete Übergabe |
|---|---|---|
| A — Bestand/Hardware | Repository, iOS-Reifegrad, BLE, Quellenkonflikte | Fähigkeitsmatrix, Codeanker, Hardware-Unbekannte |
| B — OpenAI | aktuelle APIs, Decisions, GPT-Live, Kombinationen | Angebotsmatrix, Integrationsoptionen, Quellen und Zugriffsgrenzen |
| C — Produkt/HRI | Nutzungssituationen, Gedächtnis, Verkörperung, Forschung | Kandidaten, Gegenbelege, Nutzerversuche |
| D — Architektur/Betrieb | Datenflüsse, Schlüssel, Kosten, Plattformgrenzen | Architekturvergleich und Kostenmodell |
| Integration | Auswahl, Widerspruchsauflösung, Priorisierung | ein zusammenhängender Bericht mit drei Spikes |

Bei weniger verfügbaren Agenten Pakete bündeln. Parallelität ist ein Mittel, kein Qualitätsbeleg. Ein koordinierender Agent prüft die tragenden Quellen der drei Hauptempfehlungen selbst und übernimmt Teilbefunde nicht ungeprüft.

Jede Übergabe enthält:

- untersuchten Commit und Recherchedatum;
- beantwortete Fragen und wichtigste Befunde;
- direkt zugeordnete Quellen oder Codepfade;
- Evidenzstatus und Geltungsgrenzen;
- Widersprüche und offene Abhängigkeiten;
- konkrete Konsequenz für Kandidaten oder Architektur;
- nächster kleinster Schritt zur Klärung.

Empfohlene Reihenfolge: Bestand und Quellenbasis feststellen; API- und Hardwaregrenzen klären; Kandidaten bilden; sechs Ideen vertiefen; Architektur und Kosten auf diese Ideen beziehen; drei Spikes auswählen; Gegenprüfung durchführen. HRI-Recherche kann parallel laufen, während Entscheidungen über native Integration auf Paket A/B warten.

Keine wiederholte Neuaufnahme aller Quellen in jedem Teilbericht. Gemeinsame Quellen-IDs und ein zentrales Widerspruchsregister verwenden. Bei Konflikten die Originalquellen lesen, nicht den Mittelwert zweier Agentenaussagen bilden.

## 13. Verbindliche Ergebnisse und Vorlagen

### 13.1 Struktur des endgültigen Research-Berichts

Liefere einen eigenständig verständlichen deutschen Bericht mit folgenden Bestandteilen. Der Bericht darf ausführlich sein, muss aber Entscheidungen auffindbar machen. Wiederhole gemeinsame Grundlagen nicht in jeder Ideenbeschreibung.

**A. Entscheidungsübersicht:** Fünf wichtigste Erkenntnisse und drei konkrete nächste Schritte. Jede Empfehlung benennt Nutzenhypothese, stärksten Beleg, entscheidende Unsicherheit und die nächste überprüfbare Entscheidung. Eine Übersicht von ungefähr einer bis zwei Seiten soll ohne den technischen Anhang verständlich sein.

**B. Verifizierter Bestand und Fähigkeitsmatrix:** Tatsächlicher Commit, Plattformstatus, Hardware-/BLE-Möglichkeiten und bekannte Unbekannte. SDK-Oberfläche, App-Funktion und Hardwarebestätigung getrennt. Veraltete Briefingannahmen mit Begründung korrigieren.

**C. OpenAI-Fähigkeitsübersicht:** Tabelle relevanter Angebote mit Verfügbarkeit, Modell-/Modalitätskombinationen, Nutzerfunktion, Integration, Nutzen, Aufwand, Grenzen und Quelle. Ein reiner Produktkatalog erfüllt diesen Teil nicht.

**D. Eigene Decisions- und Voice-Analyse:** Korrekte Einordnung, heutiger Zugriff, Abgrenzung zu GPT-Live und Realtime, Vergleich an denselben Szenarien, Empfehlung zur Erprobung oder zum Verzicht. Bestehendes Audio-/Barge-in-Verhalten als Migrationsanforderung behandeln.

**E. Breite Kandidatenliste:** Ungefähr 20 substanziell verschiedene Ideen. Pro Idee Nutzerfunktion, Mehrwert gegenüber Bestand, Verkörperungsnutzen, technischer Kern, Reifegrad, Heute/Zukunft, OpenAI-Bezug oder Alternative, Architekturänderung, Aufwand und größte Unsicherheit. Schwache Ideen nicht künstlich aufteilen, um eine Zahl zu erreichen.

**F. Vertiefung der sechs stärksten Ideen:** Konkretes Nutzungserlebnis; Wirkmechanismus und Vergleichsprodukte/-ansätze; heute mögliche Umsetzung; Version bis 2028; Architektur/Datenflüsse; Modelle/APIs/Hardware; Kosten, Latenz und Ressourcen; erster Prototyp mit Erfolg und Abbruch. Mindestens ein plausibler Fehlerfall pro Idee.

**G. Architekturvergleich:** Die drei Varianten aus Abschnitt 9 mit denselben ausgewählten Funktionen vergleichen. Authentifizierung, Schlüssel, Abrechnung, Betrieb, Synchronisierung, mobile Grenzen und Migration sichtbar machen. Nenne, wann ein Backend den Aufwand rechtfertigt und wann nicht.

**H. Kostenmodell:** Referenzszenario, Formeln, aktuelle Preise, Annahmen und Sensitivität. API, Infrastruktur und menschlicher Betrieb getrennt. Keine erfundene Messpräzision.

**I. Drei Research-Spikes:** Direkt weitergebbare Entwickleraufträge nach der Vorlage unten. Jeder löst eine andere wesentliche Unsicherheit auf oder erklärt begründet eine Abhängigkeit. Keine drei Varianten desselben Modellbenchmarks.

**J. Priorisierung und Grundlagen:** Kurzfristige Verbesserungen, mittelfristige Integrationen und Zukunftswetten getrennt. Technische Grundlagen jeweils an konkrete ausgewählte Funktionen binden. Zeige, welche Empfehlung bei anderen Annahmen zuerst kippt.

**K. Zurückgestellte Ideen und offene Fragen:** Attraktive, aber derzeit ungeeignete Ansätze mit überprüfbarem Neubewertungsauslöser. Keine bloße Liste abstrakter Risiken.

**L. Evidenz- und Prüfanhang:** Quellenregister, Claim-Liste, widersprüchliche Befunde, tatsächlich durchgeführte Prüfungen und geplante Tests. Alle ungeprüften Zugangs- und Hardwareannahmen auffindbar machen.

Falls Dateierstellung verfügbar ist, liefere eine zentrale Markdown-Datei und bei Bedarf tabellarische Anhänge für Kosten und Evidenz. Alle wesentlichen Aussagen müssen auch im Hauptbericht verständlich sein. Keine zentralen Informationen ausschließlich in einem nicht zugänglichen Tool-Log belassen.

### 13.2 Vorlage für einen Kandidaten

```text
ID und Name:
Konkrete Nutzergruppe (Hypothese):
Situation und heutiges Problem:
Beabsichtigte Funktion:
Mehrwert gegenüber My LOOI heute:
Mehrwert des Roboters gegenüber Smartphone allein:
Technischer Kern und erforderliche Fähigkeiten:
Heute verfügbare Umsetzung:
Zusätzliche Architektur/Hardware:
Reifegrad und Evidenzstatus:
Wichtigste Quellen oder Codeanker:
Größte Unsicherheit:
Einfachere Vergleichslösung:
Aufwandsbandbreite mit Voraussetzungen:
Entscheidender nächster Versuch:
Vorläufige Entscheidung: vertiefen / zurückstellen / verwerfen:
```

### 13.3 Vorlage für eine vertiefte Idee

Eröffne mit einer kurzen konkreten Szene: Was tut die Person, was nimmt LOOI wahr, wie reagiert es, und welches Problem ist danach besser gelöst? Beschreibe anschließend den Fehlerfall und die angemessene Reaktion. Technische Details sollen diese Szene erklären.

Ergänze eine einfache Datenflussdarstellung und eine Zustandsfolge, wenn sie die Abhängigkeiten klarer machen. Eine Grafik mit Kästen wie „AI“, „Memory“ und „Robot“ ohne Ereignisse und Verantwortungen reicht nicht aus.

Beende jede Vertiefung mit einer Entscheidungstabelle:

| Bedingung | Konsequenz |
|---|---|
| Technische Hypothese bestätigt, Nutzen offen | Begrenzter Nutzungsvergleich |
| Nutzen plausibel, Integration scheitert | Einfachere Umsetzung oder gezielte technische Klärung |
| Vergleichslösung gleich gut und günstiger | Einfachere Lösung bevorzugen |
| Wesentliche Voraussetzung fehlt | Zurückstellen mit beobachtbarem Auslöser |
| Kritische Fehlwirkung nicht beherrschbar | Ansatz ändern oder verwerfen |

### 13.4 Vorlage für einen Research-Spike

```text
Titel / verantwortlicher Bereich:
Entscheidung, die dieser Versuch vorbereitet:
Hypothese in einem widerlegbaren Satz:
Warum diese Unsicherheit zuerst geklärt werden sollte:

Vorbedingungen:
- Code-/Buildstand
- Gerät, OS und Firmware
- APIs, Modellzugriff und Berechtigungen
- benötigte Daten und deren Herkunft

Kleinster sinnvoller Aufbau:
Betroffene Module und geplante Schnittstellen:
Vergleichsbasis und fair gehaltene Bedingungen:
Szenarien / Eingaben / Stichprobe:
Messinstrumentierung und Messzeitpunkte:
Primärer Endpunkt:
Sekundäre Metriken und relevante Fehlertypen:
Erfolgskriterium mit Begründung:
Abbruchkriterium mit Begründung:
Geplanter Umgang mit unklarem Ergebnis:
Kostenobergrenze als Planungswert:
Personentage als Bandbreite und Annahmen:
Auszugebende Artefakte / Logs / Auswertung:
Was der Versuch ausdrücklich noch nicht beweist:
Mögliche Entscheidungen nach Abschluss:
```

Drei mögliche Ausgangspunkte sind ein Vergleich der Entscheidungswege, eine sensorisch begrenzte Interaktion und ein korrigierbares Gedächtnisszenario. Wähle die endgültigen Spikes erst nach der Recherche. Die Beispiele sollen keine vorweggenommene Priorisierung erzwingen.

### 13.5 Vorlage für Claim- und Widerspruchsregister

```text
Claim-ID:
Behauptung:
Quelle / Commit / Abschnitt:
Geprüft am:
Evidenzart:
Geltungsbereich (Modell, OS, Gerät, Firmware, Studie):
Gegenquelle oder Einschränkung:
Welche Empfehlung hängt davon ab?
Aktueller Status:
Kleinster Schritt zur Auflösung:
```

Widersprüche nicht durch sprachliche Abschwächung verstecken. Beispiel: Bei zwei Deutungen eines BLE-Signals beide nennen und die unabhängige Messung definieren. Eine Quellcodevariable mit dem Namen `distanceMm` ist allein keine physikalische Kalibrierung.

### 13.6 Priorisierung ohne Scheingenauigkeit

Vergleiche Kandidaten anhand Nutzennähe, Evidenzstärke, Verkörperungsmehrwert, technischer Passung, Aufwand, Betrieb und Unsicherheit. Falls Zahlenwerte verwendet werden, Gewichte und Bandbreiten offenlegen und Sensitivität zeigen. Eine gewichtete Summe unbekannter Werte macht eine Empfehlung nicht belastbar.

Trenne „vielversprechende Produktidee“ von „guter nächster Versuch“. Eine ambitionierte Idee kann zuerst einen sehr kleinen technischen Nachweis brauchen. Eine einfachere Idee kann wegen guten Nutzennachweises kurzfristig stärker sein. Drei gleichzeitige große Architekturumbauten sind keine brauchbare nächste Arbeitsphase.

## 14. Quellenregister, offene Fragen und Abschlussprüfung

### 14.1 Bereits verwendete Quellen und gezielte Einstiegspunkte

Abruf-/Recherchekontext: 25. Oktober 2026. Verlinkte Live-Dokumentation kann sich ändern. Bei der großen Recherche erneut lesen und zeitkritische Aussagen aktualisieren. Dieses Register enthält kurze Orientierung, keine Ersatzlektüre für tragende Behauptungen.

| ID | Quelle | Verwendung und Grenze |
|---|---|---|
| O1 | [OpenAI Decisions Guide](https://developers.openai.com/api/docs/guides/decisions) | Grundfunktion; am Dokumenttag direkt geprüft |
| O2 | [Decisions Create API](https://developers.openai.com/api/reference/resources/decisions/methods/create) | Request-/Response-Vertrag; durch Rechercheagent geprüft |
| O3 | [Decisions mit Voice](https://developers.openai.com/api/docs/guides/decisions-voice) | GPT-Live-Anbindung; nicht ungeprüft auf Realtime übertragen |
| O4 | [GPT-Live Einstieg](https://developers.openai.com/api/docs/guides/live) | Sprachpfad und Delegation; durch Rechercheagent geprüft |
| O5 | [Migration zu GPT-Live](https://developers.openai.com/api/docs/guides/live-migration) | Event- und Architekturwechsel; durch Rechercheagent geprüft |
| O6 | [Live Session API](https://developers.openai.com/api/reference/resources/live/methods/create) | Session-Konfiguration und Berechtigungen nachprüfen |
| O7 | [Live WebSocket](https://developers.openai.com/api/reference/resources/live/primary-websocket) | Audio-/Eventvertrag nachprüfen |
| O8 | [GPT-Live-Modell](https://developers.openai.com/api/docs/models/gpt-live-1) | Preise, Limits, Verfügbarkeit; Accountzugriff unbekannt |
| O9 | [GPT-6-Luna-Modell](https://developers.openai.com/api/docs/models/gpt-6-luna) | Modellparameter je API unterscheiden |
| O10 | [OpenAI Changelog](https://developers.openai.com/api/docs/changelog) | Datierte Änderungen und Ablösungen prüfen |
| O11 | [OpenAI Developer-Dokumentation](https://developers.openai.com/) | Einstieg für aktuelle Preise, weitere Fähigkeiten und Bedingungen |
| L1 | [LOOI-Produktseite](https://looirobot.com/products/looi-robot) | Hardware- und Produktangaben; Herstellerclaims |
| L2 | [LOOI Privacy Policy](https://looirobot.com/pages/privacy-policy) | Offizielle App-/Cloud-Datenflüsse; nicht My LOOI |
| L3 | [LOOI im App Store](https://apps.apple.com/us/app/looi/id6474993624) | Offizielle App und Anforderungen; durch Rechercheagent gelesen |
| L4 | [LOOI FAQ/User Guide](https://looirobot.com/pages/guide) | Offizieller Einstieg; im Textabruf nur begrenzt ergiebig |
| C1 | [Super LOOI](https://github.com/GrinZero/super-looi) | Herkunftsprojekt; aktueller Umfang gesondert prüfen |
| C2 | [Super-LOOI-SDK-README](https://github.com/GrinZero/super-looi/blob/main/packages/looi-sdk/README.md) | Community-SDK, nicht offiziell |
| C3 | [LOOI-Robot](https://github.com/andrey-tut/LOOI-Robot) | Experimentelles Community-Projekt |
| C4 | [BLE-Protokollnotizen](https://github.com/andrey-tut/LOOI-Robot/blob/main/docs/PROTOCOL.md) | Eigenschaften und Grenzen laut lokalen Tests des Autors |
| C5 | [FED9-Telemetrienotizen](https://github.com/andrey-tut/LOOI-Robot/blob/main/docs/FED9_TELEMETRY.md) | Wichtiger Vergleich zur eigenen Sensorinterpretation |
| C6 | [SooperChargeForBots](https://github.com/splattydoesstuff/sooperchargeforbots) | Weitere Community-Erkundung und Herkunft |
| P1 | [AVAudioSession](https://developer.apple.com/documentation/avfaudio/avaudiosession) | Offizielle Audio-Grundlage; konkrete Konfiguration nachlesen |
| P2 | [AVFAudio](https://developer.apple.com/documentation/avfaudio) | Audioengine, Unterbrechungen und Routen |
| P3 | [Multitasking Camera Access](https://developer.apple.com/documentation/avfoundation/avcapturesession/ismultitaskingcameraaccessenabled) | Spezifische Kamerafähigkeit; keine generelle Hintergrundzusage |
| H1 | [Li: The benefit of being physically present](https://www.sciencedirect.com/science/article/pii/S107158191500004X) | Forschungsanker zu Präsenz/Verkörperung; hier nur Abstract/Preview gesichtet |
| H2 | [Roesler et al.: Anthropomorphism in HRI](https://pubmed.ncbi.nlm.nih.gov/34516745/) | Meta-Analyse; hier Abstract gesichtet, Moderatoren prüfen |
| H3 | [Social robots: a meta-analysis of learning outcomes](https://pmc.ncbi.nlm.nih.gov/articles/PMC13051544/) | Volltext-Einstieg; Vergleichsbedingungen und Studienbasis vertiefen |
| H4 | [The effect of a robot’s presence on human task performance](https://pmc.ncbi.nlm.nih.gov/articles/PMC13342336/) | Forschungsanker; keine pauschale Leistungszusage |
| H5 | [Multimodality and social interactions in robot-assisted language learning](https://www.sciencedirect.com/science/article/pii/S1747938X26000722) | Abstract gesichtet; kleine/heterogene Evidenzbasis kritisch prüfen |

Bei wissenschaftlichen Quellen zuerst prüfen, welche Aussagen nur im Abstract verfügbar sind. Für die sechs starken Ideen relevante Primärstudien aus den Literaturverzeichnissen heranziehen, sofern zugänglich. Methodische Grenzen und Vergleichsbedingungen lesen, bevor Effektgrößen für Produktentscheidungen genutzt werden.

### 14.2 Fragen mit hoher Entscheidungsrelevanz

| Offene Frage | Warum sie wichtig ist | Klärungsweg |
|---|---|---|
| Welches iPhone und welche iOS-Version? | Native Leistungs-/Kompatibilitätsaussagen | Geräteinventar vor Hardwareversuch |
| Welche LOOI-Firmware/Revision? | BLE-Übertragbarkeit | Geräteinformationen und vorhandene Logs |
| Gibt es erfolgreiche native Builds? | Machbarkeit der iOS-Versuche | CI-Artefakte oder lokales Buildprotokoll |
| Was bedeutet FED9 0E tatsächlich? | Abstandsgestützte Ideen und Interpretation | Rohdaten/Kalibrierung, getrennte Einflussgrößen |
| Welche Touch-Signale sind lokal nutzbar? | Neuer einfacher Interaktionskanal | Beobachtung und Decodervergleich |
| Welche Gesten liefern physisches Feedback? | Erfolgserkennung statt bloß gesendetem Kommando | Protokoll-/Hardwareprüfung |
| Welche OpenAI-Angebote sind im Account zugänglich? | Tatsächliche Integration | Dokumentation plus später autorisierter Zugriffstest |
| Welche Zielgruppe soll zuerst profitieren? | Auswahl von Szenarien und Erfolgskriterien | Zwei bis drei begründete Hypothesen vergleichen |
| Welche Entwicklungskapazität steht bereit? | Realistische Roadmap | Bandbreiten bis zur Klärung |
| Welche laufenden Kosten sind akzeptabel? | Architektur-/Nutzungsgrenzen | Sensitivität statt vorausgesetztem Budget |
| Welche Nutzungs-/Fehlerdaten existieren? | Relevanz und Evaluation | Autorisierte Diagnose-/Beobachtungsdaten suchen |
| Wie lange soll ein Gespräch aktiv bleiben? | Ressourcen, Kosten, Hintergrundbedarf | Explizites Referenzszenario |

Diese offenen Punkte sind keine Aufforderung, den Nutzer vor Beginn mit zwölf Fragen zu blockieren. Kläre verfügbare Informationen selbst und frage nur bei entscheidenden, nicht anders auflösbaren Abhängigkeiten.

### 14.3 Definition of Done für die große Recherche

Der Auftrag ist vollständig, wenn alle folgenden Bedingungen erfüllt oder eine konkrete externe Blockade mit Auswirkung dokumentiert ist:

- Der analysierte Projektstand ist benannt; iOS-Quellcode, Logiktests und Hardwarebetrieb sind sauber getrennt.
- Hardware, offizielle App, Community-Protokoll und eigene Implementierung werden nicht vermischt.
- Decisions ist korrekt eingeordnet; Realtime und GPT-Live werden technisch getrennt verglichen.
- Tragende API-Kombinationen sind anhand aktueller Quellen geprüft; Accountzugriff bleibt als eigener Status sichtbar.
- Ungefähr 20 unterschiedliche Kandidaten sind nachvollziehbar bewertet, sechs davon vertieft.
- Die sechs Ideen beschreiben konkrete Erlebnisse, Gegenhypothesen, Datenflüsse, Fehlerfälle und Vergleichslösungen.
- Die drei Architekturvarianten wurden anhand derselben Funktionen und Lastannahmen verglichen.
- Ein nachvollziehbares Kostenmodell mit Quellen und Sensitivität liegt vor.
- Drei begrenzte Research-Spikes sind ohne erneute Konzeptarbeit weitergebbar.
- Jede Hauptempfehlung hat ein mögliches Ergebnis, das gegen ihre Umsetzung sprechen würde.
- Zukunftswetten haben beobachtbare Voraussetzungen statt erfundener Releasepläne.
- Widersprüche, fehlende Nachweise und zurückgestellte Ideen sind auffindbar.
- Durchgeführte Prüfungen, fremde Messungen und geplante Versuche sind klar gekennzeichnet.
- Der Bericht endet mit drei konkreten nächsten Schritten und ihrer Entscheidungswirkung.

Prüfe zuletzt die stärksten eigenen Aussagen gegen ihre Quellen. Entferne Schlussfolgerungen, die die Quelle nicht trägt. Wo Evidenz begrenzt bleibt, verkleinere die Behauptung statt die Unsicherheit zu verstecken.

## 15. Kurzer Startauftrag zum Weitergeben

Der folgende Text kann zusammen mit dieser Datei an einen Research-Agenten gegeben werden. Die vollständige Datei ist die maßgebliche Aufgabenbeschreibung.

```text
Führe den Research-Auftrag im beigefügten Dokument
„My LOOI — vollständiges Research- und Entscheidungsbriefing für Agenten“ aus.

Lies zuerst Auftrag, Evidenzregeln und den korrigierten Repository-/iOS-Stand.
Recherchiere aktiv und aktuell. Verwende die vorhandenen Quellen als Einstieg,
nicht als Ersatz für Prüfung. Verifiziere besonders OpenAI Decisions/GPT-Live,
die zugänglichen LOOI-Fähigkeiten und die Kombinierbarkeit vorgeschlagener APIs.

Cloud-KI und ein eigener Backend-Dienst sind ausdrücklich zulässig und dürfen
bevorzugt werden. OpenAI ist Schwerpunkt. Der Nutzen für Menschen und die
tatsächliche Hardwarepassung entscheiden über Empfehlungen.

Liefere den vollständigen deutschen Bericht gemäß Abschnitt 13: Bestand,
Fähigkeiten, ungefähr 20 Kandidaten, sechs Vertiefungen, Architekturvergleich,
Kostenmodell, drei Research-Spikes, Priorisierung und Evidenzanhang.

Arbeite mit benannten Annahmen weiter, wenn Details fehlen. Trenne geprüfte
Fakten, Herstellerclaims, Community-Befunde und eigene Hypothesen. Führe im
Rahmen dieses Auftrags keine physischen Aktionen oder kostenpflichtigen
Experimente aus. Bereite sie konkret und überprüfbar vor.

Wenn Teamarbeit beauftragt und verfügbar ist, nutze die Arbeitspakete aus
Abschnitt 12. Andernfalls bearbeite sie selbst. Beende die Recherche erst nach
der Abschlussprüfung aus Abschnitt 14.3 und kennzeichne verbleibende Lücken.
```
