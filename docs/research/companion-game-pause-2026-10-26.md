# Eine Spielpause behält die gemeinsame Runde

Stand: 26. Oktober 2026. Lokale Companion-Weiterarbeit ohne iPhone, API-Aufruf,
Kamera oder Roboterbewegung. Dieser Ausbau betrifft das vorhandene kleine
Zahlenratespiel und seine Gesprächsübergänge.

## Reproduzierte Lücke

Der bisherige Spielzustand kannte `active`, `won`, `stopped` und `expired`,
aber keine Pause. Eine direkte öffentliche Runtime-Sequenz zeigte:

1. Ratespiel starten, dann über den Weltraum sprechen.
2. „Warte kurz“ sagen.
3. Danach die Zahl „2“ nennen.

Das Spiel blieb aktiv und verbrauchte für die Zahl einen Versuch. Gleichzeitig
entstand aus dem vorherigen Gesprächsthema eine gewöhnliche pausierte Aufgabe.
Die eigentlich zum Spiel gehörende Unterbrechung hatte damit zwei falsche
Folgen. Der bestehende Gesprächsgrenzentest bestand trotzdem, weil er nur
Aufgabenpausen und das endgültige Spielende prüfte.

Der neue PCM-/WebRTC-Test zeigte vor der Kernänderung dieselbe Lücke über die
tatsächlichen Transkriptpfade: Erwartet war `paused`, beobachtet wurde `active`.
Die Baseline verwendet vorgegebene Texttranskripte und belegt keine
Spracherkennungsqualität.

## Umsetzung und Zuständigkeit

Das Spiel erhält den ausdrücklichen Zustand `paused`. Eine erkannte direkte
Pause wie „Warte kurz“ oder „Lass uns später weitermachen“ unterbricht jetzt
diese Runde. Geheimzahl, Rundennummer, letzter Hinweis und verbleibende Versuche
bleiben gleich. Eine Zahl oder eine andere Frage während der Pause ist kein
Spielzug und setzt die Runde nicht stillschweigend fort.

„Weiter“ beziehungsweise „Ich bin wieder da“ nimmt die noch gültige pausierte
Runde wieder auf. Es beginnt kein neues Spiel. „Lass gut sein“, „Beende das
Spiel“ und der vorhandene Spielbeenden-Befehl schließen sie weiterhin. Ein
neuer ausdrücklicher Spielstart darf eine neue Runde erzeugen.

Die Pause gehört zum Spiel. Sie legt keine gewöhnliche Aufgabe aus dem letzten
Gesprächsthema an. Eine schon vorhandene andere Aufgabe bleibt erhalten; die
Rückkehr zum Spiel nimmt sie nicht nebenbei wieder auf. Gemeinsame
Objektversuche behalten ihre eigene benannte und bestätigte Wiederaufnahme.
Ein noch offenes Spiel, auch ein pausiertes, bleibt ein Konflikt für einen
gleichzeitigen formalen Objektversuch oder dessen Start-Ritual.

Die bestehende fünfminütige Inaktivitätsgrenze gilt auch für die Pause. Ihr
Zeitpunkt wird beim tatsächlichen Übergang gesetzt; wiederholtes Warten und
andere Gesprächsbeiträge verlängern sie nicht. Eine abgelaufene oder beendete
Runde lebt durch „Weiter“ nicht wieder auf. Die Spielsitzung wird nicht als
dauerhafte Erinnerung gespeichert.

Ein Wechsel in Hintergrund, Fokusverlust, Schlaf, Roboterbewegung, ein
tatsächlicher Disconnect oder eine geänderte Behavior-Konfiguration parkt eine
aktive Runde. Zurückkehren in den Vordergrund oder Bewegungsende allein setzt
sie nicht fort. Während Bewegung nimmt die Engine weder Zahlen als Spielzug
noch eine Rückkehr als Wiederaufnahme an. STOP-/Cliff-/Schlaf-/Disconnect-
Unterbrechungen beenden auch eine pausierte Runde; Sitzungsende verwirft sie.
Normale Sprachkanten und die interne Unterbrechung vor einer manuell
angeforderten Antwort pausieren dagegen nicht jeden Spielzug erneut.

Die Engine besitzt diese Regeln und die Ablaufbereinigung. Ihre öffentliche
Zustandsschnittstelle bekommt nur einen weiteren Status; es entstehen keine
zusätzlichen Spielbefehle, Persistenzformate oder Bewegungserlaubnisse. Runtime
und Sprachadapter verarbeiten aktive und pausierte Spielturns weiterhin erst
nach dem aktuellen Transkript. Antwort- und Decisions-Kontext nennen den
Pausenzustand und warten auf ausdrückliche Wiederaufnahme; die Geheimzahl
erscheint dort nicht.

Die vorhandene Schaltfläche „Spiel beenden“ behält während der Pause ihre
Beenden-Aktion und startet keine Ersatzrunde. Die Oberfläche erhält keine
neuen Bedienelemente oder Gestaltung. Ihr bestehender Render-/Handler-Test
prüft diese Entscheidung in allen vier Sprachen; eine native visuelle Abnahme
ist das nicht.

## Abwägung und Prüfung

Ein Spiel bei jeder Pause endgültig zu schließen wäre einfacher, würde aber
den gemeinsamen Zwischenstand verlieren. Ein zweites unabhängiges Pause-Flag
neben `active` würde widersprüchliche Kombinationen ermöglichen. Der eigene
Status hält Ablauf, Rateversuche und Wiederaufnahme in der bestehenden Engine.
Die bisherige Ablaufgrenze bleibt erhalten; ein stundenlanges Speichern von
Spielständen ist nicht Teil dieses Ausbaus.

Die Änderungen liegen in `src/behavior/behavior-types.ts` und
`src/behavior/behavior-engine.ts` (Zustand und Übergänge),
`src/behavior/behavior-runtime.ts` (Antwortfreigabe und Handsignal-Konflikt) und
`src/ui/BehaviorSettings.tsx` (bestehende Beenden-Aktion während der Pause).
`package.json` bindet die Regressionen in die bestehenden Companion-Prüfungen
ein; `USER_GUIDE.md` beschreibt die nutzbaren Befehle.

`scripts/companion-game-pause.test.mjs` prüft die tatsächliche Engine mit
injizierter Uhr und lokalen vorgegebenen Decisions-Antworten. Der öffentliche
Runtime-/Eventpfad wird zusätzlich durch den tatsächlichen PCM- und
WebRTC-Transkriptpfad im bestehenden Integrationsprüfstand ausgeführt.
Kamera, Mikrofon, Anbieterzugang und Hardware bleiben dort ersetzt.

Die unabhängige Prüfung fand zwei zusätzliche Übergangslücken: Die Aktivitätssperre
musste bei einem offenen Spiel weiterhin für alle Aktivitätsaktionen gelten,
und die Engine musste den tatsächlich verwendeten lokalen STOP-Grund
`voice-emergency-kws` erkennen. Beides ist korrigiert. Der neue Test
`scripts/companion-game-runtime.test.mjs` speist diesen Grund zusammen mit einem
erhöhten `stopGeneration` in den ersetzten Roboterzustand ein und führt den
tatsächlichen Runtime-Subscriber und die Engine aus. Er prüft aktive und
pausierte Runden, ausbleibendes Wiederaufleben und den Bewegungsübergang.
Das belegt die lokale Weitergabe; eine akustische Erkennungsprüfung ist es nicht.

Die gemeinsame lokale Prüfung ist:

```sh
pnpm run companion:offline-test
```

Sie enthält auch den bisherigen Erinnerungsabruf, die beschreibende Suche,
Kapazitätsgrenzen und Reparatur verworfener Antworten. Grün in diesen Tests
belegt Zustands- und Protokollverhalten. Es belegt weiterhin weder natürliche
Modellantworten noch tatsächliche Sprache, Roboterwirkung oder Freude am Spiel.

## Beobachteter Abschlussstand

- `pnpm run companion:offline-test`: PASS, einschließlich Engine-Zustand,
  tatsächlicher Runtime-Weitergabe, PCM-/WebRTC-Transkriptpfad und
  Settings-Render-/Handler-Prüfung in Deutsch, Englisch, Ukrainisch und Russisch.
- `node scripts/companion-live-runtime.test.mjs`: PASS; alle sechs isolierten
  Offline-Fixtures bestehen auch mit dem erweiterten Roboterzustands-Mock.
- `pnpm run ios:check`: PASS auf dem abschließenden Quellstand, einschließlich
  TypeScript sowie der bestehenden lokalen Sprach-, Runtime-, Safety-,
  Companion-, Aktivitäts- und Turn-Taking-Prüfungen.
- Offline-iOS-Export: PASS mit
  `EXPO_OFFLINE=1 pnpm exec expo export --platform ios --output-dir output/companion-game-pause-ios-export`.
  Bundle: `entry-6ffd3ccbd7a25b6814d8e393417a3ac9.hbc`.
- Eine zweite unabhängige Codeprüfung bestätigte die korrigierten Konflikt-,
  Bewegungs- und lokalen STOP-Übergänge; sie führte selbst keine Tests aus.

Es wurde kein Anbieter aufgerufen, kein Simulator gestartet und kein physischer
Roboter bewegt. Der Export ist ein JS-/Asset-Build, kein nativer Xcode-Build.
