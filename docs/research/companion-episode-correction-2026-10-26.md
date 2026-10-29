# Bestätigte gemeinsame Erinnerungen berichtigen

Stand: 26. Oktober 2026. Lokale Weiterarbeit am unveränderten Companion-Ziel,
ohne Anbieteraufruf, iPhone oder Roboterbewegung.

## Reproduzierter Ausgangspunkt

Der öffentliche installierte Behavior-Runtime-/Eventpfad speichert Gerda nach
einer gehörten Frage und einem späteren „Ja“ mit dem Ergebnis „Sie landete am
roten Zaun.“. Auf „Bitte korrigiere die Erinnerung an Gerda: Sie landete neben
dem Baum.“ liefert eine neue Episode unter demselben Namen `title_exists`;
der alte Fakt bleibt unverändert. Ein Korrekturwerkzeug existiert nicht.

Die Variante „Korrektur zu Gerda: Sie landete neben dem Baum.“ zeigt eine zweite
Lücke: Die Engine verwirft beim Abbrechen alter Arbeit auch die Berechtigung
des gerade frisch übergebenen Korrekturturns (`session-inactive`). Eine
Referenzreparatur allein korrigiert keinen gespeicherten Episodenfakt.

Die letzte Zielrunde war belegter Implementierungsfortschritt: echte Spielpause,
geprüfte Sprachtransport- und STOP-Übergänge. Diese Runde bearbeitet einen
anderen konkreten Ablauf des bestehenden Erinnerungsvermögens.

## Gewählter Ablauf

Die Person kann genau einen gespeicherten Beschreibungs- oder Ergebnisfakt
berichtigen. Sie nennt den gespeicherten Titel, bittet ausdrücklich um die
Korrektur und gibt die vollständige neue Formulierung vor. LOOI fragt einmal
mit Titel, Feld und Ersatztext nach. Erst ein eindeutiges Ja in einem späteren
Turn nach dieser gehörten Frage ändert den Fakt. Bis dahin bleibt die alte
bestätigte Fassung erhalten. Nein, Themenwechsel, Ablauf oder Abbruch verwerfen
den Vorschlag.

Löschen und Neuanlegen würde Identität und daran gebundene Präferenzen und
Tätigkeiten verlieren. Eine sofortige freie Modellüberschreibung wäre bei
Missverständnissen schwer erkennbar. Die feldweise bestätigte Korrektur erhält
die stabile Episode und verlangt eine überprüfbare genaue Ersatzpassage.

Titel, ursprüngliche Erstellquelle, Erstellzeit, Rituale, visuelle Baseline und
bestätigte Tätigkeitsschritte werden dabei nicht umgeschrieben. Die letzte
bestätigte Korrektur pro Feld erhält ihre eigene Quelle; es entsteht keine
unbegrenzte Änderungshistorie und kein zusätzlicher Episodeneintrag.

Bei einer laufenden gemeinsamen Objektaufgabe gilt weiterhin die bestehende
Korrekturregel: Der offene Versuch wird pausiert und ein unbestätigter Schritt
verworfen. Task-ID und bestätigte Schritte bleiben erhalten. Der Korrekturtext
und das Ja zur Erinnerung dürfen keinen Tätigkeitsschritt bestätigen oder den
Versuch fortsetzen. Eine zuvor pausierte gewöhnliche Aufgabe bleibt unverändert.

## Zuständigkeit und Schnittstelle

`behavior-companion.ts` besitzt die neue Aktion `correct_experience` und alle
Regeln für Belege, Frage, Bestätigung, Ablauf, persistierte Fakten und
Korrekturquellen. Die bestehenden PCM-/WebRTC-Adapter übersetzen das neue
Werkzeug `correct_shared_experience` in diese Aktion; ihre Session-/Turn-
Bindung bleibt zuständig für verspätete Antworten. Kein Adapter entscheidet
selbst, ob ein Fakt gespeichert werden darf.

Das hält das Verhalten hinter einer kleinen gemeinsamen Schnittstelle. Die
Caller liefern ID, ein Feld, exakten Ersatz und aktuellen Textbeleg. Ablehnung
ändert nichts; ein erfolgreicher Vorschlag ist noch keine gespeicherte
Korrektur. Speicher- und Laufzeitaufwand bleiben auf zwei begrenzte Quellen pro
Episode sowie eine kurzlebige offene Bestätigung begrenzt. Bestehende Records
ohne Korrekturquellen behalten ihr Format und bleiben lesbar.

Die Engine beendet alte Korrekturarbeit, lässt aber die aktuelle explizite
Korrekturäußerung selbst für eine neue belegte Aktion zu. Eine offene
Faktenkorrektur verlangt bei beiden Sprachwegen den aktuellen Transkriptabschluss
vor der Antwort. Die genaue Bestätigungsfrage und der tatsächliche spätere
Zustandswechsel sind die Testoberfläche; ein behauptetes „gemerkt“ reicht nicht.

Der neue öffentliche Sprachtransporttest fand beim ersten Durchlauf noch die
Ursache von `stale-turn`: Die Engine übergab zuerst den neuen Text an den
Companion und löschte ihn anschließend mit der Bereinigung des alten Turns.
Die Bereinigung erfolgt jetzt davor. Pause-, Verwerfen- und Spielstart-Turns
behalten ihre bisher geschlossene Aktionsberechtigung; eine frische
Korrekturäußerung darf ihren eigenen belegten Reparaturvorschlag auslösen.

Zusätzlich prüft der Companion den Korrekturauftrag im ganzen aktuellen
Nutzerturn. Ein gültig aussehender Beleg, den das Modell aus zitierter Rede
oder nach einem Verbot herausgeschnitten hat, reicht nicht. Eine ausdrücklich
beauftragte Korrektur mit zitierter Ersatzformulierung bleibt dagegen möglich.

## Abnahmekriterien

- Beide Felder lassen sich nach gehörter voller Frage und späterem Ja ändern,
  ohne eine andere Episode, Präferenz oder bestätigten Tätigkeitsschritt
  umzuschreiben; ein laufender Objektversuch wird ausdrücklich pausiert.
- Keine Speicherung bei fehlendem eindeutigen Titel, erfundenem Ersatz,
  fehlender expliziter Korrektur, Zitat, Negation, vorzeitigem Ja oder Abbruch.
- Kein stilles Kürzen; lange Ersatztexte müssen passend neu formuliert werden.
- Bestätigte Korrekturen überleben Serialisierung und liefern beim genauen
  Abruf und bei der Suche die aktuelle Fassung mit ihrer eigenen Quelle.
- Tatsächliche PCM-/WebRTC-Werkzeugrouten behalten ihre Turn-Bindung;
  verworfene oder verspätete Antworten dürfen die Korrektur nicht anwenden.
- Entwicklung und Prüfung bleiben ohne Modell-, Audio- und Hardwarezugang.

Lokale vorgegebene Transkripte und Modellantworten können diesen Vertrag
prüfen. Natürliche Erkennung und passende Sprache im Alltag bleiben damit
weiterhin unbelegt; das gesamte Companion-Ziel ist noch nicht abgeschlossen.

Die betroffenen Quellen sind `src/behavior/behavior-companion.ts` für die
Episoden, `src/behavior/behavior-engine.ts` für den frischen Turn und den
Tätigkeitsübergang, `src/behavior/behavior-policy.ts` für die frühen
Korrekturmarker sowie `src/behavior/behavior-runtime.ts` für die manuelle
Antwortfreigabe. `src/voice/realtime-config.ts` und beide Realtime-Transports
exponieren und übersetzen das Werkzeug. Es gibt keine neue Oberfläche oder
neue Motoraktion. Die neuen Tests sind in `companion:continuity-test` und damit
in der vorhandenen Offline- und iOS-Prüfung eingebunden.

## Ausgeführte Prüfung

- `pnpm run companion:offline-test`: PASS. Der neue Kernprüflauf umfasst beide
  Felder in Deutsch, Englisch, Russisch und Ukrainisch, Gegenfälle,
  Kopierisolation, Bestätigungsablauf, volle Kapazität und Wiederherstellung.
  Der tatsächliche Runtime- und Sprachadapterpfad besteht für PCM und WebRTC.
- `node scripts/companion-live-runtime.test.mjs` und
  `node scripts/companion-live-integration.test.mjs`: PASS. Die bestehenden
  sechs isolierten Fixtures und das lokale Tool-/Antwortprotokoll bestehen
  auch mit dem erweiterten Testadapter.
- `pnpm run ios:check`: PASS auf dem abschließenden Quellstand, einschließlich
  TypeScript und der vorhandenen lokalen Runtime-, Safety-, Gedächtnis-,
  Spiel-, Aktivitäts- und Sprachtransportprüfungen.
- Offline-iOS-Export: PASS mit
  `EXPO_OFFLINE=1 pnpm exec expo export --platform ios --output-dir output/companion-episode-correction-ios-export`.
  Bundle: `entry-7d7d1e03b6eb867c4839bf653c2a080a.hbc`.
- Unabhängiger enger Code- und Testreview: keine weitere konkrete Lücke im
  Korrekturpfad nach den beschriebenen Reparaturen gefunden.

Die gemeinsame Prüfung fand zunächst einen zu langen gewöhnlichen
Companion-Kontext. Die zusätzlichen Korrekturhinweise werden deshalb nur bei
einer offenen Korrektur oder angezeigten korrigierten Fakten mitgegeben.
Die bestehende Mischfallprüfung mit zwei Episoden, offener Bestätigung und
Interesse bleibt unverändert unter ihrer Grenze von 2.400 Zeichen.

„Gehört“ bezeichnet im Runtime-Test den tatsächlich ausgeführten lokalen
Abschlusspfad nach vorgegebenem Audio-Transkript und ersetztem Playback-Ende
(PCM-Drain-Ereignis bzw. WebRTC-Buffer-Ende). Das ist keine akustische
Erkennungsprüfung. Es gab keinen Modellaufruf, Mikrofon-/Kamerazugriff oder
Roboterbetrieb; der Export ist kein nativer Xcode-Build.
