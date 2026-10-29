# Zusammenhängende Companion-Gespräche abnehmen

Stand: 26. Oktober 2026. Vorbereitung ohne API-Aufruf, iPhone oder Roboter.
Das unveränderte Gesamtziel verlangt weiterhin echte Modell-, Sprach-,
Geräte- und Nutzerbelege. Lokale Prüfungen ersetzen diese Abnahme nicht.

## Belegter Bedarf

Der vorhandene Modellprüflauf enthält sechs unabhängige Eingaben. Ein Fall
kann mehrere Werkzeugantworten beobachten, aber keine zweite Nutzeräußerung
nach der Modellantwort senden. Sein Fall „Korrektur“ prüft den Wechsel einer
Referenz von einer roten zu einer blauen Schachtel. Er prüft keine gespeicherte
Episodenberichtigung mit späterem Ja. Auch der neue offene Episodenüberblick
und die echte Spielpause sind dort bislang nicht vertreten.

Damit können die lokalen Zustandsprüfungen dieser Funktionen bereits grün
sein, ohne dass der spätere reale Modellprüflauf ihre vollständigen
Gesprächsübergänge prüfen würde. Die bisherige Abnahmevorbereitung ist für
diese konkreten neu implementierten Abläufe unvollständig.

## Gewählter Prüflauf

Eine zusätzliche auswählbare Suite `continuity` ergänzt drei Fälle:

1. Offen nach gemeinsamen Erlebnissen fragen: Das Modell soll den lesenden
   Überblick verwenden und aus den bestätigten gespeicherten Fakten erzählen.
2. Gerda berichtigen, die genaue Rückfrage bestätigen und erneut nach Gerda
   fragen: Der alte Fakt muss vor dem Ja erhalten bleiben, danach muss der
   aktuelle Fakt samt eigener Korrekturquelle abrufbar sein.
3. Ein Spiel pausieren, während der Pause eine Zahl sagen und zurückkehren:
   Die Runde bleibt unterbrochen und verbraucht keinen Versuch, bis die
   ausdrückliche Rückkehr dieselbe Runde fortsetzt.

Die sechs bisherigen Fälle bleiben als Standard `baseline` erhalten. Einfach
weitere Fälle anzuhängen wäre falsch, weil der bisherige Runner nach sechs
Fällen abschneidet. Die Such- und Referenzfälle zu ersetzen würde bisherige
Abnahme verlieren. Eine ausdrücklich ausgewählte Suite hält den Umfang pro
Aufruf sichtbar und die bisherigen Grenzen unverändert.

## Schnittstelle und Ablauf

Ein Fall kann optional `turns` mit bis zu drei Eingaben besitzen. Alte Fälle
mit `userText` behalten ihren bisherigen Ablauf. Alle Turns eines Falls
verwenden dieselbe reale lokale Engine, Runtime und denselben PCM-Router.
Der jeweilige fertige Antworttext bleibt im Dialog; der Runner fügt danach
keine vorgegebene Assistant-Antwort als Ersatz für das Modellergebnis ein.

Für jeden Turn werden Antworten, Werkzeugaufrufe, Werkzeugergebnisse und
Zustand gesondert erfasst und mechanisch geprüft. Erst nach erfolgreicher
Prüfung darf der nächste vorgegebene Nutzerturn folgen. Insbesondere darf ein
synthetisches Ja nur auf den richtigen offenen Korrekturvorschlag nach seiner
genau abgeschlossenen Rückfrage folgen. Eine falsche oder fehlende Frage darf
nicht durch ein blindes Ja übergangen werden.

Die Zustandsprojektion enthält die begrenzten Episodenfakten und Quellen,
den offenen Bestätigungstyp und den sichtbaren Spielstand. Die Geheimzahl
bleibt ausgeschlossen. Diese Projektion erweitert den Prüfbericht, nicht den
Produktkontext oder die Modellbefugnisse.

Es gelten weiterhin höchstens sechs Fälle, 24 gesendete Antwortanforderungen und 24
empfangene Antwortstarts, zwölf finale Textantworten, vier Werkzeugaufrufe pro
Turn, 45 Sekunden pro Turn und 240 Sekunden insgesamt. Es gibt keinen Retry,
keinen Modellwechsel und keine automatische zweite Suite im selben Aufruf.
Unpassende Fallkonfigurationen werden vor dem Socket-Aufbau abgewiesen.

Der Runner besitzt Sequenzierung, Grenzen und Berichte. Die Suite-Datei
beschreibt Eingaben, synthetischen Ausgangszustand und Abnahmekriterien.
Die beiden Sprachadapter und die Produktwerkzeuge werden nicht nachgebaut
oder für diesen Prüflauf um zusätzliche Rechte erweitert.

## Aussagegrenze

Der spätere ausdrückliche Live-Aufruf würde echte Modellantworten im Textmodus
prüfen. Ein abgeschlossenes Modelltext-Ergebnis wird dabei weiterhin nur als
simulierter Textempfang an die lokale Engine gemeldet. Es ist kein Beleg,
dass eine Stimme ausgegeben oder eine Frage tatsächlich gehört wurde.

Die Entwicklung dieser Suite verwendet einen lokalen Fake-Socket mit
vorgegebenen Antworten. Dessen Ergebnis bestätigt den Prüfablauf und seine
Fehlergrenzen, nicht die Fähigkeiten oder die Natürlichkeit des Sprachmodells.
Auch ein mechanisch erfolgreicher echter Lauf verlangt menschliche Bewertung.

## Ausführen und beobachteter Abschluss

Die Vorschau verwendet weder Schlüssel noch Netzwerk:

```sh
pnpm run companion:live-eval --suite baseline
pnpm run companion:live-eval --suite continuity
pnpm run companion:offline-test
```

Erst der folgende getrennte Aufruf würde mit dem vorhandenen
`OPENAI_API_KEY` echte Modellanfragen starten. Er wurde hier nicht ausgeführt:

```sh
pnpm run companion:live-eval --suite continuity --live --output output/companion-live-eval/continuity-report.json
```

Beobachtete lokale Prüfungen auf dem abschließenden Arbeitsstand:

| Prüfung | Ergebnis |
|---|---|
| Beide CLI-Vorschauen | PASS: `networkUsed: false`; Baseline sechs einzelne Turns, Continuity drei Fälle mit 1/3/3 Turns; Grenzen unverändert |
| `pnpm run companion:offline-test` | PASS, einschließlich der bisherigen Companion-Verhaltensprüfungen und der vollständigen `companion:live-eval-test`-Folge |
| Neue Suite-/Setup-Prüfung | PASS: öffentliche lokale Bestätigungswege und voneinander unabhängige Suite-Instanzen |
| Neue Fake-Protokoll-Integration | PASS: tatsächliche Runtime, PCM-Router und Produktionskonfiguration; zehn gesendete Antwortanforderungen und sieben finale Texte im vorgegebenen positiven Trace |
| Falsche oder fehlende Korrekturfrage | Erwartetes mechanisches Scheitern; spätere Ja- und Abrufeingaben werden nicht gesendet |
| Grenz- und Fehlerprüfungen | PASS: ungültige Konfiguration vor dem Socket-Aufbau, per-Turn-Zuordnung, fehlgeschlagene/abgebrochene Antworten, verworfene verspätete Antworten, Timeout und bestehende Antwortgrenzen |

Während dieser Arbeit wurde im gemeinsamen Quellstand eine neue native
Assistant-ASR-Abhängigkeit ergänzt. Die lokalen Adapter bilden diese externe
Schnittstelle ausdrücklich ab und melden sie als nicht bereit; es wird keine
echte Erkennung vorgetäuscht. Die ebenfalls neu erreichbaren App- und
Hermes-Bridges sind im Textprüfstand abgewiesen. Ein Test über den tatsächlichen
PCM-Werkzeugrouter belegt deren fehlgeschlagene Rückgabe. Die Produktionswerkzeuge
und ihre sichtbaren Schemas bleiben erhalten, reale App-Starts und externe
Aufgaben werden von diesem Prüfstand nicht ausgeführt.

Die unabhängige enge Prüfung fand keine weitere konkrete falsche Pass-Bedingung
in den neuen Gesprächsfolgen. Sie bleibt eine Code-/Protokollprüfung. Es gibt
weiterhin keinen echten Modellbericht für diese neue Suite, keine neue
Sprach-/Geräteabnahme und keinen neuen nativen Build aus dieser Arbeitsrunde.

Geändert wurden der separate Runner, die neue Suite-Registry, die
Continuity-Falldatei und ihre Tests unter `scripts/companion-*`, die expliziten
externen Testadapter sowie die Prüfkommandos in `package.json`. Es wurden keine
Produktfunktionen oder Produktionsdateien für diese Abnahme umgeschrieben.
