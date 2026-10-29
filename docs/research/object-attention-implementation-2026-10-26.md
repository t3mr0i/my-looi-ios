# Gemeinsame Aufmerksamkeit: Umsetzung und Prüfstand

Stand: 26. Oktober 2026. Umsetzung des ersten Entwicklungsauftrags aus
[Phase 2 der 2030-Vision](lebendigkeit-phase-2-2030-2026-10-26.md).
Die gemeinsame Tätigkeit wurde danach [als weiterer Baustein umgesetzt](shared-activity-implementation-2026-10-26.md).
Die [persönlichen Rituale](personal-ritual-implementation-2026-10-26.md) folgten
als eigener Baustein; ihre Wirkung im Alltag bleibt zu prüfen.

Die [anschließende Verbesserung der Auswahl](object-attention-refinement-2026-10-26.md)
bindet Ziehgesten an ein geladenes Bild und trennt veraltete Frames von
fehlgeschlagener Initialisierung. Dort stehen die ergänzenden Prüfnachweise.

## Ergebnis und Bedienung

Die neue Viewfinder-Schaltfläche auf dem Gesicht öffnet eine vorübergehende
lokale Auswahlvorschau. Die Person kann einen Rahmen ziehen, einen kleinen
Bereich antippen oder barrierefrei den mittleren Bildbereich wählen. Eine
angenommene Auswahl wird höchstens zehn Sekunden verfolgt. Der Bildschirmblick
folgt der gewählten Bildregion; bei tatsächlicher Nutzersprache bekommt die
Person Vorrang. Beim Verlust kehrt der Blick kurz in die Mitte zurück.

Voraussetzungen sind ein neuer nativer iOS-Build, eingeschaltete Camera
Attention, Kameraberechtigung, ein wacher Roboter und die aktive Hauptansicht.
Während eines Fahrvorgangs, einer externen Kameraübernahme oder eines
vereinbarten Startsignal-Fensters wird keine neue Auswahl begonnen. Android
und ältere native Builds erhalten einen Hinweis auf fehlende Unterstützung.

Die Oberfläche bietet Stoppen, Abbrechen, erneute Auswahl und bei fehlender
Berechtigung oder Kameraaufmerksamkeit den Weg zu den Einstellungen. Die Texte
sind auf Deutsch, Englisch, Ukrainisch und Russisch vorhanden. Die Auswahl
bleibt innerhalb der Hauptansicht; eine zusätzliche Route oder eine zweite
Kamera wird nicht geöffnet.

## Technischer Umfang

- Die bisherige native `AVCaptureSession` bleibt Kamerabesitzer. Eine besondere
  Objekt-Lease hält sie während Auswahl und Verfolgung aktiv. Laufende
  Gesprächsaufmerksamkeit und externe Medienübergaben behalten ihren Besitz.
- Die Vorschau besteht aus lokalen JPEGs mit höchstens 512 Pixeln an der langen
  Seite und höchstens vier Vorschauereignissen pro Sekunde. Nativ bleiben
  höchstens vier verkleinerte Frames für höchstens eine Sekunde im Speicher.
- Jede Vorschau hat Request-ID, Frame-ID und Koordinatenbezug. Die Auswahl
  verwendet genau den tatsächlich geladenen Frame. Nativ muss dessen Alter
  höchstens 500 ms betragen und Orientierung sowie Kamerastream müssen passen.
  Ein veralteter Frame erzeugt keine neue Initialposition.
- `VNTrackObjectRequest` wird mit dieser ausgewählten Region initialisiert.
  Nach dem ersten und jedem folgenden Ergebnis wird die zurückgegebene
  `inputObservation` für die Fortsetzung desselben Trackers verwendet. Ein
  `VNSequenceRequestHandler` verarbeitet die folgenden Frames.
- Die Koordinaten sind im gesamten Vertrag normalisiert, ungespiegelt und
  relativ zur linken oberen Bildecke. An der Vision-Grenze wird die untere
  linke Ecke umgerechnet. Die UI berücksichtigt die tatsächliche Bildfläche
  einschließlich Letterboxing.
- Native und JavaScript-Zustände erzwingen unabhängig die Grenzen: 15 Sekunden
  Auswahl, zehn Sekunden Tracking und höchstens 500 ms ohne neue Track-Frames.
  Native Zeitwerte werden nur auf Reihenfolge geprüft; JavaScript-Fristen
  verwenden die eigene monotone Uhr. Es werden keine getrennten Zeitbasen
  voneinander subtrahiert.
- Niedrige Qualität, ungültige Regionen und unplausible Positions- oder
  Größenänderungen beenden den Track. Nach `lost` oder `ended` gibt es keine
  automatische Wiederaufnahme oder Suche nach einem Ersatzgegenstand.
- Die Bildschirmaugen wechseln zwischen Person, ausgewählter Region und
  neutralem Blick. Die normale Blicklogik während der Assistentensprache bleibt
  erhalten. Der neue Objektbezug gibt keine Kopf- oder Fahrbefehle aus.
- Neue Ambient-Aktionen, soziale Such-/Nachführbewegungen und Behavior-Motor-Cues
  werden während der Objekt-Lease unterdrückt. Die Ambient-Sperre ist beim Ende
  sofort freigebbar und besitzt zusätzlich eine Ablaufgrenze. Bereits vorher
  gestartete Aktionen werden durch diese Sperre nicht rückwirkend ungeschehen.

Abbruch, Hintergrund, Schlaf, Verlassen der Hauptansicht, Camera Attention aus,
STOP bzw. Roboterbewegung, Kamerawechsel, Rotation und ein explizites Standbild
beenden den jeweiligen Ablauf. Ein später eintreffender Start oder Frame eines
älteren Requests kann den neueren Zustand nicht wiederbeleben. Ein Handzeichen-
Ritual kann die Objekt-Lease ausdrücklich verdrängen.

## Speicher und Grenzen der Wahrnehmung

Dieser Modus schreibt weder Kameraaufnahmen noch Objektkoordinaten oder
Track-IDs in die dauerhafte Memory. Die Vorschau wird nicht hochgeladen. Der
UI-Bildcache ist ausdrücklich ausgeschaltet; nach Schließen, Fehler, Start der
Verfolgung oder Ende werden die Bildreferenzen der Vorschau entfernt. Die
native Beendigung löscht ihre zurückgehaltenen Pixelbuffer. Diagnostik enthält
nur begrenzte Statusereignisse und keine Bilddaten.

Der Tracker verfolgt eine **ausgewählte 2D-Bildregion**. Er liefert keine
verifizierte Objektidentität, Entfernung, Raumkarte oder gemessene Kopfpose.
Die Qualitätsschwelle und Bewegungsgrenzen sind konservative Prototypwerte,
keine kalibrierten Wahrscheinlichkeiten. Insbesondere können ähnliche
Gegenstände oder schleichende Verdeckung einen Bildregion-Tracker täuschen,
ohne einen großen Sprung oder niedrigen Qualitätswert zu erzeugen. Die
fehlende automatische Wiederaufnahme nach erkanntem Verlust verhindert daher
nicht jede mögliche Verwechslung während eines noch laufenden Tracks.

Ein weiterer Ausbau zu Gerda als dauerhaft wiedererkanntem Gegenstand benötigt
eine eigenständige Prüfung von Identität und Wiedererkennung. Die bereits
vorhandene, explizit bestätigte Textbeschreibung bleibt davon getrennt.

## Ausgeführte Prüfungen

| Prüfung | Beobachtetes Ergebnis |
|---|---|
| `corepack pnpm run ios:check` | PASS einschließlich TypeScript, bisheriger Voice-/BLE-/Lifecycle-/Memory-/Behavior-Suites und neuer Objekt-Suites |
| Nativer Xcode-Build | `BUILD SUCCEEDED`, Debug für generischen iOS-Simulator, Codesigning aus; nach der Korrektur der Vision-Fortsetzung erneut gebaut |
| Offline-iOS-Export | PASS; abschließender Export mit neuem Control und Blick-Arbiter als Hermes-Bundle erstellt |
| `object-attention-policy.test.mjs` | Auswahlgeometrie, Letterboxing, Tap/Drag, IDs, doppelte und ungeordnete Frames, Qualität, Verlust, Ablauf und keine Wiederaufnahme |
| `object-attention-runtime.test.mjs` | Echte Runtime mit injizierten Schnittstellen: expliziter Start, frische Auswahl, Gaze, Zeitgrenzen, Abbrüche, verspätete Starts, fehlende Unterstützung und sofortige Ambient-Freigabe |
| `object-attention-gaze.test.mjs` | Objektbezug, tatsächliche Nutzersprache, fehlendes Gesicht, Assistentensprache, neutraler Verlust und Ausklingen |
| `social-interaction-signal.test.mjs` | Gemeinsamer Kamerabesitzer, genau eine Objekt-Lease, veraltete Freigabe, Vorrang des Handzeichens und externe Übergabe |
| `local-object-tracking.test.mjs` | Inline-Swift-Geometrie kompiliert und mit Bounds-/Konvertierungs-/Kontinuitätsfällen geprüft; zusätzlich Bridge-/Lifecycle-Vertrag kontrolliert |
| Bewegungsprüfungen | Deadman, gerichtete Cliff-Sicherheit, Ambient-Mikrobewegung und Realtime-bewusste Bewegung PASS |
| Browser-UI mit synthetischer Vorschau | Tatsächliches Control über React Native Web: 390×844 und 844×390, Auswahl, Mittelauswahl, Tracking-Anzeige, Stop und Abbrechen sichtbar geprüft |
| Unabhängige Durchsicht | Korrektheit von Frische/Besitz/Abbruch geprüft; gefundene Vorschau-Retention behoben. Begrenzte visuelle Prüfung der zwei synthetischen Ansichten: Approve |
| Mechanischer UI-Check / `git diff --check` | Keine gemeldeten Befunde / PASS |

Die Browseransichten verwenden die echte neue Komponente mit einer synthetischen
Kameravorschau und simulierten Infrastruktur-Schnittstellen. Sie sind keine
iPhone-Aufnahmen. Native Safe Areas, reale Berührungseingaben und die Qualität
des Kamerabilds werden dadurch nicht abgenommen.

- [Hochformat mit synthetischem Testbild](evidence/object-attention-portrait-synthetic.png)
- [Querformat mit synthetischem Testbild](evidence/object-attention-landscape-synthetic.png)

Es wurde kein iPhone installiert, keine physische Roboterbewegung ausgelöst
und keine kostenpflichtige Realtime-/Decisions-Bildanfrage für diesen Modus
ausgeführt. Die App liegt nach dem Build unter
`output/ios-derived/Build/Products/Debug-iphonesimulator/MyLOOI.app`.

## Noch nachzuweisen

Die neuen Tests bestätigen Verträge, Zustandswechsel und Kompilierung. Sie
messen nicht die tatsächliche Vision-Trackingqualität. Es liegen keine realen,
unabhängig annotierten und zurückgehaltenen Clips zu Gerda, Verdeckung oder
ähnlichen Nachbarobjekten vor. Latenz, Energiebedarf, Beleuchtungsgrenzen und
Verwechslungsrate am iPhone bleiben ebenso offen wie die Verständlichkeit des
Bildschirmblicks für Menschen. Der im Entwicklungsbrief beschriebene
Clip-Versuch und anschließend der Live-Versuch sind die nächsten
Abnahmeschritte, keine bereits erzielten Ergebnisse.
