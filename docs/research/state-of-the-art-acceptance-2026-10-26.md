# Abnahme des Ziels „State of the Art“

Stand: 26. Oktober 2026. Der ursprüngliche Auftrag bleibt: recherchieren und
umsetzen, damit Bewegung, Verhalten und Entscheidungen einen realistischen,
angenehmen Roboter-Companion ergeben. Weitere Rückfragen wurden nicht gewünscht.
Der tatsächliche LOOI ist noch nicht vorhanden; bis dahin sollen Roboterzustand
und Bewegungsbefehle mockbar sein. Erfolgreiche Softwareprüfungen sind deshalb
wichtige Liefernachweise, aber keine Messung menschlicher Wahrnehmung.

**Fortschreibung:** Der Mac war in der anschließenden Runde wieder bedienbar.
Die native Simulatorprüfung fand und bestätigte einen Fehler des bisher
unsignierten Testpakets: Die Mock-Auswahl ließ sich nicht in SecureStore
speichern. Der lokale Signierpfad ist korrigiert; Auswahl und Verbindung
überstehen nun einen vollständigen App-Neustart. Auch die vorbereitete
Gerätefassung wurde inzwischen auf dem wieder erreichbaren iPhone installiert
und gestartet. Dessen Bildschirm ist weiterhin gesperrt, sodass die aktuelle
physische Bedienabnahme offenbleibt. Den aktuellen Nachweis enthält der
[Mock-Persistenzbericht](simulator-mock-persistence-2026-10-26.md).
Die folgenden Zugangsangaben beschreiben den vorherigen Prüfstand.

Die vorherigen Runden waren Fortschritt: gemeinsamer Ausdruck, Aufgabenbezug
der lokalen Aufmerksamkeit und wählbarer semantischer Gesprächswechsel wurden
implementiert. Diese Prüfung erweitert den Auftrag nicht um neue Funktionen.
Sie gleicht den vorhandenen Stand mit dem
[Ausdrucksbrief](state-of-the-art-expression-2026-10-26.md), dem
[Phase-2-Brief](lebendigkeit-phase-2-2030-2026-10-26.md) und der
[Companion-Abnahme](companion-goal-acceptance-2026-10-26.md) ab.

## Anforderung für Anforderung

| Erwarteter Ausgang | Autoritative Software-Evidenz | Was die Evidenz nicht abnimmt |
|---|---|---|
| Zusammenhängender Ausdruck aus Blick, Geste und Rückkehr | `behavior-expression.ts`, echter Engine-/Runtime-Pfad; Phasen, Fristen, Unterbrechung und Besitz in `behavior-expression.test.mjs`, `behavior-runtime-moments.test.mjs`, `behavior-runtime-timing.test.mjs`; native Fixture verwendet dieselbe `RobotFace`-Komponente | Noch keine sichtbare native Phasenabnahme oder gemessene Bewegung eines LOOI; Browser- und Fixture-Replay sind getrennte Diagnosen |
| Verständlicher Bezug auf Person, Gegenstand und gemeinsamen Handlungsschritt | Explizite Auswahl, bestätigte Session-/Task-/Episode-/Korrekturversion, befristeter lokaler Track; echte Engine/Event-/Objekt-Runtime in `object-activity-runtime.test.mjs`, Referenz-/Gaze-/Auswahlprüfungen; zusätzlich tatsächlicher nativer Tracker auf erzeugten Frames und Replay der Messungen durch die echte TS-Policy | Kameralebenszyklus bleibt im Offline-Nachweis ersetzt. Synthetische Verdeckungs-/Distraktorgrenzen sind sichtbar; natürliche Clips, Lichtwechsel und Verständnis des Blicks durch Menschen sind weiter offen |
| Denkpausen respektieren und nach Unterbrechung richtig reagieren | Gemeinsamer Konfigurations-Builder, Preference-Migration, tatsächlicher Start/Stopp/Neustart beider Realtime-Dienste mit ersetzten externen Schnittstellen; `realtime-turn-taking*.test.mjs`, Referenzreparatur-/Sessionprüfungen | Kein echter semantischer VAD-Durchlauf oder gepaarter Sprachvergleich auf dem iPhone; Profileinstellung und API-Schema beweisen keine bessere Gesprächsqualität |
| Bestätigte Geschichte, aktuelle Tätigkeit und freiwillig gewählte Eigenheiten behalten | Companion-, Shared-Activity-, persönlicher-Ritual-, exakter Recall- und Continuity-Pfad mit Bestätigung, Herkunft, Pause/Korrektur/Vergessen; entsprechende Engine-/Voice-Suites | Freie echte Modellantworten, Erinnerung über Tage und angenehme Wiederholungsdosis sind nicht ausreichend abgenommen |
| Begrenzte, aktuelle Entscheidungen statt verspäteter Reaktionen | Engine-/Runtime-Timing, Cues mit ursprünglicher Startfrist, Budget und Stale-Abbruch; ein zuvor erfolgreicher tatsächlicher Decisions-Check mit 1.480 ms motiviert die geprüfte Antwortendefrist | Ein einzelner API-Aufruf ist keine Latenzverteilung und kein tatsächlicher Motor- oder Gesprächsbeweis |
| Ohne vorhandenen Roboter entwickeln und testen können | Eigener Mock-Transport, auswählbare Verbindung und Sensorfälle; reale Controller-/Interlock-Pfade, Debug-/Rehearsal-Suites; ältere iPhone-Mock-Abnahme liegt vor | Die ältere installierte Fassung nimmt neue Auswahl-, Replay- oder Gesprächszeilen nicht automatisch mit ab. Ein Mock belegt keine Kalibrierung des echten Roboters |
| Einrichtung und Bedienung auf dem tatsächlichen iPhone funktionieren | Frühere Hochformat-/Einrichtungs-/Mock-Abnahme; aktuelle native Release-Pakete werden gebaut | Die neuesten Änderungen sind noch nicht auf diesem iPhone installiert oder sichtbar geprüft; aktuelle Computerbedienung ist gesperrt, Gerät `unavailable` |
| OS-Einstellung „Bewegung reduzieren“ bleibt wirksam | Ausdrucks-Runtime, Rehearsal und jetzt auch Hauptgesicht besitzen Revision-Schutz. Der gezielte Test reproduzierte erst das Überschreiben durch eine ältere Abfrage und besteht nach der Korrektur | Die sichtbare native Animation und ihr Abschalten wurden in diesem aktuellen Stand noch nicht direkt am Gerät geprüft |

Die konkreten einzelnen Datenwege und ihre Quellen stehen in
[gemeinsame Aufmerksamkeit](joint-attention-implementation-2026-10-26.md) und
[Gesprächswechsel](semantic-turn-taking-2026-10-26.md). Diese Tabelle ersetzt
keine dieser Einschränkungen durch eine pauschale grüne Gesamtmarke.

## Aktueller Geräte- und Buildzustand

Der abschließende vollständige `pnpm run ios:check` besteht nach der
Gesichtskorrektur einschließlich neuer Accessibility-, Aufmerksamkeits- und
Realtime-Lebenszyklusprüfungen. Protokoll:
`/private/tmp/my-looi-accessibility-final-ios-check.log`.
Die nativen `iphoneos`- und `iphonesimulator`-Buildlogs enden mit
`BUILD SUCCEEDED`. Der aktuelle Simulatorstand wurde im eigenen Testgerät
installiert und gestartet; ein laufender Prozess wurde danach geprüft. Das
bestätigt noch keine sichtbare Bedienfolge.

Ein unabhängiger Signaturcheck beobachtete zwischenzeitlich
`CSSMERR_TP_NOT_TRUSTED`. Die direkt folgende Prüfung desselben aktuellen
Gerätepakets durch den Hauptprozess lieferte Exit 0 für
`codesign --verify --deep --strict`; die Apple-Development-, WWDR- und
Apple-Root-Kette war lesbar. Es wurde keine Vertrauenseinstellung verändert.
Das temporäre Prüfergebnis wird nicht als bewiesener Quellcodefehler ausgegeben.
Nach der abschließenden Gesichtskorrektur bestehen beide Release-Builds und
die erneute `codesign --verify --deep --strict`-Prüfung des tatsächlich neu
gebauten Gerätepakets. Die Logs liegen unter
`/private/tmp/my-looi-accessibility-final-device-build.log` und
`/private/tmp/my-looi-accessibility-final-simulator-build.log`. Auch der neue
Simulatorstand wurde installiert und gestartet. Die vorhandenen Offline-
Sprachmodelle bleiben enthalten.

Die Computerbedienung meldet den Mac im dritten aufeinanderfolgenden
Ziel-Durchlauf weiterhin als gesperrt. `devicectl` meldet das physische iPhone
weiterhin als `unavailable`. Es wurde kein Geräteschlüssel ausgelesen,
kein neues Mikrofon-/Kamerarecht erteilt und kein echter Roboter bewegt.
Der ältere fehlgeschlagene Shell-Realtime-Versuch beweist nicht, dass der
bereits in der App gespeicherte Geräteschlüssel ungültig ist. Die offene
Sprachabnahme soll die bestehende App-Einrichtung verwenden.

## Abschlusskriterium und nächster ausführbarer Schritt

Die neue Software kann erst als vollständig abgenommen gelten, wenn die
zugehörigen sichtbaren Abläufe und tatsächlich gesprochenen Modellantworten
auf passender Laufzeit geprüft wurden. Für den gegenwärtigen Mock-Umfang braucht
das keinen bereits gelieferten LOOI: Ein zugängliches iPhone beziehungsweise
eine sichtbare native Testoberfläche reicht für die Bedien- und Displayprüfung.
Echte Motorqualität bleibt bis zur Hardwarelieferung ausdrücklich offen.

Sobald der Gerätezugang wieder besteht, sind die vorhandenen konkreten
Prüfabläufe auszuführen: Hochformat/Einrichtung, Mock-Verbindung und STOP,
Gesichtsphasen und reduzierte Bewegung, Region-/Aktivitätsauswahl mit ungültig
gewordenem Bezug, Realtime-Profilwechsel erst nach Neustart und echte
sprachliche Korrektur. Ein gepaarter Sprachvergleich muss Denkpausen und
Unterbrechung gemeinsam mit Verzögerung bewerten; Code-Eventzeiten allein sind
kein akustisches Turn-Ende. Die bisherigen Einwilligungen bleiben bestehen;
hier wird keine erneute Freigabe verlangt.

Freie Gespräche, Trackingqualität und angenehm wirkendes Verhalten benötigen
weiter die in den verlinkten Berichten benannten tatsächlichen Eingänge und
Bewertungen. An ihrer Stelle weitere Optionen oder Gesten hinzuzufügen würde
diesen Evidenzmangel nicht beheben. Ein unabhängiger Review hat außer dem
genannten Reduce-Motion-Randfall keine weitere notwendige Softwarelücke
für die derzeit geplanten Bauabschnitte benannt.

## Reproduzierte und korrigierte Lücke

`src/ui/RobotFace.tsx` startete die anfängliche OS-Abfrage und übernahm deren
Wert beim späteren Promise-Abschluss allein unter einem Mount-Guard. Ein neueres
`reduceMotionChanged(true)` konnte daher durch das ältere Ergebnis `false`
überschrieben werden. Der neue `scripts/robot-face-accessibility.test.mjs`
führte die tatsächliche TSX-Komponente mit einem kleinen Hook-/JSX-Renderer und
kontrollierten nativen Abhängigkeiten aus. Vor der Korrektur scheiterte die
Assertion am wirklichen `ExpressiveMouth.motionActive`: Nach neuerem `true`
und älterem Query-Ergebnis `false` war Bewegung wieder aktiv.

Die Komponente registriert jetzt zuerst den Listener, zählt dessen Änderungen
und akzeptiert die Initialabfrage nur, solange kein neueres Ereignis vorliegt.
Der Mount-Guard schützt auch bereits eingeplante Event-Callbacks nach Cleanup.
Es wurden weder Gesichtsgeometrie noch Bewegungskurven geändert.

Nach der Korrektur bestehen beide widersprüchlichen Reihenfolgen, eine normale
Initialabfrage ohne neueres Ereignis und eine nach dem Unmount aufgelöste
Abfrage samt bereits eingeplantem Listener-Callback. Der Test zählt späte
Zustandsänderungen erst nach dem regulären Focus-Cleanup; dessen normales
Zurücksetzen wird nicht fälschlich als nativer Late-Callback gewertet.

`pnpm run behavior:expression-test` besteht mit Sequenz, isolierter nativer
Fixture und neuer Accessibility-Prüfung; `pnpm exec tsc --noEmit` besteht.
Die neue Prüfung ist in der Ausdrucks-Suite und damit im iOS-Gesamtlauf
registriert. Ihre JS-/Komponentenbeobachtung beweist die Reihenfolge, keine
Pixelanimation eines laufenden iPhones.

## Ergebnis dieser Runde

Die nachgewiesene Racecondition am Hauptgesicht ist korrigiert; gezielte Prüfungen,
vollständiger iOS-Check, beide native Release-Builds und Signaturprüfung
bestehen. Die sichtbare Abnahme bleibt blockiert. Das übergeordnete Ziel
ist damit weiterhin nicht als erreicht belegt.

Der im Phase-2-Brief benannte Offline-Wahrnehmungspfad erwies sich als weiterer
ausführbarer Schritt trotz gesperrter UI. Nach erfolgreicher Machbarkeitsprüfung
verwenden App und Offline-Harness jetzt dieselbe native Tracking-Implementierung.
Der tatsächliche Probe-Lauf konnte Samples sammeln und zeigt unter anderem
akzeptierte Tracks bei vollständiger Verdeckung. Das ist weitere konkrete
Evidenz und noch kein bestandener Trackingvergleich. Quellen, gemessene Werte,
Bericht mit Code-Hashes und Grenzen stehen in der
[nativen Trackingprüfung](native-tracking-evaluation-2026-10-26.md).
Nach der Extraktion bestehen erneut `ios:check`, beide nativen Release-Builds
und die strikte Signaturprüfung des Gerätepakets. Der aktualisierte
Simulatorstand wurde installiert und gestartet; der Prozess blieb aktiv.
Die aktuellen Logs heißen `/private/tmp/my-looi-native-tracker-ios-check.log`,
`/private/tmp/my-looi-native-tracker-device-build.log` und
`/private/tmp/my-looi-native-tracker-simulator-build.log`.
Die gespeicherten nativen Messungen wurden außerdem mit der tatsächlichen
TypeScript-Policy nachgespielt: Ein verdeckter Folgeframe wird akzeptiert,
bevor niedrige Konfidenz den Bezug beendet. Alle sechs Frames des mehrdeutigen
Distraktors bestehen auch die Policy. Die aktive Anzeige und Verlusttexte
beschreiben deshalb jetzt in allen vier Sprachen den ausgewählten Bereich,
ohne Gegenstandsidentität oder Unsichtbarkeit zu behaupten. Der Modellkontext
war bereits entsprechend begrenzt. Das löst keine Wahrnehmungsmehrdeutigkeit.

Nach dieser Statuskorrektur bestehen Aufmerksamkeitssuite, beide erneuten
Release-Builds und Signaturprüfung; auch diese Fassung ist im eigenen Simulator
installiert und gestartet. Quellen, aktuelle Logs und der Policy-Replay stehen
in der verlinkten nativen Trackingprüfung. Ein Vergleich möglicher weiterer
Wahrnehmungsregeln begründet noch keine Produktionsänderung ohne getrennte
annotierte Eingänge.

Die unabhängig ausführbaren Arbeiten dieser Runde sind damit ausgeführt.
Die verbleibende sichtbare Geräte-/Sprachabnahme benötigt einen zugänglichen
Mac beziehungsweise das eingerichtete iPhone. Derselbe Zugang fehlt im dritten
aufeinanderfolgenden Ziel-Durchlauf. Das übergeordnete Ziel ist nicht erreicht;
weitere erfundene Schwellen oder zusätzliche Features würden diese offene
Abnahme nicht ersetzen.
