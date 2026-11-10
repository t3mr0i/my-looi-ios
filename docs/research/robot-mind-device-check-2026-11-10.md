# Robot Mind: Belege statt Annahmen (2026-11-10)

Der Robot-Mind-Umbau (`robot-mind-2026-11-10.md`) hängt an Annahmen über das echte Gerät und die echte Realtime-API. Dieses Dokument hält fest, was davon inzwischen belegt ist, womit, und was nur du am Roboter klären kannst.

## Was die Rohquellen ergeben haben

### Reachy Mini, Quellcode statt README

Gelesen: `reachy_mini_conversation_app` (`idle_policy.py`, `moves.py`, `conversation_handler.py`) und `reachy_mini` (`motion/head_wobbler.py`, `motion/speech_tapper.py`).

- **Korrektur einer früheren Aussage:** Reachy fragt im Leerlauf *nicht* die KI. `idle_policy.py` wählt lokal per gewichtetem Zufall: 60 % nichts tun, 16 % Tanz, 16 % Emotion, 8 % Kopf bewegen. Das Werkzeug `idle_do_nothing` ist nur der Name der „nichts tun"-Wahl.
- **Leerlauf-Takt:** Reachy löst frühestens nach 180 s ohne Aktivität ein Leerlaufverhalten aus und dann höchstens alle 180 s (`IDLE_BEHAVIOR_THRESHOLD_S`). LOOI ruht 12–30 s zwischen Episoden, ist also deutlich unruhiger. Reachy hat dafür eine durchgehende Grundbewegung (Atmen mit 0,1 Hz, Antennen mit 0,5 Hz ab 0,3 s Inaktivität); bei LOOI übernehmen das Gesichtsatmen und die Umgebungsbewegung. Nicht geändert, weil das am Gerät beurteilt werden muss; die Werte stehen als Konstanten in `idle-autonomy.ts` (`REST_MS`).
- **Kopfbewegung beim Sprechen:** Reachys `HeadWobbler` plant jede Bewegung auf den Zeitpunkt, an dem der Ton *hörbar* ist (Puffer-Zeitstempel plus Latenz der Audioausgabe). Unsere erste Fassung nahm den Zeitpunkt des Einreihens. **Übernommen:** Die Zeitachse wird jetzt um die Ausgabelatenz verschoben, die das Audiomodul meldet (`outputLatencyMs + ioBufferDurationMs`).
- **Lautstärke-Kennlinie:** Aus `speech_tapper.py` übernommen statt geschätzt: Pause ab −45 dBFS, Phrasenbeginn ab −35 dBFS, Lautheit von −46 bis −18 dBFS mit +4 dB Empfindlichkeit und Gamma 0,9, Pause gilt nach 250 ms.

### Dieses Repo

- `src/device-tools/looi-robot.ts` hält aus echten Mitschnitten fest, dass FED9-Sensorrahmen gelegentlich etwa 5 s auseinanderliegen. Die Autonomie verlangt einen Rahmen, der höchstens 6 s alt ist. Das passt, aber knapp; der Selbsttest misst es an deinem Gerät.
- `docs/research/bestand-hardware.md` nennt die Bedeutung von `FED9 0E` (im Code ein Abstandswert in Millimetern) als ungeklärt. Die Autonomie fährt nur vorwärts, wenn dieser Wert „frei" meldet. Ist die Deutung falsch, wird Vorwärtsfahren zufällig erlaubt oder verweigert; die Kantensensoren schützen davon unabhängig.
- Das SDK sendet Fahrbefehle als Wiederholschleife alle 110 ms (`startMoveLoop`), und die App beendet eine Bewegung mit einem Stopp-Befehl.

## Was der Dauerlauf gezeigt hat

`scripts/idle-autonomy-soak.test.mjs`: 60 zufällige Abläufe zu je 40 virtuellen Minuten gegen den echten Controller, das SDK und den Mock-Roboter, mit rund 4.300 eingestreuten Störungen. Weil Bewegungen unter einer halben Sekunde dauern, wartet ein Teil der Störungen gezielt auf die nächste Radbewegung und schlägt mitten darin zu.

Ergebnis des letzten Laufs: 215 Radbewegungen (30 vorwärts), 25 Kantenstopps, 16 STOP während eigener Bewegung, 22 Gesprächsbeginne während einer Bewegung, 25 Verbindungsabbrüche während einer Bewegung, 466 Umsetzungen von Hand, 38 Verweigerungen ohne STOP-Decoder. **0 Verstöße** gegen diese Regeln:

- keine Radbewegung ohne scharfen STOP-Decoder und laufendes Mikrofon
- keine Radbewegung während Gespräch, Sprache, Hintergrund, Fahrsitzung, ohne Verbindung oder auf Stufe „aus"
- vorwärts nur auf „erkunden"; nie rückwärts
- Dauer- und Mengenbudgets, Mindestpause
- nach einem Kantenstopp 2 min keine Räder und 15 min kein Vorwärtsfahren, auch nach Umsetzen von Hand
- STOP hält sofort an und sperrt bis zur Änderung der Einstellung
- ein beginnendes Gespräch beendet eine laufende Bewegung binnen 150 ms
- jede Bewegung endet rechtzeitig mit einem Stopp-Befehl

Gegenprobe: Entfernt man die STOP-Decoder-Sperre oder die STOP-Verriegelung aus dem Code, meldet der Dauerlauf jeweils über hundert Verstöße. Entfernt man die Kantensperre der Autonomie, bleibt er grün, weil drei weitere Sicherungen dieselbe Lage abdecken (5 min Pause nach blockierter Bewegung, Annäherungs-Abklingzeit, Leerlauf-Ende nach 10 min); diese eine Sperre prüft der Szenariotest `idle-autonomy-mock-integration` direkt.

**Ein Fund:** Bricht die Bluetooth-Verbindung mitten in einer Bewegung ab, kann die App keinen Stopp mehr senden. Ob der Roboter dann von selbst anhält, ist im Code nicht belegt. Die Wiederholschleife des SDK spricht dafür, dass jeder Befehl nur kurz wirkt, bewiesen ist es nicht. Das betrifft jede Bewegung der App, nicht nur die Autonomie; die Autonomie fährt aber unbeaufsichtigt. Siehe Punkt 5 der Checkliste.

## Instrumente für dich

### 1. Selbsttest in der App (30 s, es bewegt sich nichts)

Einstellungen → Diagnose → „Roboter-Selbsttest (30 s)". Misst an deinem Gerät und schreibt ins Diagnoseprotokoll (`robot-mind-self-check`):

| Zeile | Was gemessen wird | Bedeutung bei ✗ |
|---|---|---|
| Basis | Verbindung und Fahrkanal | Roboter nicht verbunden |
| Sensortakt | Anzahl Sensorrahmen in 30 s und längste Lücke gegen die 6-s-Grenze | Autonomie bewegt die Räder selten oder nie |
| Untergrund | alle vier Kantensensoren sehen Boden | steht an einer Kante oder ist angehoben |
| STOP-Decoder | Mikrofon läuft und der lokale Decoder lässt sich vorbereiten | Autonomie lässt die Räder stehen |
| Keyword-STOP | ob STOP auch zwischen Bewegungen gehört wird | „?" heißt: zwischen Bewegungen greift nur der Lautstärke-Wächter |
| Sprach-Clips | Schreiben und Zurücklesen eines Clips | feste Sätze werden jedes Mal neu erzeugt |
| Kamera | eingeschaltet, schaut, Anzahl Gesichter | ohne Kamera findet LOOI niemanden |

### 2. Live-Probe gegen die Realtime-API

```
OPENAI_API_KEY=... pnpm run robot:mind-probe-live
```

Höchstens sieben kurze Textantworten, kein Audio. Verwendet den Session-Aufbau und die Nachrichtenformen der App und schreibt das Ergebnis nach `docs/research/evidence/robot-mind-realtime-probe.json`. Prüft:

1. **Körper-Notiz:** Systemnachricht mit eigener ID wird angenommen, lässt sich durch Löschen ersetzen, löst keine Antwort aus.
2. **Eigene Äußerung:** Antwort mit eigenen Anweisungen, `tool_choice: "none"` und Metadaten wird angenommen und bleibt bei höchstens zwei Sätzen und 160 Zeichen.
3. **Ausdruck:** ob das Modell `express` zusammen mit Worten sendet, in welcher Reihenfolge, und ob das Quittieren ohne Folgeanfrage fehlerfrei bleibt und keine weitere Antwort auslöst.

Die Probe selbst ist gegen einen lokalen Nachbau der API geprüft: Sie besteht bei erwartetem Verhalten und schlägt mit benanntem Grund fehl, wenn eine der drei Annahmen nicht gilt. Über die echte API sagt erst dein Lauf etwas.

### 3. Checkliste am Roboter (braucht dich)

Der Reihe nach, mit kurzem Aufwand. Die Protokollzeilen stehen im Diagnose-Export.

1. **STOP während eigener Drehung.** Autonomie auf „umschauen", Kamera-Aufmerksamkeit an, niemand im Bild, etwa zwei Minuten warten. Sobald LOOI sich zum Suchen dreht, laut „Stopp" sagen. Erwartet: Er hält an und bewegt die Räder nicht mehr, bis du die Einstellung änderst. Protokoll: `idle-autonomy-stopped-for-good`. Bleibt das aus, ist der Decoder während einer 240–360 ms langen Drehung zu langsam, und „erkunden" sollte aus bleiben.
2. **Links ist links.** Stell dich links vor LOOI (aus seiner Sicht), Autonomie „umschauen". Erwartet: Er dreht sich zu dir. Dreht er sich weg, ist die Bildseite gespiegelt; dann ist es eine Zeile in `body-sensors.ts`.
3. **Kante.** Nur auf „erkunden" und mit der Hand am Roboter: LOOI etwa 15 cm vor eine Tischkante stellen, dich dahinter zeigen. Erwartet: höchstens kurze Schritte, Stopp an der Kante, danach 15 Minuten kein Vorwärtsfahren.
4. **Mund und Ton.** Im Gespräch auf den Mund achten: Öffnet er sich mit den Silben oder merklich davor oder danach? Bei Versatz lässt sich die Latenz in `speech-level.ts` nachstellen.
5. **Verbindungsabbruch in Bewegung.** Mit der Hand am Roboter und weg von Kanten: über die Einstellungen eine Vorwärtsfahrt auslösen und währenddessen Bluetooth am iPhone ausschalten. Erwartet: Der Roboter hält binnen etwa einer Sekunde von selbst. Fährt er weiter, darf „erkunden" nicht benutzt werden, und das gehört ganz oben auf die Liste.
6. **Kopfbewegung beim Sprechen.** Stört das Motorgeräusch die Spracherkennung (LOOI unterbricht sich selbst)? Dann Umgebungsbewegung auf „aus"; das schaltet auch diese Kopfbewegungen ab.

## Nicht geklärt

- Die inoffiziellen FED9-Telemetrienotizen (`andrey-tut/LOOI-Robot`, im Hardware-Bericht verlinkt) konnte ich in dieser Sitzung nicht abrufen. Sie könnten sagen, ob Sensorrahmen periodisch oder nur bei Änderung kommen und was `0E` bedeutet.
- Wie zuverlässig das Realtime-Modell `express` nutzt und wie es Körper-Notizen einbezieht, zeigt nur der Betrieb.
