# Mimik in Gespräch und Berührung

Stand: 28. Oktober 2026. Umsetzung der vier ausdrücklich freigegebenen
Erweiterungen in der Reihenfolge Korrektur, Sprechabschnitte, freundliche
Berührung und Zahlenspiel. Die vorhandenen Farben, Gesichtsvarianten und die
größere Augenfläche bleiben die gestalterische Grundlage.

## 1. Korrektur sichtbar machen

`behavior-face-feedback.ts` verfolgt die lokal bestätigte Korrektur anhand von
Sitzung, Referenzversion und Turn. Ein kurzer offener, asymmetrischer Blick
verwirft den vorherigen Objektblick und kehrt zur Person zurück. Er erteilt
keinen Kopf- oder Fahrbefehl. Die kleine Bestätigung verlangt eine ausdrückliche
Bezugsbestätigung im unmittelbar folgenden Turn innerhalb von 30 Sekunden,
beispielsweise „Genau die meine ich“. Fragen, ein einfaches Ja, ein Themenwechsel
und ausbleibende Antworten gelten nicht als bestätigtes Verstehen. Entsprechende
eindeutige Formulierungen werden auch auf Englisch, Russisch und Ukrainisch
erkannt.

Die fragende Phase endet nach 950 ms, die bestätigende nach 650 ms. Beide
verfallen bei Sprache, Schlaf, STOP und geänderten Einstellungen. Die Zeiten
sind bewusst gewählte Ausgangswerte, keine gemessenen menschlichen Präferenzen.

## 2. Gesprochene Abschnitte statt vorauseilendem Text

`speech-expression.ts` besitzt eine begrenzte, antwortgebundene Zuordnung.
Realtime PCM verarbeitet ausschließlich das PCM, das auch zur Wiedergabe geht,
über einen eigenen freien Vosk-Decoder. Dieser verwendet nur ein bereits
geladenes Modell derselben Antwortsprache. Es gibt keinen zusätzlichen
Mikrofonbesitz, keine Aufnahme und keinen neuen Modelldownload. Die Erkennung
läuft getrennt von der Befehls-/STOP-Erkennung; volle Warteschlangen beenden
die optionale Mimikzuordnung, ohne die Stimme aufzuhalten.

Final erkannte Wörter müssen zum aktuellen finalen Antworttranskript passen.
Wortzeiten und Konfidenzen werden geprüft. Ein Abschnitt wird erst hinter dem
tatsächlichen nativen Wiedergabekopf sichtbar. Partielle Erkennung darf einen
veralteten Ausdruck beim Beginn der nächsten Passage entfernen, aber keine neue
positive Reaktion freigeben. Pro Antwort gibt es höchstens zwei semantische
Aktualisierungen. Abbruch, Fehler, neue Antwort und tatsächliches Wiedergabeende
räumen die Zuordnung sofort auf; verspätete Erkennung wird nicht nachgespielt.

Budget-Sprachausgabe erzeugt höchstens drei aufeinanderfolgende Satzclips; der
Resttext bleibt im letzten Clip vollständig erhalten. Dezimalzahlen,
Tausendertrennzeichen und numerische Adressen bleiben dabei zusammen, statt
zusätzliche Pausen oder Leerzeichen in den gesprochenen Wert einzufügen. Der
Text-Audio-Bezug
ist bekannt. Die ersten beiden Clips dürfen ihren Ausdruck ab dem tatsächlichen
Player-Start zeigen, mit Neutralisierung am Ende. Legacy WebRTC und der
stillgelegte Classic-TTS-Pfad bleiben mangels belastbarer Zuordnung neutral.
Auch ein fehlendes passendes lokales Modell oder unsichere Erkennung führt zu
neutraler Sprechmimik. Das ist keine wortgenaue Lippensynchronisation.

## 3. Freundliche Berührung

`face-stroke.ts` erkennt einen einzelnen bewussten Strich: 240–1600 ms,
44–220 logische Bildschirmpunkte und ein begrenzter, hinreichend ruhiger Pfad.
Ungültige Zeit-/Koordinatenwerte, Zeigerwechsel, Mehrfachtouch und Abbruch
verwerfen den Kontakt. Die Auswertung ist pro Kontakt idempotent, unabhängig
davon, ob React Native zuerst `onPress` oder `onTouchEnd` liefert.

`RobotFace` bietet dieselbe freundliche Aktion für Screenreader. Home prüft
Vordergrund, Fokus, Schlaf, Nutzerrede und aktuelle Steuereigentümer erneut.
Aktuelle Bewegung, Fahrsteuerung und Sprachausgabe können den Kontakt sofort
für den bisherigen STOP-/Unterbrechungspfad verbrauchen. Ein angenommener Strich
erzeugt ausschließlich 1100 ms zufriedene Bildschirmmimik. Er startet weder eine
Unterhaltung noch eine physische Geste. Normales Antippen und Aufwecken bleiben
erhalten. Reduzierte Bewegung bewahrt die Form bei entfallender Zusatzbewegung.

## 4. Erwartung und Ergebnis im bestehenden Zahlenspiel

`game-face-feedback.ts` erhält nur öffentliche Spielzustände, keine Geheimzahl.
Die identische Erwartungsmimik beginnt erst nach beobachtetem Sprechbeginn und
gehörtem Antwortende einer aktiven Runde. Sie endet spätestens nach 15 Sekunden.
Fehlversuche lösen keinen beschämenden oder lösungsverratenden Ausdruck aus.

Nur ein lokaler Zustand `won/correct` kann nach dem zugehörigen gehörten
Antwortende einen einmaligen Siegesakzent erzeugen. Nach 1100 ms gilt wieder
der normale Gesprächszustand. Ein neuer Turn und STOP verwerfen auch einen
noch nicht gezeigten Sieg. Die Rundensperre überlebt gewöhnliche Unterbrechungen;
ein neuer Spielbereich oder eine neue Sitzung darf wieder einen Sieg zeigen.
Der lokale Akzent verhindert eine zusätzliche unpassende Modell-Kopfgeste.

Beide Realtime-Transporte geben ihre Sprechflags und internen Antwortfelder
frei, bevor sie `assistant-end` veröffentlichen. Damit kann der lokale
Gesichtsausdruck die tatsächliche Übergabe übernehmen.

## Prüfung und Grenzen

Gezielte Tests führen die tatsächlichen Home-Callbacks und die React-Native-
Gesichtskomponente mit ersetzten nativen Laufzeitgrenzen aus. Weitere Tests prüfen
Reaktionsprioritäten, korrigierte Referenzen, echte lokale Spielzustände,
Wiedergabefortschritt, Wort-/Textabweichungen, verspätete Antworten und
Unterbrechungen. Native Vorschauen verwenden dieselbe `RobotFace`-Komponente
mit ausdrücklich synthetischen Zuständen; sie belegen keine echte Erkennungs-
oder Sprachmodellqualität.

Der vollständige iOS-Simulatorbuild vom 28. Oktober besteht unter
`output/expression-four-features-native-final-build.log`. `pnpm run ios:check`
ist einschließlich TypeScript und der neuen Gesichts-/Gesten-/Spieltests grün;
Log: `output/expression-four-features-final-ios-check.log`. Ein zusätzlicher
Regressionstest nach diesem Gesamtlauf prüft die neutrale Fortsetzung bei
abweichender partieller ASR; dieser und die Session-/Übergabetests bestehen.
Die ursprünglichen privaten Realtime-Finalizer werden im AST-Test tatsächlich
ausgeführt, um Sprechflags, Turn-Aufräumung und hörbares Antwortende in ihrer
Reihenfolge zu prüfen. Der unabhängige Abschlussreview hat nach den Korrekturen
keine offenen Befunde im geprüften Umfang.

Die native iPad-Probe zeigt fragende Korrektur, Bestätigung, besorgte/fröhliche
Sprachform, Erwartung und Siegesfreude ohne abgeschnittene Augen. Die native
Accessibility-Aktion „Streicheln“ löst dort die freundliche Mimik aus; sie wurde
nicht durch einen gewöhnlichen Fixture-Knopf ersetzt. Ein echter Wischkontakt
wurde im Simulator nicht manuell abgenommen. Seine Ereignisreihenfolgen und
Home-Prioritäten sind durch die oben genannten Komponententests geprüft.

Die iPhone-Probe lief nach einem Dev-Client-Verbindungsproblem als lokal
gebündelte, separat signierte Release-Kopie im eigenen Simulator. Sie zeigt
alle neuen Formen und die Rückkehr zur Bereitschaft, mit synthetischem Hörtext
und direkt aufgerufenem Petting-Callback. Die Kopie enthält die vorhandenen
nativen UI-Bibliotheken; sie ist kein Test der neuen nativen Output-Erkennung.
Die Produktionsquellen wurden für diesen Vorschauweg nicht verändert.

Lokale Bildnachweise: `output/expression-four-features-overview.png` und
`output/expression-iphone-offline-review/iphone-pose-review.png`. Die Aufnahmen
liegen in den zugehörigen Review-Ordnern. Der Avatar wurde dargestellt; der
Vollbild-Testhost erlaubt kein Größenurteil für seine tatsächliche Einbettung
im Onboarding oder DeviceShell.

Die iPad-Aufnahme wurde zusätzlich als zwölfsekündiger Ausschnitt auf zehn
Prozent Geschwindigkeit verlangsamt und anhand der extrahierten Bilder
geprüft: `output/expression-four-features-review/ipad-expression-10pct.mp4`
(120 Sekunden). Für reduzierte Bewegung ist der iPadOS-Schalter aktiviert und
`ReduceMotionEnabled=1` bestätigt; die native Korrekturansicht wurde in diesem
Zustand aufgenommen. Der Rückgabewert der React-Native-Accessibility-API wurde
nicht separat protokolliert. Deren Query-/Event-Rennen und die Darstellung bei
reduzierter Bewegung sind durch die Komponententests abgedeckt.

Android-Kompilation, Output-ASR-Trefferquote und Ressourcenbedarf auf dem
physischen Gerät sowie menschlich bewertete Natürlichkeit sind gesonderte,
hier nicht behauptete Nachweise. Es wurde kein physisches iPhone aktualisiert.
