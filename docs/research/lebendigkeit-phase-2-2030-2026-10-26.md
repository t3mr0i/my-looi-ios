# LOOI: nächste Phase der 2030-Vision

Stand: 26. Oktober 2026. Entwicklungsbrief nach der
[bereits implementierten ersten Stufe](lebendigkeit-implementation-2026-10-26.md).
„2030“ ist hier ein Zielbild, keine Vorhersage eines Liefertermins oder einer
erreichbaren Zuverlässigkeit. Der erste Entwicklungsauftrag wurde anschließend
autorisiert und [als lokale Objektverfolgung umgesetzt](object-attention-implementation-2026-10-26.md).
Der zweite Baustein ist anschließend [als bestätigter gemeinsamer Objektversuch
umgesetzt worden](shared-activity-implementation-2026-10-26.md). Der dritte Baustein
ergänzt [ausdrücklich gewählte persönliche Rituale](personal-ritual-implementation-2026-10-26.md).
Die Umsetzungsberichte trennen Implementierung, ausgeführte Prüfungen und offene
Geräte- und Alltagsabnahme.

## Zielerlebnis

Du stellst Gerda vor LOOI und wählst sie einmal als euren gemeinsamen Gegenstand
aus. Während du sie bewegst, bleibt sein Bildschirmblick nachvollziehbar bei
diesem Gegenstand. Verschwindet Gerda hinter deiner Hand, verliert er den Bezug
sichtbar, statt zur danebenstehenden Tasse zu wechseln. In der nächsten Stufe
kennt er euren aktuellen Handlungsschritt: prüfen, bereitstellen, auf das
Startzeichen warten, Versuch, Ergebnis besprechen. Am nächsten Tag kann er
an den bestätigten Verlauf anknüpfen und eine gemeinsam gewählte Eigenheit
wieder aufnehmen.

Der neue Nutzerwert wäre eine gemeinsame Aufmerksamkeit, aus der gemeinsame
Handlungen entstehen. Ob das tatsächlich lebendiger und weniger störend wirkt,
ist eine zu prüfende Hypothese.

## Bestätigter Ausgangspunkt

Dieser Abschnitt hält den Ausgangspunkt vor den drei verlinkten Bauabschnitten
fest. Die dort beschriebenen Lücken sind inzwischen lokal implementiert; die
Berichte oben enthalten den aktuellen Prüfstand.

- Die native iOS-Kamera hat bereits einen gemeinsamen Besitzer. Sie verarbeitet
  aktuell nur Frontkamera-Frames, höchstens etwa alle 120 ms; beim Standbild
  pausiert diese Analyse. Ergebnisse sind Gesichtsrechtecke und bei ausdrücklich
  freigeschaltetem Fenster ein lokales Handzeichen. Es gibt keinen Objekt-Track.
  [Kamerastream](../../modules/local-face-attention/ios/LocalFaceAttentionModule.swift:161)
- Der explizite Blick liefert ein einzelnes Bild im Arbeitsspeicher. Die neue
  Episoden-Memory speichert bestätigte Textbeschreibungen mit Herkunft. Das
  schafft eine erzählbare Vergangenheit, aber noch keinen kontinuierlichen
  visuellen Bezug auf einen bestimmten Gegenstand.
  [Einzelbild](../../src/vision/look-here.ts:18),
  [Textbeschreibung](../../src/behavior/behavior-companion.ts:20)
- Die Bildschirmaugen folgen schon einem temporär ausgewählten Gesicht. Diese
  Geometrie ist weder Personenidentität noch menschliche Blickrichtung.
  [Gesichtsauswahl](../../src/core/social-attention.ts:454)
- Eine pausierte Aufgabe speichert bereits Ziel und letzten bestätigten Schritt.
  Eine neue Aktivitätslogik muss darüber hinaus konkrete Ereignisse und erwartete
  nächste Schritte einer gemeinsamen Tätigkeit abbilden.
  [PendingIntention](../../src/behavior/behavior-types.ts:58)
- Die LOOI-Anbindung besitzt diskrete Kopflagen, keine gemessene Kopfpose und
  keine Odometriedaten. Eine Region im Kamerabild ist damit noch keine
  kalibrierte Blickrichtung oder räumliche Zielposition des Roboters.
  [Hardwarevertrag](../../src/robot-bridge/looi-backend.ts:55)

Nutzerbedarf und Häufigkeit dieser neuen Abläufe sind bisher nicht durch
Interviews oder Nutzungsdaten belegt. Die vorhandenen Tests und der erfolgreiche
native Build bestätigen die erste Implementierung; sie messen keine soziale
Wirkung und keine Qualität einer zukünftigen Objektverfolgung.

## Drei Bausteine und ihre Abwägung

| Baustein | Kleinste nützliche Fähigkeit | Erwarteter Nutzen | Aufwand und Abhängigkeiten | Stärkster Einwand |
|---|---|---|---|---|
| Gemeinsame Aufmerksamkeit | Einen ausdrücklich ausgewählten Gegenstand kurz lokal im Bild verfolgen; Verlust kenntlich machen | „Er ist bei derselben Sache wie ich“ | Mittel: Auswahl, native Verfolgung, Kamerabesitz, Abnahme am iPhone | Verdeckung und ähnliche Gegenstände können den Tracker fehlleiten; korrektes Tracking kann trotzdem keinen verständlichen Blick erzeugen |
| Gemeinsame Tätigkeit | Für genau eine Aktivität festhalten, was erledigt ist, worauf LOOI wartet und welches Ereignis den nächsten Schritt erlaubt | LOOI trägt passend zum Ablauf bei und kann eine Unterbrechung verständlich auflösen | Mittel: Ereignisse, Voice-Integration, Ablaufzustand; später frische Wahrnehmung als Eingang | Ein starres Skript kann anstrengender als ein freies Gespräch sein; Annahmen über den nächsten Schritt können stören |
| Gemeinsam geprägte Eigenheiten | Eine persönliche Geste ausdrücklich wählen oder ablehnen und später an einem bestätigten passenden Anlass verwenden | Wiedererkennbare gemeinsame Geschichte | Klein bis mittel für ein Ritual; größer für Lernen über Tage und passende Dosierung | Das Modell wählt heute schon ein Episodenmotiv. Weitere Gesten allein schaffen keinen neuen Nutzerwert; häufige Rückbezüge können nerven |

Die Auswahl fällt zuerst auf **gemeinsame Aufmerksamkeit**. Sie ergänzt ein
bisher fehlendes Wahrnehmungssignal und trägt den späteren Blickwechseln,
Aktivitäten und räumlichen Referenzen zu. Eine ausgebaute Aktivitätslogik könnte
schon jetzt rein sprachlich entstehen; sie würde die zentrale Lücke zwischen
Gerda im Gespräch und Gerda im Kamerabild jedoch offenlassen. Das persönliche
Ritual bleibt ein sinnvoller, kleiner Ausbau, ersetzt diese Grundlage aber nicht.

## Erster Entwicklungsauftrag: einen Gegenstand kurz gemeinsam verfolgen

**Problem:** Nach einem Einzelbild kann das Produkt nicht feststellen, wo sich
der ausgewählte Gegenstand in den folgenden Frames befindet oder ob der Bezug
verloren gegangen ist.

**Lieferumfang:** Ein ausdrücklich gestarteter, kurz begrenzter Versuch mit
einem ausgewählten Gegenstand, lokalem 2D-Track, verständlichem Bildschirmblick
und eindeutiger Beendigung bei Verlust. Ein zunächst vorgeschlagenes Fenster
von zehn Sekunden ist eine Prototypgrenze, kein bereits abgenommener Wert.

1. Eine kurze Auswahlvorschau lässt die Person den Gegenstand markieren. Die
   Auswahl wird dem verwendeten Kamerastream und einem frischen Frame
   zugeordnet. Ein altes Standbild darf nicht stillschweigend als neue
   Initialposition dienen. Beim späteren Ausbau kann ein Modell eine Region
   vorschlagen; der erste Versuch benötigt keine automatische semantische
   Objekterkennung.
2. Die native Verfolgung verarbeitet nachfolgende Frames beim bestehenden
   Kamerabesitzer. Sie liefert nur Region, Qualitätswert, Zeitbezug und den
   Status `tracking`, `lost` oder `ended`. Der Qualitätswert ist keine
   kalibrierte Wahrscheinlichkeit für „das ist dieselbe Gerda“.
3. Auswahl und Track bleiben vorübergehend. Weder Tracking-ID noch Rechteck
   werden als dauerhafte Objektidentität gespeichert. Nach Verlust muss die
   Person den Gegenstand erneut auswählen; der Tracker soll nicht automatisch
   zu einem ähnlichen Objekt springen.
4. Ein Blick-Arbiter entscheidet zwischen Gesprächspartner, ausgewähltem
   Gegenstand und neutralem Blick. Die Reaktion auf die aktuelle Person und
   ihre Sprache behält Vorrang. Im ersten Versuch betrifft das die
   Bildschirmaugen; körperliches Ausrichten braucht eine eigene Kalibrierung.
5. Abbruch, Ablauf, Kamerawandel, Hintergrund und Verlassen des erlaubten
   Bildschirms beenden den Versuch und geben den Kamerabesitz frei. Eine zweite
   unabhängige Kamerasitzung würde die bestehende Koordination umgehen.

Apple zeigt mit `VNTrackObjectRequest` bereits das Verfolgen einer zuvor
ausgewählten Bildregion über eine Folge von Frames. Das stützt diesen
technischen Ansatz; es belegt weder Objektidentität über Tage noch die
Qualität bei Papiergerda, Verdeckung oder Roboterschwenks.
[Apple: Tracking Multiple Objects or Rectangles in Video](https://developer.apple.com/documentation/Vision/tracking-multiple-objects-or-rectangles-in-video)

**Ausdrücklich getrennt:** Eine metrische Raumkarte oder die Behauptung,
Gerda stehe 30 cm neben der Tasse, braucht zusätzliche Sensorik und
Koordinatenprüfung. Apples `sceneDepth`-Beispiel setzt einen LiDAR-Scanner und
eine Laufzeitprüfung der Geräteunterstützung voraus. Ein solches Verfahren
ist ein späterer, geräteabhängiger Ausbau.
[Apple: Displaying a point cloud using scene depth](https://developer.apple.com/documentation/ARKit/displaying-a-point-cloud-using-scene-depth)

## Beweisführung und günstigster nächster Schritt

Der günstigste aussagekräftige Schritt ist ein Tracking-Versuch auf getrennten,
ausdrücklich bereitgestellten kurzen Videoclips. Er kann den nativen
Tracking-Ansatz falsifizieren, bevor Gesicht, Sprache und Motorik daran
gekoppelt werden. Ein danach separat nötiger Live-Versuch prüft den vorhandenen
Kamerabesitz und die Leistung auf dem tatsächlichen iPhone.

Eingang sind Clips mit einem markierten Gegenstand, Verdeckung, ähnlichem
Nachbarobjekt, Bewegung der Kamera und unterschiedlichem Licht. Erwartete
Regionen werden unabhängig annotiert. Zum Einstellen verwendete Clips bleiben
von den später bewerteten Clips getrennt.

Ausgang ist ein Bericht über Überlappung mit der annotierten Region,
Zentrumsabweichung, falsche Zielwechsel, Verhalten bei Verlust sowie Latenz und
Energieverhalten auf dem iPhone. Grenzwerte werden nach einer ersten Baseline
und vor dem Test auf zurückgehaltenen Clips festgelegt. Eine Zahl ohne diese
Ausgangslage wäre Scheingenauigkeit. Ein unerkanntes Umspringen auf den
Distraktor verwirft den jeweiligen Ansatz, selbst wenn die mittlere
Positionsabweichung gut aussieht.

Danach werden zwei kurze Szenen verglichen: vorhandener Ausdruck und Ausdruck
mit ausgewähltem Objektbezug, bei vergleichbarer Bewegungs- und Sprechmenge.
Menschen müssen offen erklären können, worauf LOOI sich bezieht und wann er den
Bezug verloren hat. Ein korrektes Rechteck allein bestätigt diesen Nutzen
nicht. Mehr Missverständnisse oder störende Blickwechsel sprechen gegen den
Ausbau, auch bei technisch gutem Tracking.

## Danach: vom Verfolgen zum gemeinsamen Handeln

Der zweite Auftrag ist eine einzelne, frei unterbrechbare Tätigkeit mit
beobachtbaren oder ausdrücklich bestätigten Schritten. Für Gerda wären das
Prüfen, Bereitstellen, Warten, Start und Ergebnis. LOOI darf erwartungsvoll
werden, wenn ein passender Schritt belegt ist; er darf daraus noch keinen
Start oder Erfolg ableiten. Ein Szenenmodell erklärt dabei, was gesehen,
gehört, bestätigt oder nur erwartet wurde und wann dieser Bezug veraltet.

Der dritte Auftrag betrifft gemeinsame Eigenheiten über mehrere Tage. Die
Person wählt das Ritual tatsächlich mit; LOOI kann eine erinnerte Tätigkeit
passend aufgreifen und nach einem Nein still werden. Das ist eine Erweiterung
der heutigen bestätigten Episoden und erfordert eine eigene Prüfung der
Wiederholungsdosis und des freiwilligen Wiederaufgreifens.

Die größere 2030-Szene verbindet diese drei Ebenen mit räumlichen Referenzen
und kalibrierter Bewegung. Nach der lokalen Umsetzung der drei Bauabschnitte
steht ihre Geräte- und Alltagsabnahme an. Der
[Companion-Abnahmeplan](companion-goal-acceptance-2026-10-26.md) trennt die bereits
belegten Verträge von den offenen echten Gesprächs- und Roboterabläufen.

## In dieser Runde ausgeführt

Der aktuelle lokale Quellstand und die bisherigen Implementierungsnachweise
wurden gelesen. Zwei unabhängige Lesepfade prüften Wahrnehmung sowie
Kontinuität/Ausdruck. Apples Primärdokumentation wurde abgeglichen. Es wurde
dieser Entwicklungsbrief erstellt; keine neue Produktfunktion, Modellanfrage,
Kameraaktivierung oder Roboterbewegung ausgeführt. Für die nächste Phase liegen
noch keine Tracking-Messwerte oder Nutzerergebnisse vor.
