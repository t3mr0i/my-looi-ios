# Native Objektverfolgung ohne Kamera prüfen

Stand: 26. Oktober 2026. Dieser Nachweis setzt den Offline-Prüfpfad des
[Phase-2-Briefs](lebendigkeit-phase-2-2030-2026-10-26.md) um. Die sichtbare
Geräteabnahme bleibt gesperrt; eine unabhängige native Wahrnehmungsprüfung
ist jedoch möglich. Es geht um den vorhandenen Tracker, nicht um eine neue
Objekterkennung oder ein neues Produktmerkmal.

## Tatsächlich ausgeführte Machbarkeitsprüfung

Ein temporärer Swift-Versuch erzeugte nichtpersönliche BGRA-Pixelbuffer mit
einem texturierten Ziel und führte `VNTrackObjectRequest` mit
`VNSequenceRequestHandler.perform(..., on: pixelBuffer, orientation: .up)` aus.
Apples Primärdokumentation beschreibt diese Sequenz-/Pixelbuffer-Schnittstelle
und ihre Verfügbarkeit auf macOS und iOS.
[Objektanfrage](https://developer.apple.com/documentation/vision/vntrackobjectrequest),
[Sequenzhandler](https://developer.apple.com/documentation/vision/vnsequencerequesthandler)

Auf diesem Mac mit macOS 26.6.2, Build 25G83, ergaben fünf erzeugte Frames
jeweils eine Vision-Beobachtung. Die Folge verwendete 320 × 240 Pixel, ein
92-Pixel-Ziel und eine Verschiebung von acht beziehungsweise drei Pixeln pro
Frame. Ein erster Versuch setzte nur CPU ein. Der Hauptprozess kompilierte
und führte anschließend eine Variante ohne diese Abweichung aus, mit Visions
Standard-Rechenkonfiguration. Beide lieferten Exit 0. Die zweite Folge hatte
Konfidenzwerte von ungefähr 0,954 bis 1,0; diese Werte sind keine kalibrierte
Wahrscheinlichkeit für Objektidentität.

Die temporären Quellen und Programme liegen unter
`/private/tmp/my-looi-vision-feasibility/`. Der Hauptprozess verwendete seine
bestehende Ausführungsumgebung ohne Änderung einer Sicherheits-/Gerätefreigabe.
Keine Kamera, kein API-Schlüssel, keine persönlichen Bilder und kein Download
wurden verwendet. Dies beweist die Framework-Machbarkeit mit diesem Eingang,
noch nicht den gesamten App-Pfad oder reale Trackingqualität.

## Schnittstelle vor der Umsetzung

Das Zielmodul ist eine kleine `LocalObjectTrackingSession` in einer eigenen
Swift-Datei unter `modules/local-face-attention/ios/`. Zwei tatsächliche Adapter
werden dieselbe Implementierung aufrufen: der vorhandene iOS-Kamerabesitzer und
ein macOS-Kommandozeilen-Harness mit erzeugten Pixelbuffern.

Die Schnittstelle soll nur ausdrückliches Starten mit ausgewählter Region und
erstem Frame sowie einen seriellen Schritt pro weiterem Frame anbieten. Ein
akzeptiertes Sample enthält normalisierte Region und Vision-Konfidenz. Ein
Fehler liefert einen begrenzten Grund; nach Verlust bleibt diese Sitzung
beendet, bis ausdrücklich eine neue Auswahl gestartet wird. Keine automatische
Suche, Wiederaufnahme oder semantische Identität wird hinzugefügt.

Hinter die Schnittstelle wandern die tatsächliche Vision-Anfrage, ihr
Sequenzhandler, Feedback der akzeptierten Beobachtung, Konfidenz- und
Koordinatenprüfung sowie die bestehende Kontinuitätsregel. Die bisherigen
Schwellenwerte, `.accurate`, `.up` und Standard-Rechenkonfiguration bleiben
erhalten. Kamerabesitz, Framespeicher, Frische, Größe, Orientierung, Frist,
Session-/Request-ID und Event-Versand bleiben im iOS-Adapter. Dessen externe
Bridge-Ergebnisse und Fehlergründe dürfen sich durch die Extraktion nicht ändern.

Die Schnittstelle konzentriert echte Zustands- und Frameworklogik statt nur
Aufrufe weiterzureichen. App und Prüfung müssen Vision-Details nicht mehr
jeweils kennen. Der Preis ist eine zusätzliche Quelldatei und das erneute
Einbinden über CocoaPods; iOS-Lifecycle und reale Kameraqualität werden durch
den neuen Harness ausdrücklich nicht abgenommen. Die Verarbeitung bleibt
seriell wie beim bestehenden Worker, ohne neue Parallelität oder zusätzliche
Frame-Verarbeitung. Laufzeiten auf dem Mac sind keine iPhone-Laufzeiten.

## Geplanter Prüfeingang und Ergebnisgrenze

Die erste kontrollierte Baseline verwendet prozedurale Ziele mit unabhängig
bekannter Geometrie: Translation, Größenänderung, ähnliche Nachbarregion,
teilweise/vollständige Verdeckung und Verlassen des Bildes. Berichtet werden
Überlappung und Zentrumsabweichung, akzeptierte/abgewiesene Samples, Verlustgrund,
falsche Bezüge auf den Distraktor und Laufzeit mit OS-/Vision-Revisionskontext.
Werte werden gemessen; vorab erfundene Qualitätsgrenzen oder allein aus diesen
Fixtures optimierte Standards wären kein Nachweis.

Damit lassen sich tatsächliche Fehler sichtbar machen. Natürliche Gegenstände,
Autofokus, Belichtung, Bewegungsunschärfe, reale Kamerabewegung, Energieverhalten
und verständlicher Blickbezug bleiben weitere, getrennte Eingänge. Ergebnisse
stehen im folgenden Abschnitt.

## Gemeinsamer Produktpfad und ausgeführte Messung

`LocalObjectTrackingSession.swift` ist jetzt der gemeinsame ausgeführte Tracker.
Der iOS-Adapter delegiert Start und Folgeframes an ihn. Der Helper hält die
akzeptierte Beobachtung und wird nach einem Fehler terminal; der Adapter hält
unverändert Kamerabesitz, Fristen, Frame-Lücke, Größe und Event-Versand.
Alle bisher öffentlich sichtbaren Startfehler werden weiter als
`tracking-failed` gemeldet; die Verlustgründe der Folgeframes bleiben erhalten.

`scripts/vision-object-tracking-probe.mjs` kompiliert genau diese Produktquelle
zusammen mit `scripts/native/vision-object-tracking-probe.swift`. Der tatsächliche
Lauf im Hauptprozess konnte Frames sammeln. Die eingeschränkte Ausführungsumgebung
eines Prüfagenten konnte dagegen kein internes Vision-Modell laden; ihr früherer
Lauf ergab keine Samples. Der Runner kennzeichnet einen solchen Lauf ausdrücklich
als nicht aussagekräftig und endet mit Code 2, statt einen Qualitätserfolg zu
melden. Es wurde für die Messung im Hauptprozess keine neue Freigabe eingerichtet.

Der [gespeicherte JSON-Bericht](evidence/native-tracking-probe-2026-10-26.json)
enthält jede Annotation und Beobachtung, Verlustgründe, Zeitwerte, OS-/Vision-
Revision sowie SHA-256-Hashes der tatsächlich kompilierten Produkt- und
Fixture-Quellen. Die folgenden Werte stammen aus diesem einen Lauf mit
Standard-Rechenkonfiguration und Vision-Revision 2. Seed-Frames sind hier
ausgeschlossen; die mittlere IoU zählt nur akzeptierte Folgeframes und darf
deshalb nicht allein als Gesamtqualität interpretiert werden.

| Erzeugte Szene | Akzeptierte Folgeframes | Mittlere IoU der akzeptierten Frames | Relevante Beobachtung |
|---|---:|---:|---|
| Translation | 5/5 | 0,893 | Der Tracker folgt in dieser einfachen Szene |
| Größenänderung | 5/5 | 0,891 | Region verändert sich mit dem Ziel |
| Teilweise Verdeckung | 5/5 | 0,827 | Akzeptierte Region trotz veränderter Erscheinung |
| Vollständige Verdeckung | 4/4 | 0,874 | Alle vier unsichtbaren Zielzustände werden weiter akzeptiert |
| Überlappender ähnlicher Distraktor | 6/6 | 0,681 | In fünf Frames liegt die größere Überlappung beim Distraktor |
| Verlassen des Bildes | 4/7 | 0,900 | Ab Folgeframe 5 `out_of_bounds`; spätere Schritte bleiben `session_ended` |

Das sind Gegenbeispiele zu einer Gleichsetzung von „Track akzeptiert“ mit
„Gegenstand aktuell sichtbar“. Hohe IoU bei vollständiger Verdeckung ist
besonders leicht misszuverstehen: Die synthetische Annotation kennt die latente
Zielposition, das Bild zeigt sie nicht. Der Distraktor ist absichtlich ähnlich
und überlappend; die Annotation beweist nicht, dass eine eindeutige Identität
aus diesen Pixeln überhaupt auflösbar wäre. Die Messung belegt weder einen
allgemeinen Fehleranteil noch eine kalibrierte Wahrscheinlichkeit.

Die bisherigen Konfidenz-/Kontinuitätsgrenzen wurden nach diesen Fixtures nicht
nachträglich passend gemacht. Der lokale Bezug bleibt ausdrücklich eine
Nutzerauswahl und keine erkannte Identität. Vor einem Anspruch verlässlicher
Verlusterkennung braucht es eine gesonderte Prüfung von Sichtbarkeit und
Erscheinungsstabilität auf getrennten Eingängen. Ein bloß höherer Grenzwert
würde den gezeigten Zielkonflikt noch nicht lösen.

### Grenze zwischen nativem Tracker und sichtbarem Produkt

Die Tabelle misst den gemeinsamen nativen Helper. Der vollständige App-Pfad
enthält zusätzlich die TypeScript-Policy mit einer strengeren Konfidenzgrenze
von 0,7 und eigenen Frische-/Kontinuitätsregeln. Deshalb folgt aus vier nativ
akzeptierten verdeckten Frames nicht, dass die App alle vier als Blickziel
verwendet: Der zweite verdeckte Frame hat Konfidenz 0,695 und wird dort
abgewiesen. Die sechs Distraktor-Frames liegen dagegen zwischen 0,747 und
0,967 und erfüllen auch die zusätzlichen geometrischen Regeln. Dieser
Unterschied muss im Nachweis erhalten bleiben.

Das wurde zusätzlich mit `scripts/object-attention-measured-policy.mjs`
ausgeführt. Der [gespeicherte Policy-Replay-Bericht](evidence/object-attention-measured-policy-2026-10-26.json)
enthält 38 Frames einschließlich Seeds aus denselben sechs Szenen, einen
Verweis auf den ursprünglichen Messbericht und Hashes der tatsächlich geladenen Policy-,
Helper- und Replay-Quellen. Explizite Auswahl und Aktivierung erfolgen über
die echten öffentlichen Policy-Methoden. Zwei synthetische monotone Uhren mit
120 ms pro Frame schaffen einen frischen, geordneten Eingang innerhalb des
Zeitfensters; das sind keine gemessenen Kamera-/Bridge-Zeitstempel.
Visions gemessene Aufrufdauer wird nicht als Aufnahmeabstand verwendet.

In diesem Replay akzeptiert die Policy einen der vier vollständig verdeckten
Folgeframes und endet beim zweiten mit `low-confidence`. Bei Translation,
Größenänderung und teilweiser Verdeckung akzeptiert sie jeweils fünf von fünf;
beim Distraktor alle sechs. Fünf dieser sechs nativen Regionen haben eine
größere Überlappung mit dem Distraktor. Der Bildaustritt endet beim fünften
Folgeframe mit `out_of_bounds`. Das Replay zeigt die zusätzliche Software-
Filterung unter diesen Eingangsbedingungen, keinen ausgeführten Kamerastream
und keine bessere Identitätserkennung. Erneut ausführbar:

```sh
node scripts/object-attention-measured-policy.mjs /private/tmp/looi-policy-replay.json
```

Apples Definition bezieht `confidence` auf die Genauigkeit einer Beobachtung;
eine Wahrscheinlichkeit für Sichtbarkeit oder dauerhafte Objektidentität
wird damit nicht zugesichert.
[Apple: confidence](https://developer.apple.com/documentation/vision/vnobservation/confidence)
Der vorhandene Modellkontext beachtet diese Grenze bereits: Er nennt eine
vorübergehende Nutzerauswahl und verbietet Schlüsse auf Identität, Aussehen,
metrische Position, Fortschritt oder Ergebnis. Die aktive Anzeige sagte
dagegen noch „Ausgewählter Gegenstand wird verfolgt“; ukrainische und russische
Verlustmeldungen behaupteten sogar, der Gegenstand sei nicht mehr sichtbar.

Der kleinste begründete Produktwechsel lautet daher: Aktiver Status und
Verlustmeldung beschreiben den **ausgewählten Bildbereich**. Das gilt für alle
vier vorhandenen Sprachen und ihre Accessibility-Beschriftung. Auswahl,
Verfolgungsfenster, Blickbewegung und Modellkontext bleiben gleich. Die
Korrektur ist kein Ersatz für die ausstehende Verdeckungs-/Distraktorabnahme.

| Option | Nutzen und Grenze | Unabhängiger Nachweis |
|---|---|---|
| Status präzisieren | Vermeidet eine bereits im aktuellen Pfad unbelegte Identitäts-/Sichtbarkeitsaussage; verbessert den Tracker selbst nicht | Tatsächlicher Textpfad einschließlich Verlustgrund und Accessibility, separat sichtbare Geräteprüfung |
| Konfidenzgrenze erhöhen | Könnte bestimmte verdeckte Frames verwerfen; die Distraktorwerte reichen bis 0,967, passende Fixtures wären keine Kalibrierung | Vorab festgelegter Vergleich auf getrennten annotierten Eingängen, einschließlich fälschlicher Verluste |
| Zusätzliche Erscheinungs-/Sichtbarkeitsprüfung | Könnte einen weiteren Hinweis liefern, aber auch richtige Tracks bei Licht-/Perspektivwechsel abbrechen | Sichtbarkeit und Zielidentität unabhängig annotieren, erst dann einen Kandidaten auf zurückgehaltenen Clips vergleichen |

Die Statuskorrektur ist umgesetzt. Produktionsgrenzen wurden nicht verändert.
Für die nächste Wahrnehmungsänderung bleibt der vorhandene Phase-2-Plan mit
getrennten kurzen Clips maßgeblich. Als Quellenvergleich wurde unter anderem
HOOT geprüft: Dort sind vollständige/teilweise Verdeckung und ähnliche
Verdecker ausdrücklich pro Frame annotiert. Der offizielle Gesamtdownload
ist jedoch 566 GB in HD; eine passende kleine Folge wurde in dieser Runde
nicht bezogen. Es wurden keine fremden Videobilder ins Repository übernommen.
[HOOT: Download und Annotationsformat](https://www.hootbenchmark.org/download/)

Erneut ausführbar auf einem geeigneten Mac:

```sh
pnpm run attention:vision-probe /private/tmp/looi-tracking-report.json
```

Exit 0 bedeutet hier, dass tatsächliche Samples gesammelt wurden, ausdrücklich
keinen bestandenen Qualitätsvergleich. Der Probe-Lauf gehört deshalb nicht als
pauschaler grüner Qualitätsnachweis in die plattformübergreifende Testsuite.
Die deterministischen Bridge-/Geometrieprüfungen bleiben davon getrennt und
kompilieren ebenfalls die tatsächliche gemeinsame Swift-Quelle.

## Integrationsstand

`pod install --no-repo-update` hat die gemeinsame Quelle in das Pods-Projekt
eingebunden. Die gezielte native Geometrie-/Bridge-Prüfung und der vollständige
`pnpm run ios:check` bestehen nach der Extraktion. Der native Release-Build
für `iphoneos` und `codesign --verify --deep --strict` des aktualisierten
Pakets bestehen ebenfalls. Logs:
`/private/tmp/my-looi-native-tracker-ios-check.log` und
`/private/tmp/my-looi-native-tracker-device-build.log`.

Ein unabhängiger Review fand keinen konkreten Fehler bei Schnittstelle,
Kameralebenszyklus, Koordinaten oder terminalem Verlustzustand. Er prüfte die
Tabellenwerte gegen den gespeicherten Bericht und dessen Hashes gegen die
aktuellen Quellen. Eine sichtbare Kamera-/UI-Abnahme oder ein iPhone-Energie-/
Latenzwert wird hier nicht behauptet. Auch der Simulator-Release-Build endet
mit `BUILD SUCCEEDED` im Log
`/private/tmp/my-looi-native-tracker-simulator-build.log`. Dieses Paket wurde
im eigenen Simulator „LOOI Expression Review“ installiert und gestartet.
Der danach weiter laufende App-Prozess bestätigt den Start, keine sichtbare
Bedienfolge. Die Computerbedienung meldet weiterhin einen gesperrten Mac;
das physische iPhone bleibt laut `devicectl` nicht erreichbar.

Nach der Statuskorrektur bestehen `pnpm run attention:test`, beide erneuten
Release-Builds und die strikte Signaturprüfung. Auch dieses jüngste Paket ist
im eigenen Simulator installiert und gestartet; der Prozess blieb aktiv.
Die zusätzlichen Logs sind `/private/tmp/my-looi-region-wording-attention-check.log`,
`/private/tmp/my-looi-region-wording-device-build.log` und
`/private/tmp/my-looi-region-wording-simulator-build.log`. Ein unabhängiger
Quellreview der vier Sprachfassungen und der bestehenden Accessibility-
Verwendung fand keinen konkreten Fehler. Die sichtbare Prüfung ist weiter offen.
