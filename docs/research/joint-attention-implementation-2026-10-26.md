# Gemeinsame Aufmerksamkeit: ausgewählter Bereich und bestätigte Tätigkeit

Stand: 26. Oktober 2026. Fortsetzung des laufenden Forschungs- und
Umsetzungsziels. Die vorherige Runde war Fortschritt: Eine gemeinsame
Ausdruckssequenz wurde implementiert und ihr Gerätebuild geprüft. Diese Runde
verbindet den Objektbezug mit der Aufgabe und ergänzt eine native Offline-Probe
des tatsächlichen Robotergesichts.

## Forschungsfrage und bestätigter Ausgangspunkt

Wie kann LOOI verständlich zwischen Mensch und Gegenstand unterscheiden, wenn
es schon eine bestätigte gemeinsame Tätigkeit gibt? Im aktuellen Code hat
`PendingIntention.activity` Phasen und eine bestätigte Episode. Die lokale
Objektverfolgung besitzt dagegen nur einen ausdrücklich gewählten, kurzlebigen
Bildbereich. Der bisherige Blick-Arbiter folgt diesem Bereich in stillen Phasen,
kennt aber keine Beziehung zur Tätigkeit. Geometrie allein liefert diese
Beziehung nicht.

Das ist eine Integrationslücke zwischen `shared-activity.ts`,
`object-attention.ts`, `ObjectAttentionControl.tsx` und `RobotFace.tsx`.
Vorhandenes Tracking, bestätigte Aufgaben und Episoden werden weiterverwendet.
Eine dauerhaft erkannte Objektidentität wird nicht neu behauptet.

## Primärquellen und Gegenbelege

Die Studie **Predictive robot eyes enhance attentional guidance**, veröffentlicht
am 23. September 2025, untersucht 42 Personen in einer industriellen Aufgabe.
Augencues führten die Aufmerksamkeit früher zum Ziel; Vertrauen und
Vorhersageleistung unterschieden sich nicht signifikant zwischen Bedingungen.
Die Schlussfolgerung für LOOI ist begrenzt: Wir prüfen verständliche Bezüge und
Störung, statt aus mehr Blickbewegung einen Nutzen abzuleiten.
[Scientific Reports](https://www.nature.com/articles/s41598-025-19497-3)

**Analysis of Mutual and Referential Human and Robot Gazes**, Preprint vom
13. Juli 2026, vergleicht gegenseitigen und referenziellen Blick in einem
gemeinsamen Wortspiel mit NAO. Die Blickrichtung änderte die erste Fixierung
vorgeschlagener Wörter nicht; bei Bestätigungsfragen sahen Personen häufiger
zum Roboter. Diese aufgabenspezifischen Ergebnisse stützen die Prüfung einer
ruhigen Rückkehr zur Person während Bestätigungen. Sie beweisen keinen Effekt
unseres geplanten Blickablaufs.
[Original-Preprint](https://arxiv.org/abs/2607.12181)

**Bio-Inspired Object Reference Recognition under Ambiguous Non-Verbal Cues**,
SII 2026, verbindet menschlichen Blick und Zeigen zur Referenzauflösung auf
Furhat. Laut Autoren verbessert ihre Kombination die Zielerkennung gegenüber
einzelnen Hinweisen. LOOI besitzt diese Eingänge nicht: Seine Gesichtsrechtecke
sind keine menschliche Blickrichtung. Wir verwenden deshalb die ausdrücklich
gewählte Zuordnung als Quelle und übertragen keine Erkennungsleistung dieser
Arbeit auf LOOI.
[Publikationsseite des Autors](https://haganelego.github.io/en/publications/kanaoka2026bio/)

## Abgewogene Wege und konkrete Entscheidung

Automatisches Benennen eines Rechtecks würde eine neue semantische Wahrnehmung
und eigene Messungen erfordern. Ungefiltertes Verfolgen ist bereits vorhanden,
verbindet den Gegenstand aber nicht mit dem gemeinsamen Handlungsschritt. Ein
freier Blickwechsel pro Frame hätte keinen erklärbaren Anlass.

Gewählt wurde die ausdrücklich bestätigte, vorübergehende Zuordnung im
bestehenden Auswahlfenster. Eine zusätzliche Checkbox lautet beispielsweise
„Ausgewählten Bereich für Gerda verwenden“. Sie ist standardmäßig aus und wird
nur bei einer aktiven, bestätigten Tätigkeit angeboten. Die Auswahl bleibt an
genau diese Sitzung, Aufgabe, Episode und Korrekturversion gebunden. Die
eigentliche Region wird weiterhin auf einem aktuellen dargestellten Frame
ausgewählt.

Der lokale Blickablauf wartet nach einer ruhigen Phase zunächst 500 ms, schaut
für 700 ms auf den zugeordneten Bereich und kehrt zur Person zurück. Pro
passender Aufgabenphase gibt es höchstens einen solchen Blick. Diese Zeiten
sind vorläufige Entwurfswerte. Sprache, Antwortvorbereitung und offene
Bestätigungen behalten den Personenbezug; nach einem unterbrochenen Blick wird
derselbe Blick nicht im selben Schritt wiederholt. Bei einem Startzeichen wird
die Aufmerksamkeit bei der Person gehalten.

## Implementierung und vollständiger Datenweg

1. `ObjectAttentionControl` hält nach ausdrücklichem Antippen einen Snapshot der
   Zuordnung. Ein späterer Aufgabenwechsel ersetzt ihn nicht stillschweigend.
   Eine ungültig gewordene Auswahl behält ihren ursprünglichen Titel und
   Haken, zeigt einen lokalisierten Hinweis und sperrt die Bereichsübernahme.
   Solange die Auswahl noch läuft, ermöglicht Abwählen die Verfolgung ohne
   Aufgabenbezug; nach einem beendeten nativen Start gibt es den vorhandenen
   erneuten Auswahlversuch. Die UI prüft den Snapshot unmittelbar vor Übergabe
   zusätzlich gegen den aktuellen Store.
2. `object-attention.ts` prüft den Snapshot vor dem nativen Tracking-Aufruf,
   nach dessen Antwort und während des bestehenden lokalen Timers. Früh
   eintreffende Frames bleiben bis zur nativen Bestätigung im Startzustand.
3. Erst die bestätigte Auswahl mit einem gültigen Tracking-Frame publiziert
   `object-reference` über den bestehenden Behavior-Event-Adapter. Die Engine
   prüft Sitzung, Aufgabe, Episode, Korrekturversion und Frist erneut.
4. Der Modellkontext nennt die Quelle `user_selected_region` und erklärt, dass
   dies eine vorübergehende Nutzerzuordnung ist. Daraus folgen keine neue
   Bildaufnahme, visuelle Wiedererkennung, metrische Position oder bestätigter
   Aufgabenfortschritt. Benötigte visuelle Details erfordern weiterhin den
   ausdrücklich erlaubten Bildpfad.
5. Der lokale Blick-Director nutzt Aufgabenphase, Sprachzustand und den aktuellen
   Track. `RobotFace` verwendet die bestehende Arbitrierung. Es werden keine
   zusätzlichen Motorbefehle oder Decisions-Anfragen pro Frame erzeugt.

Die Zuordnung endet bei Verlust, Frame-Lücke, Ablauf, STOP, Kamera-/Bildschirm-
oder Sitzungswechsel, Korrektur, Pause, Abschluss, Vergessen oder Ersetzen der
Aufgabe. Ein neuer Track braucht eine neue ausdrückliche Auswahl. Alte
Clear-Ereignisse können keinen neueren Track löschen. Normale Gesprächsturns
allein heben eine weiterhin gültige Zuordnung nicht auf.

Der Bezug wird nicht serialisiert. Beim Tracking fließen keine wechselnden
Countdown-Werte in den Gesprächskontext; damit löst ein einzelner Frame keine
neue semantische Kontextaktualisierung aus. Kameraframes bleiben im bisherigen
lokalen Trackingpfad.

## Native Ausdrucksprobe ohne Schlüssel

Die bereits vorhandene Debugroute ist ohne abgeschlossene OpenAI-Einrichtung
erreichbar. Ihre Medienpause verhindert Mikrofon-/Kameranutzung während der
Probe. Im bestehenden, eingeklappten Rehearsal gibt es jetzt einen kontrollierten
`RobotFace`-Fixture mit den vom echten Ausdrucks-Runner gelieferten Phasen.
Die Darstellung verwendet die tatsächliche native Gesichtskomponente.

Der Fixture schreibt nicht in Produktionszustände und verwendet keinen
API-Schlüssel. Kopfgesten laufen nur über den vorhandenen, geprüften
Mock-Adapter. Die zusätzlich angebotene Wiedergabe mit zehn Prozent
Geschwindigkeit zeigt ausschließlich aufgezeichnete Gesichtsphasen; sie führt
keine Kopfbewegung erneut aus. Abbruch, Quellenwechsel, Hintergrund und Verlassen
räumen laufende Phasen und Replay-Timer auf.

## Verifikation und offene Evidenz

Die neuen Tests `object-activity-reference.test.mjs` und
`object-activity-runtime.test.mjs` bestehen. Der Runtime-Test verbindet die
echte Behavior-Engine, bestätigte Episoden-/Aktivitätsabläufe und den Event-
Adapter mit der echten Objekt-Runtime und ersetzten nativen Kameraeingängen.
Er prüft Referenz, Modellkontext, ausgelassene Serialisierung, Fristen,
Gaze-Prioritäten, Unterbrechungen und verspätete native Antworten. Frame-Updates
erhöhen weder Decisions-Anzahl noch Motor-Cues; der Kontext bleibt dabei stabil.

Die neue `behavior-rehearsal-expression.test.mjs` besteht mit dem tatsächlichen
Ausdrucks-Runner und isoliertem Kopfadapter. Rehearsal-, Mock-, Gesichts-,
Auswahl-, Gaze- und deutsche Sprachprüfungen bestehen ebenfalls. Der
vollständige Lauf von `pnpm run ios:check` besteht einschließlich dieser neuen
Tests. Die vorübergehenden TypeScript-Fehler paralleler Voice-Arbeit waren zum
Gesamtlauf aufgelöst; diese Voice-Änderungen wurden hier nicht ersetzt.

Ein unabhängiger Review prüfte Zuordnungsidentität, verspätete Frames,
Abbruchpfade, Kontextstabilität und Gaze-Priorität ohne konkreten Runtime-Fund.
Ein separater UI-Review fand den zunächst fehlenden Hinweis für eine während
der Auswahl ungültig gewordene Tätigkeit. Dieser Hinweis und die unmittelbare
UI-Sperre wurden ergänzt; danach bestehen TypeScript-, deutsche Sprach-,
Aktivitäts- und Auswahlgeometrieprüfungen.

Der native Release-Build für `iphonesimulator` besteht, auch nach der letzten
Korrektur des Auswahlfensters. Die App wurde im eigenen
iPhone-16-Simulator „LOOI Expression Review“ installiert und mit `simctl launch`
gestartet; der native Prozess lief auch nach knapp zwei Minuten weiter. Das belegt Build,
Installation und Prozessstart, noch keine sichtbare Bedien- oder Phasenabnahme.
Die Logdatei liegt unter
`/private/tmp/my-looi-attention-simulator-final-build.log`. Nach der letzten
UI-Korrektur besteht außerdem der vollständige Aufmerksamkeitslauf
`pnpm run attention:test`.

Auch der aktualisierte signierte Release-Build für `iphoneos` besteht.
`codesign --verify --deep --strict` bestätigt die Signatur des fertigen Pakets
`/private/tmp/my-looi-iphone-derived/Build/Products/Release-iphoneos/MyLOOI.app`.
Buildlog: `/private/tmp/my-looi-joint-attention-device-build.log`. Die vorhandenen
Offline-Sprachmodelle wurden beibehalten.

Die sichtbare Abnahme ist aktuell blockiert: Die Computerbedienung meldet den
Mac als gesperrt. Es wurde deshalb keine native Bildschirmaufnahme angefertigt
und kein Durchlauf der neuen Vorschau als sichtbar bestanden gewertet. Offen
bleiben insbesondere Gesicht und Phasen bei normalem und langsamem Replay,
Hochformat, iPad-Breite, reduzierte Bewegung und das Auswahlfenster am Gerät.
Das physische iPhone wird von `devicectl` weiterhin als `unavailable` gemeldet;
dieser neue Stand wurde dort nicht installiert.

Die echte Wahrnehmungsqualität bei Verdeckung, reales Motorverhalten und
Verständlichkeit/Natürlichkeit für Menschen bleiben gesonderte Nachweise. Die
Softwaretests allein schließen das übergeordnete Ziel „State of the Art“ nicht
ab.
