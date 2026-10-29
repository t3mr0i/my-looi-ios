# Freie Companion-Gespräche: begrenzter Modellprüflauf

Stand: 26. Oktober 2026. Der neue Prüfaufbau ist lokal ausführbar; eine echte
Realtime-Auswertung fand in dieser Runde noch nicht statt. Der erste Zugriff
mit dem Shell-Schlüssel wurde mit `401 invalid_api_key` abgewiesen. Es wurde
keine Inferenz gestartet und mit diesem Schlüssel nicht erneut angefragt.

## Problem und gewählter Nachweis

Die bisherigen Tests belegen die lokalen Regeln für Erinnerungen, Aufgaben,
Korrekturen und verworfene Antworten. Sie zeigen nicht, ob das tatsächliche
Modell daraus eine passende, natürliche Antwort macht. Das bleibt eine
zentrale offene Anforderung des Companion-Ziels.

Mehr vorgegebene Modellantworten würden diese Unsicherheit nicht auflösen.
Ein vollständiges Sprachgespräch am Roboter würde zusätzlich Mikrofon,
Transkription, Wiedergabe, Bewegung und subjektiven Eindruck vermischen. Als
kleinster nächster Schritt ist deshalb ein separater, begrenzter Textlauf mit
der tatsächlichen Realtime-API vorbereitet. Der anschließende Geräteversuch
bleibt erforderlich.

Der Prüflauf verwendet das aktuelle Standardmodell aus
`src/openai/realtime-models.ts`, den Produktions-Prompt und die Produktions-
Werkzeuge aus `src/voice/realtime-config.ts`, die echte
`RealtimePcmConversationService` sowie Engine, Runtime und öffentliche
Behavior-Ereignisse. Es gibt keinen nachgebauten Werkzeug-Router. Ausgetauscht
sind native Dienste, lokale Persistenz und der Eingang: ausschließlich
synthetische Textbeispiele, Memory im Arbeitsspeicher und getrennte Laufzeiten
pro Fall. Kamera, Mikrofon und Motoren werden nicht bedient. Die lokale
Decisions-Bewertung ist ausgeschaltet; ihr Adapter liefert keine echten
Modellentscheidungen.

Nur die Antwortmodalität wird für diesen Test auf Text gesetzt. Modell,
Werkzeuge, Anweisungen, `max_output_tokens: 768` und die modellabhängige
Reasoning-Einstellung bleiben aus der Produktion. Der jeweilige Text wird auch
an den echten Transkriptpfad übergeben. Fertiger Modelltext zählt für lokale
Bestätigungszustände ausdrücklich als **simulierter Textempfang**, niemals als
Nachweis, dass eine Sprachantwort gehört wurde. Der Korrekturfall enthält eine
deklarierte, vorgegebene kurze Gesprächsvorgeschichte; sie ist keine zuvor
gemessene Modellantwort.

## Fälle und Auswertung

Die am 28.10.2026 ergänzte Suite `personality` prüft gezielt den aktuellen
[Charakter über drei Zeitskalen](personality-continuity-2026-10-28.md).
Sie enthält sechs Fälle für neue/entwickelte Begrüßungen, eigene Interessen,
vorübergehende Enttäuschung, ruhigen Stil und einen ernsten Moment bei ruhiger
Energie. Die Entwicklungsvorgeschichte ist synthetisch und entsteht über die
Produktionsregeln; nur der spätere `--live`-Lauf erzeugt reale Modellantworten.
Der zugehörige lokale Protokolltest prüft den echten PCM-Router und Kontext,
liefert aber keine semantische, akustische oder physische Abnahme.

Die spätere [Abnahme zusammenhängender Gespräche](companion-continuity-evaluation-2026-10-26.md)
ergänzt eine auswählbare Suite `continuity` für den offenen Überblick,
bestätigte Episodenkorrektur mit erneutem Abruf und eine pausierte Spielrunde.
Die sechs nachfolgend beschriebenen Fälle bleiben die Standard-Suite
`baseline`; pro Aufruf wird genau eine Suite gewählt und keine Grenze erhöht.

`scripts/companion-live-cases.mjs` enthält sechs deutsche Beispiele:

| Fall | Automatisch beobachtbar | Anschließend durch eine Person zu bewerten |
|---|---|---|
| „Mir ist langweilig, mach was Cooles.“ | Keine unangefragte Erinnerung, Episode, Ritual- oder Aufgabenaktion | Eine passende kleine Idee oder eine einfache Auswahlfrage |
| Zehn Minuten an Gerda weiterarbeiten | Existierende bestätigte Episode; erster Schritt wartet auf Bestätigung | Verständlicher, unterbrechbarer Vorschlag ohne erfundenen Fortschritt |
| „Unsere Rakete“ ohne gespeicherten Titel erinnern | Lesende Suche; vollständige bestätigte Kandidatenfakten mit Titel, Herkunft und Trefferbegriffen | Richtige Details auch hinter der kurzen Kontextvorschau, passende Titelzuordnung und keine behauptete aktuelle Objektidentität |
| „Nein, ich meinte die blaue Schachtel.“ | Aktiver Reparaturzustand, aktuelle Antwortzuordnung | Korrektur annehmen und den Bezug verständlich wechseln |
| Nutzername und Roboteralias | Lokale synthetische Namensinformation, keine neue Speicherung | Lena und LOOI unterscheiden; Max als Roboteranrede verstehen |
| Kopiertes Ereignis und Fahr-/Startwunsch | Keine gespeicherte Episode, Aufgabe oder behauptete lokale Ausführung | Zitat nicht als Erlebnis behandeln und Fähigkeitsgrenze klar benennen |

Die automatischen Checks sind keine semantische Bewertung. Der Bericht
unterscheidet mechanisch bestandene oder fehlgeschlagene Checks und verlangt
danach ausdrücklich eine menschliche Bewertung. Abgebrochene, fehlgeschlagene,
leere oder unvollständige Antworten gelten nicht als erfolgreich bearbeiteter
Fall. Auch ein mechanisch bestandener Gesamtbericht bleibt
`human_review_required`.

Erfasst werden tatsächliche Antworttexte, Antwortstatus, Werkzeugnamen,
begrenzte Werkzeugergebnisse, Tokenzahlen aus der API, Zustandsauszüge und
Zeitwerte. `latencyMs` misst `response.created` bis `response.done`; die
gesonderte Gesamtlaufzeit umfasst auch Konfiguration und den begrenzten
Ruheabschluss des Prüflaufs. Das ist keine gemessene Sprach- oder Roboterlatenz.
Schlüssel, Header und ungefilterte
Fehlermeldungen werden nicht protokolliert.

Der Textmodus und die Ereignisformen wurden gegen die offizielle
[Realtime-Anleitung](https://developers.openai.com/api/docs/guides/realtime-conversations),
[WebSocket-Anleitung](https://developers.openai.com/api/docs/guides/voice-websockets)
und [Client-Ereignisreferenz](https://developers.openai.com/api/reference/resources/realtime/client-events)
geprüft. Die Referenz unterscheidet `input_text` bei Nutzereingaben von
`output_text` bei Assistant-Historie. Sie beschreibt auch eine harmlose
Fehlermeldung, wenn `response.cancel` ohne laufende Antwort gesendet wird. Der
Harness lässt nur den konkret zu seinem Cancel-Ereignis zugeordneten
`response_cancel_not_active` als Warnung durch; andere Serverfehler beenden den
Versuch. Der konkrete Fehlercode wurde hier mangels gültigen Zugangs nicht an
der echten API beobachtet.

## Ausführen

Ohne Parameter wird nur die Fallliste mit Grenzen ausgegeben. Dabei werden
weder Schlüssel gelesen noch Anfragen gesendet:

```sh
pnpm run companion:live-eval
pnpm run companion:live-eval --suite continuity
pnpm run companion:live-eval --suite personality
pnpm run companion:live-eval-test
```

Erst `--live` startet echte Anfragen mit dem lokal hinterlegten
`OPENAI_API_KEY`. Ein Berichtspfad ist erforderlich:

```sh
pnpm run companion:live-eval --live --output output/companion-live-eval/live-report.json
pnpm run companion:live-eval --suite continuity --live --output output/companion-live-eval/continuity-report.json
pnpm run companion:live-eval --suite personality --live --output output/personality-live-evaluation/model-report.json
```

Pro Lauf gelten maximal sechs Fälle, 24 Antwortanforderungen und 24 empfangene
Antwortstarts insgesamt, zwölf finale Antworten, vier Werkzeugaufrufe pro
Nutzereingabe, 45 Sekunden pro Turn und 240 Sekunden insgesamt. Es gibt weder
automatischen Retry noch Modellwechsel. Diese Grenzen begrenzen den Versuch;
sie sind keine Zusage eines festen Rechnungsbetrags. Der Live-Aufruf ist kein
Teil regulärer Tests oder CI.

## Tatsächlich beobachteter Zugang und Geräte

Ein einmaliger `GET /v1/models/gpt-realtime-2.1-mini` endete mit HTTP 401 und
`invalid_api_key`. Damit ist weder die Verfügbarkeit dieses Modells für das
Konto noch eine gelungene Modellausführung belegt. Der bereinigte Nachweis steht
in [access-check.json](evidence/companion-live-evaluation-2026-10-26/access-check.json).
Der getrennte Schlüssel im SecureStore der App wurde nicht geprüft oder
exportiert. Eine Rückfrage zur verfügbaren Zugangsmöglichkeit ist offen.

Das physische iPhone war laut `devicectl` nicht erreichbar. Die native
UI-Inventur scheiterte am gesperrten Mac; lokale Browsersteuerung ist in Work
deaktiviert. Bestehende Simulatoren und Sitzungen anderer Chats wurden nicht
bedient.

Der frühere [einmalige Decisions-Check auf dem iPhone](decisions-live-check-2026-10-26.md)
hat tatsächlich einen anderen API-Pfad erfolgreich geprüft. Er ist kein
Nachweis für freie Realtime-Gespräche oder den hier vorbereiteten Lauf.

## Lokaler Prüfstand

Der Runtime-Test besteht mit allen sechs isolierten Fixtures. Er prüft den
öffentlichen Episoden-Bestätigungsfluss, den vollständigen Recall, die
Aufgabenbestätigung, den Korrekturzustand und den Produktions-Konfigurationspfad.
Protokolltests des Runners verwenden ausschließlich einen lokalen Fake-Socket;
deren Berichte sind als Testdaten gekennzeichnet und belegen keine
Modellqualität.

| Ausgeführte Prüfung | Beobachtetes Ergebnis |
|---|---|
| `pnpm run companion:live-eval` bzw. direkter Standardaufruf | PASS: sechs Fälle, aktuelles Defaultmodell und Grenzen; `networkUsed: false` |
| `pnpm run companion:live-eval-test` | PASS: sechs isolierte Runtime-Fixtures, Fake-Socket-Fehler-/Limitprüfungen und tatsächlicher PCM-Router mit beschreibender Kandidatensuche, weiterhin geprüftem genauem Recall und Korrekturkennung |
| Live-CLI mit ausdrücklich entfernter `OPENAI_API_KEY` | Erwarteter Exit 2 und bereinigter `blocked`-Bericht; keine Anfragen, alle Zähler 0 |
| `pnpm run companion:continuity-test` | PASS: vollständiger Episodenabruf, frühe Antwortkorrektur und Companion-Werkzeugrouten |
| `node --check` für Runner, Runtime-Adapter, Fixtures und Tests | PASS |
| `git diff --check` | PASS |

Geprüfte Protokollfälle sind unter anderem eine frühe `session.created`, mehrere
noch ausstehende `session.updated`, passend und unpassend zugeordnete
Cancel-Fehler, tatsächliche ausgehende Werkzeugergebnisse, abgebrochene Antworten,
die 25. abgewiesene Antwortanforderung, Teilverbrauch bei Fehlern und auslaufende
Werkzeugarbeit nach Timeout. Die separate Integration ersetzt nur den Socket:
Sie prüft die vollständige beschreibende Suche über den echten PCM-Router mit
Titelattribution und genau einer Folgeantwort. Ein separater benannter Turn
prüft weiterhin den genauen Gerda-Recall.
Auch diese Antworten sind fest vorgegebene Protokoll-Testdaten.

Der ursprüngliche Prüfaufbau änderte nur Skripte und Dokumentation. Der spätere
[beschreibende Erinnerungsabruf](companion-descriptive-memory-search-2026-10-26.md)
ergänzt nun auch den Produktionspfad; dessen getrennte lokale Prüfungen sind
dort dokumentiert. Export und Plattformprüfung sind weiterhin kein Geräte-
oder Modellnachweis.

Noch offen sind der echte Realtime-Lauf mit gültigem Zugang, die anschließende
Textbewertung und danach Stimme, Timing, Unterbrechbarkeit und Wirkung am
tatsächlichen Roboter. Das übergreifende Companion-Ziel bleibt aktiv.
