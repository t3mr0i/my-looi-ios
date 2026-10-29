# Objektauswahl: stabile Markierung und verständliche Wiederholung

Stand: 26. Oktober 2026. Begrenzte Verbesserung der bereits implementierten
[lokalen Objektverfolgung](object-attention-implementation-2026-10-26.md),
angestoßen durch `better-function`.

## Problem und Belege

Die Person soll einen Gegenstand im angezeigten Kamerabild markieren und bei
einer abgelehnten Auswahl verstehen, ob sie auf ein neues Bild warten oder
einen anderen Bereich wählen muss.

Der gelesene Quellstand enthielt drei zusammenhängende Probleme:

- JavaScript ließ einen gewählten Frame bis 800 ms nach Empfang zu. Nativ
  durfte genau dieser Frame höchstens 500 ms seit Aufnahme alt sein. Eine
  Vorprüfung bei 501 ms konnte daher noch einen ohnehin zu alten Frame an
  den nativen Tracker senden. Der ergänzte Runtime-Test reproduzierte das:
  erwartete Ablehnung, tatsächlich angenommener Start im injizierten Backend.
- Der PanResponder speicherte beim Beginn einer Ziehgeste nur den Punkt.
  Bild, Rahmen und spätere Auswahl konnten durch neue Vorschauereignisse
  zwischen Frame A und B/C wechseln. Die bisherige statische Geometrieprüfung
  deckte diese Reihenfolge nicht ab.
- Der native Start lieferte nur `true`/`false`. Die Runtime bezeichnete jedes
  `false` als veraltetes Bild; die Oberfläche ersetzte das wiederum durch einen
  allgemeinen Fehler, wenn sich die Frame-ID nicht geändert hatte. Ein echter
  Vision-Fehler konnte dadurch denselben Wiederholungshinweis erzeugen wie
  eine Fristüberschreitung. Das reguläre Ende wurde im Zubehör außerdem als
  „Gegenstand verloren“ dargestellt.

Das sind aus dem Code und injizierten Abläufen belegte Vertragsprobleme. Ihre
Häufigkeit auf dem iPhone wurde nicht gemessen. Langsames Bildladen und echte
Tracker-Initialisierungsfehler sind konkurrierende Ursachen für eine sichtbare
Ablehnung; die differenzierte Rückgabe hält sie jetzt auseinander.

## Entscheidung und Entwicklungsbrief

| Möglichkeit | Nutzen | Aufwand / Risiko | Entscheidung |
|---|---|---|---|
| Native Bildfrist verlängern | Mehr Zeit für lange Gesten | Start an einer veralteten Position; keine Messung, die eine längere Frist trägt | Verworfen |
| Nur noch Antippen oder Mittelauswahl | Weniger Gesteninterleavings | Präzise Rahmenselektion geht verloren | Verworfen |
| Geste an genau ein Bild binden und Ablehnungen unterscheiden | Bild, Rahmen und Auswahl bleiben zusammen; passende Wiederholung | Kleine Änderung an UI, Runtime und Bridge; langsame Gesten können weiter veralten | Umgesetzt |

Der übersehene Engpass ist die Verbindung zwischen dem tatsächlich markierten
Bild und dem später gestarteten Tracker. Ausgangsmaterial sind
`src/ui/ObjectAttentionControl.tsx`, `src/core/object-attention.ts`, der native
Kamerabesitzer und die vorhandenen Objekt-Suites. Methode sind eine deterministisch
injizierte Ereignisfolge A → B/C während einer Geste, Grenzfälle für die Zeitprüfung
und getrennte native Ablehnungsgründe. Der unabhängige Nachweis besteht aus
stabiler Frame-ID und Geometrie trotz Folgebildern, korrekter Wiederholung sowie
freigegebenen Leases bei nicht mehr verfügbarer Kamera.

Konkrete Grenzen: keine längere Bildaufbewahrung, keine neue Kamera, keine
automatische Wiederaufnahme, kein zusätzlicher Motorbefehl. Die native
Aufnahmefrist von 500 ms und die zehn Sekunden Verfolgung bleiben bestehen.
Die JS-Vorprüfung verwendet ebenfalls höchstens 500 ms, aber ab **Empfang**.
Sie kann Übertragung und Bridge-Latenz nicht messen und ersetzt die native
Prüfung nicht. Die beiden Zeitbasen werden nicht voneinander subtrahiert.

Die neue Bridge liefert `{ accepted: true }` oder eine Ablehnung mit
`selection-stale`, `selection-unavailable`, `selection-invalid` oder
`tracking-failed`. Boolesche Rückgaben älterer Builds bleiben akzeptiert;
deren `false` wird als unbekannter Auswahlfehler dargestellt. Eine abgelehnte
Auswahl verlängert das ursprüngliche Auswahlfenster nicht. Eine nicht mehr
verfügbare Auswahl beendet und bereinigt den Ablauf.

## Prüfstand

| Prüfung | Beobachtetes Ergebnis |
|---|---|
| Regression vor der Runtime-Korrektur | FAIL bei 501 ms Empfangsalter: die alte 800-ms-Vorprüfung ließ den Start zu |
| `object-attention-runtime.test.mjs` | PASS: 500/501-ms-Grenze, getrennte Zeitbasen, vier native Ablehnungen, Legacy-Bool, Wiederholung ohne Fristverlängerung, Ressourcenfreigabe und verspätete strukturierte Antwort nach neuer Auswahl |
| `object-attention-selection.test.mjs` | PASS: geladener Frame A bleibt trotz B/C mit seiner Geometrie gepinnt; Release und Cancel räumen auf; Letterbox und zu schmale Geste erzeugen keine Region |
| `local-object-tracking.test.mjs` | PASS: native Ergebnisdarstellung und Geometrie kompiliert; Guard-Zuordnung und Bridge-Vertrag kontrolliert |
| `corepack pnpm run ios:check` | PASS einschließlich neuer Auswahl-Suite und bestehender Voice-/BLE-/Lifecycle-/Behavior-/Budget-Prüfungen |
| Abschließende UI-Korrektur | TypeScript, Auswahl-/Runtime-/Gaze-/Kamerabesitz-Suites und Offline-Export erneut erfolgreich; gültige erste Ziehgeste nach Fehler im Browser bestätigt |
| Xcode Debug, generischer iOS-Simulator | `BUILD SUCCEEDED` mit geändertem nativen Rückgabevertrag; Codesigning aus |
| Offline-iOS-Export | PASS, Hermes-Bundle erstellt |
| Unabhängige Durchsicht | Keine Blocker in Runtime-/Native-Vertrag; Pin, sichtbares Bild, Bounds und Release-ID durchgesehen; Bildreferenzen und Terminal-Cleanup geprüft |
| Mechanischer UI-Check / `git diff --check` | Keine Befunde / PASS |

Die echte Komponente wurde über React Native Web mit simulierter Infrastruktur
und einem synthetischen Kamerabild in 390×844 und 844×390 geprüft:

- Ein zurückgewiesenes veraltetes Bild zeigt den Wartehinweis. Mit dem Laden
  einer anderen Frame-ID verschwindet die alte Rückmeldung.
- Ein Trackerfehler zeigt die Auswahlfehlermeldung; die erneute Mittelauswahl
  führt sichtbar in `tracking`.
- Das normale Zeitende zeigt „Beendet“. Das Fixture löst diesen Zustand zum
  Prüfen verkürzt aus; die echte Zehn-Sekunden-Grenze prüft die Runtime-Suite.
- Eine zu schmale Ziehgeste zeigt die Fehlermeldung. Bei der ersten Prüfung
  wurde die unmittelbar folgende gültige Geste durch eine Layoutänderung
  verworfen: Das Löschen des Fehlertexts bei Gesture-Beginn veränderte die
  verfügbare Höhe und löste die Layout-Abbruchprüfung aus. Der Fehlertext wird
  jetzt erst beim tatsächlichen Absenden gelöscht. Die wiederholte gleiche
  Ereignisfolge führte danach bereits mit der ersten gültigen Geste in
  `starting` und `tracking`. Vorübergehende Debugausgaben wurden wieder entfernt.

Der A→B/C-Test prüft die tatsächlich verwendete reine Gestenlogik; eine
gemountete native Komponente mit laufendem Kamerastream wird dadurch nicht
simuliert. Safe Areas, Touch-Verhalten und Trackingqualität auf dem iPhone
bleiben offen. Trefferquote und Latenz wurden nicht gemessen. Es wurden keine
Kamera aktiviert, keine App auf einem iPhone installiert und keine Roboterbewegung ausgelöst.

- [Auswahlfehler und Wiederholung, Hochformat](evidence/object-attention-tracking-retry-synthetic.png)
- [Ungültiger Rahmen mit Wiederholungshinweis, Querformat](evidence/object-attention-invalid-selection-synthetic.png)
- [Erste gültige Geste nach dem Fehler, Querformat](evidence/object-attention-gesture-retry-synthetic.png)
- [Reguläres Ende, Querformat](evidence/object-attention-ended-synthetic.png)

Geändert wurden UI-Control, Gestenlogik, vier Sprachfassungen, Runtime und
nativer Startvertrag samt Bridge, die zugehörigen Tests und ihre Script-Einträge
sowie Bedien- und Prüfdokumentation. Kamerabesitz, Speicherung und Trackingdauer
behalten ihren bestehenden Zweck und ihre Grenzen.
