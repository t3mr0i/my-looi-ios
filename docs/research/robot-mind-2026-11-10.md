# Robot Mind: ein Roboter statt Sprachmodell mit Roboter dahinter (2026-11-10)

Baut auf `capability-manifest-2026-11-10.md` auf. Dort bekam die KI Hände (Szenen, Bewegung). Hier bekommt sie Sinne, eigenen Antrieb und einen Ausdruck, der zum Gesagten passt.

## Ausgangslage

1. Die KI spürte den Körper nicht: Gesichter, Streicheln, Tischkante, Verbindung kamen nie im Gesprächskontext an.
2. Sie sprach nie von sich aus.
3. Umgebungsbewegung, Gesichtsaufmerksamkeit, Decisions-Gesten und Sprachmodell entschieden nebeneinander.
4. Ohne Gespräch gab es nur Zufallsbewegung und Einschlafen.

## Die gemeinsame Mitte: Körperzustand

`src/robot-mind/body-state.ts` hält ein kleines Bild davon, was LOOI gerade wahrnimmt und tut, plus Ereignisse (`person_appeared`, `petted`, `edge_reached`, `search_gave_up`, `arrived_at_person` …). Sensoren und Steuerungen schreiben, alle anderen lesen.

| Teil | Dateien (`src/robot-mind/`) | Schreibt | Liest |
|---|---|---|---|
| Körpergefühl | `body-sensors*`, `body-context*` | Verbindung, Untergrund, Personen, Berührung, Schlaf, Gespräch | – |
| Proaktive Sprache | `proactive-speech-*`, `proactive-idle-speech` | – | Ereignisse, Zustand |
| Leerlauf-Autonomie | `idle-autonomy*` | Leerlauf-Modi, `search_gave_up`, `arrived_at_person` | Personen, Untergrund |
| Ausdruck | `expression*` | `expression` | Gesprächsverlauf |

## Körpergefühl

- Quellen: `looi-robot` (Verbindung, Bewegung, Kanten), `social-attention` (Gesichter), Streichel-Pfad, Schlaf, Gesprächszustand, aktive Szene.
- Geglättet: „erschienen" nach 0,5 s, „weg" nach 8 s Abwesenheit bei laufender Kamera; Kamera-Pausen zählen nicht als Weggehen.
- An Realtime geht ein kurzer Textblock als **eine ersetzbare Systemnotiz** (`conversation.item.create`, vorherige wird gelöscht), höchstens alle 5 s, nie während einer Antwort. Kein `session.update`, damit der lange Prompt im Cache bleibt. Eine Notiz allein löst kein Sprechen aus.
- Budget-Modus bekommt denselben Block als Datenkontext.
- Grenzen: kein Abstandssensor (nah/fern nur aus der Gesichtsgröße, unkalibriert), „hochgehoben" wird nicht gemeldet.

## Proaktive Sprache

- Einstellung `proactiveSpeech`: aus / Reaktionen (Standard) / lebhaft.
- Anlässe: Begrüßung (einmal pro Besuch), Willkommen zurück nach 45 min, Streicheln, Kantenwarnung; auf „lebhaft" zusätzlich Suche aufgegeben und angekommen.
- Bremsen: 2 min Mindestabstand, 4 pro Stunde (8 auf „lebhaft"), 20 min Ruhe nach „sei still", Schweigen bei Gespräch, Spiel, Schlaf, fahrenden Rädern.
- Im laufenden Realtime-Gespräch: `response.create` mit Anlassbeschreibung, ohne Tools.
- Ohne Gespräch: ein Textaufruf (Budget-Modell) plus ein TTS-Aufruf. Eine bezahlte Realtime-Session öffnet sich von selbst nur auf „lebhaft".

## Leerlauf-Autonomie

- Einstellung `idleAutonomyLevel`: aus / umschauen (Standard) / erkunden.
- Ablauf: ruhen → umschauen → Person suchen (max. 4 Drehungen, 40 s) → zuwenden → annähern (max. 3 Schritte, nur „erkunden" und erst, wenn der Besitzer in den Einstellungen bestätigt hat, dass der Roboter bei Verbindungsabbruch von selbst hält; siehe `robot-mind-device-check-2026-11-10.md`).
- Mehr Ruhe als Bewegung; ab 5 min ruhiger, ab 10 min nichts mehr, damit der Auto-Schlaf greift.
- Sicherheit:
  - Vor jeder Radbewegung muss Mikrofon-Audio fließen und der lokale STOP-Decoder scharf sein; sonst stehen die Räder.
  - Untergrund wird direkt aus der Bewegungsschicht gelesen: alle vier Kantensensoren stabil und irgendein Sensorrahmen höchstens 6 s alt; für Schritte zusätzlich ein `FED9 0E`-Wert, den die App als „frei" liest. Ob `0E` überhaupt ein Abstand ist, ist nicht belegt; der Wert kann Schritte nur verhindern, nie erlauben.
  - Kante: 2 min keine Räder, 15 min kein Vorwärtsfahren.
  - STOP während eigener Bewegung sperrt die Autonomie, bis die Einstellung geändert wird oder LOOI geschlafen hat.
  - Berührung, Sprache, Gespräch, Hintergrund, Schlaf brechen eine laufende Bewegung ab.
  - Budgets: 4 Radaktionen pro Minute, 16 pro 10 min, 6 Vorwärtsschritte pro 10 min.
- Die Kamera sucht im Leerlauf nach Gesichtern, wenn Kamera-Aufmerksamkeit eingeschaltet ist; sie löst dabei selbst keine Bewegung aus.

## Ausdruck

- Neues Tool `express` mit neun Absichten (neutral, happy, playful, agreeing, curious, thinking, surprised, sad, calm). Jede legt ein Gesicht und höchstens eine Kopfgeste fest; ernst und traurig bleiben ruhig.
- Realtime: Das Modell ruft `express` im selben Response wie die Sprache auf; es wird ohne Folgeanfrage quittiert, also keine Verzögerung. Nur ein Response ganz ohne Sprache bekommt eine gesprochene Folgeantwort.
- Budget: ein Tag am Antwortanfang (`[happy]`), wird entfernt und angewendet; kein Tool-Durchlauf.
- Ein Besitzer pro Antwort: Hat das Modell gewählt, ersetzt das die Text-Schätzung und sperrt die Decisions-Geste für diese Antwort. Hat es nicht gewählt, gilt das bisherige Verhalten.

## Lokal statt KI (Kosten)

Leitlinie: Wo der Anlass lokal bekannt ist, braucht es keine Modellanfrage. Vorbild ist die Reachy-Mini-Conversation-App: aufgezeichnete Clips statt generierter Bewegung, Kopfbewegung beim Sprechen aus dem Audiosignal, die KI wählt nur Namen.

| Verhalten | KI-Anfragen |
|---|---|
| Umschauen, Suchen, Zuwenden, Annähern, Sensorik, Gesichtserkennung | keine |
| Reaktions-Clips (`reaction-clips*`): aufhorchen, erschrecken, seufzen, freuen, strecken | keine |
| Mund und Kopf folgen der Lautstärke der eigenen Sprache (`speech-level`, `speech-wobble-runtime`) | keine |
| Eigene Äußerung, Stufe „Reaktionen" (`proactive-phrases`, `speech-clip-cache*`) | keine nach dem ersten Mal: fester Satz, Sprachausgabe einmal erzeugt und auf dem Gerät gespeichert |
| Eigene Äußerung, Stufe „lebhaft" | 1 Textaufruf + 1 TTS je Äußerung (frische Formulierung, nicht gespeichert) |
| Eigene Äußerung in laufender Realtime-Session | 1 Antwort der ohnehin offenen Session |
| Decisions-Schicht | 1 Anfrage je Nutzer-Turn; die zweite nach der Antwort entfällt, wenn die Antwort schon ihren eigenen Ausdruck hatte (Ritual, Spiel, Reparatur oder pausierte Aufgabe ausgenommen) |

Einzelheiten:

- Feste Sätze: je Anlass 3–5 Varianten in de/en/uk/ru, nie zweimal derselbe hintereinander. Russisch und Ukrainisch ohne Vergangenheitsformen in der Ich-Form, damit sie zu beiden Sprechgeschlechtern passen.
- Clip-Speicher: Schlüssel aus Modell, Stimme, Stilanweisung, Tempo und Text; höchstens 160 Clips bzw. 24 MB, die am längsten ungenutzten weichen. Ein gespeicherter Satz spielt auch ohne Netz und ohne API-Schlüssel. Feste Sätze werden im neutralen Stimmstil gesprochen, damit der Clip wiedergefunden wird.
- Sprachpegel: Aus dem Audio, das zur Wiedergabe eingereiht wird (Realtime-PCM, Budget-Stream, WAV), entsteht eine Lautstärkekurve auf einer Zeitachse. Der Mund öffnet sich danach; am Beginn einer Phrase gibt es höchstens alle 2,8 s und fünfmal pro Antwort eine kleine Kopfbewegung, bei traurigem oder ruhigem Ausdruck keine. Der WebRTC-Transport liefert kein Audio an die App; dort bleibt der gleichmäßige Mundpuls.
- Reaktions-Clips: Gesicht plus höchstens eine Kopfgeste, nie Räder; an der Kante nur das Gesicht. 30 s Abklingzeit je Clip. Streicheln hat bereits seine eigene Reaktion.

Noch nicht gebaut: eine gemeinsame Bewegungsschleife mit Atmen als Grundschicht, Warteschlange für Clips und additiven Schichten (Reachys `MovementManager`). Heute stimmen sich die Steuerungen über Halte-Aufrufe und Prioritäten ab.

## Zusammenspiel geprüft

`scripts/robot-mind-integration.test.mjs` führt die echten Module aller vier Teile durch eine Situation: allein → Suche → Person erscheint rechts → eine Begrüßung → Zuwenden zur gemeldeten Seite → begrenzte Annäherung → Ankunft → Streicheln → Kante → Gespräch → Schlaf.

Bei der Zusammenführung angepasst: Die Sensoren aktualisieren „zuletzt gesehen" jetzt jede Sekunde statt alle zwei, weil die Autonomie eine Sichtung nach 2 s als veraltet behandelt.

## Nur am Gerät prüfbar

- Ob das Realtime-Modell die Systemnotiz mit eigener ID annimmt, `express` zusammen mit Sprache sendet und bei proaktiven Anlässen bei einer kurzen Zeile bleibt.
- Ob der STOP-Decoder während einer 200–400 ms kurzen Drehung reagiert und das Vosk-Modell auf iOS lädt.
- Ob der Roboter Sensorrahmen auch im Stillstand sendet. Community-Mitschnitte beschreiben Rahmen nur bei Änderung; dann bewegt die Autonomie die Räder fast nie (Dauerlauf: 3 Radaktionen in 1.200 virtuellen Minuten).
- Ob „links" die linke Seite des Roboters ist (gleiche Konvention wie die bestehende Gesichtsverfolgung).
- Audiowiedergabe im Leerlauf neben dem Weckwort-Mikrofon.
- Schwellen: Gesichtsgröße für nah/fern, Lautstärke für den Abbruch zwischen Schritten, Dreh- und Schrittdauern.

## Tests

`pnpm run robot:mind-test` (enthält `robot-mind-local-speech`, `robot-mind-speech-level`, `robot-mind-reaction-clips`)
