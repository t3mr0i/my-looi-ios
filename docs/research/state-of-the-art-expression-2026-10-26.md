# LOOI: Forschung und nächste Stufe des verkörperten Verhaltens

Stand: 26. Oktober 2026. Laufendes Ziel: den Roboter durch weitere Recherche und
Umsetzung auf den aktuellen Stand bringen. Die vorige Runde war Fortschritt:
Sie reproduzierte und korrigierte die zu kurze Decisions-Frist. Das Gesamtziel
ist damit noch nicht erreicht.

## Frage und Ausgangspunkt

Welche Verbindung von Wahrnehmung, Gespräch und Ausdruck fehlt dem aktuellen
Produkt, und welche Forschungsansätze lassen sich mit seiner tatsächlichen
Hardware umsetzen? Ausgangspunkt sind der aktuelle Arbeitsbaum, insbesondere
`behavior-engine.ts`, `behavior-runtime.ts`, `RobotFace.tsx`,
`object-attention-gaze.ts`, `shared-activity.ts` und der Kopfbesitzer in
`device-tools/looi-robot.ts`. Parallele Arbeit an gemeinsamen Tätigkeiten und
persönlichen Ritualen wird nicht als fehlende Funktion erneut entwickelt.

Vorhanden sind sofortige lokale Hör-/Denkzustände, Reaktionen nach dem hörbaren
Antwortende, bestätigte gemeinsame Erlebnisse, ein Ablauf für einen gemeinsamen
Objektversuch und temporäre lokale Objektverfolgung. Der Kopf unterstützt
benannte diskrete Lagen und geprüfte Makros. Eine kontinuierlich gemessene Pose
oder kalibrierte Ausrichtung auf einen Gegenstand ist nicht belegt.

Der bislang direkte Laufzeitpfad veröffentlichte die sichtbare Cue und startete
danach das Kopfmakro. Es gab keinen gemeinsamen Ablauf für Blickvorbereitung,
Kopfakzent und die Rückkehr zur aktuellen Aufmerksamkeit. Die optionale
Blickrichtung wurde nur für `thinking` gesetzt. Das ist eine belegte
Integrationslücke; ein negativer Einfluss auf menschliche Bewertungen wurde
nicht gemessen.

## Was die Primärquellen beitragen

**Apple ELEGNT, Januar 2025:** Die Arbeit gestaltet einen lampenförmigen Roboter
mit funktionalen und expressiven Zielen. Ihr Vergleich umfasst sechs Szenarien
und berichtet Vorteile ausdrucksorientierter Bewegung, besonders in sozialen
Aufgaben. Übertragbar ist die gemeinsame Gestaltung von Absicht und Bewegung.
Die berichteten Ergebnisse sind kein Nachweis für LOOI oder zusätzliche
Bewegungsmenge. [Apple-Forschungsseite](https://machinelearning.apple.com/research/elegnt-expressive-functional-movement)

**Disney, IROS 2020:** Das interaktive Blicksystem verbindet Salienz,
Aufmerksamkeit, Habituation und geschichtete Bewegungssteuerung. Das stützt
eine klare Auswahl und Besitzregel zwischen Ausdruckskanälen. Die detaillierte
Augen- und Kopfmechanik des animatronischen Aufbaus steht LOOI nicht zur
Verfügung. [Originalarbeit und Systembeschreibung](https://la.disneyresearch.com/publication/realistic-and-interactive-robot-gaze/)

**MIRA, Preprint vom September 2026:** Die Autoren verbinden gestreamten Dialog,
verkörperte Cues und eine schnelle Unterbrechungsebene. Ihr Bewegungsansatz hält
Kontext über längere Abschnitte, verpflichtet sich körperlich aber nur auf
kurze Präfixe. Die Arbeit verwendet einen Astribot S1 und erzeugte
Gelenkbewegungen. Wir übernehmen daraus die kurze, unterbrechbare Ausführung;
wir behaupten weder eine Reproduktion noch vergleichbare Bewegungsqualität.
[MIRA v2, 22. September 2026](https://arxiv.org/abs/2609.24547v2)

**MM-VAP, Workshoparbeit vom September 2026:** Diese Arbeit behandelt
Gesprächsrollen als Vorhersageaufgabe aus synchronisierten Audio-/Videosignalen
und diskutiert Vorverarbeitung, Laufzeit und Eingangsqualität. Daraus folgt für
uns eine wichtige offene Anforderung: VAD-Kanten allein sind noch keine
verlässliche Vorhersage einer Gesprächsübergabe. Eine solche Vorhersage ist hier
nicht implementiert. [MM-VAP, 23. September 2026](https://arxiv.org/abs/2609.28317)

**Andrist et al., HRI 2014:** Zweckgebundene Blickabwendung auf NAO wurde in einer
Studie mit 30 Personen unter anderem als Nachdenken wahrgenommen. Die Arbeit
verbindet Gesichtsnachführung, Idle-Bewegung und absichtliche Blickabwendung.
Sie begründet eine kontextabhängige Auswahl, keine universelle Blickzeit oder
die Annahme, dass jede Sprachpause einen freien Gesprächsraum bedeutet.
[Originalpublikation der Forschungsgruppe](https://graphics.cs.wisc.edu/Papers/2014/ATGM14/)

## Abwägung und Auftrag dieser Stufe

| Ansatz | Nutzen | Wichtigste Grenze | Entscheidung |
|---|---|---|---|
| Kontinuierliche generierte Kopftrajektorien | Könnten Rhythmus und Form fein auf Sprache abstimmen. | LOOI liefert derzeit diskrete Befehle statt einer geprüften Pose-/Trajektorienschnittstelle. | Als späteren Hardware-/Backend-Ausbau führen; keine erfundene Interpolation. |
| Physischer Zuhörer- oder Denkakzent vor der Antwort | Könnte einen echten Antwortabstand lesbarer machen. | Input-Entscheidungen haben nur 800 ms; der gemessene einzelne API-Aufruf brauchte 1.480 ms. VAD allein belegt keine freie Gesprächsrolle. | Nicht als nächste Standardbewegung einbauen. |
| Gemeinsame Aufmerksamkeit mit Aktivitätsbezug | Könnte den Wechsel zwischen Person, Gegenstand und Handlungsschritt verständlich machen. | Ein ausgewählter Bildbereich ist noch nicht als die erinnerte Episode identifiziert; der Track ist kurzlebig. | Eigenständiger nächster Integrationsauftrag mit ausdrücklicher Zuordnung. |
| Lokal komponierter Ausdruck für einen bereits gültigen semantischen Cue | Verbindet den vorhandenen Blick mit genau dem freigegebenen Kopfakzent und seiner Rückkehr. | Die konkrete Form und ihre Wirkung müssen noch am Display und mit Menschen geprüft werden. | In dieser Stufe umgesetzt und separat überprüft. |

Der konkrete Auftrag lautet: Ein gültiger Cue erzeugt eine zusammenhängende,
kleine Ausdruckssequenz unter derselben Identität. Die lokale Sequenz darf weder
die gewöhnliche Sprachausgabe verzögern noch neue Modellfragen erzeugen oder
abgelaufene Bewegung wieder zulassen. Das Gegenexperiment ist die bisherige
direkte Cue-Ausführung bei gleichem Text, gleicher Geste und gleicher Häufigkeit.

## Implementierung

`src/behavior/behavior-expression.ts` kompiliert die bereits erlaubten Gesten in
Vorbereitung, Akzent und Ausklang. Die Blickvorbereitung dauert zunächst 150 ms,
die Rückkehr 220 ms. Diese Werte sind explizite Entwurfswerte, keine aus Studien
abgeleiteten Optima. Blickwerte bleiben auf kleine Bildschirmkoordinaten
begrenzt; daraus wird keine körperliche Zielpose berechnet.

Der echte Laufzeitadapter veröffentlicht die Phasen unter der ursprünglichen
Cue-ID und führt den Kopfakzent über den vorhandenen serialisierten
Kopfbesitzer aus. Ist die Cue zu nahe an ihrem Ende, entfällt die Vorbereitung.
Die ursprüngliche Frist begrenzt weiterhin den tatsächlichen Beginn des
Akzents. Erst danach gilt das bestehende Abschlussfenster von maximal 1.500 ms.
Ein nicht beendetes Kopfmakro erhält keinen vorgetäuschten Ausklang.

Ein gemeinsames Abbruchsignal beendet Wartephasen und blockiert verspätete
Abschlüsse. Generation, Sitzung, Fokus, Sprache, Fahrt, Kamerabesitz und die
bestehenden Besitzerprioritäten bleiben maßgeblich. Ein alter Abschluss darf
keine neuere Darstellung löschen. Bei der OS-Einstellung „Bewegung reduzieren“
entfallen zusätzliche räumliche Blickphasen; die bestehende Einstellung für
physische Ambient-/Kopfbewegung bleibt separat zuständig.

Hold und gewöhnliche eingabeseitige Display-Cues bekommen keine Kopfbewegung.
Die Decisions-Fragen, Kontingente und Budgetgrenzen werden nicht erweitert.
Die Sequenz erzeugt keine Bilder, Aufnahmen oder zusätzlichen Modellaufrufe.

## Nachweis und noch offene Gesamtanforderungen

Der Nachweis umfasst reine Sequenztests, den tatsächlichen Laufzeitadapter mit
kontrollierter Uhr und eine lokale Wiedergabe der aufgezeichneten
Runner-Ereignisse. Die Wiedergabe ist ausdrücklich eine Diagnose des Runners,
kein Ersatz für einen nativen Display- oder Hardwaretest.

Ausgeführt und bestanden:

- `behavior-expression.test.mjs`: Phasenfolge, kleine Blickwerte, abgelaufene
  Cues, übersprungene Vorbereitung nahe der Startfrist, Hold/Display-only,
  Abbruch in allen Phasen, hängende Kopfoperation und reduzierte Bewegung.
- Die drei Laufzeittests `behavior-runtime.test.mjs`,
  `behavior-runtime-moments.test.mjs` und `behavior-runtime-timing.test.mjs`:
  echte Engine/Adapter mit kontrollierter Zeit; sichtbare Vorbereitung vor dem
  Kopfakzent, Rückkehr, STOP und neue Sprache, erhaltene Start-/Abschlussfristen.
  Die OS-Abfrage bleibt bis zur Antwort vorsorglich reduziert; ein neueres
  Preference-Ereignis gewinnt gegen ein veraltetes Abfrageergebnis.
- Vollständiges `pnpm run ios:check`, einschließlich Realtime-/PCM-, Mock-,
  Lifecycle-, Sprach-, Kamera-/Objekt- und Bewegungsprüfungen.
- Signierter nativer Release-Build für `iphoneos` und `codesign --verify --deep
  --strict`. Die vorhandenen Sprachmodelle bleiben enthalten.
- `git diff --check`. Ein unabhängiger Review fand keine konkrete Regression
  im Besitz-, Abbruch-, Frist- oder OS-Abfragepfad dieser Integration.

`pnpm run behavior:expression-replay` erzeugt sechs echte Runner-Zeitlinien:
drei Gesten, STOP während Vorbereitung und Akzent sowie reduzierte Bewegung.
[HTML-Wiedergabe](evidence/behavior-expression-replay-2026-10-26.html) und
[JSON-Ereignisse](evidence/behavior-expression-replay-2026-10-26.json) verwenden
einen ausdrücklich festen `attention`-Voice-State für die Gesichtsdarstellung.
Nur der Akzent bekommt den Cue-Mood; die übrigen Phasen haben keinen Mood.
Die Kopfoperation ist dabei ein 260-ms-Testadapter, keine gemessene Motorzeit.
Die Wiedergabe wurde lokal im Browser mit 0,1-facher Geschwindigkeit geprüft;
sie ist keine Aufnahme der nativen App.
Der sichtbare STOP-Fall vor dem Akzent zeigte keine spätere Kopfanforderung.
Ein dabei entdeckter Rückwärtsschritt-Fehler bei gleichen Zeitstempeln wurde im
Diagnosegenerator behoben und durch Vorwärts-/Rückwärtsschritte sowie Assertions
geprüft. Der [gespeicherte Screenshot](evidence/behavior-expression-replay-2026-10-26.png)
zeigt den Akzentzustand mit den zugehörigen erfassten Ereignissen.

Das physische iPhone wurde zum Build-Abschluss von `devicectl` als
`unavailable` gemeldet. Daher ist dieses Update nicht darauf installiert; ein
erneuter echter API-Aufruf fand nicht statt. Die native Displayabnahme dieses
Ablaufs bleibt ebenfalls offen. Der unabhängige Review-Hinweis auf die ältere
asynchrone Reduce-Motion-Abfrage in `RobotFace` wurde anschließend reproduziert
und korrigiert: Ein späteres OS-Ereignis gewinnt gegen die ältere Abfrage,
auch wenn deren Promise danach aufgelöst wird. Der gezielte Verhaltenstest
führt die tatsächliche Komponente mit kontrollierten Hook-/Native-Grenzen aus;
er ersetzt keine native Bewegungsabnahme. Den aktuellen Abschlussstand hält die
[Zielabnahme](state-of-the-art-acceptance-2026-10-26.md) fest.

Die nächste Integrationsstufe verbindet inzwischen die ausdrücklich gewählte
lokale Region mit einer bestätigten Tätigkeit. Sie ergänzt außerdem eine native,
isolierte `RobotFace`-Vorschau im bestehenden Offline-Test. Simulator-Build,
Installation und Prozessstart sind geprüft; die sichtbare Abnahme ist wegen des
gesperrten Macs noch offen. Die neue Stufe und ihre Grenzen stehen im
[Bericht zur gemeinsamen Aufmerksamkeit](joint-attention-implementation-2026-10-26.md).

Ein weiterer Schritt ergänzt einen wählbaren semantischen Gesprächswechsel
in beiden Realtime-Sprachdiensten. Auswahl, Lebenszyklus und bestehende lokale
Antwortfreigaben sind geprüft. Ein Vorteil bei Denkpausen, Unterbrechung oder
Antwortlatenz ist noch nicht am echten Gerät gemessen. Primärquellen,
Gegenbelege und Vergleichsbedingungen stehen im
[Bericht zum Gesprächswechsel](semantic-turn-taking-2026-10-26.md).

Das übergeordnete Ziel bleibt offen, bis die zugehörige Evidenz vorliegt:

1. **Kohärenz:** gleiche Cue-ID, richtige Phasenfolge, Rückkehr zu frischer
   Aufmerksamkeit und Vorrang einer Unterbrechung im echten Laufzeitpfad.
2. **Bodenhaftung:** Aktions- und Blickbezüge müssen auf aktuellen, ausdrücklich
   zugeordneten Wahrnehmungs-/Aufgabeneingängen beruhen. Geometrie allein beweist
   weder Objektidentität noch Absicht einer Person.
3. **Interaktion:** Audioende und Unterbrechung müssen am Gerät stimmen. Eine
   weitergehende Vorhersage von Gesprächsrollen braucht neue Eingänge und eigene
   Evaluierung statt erfundener Gewissheit aus VAD.
4. **Haltbarkeit:** Gemeinsam gewählte Eigenheiten und bestätigte Erlebnisse
   müssen über Sitzungen richtig, freiwillig und sparsam wiederkehren. Die
   parallel vorhandene Implementierung ersetzt keine Langzeitbewertung.
5. **Wirkung:** Ein verblindeter Vergleich soll Verständlichkeit, Störung und
   Natürlichkeit bei gleichem Inhalt und Bewegungsumfang messen. Vor einem
   bestätigenden Versuch sind Baseline, relevante Effektgrenzen und Analyse
   festzulegen. Derzeit fehlen solche Messungen.
6. **Geräte-/Roboterabnahme:** Native Darstellung einschließlich reduzierter
   Bewegung, reale Motorlatenz, Abbruch und Kalibrierung sind separat zu prüfen.
   Der echte LOOI ist noch nicht verfügbar. Ein Mock kann diese Nachweise nicht
   liefern.

Damit ist dies ein weiterer umgesetzter Baustein des Gesamtziels und kein
belegter Anspruch, das Produkt sei bereits „State of the Art“.
