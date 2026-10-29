# Reaktionszeit: Audioeingang, Gesprächsstart und Messung

**Fortsetzung am 29. Oktober:** Der neue reguläre Stand mit Mondaugen,
Farbeinstellungen und den Audio-/Zuhörkorrekturen ist auf dem physischen
iPhone installiert und gestartet. Die aktuelle Sprachabnahme ist noch offen.
[Aktueller Build, Installation und Prüfgrenzen](voice-latency-device-install-2026-10-29.md).

Die folgenden B7–B9-Angaben beschreiben die Messungen und Zwischenstände
vom 28. Oktober.

Stand: 28. Oktober 2026. Das Ziel ist noch offen. Zuletzt vom Nutzer bestätigt:
physisches iPhone auf LOOI, **Budget-Modus**, Verbindung zum Mac ausschließlich
über WLAN. Der Nutzer konnte es zuletzt nicht entsperren und hat weitere
Mock-Prüfungen freigegeben. Inzwischen waren reguläre WLAN-Installationen
wieder möglich; eine bestätigte menschliche Sprachtestreihe steht weiter aus.

## Aktueller Gerätebuild B9

B9 ist regulär auf dem physischen iPhone installiert und wurde gestartet.
Es enthält PCM-Sprachausgabe vor Downloadende, die explizite Zwanzig-Sekunden-
VAD-Grenze, die frühe neutrale Eingangsreaktion und den aktuellen nativen
Soft-Glass-Renderer. Der vollständige `ios:check` besteht. Native Implementierung
und Assets stammen aus dem erfolgreich kompilierten B8; die nativen
Instruktionsabschnitte stimmen per Hash überein. Der einzige neue
Produktionsbaustein gegenüber B8 ist die nachfolgende Budget-Tippkorrektur.

Die frühe Eingangsreaktion ist damit erstmals auch im installierten Paket
enthalten. Ihre tatsächliche Mikrofon-zu-Pixel-Latenz ist weiterhin ungeprüft.
Die B9-Diagnose bestätigt Budget und das 100-ms-Aufnahmeintervall, zeigt aber
nur kurze Vordergrundfenster ohne vollständigen Gesprächsversuch.

[Build B9 und Grenzen](evidence/voice-latency-device-B9-2026-10-28.json),
[Installations- und Startbeleg](evidence/voice-latency-device-B9-startup-2026-10-28.json).
Lokales Paket: `/private/tmp/looi-latency-2026-10-28/B9.app`.

### Tipp beim Warten: belegten Aufnahmeaussetzer entfernt

Im B8-Geräteprotokoll folgte auf gewöhnliche Gesichtstipps jeweils
`budget-tap`, anschließend wurde der bereits laufende Recorder gestoppt und
neu gestartet. Der Watchdog meldete gleichzeitig korrekt
`conversation-owns-runtime`; er verursachte diese Neustarts nicht.

Sieben solche Wiederanläufe wurden beobachtet. Fünf hatten vor dem nächsten
Stop einen vollständigen `first-pcm`-Beleg:

| Interne B8-Messung | n | Median | p95 |
| --- | --- | --- | --- |
| Gesichtstipp bis erstes neues PCM-Ereignis in JS | 5 | 1057 ms | 1068 ms |
| Recorder-Stop bis erstes neues PCM-Ereignis in JS | 5 | 955 ms | 967 ms |
| VAD-Verarbeitung aus sparsamen Health-Stichproben | 7 | 1,85 ms | 3,28 ms |

Die zwei unvollständigen Wiederanläufe zählen nicht als Null-Latenzen.
Dies sind gewöhnliche Touch-Ereignisse, keine kontrollierte Gesprächsreihe.
Die VAD-Werte werden etwa einmal pro Health-Fenster erfasst; sie sind keine
Verteilung sämtlicher Audioblöcke. Die Antwortlatenz ab tatsächlichem
Sprachende lässt sich daraus nicht ableiten.

B9 behält beim Tipp einen laufenden Recorder mit frischem PCM bei. Auch ein
noch ausstehendes VAD-Ergebnis und seine Samples bleiben erhalten. Der Tipp
stoppt weiterhin Roboterbewegungen und erneuert das 30-Sekunden-Idle-Fenster.
Ein veralteter/fehlender Audiostrom nutzt den bisherigen Reparaturweg.
Nach bestätigter Sprache beendet der Tipp weiterhin den Beitrag; während
einer Antwort unterbricht er die Ausgabe und öffnet einen neuen Hördurchgang.

`budget-listening-tap.test.mjs` schlug vor der Korrektur am unerwünschten
Recorder-Stop fehl und besteht danach einschließlich VAD-Warteschlange,
Idle-Verlängerung, Stale-Reparatur und explizitem Beitragsende. Der bestehende
Budget-Runtime-Test prüft zusätzlich die Ausgabeunterbrechung. B9 ist
installiert; das Ausbleiben der Aussetzer bei neuen physischen Tipps ist noch
nicht belegt. Es wird kein verbesserter Geräte-Median oder p95 behauptet.

[B8-Geräteprotokoll und interne Messpunkte](evidence/voice-latency-device-B8-startup-2026-10-28.json).

## Weitere Produktänderung: Sprachausgabe vor Downloadende

Der zweite nachgewiesene Wartepunkt nach Textgenerierung lag in
`openai-speech.ts`: Auch ein verfügbarer Audio-Stream wurde vollständig in
Speicher gelesen und erst danach als WAV an den Player übergeben.
Der neue gezielte Budget-Pfad fordert PCM16/24 kHz mit `stream_format: audio`
an und übergibt vollständige Samples bereits vor HTTP-EOF an den nativen Player.
Die API unterstützt diese Form der Streaming-Ausgabe laut
[OpenAI Docs](https://developers.openai.com/api/docs/guides/text-to-speech) und
[Speech-Referenz](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create).

Der bestehende native PCM-Player lief bisher nur bei aktiver Capture-Engine.
Er hat nun einen eigenen asynchronen Ausgabestart mit `AVAudioSession.playback`;
dieser startet keinen Mikrofon-Tap und wird abgewiesen, solange der native
Capture-Pfad aktiv ist. Ein eigener Ausgabe-Eigentümer verhindert, dass verspätete
Drain-/Fehler-/Stop-Ereignisse eine neuere Sitzung stoppen. Nach Drain oder Fehler
wird die Ausgabe-Engine freigegeben. Die Freigabe wird auch auf JavaScript-Seite
abgewartet, bevor Budget wieder das Mikrofon startet. Die Satz-Clip-Grenzen für
die Gesichtsausdrücke bleiben erhalten.

Nur Budget schaltet Streaming explizit ein. Ältere native iOS-Builds und andere
Plattformen verwenden weiter WAV/Expo-Player; die Stimmvorschau bleibt beim
bisherigen Pfad. Es gibt keinen zusätzlichen API-Versuch, Anbieterwechsel oder
Wechsel des gespeicherten Gesprächsmodus.

Der neue Ablauf wurde zuerst gegen den alten Client ausgeführt und war rot:
Solange das Ende des HTTP-Bodys ausstand, gab es keinen Player-Write. Danach
besteht derselbe Test und bestätigt den nativen Render-Callback **vor** EOF.
Weitere Fälle prüfen ungerade Netzwerk-Chunk-Grenzen, 4-MB-Limit,
Zwei-Sekunden-Backpressure, Netzwerk-Timeout, Ausgabefehler, verspätete Ereignisse,
Abbruch während asynchronem Engine-Start und vollständig abgewartete Freigabe.
Der vorhandene WAV-Pfad und die Budget-/Realtime-Lebenszyklusprüfungen bestehen.

`budget-speech-stream-latency` protokolliert ausschließlich Laufzeiten vom
Request bis Headern, erstem Byte, Enqueue und dem Empfang des nativen
Render-Callbacks sowie, ob der Download dann schon vollständig war. Der
Latenzexport übernimmt diese Werte und zählt Rendering vor Downloadende.
Auch dieser Callback ist keine externe akustische Messung.

Der vollständige signierte iPhone-Release-Build B6 mit Hermes-Bundle wurde
gebaut und seine Signatur streng geprüft. Er enthält den unveränderten
Gesprächsmodus aus den Nutzereinstellungen, ohne erzwungenen Benchmark-Start.
TypeScript, die gezielten Streaming-/WAV-Tests, Budget-Lebenszyklus,
Realtime-Sitzungstrennung, Capture-Profil und der erweiterte Latenztest bestehen.
Ein neuer grüner Gesamtlauf wird daraus nicht abgeleitet; die zuvor dokumentierten
separaten Gesamt-Testfehler bleiben getrennt.

[Build B6: Quell-, Bundle- und native Hashes](evidence/voice-latency-device-B6-2026-10-28.json).
Das Paket liegt lokal unter `/private/tmp/looi-latency-2026-10-28/B6.app` und wurde
noch nicht auf dem iPhone installiert. Der ursprünglich installierte, nicht
startbare Testbuild und dessen Rückinstallation bleiben deshalb separat offen.

Die vorherige reale B5-Sprachvorbereitung von 1.683 ms wird durch die Änderung
**nicht** nachträglich zu einer neuen Messung. Welche Zeitersparnis der erste
Audioblock tatsächlich bringt und ob die Wiedergabe bei WLAN-Schwankungen glatt
bleibt, ist am iPhone noch offen. Der Nutzer hat bestätigt, dass Entsperren
gerade nicht möglich ist; der Build wird vorbereitet, ohne die Geräteabnahme
als abgeschlossen auszugeben.

## Native Simulatorprüfung des Streaming-Pfads

Ein eigener iOS-18.5-ARM-Simulator führte den tatsächlichen Expo-Fetch- und
AVAudioEngine-Pfad aus. Nur die Speech-API wurde durch einen lokalen
HTTP-Server mit leisem generiertem Testton ersetzt; sein zweiter Datenblock kam
absichtlich erst eine Sekunde nach dem ersten. Die Testoberfläche startete keine
normalen App-Perceiver. Die Mikrofonberechtigung war **denied**. In beiden
Durchläufen begann der native Renderer vor Downloadende; es wurden null
Mikrofonereignisse und null Capture-Frames erfasst.

| Messpunkt im Simulator | Median | p95 | n |
| --- | ---: | ---: | ---: |
| HTTP-Request bis Empfang des nativen Render-Callbacks | 80,124 ms | 108,836 ms | 2 |
| Erstes Netzwerkbyte bis Enqueue einschließlich asynchronem Ausgabestart | 3,231 ms | 4,831 ms | 2 |

Die Einzelstarts lagen bei 108,836 und 51,412 ms. Der zweite Durchlauf wurde
beim Render-Callback abgebrochen; er endete mit `AbortError` und bestätigtem
`playbackRunning: false`. Ein vollständig abgespielter Clip gab die Engine vor
Rückkehr des Speech-Promises frei. Diese zwei Starts sind eine kleine
Funktionsprobe, keine Verteilung vollständiger Antworten. Sämtliche Differenzen
in dieser Tabelle stammen aus derselben JavaScript-Uhr. Sie beginnen am
HTTP-Request bzw. ersten Byte, nicht am menschlichen Sprachende.

Der lokale Server, Testton und Simulator belegen weder OpenAI- noch WLAN-
Latenz, hörbaren Beginn am physischen iPhone oder Gesicht-/Roboterbewegung.
Der Simulator, sein Buildcache und der lokale Server wurden nach dem Export
der Messdaten entfernt bzw. beendet. B7 protokolliert zusätzlich die nativen
Routenwerte `outputLatencyMs` und `ioBufferDurationMs`; die beiden B6-Probeläufe
enthielten diese zusätzlichen Werte noch nicht.

[Native Simulator-Rohwerte und Abgrenzung](evidence/voice-latency-native-stream-simulator-2026-10-28.json).

## Denkpausen und lange Beiträge

Die direkte Prüfung des iOS-Wrappers zeigte einen weiteren Unterschied:
Ohne explizites `maxSpeechDuration` verwendet er fünf Sekunden. Budget erlaubt
jedoch bis zu zwanzig Sekunden pro Beitrag. Mit dem schnellen Commit kann ein
solches erzwungenes abgeschlossenes Segment als Beitragsende wirken.

Ein synthetischer deutscher Beitrag mit inneren Pausen wurde zweimal verbunden
und mit derselben nativen Sherpa-Version auf dem Mac verarbeitet. Sein
Energie-Endbezug lag bei 11.031,25 ms. Bei maximal fünf Sekunden kam bereits bei
7.720 ms ein abgeschlossenes Segment mit `isSpeechDetected: false`; weitere
Sprache folgte noch. Mit maximal zwanzig Sekunden blieb es genau ein Segment,
abgeschlossen bei 12.000 ms. Der Native-Default-Fall wird zusätzlich durch den
Budget-Dienst in der virtuellen Uhr wiedergegeben und muss am Prüfkriterium
„kein Commit vor dem Ende des synthetischen Beitrags“ scheitern. Der Zwanzig-
Sekunden-Fall besteht.

`vad-service.ts` setzt deshalb nun `maxSpeechDuration: 20` ausdrücklich.
Das bisherige Stillefenster von einer Sekunde, Schwelle und Mindestsprachdauer
bleiben erhalten. Der Test des tatsächlichen VAD-Initialisierungsaufrufs war
zuvor rot und besteht danach. Dies verhindert den nachgewiesenen vorzeitigen
Abschluss dieses langen Beispiels; echte Gesprächsqualität auf dem iPhone bleibt
zu prüfen. [Native Langbeitragsdaten](evidence/budget-vad-long-turn-2026-10-28.json).

Der frühere B5-Wert ab abgebildetem Segmentende ist dadurch zusätzlich begrenzt:
Ein natives Segmentende kann auch eine erzwungene Grenze sein. Der B5-Datensatz
enthält nicht genug Grenzdetails, um diese Ursache rückwirkend zuzuordnen.
Seine Commit-zu-Playing-Zeit von 4.154 ms und die vier Verarbeitungsanteile
bleiben gültige interne Laufzeiten. Das tatsächliche menschliche Sprachende
wurde damit weiterhin nicht vermessen.

## Offline-Mock nach Nutzerfreigabe

Auf „du kannst es mocken“ wurde der Vergleich ohne weitere Geräteanforderung
als reproduzierbare Offline-Simulation umgesetzt. Sie lädt die echten
Budget- und Realtime-PCM-Dienste, den Konfigurationsbauer und den Latenztracker.
Eine virtuelle Uhr ersetzt das Warten; Mikrofon, Berechtigungen, Transport und
Player sind Mocks. Es werden keine API-Schlüssel benötigt und keine Audiodaten
übertragen. Die vorher bestehende Geräterückinstallation bleibt separat offen;
der gepaarte WLAN-Tunnel meldet weiterhin `disconnected`.

`pnpm run voice:latency-test` besteht einschließlich **148 Mock-Prüfungen**.
Geprüft wurden:

- Budget-Start, Commit am abgeschlossenen nativen Segment und automatisches
  erneutes Zuhören nach einer Antwort.
- Beide vorhandenen nativen VAD-Aufzeichnungen, darunter der Beitrag mit rund
  900 ms innerer Pause: jeweils ein Beitrag, kein zusätzlicher Abschluss-Timer.
- Abbruch während Textverarbeitung und Wiedergabe: keine verspätete alte Sprache;
  nach Tippen ist der Budget-Mikrofoneingang wieder aktiv.
- Realtime-Start, quittiertes Fixed-/Semantic-Profil, PCM-Versand, erster
  Audiopaket-Eingang und Übergabe an den simulierten Player.
- Sprachunterbrechung im Realtime-Dienst: Ausgabe stoppen, auf Eingang wechseln
  und verspätete Pakete der alten Antwort verwerfen.
- Verweigerte Budget-Mikrofonberechtigung und fehlgeschlagener nativer
  Realtime-Capture-Start: kein fälschlich bereites Gespräch.

Der Prüflauf verwirft außerdem eine absichtlich wieder eingeführte zusätzliche
800-ms-Wartezeit. Das ist eine Prüfung der Fehlererkennung, keine weitere
Produktänderung.

In der virtuellen Uhr entstehen zwischen abgeschlossenem Segment und Budget-
Commit sowie zwischen erstem Realtime-Audiopaket und Enqueue keine zusätzlichen
Warteintervalle (Median/p95 jeweils 0 virtuelle ms, n=6 bzw. n=8). Diese Nullen
messen keine CPU-, Bridge- oder echte Antwortzeit. Die vier Budget-Stufen aus
dem einzelnen B5-Gerätebeispiel ergeben als eingespeiste Verzögerungen zusammen
4.095 ms; Recorder-Stopp und übriger CPU-Aufwand sind hier ausgeschlossen.
Die Wiederholung erzeugt keine neuen Gerätebeobachtungen.

Für Realtime wurden Paketverzögerungen von 250, 500, 1.000 und 2.000 ms sowie
60 ms Player-/Routenverzögerung vorgegeben. Bei 1.000 ms vorgegebenem Endpointing
ergeben sich folgerichtig 1.310–3.060 virtuelle ms bis zur Ausgabe-Schätzung.
Dies ist eine Sensitivitätsprüfung, keine Prognose der OpenAI-Geschwindigkeit.
Semantic bekommt bewusst denselben vorgegebenen Endzeitpunkt: Sein tatsächliches
Verhalten bei Denkpausen lässt sich ohne echten Server nicht prüfen. Daraus wird
keine Rangfolge der Profile und kein Wechsel des Standardmodus abgeleitet.

Der Mock bestätigt auch eine bestehende Produktgrenze: Budget gibt den Recorder
während der eigenen Sprachausgabe frei und unterstützt dann Tippen zum
Unterbrechen. Sprachliches Dazwischenreden kann dieser Pfad dabei nicht hören.
Der Realtime-Dienst behält den Eingangsweg und behandelt serverseitige
Sprachstart-Ereignisse als Unterbrechung.

Ausführen und optional einen Bericht schreiben:

```sh
pnpm run voice:latency-mock --output /absolute/path/to/mock-report.json
```

[Mock-Ergebnisse mit Annahmen und Quellhashes](evidence/voice-latency-mock-2026-10-28.json).

## Belegter Engpass

Budget verarbeitet Mikrofonblöcke mit Sherpa VAD, transkribiert den beendeten
Beitrag lokal, liest passende Erinnerungen, fordert eine Textantwort an und lädt
anschließend die Sprachausgabe. Bis B5 wartete diese zusätzlich auf die vollständige
WAV-Datei. Der neue iOS-Pfad beginnt nach den ersten vollständigen PCM-Samples;
Transkription und vollständige Textantwort bleiben zunächst davor geschaltet.
Der PCM-Player mit 450-ms-Chunks gehört nicht zu diesem Pfad. Auch der normale
Realtime-PCM-Modus verwendet inzwischen einen anderen, nativen Player.

`vad-service.ts` konfiguriert `minSilenceDuration: 1.0`. Der tatsächlich installierte
iOS-Wrapper von Sherpa ONNX 1.13.0 liefert abgeschlossene Segmente in `segments`.
Die bisherige Budget-Logik ignorierte diese Abschlussinformation und zählte nach
`isSpeechDetected: false` ein weiteres 800-ms-Stillefenster. Der neue Pfad beginnt
nach einem abgeschlossenen Segment unmittelbar mit der Verarbeitung. Ein Block
mit erneut erkannter Sprache hält den Beitrag offen. Fehlt eine Segmentmeldung,
bleibt der bisherige Rückfall erhalten. Die native VAD-Konfiguration wurde nicht
verkürzt.

Der Regressionstest war vor der Korrektur rot: Nach dem abgeschlossenen Segment
gab es noch keinen Transkriptionsaufruf (`0 !== 1`). Er besteht im aktuellen Stand,
einschließlich erneut erkannter Sprache im selben Block und fehlender vorheriger
Spracherkennung. Das bestätigt den Kontrollfluss, keine echte Sprachantwortlatenz.

## Auf dem iPhone bestätigter Recorder-Fehler

Der Diagnosebuild B3 lieferte reale Mikrofonblöcke von 900–1.100 ms. VAD-Ergebnisse
und ein abgeschlossener lokaler Transkriptionsaufruf sind vorhanden. Damit ist
„kein Mikrofoneingang“ als allgemeine Erklärung widerlegt. Eine erfolgreiche
gesprochene Antwort wurde weiterhin nicht bestätigt. Während des automatischen
Kontrollversuchs wurde die App vor dem Antwortbeginn inaktiv und brach den
Dialog ab. Die Ursache dieses Zustandswechsels ist noch nicht belegt.

B4 protokollierte zusätzlich das tatsächliche native Recorder-Profil:
**100 ms angefordert, 1.000 ms übernommen**. `JavaScriptValue.getAny()` in der
installierten Expo-JSI-Version liefert Zahlen als Swift `Double`.
`RecordingSettings.fromDictionary` der AudioStudio-Bibliothek verwendete dagegen
`as? Int` für `interval`; dieser Cast liefert bei einem Swift-Double `nil`.
Der Recorder fällt dann auf seinen Standard von einer Sekunde zurück.

Der tatsächliche Parserausdruck wurde auf dem Mac in Swift mit Double-, Int-,
NSNumber- und fehlenden Eingaben getestet: vor der Korrektur rot, danach grün.
Der persistierte Patch `patches/@siteed__audio-studio@3.2.1.patch` konvertiert
dieses Feld über `NSNumber.intValue`. Workspace-Konfiguration und Lockfile
registrieren den Patch; die Bibliotheksversion bleibt 3.2.1. CocoaPods wurde auf
den neuen Paketpfad aktualisiert. Die Kompilierung des gepatchten nativen Parsers
ist im Buildlog nachgewiesen. B5 bestätigt auf dem physischen iPhone danach
100 ms als natives Intervall und beobachtete Blöcke von 100–200 ms.

Die Probe enthält ausschließlich Pegel- und Laufzeitmetadaten:
[iPhone-Eingang und natives Intervall](evidence/budget-input-probe-2026-10-28.json).
Die abgespielte Frage war synthetisch. Eine kontrollierte Reichweite zwischen
Mac-Lautsprecher und iPhone sowie eine externe akustische Zeitreferenz fehlen.
Die neuen Pegelwerte werden nicht als exakte Sprachgrenzen ausgegeben.


B5 lieferte außerdem den ersten vollständigen internen `playing`-Messpunkt.
Vom abgebildeten VAD-Segmentende bis zum Callback waren es 4.264 ms; vom
abgeschlossenen Segment bis zum Commit 3,962 ms. Die Verarbeitung nach Commit
beanspruchte 4.154 ms: lokale Transkription 583 ms, Erinnerungssuche 49 ms,
Textantwort 1.780 ms und Vorbereitung der Sprachausgabe 1.683 ms. Damit liegt
der größte verbleibende Anteil in den nacheinander ausgeführten Cloud-Schritten.
Bei diesem einzelnen Beispiel sind Median und p95 jeweils derselbe Wert;
es ist keine belastbare Verteilung. Der interne Callback bestätigt noch keine
vom Nutzer gehörte Antwort und keine sichtbare oder physische Reaktion.

Zwölf einmal pro Sekunde protokollierte Stichproben ergeben für die VAD-Laufzeit
Median 3,218 ms und p95 7,397 ms. Diese Auswahl ist keine vollständige
Blockverteilung und liegt beim p95 über dem Arbeitsziel von 5 ms.
Rohdaten: [B5-Geräteprobe](evidence/voice-latency-device-B5-2026-10-28.json).

## Native Wiedergabe eines kontrollierten Audiosignals auf dem Mac

Das vorhandene Silero-Modell wurde mit derselben Sherpa-Version und den vier oben genannten
Schwellen-, Stille-, Mindestsprach- und Fensterparametern ausgeführt. Die maximale
Segmentdauer wurde in der damaligen Probe nicht als Parameter dokumentiert;
daraus wird keine vollständige Gleichheit mit dem damaligen iOS-Profil abgeleitet. Zwei mit macOS Anna erzeugte deutsche Audiosignale
enthielten eine kurze Frage bzw. einen Beitrag mit einer inneren Pause von rund
900 ms. Eingabeblöcke waren 20 ms bei 16 kHz. Der zweite Beitrag blieb ein Segment.

| Größe | Bisherige Abschlussregel | Abgeschlossenes Segment verwenden |
| --- | ---: | ---: |
| Ende des synthetischen Audios bis Commit, Median | 1.797 ms | 1.017 ms |
| Ende des synthetischen Audios bis Commit, p95 | 1.862 ms | 1.082 ms |
| Entfernte zusätzliche Wartezeit je Beispiel | — | 780 ms |

Hier bedeuten Median und p95 lediglich die Beschreibung von **zwei Beispielen**;
der p95 entspricht ihrem Maximum. Die Commit-Zeit wurde aus den tatsächlich
gemessenen VAD-Ausgaben und den Sample-Zählregeln wiedergegeben. Es sind keine
iPhone-, Netzwerk-, Lautsprecher- oder Bewegungsmessungen. Der akustische Bezug
ist eine PCM-Energieschwelle von 100/32768, keine menschliche Sprachannotation.

Die Ausführung des VAD pro Block lag auf dem Mac im Median bei 0,098 bzw.
0,103 ms und beim p95 bei 0,691 bzw. 0,590 ms. Das belegt, dass der Rechenschritt
hier bereits deutlich unter einer Millisekunde liegt. Die Werte übertragen sich
nicht automatisch auf das iPhone.

Rohdaten und Modell-/Audio-Hashes:
[native VAD-Ausgaben](evidence/budget-endpoint-native-replay-2026-10-28.json).
Die erzeugten WAV-Dateien und die isolierte Python-Umgebung liegen unter
`/private/tmp/looi-latency-2026-10-28/`; sie enthalten ausschließlich die
synthetischen Testbeiträge.

## Gerätemessung

Ein signierter iPhone-Release-Build mit den neuen Messpunkten wurde erfolgreich
gebaut und seine Signatur geprüft. Die Pakete A/B sollten den schnellen Commit
bei abgeschlossenem Segment isoliert vergleichen. Bei der späteren Prüfung des
Realtime-Testpakets zeigte sich jedoch: Expo 56 `export:embed` reicht in seinem
direkten Bundlepfad die Option `--config` nicht an Metro weiter. Der vorgesehene
Transformer für den eingefrorenen Quellstand und die Variante wurde deshalb
nicht verwendet. Die frühere Einordnung als kontrolliertes A/B-Paar ist
zurückgezogen; daraus wird keine vergleichende Gerätewirkung abgeleitet.
Die einzelnen nativen Recorder- und Laufzeitbeobachtungen bleiben davon getrennt.

Quellstand und Bundle-Hashes stehen in
[den Paketmetadaten](evidence/voice-latency-device-builds-2026-10-28.json).
A wurde nach einem abgebrochenen WLAN-Versuch erfolgreich als Update auf dem
physischen iPhone installiert. Der Nutzer meldete anschließend keine Reaktion
auf Sprache und scheinbar wirkungslose Berührungen. Diese Runde ist keine
gültige Latenzreihe. Die aktuelle Gerätediagnose zeigt eintreffende Tap-Retries,
weiter laufende PCM-Erfassung und Robotermeldungen. Der Prozess lief; eine
pauschale Behauptung eines eingefrorenen JavaScript-Threads wäre nicht belegt.

Der tatsächliche Startblocker: `runFreshLaunchAutoListen` schickte auch Budget
durch die für den Realtime-Recorderwechsel bestimmte Stabilitätsprüfung. Die
Gerätedaten zeigen etwa 964–972 ms bis zum ersten PCM-Ereignis nach Start und
spätere PCM-Alter über der geforderten Grenze von 250 ms. Beide Versuche wurden
deshalb abgewiesen, bevor Budget starten konnte. Rohbelege:
[fehlgeschlagener Gerätestart](evidence/budget-entry-device-failure-2026-10-28.json).

Der Startpfad verwendet die Prüfung nun ausschließlich für echte Realtime-Modi.
Budget behält seine eigene Berechtigungs-, VAD- und Capture-Vorbereitung.
Ein Test des tatsächlichen Eintrittsmethodenkörpers reproduzierte den Budget-
Fehler vor der Korrektur und besteht danach für Budget, beide Realtime-Modi und
Classic. Die Realtime-Barriere wurde nicht gelockert.

A2/B2 wurden nach der Startkorrektur neu gebündelt; auch für sie gilt die
oben beschriebene Einschränkung der Exportkonfiguration. A2 ist installiert und sein Start auf dem physischen iPhone wurde
bestätigt. Der Nutzer hat die zunächst positiv beantwortete Probe ausdrücklich korrigiert:
Die App habe auf dem physischen iPhone noch nie zuverlässig geantwortet. A2 ist
deshalb ebenfalls keine gültige Messreihe. B2 wurde nicht für einen belastbaren
Vergleich verwendet. Installation und
Prozessstart beweisen noch keinen funktionierenden Sprachdialog.

Device Hub verweigert die Bildschirmfreigabe des physischen iPhones bei aktivem
Mikrofon bzw. aktiver Kamera. Deshalb wurde die geschilderte Gesichtsanzeige
bisher nicht als live visuell verifiziert ausgegeben.

Budget erfasst VAD-Warteschlange und VAD-Laufzeit, Commit, Freigabe des Mikrofons,
Transkription, Erinnerungssuche, Textantwort und ersten `playing`-Callback.
Das VAD-Segmentende wird auf den Empfangszeitpunkt des passenden Audioblocks
abgebildet. Dieser Bezug enthält weder die native Erfassungs- noch die
Bridge-Verzögerung. Ein `playing`-Callback ist kein extern gemessener Tonbeginn.

Realtime PCM erfasst zusätzlich Zeitstempel der nativen Mikrofonblöcke,
Zustellung an JavaScript, Verarbeitung bis zum Versand, Serverereignisse, ersten
Audiopaket-Empfang, Übergabe an den Player und einen Render-/Routen-Schätzwert.
Alle übergreifenden PCM-Differenzen verwenden dieselbe native Host-Uhr;
JavaScript- und native Uhren werden nicht voneinander subtrahiert. Alte Sitzungs-
und Wiedergabe-Callbacks werden ausgeschlossen. Es werden keine Audiodaten oder
Transkripte in die neuen Latenzberichte übernommen.

Ein unabhängiger Vergleich über die Realtime-API vom Mac musste nach
`invalid_api_key` beendet werden. Daraus gibt es keine gültige Latenzmessung.
Der Schlüssel auf dem iPhone wird nicht ausgelesen oder ersetzt.

## Kurzer Realtime-Vergleich

Der Nutzer hat den kurzen Vergleich einschließlich direkter Übertragung des
Mikrofon-Audios an OpenAI ausdrücklich erlaubt. Der erste Versuch blieb wegen
der oben beschriebenen Exportkonfiguration im Budget-Modus und ging vor der
synthetischen Frage in den Hintergrund. Er wird nicht als Realtime-Messung gewertet.

Die korrigierten Pakete verwenden `EXPO_OVERRIDE_METRO_CONFIG` und einen neu
eingefrorenen Stand von 236 lokalen Quelldateien. Moduswechsel und automatische
Beendigung nach 35 Sekunden wurden im eingebetteten Bundle nachgewiesen.
Das korrigierte Fixed-Paket wurde installiert. iOS verweigerte seinen Start
jedoch ausdrücklich mit `FBSOpenApplicationErrorDomain` 7, `Locked`.
Es gibt deshalb **keinen gültigen Realtime-Latenzwert** und keine belegte
Überlegenheit eines Modus. Der Nutzer wurde um erneutes Entsperren gebeten.
Das reguläre B5-Paket ohne erzwungenen Testmodus ist vorbereitet und signiert.
Seine Rückinstallation scheiterte zweimal nach Verlust der WLAN-Verbindung
(CoreDevice 4000, anschließend 4016). Das Gerät wird als `unavailable` gemeldet.
Der zuletzt beobachtete gespeicherte Modus ist Budget; das installierte,
korrigierte Testpaket konnte noch nicht starten. Diese Rückinstallation war zu
diesem Zeitpunkt offen. Sie wurde inzwischen durch die nachfolgend belegte
Installation des regulären B7 abgeschlossen; eine Realtime-Messreihe entstand
dadurch weiterhin nicht.

[Status des Gerätevergleichs](evidence/voice-latency-realtime-comparison-2026-10-28.json).

## Zwischenstand B7 und Anforderungsabgleich

B7 ist als signiertes iPhone-Paket mit Hermes-Bundle vorbereitet. Es verwendet
B6s unveränderte native Audioimplementierung und Assets; die nativen
Instruktionsabschnitte stimmen per Hash überein. Hinzu kommen die explizite
Zwanzig-Sekunden-VAD-Grenze und die getrennten nativen Routen-Laufzeitfelder.
Probe-Endpunkt, Dummy-Schlüssel und erzwungene Benchmark-Modi sind im Paket
nicht enthalten. Das Paket wurde inzwischen über die wieder verfügbare
WLAN-Verbindung auf dem physischen iPhone installiert und erfolgreich gestartet.
Die unten beschriebene frühe Eingangsreaktion entstand danach und ist **nicht
in B7 enthalten**. Für sie wurden Quellcode, Runtime-Mocks und die tatsächliche
Browser-Gesichtskomponente geprüft. Die neueren B8/B9 enthalten sie inzwischen
auch als regulär signierte, installierte Gerätepakete.

[Build B7 und Validierungsgrenzen](evidence/voice-latency-device-B7-2026-10-28.json).
Lokales Paket: `/private/tmp/looi-latency-2026-10-28/B7.app`.

| Anforderung des Ziels | Aktuell tragfähige Evidenz | Abnahme |
| --- | --- | --- |
| Aktuellen Budget-Pfad vermessen | Echte Recorder-Profile und einzelne interne Stufen auf dem iPhone; kein annotiertes Sprachende | Teilweise |
| Lokal kontrollierbare Zusatzwartezeit entfernen | Native Intervallkorrektur auf dem iPhone, Commit-Regel per Replay, Ausgabe vor EOF mit echter iOS-Simulator-Engine; B8-Tipp-Aussetzer gemessen, gezielte B9-Korrektur installiert | Implementiert, Wirkung auf volle iPhone-Antwort offen |
| Getrennte Latenzziele begründen | Nachfolgende Tabelle; keine Zielwerte als erreicht ausgegeben | Dokumentiert |
| Erste sichtbare Aufmerksamkeit ab echtem Sprachbeginn | Frühe Eingangsreaktion in B9 installiert, Dienst-Mocks und Browserkomponente geprüft; kein Messbeleg für das 100-ms-Ziel | Implementiert, Geräteabnahme offen |
| Ersten gesprochenen Beginn ab echtem Sprachende messen | B5 enthält Commit-/Segment-Schätzwerte; Simulator beginnt erst am HTTP-Request | Offen |
| Vergleichbare Reihen auf iPhone mit LOOI, Median und p95 | Keine gültige Antwort-A/B-Reihe; frühere Paketannahme zurückgezogen; nur wenige einzelne interne Messpunkte | Offen |
| Denkpausen und Unterbrechen prüfen | Drei native synthetische VAD-Verläufe, reale Dienst-Mocks, nativer Ausgabe-Abbruch im Simulator; keine menschliche Gerätereihenfolge | Teilweise |
| Echte sichtbare, hörbare und physische Reaktion belegen | Keine externe Aufnahme und kein Bewegungs-Onset-Beleg verfügbar | Offen |
| Regulären Audio-Build auf das iPhone bringen und vorherigen Testmodus beseitigen | B9 installiert und gestartet; Budget aus Gerätediagnose bestätigt, keine Testmodus-Einschübe | Erledigt |

Das vollständige Ziel ist damit nicht abgeschlossen. Die Mock-Freigabe erlaubt
die Offline-Arbeit, ersetzt aber keine der ausdrücklich getrennt ausgewiesenen
Geräteeigenschaften.

### Nachgewiesene Rückinstallation auf das physische iPhone

Die App-Liste zeigte zunächst exakt die Installationsadresse des früheren
Fixed-Testpakets. Die erneute Signaturprüfung und der B7-Bundle-Hash stimmen
mit dem vorbereiteten Paket überein. `devicectl` bestätigte anschließend sowohl
die Installation des regulären B7 als auch dessen Start. Eine zweite App-Liste
zeigte `B7.app`; das Protokoll meldete `conversation-mode-sync: budget`.
Die zuvor offene Rückinstallation ist damit erledigt.

Der neue Start begann um 20:00:58.503 UTC. Der Feeder meldete um 20:01:00.146
UTC angefordert/gemeldet jeweils 100 ms. Nach rund 1,96 Sekunden ab Bootstrap
wurde die App inaktiv und ging anschließend in den Hintergrund. Budget und
Recorder stoppten über die bestehenden Lebenszyklusregeln. Der Grund für den
Vordergrundverlust ist aus diesen Ereignissen nicht bekannt. Es lag kein
Budget-Audioverarbeitungsprofil und keine vollständige Antwort in diesem kurzen
Fenster vor. Aus einem erfolgreichen App-Start wird deshalb kein Hör- oder
Antworterfolg abgeleitet. Median/p95 einer Antwortmessreihe bleiben leer.

[Installations- und Startbeleg B7](evidence/voice-latency-device-B7-startup-2026-10-28.json).

## Zielwerte für die nächste Auswertung

Diese Werte sind Arbeitsziele, noch keine nachgewiesenen Produkteigenschaften:

| Messpunkt | Ziel | Begründung und offener Nachweis |
| --- | --- | --- |
| Lokale Verarbeitung eines 20-ms-Mikrofonblocks | p95 höchstens 5 ms | Innerhalb eines Audioblocks bleiben; auf dem iPhone zu messen |
| Abgeschlossenes natives Segment bis Commit | Höchstens ein Audioblock | Kein zusätzliches Stillefenster oder weiterer Netzzugriff |
| Erste sichtbare Aufmerksamkeit ab tatsächlichem Sprachbeginn | p95 höchstens 100 ms | Früher lokaler Eingangsakzent implementiert; tatsächlicher Sprachbeginn und sichtbare Pixel ungeprüft. Budget-Blöcke von 100–200 ms begrenzen den derzeitigen Weg weiterhin. |
| Erste gesprochene Budget-Antwort ab tatsächlichem Sprachende | Median höchstens 2 s, p95 höchstens 3 s | Das bestehende VAD-Stillefenster beansprucht bereits etwa 1 s; verbleibende Zeit muss an Transkription, Text und Spracherzeugung gemessen werden |

Für hörbaren Beginn, sichtbare Reaktion und echte Bewegung ist eine externe
Aufnahme erforderlich. Der Nutzer kann aktuell nur die internen Gerätemessungen
durchführen. Die externe Abnahme bleibt deshalb offen; sie wird nicht durch
interne Schätzwerte ersetzt.
Nach der ersten Gerätemessung werden weitere Eingriffe anhand des größten
gemessenen Anteils ausgewählt. Ein schnelleres Ende darf keine schlechtere
Behandlung von Denkpausen oder Unterbrechungen verdecken.

## Prüfungen und Wiederholung

`pnpm run voice:latency-test` prüft Uhren, fehlende Messwerte, veraltete Sitzungen,
Echo-Ausschluss, Median/p95, Exportformate und das Entfernen privater Texte aus
dem Bericht. Der Budget-Runtime-Test prüft den tatsächlichen Dienst gegen
ersetzte Geräte-/Netzwerkschnittstellen. Realtime-Sitzungstrennung,
Gesprächswechsel, Referenzkorrektur und Companion-Toolgrenzen bestehen ebenfalls.

Die vollständigen `ios:check`-Läufe für die eingefrorenen B8- und B9-Quellstände
bestehen. Zwischenzeitliche Abbrüche lagen an fehlenden Store-Aktionen in
Test-Mocks und dem Laden nativer Expo-Schnittstellen in einem Node-Test der
Sprachvorschau. Die betreffenden Test-Grenzen sind ergänzt. Der frühere Fehler
im Deutsch-Integrationstest tritt in diesen vollständigen Läufen ebenfalls
nicht mehr auf. Ein grüner Repository-Test ersetzt weiterhin keine bestätigte
gesprochene Antwort auf dem iPhone.

Einen exportierten Diagnosebericht oder eine Kopie der Diagnose-MMKV auswerten:

```sh
node scripts/voice-latency-report.mjs \
  --input /absolute/path/to/diagnostics \
  --since 2026-10-28T00:00:00Z --variant A \
  --output /absolute/path/to/latency-A.json
```

Der Beginn muss auf die tatsächliche Messrunde begrenzt werden. Fehlende
Endreferenzen zählen nicht als Latenz null. Für einen API-Sprachvergleich gibt
es `scripts/voice-latency-replay.mjs`; `--live` ist ausdrücklich erforderlich,
die Zahl der Versuche ist auf zwölf begrenzt. Dieser Vergleich ersetzt keine
Gerätemessung.

Die Abgrenzung von fester Stille und semantischem Beitragsende entspricht der
[OpenAI-VAD-Dokumentation](https://developers.openai.com/api/docs/guides/realtime-vad).
Eine Änderung des Realtime-Standardprofils wird daraus ohne Vergleich nicht
abgeleitet.

## Frühe neutrale Eingangsreaktion im Mock

Der neue `InputAttentionDetector` arbeitet vor der Budget-VAD-Warteschlange und
vor dem Echtzeit-Uplink. Mindestens 40 ms ausreichend starkes Eingangssignal
können einmal pro Hördurchgang den vorhandenen neutralen `listening`-Ausdruck
anfordern. Es gibt keinen zweiten Recorder, Netzzugriff oder Motorbefehl.
`isUserSpeaking`, Texte, Erinnerungen und die Satzende-Erkennung bleiben davon
unabhängig. Die bereits vorhandene Reaktion auf kurze Pausen in längeren
Beiträgen behält ihre eigenen strengeren Voraussetzungen.

Das Signal ist Energie, keine Sprachklassifikation. Stille und einzelne starke
Impulse werden verworfen; gleichmäßige Umgebungsgeräusche können weiterhin
qualifizieren. Die Pose bedeutet deshalb weder Zustimmung noch erkannte
menschliche Sprache. Ihre Schwelle ist eine noch am realen Gerät zu prüfende
Heuristik. Ein Ausdruck dauert höchstens 420 ms, mit mindestens einer Sekunde
Abstand zwischen Anforderungen. Unzulässige Frame-Dauern, gebündelte oder
rückläufige Zustellungen und bei vorhandener nativer Uhr mehr als 100 ms alte
Frames lösen ihn nicht aus. Beim Budget-Feeder bleibt das Alter vor JS-Empfang
unbekannt; diese Grenze wird nicht als geprüft ausgegeben.

Sprache, Verarbeitung, andere Gesichtsausdrücke und Props besitzen weiterhin
Vorrang. Spiele, offene Rückfragen, Korrekturen, Schlaf, Hintergrund, Routenverlust,
Gesichtskontakt und STOP verwerfen den Akzent. Unterdrückte oder abgelaufene
Signale können später nicht wiederkehren. Reduzierte Bewegung zeigt dieselbe
neutrale Augenpose statisch. Der bestehende Soft-Glass-Renderer und seine
Materialien wurden nicht verändert.

`input-attention.test.mjs` prüft die tatsächlichen Budget-/PCM-Dienste mit dem
echten Gesprächsspeicher und ersetzten Geräte-/Netzgrenzen. Budget fordert die
Pose bereits vor dem ersten VAD-Aufruf an, während dessen Ergebnis absichtlich
zurückgehalten wird. PCM benötigt kein Serverereignis „speech_started“.
`robot-face-accessibility.test.mjs` prüft die tatsächliche Komponente einschließlich
Ablauf, Vorrang, Hintergrund und statischer Pose. Diese Tests liefern keinen
Median oder p95 für den Weg ab Mikrofon beziehungsweise bis zum Display.

Für spätere Gerätereihen zeichnet die Komponente separat JS-Empfang →
Anforderung → React-Effekt auf. Der Diagnoseeintrag wird verzögert geschrieben.
`voice-latency-report.mjs` hält Budget und PCM getrennt; fehlende Werte bleiben
fehlend. Ein React-Effekt ist kein Beleg für dargestellte Pixel. Das 100-ms-Ziel
wird durch diese interne Messung weder ersetzt noch als erreicht ausgegeben.

Die Browserprobe verwendet `RobotFace`, `GlassFace`, den echten Gesprächsspeicher
und den Detektor. Geräte-, Verhaltens- und Speicherschnittstellen sind ersetzt.
390 × 844 px: neutraler Eingang, Verarbeitung als Unterbrechung und Spielvorrang
visuell geprüft, keine Warnungen oder Fehler in der Browserkonsole. Eine weitere
Probe skaliert ausschließlich im Review die vorhandenen Übergänge und die
Anzeigezeit auf 10 % Tempo; 85 Bildbeobachtungen über etwa 5,7 s decken An- und
Rückkehrbewegung ab. Dies ist eine Oberflächenprobe, keine native Geräteabnahme.

Prüfstand und Hashes: [Eingangsreaktion](evidence/voice-input-attention-mock-2026-10-28.json).
Die lokale Probe liegt unter `output/input-attention-review-2026-10-28/`.


## Ausstehende Geräteabnahme

Eine erneute schreibgeschützte Geräteabfrage bestätigt weiterhin die reguläre
B9-Installation. Der eingefrorene Produktionsquellstand entspricht unverändert
dem geprüften Build. Die frisch kopierte Diagnose endet wie zuvor am
28. Oktober um 20:36:09.642 UTC: keine neuen Einträge, Latenzwerte oder
kontrollierten Sprachversuche. Das Gerät wurde dafür nicht erneut gestartet
und kein Gesprächsmodus verändert.

Der fehlende Nachweis tatsächlicher Sprachgrenzen, sichtbarer/hörbarer und
gegebenenfalls physischer Reaktionen sowie vergleichbarer Antwort-Median-/p95-
Werte blieb über drei aufeinanderfolgende Zielrunden offen. In den vorigen
Runden waren noch unabhängige Verbesserungen und Installationen möglich; diese
sind nun erledigt und geprüft. Für die verbleibende Abnahme ist ein verfügbarer
realer Gesprächstest erforderlich. Das Ziel wird deshalb als blockiert und
weiterhin nicht als abgeschlossen geführt. B9 bleibt regulär installiert.

[Abnahme- und Blockerprüfung](evidence/voice-latency-acceptance-audit-2026-10-28.json).
