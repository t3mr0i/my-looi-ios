# Verlässliches Anknüpfen und Korrigieren im Gespräch

Stand: 26. Oktober 2026. Weiterarbeit am
[Companion-Ziel](companion-goal-acceptance-2026-10-26.md), nach persönlichen
Ritualen und gemeinsamen Tätigkeiten. Die vorige Runde war Fortschritt:
Produktionscode, ausführbare Prüfungen und iOS-Bundle wurden erweitert. Das
Gesamtziel ist damit weiterhin nicht abgenommen.

## Zwei beobachtete Gesprächslücken

Eine bestätigte Erinnerung kann mehr enthalten als die Vorschau im
Gesprächskontext. Dort stehen höchstens 70 Zeichen der Beschreibung und 60
Zeichen des Ergebnisses. `recall_experience` lieferte bisher nur Kennung,
Status, Motiv und eine Anweisung zurück. Selbst eine eindeutig benannte
Erinnerung konnte daher ihre gespeicherten Details nicht vollständig an die
Sprachantwort weitergeben. Im reproduzierten Beispiel fehlte der hintere Teil
eines 147 Zeichen langen Raketenberichts. Ein neues Sprachmodell hätte diese
lokal zurückgehaltenen Informationen ebenfalls nicht verlässlich ergänzen
können.

Die zweite Lücke betrifft Korrekturen. Die lokale Engine erkennt beispielsweise
„No, I meant the other one“ und erzeugt einen Reparaturhinweis. Die automatische
VAD-Antwort kann aber schon vor dem fertigen Transkript begonnen haben. Der
vorhandene manuelle Turn-Pfad berücksichtigte `repairRequired` nicht. Ein
aktualisierter Kontext allein beweist daher noch nicht, dass die laufende
Antwort ihn verwendet.

Ausgangsmaterial sind `behavior-companion.ts`, `behavior-engine.ts`,
`behavior-runtime.ts`, beide Realtime-Transports und ihre Event-Schnittstelle.
Die Methode ist eine gezielte Wiederholung der realen lokalen Pfade mit
festgelegter Ereignisreihenfolge und simulierten externen Diensten. Der
unabhängige Nachweis besteht aus vollständigen zurückgegebenen Fakten sowie
der Reihenfolge Kontextupdate → alte Antwort abbrechen → neue Antwort anfordern.
Ein grüner Sprachmodell-Mock ist kein Beleg dafür, dass echte freie Antworten
inhaltlich gut oder natürlich klingen.

## Schnittstellen und Abwägung

Die bestätigten Fakten bleiben im Companion-Modul. Das bestehende
Aktionsergebnis erhält das optionale Feld `episode` mit Kennung, Titel,
vollständiger gespeicherter Beschreibung und Ergebnis, Erstellungszeit und
kopierter Herkunft. Die bestehenden Speichergrenzen gelten weiter:
Beschreibung 220, Ergebnis 180, Quellzitat 240 und Sitzungskennung 96 Zeichen.
Der Datensatz erscheint erst nach der vorhandenen eindeutigen Titelzuordnung.
Ablehnungen enthalten keine solchen Fakten. Stumme Rituale und Gestenpausen
verhindern den inhaltlichen Abruf nicht.

Beide Sprachadapter reichen dieses Ergebnis bereits als JSON weiter. Sie
müssen die Speicherstruktur, Auswahlregeln und Ritualzustände deshalb nicht
nachbilden. Der allgemeine Kontext bleibt kurz; erst der gezielte Abruf gibt
die vollständigen bestätigten Fakten frei. Eine Alternative wäre, bei jedem
Turn sämtliche Vorschauen zu vergrößern. Das würde mehr Kontext übertragen,
ohne die Trennung zwischen Kandidat und ausgewählter Erinnerung zu verbessern.
Ein weiterer Erinnerungsspeicher würde Zuständigkeit und Löschung verteilen.

Für Korrekturen wird der vorhandene Turn-Pfad genutzt. Die Alternative, alle
Antworten generell erst nach dem Transkript zu starten, würde auch gewöhnliche
Turns verändern. Die Korrektur soll dagegen genau eine frische Antwort mit
aktuellem Kontext erzeugen und danach zum normalen Ablauf zurückkehren. Ein
abgebrochener früher Versuch darf keine wartenden Companion-Aktionen übernehmen.

Die beiden Adapter ordnen die Ersatzantwort einer lokalen Anforderungskennung
zu. Bereits verworfene Antwortkennungen, wartende Werkzeugaufrufe und
zugehörige spätere Audio-/Text-/Abschlussereignisse werden abgegrenzt. Auch
normale Erinnerungs- und Sprachwerkzeuge dürfen aus einer verworfenen Antwort
keine Änderung oder weitere Antwort erzeugen. Eine noch wartende Speicherung
prüft ihren Turn vor dem Einreichen des Datenbank-Inserts erneut. Bereits
eingereichte Schreibvorgänge werden dadurch nicht rückwirkend zurückgerollt.
Der passende normale Turn und eine explizite Bildanfrage bleiben möglich.
Eine gültige Bildantwort darf normale Erinnerungen nachschlagen, ohne dadurch
eine Berechtigung für Companion-Aktionen zu erhalten. Nach dem Unterbrechen
werden Wiedergabebesitz und alter Antworttext freigegeben; eine später fertig
werdende Suche darf die alte Antwort nicht erneut starten.

Die explizit angeforderte Ersatzantwort kann über eigene `response.metadata`
zugeordnet werden. Die aktuelle offizielle Realtime-Referenz sieht Metadaten
zur Unterscheidung von Antworten vor. Sie beschreibt außerdem `response.done`
auch für abgebrochene und fehlgeschlagene Antworten; eine Abschlussmeldung
allein ist deshalb kein erfolgreicher Antwortabschluss.
[Client-Ereignisse](https://developers.openai.com/api/reference/resources/realtime/client-events),
[Server-Ereignisse](https://developers.openai.com/api/reference/resources/realtime/server-events).

Damit bleiben fachliche Auswahl und Fakten beim Companion, die Gesprächsregeln
bei Engine/Runtime und die Realtime-Ereignisreihenfolge bei den beiden Adaptern.
Neue Bild-, Motor- oder Netzberechtigungen sind nicht Teil dieser Änderung.

## Prüfstand

| Prüfung | Beobachtetes Ergebnis |
|---|---|
| `scripts/shared-episode-recall.test.mjs` | PASS: vollständige Details und Herkunft, unabhängige Rückgabekopie, unveränderte kurze Vorschau, alle erfolgreichen Ritual-/Pausezustände, keine Fakten bei unklarer oder falscher Zuordnung; tatsächlicher Engine-Pfad |
| `scripts/behavior-companion-voice.test.mjs` | PASS: eine echte Companion-Rückgabe wird über PCM und WebRTC vollständig als Werkzeugergebnis weitergereicht; genau eine Folgeantwort |
| `scripts/behavior-policy.test.mjs` | PASS: direkte Korrekturmarker mit No/Nein/Нет/Ні sowie Abgrenzung gegen gewöhnliche verneinte Sätze, Zitate, berichtete Rede und andere Fragen |
| `scripts/realtime-reference-repair.test.mjs` | PASS: tatsächliche Runtime, Engine, Event-Schnittstelle, Realtime-Konfiguration und beide Transports; frühe Antwort vor Transkript, Kontext-/Abbruch-/Antwortreihenfolge, markierte Ersatzantwort, alte und wartende Werkzeugaufrufe, verspätete Ausgabeereignisse, doppelte Transkripte, verzögerte Speicherung und Suche, normaler Folgeturn, explizite Bildanfrage mit normalem Memory-Tool sowie frischer Text und freigegebene Wiedergabe nach WebRTC-Unterbrechung |
| `pnpm run companion:continuity-test` | PASS, abschließend auch über `ios:check` ausgeführt; verbindet Abruf-, Reparatur- und Sprachpfadprüfungen |
| `pnpm run ios:check` | PASS auf dem abschließenden Stand, einschließlich TypeScript, Sitzungswechsel, BLE, Lifecycle, Verhaltens-/Sprachpfaden, Ritualen, Tätigkeiten und Objektaufmerksamkeit |
| Offline `expo export --platform ios` | PASS auf dem abschließenden Stand; iOS-Hermes-Bundle in `output/companion-continuity-ios-export` |
| `git diff --check` | PASS |

Die externen Dienste sind in diesen Tests simuliert. Kamera, Mikrofon, Datenbank
und Roboter werden dabei nicht am tatsächlichen Gerät bedient. Die Bildprobe
prüft den lokalen Antwortpfad, keine tatsächliche Bilderkennung. Ein echter
Sprachmodelllauf und die Latenz bzw. der Verbrauch des Ersetzens einer bereits
begonnenen Antwort wurden in dieser Runde nicht gemessen.

Die Integration zeigte außerdem einen veralteten Test-Doppelgänger im
Sitzungswechseltest: Er stellte die inzwischen benötigte
`getBehaviorInteractionRevision`-Funktion nicht bereit. Der explizit ohne
Behavior-Sitzung laufende Test liefert dort nun wie die reale Schnittstelle
`null`. Die bestehenden Prüfungen gegen fremde Sitzungsabschlüsse bleiben
erhalten und bestehen; die neuen Turn-Prüfungen nutzen die echte
Event-Schnittstelle.

Eine Protokollgrenze bleibt: Beginnt später ein gewöhnlicher automatischer
VAD-Turn, kann eine bislang unbekannte, unmarkierte alte `response.created`
nicht allein aus dieser Meldung sicher von dessen neuer Antwort unterschieden
werden. Das Korrekturfenster nutzt eigene Kennungen; bekannte verworfene
Antworten bleiben in einer begrenzten Sperrmenge. Daraus wird keine umfassende
Garantie für beliebig verspätete, unbekannte Antworten in allen späteren Turns
abgeleitet.

## Offene echte Abnahme

Am 26. Oktober meldete `xcrun devicectl list devices` das physische iPhone als
nicht erreichbar. Die vorhandenen Geräteprotokolle belegen frühere Mock-Läufe,
keine aktuelle Sprach- oder Hardwareabnahme dieser Änderungen. Eine Rückfrage
zur verfügbaren Prüfumgebung ist offen.

Im echten Gespräch sind ein konkretes Detail am Ende einer bestätigten
Erinnerung, eine direkte Referenzkorrektur während einer frühen Antwort und
anschließendes normales Weiterreden zu prüfen. Dazu gehören Latenz, doppelte
oder verspätete Sprache, Verständlichkeit und der Eindruck der Person. Eine
natürliche Beschreibung wie „unsere Rakete“ bleibt zunächst ein Suchkandidat;
dieser Ausbau macht daraus keine nachgewiesene Objekt- oder Personenidentität.
