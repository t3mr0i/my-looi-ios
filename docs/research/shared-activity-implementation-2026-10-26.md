# Gemeinsame Tätigkeit: bestätigte Schritte eines Objektversuchs

Stand: 26. Oktober 2026. Zweiter Baustein der
[2030-Phase](lebendigkeit-phase-2-2030-2026-10-26.md), nach der lokalen
Objektauswahl und ihrer [Verbesserung](object-attention-refinement-2026-10-26.md).

## Ziel und Entscheidung

LOOI soll bei einem ausdrücklich begonnenen gemeinsamen Versuch sagen können,
welcher Schritt bestätigt ist und worauf er wartet. Im bisherigen Quellstand
endete der visuelle Ritualzustand nach dem angenommenen Startzeichen. Er konnte
keine Prüfung, Vorbereitung oder bestätigtes Versuchsergebnis festhalten.
`PendingIntention` kannte bereits Pause, Wiederaufnahme und einen letzten
bestätigten Schritt, aber keinen geordneten Verlauf.

Der Ausbau verwendet deshalb **einen bestehenden Aufgabenstand** mit einem
optionalen `activity`-Teil. Die alternative Erweiterung von `CompanionScene`
zu einer zweiten langlebigen Aufgabe wurde verworfen: Die Scene besitzt eine
kurze Kamera-/Startfreigabe, während der Aufgabenstand den Fortschritt hält.
Ein freier, vom Sprachmodell erzeugter Ablaufplan wurde ebenfalls nicht
eingebaut. Der erste Versuch hat bewusst nur Prüfen, Vorbereiten, Startzeichen
und Ergebnis.

`shared-activity.ts` besitzt die Regeln hinter einer reinen Schnittstelle.
Der Behavior-Engine hält den Zustand; WebRTC und PCM verwenden denselben
Companion-Action-Aufruf. Die Schnittstelle prüft die aktuelle Episode,
Phasenreihenfolge, genaues Nutzerzitat, ausgesprochene Rückfrage und spätere
Bestätigung. Sie besitzt weder Kamera noch Timer, Motoradapter oder eigenen
Speicher. Dadurch liegen die Regeln an einer Stelle; die beiden Sprachpfade
kennen nur die Werkzeugargumente und die lokale Rückgabe.

## Bedienung und tatsächliche Bedeutung

Voraussetzung ist eine bereits bestätigte gemeinsame Episode, zum Beispiel
„Gerda“, und aktives Companion-Verhalten in einer Realtime-Unterhaltung.
Beispielhafte Nutzeräußerungen sind:

1. „Lass uns den Versuch mit Gerda vorbereiten.“ LOOI fragt, ob die gemeinsame
   Tätigkeit beginnen soll. Erst ein klares Ja nach dieser Rückfrage aktiviert
   die Aufgabe.
2. „Ich habe Gerda geprüft; der Fuß steht stabil.“ LOOI schlägt die kurze
   wörtliche Aussage als Prüfschritt vor und übernimmt sie nach Bestätigung.
3. „Gerda ist vorbereitet; die Fläche ist frei.“ Die gleiche Bestätigung gilt
   für das Bereitstellen. Erst danach wartet die Aufgabe auf das Startzeichen.
4. Der bestehende bestätigte visuelle Vergleich und die ausdrückliche Wahl
   eines Sprach- oder Handzeichens bereiten wie bisher das einmalige Ritual vor.
   Die Aufgabe umgeht weder dessen Frist noch dessen Kamera- und Fokusgrenzen.
5. Nach dem angenommenen Zeichen wartet LOOI auf den Bericht. „Gerda ist
   umgekippt“ darf ebenso als Ergebnis vorgeschlagen werden wie ein Erfolg.
   Erst die gehörte Ergebnisrückfrage und die folgende Bestätigung schließen
   den Versuch ab.

Dies sind Bedienbeispiele für die Werkzeug- und Zustandsintegration, keine
bereits gemessenen Erkennungsraten eines Sprachmodells. Der Countdown und die
Phase `awaiting_result` belegen nur das angenommene Startzeichen. Sie belegen
weder eine Bewegung von Gerda noch einen tatsächlichen Start oder Erfolg.

## Bestätigung, Unterbrechung und Speicherung

Eine Modellaktion legt zunächst nur einen Vorschlag mit genauer Rückfrage an.
Ein Schritt- oder Ergebnistext muss wörtlich im angegebenen Nutzerzitat stehen;
eine ausgeschmückte oder nur paraphrasierte Modellbehauptung wird abgewiesen.
Der gehörte Assistententranskript muss genau diese Frage einmal enthalten.
Nur die unmittelbar folgende eindeutige Bestätigung in derselben Sitzung
übernimmt den Schritt. Eine andere Antwort, eine fremde Sitzung, eine nicht
gehörte Frage oder die Frist von zwei Minuten verwerfen den Vorschlag. Die
Fragevorlagen und Bestätigungen unterstützen Deutsch, Englisch, Ukrainisch
und Russisch.

Pause, STOP, Verlassen der Ansicht, Hintergrund, Schlaf und die bestehenden
Unterbrechungsgrenzen räumen offene Vorschläge und Startfreigaben ab. Bestätigte
Schritte bleiben im pausierten Aufgabenstand. „Weiter“ allein aktiviert die
Tätigkeit nicht: Es braucht die benannte Episode, einen Wiederaufnahmevorschlag
und die bestätigte Rückfrage. Ein Versuch ohne bestätigtes Ergebnis benötigt
nach einer Unterbrechung ein neues Startzeichen; ein altes Zeichen wird nicht
wiederhergestellt.

Der bisherige lokale Aufgabenstand hat eine Ablaufgrenze von einem Tag.
Gespeichert werden nur bestätigte Textschritte und ihre Herkunft. Offene
Fragen und Startfreigaben werden nicht persistiert. Nach Wiederherstellung
bleibt die Aufgabe pausiert. Das Vergessen der gebundenen Episode entfernt
auch ihren Tätigkeitsstand. Ein bestätigtes Ergebnis wird nicht automatisch
zu einer neuen dauerhaften Episode; dafür bleibt die vorhandene gesonderte
Erfahrungsbestätigung zuständig.

## Prüfnachweise und Grenzen

| Prüfung | Beobachtetes Ergebnis |
|---|---|
| `shared-activity.test.mjs` | PASS: Reihenfolge, gehörte/ungehörte Fragen, nächster Turn, Sitzung, Ablauf, vier Sprachen, unveränderte Zitatdetails und Wiederherstellung |
| `shared-activity-engine.test.mjs` | PASS mit echtem Behavior-Engine: bestätigte Episode → Tätigkeit → Prüfung → Vorbereitung → bestehender visueller Vergleich/Sprachstart → bestätigtes Ergebnis; Pause, Neustart, Wiederaufnahme und Vergessen |
| Ereignis ohne neue Nutzereingabe | PASS: Nach 120 Sekunden verwirft `tick()` eine unbeantwortete Schrittfrage, pausiert den Task und benachrichtigt den Listener mit dem neuen Zustand |
| `behavior-companion-voice.test.mjs` | PASS: WebRTC und PCM reichen gültige Werkzeuge weiter und verwerfen fremde Evidenz oder veraltete Antworten |
| `behavior-shared-scene.test.mjs` | PASS mit echtem Runtime-/Engine-Pfad: vorhandenes Voice-/Palm-Ritual; eine offene Tätigkeitsfrage schaltet auf Antworten nach bestätigtem Transkript und danach zurück |
| `corepack pnpm run ios:check` | PASS einschließlich bestehender Lifecycle-/Memory-/BLE-/Behavior-/Budget- und Objektaufmerksamkeitsprüfungen |
| Abschließende TypeScript-Prüfung und `git diff --check` | PASS |
| Offline-iOS-Export | PASS, Hermes-Bundle mit Tätigkeitslogik und beiden Sprachpfaden erstellt |

Die unabhängige Durchsicht fand zwei korrigierte Integrationslücken. Eine
allgemeine `offer_resume`-Entscheidung konnte den pausierten Tätigkeitsstand auf
`needs_clarification` setzen und damit die ausdrücklich benannte Wiederaufnahme
blockieren. Diese allgemeine Entscheidung darf den Tätigkeitsstand jetzt nicht
ändern; der Test erzwingt genau diese Entscheidung und prüft die anschließende
Wiederaufnahme. Außerdem konnte der Modelltext einen Ergebnisbericht
ausschmücken. Die Prüfung verlangt jetzt einen wörtlichen Ausschnitt aus der
aktuellen Evidenz; der Regressionstest weist das ausgeschmückte Ergebnis ohne
neue Bestätigungsfrage zurück. Die Restore-Prüfung übernimmt nur eine zeitlich
zusammenhängende Folge bestätigter Schritte.

Die lokalen Tests verwenden injizierte Uhr, Antwortdaten und Ausgabeschnittstellen.
Es wurden keine bezahlten Modellanfragen, Kameraaktivierungen oder physischen
Roboteraktionen ausgeführt. Der iOS-Export ist ein Bundle-Nachweis; für diese
reine TypeScript-Änderung wurde keine App auf einem iPhone installiert.

Eine neue Bildschirmoberfläche wurde nicht gebaut. Die Gesprächsqualität,
Verständlichkeit der Rückfragen und reale Nutzung mit iPhone und Roboter sind
weiterhin zu prüfen. Dieser Ausbau misst keine Objektidentität und hängt für
einen visuellen Ritualstart weiterhin von der ausdrücklich erlaubten
Einzelbildprüfung ab.

Die geänderten Produktionspfade sind `src/behavior/shared-activity.ts`,
`behavior-engine.ts`, `behavior-types.ts`, `behavior-companion.ts` und
`behavior-runtime.ts` sowie die Werkzeugdefinition und beide Realtime-Transports
unter `src/voice/`. Der Aufgabenstand erhält ein optionales Feld; bestehende
gespeicherte Aufgaben ohne Tätigkeit bleiben lesbar. Tests, Script-Einträge,
Bedienanleitung und Phase-2-Bericht wurden entsprechend ergänzt.
