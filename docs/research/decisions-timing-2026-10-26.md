# Decisions: Frist für Reaktionen nach der Sprachausgabe

Stand: 26. Oktober 2026. Begrenzte Verbesserung mit `better-function`.

## Befund und Ziel

Der einmalige [Live-Check](decisions-live-check-2026-10-26.md) lieferte auf dem
iPhone nach 1.480 ms eine gültige Antwort. Die Verhaltens-Engine ließ jedoch jede
nicht visuelle Entscheidung bereits nach 800 ms verfallen. Auch die vorhandene
Client-Einstellung `decisionTimeoutMs: 1800` konnte das nicht verlängern: Der
Request-Timer wurde zusätzlich durch diese kürzere Ereignisfrist begrenzt.
Damit kann eine gültige Reaktion nach einer gehörten Antwort verloren gehen.

Der entscheidende Engpass liegt vor der Gestenausführung, im gemeinsamen
Queue-/Request-/Gültigkeitspfad von `src/behavior/behavior-engine.ts`. Eine bloße
Änderung des Client-Timeouts würde ihn nicht beheben. Die tatsächliche
Produktionslatenz bleibt dennoch unbekannt: Der Live-Check hatte 512 Input-Token
und kein Candidate Scoring, während der Dialog mehr Kontext und standardmäßig
Scoring verwendet. Ein einzelner Aufruf ist kein Latenzbenchmark.

Der Ausgangsfehler wurde unabhängig vom Netz mit echter Engine, Policy und
Companion sowie kontrollierter Uhr reproduziert. Bei einer Antwort 1.480 ms nach
`assistant-end` war `metrics.completed` null statt eins; es entstand kein Cue.
Der gezielte Test scheiterte vor der Korrektur an dieser Assertion.

## Abgewogene Wege

| Weg | Nutzen und Grenze | Aufwand/Risiko und Nachweis |
|---|---|---|
| Alle Entscheidungen länger offen halten | Würde den gemessenen Aufruf zulassen, verlängert aber auch kurzlebige Eingabe- und Gesichtsauswahl. | Kleine Codeänderung, unnötig längere Gültigkeit anderer Ereignisse. Getrennte Ereignistests würden diese Ausweitung zeigen. |
| Entscheidung während der Sprachausgabe vorwegnehmen | Könnte die Reaktion früher liefern; die vollständig gehörte Antwort liegt dann noch nicht vor. | Neue Koordination, unter Umständen zusätzliche Anfragen und veralteter Kontext. Bräuchte eine eigene Produkt- und Laufzeitabnahme. |
| Nur die Reaktion nach hörbarem Antwortende bis zur vorhandenen 1.800-ms-Grenze zulassen | Behebt die belegte Fristkollision im betroffenen Ereignis. Eingaben und Gesichtsauswahl bleiben bei 800 ms. | Gewählt: ein begrenzter lokaler Eingriff, prüfbar mit virtueller Zeit und dem tatsächlichen Laufzeitadapter. Natürlichkeit und Abdeckung realer Latenzen bleiben zu messen. |

## Konkrete Umsetzung und Grenzen

`assistant-end` erhält höchstens `min(1800, decisionTimeoutMs)` Millisekunden ab
dem Ereignis; ohne explizite Einstellung gelten 1.800 ms. Ein größerer
Client-Timeout verlängert diese Reaktionsfrist nicht. Visuelle Entscheidungen
behalten ihre bisherige Grenze, alle anderen nicht visuellen Ereignisse ihre
800 ms. Die Sprachausgabe wird weder verzögert noch für Decisions angehalten.

Die Frist beginnt beim Einreihen. Wartezeit durch eine laufende Anfrage oder die
Request-Taktung zählt mit. Ein späterer Request-Start oder eine Antwort erneuert
die Frist nicht; auch `cue.expiresAt` bleibt die ursprüngliche absolute Frist.
Damit reicht ein rechtzeitiger Request-Start allein nicht für eine späte Geste.

Sitzung und Lifecycle-Generation sowie die vorhandenen Abbruchbedingungen
bleiben maßgeblich. Neue Sprache, neuer Turn, neue Assistentenausgabe, STOP,
Hintergrund, Schlaf, Trennung oder Deaktivierung dürfen keine alte Reaktion
ausführen. Bereits angefallene Provider-Usage bleibt auch bei einer verworfenen
Antwort einmalig erfasst. Gesten bleiben auf den bestehenden Controller mit
begrenzter Abschlussphase und Prüfung vor jedem weiteren Schritt beschränkt.
Es gibt keine neuen Anfrageauslöser oder automatischen Wiederholungen;
Einstellungen und Budgetgrenzen bleiben bestehen. Bisher zu früh verworfene
Ereignisse können jetzt ihre bestehende Anfrage oder Antwort noch nutzen.

## Abnahme

Die deterministischen Engine- und Laufzeittests prüfen eine erfolgreiche
1.480-ms-Reaktion, die weiterhin kurzen Eingabe-/Gesichtsfristen, die obere
Reaktionsgrenze und kleinere konfigurierte Timeouts. Weitere Fälle prüfen
Wartezeiten, Queue-Coalescing, Abbruch und genau einmal erfasste späte Usage.
Der Laufzeitadapter muss den passenden Kopfgesten-Mock erst nach einer gültigen
Antwort aufrufen und eine unterbrochene Antwort unterdrücken.

`scripts/behavior-decision-timing.test.mjs` besteht nach dem zuvor belegten roten
Baseline-Lauf. Die Unterbrechungen werden gezielt erst nach 900 ms ausgelöst,
also innerhalb des zusätzlich erlaubten Zeitraums, mit verspäteten Antworten
nach insgesamt 1.480 ms. Sitzungsende und Sitzungswechsel sind ebenfalls geprüft.

`scripts/behavior-runtime-timing.test.mjs` besteht mit echter Engine und echtem
Laufzeitadapter, ersetzten Stores und Kopfgesten-Mock. Er belegt unter anderem
eine Antwort nach 600 ms Queue-Wartezeit und 880 ms Request-Laufzeit, das Ende an
der ursprünglichen 1.800-ms-Frist sowie STOP vor der Antwort und während einer
bereits begonnenen Abschlussphase. Lokale Hör-/Denkzustände werden synchron
aktualisiert. Beide Tests laufen über `behavior:timing-test` auch in `test`,
`behavior:test` und `ios:check`.

Die eigenständige TypeScript-Prüfung besteht. Der unabhängige Code-Review fand
keine konkrete Regression im Frist-, Generation-, Queue- oder Laufzeitpfad.
Der vollständige Lauf von `pnpm run ios:check` besteht ebenfalls, einschließlich
der neuen Timing-Tests, der Realtime-/PCM-Integration, der Mock-Rehearsal sowie
der bestehenden Sprach-, Lifecycle-, Bewegungs- und Kamera-Tests.

Diese Änderung wurde lokal geprüft; sie wurde nicht als neues iPhone-Update
installiert und löste keinen weiteren echten API-Aufruf aus. Physische Bewegung
und menschlich bewertete Natürlichkeit sind weiterhin nicht belegt. Der echte
Roboter ist noch nicht verfügbar.
