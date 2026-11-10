# Fähigkeiten-Manifest: Die KI kennt LOOIs Körper (2026-11-10)

## Problem

Die Realtime-KI antwortete wie ein allgemeiner Sprachassistent. „Trink mal einen Kaffee" löste keine Animation aus und die Antwort passte nicht zum Roboter. Ursache: Szenen und Bewegungen wurden ausschließlich von lokalen Regex-Parsern ausgelöst (`parseCharacterActionRequest`, `parseExplicitRobotCommand`). Die KI hatte kein Werkzeug, kannte den Szenenkatalog nicht und erfuhr nicht, ob etwas ausgelöst wurde. Der Prompt verbot ihr ausdrücklich, selbst eine Szene zu starten.

## Entscheidung

| Frage | Entscheidung |
|---|---|
| Wer wählt Display-Szenen? | Die KI per Tool `play_scene`; die lokale Regex bleibt als schneller Fallback (auch ohne Tools/offline). |
| Darf die KI Bewegungen auslösen? | Ja, inklusive Fahren – über `perform_gesture`, `move_robot`, `stop_robot`. |
| Umfang | Realtime (PCM + WebRTC) und Budget-Modus in einem Zug. |

Damit ist die frühere Regel „Realtime erhält kein Bewegungs-Tool" aufgehoben. Die Sicherheitsgrenzen gelten in anderer Form weiter (siehe unten).

## Architektur

Eine Quelle, zwei Dateien:

- `src/voice/robot-capability-tool-definitions.ts` – das Manifest. Erzeugt den Prompt-Abschnitt (`buildRobotCapabilityInstructions`) und die Tool-Definitionen (`ROBOT_CAPABILITY_TOOLS`, strikte Variante für die Responses API). Der Szenenkatalog (200 IDs mit Label) wird aus `character-scene-catalog` generiert, eine neue Szene ist also automatisch für die KI wählbar.
- `src/voice/robot-capability-tools.ts` – der gemeinsame Ausführer (`robotCapabilityToolBridge`) für beide Realtime-Transporte und den Budget-Modus.

Eine neue Fähigkeit wird im Manifest beschrieben und im Ausführer angebunden; Prompts und Tool-Listen aller Modi folgen daraus.

### Ablauf „Trink mal einen Kaffee"

1. Transkript kommt an. Die lokale Regex trifft nicht (wegen „mal").
2. Die KI ruft `play_scene {scene: "coffee"}` auf.
3. Der Ausführer reiht die Szene ein und meldet `scene_queued` (oder `unavailable`, wenn das Display sie gerade nicht zeigen kann).
4. Die KI antwortet kurz in der Rolle; die Animation startet, sobald sie fertig gesprochen hat.

## Sicherheitsgrenzen für Bewegung

- Nur die bestehenden begrenzten Primitive: `moveLooi` (kurzer Schritt), `turnLooi` (90°/180°), `performLooiHeadGesture`, `performLooiDance`. Kein `startLooiMotion`, keine Parameter für Dauer, Tempo oder Strecke.
- Jeder Aufruf ist an den aktuellen, bestätigten Nutzer-Turn gebunden; veraltete Aufrufe werden verworfen.
- Höchstens drei Bewegungen pro Turn, nacheinander ausgeführt.
- STOP gewinnt: Ein Stoppwort im Turn oder ein `stop_robot`-Aufruf sperrt weitere Bewegung in diesem Turn. Der lokale Not-Stopp auf dem Transkript bleibt unverändert davor geschaltet.
- Cliff-, Kanten- und Verbindungs-Sperren in `looi-robot.ts` bleiben wirksam; ein abgebrochener Schritt wird der KI als `blocked` gemeldet, nicht als Erfolg.
- Budget-Modus: Räder bleiben geparkt (`requires_realtime`), weil das Mikrofon beim Sprechen freigegeben ist. Szenen, Nicken und Stopp funktionieren.
- Schlafmodus und „Schau her" (Kamera) bleiben ausschließlich beim lokalen Befehlspfad.

## Szene und Folgeantwort

Eine von der KI gewählte Szene (`source: "assistant"`) wartet auf das Ende der Antwort. Spricht die KI nach dem Tool-Ergebnis noch weiter, während die Szene schon begonnen hat, wird die Szene einmal zurückgestellt und startet nach dem Ende dieser Antwort neu. Spricht der Mensch dazwischen, wird sie endgültig verworfen.

## Geprüft und offen

Ohne Modell, Netz und Hardware geprüft:

- Tool-Aufruf über beide Realtime-Transporte bis zum Ausführer, inklusive Verwerfen veralteter Aufrufe (`behavior-companion-voice`).
- Ausführer gegen echten Controller, SDK und Mock-Roboter: Nicken, Schritt, Drehungen, STOP mitten im Tanz, Kantenblockade, geparkte Räder im Budget-Modus (`robot-capability-mock-integration`).

Nur am echten Gerät prüfbar:

- Wie zuverlässig das Realtime-Modell die Tools in echten Gesprächen aufruft und wie oft es von sich aus Szenen wählt.
- Fahren per freier Formulierung auf dem Tisch mit echter Kantenerkennung.
- Kosten und Latenz durch den Szenenkatalog in der Tool-Beschreibung (grob 1.500 Tokens, geschätzt).

## Tests

`pnpm run robot:capability-test` (Manifest, Ausführer, Mock-Integration), dazu angepasst: `character-actions`, `behavior-companion-voice`, `realtime-mode-behavior`, `budget-text-client`, `companion-live-runtime`, `v2.1.111-realtime-physical-command-routing-regression`.
