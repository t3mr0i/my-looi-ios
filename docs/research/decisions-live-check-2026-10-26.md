# Decisions: Einmaliger Live-Check

Stand: 26. Oktober 2026.

## Ziel und Ausgangslage

Die installierte Offline-Verhaltensprobe belegt den lokalen Policy-, Controller-,
SDK- und Mock-Pfad. Sie umgeht den echten Decisions-Client absichtlich. Auch die
Client-Tests verwenden Fake-Schlüssel und vorgegebene HTTP-Antworten. Damit sind
Anbieterzugriff, realer Antwortvertrag und tatsächliche Latenz noch nicht belegt.
Der Nutzer hat die Fortsetzung nach dieser Abnahme beauftragt.

## Abgewogene Wege und Umsetzung

Ein normaler Sprachdialog würde gleichzeitig Transkription, Realtime, Kamera und
Decisions beanspruchen und keinen reproduzierbaren Einzelaufruf ergeben. Eine
Live-Verhaltensprobe mit Gestenausführung würde zusätzlich Cue-Deadlines und
Aktor-Arbitrierung einführen; deren lokaler Pfad ist bereits separat geprüft.
Gewählt ist deshalb ein eigener, ausdrücklich gestarteter Einmal-Check auf der
Debugseite: feste synthetische Evidenz, die drei bestehenden Behavior-Fragen,
echter Decisions-Client und ein sichtbar validiertes Ergebnis.

Der vorhandene Client verwendet den in der App gespeicherten Schlüssel direkt.
Er wird nicht auf den Mac exportiert oder in Befehle, Protokolle oder Screenshots übernommen. Gesendet
werden nur der angezeigte Beispielsatz und festgelegter Testkontext; keine
Aufnahme, Bilder, Memory, Gesprächshistorie oder Produktionspräferenzen. Er führt
keine Geste und keinen Fahrbefehl aus und verändert keine gelernten Zustände.
Jeder Start löst höchstens eine Anfrage aus, ohne automatische Wiederholung.
Kosten dieses getrennten Diagnosechecks werden nicht dem lokalen Budget der
adaptiven Verhaltens-Engine zugerechnet; die Oberfläche weist darauf hin.

Die Tokenzahlen stammen aus der API-Antwort. Der bestehende Client berechnet
daraus eine Kostenschätzung; sie ist kein gemeldeter Rechnungsbetrag. Der
Request-Vertrag wurde gegen den offiziellen [Decisions-Guide](https://developers.openai.com/api/docs/guides/decisions)
und die [Create-Referenz](https://developers.openai.com/api/reference/resources/decisions/methods/create)
geprüft: Die drei String-Choice-Fragen und der JSON-Kontext passen zum Vertrag.
Eine dokumentierte Refusal-Antwort wird vom vorhandenen Parser als nicht
validierbare Antwort abgewiesen; der Check muss dies als Fehler anzeigen.

## Abnahmekriterien und Prüfstand

- Nur expliziter Start bei verbundenem Mock, im Vordergrund und ohne Fahrt.
- Ein Aufruf, kein Retry; paralleles Antippen erzeugt keine zusätzliche Anfrage.
- Abbruch, STOP, Quellen-/Linkwechsel, Hintergrund und Verlassen verhindern ein
  späteres erfolgreiches Ergebnis einer alten Anfrage.
- Antwortstatus, ausgewählte Cue, reale Latenz, Token und geschätzte Kosten sind
  sichtbar. Ein valider API-Response wird nicht als natürliche oder richtige
  Roboterreaktion ausgegeben.
- Fehlende Berechtigung, Schlüssel, Timeout, Netz- und Antwortfehler werden ohne
  Rohdaten oder Credentials angezeigt.

Implementiert sind `src/behavior/decisions-live-check.ts`, das getrennte Panel
`src/ui/DecisionsLiveCheckPanel.tsx` und seine Übersetzungen. Der gezielte Test
`pnpm run behavior:live-check-test` besteht: echter Client mit Fake-Schlüssel und
HTTP-Stub, feste Request-Daten, nur ein Aufruf, ungültige Antworten, sichere
401-/Schlüssel-/Netzfehler sowie Abbruch und verspätete Ergebnisse. Er läuft auch
in `ios:check` und `behavior:test`. `git diff --check` besteht.

Der anfänglich noch unvollständige parallele Verhaltensstand wurde durch seinen
zuständigen Agenten vervollständigt. Der anschließende vollständige Lauf von
`pnpm run ios:check` besteht einschließlich des neuen Einmal-Checks, der
Companion-, Sprach- und Handzeichenprüfungen. Der abschließende unabhängige Review
fand keine belegten Fehler im Anfrage-, Abbruch-, Guard- oder Anzeigepfad.

Der signierte native Release-Build besteht, ebenso `codesign --verify --deep
--strict`. Beim ersten Linkversuch zeigte der gemeinsame Sherpa-`current`-Pfad
auf Simulatorbibliotheken. Der erfolgreiche Gerätebuild setzt deshalb den
vorhandenen `prebuilt/ios/device`-Suchpfad ausdrücklich vor `$(inherited)`; die
gemeinsam verwendeten Symlinks wurden nicht verändert.

Der erste Installationsversuch benötigte zusätzliche 135.611.887 Bytes (rund
136 MB). My LOOI hat nur etwa 2,2 MB Cache und keine temporären Nutzdateien. Das
signierte App-Paket hat etwa 1,9 GB, davon rund 1,46 GB für das ukrainische
Offline-Vosk-Modell. Alle Sprachressourcen bleiben enthalten. Im zuvor
autorisierten Speicheraufräumen wurde über iOS eine 357,7 MB große App
ausgelagert; die iOS-Funktion behält zugehörige Dokumente und Daten. Anschließend
bestätigte `devicectl` die erfolgreiche Update-Installation auf dem iPhone 16.

## Tatsächliche Live-Abnahme am iPhone

Am 26. Oktober gegen 14:14 Uhr wurde genau einmal **Send one request** betätigt.
Das neue Panel war davor eingeklappt, der Mock verbunden und die Fahrt gestoppt.
Die Oberfläche zeigte den festen Beispielsatz, die echte OpenAI-Anfrage und das
getrennte Testbudget vor dem Start. Sie wechselte über den Wartezustand zu
**Response received**. Der Standardclient verwendete den bereits gespeicherten
Schlüssel; er wurde nicht erneut eingegeben oder exportiert.

| Angezeigter Wert | Beobachtung |
|---|---|
| Gesture suggestion | Curious look · 99 % |
| Attention choice | Keep target · 16 % |
| Intention choice | Drop · 23 % |
| Latency | 1.480 ms |
| Input tokens | 512 |
| Cached tokens / Cache-write tokens | 0 / 0 |
| Estimated API cost | 0,0000512 USD |

Die Prozentwerte sind die vom Modell gelieferten Confidence-Felder; sie sind
hier keine gemessene Genauigkeit. Die Kosten sind die lokale Schätzung aus den
zurückgegebenen Tokenzahlen. Das Panel führte keine Roboteraktion aus. Die
Bildschirmfreigabe wurde nach der Abnahme beendet. Ein zusätzlicher lokaler
Screenshot wurde wegen des anschließend wieder anderweitig genutzten iPhones
nicht gespeichert; die Werte wurden zuvor direkt in der Oberfläche abgelesen.

Bestätigt sind damit Schlüsselzugriff, Netzwerkaufruf, Antwortvalidierung und
native Anzeige dieses einen Requests. Die 1.480 ms sind eine einzelne gemessene
Gesamtlaufzeit, kein Modellbenchmark. Sie belegen nicht, dass das bestehende
800-ms-Fenster für normale Gesprächsentscheidungen eingehalten wird; dieser
Produktionspfad wurde mit dem Diagnosecheck nicht ausgeführt. Natürlichkeit,
Kamera-/Sprachdaten und physische Bewegung bleiben separat abzunehmen.

Die anschließend reproduzierte Fristkollision und ihre begrenzte Korrektur sind
im [Timing-Bericht](decisions-timing-2026-10-26.md) dokumentiert. Die Live-Messung
oben stammt aus dem Stand vor dieser Korrektur; ein erneuter API-Aufruf wird
daraus nicht abgeleitet.
