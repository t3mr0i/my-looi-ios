# LOOIs Gesprächscharakter

## Fortsetzung am 29. Oktober: Budget-Stimmung bis zur Stimme

Eine erneute Prüfung des vollständigen Budget-Pfads fand einen Unterschied
zwischen Antworttext und Stimme: Der Textmodell-Aufruf las den Charakter mit
dem aktuellen Nutzertext. Vor jedem gesprochenen Teilstück las die
Sprachausgabe ihn erneut mit leerem Text. Dadurch verschwand ein vorübergehender
Rückschlag wie „Gerda hat heute keinen Spaß gemacht“ aus dem TTS-Kontext.
Gespeicherter ruhiger Stil funktionierte weiterhin; das betraf den aktuellen
Erlebnisbezug, nicht den dauerhaften Stil.

Der Produktionspfad erfasst jetzt nach der akzeptierten Transkription genau
einen Charakterkontext und verwendet ihn für Antworttext und alle Teilstücke
dieser Antwort. Ein Folgethema erhält seinen eigenen Kontext. Lokale Hinweise
ohne akzeptierten Nutzertext verwenden weiterhin nur den allgemeinen
Charakter. Die bestehende Epoch-/Abbruchprüfung bleibt vor jedem Teilstück
aktiv; ein unterbrochener Durchlauf kann keinen alten Zustand zurückbringen.

Die neue Prüfung benutzt die wirkliche Behavior-Engine samt entwickeltem
Gerda-Profil im Budget-Laufzeittest. Vor der Korrektur fehlte im ersten
TTS-Aufruf nachweislich `conversationMoment`; danach übernehmen alle Clips
denselben negativen Moment und die tatsächliche Delivery-Regel wählt ruhig.
Ein absichtlich zwischen Clips geänderter Kontext verändert die laufende
Antwort nicht. Der anschließende Themenwechsel übernimmt den Rückschlag
nicht. Das prüft die erzeugten Anfragen, noch keine akustisch gehörte Ausgabe.

Zusätzlich verlangt die mechanische Abnahme des ruhigen Live-Falls nun
ausdrücklich ruhige Energie und gedämpfte Spiellust. Manipulierte Ergebnisse
mit ausgeruhter Energie oder spielbereiter Stimmung fallen durch.

Der erneute reine CLI-Zugangstest am 29.10.2026 erhielt HTTP 401 und startete
keine Inferenz. Bereinigter Nachweis:
`output/personality-live-evaluation/access-readiness-2026-10-29.json`.
Der Nutzer hat iPhone und physischen LOOI für die Geräteabnahme bereitgestellt.
Der parallele Chat „Response-Zeit auf Millisekunden sen“ hat den aktuellen
signierten iPhone-Stand gebaut und erfolgreich installiert; hier wurde kein
zweiter nativer Build gestartet. Die nachträgliche Budget-Korrektur wurde vor
der Installation in einen gesonderten finalen Hermes-Export aufgenommen und
das Paket danach erneut signiert und geprüft.

Der erfolgreiche `devicectl`-Installationsbeleg gehört zu Version 2.1.151,
Build 41 mit Bundle-SHA-256
`1dccdc775de8891c61fd23340048a124e0b565a1f19a26f3947acda4b984fab2`.
Die eingefrorenen Quellen für Charakter, Companion, Engine, Runtime,
Budget-Gespräch und TTS stimmen mit dem hier geprüften Stand überein. Der
eingefrorene Budget-Code enthält sowohl die Aufnahme des aktuellen Kontexts
als auch dessen Weitergabe an die vollständige Sprachantwort. Der lokale
zusammengefasste Beleg liegt unter
`output/personality-live-evaluation/iphone-installation-2026-10-29.json`;
Build-, Quell- und Installationsbelege liegen unter
`output/voice-latency-install-2026-10-29/`.

In Device Hub wurde der Start dieser neu installierten Fassung mit den neuen
Augen und der Anzeige „Bereit. Sprich, ich höre zu.“ beobachtet. Das belegt
den sichtbaren Start, keine erkannte Nutzereingabe oder gehörte Modellantwort.
Für die erste echte Gesprächsprobe wurden die drei Sätze „Guten Morgen, LOOI“,
„Sei ruhiger“ und „Was magst du inzwischen?“ angefragt. Der Nutzer meldete
anschließend: „reaiert gar nicht“. Der API-Schlüssel der App wurde nicht
ausgelesen oder exportiert.

### Geräteprobe: keine Reaktion vor dem Antwortlauf

Die neue Diagnose nach dieser Rückmeldung zeigt beim Neustart um 12:46:49 UTC
Budget und einen laufenden PCM-Transport. Von 12:46:51 bis 12:47:09 UTC kamen
18 Health-Fenster an, jeweils mit `peak = 0`, `maxRms = 0` und ohne erkannte
VAD-Sprache. Im beobachteten Abschnitt gab es keinen Antwortlauf. Das ist ein
belegter stummer Eingang im JavaScript-Pfad, noch keine eindeutige Ursache in
Mikrofon, Routing oder nativer Konversion. Der bereinigte Befund liegt unter
`output/personality-live-evaluation/no-reaction-2026-10-29.json`.

Der Nutzer erlaubte ausdrücklich die Abstimmung mit dem Chat
„Response-Zeit auf Millisekunden sen“. Dort liegt die Verantwortung für
Aufnahme-Reparatur und Gerätebedienung; dieser Chat verändert die betreffenden
Audioquellen währenddessen nicht parallel. Die Persönlichkeitsprobe bleibt
fehlgeschlagen vor ihrem eigentlichen Gesprächseingang und ist keine negative
oder positive Bewertung des neuen Charakters.

Eine unabhängige synthetische Probe hat den tatsächlich installierten
Swift-Delegate-Zweig für `pcmFloat32` mit bekannten Int16-Daten ausgeführt.
Die resultierenden positiven und negativen Werte blieben anschließend durch
den wirklichen JavaScript-Feeder bis zum Samples-Abonnenten exakt erhalten,
sowohl als Array als auch als Float32Array. Dieser Übergang setzt gültige
Beispieldaten nicht auf null. Mikrofonaufnahme, AVAudioConverter und das
Geräterouting wurden damit nicht geprüft. Der Beleg einschließlich
Swift-Quellhash liegt unter
`output/personality-live-evaluation/audio-boundary-2026-10-29.json`.

Die anschließende native D1-Geräteprobe bestätigt bereits vor Konversion einen
stummen Float32-Eingang bei 48 kHz: In den hier unabhängig gelesenen 20
Probeeinträgen waren Roh- und konvertierter Pegel durchgehend null. Eingebautes
Mikrofon, verfügbare Eingabe und laufende Engine wurden gleichzeitig gemeldet.
D2 meldete zusätzlich ausgeschaltete App- und Voice-Processing-Stummschaltung.
D3 änderte allein die Kategorie von Record auf PlayAndRecord; auch dort
blieben neun native Proben stumm. Es ist deshalb keine Kategorie-Reparatur
belegt, und diese Diagnosevariante wird nicht als Produktionskorrektur
übernommen.

Für den nächsten kausalen Vergleich wurde im abgestimmten Geräte-Testfluss
eine kurze lokale Sprachmemo angefragt: Pegelausschlag und vor Ort hörbare
eigene Stimme, ohne Export der Aufnahme. Bei funktionierendem Systemrekorder
ist anschließend der zweite vorhandene lokale Capture-Pfad zu prüfen; bei
ebenfalls stummer Sprachmemo zuerst das geräteweite Problem. Ein Erfolg dieses
Vergleichs und eine Persönlichkeitsantwort sind weiterhin nicht bestätigt.
Der Geräte-Chat hat die reguläre aktuelle App wiederhergestellt und die
Installationsadresse gegen den Rückinstallationsbeleg geprüft. Das reguläre
Bundle besitzt weiterhin den oben dokumentierten SHA-256; Diagnosepoll und
temporäre native Probe-Felder sind entfernt. Die App wurde danach nicht
automatisch geöffnet, damit der manuelle Vergleich ungestört bleibt.
[Wiederherstellungs- und Diagnosebeleg](evidence/voice-zero-input-status-2026-10-29.json).

## Vollständige Entwicklung über drei Zeitskalen

Die aktuelle lokale Umsetzung trennt jetzt folgende Zustände. Alle Schwellen
sind bewusst gesetzte Startwerte; sie sind nicht durch eine Nutzerstudie belegt.

| Ebene | Gespeicherte Grundlage | Wirkung |
| --- | --- | --- |
| Wesenskern | Versioniertes Profil `gentle-curious` | Zugewandt, neugierig, leichter beobachtender Humor und kurze natürliche Formulierungen; derselbe Kern in Realtime und Budget. |
| Langsame Entwicklung | Bestätigte Episoden samt Interessen und bis zu 32 Beziehungstage | Passende Interessen, zunehmend gelöste Ausdrucksweise und etwas länger ausklingende Streichelreaktion. |
| Moment | Symbolische Energie und Zeitpunkte tatsächlicher Aktivität, Streicheln und positiver Rückmeldung | Vorübergehend ruhiger, zufrieden oder spielfreudiger; der Kern und etablierte Interessen bleiben erhalten. |

Ein Beziehungstag entsteht durch eine lokal erkannte, tatsächlich akzeptierte
Streichelgeste oder einen eindeutigen positiven Bericht zu einer bestätigten
Episode. Ein rollender Abstand von 24 Stunden trennt die Tage; wiederholte
Gesten am selben Tag beschleunigen die Entwicklung nicht. Pro Tag bleiben nur
Zeitpunkt, ein Streicheln-Merkmal und höchstens acht Episoden-IDs gespeichert.
Allgemeine Gesprächsmenge, Modellantworten, Fragen, Zitate und ausgeschaltetes
Lernen bauen keine Beziehung auf. Es gibt ein gemeinsames Geräteprofil und
keine Zuordnung zu einer erkannten Person.

Nach drei Beziehungstagen über mindestens zwei Tage darf die Ausdrucksweise
etwas vertrauter werden. Sieben Tage über mindestens sechs Tage ergeben eine
vertraute, 14 Tage über mindestens 20 Tage eine gelöstere Beziehung. Die
Gesprächsanweisung beschreibt diese Unterschiede ohne Stufen oder Zahlen
auszusprechen. Sie erlaubt keine erfundenen Erinnerungen und setzt keine
Vertrautheit mit einer bestimmten anwesenden Person voraus. Abwesenheit
verringert den Zustand nicht und erzeugt keine Einsamkeit oder Aufforderung
zur Zuwendung.

Home übernimmt eine Streichelgeste erst nach den vorhandenen Kontroll- und
Sprachvorrangregeln. Die Laufzeit prüft zusätzlich Fokus, Vordergrund,
Sprachverarbeitung und Fahrsteuerung; die Engine prüft Active, Wachzustand,
Motorbesitz und laufende Sprache. Nur dann wird der bestehende lokale Speicher
aktualisiert. Die vorhandene `petted`-Reaktion dauert je nach Vertrautheit 1100,
1300 oder 1450 ms; ruhiger Stil oder ruhige Energie begrenzen sie auf 900 ms.
Die Anpassung startet weder eine Stimme noch eine Bewegung. Abgelehnte
Eingaben schreiben keine Beziehungsgeschichte.

Symbolische Energie verbraucht pro akzeptiertem Gesprächsimpuls 0,012 Punkte,
höchstens einmal in 30 Sekunden, bis zu einer Untergrenze von 0,25. Zeit lässt
sie mit einem Punkt pro Stunde bis 1 erholen. Unter 0,45 wird der Ausdruck
ruhiger; nach anhaltend dichter Interaktion betrifft das auch einen sonst
optionalen fröhlichen Akzent. Die Hilfsfähigkeit bleibt erhalten. Das ist ein
Gestaltungszustand, keine Messung von Akku, Erschöpfung oder menschlichem
Gefühl. Neustarts bewahren den Energieanker. Ein anerkannter Streichelkontakt
färbt bis zu drei Minuten zufrieden, positives Erlebnisfeedback bis zu zehn
Minuten spielerischer. Expliziter ruhiger Stil, ernster Inhalt und aktuelles
negatives Feedback haben Vorrang. Der Budget-Sprachrenderer übernimmt diese
Richtung, ohne zusätzliche Wörter oder Geräusche zu erfinden.

Die Beziehungstage werden bei Abwesenheit nicht abgeschnitten; nach mehr als
32 tatsächlichen Beziehungstagen ersetzt der nächste den ältesten Eintrag.
Eine Episode zu vergessen entfernt auch alle ihre Beziehungsreferenzen.
Unabhängige Streichelbelege bleiben erhalten. „Lernen löschen“ setzt Beziehung,
Energie, Interessen und Stil zurück. Alte Profile beginnen ohne erfundene
Beziehungstage. Defekte kurzfristige Energiedaten verwerfen keine ansonsten
gültige Beziehungsgeschichte.

## Abnahmenachweis und offene echte Nutzung

Der gezielte nächste Modellvergleich ist als Suite `personality` in der
vorhandenen Live-Teststrecke vorbereitet. Sechs isolierte Fälle vergleichen
eine neue und eine über 22 synthetische Beziehungstage entwickelte Begrüßung,
eigene Interessen, einen enttäuschenden Versuch, gespeicherten ruhigen Stil
und eine ruhige Reaktion auf einen ernsten aktuellen Satz. Die Profile entstehen
mit den Produktionsregeln und werden über den normalen Engine-Leser
wiederhergestellt. Dabei werden weder die echte Gerätezeit noch persönliche
Gerätedaten verändert.

Der lokale Protokolltest prüft den tatsächlich gesendeten Realtime-Kontext,
den Produktions-Router für `list_companion_interests` samt Ergebnis und die
getrennten Zustandsebenen. Auch Budget-Textanweisung und Betonungsrichtung
verwenden den aus diesem Pfad erfassten Charakterkontext. Der Bericht enthält
einen begrenzten Auszug aus Kern, Vertrautheit, Energie, Stimmung und
Interessenstatus, ohne Streichelzeitpunkte oder Beziehungstage zu exportieren.
Vorgegebene Serverantworten bleiben ausdrücklich `test_harness_only`.

```sh
pnpm run companion:live-eval --suite personality
pnpm run companion:live-eval --suite personality --live --output output/personality-live-evaluation/model-report.json
```

Der erste Befehl ist eine reine Fallübersicht ohne Zugang oder Netzwerk. Der
zweite benötigt einen gültigen lokalen `OPENAI_API_KEY` und startet höchstens
die bestehenden sechs Fälle innerhalb der unveränderten Anfrage- und
Zeitgrenzen. Erst echte Antworttexte ermöglichen den Vergleich. Auch bei
mechanisch erfüllten Regeln bleibt eine menschliche Qualitätsbewertung nötig;
Textausgabe belegt keine gehörte Stimme oder Wirkung am Roboter.

| Anforderung | Aktueller Nachweis | Noch offen |
| --- | --- | --- |
| Stabiler Kern bei Entwicklung und wechselnder Stimmung | Produktionsmodule über 35 simulierte Tage samt Neustarts; gemeinsamer Realtime-/Budget-Prompt | Wahrgenommene Wiedererkennbarkeit in echten Gesprächen |
| Langsame Interessen und Beziehung | Drei-Tage-Interessenprüfung, 35-Tage-Beziehungsprüfung, Wiederholungsgrenzen und sechs Monate simulierte Abwesenheit | Tatsächliche Nutzung über mehrere Wochen |
| Streicheln wirkt langfristig | Echter Home-Callback, Laufzeit und Engine mit ersetzten Gerätegrenzen geprüft | Geste und Reaktionswirkung am physischen LOOI |
| Energie, Spiellust und Vertrautheit hängen zusammen | Dichte Gesprächsfolge, Neustart, Ruhe, Schlaf, Kontext und Vorzugsvorrang geprüft | Angemessene Schwellen und natürlich klingende Ausgabe |
| Budget übernimmt den Charakter | Gemeinsamer Builder, tatsächlich erzeugter Budget-Request und TTS-Anweisung lokal geprüft | Erfolgreiche Live-Modell- und Audioabnahme |
| Korrektur, Vergessen und Zurücksetzen | Direkter sowie bestätigter Gesprächs-Vergessenspfad, getrennte Quellen und vollständiges Zurücksetzen geprüft | Geräteabnahme mit existierenden Nutzerdaten |

`scripts/companion-life.test.mjs` prüft 35 beschleunigte Tage mit den wirklichen
Companion- und Engine-Modulen. Die Zustandsprüfung ist kein Nachweis für 35
Tage menschlicher Nutzung. `companion:personality-test` enthält diese Prüfung;
`companion:offline-test`, `voice:budget-test` und `behavior:expression-test`
prüfen zusätzlich die bestehenden Speicher-, Sprach- und Ausdrucksgrenzen.
Eine dichte synthetische Archivprobe mit acht Episoden, vollständigen
Interessenbelegen, Ritualen, visuellen Beschreibungen und 32 Beziehungstagen
erreichte 56.535 Zeichen. Die bisherige Einlesegrenze von 48.000 hätte dieses
Profil nach Neustart vollständig abgewiesen. Die Grenze beträgt jetzt 80.000;
die Probe prüft ausdrücklich den erneuten Engine-Import mit allen acht Episoden
und unveränderter Vertrautheit. Sie ist kein allgemeines Größenmaximum.

Die bisherige reale Modellprobe scheiterte mit HTTP 401; sie lieferte keine
Antwort für einen Vorher-/Nachher-Vergleich. Eine Geräteinventur am 28.10.2026
fand ein gekoppeltes physisches iPhone mit My LOOI 2.1.151, Build 41. Das belegt
die installierte App, weder diesen neuen JavaScript-Stand noch eine verbundene
LOOI-Hardware oder eine erfolgreiche Sprachprobe. Es wurde hierfür keine
Installation und kein Austausch persönlicher Geräte- oder Lerndaten vorgenommen.
Die erneute reine Modelllisten-Zugriffsprüfung am 28.10.2026 um 19:01 UTC
erhielt ebenfalls HTTP 401. Dabei wurde keine Inferenz gestartet; der
bereinigte lokale Nachweis liegt unter
`output/personality-live-evaluation/access-readiness.json`. Der separate
Schlüssel im SecureStore des iPhones wurde nicht ausgelesen. Eine spätere
Inventur zeigte das physische iPhone als verbunden; eine verfügbare
LOOI-Hardware ist damit weiterhin nicht belegt.

Der aktuelle gemeinsame Arbeitsstand wurde zusätzlich mit
`CI=1 pnpm exec expo export --platform ios --output-dir output/personality-ios-bundle --clear`
erfolgreich als iOS-Hermes-Bundle exportiert. Das lokale
`output/personality-ios-bundle/verification-receipt.json` hält Bundle-Prüfsumme
und ausgewählte Quellprüfsummen fest. Der Export belegt Paketierbarkeit, keine
Installation, native Ausführung, Modellqualität oder Roboter-Abnahme. Er
enthält den gemeinsamen uncommitteten Projektstand und ist kein veröffentlichter
Release.

Für die echte Abnahme: zunächst die neue Fassung auf dem Testgerät prüfen und
den konfigurierten API-Zugang herstellen. Am Anfang, nach einer und nach drei
Wochen dieselben kurzen Begrüßungen, eine Frage nach eigenen Interessen, einen
gelungenen und einen enttäuschenden Versuch vergleichen. Dazwischen nur echte
Streichelkontakte und Erlebnisse zählen, ohne die Gerätezeit zu verändern.
An jedem Vergleichstag Realtime und Budget, einen Neustart und die Bitte um
ruhigere Sprache einbeziehen. Nach gelöschter Episode darf ihr Interesse nicht
weiter genannt werden. Bewertungen und wörtliche Antworten getrennt von
technischen Zustandsprüfungen festhalten. Erst diese Gespräche können zeigen,
ob derselbe sich entwickelnde Charakter tatsächlich erlebbar wird.

## Gesprächsrichtung und vorhandene Entwicklungsschleifen

LOOI soll auf den aktuellen Gesprächsinhalt eingehen und darf eine kleine
Beobachtung oder spielerische Idee beitragen. Bei ernsten Themen bleibt die
Antwort ruhig und direkt. Diese Richtung gilt für Realtime und Budget; sie ist
eine Anweisung an das Sprachmodell und kein Nachweis für gefühlte Lebendigkeit.
Erfundene Erlebnisse, Wahrnehmungen oder ausgeführte Bewegungen bleiben tabu.

In Realtime verknüpft die lokale Verhaltenssteuerung ausdrücklich gewünschte
Gesprächsstile mit dem Gesprächskontext und den vorhandenen Reaktionsgesten:
„Sei lebendiger“ wählt verspielter, „Sei ruhiger“ gedämpfter, „Sei wieder
normal“ die Grundeinstellung. Die Vorliebe wird auf dem Gerät gespeichert,
bei „Lernen löschen“ zurückgesetzt und mit vorhandenen älteren Vorlieben
übernommen. Ein zeitlich oder thematisch eingeschränkter Satz wie „Sei heute
lebendiger“ wird nicht dauerhaft gespeichert. Die lokale Erkennung unterstützt
bewusst nur klare Formulierungen; eine nicht erkannte Bitte kann das Modell im
aktuellen Gespräch weiterhin aufgreifen, ändert aber keine lokale Vorliebe.
Realtime und Budget erhalten inzwischen denselben Grundcharakter aus
`src/character/companion-personality.ts`. Beide übernehmen die gespeicherte
Stilvorliebe; im Budget-Modus erhält auch die separate Sprachausgabe eine
passende Anweisung für die Betonung. Observe und Off schalten adaptive Aufgaben
und Gesten ab, behalten aber den gespeicherten Gesprächscharakter bei. Eine
ausdrückliche Stiländerung bleibt auch dort möglich.

Ein ruhigerer Stil dämpft den vorhandenen hüpfenden Gesprächsakzent; explizit
gewählte Begrüßungs- und persönliche Rituale behalten ihre eigene Steuerung.
Die Änderung erweitert weder die Motorbefugnisse des Modells noch die lokale
Sicherheitssteuerung. Ambient-Bewegungen und die ausgewählte TTS-Stimme sind
separate Einstellungen.

Die Tests prüfen Erkennung, Abgrenzung, Wiederherstellung, Zurücksetzen,
Realtime-Kontext und die Auswahl eines Reaktionsakzents mit ersetzten
Laufzeitgrenzen. Sie belegen keine Live-Modellqualität, keine subjektive
Akzeptanz und kein Verhalten am physischen LOOI.

## Erste Entwicklungsschleife: vertrautes gemeinsames Interesse

Eine bestätigte gemeinsame Episode kann eine kleine, dauerhafte Vorliebe
bekommen. Dafür müssen drei klare positive Berichte zu einem eindeutig bezogenen
Erlebnis vorliegen, jeweils in verschiedenen Gesprächssitzungen und mindestens
24 Stunden auseinander. Ein Beispiel ist: „Mit dir hat Gerda heute wieder Spaß
gemacht.“ Die Erkennung unterstützt begrenzte direkte Formulierungen auf
Deutsch, Englisch, Russisch und Ukrainisch. Eine unerkannte Formulierung kann
im Gespräch beantwortet werden, erzeugt aber keine dauerhafte Entwicklung.

Nur bestätigte vorhandene Episoden sind geeignet. Allgemeines Lob, Zitate,
Fragen, hypothetische oder verneinte Berichte, unklare Verweise, mehrere benannte
Episoden und die eigenen Antworten des Modells zählen nicht. In Active können
Realtime und Budget solche Berichte annehmen. Observe und Off erzeugen keine
neuen Lernbelege. Wiederholungen in derselben Sitzung oder vor Ablauf des
Abstands steigern die Vorliebe nicht. Abwesenheit erzeugt keinen Verlust und
keine Aufforderung zur Zuwendung. Drei Begegnungen und 24 Stunden sind
vorläufige Produktwerte, keine gemessenen psychologischen Schwellen.

Die Vorliebe liegt mit höchstens drei wörtlichen Nutzerbelegen, Sitzungskennung
und Zeitpunkt direkt an der Episode. Sie besitzt keinen zweiten Speicher.
Bei kurzem kontextbezogenem Feedback kommt der wörtliche vorherige Gesprächsbezug
mit Quelle, Sitzung und Zeitpunkt hinzu; der aktuelle Nutzersatz wird nicht um
einen erfundenen Namen ergänzt.
Neustarts übernehmen sie; alte Episoden bekommen keine erfundene Vorgeschichte.
Ungültige Lerndaten werden beim Einlesen verworfen, ohne die bestätigte Episode
zu verlieren. Vergessen der Episode und „Lernen löschen“ entfernen sie mit.

`companion-personality.ts` besitzt Lernregeln, Validierung und die gemeinsame
Charakteranweisung. Der bestehende Companion besitzt die Episode samt Vorliebe;
die Behavior-Engine verbindet sie mit Ton und Ausdruck. Die Budget-Anbindung
liest und aktualisiert nur Charakterzustand, ohne eine adaptive Sitzung oder
deren Aufgaben, Kamera und Motorpfade zu starten. Die Arbeit pro Turn bleibt
auf acht vorhandene Episoden und kurze Texte begrenzt; zusätzliche Modellaufrufe
entstehen durch das Lernen nicht.

Bei einem eindeutigen aktuellen Bezug kann der Charakterkontext eine kleine
Vertrautheit oder Neugier nahelegen. Er liefert weder einen historischen
Erfolg noch eine neue Erinnerung, ein Ritual oder eine physische Befugnis.
Ernste oder negative aktuelle Äußerungen halten diese Vertrautheit zurück.
Ohne Bezug zum aktuellen Thema wird die Vorliebe dem Modell nicht angeboten.
Budget erhält die Vorliebe als Ausdrucksrichtung; Episodenabruf und Rituale
bleiben dort weiterhin unverfügbar.

Im aktiven Ausdruckspfad darf die Vorliebe nach einer gehörten Antwort einen
bereits erlaubten Nicken-Akzent in einen neugierigen Akzent verwandeln. Ein
gewähltes Ritual, ein Hold, die bestehende Ein-Gesten-Grenze, Wiederholungsabstand,
Unterbrechung und Motorbesitz haben Vorrang. Die Vorliebe startet selbst keine
Bewegung oder zusätzliche Anfrage.

„Sei nicht mehr so begeistert von Gerda“ setzt genau diese Vorliebe zurück und
sperrt ihr weiteres Lernen. Die Episode bleibt erhalten; spätere positive
Berichte heben die Sperre nicht auf. „Du darfst dich wieder für Gerda begeistern“
erlaubt einen neuen langsamen Aufbau. Diese ausdrücklichen Korrekturen gelten
auch in Observe und Off. Ein ruhiger Grundton bleibt beim Aufbau einer Vorliebe
erhalten; kurzfristige Wünsche verändern ihn nicht dauerhaft.

## Natürliche Rückmeldungen und vorübergehende Reaktionen

Eine lokale Vergleichsprobe zeigte zunächst zwei Grenzen: „Das hat wieder Spaß
gemacht“ erzeugte nach einem Gerda-Gespräch keinen Lernbeleg. Dagegen wurde
„Mit dir war der Film toll. Gerda ist kaputt.“ fälschlich als positives Gerda-
Erlebnis gespeichert. Positive Wörter und gemeinsamer Bezug müssen nun im
gleichen Satz wie das eindeutig benannte Erlebnis liegen.

Kurzes rückblickendes Feedback wie „Das hat wieder Spaß gemacht“, „Das war richtig
schön“ oder „That was really fun“ darf den unmittelbaren Gesprächsbezug verwenden.
Dieser muss in derselben Sitzung eindeutig aus einem direkten Nutzerbezug oder
einer vollständig gehörten Roboterantwort stammen und höchstens 90 Sekunden alt
sein. Er gilt nur für die nächste Nutzerantwort. Themenwechsel, mehrere benannte
Episoden, Unterbrechung, Ablauf, Neustart und Sitzungswechsel verwerfen ihn.
Vorschläge wie „Das klingt nach Spaß“, Fragen, Zitate und hypothetische Bezüge
zählen nicht als positive Erlebnisrückmeldung. Deutsch, Englisch, Russisch und
Ukrainisch nutzen dieselbe lokale Zuordnung.

In Realtime kommt der gehörte Bezug über das bestehende Assistant-End-Ereignis.
Budget meldet erst die vollständig abgespielte Antwort. Textanzeige, noch laufende
Wiedergabe und verspätete Abschlüsse nach einem Abbruch erzeugen keinen gehörten
Bezug. Der Vorbezug wird bei Speicherung kurz und wörtlich gehalten. Beim Einlesen
werden seine Quelle, Sitzung, Titelzuordnung und zeitliche Nähe erneut geprüft;
ungültige Lerndaten werden ohne Verlust der Episode verworfen.

Nach dem ersten und zweiten positiven Beleg kann beim passenden Thema vorsichtige
Neugier entstehen. Das ist noch keine gefestigte Vorliebe und erscheint nicht in
deren Überblick. Die Sprachanweisung verlangt natürliche Übergänge ohne Zähler,
Stufenansagen oder ständig wiederholte Sprüche. Der bestehende Abstand und die
Grenze von drei Begegnungen bleiben erhalten.

„Das war heute nichts“ oder ein entsprechend negatives Feedback zum aktuellen
Erlebnis dämpft vorübergehend den Gesprächston. Eine bestehende Vorliebe bleibt
gespeichert, während die aktuelle Antwort zurückhaltend sein kann. Im normalen
Ausdruckspfad wird ein hüpfender Reaktionsakzent dann gehalten. Explizit gewählte
Rituale und die vorhandenen Bewegungsgrenzen behalten ihre Steuerung. Ein Versuch
kann misslungen sein und dem Menschen trotzdem Spaß gemacht haben; ausdrücklich
berichtete Freude wird deshalb von bloßen Fehlerwörtern getrennt.

Diese Gesprächsreaktion gilt höchstens 90 Sekunden und nur beim aktuellen Thema.
Sie wird nicht dauerhaft gespeichert und wird weder mit menschlichen Gefühlen
noch mit einem physischen Erfolg gleichgesetzt. Der 90-Sekunden-Wert ist eine
vorläufige lokale Kontextgrenze, keine gemessene Natürlichkeitsgarantie.

`scripts/companion-natural-feedback.test.mjs` prüft diese Übergänge mit echten
Produktionsmodulen und synthetischer Zeit. Der Budget-Laufzeittest prüft außerdem
die gehörte Referenz erst nach Playback-Abschluss sowie ihr Verwerfen bei Abbruch.

Beobachteter Vergleich nach der Erweiterung: Das kurze positive Feedback nach
einem gehörten Gerda-Bezug erzeugt genau einen belegten Lernschritt; der Satz
über den tollen Film und die kaputte Gerda erzeugt keinen. Ein negativer Moment
lässt den bestehenden Interessenüberblick unverändert und verfällt mit dem
Gesprächsbezug. Die Companion-Offline-, Budget- und zusätzlichen Behavior-/
Realtime-/Ritualprüfungen liefen erfolgreich. Nach den letzten Anpassungen
liefen die gezielten Persönlichkeitstests, `pnpm exec tsc --noEmit` und
`git diff --check` erneut erfolgreich. Für die Typprüfung wurden die bereits
vorhandenen Expo-Routen neu generiert; die unabhängigen App-Oberflächen blieben
unverändert. Es gab keinen echten Modell-, Stimm- oder Geräteprüflauf.

## Persönliche Anknüpfung beim Wiedersehen

Eine weitere lokale Vergleichsprobe zeigte: Ein ausgebildetes Gerda-Interesse
erschien bei „Gerda“, aber nicht bei „Guten Morgen“ oder „Hallo LOOI“. Das machte
den Charakter im Alltag davon abhängig, dass der Mensch selbst das gespeicherte
Thema nennt.

Eine reine Begrüßung kann nun eine optionale kleine persönliche Anknüpfung
erhalten. Es kommen ausschließlich gefestigte, nicht abgestellte Interessen
infrage. Seit dem letzten positiven Lernbeleg müssen mindestens sechs Stunden
vergangen sein. Nach einer tatsächlich gehörten persönlichen Begrüßung gilt
zusätzlich ein geräteweiter Abstand von 24 Stunden, der Neustarts überlebt.
Sechs Stunden und 24 Stunden sind vorläufige Produktwerte.

Die Begrüßung bleibt im Vordergrund. Die Sprachanweisung erlaubt höchstens einen
kurzen persönlichen Nebensatz mit warmer Wiedererkennung oder vorsichtiger
Neugier. Sie enthält keinen festen Spruch, deutet den Titel nicht als Person oder
Objekt und verlangt weder Frage noch Ritual. Bei Beschwerden, zusätzlichen
Anliegen, laufenden Spielen oder Aufgaben und einem frischen negativen Moment
entsteht diese Gelegenheit nicht. Ohne diese Gelegenheit soll eine Begrüßung
kein gespeichertes Thema aufgreifen. Es gibt keine ungefragte Ansprache,
Benachrichtigung oder Aktivität im Hintergrund.

Ein erzeugter Prompt verbraucht den täglichen Abstand nicht. Erst wenn die
Antwort mit dem gewählten Titel tatsächlich über den gehörten Sprachpfad
abgeschlossen wird, speichert die App den Zeitpunkt. Ein ausgelassener Zusatz,
eine Unterbrechung, ein Themenwechsel oder eine vergessene Episode erzeugen
keinen solchen Nachweis. Pro Gesprächssitzung wird höchstens eine Gelegenheit
vorbereitet. Die eigene Formulierung des Roboters verstärkt die Vorliebe nicht.
Explizite Begrüßungsgesten behalten die bestehende Steuerung.

`scripts/companion-personal-greeting.test.mjs` prüft diese Regeln mit den
Produktionsmodulen, einschließlich Speicherung/Wiederherstellung, täglicher
Grenze, Namensvarianten, Anliegen- und Aufgabenvorrang und beiden Sprachmodi.
Die Companion-Offline- und Budget-Suiten, die zusätzlichen Behavior-, Runtime-,
Realtime- und Ritual-Engine-Prüfungen sowie TypeScript und `git diff --check`
liefen erfolgreich. Nach der letzten Formulierungsanpassung lief der gezielte
Begrüßungstest erneut erfolgreich. Die Tests bestätigen außerdem, dass ein
doppeltes Heard-End-Ereignis den Zeitpunkt nicht verschiebt und die eigene
Äußerung des Roboters keine neuen Lernbelege erzeugt.

Der zusätzlich versuchte echte Textmodell-Vergleich verwendete eine synthetische
deutsche Begrüßung und den im Projekt konfigurierten Budget-Client. Der vorhandene
lokale API-Zugang wurde mit HTTP 401 abgewiesen. Es liegt daraus keine echte
Modellantwort und kein Vorher-/Nachher-Nachweis der sprachlichen Natürlichkeit
vor. Nach dieser Abweisung wurden keine weiteren Modellanfragen versucht.

## Auf Nachfrage über eigene Vorlieben sprechen

Der erste Stand bot eine ausgebildete Vorliebe nur bei einer aktuellen Nennung
ihres Episodentitels an. Eine lokale Vergleichsprobe mit einem nach drei
Begegnungen gewachsenen Gerda-Profil zeigte: „Gerda“ erhielt Vertrautheit;
„Was magst du inzwischen?“ und „Wofür begeisterst du dich?“ erhielten eine leere
Auswahl. Damit war die Entwicklung auf natürliche Nachfrage nicht aus dem
lokalen Zustand beantwortbar. Eine tatsächliche Modellantwort wurde dabei
nicht gemessen.

Direkte Fragen nach LOOIs eigenen Vorlieben liefern nun einen lesenden Überblick
über ausschließlich ausgebildete, nicht gesperrte Interessen. Beispiele sind
„Was magst du inzwischen?“, „Wofür begeisterst du dich?“ und „Pico, was magst du?“
bei entsprechend gewähltem Roboternamen. Die begrenzte Erkennung unterstützt
Deutsch, Englisch, Russisch und Ukrainisch sowie die üblichen Roboteradressen.
Fragen nach den Vorlieben des Menschen, Zitate, hypothetische Fragen und fremde
Themen erzeugen diesen Überblick nicht.

Der Überblick nennt höchstens drei unterschiedliche Titel, nach dem letzten
Lernbeleg und stabiler Kennung sortiert. Seine Gesamtzahl zählt nur ausgebildete
Vorlieben; eine Auswahl wird ausdrücklich als solche markiert. Keine ausgebildete
Vorliebe ist eine eigene gültige Antwort. Ein nicht verfügbarer oder abgewiesener
Abruf bleibt davon unterscheidbar. Menschliche Erinnerungen dienen nicht als
Ersatz für eine eigene Vorliebe.

Realtime und Budget erhalten dafür das rein lesende Werkzeug
`list_companion_interests`. Es akzeptiert keine Argumente und prüft die aktuelle
Nutzerfrage lokal. Realtime verwendet die bestehenden Sitzungs-, Turn- und
Transkriptgrenzen: Ein früher Werkzeugaufruf wartet auf das aktuelle Transkript;
nach einer Unterbrechung oder einem Sitzungswechsel wird er verworfen. So muss
die Antwort nicht allein auf eine möglicherweise verspätete Kontextänderung
vertrauen. Der Abruf kann einen gewöhnlichen Werkzeug-/Antwortzyklus auslösen,
startet aber keine zusätzliche Hintergrundaufgabe.

Es entstehen keine Lernbelege, Bestätigungen, Ritualangebote oder neue
Motorbefugnisse. Die bestehende Gestenwahl verwendet weiterhin nur den eindeutig
benannten Einzelbezug. Die Ausgabe des Überblicks gilt auch in Observe und Off,
einschließlich eines leeren Profils mit unverändertem Grundton. Die gespeicherte
Episode, ihre Korrekturquelle und ihre Rituale werden dabei nicht mit ausgegeben.

`scripts/companion-interest-overview.test.mjs` vergleicht leere, gewachsene,
gesperrte und noch junge Vorlieben, Moduswechsel, Neustart und die Trennung
zwischen Mensch und Roboter. Zusätzlich durchläuft es die tatsächlichen PCM-,
WebRTC- und Budget-Werkzeugpfade mit ersetzten externen Schnittstellen,
einschließlich Werkzeug-vor-Transkript und veralteter Turns. Es gehört zu
`pnpm run companion:personality-test`.

Die lokale Nachprüfung dieser Verbesserung war erfolgreich:
`pnpm run companion:offline-test`, `pnpm run voice:budget-test`, die gesonderten
Realtime-, Behavior-Engine-, Runtime- und Ritual-Engine-Prüfungen sowie
`pnpm exec tsc --noEmit` und `git diff --check`. Der neue Überblickstest beobachtet
vier ausgebildete Vorlieben bei drei ausgegebenen Titeln; junge und ausdrücklich
abgestellte Vorlieben bleiben ausgeschlossen. Die realen Realtime-Handler warten
im simulierten Werkzeug-vor-Transkript-Fall auf den richtigen Turn und weisen
veraltete oder falsch parametrierte Aufrufe ab. Das ist ein lokaler Zustands- und
Protokollnachweis, keine Messung der Natürlichkeit einer echten Modellantwort.

## Nachweis und verbleibende Abnahme

`pnpm run companion:personality-test` prüft die Produktionsmodule mit
synthetischer Zeit und ersetzten externen Schnittstellen: mehrtägigen Aufbau,
Quellen, Wiederherstellung, Moduswechsel, ausdrückliche Korrektur, Kontextbezug,
ernste Situationen, Gestenauswahl und den tatsächlich erzeugten Budget-Request.
Die Budget-Laufzeit- und Sprachausgabetests prüfen zusätzlich die Weitergabe an
Textmodell und TTS. Der Persönlichkeitstest gehört zur Companion-Continuity-Suite.

In dieser Arbeitsrunde erfolgreich ausgeführt: `pnpm run companion:offline-test`,
`pnpm run voice:budget-test`, die zusätzlichen Behavior-Engine-, Bridge-,
Runtime-, Realtime-Integrations-, Ritual- und Stimmstiltests sowie
`pnpm exec tsc --noEmit` und `git diff --check`. Nach den letzten Grenzfall-
Anpassungen liefen Persönlichkeitstest, Ritual-Engine, Behavior-Engine und
TypeScript erneut erfolgreich. Alle Modell-, Audio- und Geräte-Schnittstellen
dieser Verhaltenstests waren lokal ersetzt; es wurden keine bezahlten
Modellanfragen oder physischen Aktionen ausgeführt.

Ein realer Vergleich muss dieselben Alltagssituationen vor und nach dem
Lernen, nach Neustart und nach Moduswechsel aufnehmen. Unbeteiligte Hörer sollen
Grundtemperament und die gelernte Eigenheit wiedererkennen können. Die neue
Vorliebe muss beim passenden Thema auffallen und bei ernsten oder fremden Themen
zurücktreten. Solche Modell-, Stimm-, Geräte- und Langzeitbelege sind noch offen.
