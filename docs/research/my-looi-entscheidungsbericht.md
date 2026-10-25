# My LOOI: Entscheidungen, Umsetzung und nächste Nachweise

Stand: 25. Oktober 2026. Analysierter Ausgangsstand: `main`, `09374b5904e5f0efdc89209e8dda0a9a78b35497`. Die nachfolgend benannten Implementierungen liegen als Änderungen auf diesem Stand. Der Nutzer hat zusätzlich zur Recherche ausdrücklich die Umsetzung beauftragt. Das Briefing ist Untersuchungsmaterial; seine Vorschläge sind keine bereits bewiesenen Produktanforderungen.

## A. Die Entscheidung

My LOOI braucht zuerst besser kontrollierbare persönliche Informationen, zuverlässige Absichtserkennung und eine klar begrenzte Erweiterung für aktuelle Informationen. Dafür sind weder ein neuer Sprachpfad noch eine freie Robotersteuerung durch ein Modell notwendig. Die ausgewählte erste Umsetzung umfasst ein korrigierbares Gedächtnis, vorsichtigere physische Sprachbefehle und eine ausdrücklich gestartete Webrecherche mit anklickbaren Quellen.

Fünf Erkenntnisse tragen diese Auswahl:

1. **Die vorhandene Sprachbasis ist umfangreicher als ein einfacher Chat.** App-eigenes PCM, Unterbrechen, lokale Werkzeuge, Bilder und Session-Isolation existieren. Ein Wechsel zu GPT-Live wäre eine Migration von Audio, Events und Zustandsverantwortung. Er rechtfertigt sich erst durch einen nachgewiesenen Bedarf an paralleler delegierter Arbeit. Code: `src/voice/realtime-pcm-conversation.ts`, `src/voice/realtime-config.ts`. Quelle: [GPT-Live-Migration](https://developers.openai.com/api/docs/guides/live-migration).
2. **Gedächtniskontrolle liefert einen unmittelbaren, überprüfbaren Nutzen.** Im Ausgangscode konnte ein Fakt gespeichert und gesucht, aber auf der Memory-Seite nicht korrigiert oder einzeln gelöscht werden. Die Umsetzung schließt diesen Ablauf einschließlich SQLite, FTS, Herkunft und Sessioninvalidierung. Nutzenhypothese: weniger wiederholte falsche persönliche Angaben. Unbekannt bleibt die Qualität der modellgestützten Extraktion in echten Gesprächen.
3. **Ein kleines deterministisches Problem verlangt keine zusätzliche Cloudentscheidung.** „LOOI, bewege dich nicht vorwärts“ wurde vor der Änderung als Bewegung erkannt. Der Parser wurde korrigiert; STOP bleibt vorrangig. Decisions ist ein eigenständiger Dienst für begrenzte Bewertungen, kein Motorcontroller. Quelle: [Decisions](https://developers.openai.com/api/docs/guides/decisions). Unsicherheit: neue Formulierungen und ASR-Fehler; deshalb konservative Ablehnung und mehrsprachige Regressionen.
4. **Aktuelle Antworten brauchen Quellen und einen sichtbaren Auftrag.** Ein unabhängiger Responses-Aufruf mit `web_search` ergänzt die App, ohne Audio- oder Erinnerungskontext ungefragt zu übertragen. Die Dokumentation verlangt sichtbare anklickbare Inlinequellen. [Web Search](https://developers.openai.com/api/docs/guides/tools-web-search). Die neue Funktion ist auf ausdrückliche Texteingabe begrenzt; Konto-Zugriff, Qualität und reale Kosten sind nicht durch Mocktests bestätigt.
5. **Verkörperung ist eine überprüfbare Hypothese.** Eine Metaanalyse von zehn Studien fand insgesamt keinen signifikanten Vorteil bloßer Roboterpräsenz bei Aufgabenzeit oder Genauigkeit. Ein für LOOI nützlicher Unterschied muss aus konkreter Interaktion entstehen. [Ren et al., 2026](https://www.nature.com/articles/s41598-026-51556-1). Die nächste visuelle oder sprachliche Aktivität wird deshalb gegen dieselbe Funktion am Smartphone verglichen.

Die drei nächsten Forschungsentscheidungen sind: Wann übertrifft eine begrenzte KI-Entscheidung vorhandene Regeln/Tools? Verbessert eine geführte Einzelbildaufgabe wirklich den Aufgabenerfolg? Verhindert kontrollierbares Gedächtnis dauerhaft falschen persönlichen Kontext? Die vollständigen Aufträge stehen in Abschnitt I. Der native iOS-Build und die Geräteabnahme bleiben eine Voraussetzung für Aussagen über iPhone-/Roboterbetrieb.

## B. Verifizierter Bestand und Abgrenzung

| Ebene | Code-/Dokumentbefund | Was damit nicht belegt ist |
|---|---|---|
| App und Versionen | Expo 56.0.18, React Native 0.85.3, React 19.2.3, TypeScript 6.0.3 im installierten Lockfile; Realtime-Standard `gpt-realtime-2.1-mini` | Modellzugriff im Nutzerkonto, native Linkbarkeit aller Module, gemessene Geräteperformance |
| Audio | Primär 16-kHz-Mono-PCM16 → lokale Verarbeitung/24-kHz-Resampling → Realtime-WebSocket → app-eigene 24-kHz-Wiedergabe; Server-VAD und Barge-in | akustische Qualität/AEC auf einem bestimmten iPhone, Telefon-/Siri-/Bluetooth-Routen |
| Gedächtnis | SQLite, FTS5, begrenzter Startkontext, lokale Suchfunktion, Backup/Restore; jetzt Einzelkorrektur und -löschung | automatisch verlässliche Wahrheit, Sprecheridentität, vollständiges episodisches Gedächtnis, Gewichtslernen |
| Bilder | ausdrücklich angeforderte Einzelbilder, Front-/Rückkamera-Schnittstelle, bis vier ausgewählte Fotos | laufendes Video, Raumkarte, Blickziel-/Objektpose, native Android-Funktionsparität |
| Aufmerksamkeit | lokale Gesichtsposition und soziale Ausrichtung, animiertes Gesicht, kleine begrenzte Gesten | sichere Personenidentifizierung oder kalibrierte Objektlokalisierung |
| Bewegung | lokaler SDK-/BLE-Pfad, STOP, Deadman, Richtungs-/Kantenprüfungen, zeitbegrenzte Befehle | genaue Fahrstrecke, Winkel oder physische Ausführung allein aus einem erfolgreichen Write |
| iOS | Swift-/ObjC++-Module und Expo-Konfiguration vorhanden; TypeScript-/Mockchecks ausführbar | vollständige Hardwareabnahme; diese wird getrennt protokolliert |

Ausführliche Codeanker und Hersteller-/Community-Matrix: [Bestand und Hardware](bestand-hardware.md). Die offizielle Hersteller-App ist ein anderes Produkt mit eigenen Cloud- und Datenschutzbedingungen. Eine dort beworbene Funktion ist kein für My LOOI aufrufbares SDK.

Das vom Nutzer benannte Zielgerät ist ein **iPhone 16**. iOS-Version und LOOI-Firmware sind weiterhin unbekannt; es wurde kein iPhone- oder Roboterbetrieb als eigene Hardwaremessung ausgegeben.

Zwei ungelöste Hardwarekonflikte bestimmen die Auswahl: `FED9 0E` wird lokal als ToF-Abstand gelesen, während Community-Aufzeichnungen seine Semantik nur teilweise klären; die dokumentierte Kopfmitte weicht ebenfalls ab. [Community-Telemetrie](https://github.com/andrey-tut/LOOI-Robot/blob/main/docs/FED9_TELEMETRY.md), [Protokoll](https://github.com/andrey-tut/LOOI-Robot/blob/main/docs/PROTOCOL.md). Bestehende Schutzschwellen wurden nicht umgedeutet. Touch, Dock und Licht sind Forschungsoptionen; keine neue Funktion nimmt bestätigte Touch- oder Distanzsemantik an.

## C. OpenAI-Fähigkeiten mit Produktbezug

Die vollständige, datierte Matrix und Quellenprüfung steht in [OpenAI, Architektur und Kosten](openai-architektur-kosten.md). Öffentliche Dokumentation und konkreter Accountzugriff werden getrennt behandelt; kein kostenpflichtiger Modellaufruf wurde zur Verifikation durchgeführt.

| Fähigkeit | Konkreter Nutzen und Integration | Entscheidung und Grenze |
|---|---|---|
| Realtime + Function Calling | bestehender gesprochener Dialog, lokale Gedächtnissuche und Sprachpräferenzen | behalten; Audio-/Barge-in-Vertrag ist Migrationsanforderung |
| Responses + Web Search | eigenständige aktuelle Frage, Antwort mit URL-Annotationen | jetzt als ausdrücklich gestartete Textrecherche integriert; Accountzugriff noch offen |
| Structured Outputs | prüfbares Format für einen späteren begrenzten Aktions-/Aufgabenplan | erst bei Bedarf; formal gültig bedeutet nicht semantisch richtig |
| Decisions | Predicate/Choice/Score aus Text, Bild, JSON; aktuelles Modell laut Guide `gpt-6-luna` | Spike für klar begrenztes Routing; keine Roh-Audio-Annahme und keine automatische Realtime-Anbindung |
| GPT-Live | fortlaufende Sprachinteraktion mit delegierter Arbeit | zurückstellen bis parallele längere Aufgaben Nutzerwert zeigen; eigener Voice-/Eventvertrag |
| File Search / Retrieval | freigegebene Dokumente mit belegbaren Fundstellen | erst für einen gewählten Dokumentworkflow; Löschung und Speichergebühren separat |
| Conversation State | serverseitig fortsetzbarer Dialog | ersetzt keine fachliche Gedächtnisversionierung; aktuell lokale Fakten und explizite Sitzung |
| Vision | Erklärung ausdrücklich übergebener Bilder | Bestand nutzen, Lesbarkeit/Bezug prüfen; kein stiller Dauerupload |
| STT / TTS | alternativer Sprachpfad, Transkription, kontrollierte Sprachausgabe | nur bei konkretem Qualitäts-/Sprachbedarf vergleichen; kein paralleler Mikrofonsbesitz |
| Agents SDK / Agents-Dienste | serverseitige Aufgaben, Tools, Ablaufstatus | Backend erst bei begründetem Auftrag; mehrere Agenten sind kein Selbstzweck |
| MCP / persönliche Werkzeuge | später z. B. ein bewusst verbundener Dokument-/Kalenderzugang | Identität, Rechte und externe Schreibaktionen benötigen eigene Produktverträge |
| Background / Scheduling | Cloudauftrag kann ohne offene App weiterarbeiten | keine iOS-Kamera-/BLE-Hintergrundzusage; dafür Backendstatus und Zustellung nötig |
| Evaluation / Tracing | wiederholbare Fehlerfälle, Latenz-/Kostenvergleich | lokale synthetische Tests jetzt; keine neue Abhängigkeit auf einem abgekündigten Evals-Pfad |
| Fine-Tuning | stabiles, gemessenes wiederkehrendes Fehlerproblem reduzieren | kein Bedarf ohne Datensatz und belegte Baseline; Erinnerung ist kein Fine-Tuning |
| Caching / Batch | wiederverwendeter Kontext bzw. nicht dringende Zusammenfassungen | nur nach Usage-Messung; Batch nicht für unmittelbare STOP-/Sprachreaktion |

Primärquellen: [Responses](https://developers.openai.com/api/docs/guides/text), [Function Calling](https://developers.openai.com/api/docs/guides/function-calling), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [File Search](https://developers.openai.com/api/docs/guides/tools-file-search), [Background](https://developers.openai.com/api/docs/guides/background), [Agents SDK](https://developers.openai.com/api/docs/guides/agents-sdk), [Deprecations](https://developers.openai.com/api/docs/deprecations). API-Fakten sind Herstellerdokumentation, keine Eignungsmessung.

## D. Decisions und die Sprachentscheidung

Verglichen werden dieselben Situationen: persönliche Frage, unklares Bild, expliziter physischer Auftrag, zitierter Auftrag und verspätete Antwort. Keine Variante darf STOP von der Cloud abhängig machen.

| Weg | Gedächtnis-/Bildaufgabe | Physischer Auftrag und Fehlerpfad | Nächste Entscheidung |
|---|---|---|---|
| heutiger Parser | keine freie Interpretation | schnell, lokal; jetzt Negation/Zitat/Frage konservativ abweisen | für vordefinierte Befehle bevorzugen |
| Zustandsmaschine | klare Schritte „Bild fehlt → aufnehmen → erklären → bestätigen“ | deterministische Vorbedingungen, Ablaufzeit, Abbruch | für geführte Aktivitäten zuerst nutzen |
| vorhandenes Function Calling | Realtime kann lokal suchen oder einen Fakt speichern | Werkzeugdefinition begrenzt Fähigkeiten; aktuell keine freien Motorwerkzeuge | für bestehende Gesprächsfunktionen beibehalten |
| Responses + strukturierte Ausgabe | flexibles getrenntes Interpretieren/Planen | Format prüfen, Timeout/Refusal/alte Session verwerfen | nur wenn eine freie Erklärung oder ein Plan gebraucht wird |
| eigenständiges Decisions | kleine feste Auswahl „nachfragen/suchen/antworten/unklar“ oder Bildkriterium | liefert Bewertung, App entscheidet; „unklar“ zulassen | nur bei messbarem Gewinn gegenüber Regeln/Tools |
| GPT-Live + native Decisions | native Voice-Delegation laut Dokumentation | neuer Audio-/Sessionvertrag; lokaler Ausführer bleibt zuständig | erst bei Bedarf an gleichzeitigem Dialog und langer Arbeit |

Der konkrete mögliche Zusatznutzen von Decisions ist ein kleines, über mehrere Evidenzen gemeinsam bewertetes Routingproblem mit festen Ausgängen. Ein bereits klarer Fahrbefehl oder die Suche über das vorhandene Memory-Tool braucht diese zusätzliche Netzrunde nicht. Wahrscheinlichkeiten sind Modellschätzungen, keine kalibrierte Zusicherung. Kein `reasoning_effort` aus Responses wird in den Decisions-Create-Vertrag übernommen. [Create-Referenz](https://developers.openai.com/api/reference/resources/decisions/methods/create), [Voice-Anbindung](https://developers.openai.com/api/docs/guides/decisions-voice).

## E. Kandidaten und Priorität

Alle Nutzengruppen sind Hypothesen; es ist keine Kinder-, Pflege- oder therapeutische Zielgruppe festgelegt. PT = Personentage eines mit Expo/TypeScript vertrauten Entwicklers, inklusive kleiner fachlicher Absicherung, ohne Feldstudie/native Grundreparatur. Die groben Bandbreiten sind Planungswerte, keine Angebote. Alle neuen KI-/HRI-Nutzen sind ungemessen.

| ID / Nutzeraufgabe | Mehrwert zum Bestand; Roboter gegenüber Telefon | Technik / Reife / Architektur | Aufwand und größte Unsicherheit; Entscheidung |
|---|---|---|---|
| K1 Fakten prüfen/korrigieren | geschlossener Kontrollablauf statt nur Speicherliste; Telefon gleichwertig | SQLite/FTS + Herkunft, jetzt implementiert, direkte App | 3–6 PT; Extraktionsqualität unbekannt; zuerst |
| K2 Aktuelle Frage belegen | aktuelle Quellen statt Wissen ohne Suchbeleg; kein notwendiger Verkörperungsvorteil | Responses/Web Search, öffentlicher API-Vertrag, neue eigene Seite | 3–6 PT; Konto-/Suchqualität; jetzt implementiert |
| K3 Gezeigten Text verstehen | geführte Neuaufnahme statt beliebiger Bildfrage; Hände bleiben ggf. frei | vorhandenes Einzelbild + Zustandsmaschine, heute prototypisierbar | 3–7 PT; Kamera/Montage/Lesbarkeit; Spike |
| K4 Bilder vergleichen | benannte Referenzen statt leicht verwechselbarer Bildfolge; Telefon stark | vorhandener Picker, vergleichende Bildfrage, direkt | 4–8 PT; Details/Verwechslung; nach K3 |
| K5 Arbeitsschritt begleiten | weiter/zurück/erledigt mit gezieltem Bild; Roboter ggf. hands-free | lokale Schrittfolge + Voice/Vision, direkt | 8–18 PT; falsche Fertigmeldung; testen |
| K6 Persönliche Sprachpraxis | wiederholbarer Übungszyklus an eigenem Inhalt; sozialer Partner ist Hypothese | Realtime + freigegebene Bilder/Ziel, heute | 8–15 PT; Lern-/Langzeitnutzen; vertiefen |
| K7 Teach-back | Person erklärt zuerst, erhält konkrete Rückfrage; Roboter als Zuhörer | Dialogzustand und fachliche Prüfkriterien, heute | 8–15 PT; höfliche Scheinbestätigung; testen |
| K8 Vortragsprobe | still zuhören, danach Feedback; körperliches Publikum möglich | Realtime/Transkript, heute Inhaltsfeedback; Prosodie später | 10–20 PT; akustische/kulturelle Normen; vertiefen |
| K9 „Dieses Objekt?“ bestätigen | sichtbarer gemeinsamer Bezug; falsche Blicksemantik vermeiden | explizites Bild + Referenzwahl, keine kalibrierte Motorpose | 6–14 PT; spiegelverkehrte Perspektive; Spike |
| K10 Turngebundene kleine Gesten | verständlicher Zustandswechsel statt Zufall; physisch unterscheidbar | lokale Turn-Ereignisse + unterbrechbare Kopfgesten | 4–8 PT; Störung bei Denkpausen; erst Baseline messen |
| K11 Kreative Mini-Szene | Story mit Skip/Weiter/Stop; Stimme/Gesicht/Kopf wirken gemeinsam | lokaler Szenenablauf + Realtime, heute | 5–12 PT; Neuigkeitseffekt; nach Nutzennachweis |
| K12 Platzierungsnotiz | belegt „damals dort“ statt behauptetes aktuelles Weltwissen | ausdrücklicher Fakt+Bildbeleg+Zeit, Speicherdauer nötig | 8–20 PT; veralteter Ort/Privatheit; nach K1/K3 |
| K13 Gewünschte Routine | wiederholbare Checkliste statt unspezifischem Plaudern; physische Präsenz evtl. hilfreich | lokale Vorlage; echter Terminserver separat | 5–10 PT; störende Initiative; explizit starten |
| K14 Timed Reminder | tatsächlicher Alarm statt bloßem Memory-Tag; Roboternutzen begrenzt | OS-Notification/Backend mit Zeitzone/Status, neu | 8–18 PT; Zustellung/Rechte; erst konkretes Bedürfnis |
| K15 Dokumentbegleiter | freigegebene Unterlagen mit Quellen durchsprechen; Telefon gleichwertig | File Search oder lokales Retrieval, ggf. Backend | 10–20 PT; Rechte/Retention/Quelletreue; zurückstellen |
| K16 Berührung als Pause | einfacher direkter Kanal ohne Sprache; nur am Roboter | FED9-Rohbeobachtung, Debounce; Semantik unbestätigt | 2–4 PT Beobachtung, 5–10 Produkt; Hardware zuerst |
| K17 Dockwechsel verstehen | Modus passt zum Aufsetzen; roboterspezifisch | vorhandenes Dockevent + lokale Zustandsregel | 3–7 PT; Fehl-/Doppelereignisse; Hardware zuerst |
| K18 Zugängliche Mehrkanalbedienung | sichtbarer Status, große Ziele, Stimme und ggf. Touch | bestehende UI + gezielter Nutzertest; heute | 5–12 PT; konkrete Einschränkung unbekannt; Bedarf prüfen |
| K19 Fortsetzbare digitale Aufgabe | Auftrag/Status bleiben bei App-Suspend erhalten; Telefon gleichwertig | Backendjob/Auth/Zustellung, verfügbarer technischer Ansatz | 15–30 PT; echter asynchroner Bedarf/Betrieb; später |
| K20 Verhalten wiederholen | reproduzierbarer Fehlerdialog statt Einzelanekdote; Entwicklungsnutzen | synthetische Ereignisse/Logs, lokale Tests vorhanden | 4–8 PT; kein Ersatz für Akustik/Mechanik; gezielt ausbauen |

Weitere Szenarien, Gegenbelege und sechs HRI-Vertiefungen: [Produkt-/HRI-Bericht](produkt-hri.md). Keine dieser Ideen erhält allein wegen physischer Präsenz Vorrang. K1/K2/K18 sind auch ohne Roboter wertvoll und werden entsprechend eingeordnet.

## F. Sechs vorrangige Ideen im Detail

### F1 Korrigierbares Gedächtnis

**Szene:** LOOI nennt abends wieder Kaffee. Die Person findet den Fakt über die Suche, ändert ihn auf „Abends trinke ich Tee“ und startet das Gespräch neu. Die aktive alte Sitzung endet, damit deren bereits geladener Kontext die Korrektur nicht überstimmt. Herkunft und Änderungszeit bleiben sichtbar.

**Wirkmechanismus:** ein nachvollziehbarer Kontrollkreis verbessert korrigierbare Fehler; er verbessert nicht automatisch das Modell. Vergleich: bisherige Liste/Neueintrag; stärkere Alternative: flache persönliche Notiz ohne automatische Extraktion. Der Roboter ist für diese Kontrolle nicht erforderlich.

**Daten:** Realtime-Fakt → SQLite mit optionaler Quellsitzung → Memory-Liste/Editor → Stop der alten Sitzung → atomare Änderung plus FTS-Trigger → nächste Sitzung lädt aktuellen Fakt. Kein neuer Cloudspeicher; neue Backups enthalten nur den aktuellen Fakt. Einzel-Löschen entfernt weder die eigenständige Gesprächshistorie noch bereits exportierte Dateien oder fremde Dienstkopien. Legacy-Herkunft bleibt ausdrücklich unbekannt.

**Fehler:** ein widersprüchlicher Fakt steht unter zweiter ID, oder ein Satz gehört einer anderen Person. Die aktuelle UI löscht/korrigiert die gewählte ID; sie behauptet keine automatische Konfliktauflösung oder Sprecheridentität. Prompt fordert Rückfrage bei Konflikt. Bis 2028 kann eine überprüfbare Vorschlagsliste mit Version/Gültigkeit folgen; keine automatische personenübergreifende Zusammenführung.

**Kosten/Ressourcen:** lokale Operationen ohne zusätzliche Modellgebühr; begrenzter Startkontext bleibt. Test: alte DB migrieren, Korrektur suchen, Export/Restore, Löschung, Neustart-/Spätantwort-Race. Erfolg: korrigierter/gelöschter Fakt kommt aus diesen lokalen Pfaden nicht zurück. Abbruch: Datenverlust, alte Session weiter aktiv oder FTS/Backup enthält den alten Wert. Langfristiger Nutzerwert braucht wiederholte Gespräche.

### F2 Quellenbasierte aktuelle Erklärung

**Szene:** Die Person öffnet aus den Gesprächen „Webrecherche“, tippt eine aktuelle Frage und startet sichtbar eine kostenpflichtige API-Suche mit eigenem Key. Antworttext enthält anklickbare Quellen; die Person kann den Beleg direkt öffnen.

**Wirkmechanismus und Gegenhypothese:** externe aktuelle Evidenz schließt eine Wissenslücke. Ein normaler Browser ist die starke Alternative und kann bei einfacher Navigation schneller sein. Es gibt zunächst keinen belegten Roboterbonus; deshalb eigenständige sekundäre Seite statt zusätzlicher dauerhafter Face-Kontrollen.

**Daten:** Eingabefrage → validierter Responses-Request mit `web_search` → geprüfte Text-/URL-Annotationen → Quellenansicht. Kein Audio, Bild, Memory oder Gesprächsverlauf im Request; `store:false`, keine lokale Speicherung der Suchantwort. BYOK aus vorhandener SecureStore-/Keychain-Verwaltung. `store:false` beweist keine universelle Nullspeicherung auf allen Dienstebenen.

**Fehler:** fehlende Quellen, Ablehnung, Konto nicht berechtigt, Timeout, Hintergrundwechsel oder neuer Auftrag. Kein altes Resultat darf einen neuen Bildschirmzustand überschreiben. Es wird keine Quelle erfunden und keine Aktion aus Seitentext abgeleitet. Heute Textfunktion; bis 2028 Sprache/fortgesetzte Aufgaben nur mit eindeutigem Auftrag und erhaltenen Zitaten.

**Kosten/Abnahme:** $0,01 je Suchtoolaufruf plus Modell-/Suchkontexttokens nach Preistabelle, variable Zahl Suchschritte; kein garantierter Gesamtpreis. [Preise](https://developers.openai.com/api/docs/pricing), [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna). Erfolg: geprüfte aktuellen Fragen mit nachvollziehbaren belegten Antworten, verständlichen Fehlern und keiner unbeabsichtigten Anfrage. Abbruch: scheinbelegte Behauptungen, stiller Kontextupload oder Suchkosten ohne Nutzeraktion. Mocktests beweisen API-Verarbeitung, keinen Live-Zugriff.

### F3 Explizite Einzelbildaufgabe

**Szene:** Die Person zeigt eine unkritische Bauanleitung, bittet um Erklärung eines Schritts und erhält bei unleserlichem Bild eine konkrete Neuaufnahmebitte. Gegenüber dem Bestand ist der geführte Prüfschritt neu; die Kamera-/Bild-KI existiert bereits.

**Daten:** ausdrückliche Anfrage → einmaliges JPEG im Speicher → aktueller Realtime-Dialog → Referenz/Antwort oder Rückfrage. Speicherung nur als gesondert gewählte Notiz. Die vorhandenen lokalen Gesichtsdaten sind kein kontinuierlicher Cloudvideokanal. Fehler: spiegelverkehrter/unscharfer Ausschnitt; LOOI muss fehlende Sicht sagen. Einfacher Vergleich: dasselbe Foto mit einer Frage im vorhandenen Smartphonepfad.

**Heute/2028:** heute ein bis zwei ausdrücklich übergebene Bilder und klare Wiederholungszustände. Zukunft: kurze Ereignisfolge erst bei bestätigter API-Kombination, Gerätebudget und besserem Aufgabenerfolg. Ressourcen: aktive Kamera, Ladefunktion und Voice gleichzeitig messen; keine erfundene Akkulaufzeit. Bildtokens und Realtime-Kontext sind variable Zusatzkosten. Erfolg/Abbruch im visuellen Spike; kein allgemeines OCR-/Medizinversprechen.

### F4 Sprachpraxis an einem eigenen Inhalt

**Szene:** Die Person wählt ein eigenes Foto, übt fünf Minuten auf Englisch, bekommt eine gezielte Korrektur und beantwortet dieselbe inhaltliche Frage später erneut. Antwort- und Hörsprache bleiben kontrolliert; ein einzelnes Übersetzungsbeispiel ändert keine dauerhafte Präferenz.

**Daten:** gewähltes Foto + ausdrückliches Lernziel → Realtime-Dialog → kurze Korrektur → lokaler optionaler Übungsverlauf. Kein Kindermodus vorausgesetzt. Fehler: ASR verwechselt einen Namen mit einem Sprachfehler; Rückfrage vor Bewertung. Einfachere Alternative: identischer Smartphone-Dialog. Ein großes preregistriertes Sprachlernexperiment fand keinen Zusatznutzen des Roboters bzw. seiner Gesten gegenüber Tablet. [Vogt et al., 2019](https://doi.org/10.1109/HRI.2019.8673077).

**Heute/2028:** heute enger Dialogablauf; später adaptive Schwierigkeit nur mit valider Lernmessung. Kosten: bestehende Sprachminuten und ein explizites Bild, zusätzliche Auswertung optional. Erfolg: wiederholt weniger sachliche/sprachliche Fehler im zurückgehaltenen Aufgabenmaterial und Nutzung über mehrere Termine. Abbruch: Vorteil nur bei Sympathie, häufig falsche Korrekturen oder Smartphone gleich gut und einfacher. Dann optionale Gesprächsvorlage statt eigenem Lernsystem.

### F5 Gemeinsamen Bezug verständlich machen

**Szene:** Auf einem Foto sind zwei Teile; LOOI benennt „das obere linke Teil in Bild 1“ und fragt nach, ehe es erklärt. Es behauptet nicht, das reale Objekt räumlich verfolgt zu haben.

**Daten:** explizites Bild + Referenzfrage → begrenzte Interpretation → sichtbarer Bezug/Bestätigung → Erklärung. Zunächst Bildschirmreferenz oder Nummerierung; keine Bildkoordinate direkt in Motorpose. Fehler: gespiegelte Frontkamera und unterschiedliche Links-/Rechts-Perspektiven. Einfacher Vergleich: Antippen in der Smartphone-Vorschau. Eine kleine Joint-Attention-Studie stützt die Transparenzhypothese, aber ihr Oberkörperroboter war mechanisch wesentlich leistungsfähiger. [Huang & Thomaz, 2010](https://cdn.aaai.org/ocs/2173/2173-9657-1-PB.pdf).

**Heute/2028:** heute sprachliche/visuelle Bestätigung, später kalibrierte Blick-/Kamerapose nur nach Hardwareversuch. Kosten: vorhandener Bilddialog, zusätzliche Rückfrage; Zeit bis korrektem Referenzverständnis messen. Erfolg: weniger Referenzverwechslungen als freie Antwort. Abbruch: zusätzliche Bestätigung steigert Fehler oder Nutzer deutet soziale Blickreaktion als sicheres räumliches Wissen.

### F6 Berührung als einfacher lokaler Kanal

**Szene:** Die Person berührt LOOI kurz und pausiert eine sichtbare Aktivität. Ein mehrfach gemeldeter Touch führt nur einmal zur Pause; keine Fahrt oder externe Aktion folgt daraus.

**Daten:** rohe FED9-Bytes + monotone Zeit → zunächst reines Beobachtungslog → erst nach bestätigter Semantik typisiertes Ereignis/Debounce → lokale UI-Reaktion. Keine Cloud und keine Identitätsinferenz. Fehler: Dock-/Lageänderung sieht wie Berührung aus oder ein Frame wird wiederholt. Einfachere Alternative: großer sichtbarer Pauseknopf/gesprochenes STOP.

**Heute/2028:** heute Rohbeobachtung möglich; eine produktive Touchfunktion ist geräteabhängige Hypothese. Bis 2028 zusätzliche Kanäle nur bei reproduzierbarer Semantik, keine Firmwareannahme. Kosten: lokale Verarbeitung; hauptsächlich Hardwareabnahme. Erfolg: kontrollierte Berührungen werden zuverlässig und ohne Fehltrigger erkannt. Abbruch: keine stabile Trennung von Dock/Lage/Touch. Sensor-Claims bleiben unbekannt; konkrete Beobachtung siehe Paket A.

Für alle sechs Ideen gilt: technische Eignung bei offenem Nutzen → kleiner Nutzungsvergleich; einfachere Lösung gleich gut → diese bevorzugen; fehlende Voraussetzung → mit messbarem Auslöser zurückstellen; unbeherrschbarer wesentlicher Fehler → Ansatz einschränken oder verwerfen.

## G. Architekturentscheidung an denselben Funktionen

Vergleichsmenge ist K1 Gedächtniskontrolle, K2 aktuelle Quellenantwort, K3 ausdrückliche Bildaufgabe. Referenz: eine Person, 30 aktive Gesprächsminuten/Tag, zehn Bilder/Tag, 20 begrenzte Entscheidungen/Tag, fünf Toolaufrufe/Tag, zwei Zusammenfassungen/Tag. Das sind frei gewählte Planungswerte. Tatsächlich aktiviert die erste Umsetzung keine dauerhaften Decisions oder Hintergrundzusammenfassungen.

| Aspekt | A: direkte App erweitern | B: Realtime + eigener Backenddienst | C: GPT-Live + delegierter/hybrider Backendpfad |
|---|---|---|---|
| K1 | SQLite-Änderung und neue Session; einfachste Konsistenz auf einem Gerät | serverseitige Versionierung/Synchronisierung möglich; Konflikt-/Löschvertrag nötig | dieselben Memorydienste wie B; Voicewechsel verbessert Memory nicht automatisch |
| K2 | ausdrückliche BYOK-Responses-Anfrage | eigener authentifizierter Suchendpunkt, Betreiberbudget/Rate Limits | delegierte Suche bei laufendem Dialog, neue Voice-/Eventarbeit |
| K3 | explizites Bild an vorhandenen Dialog | Bildverarbeitung als gezielter Job, Upload-/Löschpolitik | Bilder in geeignetes Backendmodell; Live selbst nicht als Bildmodell annehmen |
| Schlüssel/Identität | persönlicher Key in SecureStore/Keychain, Nutzer zahlt; persönliches Gerät als Vertrauensgrenze | Betreiber-Projektkey nur serverseitig, Login, Rechte, kurzfristige Clientberechtigung | serverseitiger Sessionaufbau plus Backendtool-Authentifizierung |
| Ausfall/Suspend | aktive lokale Sitzung endet, kein Anspruch auf fertigen Backgroundjob | Cloudauftrag kann fortlaufen; Client zeigt später autorisierten Status | Backendaufgabe und lokale Audioausgabe unabhängig modellieren |
| Betrieb | API-Kosten beim Nutzer, kein eigener Dienst | Kosten für Hosting, Auth, Logs, Backup, Abuse/Updates/Bereitschaft | wie B plus neue Voice-Abrechnung und Migrationspflege |
| Rückweg | bestehender PCM-Pfad bleibt | Backendfeatures abschaltbar, lokale Fakten weiter nutzbar | expliziter PCM-Fallback; keine geteilten Mikrofonbesitzer |

**Auswahl:** A trägt die umgesetzten Funktionen. Das ist eine Folge der ausgewählten Aufgaben, kein pauschaler Local-first-Bonus. B wird sinnvoll bei Mehrgerätesync, Betreiberabrechnung, freigegebenen persönlichen Integrationen oder wirklich fortlaufenden Jobs. C wird erst nach einem messbaren Dialog-/Parallelitätsgewinn gegenüber B sinnvoll. Aufwand für B grob 15–30 PT plus laufende 4–12 Betriebsstunden/Monat; C zusätzlich 10–25 PT für Sprachmigration/Abnahme. Diese Bandbreiten setzen erfahrene Entwickler und eine native Buildbasis voraus und sind ungemessene Planungswerte.

**Ergänzung zur Nutzerfrage nach Hermes Agent und der anschließenden Freigabe für Fly.io:** Ein begrenzter Agentenablauf kann im Vordergrund direkt in der iPhone-App laufen, auch mit einem Cloudmodell. Für fortlaufende digitale Aufgaben wurde inzwischen ein begrenzter Pilot innerhalb von B implementiert: Hermes v0.22.5 auf einem Server plus LOOI-Aufgabenseite über eine eigene authentifizierte Aufgaben-API. Ausschließlich explizite Textrecherche, Status, Quellen, Abbruch und Löschung sind enthalten. Hermes selbst bietet derzeit keinen unterstützten iOS-Runtime-Port. Apple erlaubt bestimmte endliche Hintergrundaufgaben; daraus folgt kein dauerhafter Agentendienst. Quellen, lokale Modelloptionen, RU/UK-Sprachgrenzen und der geplante Nutzenvergleich stehen in [Hermes und iPhone 16](hermes-agent-iphone16-assessment.md). Der Dienst läuft auf einer Fly-Machine mit verschlüsseltem Volume. Zwei begrenzte öffentliche Rechercheaufträge mit gültigem Modellzugriff sind erfolgreich; nach Korrektur des tatsächlich beobachteten Hermes-Tool-Wrappers liefert die Abnahme fünf korrekt betitelte offizielle Quellen. Wiederholung, Konfliktbehandlung und Erhalt eines abgeschlossenen Ergebnisses über Imageupdate/Neustart wurden live geprüft. Die iPhone-Bedienabnahme und der Vergleich des praktischen Nutzens bleiben offen. Vollständiger Vertrag und Prüfgrenzen: [Hermes-Agent-Anbindung](../hermes-agent.md).

Neue Aktionsverträge müssen eine ID, Sessiongeneration, erlaubten Typ, begrenzte Argumente, Anlass, Ablaufzeit, Abbruchsignal, Vorbedingungen und Ergebnisstatus tragen. „gesendet“, „Transport angenommen“ und „physisch ausgeführt“ bleiben getrennt. Keine beliebige BLE-Payload ist Modelloutput; stale oder doppelte Aktionen werden verworfen, STOP läuft unabhängig.

## H. Kosten und Sensitivität

Preisdatum 25.10.2026, USD, keine Umsatzsteuer-/Währungsannahme. Vollständige Preise, Quellen und Rechenbeispiele stehen in [Kostenanalyse](openai-architektur-kosten.md#kostenannahmen-und-formeln). Kontozugriff und echte Usage sind ungemessen.

`Monat(A) = Realtime-Audiotokens × Audiopreise + Text-/Bildtokens × jeweilige Preise + Transkription + Such-/Toolgebühren + zusätzliche Modellaufrufe + Wiederholungen`

`Monat(B) = dieselben Funktionskosten + Hosting H + Speicher S + Traffic E + Betriebsarbeit (Stunden × interner Satz)`

`Monat(C) = aktive Live-Minuten × Livepreis + Backendmodell-/Toolkosten + H + S + E + Betriebsarbeit`

Für Realtime gilt keine erfundene universelle Token-pro-Minute-Zahl. Die Kostenanalyse verwendet ausdrücklich dokumentierte Näherungen für User-/Assistant-Audio und getrennte Sprechanteile als Beispiel; bei Produktentscheidungen ersetzen echte Usage-Werte diese Annahmen. Bei 10/30/90 aktiven Minuten pro Tag ergibt dieses eingeschränkte Audiobeispiel ungefähr $3,60/$10,80/$32,40 monatlich, ohne wachsenden Text-/Bildkontext, Tools, Fehler und Cache. Live-Dauer allein läge beim dokumentierten $0,05/Minute bei $15/$45/$135, ebenfalls ohne Backendarbeit. [Realtime-Kostenhilfe](https://developers.openai.com/api/docs/guides/voice-latency-cost), [Live-Modell](https://developers.openai.com/api/docs/models/gpt-live-1).

Zusätze im mittleren Briefingprofil: Bilder `300 × I` (I ist der tatsächlich gemessene Preis je gewählter Bildgröße/Detail und Modell); Decisions `600 × D`; Tools `150 × T`; Zusammenfassungen `60 × Z`. Für sparsame/intensive Nutzung diese Mengen zunächst mit 1/3 bzw. 3 skalieren. Modell-, Bild- und Tooltokens nicht doppelt zählen. `I/D/T/Z` bleiben explizite Variablen, bis Anfragevertrag und Verbrauch gemessen sind. Für Luna-Websuche mit einem Suchaufruf plus angenommenen 4.000 Ein-/1.000 Ausgabetokens ist der einfache Anker $0,0109/Frage vor zusätzlichem Suchkontext; mehrere Suchschritte und Wiederholungen erhöhen ihn.

Die Architekturwahl kippt bei stark wachsendem Kontext, mehreren Geräten oder unbeaufsichtigten Jobs. Eine 24 Stunden offene Live-Sitzung ist ein anderes Kostenmodell als 30 Minuten gezielte Nutzung. Mehrnutzerbetrieb multipliziert variable API-Last; Auth/Queue/Datenbank haben eigene Grund- und Lastkosten. Einmalige Einrichtung, API-Verbrauch und menschlicher Betrieb werden nicht in einer scheinpräzisen Pauschale versteckt.

## I. Drei direkt ausführbare Research-Spikes

Die folgenden Versuche sind geplant, keine bereits gemessenen Resultate. Kostenobergrenzen sind Abbruchwerte für eine spätere autorisierte Durchführung, keine jetzt getätigten Ausgaben. Es wurden keine Nutzer kontaktiert und keine Motoren aktiviert.

### S1 — Braucht der Dialog Decisions?

**Verantwortung/Entscheidung:** Voice/AI; entscheiden, ob ein begrenzter zusätzlicher Routingaufruf besser ist als vorhandene Regeln und Tools. **Hypothese:** Decisions reduziert unnötige oder falsche Routingentscheidungen bei mehrdeutigen persönlichen/Bildanfragen, ohne die festgelegte tolerierbare Verzögerung zu überschreiten. Einfache Befehle bleiben lokaler Kontrollfall.

**Voraussetzungen:** benannter App-/Buildstand; kein Motoradapter; Accountfreigabe für die jeweils tatsächlich verglichenen APIs; synthetische RU/UK/EN-Eingaben. Gleiche Evidenz und Ausgänge `answer/search/clarify/noop` für alle Varianten. GPT-Live nur bei bestätigtem Zugriff als separat markierte Voicebedingung, keine erfundene Simulation echter Audioqualität.

**Aufbau/Schnittstellen:** reine Szenarioeingabe → austauschbarer Entscheidungsadapter → JSONL-Ergebnis mit Eingabe-ID, Modell/Snapshot, Strategie, Zeit, Label, Fehlerstatus und Usage. Parser/Zustandsmaschine, aktuelles Function Calling, Responses Structured Output, Decisions und gegebenenfalls Live vergleichen. `unknown/refusal/timeout/stale` explizit. Keine Aktionsausführung.

**Stichprobe/Baseline:** 180 synthetische Fälle, 90 Entwicklung/90 zurückgehaltene Prüfung, je Sprache ausgewogen: klar, mehrdeutig, negiert, zitiert, widersprüchlicher persönlicher Fakt, unbrauchbares Bild und verspätete Antwort. Zwei Personen vergeben Referenzlabels vor dem Vergleich; Uneinigkeit bleibt markiert.

**Messung:** Eingabe vollständig verfügbar bis nutzbare Entscheidung; p50/p95, Timeouts, unnötige Suche/Rückfrage, falsche Aktion, Kosten pro korrekter Entscheidung. Primär: gewichtete Fehlerzahl bei offen gelegten Fehlerkosten; falsche physische Aktion zählt als Ausschluss. Ziel als Planungswert: mindestens 20% weniger gewichtete Fehler als bester einfacher Weg bei p95-Zusatzlatenz ≤800 ms; diese Werte sind keine behaupteten Messungen.

**Abbruch/unklar:** jede unerlaubte Aktionsfreigabe, >$10 API-Kosten, anhaltend >5% Transport-/Schemafehler oder kein Vorteil im Holdout. Bei unklarem Ergebnis nicht die Schwelle nachoptimieren; neue Fehlerklasse/Datenlücke benennen und kleinsten Folgetest definieren. **Aufwand:** 3–6 PT plus optional 2–4 PT Liveadapter. **Artefakte:** Szenarien, Labels, Requestverträge ohne Keys, Ergebnisdaten, Auswertung. **Beweist nicht:** Alltagsnutzen, Prosodie oder physische Sicherheit. **Entscheidung:** einfacheren Weg behalten, enges Decisions-Routing erproben oder Live gesondert untersuchen.

### S2 — Hilft die geführte Einzelbildaufgabe?

**Verantwortung/Entscheidung:** Vision/Produkt; entscheiden, ob ein expliziter Capture-/Retake-/Bestätigungsablauf gegenüber freier Bildfrage hilft. **Hypothese:** er reduziert falsche Antworten und Korrekturschritte bei schlecht sichtbaren Inhalten.

**Voraussetzungen:** erfolgreicher nativer Build, benanntes iPhone/iOS und LOOI-Firmware/Montage, Kamera-/Mikrofonrecht, funktionierender STOP; keine zusätzliche Bewegung. Bilder sind synthetische unkritische Anleitungen/Etiketten/Diagramme, keine privaten oder medizinischen Daten. Bestehendes Realtime-Modell ist in beiden Bedingungen gleich.

**Aufbau:** bestehender `look-here`/Picker → einzelnes Bild mit Referenz → Erklärung oder explizite Neuaufnahmebitte → Nutzerbestätigung. Kamera-/Sprach-/Sessionbesitz wie Bestand. 24 Entwicklungsszenarien und 24 unberührte Tests: Licht, Unschärfe, Spiegelung, falscher Ausschnitt, Objektwechsel und Zweideutigkeit gleichmäßig variieren; Front/Rückkamera getrennt ausweisen.

**Vergleich/Messung:** zuerst technischer Test, danach 6–10 explorative Personen in wechselnder Reihenfolge freie Bildfrage, geführter Roboterablauf und identischer Smartphoneablauf. Primär: korrekt gelöste Aufgabe; sekundär Korrekturen, Zeit vom Anfrageende bis brauchbarer Antwort, Neuaufnahmen, Kamerastartfehler, Ressourcen-/Temperaturwarnungen. Ziel: mindestens 90% technisch korrektes Verhalten inklusive angemessener Ablehnung unlesbarer Aufgaben; besserer Ablauf muss weniger Korrekturen bei gleichbleibender Richtigkeit zeigen. Das ist eine vorgeschlagene Produktentscheidung, keine Wirksamkeitsschwelle für alle Populationen.

**Abbruch/unklar:** selbstsichere falsche kritische Angaben, Kameraaufnahme ohne Nutzerauftrag, übernommenes Bild nach Sessionwechsel oder wiederholte Ressourcenfehler. Gleich guter Smartphoneablauf bedeutet: Funktion nützlich, Robotervorteil unbewiesen. **Budget:** $15 API, 4–8 PT Technik plus 3–5 PT explorative Auswertung; keine automatische Rekrutierung. **Artefakte:** Bildsatz/Lizenzen, Geräteinventar, Log-Zeitpunkte ohne Rohprivatdaten, Aufgabenratings/Fehlerliste. **Beweist nicht:** kontinuierliches Video, Raumwissen oder langfristige Nutzung. **Entscheidung:** Retake-UI produktisieren, Kamera zuerst reparieren, einfachere Bildfrage behalten oder Bereich einschränken.

### S3 — Korrigierte Erinnerung bleibt korrigiert

**Verantwortung/Entscheidung:** Memory/Produkt; entscheiden, ob die jetzt implementierte Kontrolle den persönlichen Kontext in späteren Gesprächen zuverlässig verbessert. **Hypothese:** eine Korrektur oder Löschung unter gewählter ID wirkt in Liste, Suche, Startkontext und neuem Backup, ohne ältere Person-/Kontextannahmen still wieder einzuführen.

**Voraussetzungen:** aktuelle Memory-Implementierung; v1-Datenbank und v1-Backup als Fixtures; aktueller DBstand v2; Kernsprachen; für Live-Nutzentest eigener freigegebener Account, für lokale Technik kein API-Zugriff. Keine automatische Sprecheridentität voraussetzen.

**Aufbau/Schnittstellen:** 20 synthetische Entwicklungs- und 20 zurückgehaltene Episoden, jeweils Fakt → Korrektur/zeitliche Einschränkung → Suche/Neusitzung → Löschung → Export/Restore. Dazu zwei Personen mit gleichen Vorlieben, Zitat/Joke, doppelter Fakt unter anderer ID, Netzverlust, Sessionwechsel während Such-/Speicheroperation. Alte und neue UI als Vergleich; bei lokalen Tests alter Stand als erwartete Baselineverletzung dokumentiert.

**Messung:** primär Anteil der Korrekturen, die in allen lokalen Pfaden korrekt wirksam sind; Ziel 100% für deterministische gewählte ID. Sekundär Quellenzuordnung, Personenkonfusion, widersprüchliche Extraktion, Zeit zum Korrigieren und erneutes Auftreten in realen Folgedialogen. Löschung aus eigener Historie oder bereits exportierten Dateien ist ein eigener Auftrag und darf nicht aus diesem Endpunkt abgeleitet werden.

**Abbruch/unklar:** verlorene unbeteiligte Daten, alte aktive Session nach erfolgreicher Mutation, FTS-/Backupwiderspruch, erneute automatische Speicherung fremder/unklarer Fakten. Bei Gesprächsfehlern lokale Integrität und Modellverhalten getrennt auswerten. **Budget:** $0 lokale Technik; optional $5 Live-Gespräche, 3–6 PT plus Wiederholungsbeobachtung. **Artefakte:** reale SQLite-Regressionen, synthetische Episoden, anonymisierte Fehlerlabels, Backupkompatibilitätsmatrix. **Beweist nicht:** vollständige Löschung bei Dritten oder richtiges Langzeitgedächtnis. **Entscheidung:** Kontrolle ausliefern, Extraktion auf Vorschläge beschränken oder Herkunft/Mehrpersonenmodell erweitern.

## J. Umsetzung, Priorität und Grenzen

Die erste technische Lieferung implementiert K1, K2 und die nachgewiesene physische Parserkorrektur. Das ist eine abgeschlossene Auswahl aus der Recherche; die übrigen Kandidaten sind ausdrücklich geprüfte Optionen mit noch offenen Nutzennachweisen. Drei parallele große Architekturumbauten werden vermieden.

| Bereich | Konkrete Änderung | Prüfziel |
|---|---|---|
| Memory | additive Schema-v2-Migration; Legacy-Herkunft unbekannt; ID-stabile Korrektur; Einzel-Löschung; FTS-/Backups konsistent; UI-Suche/Editor/Herkunft | reale SQLite-/FTS- und Roundtriptests, UI-Zustände |
| Sessionkonsistenz | Korrektur/Löschung/Restore stoppen aktive Realtime-Sitzung; Neustart während Mutation gesperrt; verspätetes Speichern prüft Session | Race-/Mutations-/bestehende Session-Isolationstests |
| Physische Absicht | Negation, Frage, Zitat und weitere Nichtbefehls-Kontexte konservativ sperren, STOP zuerst | RU/UK/EN-Positive/Negative, vorhandene Routing-/Safetytests |
| Aktuelle Information | sekundäre Research-Seite, explizite Frage, BYOK-Responses, geprüfte Inlinequellen, Abbruch/Fehlerzustände | simulierte HTTP-/Parsing-/Abbruchfälle, native UI-Abnahme |
| Dokumentation | deutsche Entscheidungsvorlage mit Quellen, Kosten, 20 Kandidaten, Vertiefungen, Spikes und Widerspruchsregister | tatsächliche/ungeprüfte Evidenz sichtbar |

Kurzfristig folgen die native Gerätebasis und S3. Danach S2, weil Einzelbilder schon existieren und der Aufgabennutzen messbar ist. S1 folgt nur bei beobachteten Routingfehlern; ohne solche Daten verliert zusätzliche KI-Klassifikation Vorrang. Bei mehreren Geräten oder zwingenden Hintergrundaufträgen rückt Architektur B vor; bei unverändertem Ein-Gerät-/Vordergrundbetrieb bleibt A angemessen.

Bis 2028 bleiben die nützlichen Grundlagen stabil: korrigierbare Fakten, Quelle/Zeit, klare Session-/Werkzeugverträge und unabhängige lokale Ausführung. Bei keinem Modellfortschritt verbessern sie den Bestand. Bei schrittweisem Fortschritt lassen sich einzelne Adapter vergleichen. Bei großem Fortschritt bleiben Audio-/BLE-/Datenverträge und reale Nutzervergleiche erforderlich; es gibt keinen erfundenen Releaseplan.

## K. Zurückgestellt und Auslöser zur Neubewertung

| Ansatz | Grund | Beobachtbarer Auslöser |
|---|---|---|
| generelle GPT-Live-Migration | zusätzlicher Voice-/Betriebsumbau ohne belegten Parallelitätsnutzen | gleiche Szenarien zeigen besseren vollständigen Dialog bei tragbaren Kosten |
| dauerhafte Raum-/Objektbeobachtung | keine verlässliche Karte, Montage-/Privatheits-/Ressourcenfragen | freigegebener Ereignisbildtest schlägt einfaches Foto und besteht Gerätebudget |
| Touch als Zustimmung/Identität | Community-Semantik und Wiederholungsrate unbekannt | saubere Rohdaten mit Firmwarebezug; zunächst nur Pause/UI-Reaktion |
| autonome Fahrt / beliebige Modellgesten | keine präzise Positions-/Ausführungsrückmeldung | enges, bestätigtes High-Level-Verhalten mit Hardwareabnahme; keine Raw-Payload-Freigabe |
| Therapie-/Pflege-/Lernwirksamkeitsversprechen | Zielgruppe und geeignete Studien fehlen | fachlich passender Studienentwurf plus belastbare Ergebnisse |
| Cloudmemory/Vector Store als Standard | Korrektur/Löschsemantik wichtiger als Speichertechnik | Retrievaltest belegt Nutzen gegenüber FTS bei realer Bestandsgröße |
| Fine-Tuning | kein stabiles gemessenes Fehlerproblem/Datenbudget | sauber gelabelter Holdout und wiederholter Vorteil gegenüber Prompt/Toolverbesserung |
| selbstständige proaktive Routinen | Störkosten und Nutzerbedarf ungemessen | ausdrücklich gewählte Routine hat wiederholte Nutzung und geringe Abbruchrate |

## L. Evidenz-, Widerspruchs- und Prüfregister

Evidenzbegriffe: Nutzeranforderung = direkte Sessionpräferenz; Codebefund = am genannten Stand gelesen; Testbefund = tatsächlich ausgeführter benannter Test; Hardwarebefund = benanntes physisches Gerät beobachtet; Herstellerdokumentation/Community/Forschung werden als fremde Evidenz kenntlich; Schlussfolgerung/Hypothese sind eigene Ableitungen. Reifegrad und Accountzugriff bleiben unabhängig.

| Claim | Evidenz / Quelle | Einschränkung / Konsequenz / Auflösung |
|---|---|---|
| C1 Checkout ist iOS-Portierungsstand | Git HEAD `09374b5`, lokale Swift-Module | keine automatische Build- oder Hardwarezusage |
| C2 Memory hatte keinen Einzelkorrekturpfad | Ausgangscode DB/Memory-Screen | jetzt gezielt implementiert, Integrität lokal geprüft |
| C3 Negierter Fahrbefehl wurde fehlgedeutet | Parser vor Änderung direkt ausgeführt; fokussierter Regressionstest | Text-/ASR-Spektrum begrenzt; keine Motoren aktiviert |
| C4 Decisions ist eigenständige Bewertung | offizieller [Guide](https://developers.openai.com/api/docs/guides/decisions) und Create-Schema, 25.10.2026 | kein direkter Realtime-/Roh-Audio-Vertrag vorausgesetzt; Zugriff ungetestet |
| C5 Live verlangt Architekturwechsel | offizieller [Migrationsguide](https://developers.openai.com/api/docs/guides/live-migration), Audio-/Eventtabelle | keine lokale Latenz-/Qualitätsmessung; bestehender PCM-Pfad bleibt |
| C6 Websuche kann Quellenannotation liefern | [Web Search](https://developers.openai.com/api/docs/guides/tools-web-search) + [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) | Requestverarbeitung mit Fixtures; Live-Erfolg im Account ungetestet |
| C7 Roboterpräsenz garantiert keinen Nutzen | [Ren et al.](https://www.nature.com/articles/s41598-026-51556-1), 10 Studien, 2026 | keine direkte LOOI-/Alltagsmessung; Smartphonekontrolle einplanen |
| C8 FED9 `0E` ist nicht unabhängig als Distanz bestätigt | lokaler Decoder gegen [Community-Rohbefunde](https://github.com/andrey-tut/LOOI-Robot/blob/main/docs/FED9_TELEMETRY.md) | Firmware-/Lage-/Abstandsvariation getrennt messen; bestehende Safety nicht verändern |
| C9 Hersteller-Cloudclaims widersprechen Marketingvereinfachung | offizielle [Privacy Policy](https://looirobot.com/pages/privacy-policy), Produktseite | betrifft Hersteller-App, nicht My LOOI; Quellenwiderspruch bleibt sichtbar |
| C10 Korrektur ist keine vollständige Datenauslöschung | Code: getrennte Tabellen/Backupdateien/Cloudsession | UI/Doku benennen verbleibende Historie und alte Exporte |

Gemeinsame Quellenregister und Grenzen: [A: Bestand/Hardware](bestand-hardware.md#code--und-quellenanker), [B/D: OpenAI/Architektur/Kosten](openai-architektur-kosten.md), [C: Produkt/HRI](produkt-hri.md). Tragende Aussagen zu Decisions, Live-Migration, Webzitaten, Luna, FED9 und dem Nullbefund bei Roboterpräsenz wurden durch die Integration nochmals direkt in den Primärquellen gelesen. PMC war bei einem Abruf durch eine Browserprüfung gesperrt; die zugängliche Originalveröffentlichung bei Scientific Reports wurde verwendet. Nicht erreichbare Inhalte werden nicht aus Titeln rekonstruiert.

### Prüfprotokoll

| Ausgeführte Prüfung | Ergebnis und Grenze |
|---|---|
| Erweiterte `pnpm run ios:check`-Kette | TypeScript und alle 13 Skripte erfolgreich; einschließlich neuer Memory-, Web-, Befehls- und Pod-Konfigurationsprüfungen |
| Unabhängiges Inventar ohne Fail-fast | 67 Aufrufe aus Paket-/iOS-Kette plus gezielten Checks, 63 erfolgreich und vier fehlgeschlagen; manche Skripte werden in mehreren Ketten aufgerufen, das sind keine 67 verschiedenen Testfälle |
| Vier verbleibende Fehler | Android `v2.1.137`/`138`: fehlender JPEG-Still-Capture/Rückkamera-Vertrag; `139`/`140`: fehlende Kotlin-Photo-Picker-Datei. Genau die bereits vor dieser Lieferung dokumentierten Plattformlücken; Gesamtsuite deshalb nicht grün |
| SQLite/FTS | echte Node-SQLite-Datenbank: Migration, Herkunft, Aktualisierung, altes Backup, Roundtrip, Einzel-Löschung und spätes Schreiben erfolgreich; kein Ersatz für Expo-SQLite auf dem iPhone |
| Memory-Mutationsgrenze | aktive Cloudsession und aktives Transkript werden vor der DB-Änderung invalidiert; Neustart blockiert; fehlgeschlagener Stop verhindert Schreiben |
| Webrecherche | nur simulierte Responses/HTTP-Aufrufe: Requestgrenzen, Status/Refusal, Inlinezitate, Unicode/Bereichsgrenzen, ungültige Links, fehlender Key, Timeout, Abbruch und Spätantworten erfolgreich |
| Physische Befehle | reproduzierter Fehler vor Fix; gezielte RU/UK/EN-Positiv-/Negativtests und vorhandenes Routing erfolgreich. Keine tatsächliche Bewegung ausgeführt |
| Public-Audit und Lockgraph | erfolgreich; Patchregistrierung ohne Versionsupgrade, 697 Pakete/697 Snapshots. Öffentliche Hersteller-/Community-Zitate sind eng auf Research-Markdown begrenzt; Secret-/Personendatenprüfung bleibt aktiv |
| iOS-JavaScript/React-Native-Hermes | aktueller Stand erfolgreich mit `EXPO_OFFLINE=1 CI=true pnpm exec expo export --platform ios`; ca. 6 MB HBC, kein laufender iPhone-/UI-Test. Die JavaScript-Engine ist unabhängig von Nous Hermes Agent |
| UI-Quellprüfung | Lokalisierung/TypeScript erfolgreich; Impeccable-Detector ohne deterministische Befunde. Kein visueller Screenshot-/Tastatur-/VoiceOver-Nachweis |
| Native Vorbereitung | alle drei offiziellen Vosk-Modelle geladen, Expo-SDK-56-Prebuild und CocoaPods mit 133 Pods erfolgreich |
| Native Reparaturen | veraltetes ZIPFoundation-Podziel im Plugin angehoben; Ruby-Verhaltenstest erfolgreich. ExpoModulesJSI-C-Callback-Compilerfehler reproduziert und versionsgebunden gepatcht, Nil-Semantik erhalten |
| Nativer Gesamtbuild | **erfolgreich**, `xcodebuild` Exit 0 und `BUILD SUCCEEDED`: Debug, `iphonesimulator`, generisches Simulatorziel, ARM64, zwei Jobs, `CODE_SIGNING_ALLOWED=NO`. App-Binary unter `output/ios-derived/Build/Products/Debug-iphonesimulator/MyLOOI.app`; vollständiges lokales Log unter `output/ios-simulator-build.log`. Das ist keine signierte iPhone-Distribution |
| Simulator-/Gerätebetrieb | Simulator meldet CoreSimulator 1171.7.0 gegenüber benötigtem 1174.9.2; Systemkomponenteninstallation verlangt OS-Autorisierung. Auch nach erfolgreichem Build listet `simctl` null verfügbare Geräte. Kein Screenshot-/Interaktionsnachweis und keine physische Abnahme am iPhone 16/LOOI |

Die Checks liefen auf macOS mit Node 26.5.0, pnpm 10.34.5, Xcode 27.1 und CocoaPods 1.16.2. Ein früherer Inventarlauf hatte einen Fehler im temporären Runner (Scriptargument verworfen) und wurde vollständig verworfen; nur die erneut korrekt gestarteten Prozesse mit erfasstem Exitstatus wurden ausgewertet. Zusätzlich gefundene Audit-Fehlalarme für synthetische Testdaten/Patchdateinamen und ein doppeltes JSX-Attribut wurden korrigiert und erneut geprüft.

iPhone/LOOI-Hardware, akustische Barge-in-/Routentests, echte Suchabrechnung und Nutzerstudien wurden in dieser ersten Lieferung nicht durchgeführt. Keine Motoren aktiviert, keine Firmwareänderung und keine Kontaktaufnahme. Die nachfolgende, ausdrücklich freigegebene Hermes-Erweiterung wurde auf Fly.io bereitgestellt und mit zwei kleinen öffentlichen Modell-/Rechercheaufträgen geprüft; deren aktueller Stand und verbleibende Grenzen stehen in [Hermes-Agent-Anbindung](../hermes-agent.md).

### Abschluss: drei konkrete nächste Schritte

1. **Native Basis am benannten iPhone abnehmen:** Audio, Kamera, BLE, Files und Vordergrundwechsel prüfen. Entscheidung: welche Funktionen wirklich auf dem Zielgerät nutzbar sind.
2. **S3 mit den umgesetzten Memorykontrollen ausführen:** Korrektur, Herkunft und Löschung in wiederholten Gesprächen überprüfen. Entscheidung: automatische Extraktion beibehalten oder stärker als prüfbaren Vorschlag behandeln.
3. **S2 gegen den identischen Smartphonepfad ausführen; S1 nur bei belegtem Routingbedarf:** Bildnutzen und gegebenenfalls begrenzte Decisions messbar bewerten. Entscheidung: geführte Aktivität produktisieren, einfachere Lösung bevorzugen oder den Ansatz zurückstellen.
