# Keine Reaktion: Nullsignal vor der Spracherkennung

Der Nutzer meldete nach Installation der aktuellen regulären App erneut
„Gar keine Reaktion“. Auch im parallel ausdrücklich zur Abstimmung freigegebenen
Persönlichkeitschat wurde derselbe Fehler gemeldet. Die Aufnahme-Reparatur und
die Gerätebedienung liegen in diesem Chat; die Persönlichkeit bleibt bei ihrem
bisherigen Verantwortlichen.

## Befund und Hypothesen

Die neue Gerätediagnose enthält 37 Health-Fenster mit maxRms und Peak exakt 0.
Es gibt Audioblöcke, aber keine erkannte Sprache und keinen Antwortlauf.

| Hypothese | Falsifizierbare Vorhersage | Bisheriger Test |
| --- | --- | --- |
| Native Quelle oder System-Stummschaltung liefert Null | Rohsignal am Eingang ist bereits Null | D1 bestätigt Null direkt im nativen Input-Tap |
| Konvertierung oder Übergabe an JS setzt Signal auf Null | Native Rohenergie vorhanden, konvertierte bzw. JS-Energie Null | D1 widerspricht dieser Reihenfolge; bekannte Konverter- und Übergangsdaten bleiben nichtnull |
| Konkurrierender Audiobesitzer oder fehlerhafte Route | Unpassende native Route bzw. aktiver Mac-Zugriff auf iPhone-Mikrofon | D1: BuiltIn-Mikrofon, Record/Measurement, Engine läuft; Mac meldet iPhone-Mikrofon derzeit nicht laufend |

Ein aufgelistetes Continuity-Mikrofon allein belegt keine Benutzung. Die
schreibgeschützte CoreAudio-Prüfung meldet `runningSomewhere=0` für das iPhone
und 1 für das tatsächlich verwendete Yeti-Mikrofon.

## Eingrenzung D1

Ein begrenzter signierter Diagnosebuild ergänzt im nativen AudioStudio-Tap
numerische Roh- und Konvertierungspegel und liest Session-/Port-Metadaten.
Keine Audiodatei und keine Rohsamples werden protokolliert. Der JS-Poll ist
an das Recording gebunden; normale Produktions-JS-Dateien wurden dafür nicht
geändert. Die temporäre Dependency-Quelle wurde nach dem Build wiederhergestellt.

Zwanzig native Messpunkte zeigen jeweils rawPeak=rawRms=0 und anschließend
convertedPeak=convertedRms=0, ohne ungültige Rohsamples. Die native Quelle ist
Float32, 48 kHz, 4800 Frames; konvertiert werden 16 kHz PCM16. iOS meldet
`MicrophoneBuiltIn`, verfügbare Eingabe, erteilte Berechtigung (`grnt`), InputGain
1 und eine laufende Engine in Record/Measurement. Dies beweist keine funktionsfähige
Mikrofonaufnahme, sondern lokalisiert das Nullsignal vor der Konvertierung.

Die tatsächlichen nativen Konverterfunktionen wurden separat mit bekannten
Sinusdaten bei 16/44,1/48 kHz und 512/1024/4800/8192 Frames auf macOS ausgeführt:
alle zwölf Fälle liefern nichtnull PCM16. Die unabhängig geprüfte tatsächliche
Delegate-/Feeder-Grenze erhält bekannte Int16-Werte und sowohl Array als auch
Float32Array. Keine dieser Offline-Prüfungen ersetzt ein natives iPhone-Signal.

[Einzelwerte D1](evidence/voice-zero-input-D1-2026-10-29.json).
Die Diagnosequellen, Konverterprobe und Build-/Installationsbelege liegen unter
`output/voice-zero-input-2026-10-29/`.

## Nächster Einzeltest

D2 ergänzt ausschließlich das Lesen der appweiten Input-Stummschaltung und der
VoiceProcessing-Mute-Zustände. Es ändert keine Mute-Einstellung. Apple beschreibt
[`AVAudioApplication.isInputMuted`](https://developer.apple.com/documentation/avfaudio/avaudioapplication/isinputmuted)
als appweiten Input-Mute-Zustand, getrennt von der Aufnahmeberechtigung.
Erst die Gerätewerte entscheiden über den nächsten Eingriff. Eine Ursache
oder erfolgreiche Reparatur wird bisher nicht behauptet.

D2 liefert 36 native Proben mit Rohsignal Null und zugleich
`AVAudioApplication.isInputMuted=false`; VoiceProcessing ist deaktiviert und
sein Mute-Zustand ebenfalls falsch. Eine appweite Stummschaltung ist damit
in diesem Versuch nicht belegt. [D2-Einzelwerte](evidence/voice-zero-input-D2-2026-10-29.json).

D3 ändert als einzigen Eingriffsparameter die Session-Kategorie von Record
auf PlayAndRecord im eingefrorenen Diagnosebundle. Measurement, Mikrofon,
Konvertierung und Budget-Pfad bleiben gleich. Das ist zunächst ein
Hypothesentest, keine freigegebene Produktionskorrektur.

## Ergebnis D3 und sauberer Zwischenstand

Auch PlayAndRecord/Measurement liefert in neun D3-Proben nur Null am
nativen Eingang; Mute bleibt falsch und das eingebaute Mikrofon verfügbar.
Eine Kategorie-Reparatur ist daher nicht belegt und wurde nicht in die
Produktionsquellen übernommen. [D3-Einzelwerte](evidence/voice-zero-input-D3-2026-10-29.json).

Die reguläre aktuelle App wurde wieder installiert. Die App-Liste bestätigt
dieselbe Installationsadresse wie der erfolgreiche Rückinstallationsbeleg.
Das reguläre Bundle enthält keinen Diagnosepoll, sein nativer Code keine
Probe-Felder. Die temporäre AudioStudio-Quelle entspricht wieder dem
ursprünglichen gepatchten Stand. Die App wurde nach Rückinstallation nicht
automatisch geöffnet, damit ein manueller Sprachmemos-Test frei bleibt.

Als nächste nötige Trennung wurde der Nutzer um eine kurze Aufnahme und
lokale Wiedergabe in Sprachmemos gebeten. Erst bei erfolgreichem Systemtest
wird der zweite vorhandene native PCM-Aufnahmeweg lokal geprüft. Dafür ist
ein noch nicht installierter 20-Sekunden-Probestarter ohne Cloud, Roboter
oder Audiodateien vorbereitet. Solange der Vergleich fehlt, bleibt die
Ursache offen; es wird kein Reparaturerfolg behauptet.

[Diagnose- und Aufräumbeleg](evidence/voice-zero-input-status-2026-10-29.json).
