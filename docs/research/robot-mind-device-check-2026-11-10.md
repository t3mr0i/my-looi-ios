# Robot Mind: Belege statt Annahmen (2026-11-10)

Der Robot-Mind-Umbau (`robot-mind-2026-11-10.md`) hängt an Annahmen über das echte Gerät und die echte Realtime-API. Dieses Dokument hält fest, was davon inzwischen belegt ist, womit, und was nur du am Roboter klären kannst.

## Was die Rohquellen ergeben haben

### Reachy Mini, Quellcode statt README

Gelesen: `reachy_mini_conversation_app` (`idle_policy.py`, `moves.py`, `conversation_handler.py`) und `reachy_mini` (`motion/head_wobbler.py`, `motion/speech_tapper.py`).

- **Korrektur einer früheren Aussage:** Reachy fragt im Leerlauf *nicht* die KI. `idle_policy.py` wählt lokal per gewichtetem Zufall: 60 % nichts tun, 16 % Tanz, 16 % Emotion, 8 % Kopf bewegen. Das Werkzeug `idle_do_nothing` ist nur der Name der „nichts tun"-Wahl.
- **Leerlauf-Takt:** Reachy löst frühestens nach 180 s ohne Aktivität ein Leerlaufverhalten aus und dann höchstens alle 180 s (`IDLE_BEHAVIOR_THRESHOLD_S`). LOOI ruht 12–30 s zwischen Episoden, ist also deutlich unruhiger. Reachy hat dafür eine durchgehende Grundbewegung (Atmen mit 0,1 Hz, Antennen mit 0,5 Hz ab 0,3 s Inaktivität); bei LOOI übernehmen das Gesichtsatmen und die Umgebungsbewegung. Nicht geändert, weil das am Gerät beurteilt werden muss; die Werte stehen als Konstanten in `idle-autonomy.ts` (`REST_MS`).
- **Kopfbewegung beim Sprechen:** Reachys `HeadWobbler` plant jede Bewegung auf den Zeitpunkt, an dem der Ton *hörbar* ist (Puffer-Zeitstempel plus Latenz der Audioausgabe). Unsere erste Fassung nahm den Zeitpunkt des Einreihens. **Übernommen:** Die Zeitachse wird jetzt um die Ausgabelatenz verschoben, die das Audiomodul meldet (`outputLatencyMs + ioBufferDurationMs`).
- **Lautstärke-Kennlinie:** Aus `speech_tapper.py` übernommen statt geschätzt: Pause ab −45 dBFS, Phrasenbeginn ab −35 dBFS, Lautheit von −46 bis −18 dBFS mit +4 dB Empfindlichkeit und Gamma 0,9, Pause gilt nach 250 ms.

### LOOI-Protokoll, aus den Rohquellen

Gelesen: die Community-Notizen, die der Hardware-Bericht verlinkt (`andrey-tut/LOOI-Robot`, Stand `aade49d`, 12. 8. 2026: alle Dokumente und Skripte; Mitschnitte liegen dort nicht im Repo, `looi_control_logs/` ist ignoriert), die dort genannten Nachbarprojekte `novolei/ulooi` (`478f0c3`, Messprotokoll eines echten Geräts vom 17. 5. 2026), `GrinZero/super-looi` (`27fe561`, Herkunft unseres SDK) und `splattydoesstuff/sooperchargeforbots` (`d5a53cc`), dazu dieses Repo samt Git-Verlauf. Die Issues von `andrey-tut` konnte ich nicht abrufen.

Belegart: **gemessen** = am Gerät beobachtet und so beschrieben; **vom Autor bestätigt** = der Autor nennt es verifiziert, die Rohdaten sind nicht veröffentlicht; **Hypothese** = Vermutung des Autors; **eigener Schluss** = meine Folgerung.

| Frage | Quelle und Stelle | Aussage | Belegart |
|---|---|---|---|
| 1 Sensortakt | ulooi `docs/m0-5-prototype-findings.md:142-144` | `11 01 00` nur einmal nach dem Handshake; `01 …` „持续推送，状态变化时" (laufend, bei Zustandsänderung); `02 …` bei Bewegung, Neigung, Berührung, im Stillstand selten | gemessen, ohne Rate |
| 1 | ulooi `:153` | Ruhezustand „`01 01 01 01 01` (occasional)" | gemessen |
| 1 | andrey-tut `docs/FED9_TELEMETRY.md:136-137` | `0E` erscheint bei Gieren, Rollen, Schieben, nicht zuverlässig beim Drehen einer Kette von Hand | gemessen |
| 1 | andrey-tut `looi_interactive_probe.py:281-291` | das Messwerkzeug zeichnet nur Änderungen je Rahmentyp auf; ob Rahmen auch unverändert wiederholt werden, kann es nicht zeigen | eigener Schluss |
| 1 | dieses Repo, `looi-robot.ts:30` (Stand `025962c`) | „Real captures occasionally space FED9 notifications ~5 s apart." Verwaister Kommentar, kein Mitschnitt im Repo, Verlauf beginnt mit dem Import `63e18d6` | unbelegt |
| 1 | dieses Repo, `looi-robot.ts` in `computeSafety` | „FED9 behaves like an event stream, not a heartbeat … Firmware does not reliably emit a cliff frame on every fresh connection" | Aussage des Repo-Autors, Herkunft unbelegt |
| 1 | – | Keine Quelle nennt eine Rate. Alles deutet auf Rahmen bei Änderung, ob zusätzlich in Ruhe wiederholt wird, ist offen | eigener Schluss |
| 2 `0E` | andrey-tut `FED9_TELEMETRY.md:18, 117-152`, `OPEN_QUESTIONS.md:7-29` | „motion_or_encoder_candidate", Vertrauen niedrig-mittel; Beispiele `0e 42 00`, `0e 75 01`, `0e ff ff`, `0e d3 05`; `ffff`, `0104`, `d305` wirken wie Platzhalter oder Überlauf; kein Radsensor, kein Kurs | Werte gemessen, Deutung Hypothese |
| 2 | andrey-tut `OPEN_QUESTIONS.md:99-100` | Kette von Hand gedreht: links nichts, rechts schwache `0E`, „likely caused by body micro-movement" | gemessen, Deutung Hypothese |
| 2 | sooperchargeforbots `README.md:84` | `fed9`: „Cliff sensors, TOF distance, Battery", ohne Rahmenformat | Behauptung ohne Beleg (Autor arbeitet mit der zerlegten offiziellen App) |
| 2 | ulooi `:140-145` | dekodiert `01`, `02`, `09`, `11`; `0E` kommt nicht vor | gemessen (Fehlen) |
| 2 | dieses Repo, `fed9-sensors.ts:23-31` | `0E` als ToF-Abstand in mm, `0x1fff` = kein Ziel, „inferred from real-device FED9 captures"; Schwelle „provisional" | unbelegt, keine Mitschnitte im Repo |
| 2 | – | Die Beobachtungen von andrey-tut widersprechen einem Frontabstand nicht: Gieren und Schieben ändern, was vor dem Roboter ist; eine von Hand gedrehte Kette nicht. Niemand hat ein Objekt vor den Roboter gestellt. `0x1fff` liegt im Bereich, den gängige ToF-Chips für „außer Reichweite" melden; `ffff` liegt darüber | eigener Schluss |
| 3 Abbruch | andrey-tut `docs/PROTOCOL.md:80` | „The command must be repeated continuously", Takt etwa 30 ms; was ohne Wiederholung passiert, steht nicht da | vom Autor bestätigt, Folge nicht beschrieben |
| 3 | andrey-tut `docs/SAFETY.md:18-20`, `looi_control_lab.py:227-228` | „Stop movement on disconnect or heartbeat error", eigener 3-s-Totmann in der App | Vorsichtsregel, kein Gerätebefund |
| 3 | ulooi `:87` | ohne Fahrbefehl etwa alle 30 ms trennt LOOI die Verbindung nach etwa 2 s | Aussage des Autors |
| 3 | super-looi `docs/looi-ble-live-verification.md:7-10` | mit 30-ms-Takt und Community-Handshake nach 5 s getrennt, mit unserem Handshake (`FEDA 03`, `FEF0` Zeit, `FEDA 8101`) 6 min 27 s verbunden; „kann nicht einem Schritt zugeordnet werden" | gemessen; widerspricht ulooi als Ursache |
| 3 | dieses Repo, SDK `startMoveLoop` | 110 ms Takt; kommt unverändert aus super-looi `9985101` (`packages/looi-sdk/src/index.ts:196`), ohne Begründung; heute nutzt super-looi selbst 30 ms (`packages/looi-driver/src/constants.ts:35`) | Herkunft geklärt, kein Beleg |
| 3 | dieses Repo, `looi-robot.ts` beim Wiederverbinden | der erste Fahrbefehl nach jedem Wiederverbinden ist STOP; Wiederholversuche nach 1, 2, 4 s (`looi-robot-autoconnect.ts:98`) | Code |
| 3 | – | Keine Quelle sagt, ob LOOI bei Verbindungsabbruch oder ausbleibenden Befehlen von selbst hält | nicht geklärt |
| 4 Anheben | ulooi `:85` | angehoben über dem Tisch ignorierte LOOI Fahrbefehle, auf dem Tisch fuhr er sofort; der Autor schreibt das der vorderen Kante zu | gemessen; Ursache Hypothese |
| 4 | ulooi `:154-155` | ganz angehoben: `01 01 01 01 00` oder `01 01 01 00 00` (vordere Sensoren melden weiter Boden); vorn angehoben: `01 00 01 01 01` | gemessen, „kontraintuitiv", Zuordnung unvollständig |
| 4 | andrey-tut `FED9_TELEMETRY.md:100-115` | `02` reagiert stark auf Nase-nach-unten; „robot_vertical_or_falling_candidate" als mögliches App-Ereignis, „not safe yet" | gemessen, Deutung Hypothese |
| 4 Berührung | andrey-tut `FED9_TELEMETRY.md:9-16, 45-55`; ulooi `:174` | `09` links, `0A` rechts (je 1/0), `12 00 00` vorn als Impuls; ulooi sah `09 01/00` beim Berühren der Seiten | vom Autor bestätigt; ulooi gemessen |
| 4 Dock | andrey-tut `FED9_TELEMETRY.md:57-62`, `looi_control_lab.py:57-71` | `05` aufgesetzt, `06` abgenommen | vom Autor bestätigt („repeated attach/remove test") |
| 4 Strom | andrey-tut `PROTOCOL.md:114-128`, `FED9_TELEMETRY.md:66-73`; ulooi `:51` | `FED8` lesen: `[Prozent, 0 Akku / 1 USB]`; `FED9 0B 01/00` beim Ein-/Ausstecken | `FED8` gemessen; `0B` „medium-high" |
| 5 Kopfmitte | andrey-tut `README.md:26`, `PROTOCOL.md:96-98`; ulooi `:96` | `5A` = Mitte; ulooi sah den Kopf damit zur Mitte gehen | vom Autor bestätigt; ulooi gemessen |
| 5 | super-looi `packages/looi-driver/src/constants.ts:39-55` | `87` = „center", 55° = waagerecht; daraus folgt `5A` ≈ 65°, also etwas nach oben | Wahl des Autors, keine Messung veröffentlicht |
| 5 | – | „Mitte" kann die Mitte des Stellbereichs oder der waagerechte Blick sein; beide Werte sind plausibel, für das Gesicht zählt der Blick auf Augenhöhe | eigener Schluss |

## Was der Dauerlauf gezeigt hat

`scripts/idle-autonomy-soak.test.mjs`: zufällige Abläufe zu je 40 virtuellen Minuten gegen den echten Controller, das SDK und den Mock-Roboter. Weil Bewegungen unter einer halben Sekunde dauern, wartet ein Teil der Störungen gezielt auf die nächste Radbewegung und schlägt mitten darin zu. Er läuft jetzt in drei Durchgängen:

| Durchgang | Abläufe | Radbewegungen (vorwärts) | Kantenstopps | STOP in Bewegung | Abbrüche in Bewegung | Verstöße |
|---|---|---|---|---|---|---|
| 1: alter Sensortakt (alle 250 ms Kante und `0E` „kein Ziel"), Abbruch-Prüfung bestätigt | 60 | 215 (30) | 25 | 16 | 25 | 0 |
| 2: wie 1, Bestätigung zufällig an oder aus und wechselnd | 30 | 132 (3) | 9 | 8 | 2 | 0 |
| 3: Roboter meldet nur bei Änderung (Start-, Kanten-, Bewegungsrahmen), nichts in Ruhe | 30 | **3 (0)** | 0 | 0 | 0 | 0 |

Durchgang 1 ist der bisherige Lauf und liefert dieselben Zahlen wie vor diesem Umbau. Mit `IDLE_SOAK_REST_FRAME_MS` lässt sich Durchgang 3 mit Kantenrahmen in Ruhe wiederholen: alle 5 s ergibt 73 Radbewegungen (1 vorwärts), alle 7 s 75 (2 vorwärts), jeweils 0 Verstöße.

**Was Durchgang 3 zeigt:** Meldet der echte Roboter wie in den Community-Mitschnitten beschrieben nur Änderungen, bewegt die Autonomie die Räder praktisch nie. Das ist die sichere Richtung des Fehlers, aber „umschauen" und „erkunden" täten dann kaum etwas. Die wenigen Schritte, die bei Rahmen in Ruhe vorkommen, hängen daran, welchen `0E`-Wert die letzte Drehung geliefert hat; mit den veröffentlichten Werten (`66`, `373`, `ffff`, `1491`) ist das Zufall, nicht Sicht nach vorn.

Geprüfte Regeln, **0 Verstöße** in allen drei Durchgängen:

- keine Radbewegung ohne scharfen STOP-Decoder und laufendes Mikrofon
- keine Radbewegung während Gespräch, Sprache, Hintergrund, Fahrsitzung, ohne Verbindung oder auf Stufe „aus"
- vorwärts nur auf „erkunden" und nur mit bestätigter Abbruch-Prüfung; nie rückwärts
- Dauer- und Mengenbudgets, Mindestpause
- nach einem Kantenstopp 2 min keine Räder und 15 min kein Vorwärtsfahren, auch nach Umsetzen von Hand
- STOP hält sofort an und sperrt bis zur Änderung der Einstellung
- ein beginnendes Gespräch beendet eine laufende Bewegung binnen 150 ms
- jede Bewegung endet rechtzeitig mit einem Stopp-Befehl

Gegenprobe: Entfernt man die STOP-Decoder-Sperre oder die STOP-Verriegelung aus dem Code, meldet der Dauerlauf jeweils über hundert Verstöße. Entfernt man die Kantensperre der Autonomie, bleibt er grün, weil drei weitere Sicherungen dieselbe Lage abdecken (5 min Pause nach blockierter Bewegung, Annäherungs-Abklingzeit, Leerlauf-Ende nach 10 min); diese eine Sperre prüft der Szenariotest `idle-autonomy-mock-integration` direkt. Entfernt man die neue Abbruch-Sperre an beiden Stellen (Entscheidung und Prüfung direkt vor der Fahrt), meldet Durchgang 2 sechs Verstöße; jede Stelle allein prüft außerdem ein eigener Test (`idle-autonomy`, Szenario 8 in `idle-autonomy-mock-integration`).

**Der Fund, jetzt mit Quellenlage:** Bricht die Bluetooth-Verbindung mitten in einer Bewegung ab, kann die App keinen Stopp mehr senden. Ob der Roboter dann von selbst anhält, belegt keine Quelle. Die Community schreibt nur, dass Fahrbefehle ständig wiederholt werden müssen, nicht was ohne sie geschieht; ihre eigenen Werkzeuge stoppen vorsorglich selbst. Die 110-ms-Schleife unseres SDK ist aus super-looi übernommen und begründet nichts. Das betrifft jede Bewegung der App; die Autonomie fährt aber unbeaufsichtigt. Mildernd, aber nicht ausreichend: Nach einem Wiederverbinden sendet die App als ersten Fahrbefehl STOP, und eine angehobene Basis ignoriert laut ulooi Fahrbefehle.

Weil das offen ist, gilt jetzt die engere Regel: **„Erkunden" macht keine Schritte, bis du am Roboter geprüft und in den Einstellungen bestätigt hast, dass er bei Verbindungsabbruch von selbst hält** (Einstellungen → Eigenes Leben → „Schritte beim Erkunden"). Bis dahin schaut und dreht er sich nur. Drehungen auf „umschauen" bleiben erlaubt: Ein Roboter, der nach einem Abbruch weiterdreht, bleibt an seinem Platz, solange er sich auf der Stelle dreht. Ob das am Tisch reicht, zeigt erst Punkt 1 der Checkliste; fährt er dort weiter, gehört auch „umschauen" abgeschaltet. Die Schrittlänge habe ich nicht verkürzt: Sie verringert nur die Wahrscheinlichkeit, nicht die Folge eines Abbruchs, und kürzere Bewegungen waren laut `CHANGELOG.md` am Gerät schon einmal wirkungslos.

## Instrumente für dich

### 1. Selbsttest in der App (30 s, es bewegt sich nichts)

Einstellungen → Diagnose → „Roboter-Selbsttest (30 s)". Misst an deinem Gerät und schreibt ins Diagnoseprotokoll (`robot-mind-self-check`):

| Zeile | Was gemessen wird | Bedeutung bei ✗ |
|---|---|---|
| Basis | Verbindung und Fahrkanal | Roboter nicht verbunden |
| Sensortakt | genaue Anzahl Sensorrahmen in 30 s bei stehenden Rädern, davon Kantenrahmen, Anzahl je Rahmentyp (`01`, `02`, `0e` …), längste Lücke (auf 0,1 s genau) gegen die 6-s-Grenze | Autonomie bewegt die Räder selten oder nie. 0 Kantenrahmen in 30 s heißt: der Roboter meldet die Kanten nur bei Änderung |
| Untergrund | alle vier Kantensensoren sehen Boden (letzter Kantenrahmen, auch wenn er älter ist) | steht an einer Kante oder ist angehoben |
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

Der Reihe nach, mit kurzem Aufwand. Die Protokollzeilen stehen im Diagnose-Export. Bei jedem Punkt steht, welche Beobachtung welche Frage entscheidet.

1. **Verbindungsabbruch in Bewegung (Frage 3, entscheidet über „erkunden").** Hand am Roboter, weg von Kanten, Autonomie aus. „LOOI, vorwärts" sagen (fährt bis zu 5 s) und währenddessen Bluetooth im Kontrollzentrum ausschalten, ohne die App zu verlassen; ein Wechsel in die Einstellungs-App schickt vorher selbst einen Stopp und macht den Versuch wertlos. Zwei- bis dreimal wiederholen. Gültig ist ein Versuch, wenn der Export `ble-disconnected` mit `previousDirection: forward` zeigt und davor kein `background-entered`. **Hält er binnen etwa einer Sekunde:** In den Einstellungen „Schritte beim Erkunden" auf „Geprüft" stellen. **Fährt er weiter, bis du ihn hochhebst:** nicht bestätigen, „erkunden" bleibt ohne Schritte, und die Autonomie gehört auf „aus", bis die App einen Ausweg hat. Wie lange er weiterfährt, bitte notieren.
2. **Sensortakt (Frage 1).** Roboter mitten auf den Tisch, nichts berühren, Selbsttest starten. Die Zeile „Sensortakt" zeigt Rahmen je Typ. **0 Kantenrahmen (`01`) in 30 s:** der Roboter meldet nur bei Änderung; dann bleibt die Autonomie fast still, und die Frischeregel braucht eine andere Grundlage (das ist Code-Arbeit, keine Einstellung). **Kantenrahmen in gleichmäßigem Abstand:** Abstand notieren; liegt er unter 6 s, passt die heutige Regel.
3. **Anheben (Frage 4).** Selbsttest-Export reicht nicht, hier braucht es die `cliff-state`-Zeilen: Roboter ganz hochheben, 3 s halten, absetzen; dann nur vorn anheben; dann nur hinten. Je Haltung die `rawFlags` notieren. **Zeigt ganz angehoben nur hinten `0`** (wie bei ulooi), erlaubt die Bewegungsschicht einem angehobenen Roboter weiterhin ein ausdrückliches „vorwärts"; dann zusätzlich angehoben „LOOI, vorwärts" sagen und beobachten, ob die Räder sich drehen (ulooi: nein).
4. **`0E` vor einem Hindernis (Frage 2).** Roboter steht, eine Hand bzw. ein Buch etwa 5, 10, 20 und 40 cm vor die Front halten, jeweils 3 s, dann wegnehmen. Im Export die `tof-state`-Zeilen (mit `hex`) ansehen. **Ändert sich `0E` mit dem Abstand und kommt ohne Bewegung des Roboters:** es ist ein Abstand, die 180-mm-Schwelle lässt sich prüfen. **Kommt `0E` nur, wenn der Roboter selbst bewegt wird:** es ist kein Abstand, und Schritte haben keine Sicht nach vorn; „erkunden" sollte dann ohne Schritte bleiben, auch wenn Punkt 1 bestanden ist.
5. **Kopfmitte (Frage 5).** Nur Kopf: den Kopf in die Mitte stellen lassen (die App sendet dafür `87`) und von der Seite fotografieren; dann denselben Blick mit `5A` vergleichen. Für `5A` hat die App keinen Schalter; das geht mit den Skripten von andrey-tut (`looi_keyboard_control.py`, Taste `o`) bei geschlossener App (deren Handshake hielt bei super-looi an einem Gerät nur 5 s; dann reicht der kurze Moment fürs Foto). Entscheidet, welcher Wert waagerecht blickt; sicherheitsrelevant ist es nicht.
6. **STOP während eigener Drehung.** Autonomie auf „umschauen", Kamera-Aufmerksamkeit an, niemand im Bild, etwa zwei Minuten warten. Sobald LOOI sich zum Suchen dreht, laut „Stopp" sagen. Erwartet: Er hält an und bewegt die Räder nicht mehr, bis du die Einstellung änderst. Protokoll: `idle-autonomy-stopped-for-good`. Bleibt das aus, ist der Decoder während einer 240–360 ms langen Drehung zu langsam. (Dreht er sich nie, siehe Punkt 2.)
7. **Links ist links.** Stell dich links vor LOOI (aus seiner Sicht), Autonomie „umschauen". Erwartet: Er dreht sich zu dir. Dreht er sich weg, ist die Bildseite gespiegelt; dann ist es eine Zeile in `body-sensors.ts`.
8. **Kante.** Nur nach bestandenem Punkt 1 und 4, auf „erkunden" und mit der Hand am Roboter: LOOI etwa 15 cm vor eine Tischkante stellen, dich dahinter zeigen. Erwartet: höchstens kurze Schritte, Stopp an der Kante, danach 15 Minuten kein Vorwärtsfahren.
9. **Mund und Ton.** Im Gespräch auf den Mund achten: Öffnet er sich mit den Silben oder merklich davor oder danach? Bei Versatz lässt sich die Latenz in `speech-level.ts` nachstellen.
10. **Kopfbewegung beim Sprechen.** Stört das Motorgeräusch die Spracherkennung (LOOI unterbricht sich selbst)? Dann Umgebungsbewegung auf „aus"; das schaltet auch diese Kopfbewegungen ab.

## Nicht geklärt

- **Hält der Roboter bei Verbindungsabbruch von selbst?** Keine Quelle sagt es. Bis Punkt 1 bestanden ist, macht „erkunden" keine Schritte.
- **Sendet er Sensorrahmen auch im Stillstand, und wie oft?** Die Quellen beschreiben Rahmen bei Änderung, nennen aber keine Rate; der „~5 s"-Kommentar im Code hatte keinen Beleg. Punkt 2 entscheidet es. Die 6-s-Regel bleibt, weil sie nur in die sichere Richtung irrt.
- **Was ist `FED9 0E`?** Abstand (App, sooperchargeforbots ohne Beleg) oder Bewegungs-/Lagewert (andrey-tut, Hypothese). Punkt 4 entscheidet es. Bis dahin kann der Wert Vorwärtsfahrt nur verhindern. Werte über `0x1fff` (etwa `ffff`) gelten weiter als „nichts in der Nähe": Würden sie als „unbekannt" gelten und wäre `ffff` der übliche Ruhewert dieses Roboters, wäre jedes Vorwärtsfahren gesperrt, auch der gesprochene Befehl „fahr vor". Der Rohwert steht jetzt in jeder `tof-state`-Protokollzeile.
- **Woran erkennt die App ein Anheben?** An keinem eigenen Rahmen; ganz angehoben meldeten bei ulooi nur die hinteren Sensoren „kein Boden". Die Autonomie verlangt alle vier, bewegt einen angehobenen Roboter also nicht; ein ausdrückliches „vorwärts" prüft nur die vorderen. Punkt 3 entscheidet, ob das eine Lücke ist.
- **Berührung, Dock, Akku** sind in den Quellen gut beschrieben (`09`/`0A`/`12`, `05`/`06`, `FED8`), aber nicht in der App als Sinne verdrahtet; `FED8` kann der Transport nicht lesen. Kein Sicherheitsthema, daher unverändert.
- **Kopfmitte `5A` oder `87`:** zwei Quellen mit Gerät sagen `5A`, super-looi bleibt bei `87`. Punkt 5 entscheidet es; unverändert.
- Wie zuverlässig das Realtime-Modell `express` nutzt und wie es Körper-Notizen einbezieht, zeigt nur der Betrieb.
