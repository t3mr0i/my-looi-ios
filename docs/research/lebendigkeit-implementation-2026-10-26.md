# Lebendigkeit: Umsetzung und Prüfstand

Stand: 26. Oktober 2026. Umsetzung der drei Vorschläge aus der
[Untersuchung](lebendigkeit-2030-2026-10-26.md) im bestehenden lokalen Arbeitsbaum.
Die vorhandenen Änderungen anderer Arbeiten wurden erhalten.

## Ergebnis

1. **Ein gemeinsamer Reaktionsablauf:** Lokale Phasen für Zuhören, Verarbeiten,
   Sprechen, Reagieren und Ausklingen verbinden das Bildschirmgesicht mit der
   bestehenden Cue-Ausführung. Zuhören/Verarbeiten benötigen keine zusätzliche
   Cloudanfrage. Input-Cues sind visuell; der gehörte Antwortausgang erhält die
   eine körperliche Geste des Turns. Bestätigte, ausdrücklich positiv berichtete
   Episodenausgänge dürfen ihr Motiv bereits als Reaktion auf diesen Bericht
   verwenden. Das tatsächlich gehörte Antworttranskript erreicht die
   Verhaltensentscheidung jetzt getrennt vom Nutzertext. Ein verspäteter Input-Cue
   wird beim Beginn der Audioausgabe verworfen.
2. **Bestätigte gemeinsame Erlebnisse:** Neue Realtime-Tools schlagen eine Episode
   mit Titel, Detail, Ausgang, Motiv und wörtlichem Beleg aus dem aktuellen
   Nutzerturn vor. Gespeichert wird erst nach einer tatsächlich gehörten Frage,
   die den Titel nennt, und einer klaren Bestätigung im nächsten Turn. Maximal
   acht bestätigte Episoden überleben einen Neustart. Entwürfe, Bildfreigaben und
   laufende Interessen werden nicht wiederhergestellt. Eindeutige aktuelle
   Titelreferenzen begrenzen den Abruf; bloßer Abruf beweist keinen neuen Erfolg.
   Motive haben eine Wiederholungspause. Settings zeigt die Notizen und kann sie
   einzeln vergessen oder zusammen mit dem gelernten Verhalten löschen. Löschen
   schließt den bisherigen Dialog und verwirft seinen aktiven Transcript, auch
   bei einem sprachlich bestätigten Forget.
3. **Ein begrenztes eigenes Interesse:** Ein separater, standardmäßig deaktivierter
   Schalter erlaubt nach einem ausdrücklich angeforderten und als brauchbar
   bewerteten Kamerabild eine einzige Frage. Das Tool liefert deren genauen
   Wortlaut. Erst das hörbare Ende dieser Frage öffnet die Wartephase. Eine
   Antwort wird im laufenden Dialog aufgegriffen; Schweigen beendet die Phase
   nach 20 Sekunden ohne weitere Anfrage oder Ansprache. Ein neuer Nutzerturn
   nimmt einer früheren Bildfreigabe die Erlaubnis für ein neues Angebot.

Die Tools sind in beiden bestehenden Realtime-Transporten angeschlossen. Sie
sind an Session und Eingaberevision gebunden. Beginnt eine automatische Antwort
vor dem fertigen Transkript, darf sie nur an genau den unmittelbar zugehörigen
Turn gebunden werden. Ein neuer Sprachbeginn macht alte Toolaufrufe ungültig.
Die normale Fakten-Memory bleibt getrennt; während eines Episodenvorschlags und
seines Bestätigungsturns darf `remember` ihn nicht umgehen. Der zusätzliche
Duplikatabgleich mit bereits bestätigten Episoden ist heuristisch und hängt vom
bereitgestellten relevanten Kontext ab.

## Durchgehende gemeinsame Szene

Der nächste Ausschnitt der 2030-Szene ist ebenfalls implementiert:

1. Nach einem ausdrücklich angeforderten, als brauchbar bewerteten Bild darf
   LOOI eine kurze Objektbeschreibung zu einer bestehenden Episode vorschlagen.
   Erst die genau einmal gehörte, lokal erzeugte Frage mit Episodentitel
   und die anschließende klare Bestätigung speichern diese **Textbeschreibung samt Herkunft**. Es werden
   keine Bilddateien, Fingerpunkte oder Bild-Embeddings dafür gespeichert.
2. Ein neues ausdrücklich angefordertes Bild kann mit dieser Beschreibung
   verglichen werden. Der modellseitige Vergleich ist vorläufig: Sowohl
   „gleich“ als auch „verändert“ benötigen eine neue, gehörte Vergleichsfrage
   und Bestätigung. Die konkrete Frage wird auf Deutsch, Englisch, Ukrainisch
   oder Russisch erzeugt und muss genau einmal hörbar sein. Eine zusätzliche
   Frage im selben Antworttext lässt keine eindeutige Zustimmung zu. „Unklar“ schließt den Ablauf. Die bestätigte neue Beschreibung
   ersetzt den Textstand; die vorherige Beschreibung bleibt im laufenden
   Vergleich sichtbar. Das ist kein kalibriertes Verfahren zur visuellen
   Objektidentität oder zur Vermessung eines breiteren Raketenfußes.
3. Die bestätigte Szene bleibt 60 Sekunden bereit. Ein aktueller Nutzerturn muss
   die Episode und das gewünschte Startzeichen ausdrücklich nennen. Danach
   wartet LOOI höchstens 20 Sekunden auf ein ausdrückliches Startwort
   (etwa „Start“ oder „Los“) oder eine offene Hand. Ein gewöhnliches „Ja“ gilt
   nicht als Startwort.
   Sprachstarts werden vor der normalen Realtime-Antwort lokal verbucht;
   Handstarts verlangen zunächst eine nicht sichtbare Hand und danach eine
   einzelne, ausreichend sicher erkannte, gehaltene offene Hand. Bereits beim
   Scharfschalten sichtbare Hände gelten nicht als neues Startzeichen.
4. Die Handerkennung nutzt iOS Vision auf dem vorhandenen lokalen Kamerastream.
   Sie wird nur für das vereinbarte Fenster angefordert, benötigt Camera
   Attention und Kameraberechtigung und unterdrückt währenddessen die lokale
   Such-/Nachführbewegung. Native Bildzeit und JavaScript-Zeit werden nicht
   voneinander subtrahiert. Lücken, Mehrfachhände, unsichere oder doppelte Frames
   verwerfen die zeitliche Halteerkennung. Ältere native Builds erhalten einen
   Sprachfallback.
5. Ein angenommener Handstart gibt das Kamerafenster sofort frei und fordert
   genau eine gebundene Countdown-Antwort an. Session, Eingaberevision,
   Vordergrund, Hauptansicht und Audiozustand werden erneut geprüft. Ein
   abgelehnter Callback schließt den Versuch. Es gibt keinen automatischen
   Raketenstart und keine neue Fahrsequenz. Ein Erfolg darf erst auf einen
   ausdrücklichen Erfolgsbericht hin gefeiert werden.

STOP, Schlaf, Hintergrund, Verlassen der Hauptansicht, Kameradeaktivierung,
unterbrechende Turns und abgelaufene Fristen schließen den jeweiligen Ablauf.
Laufende Vergleiche und Startrechte überleben weder Sessionwechsel noch Restore.
Bestätigte Textbeschreibungen bleiben in den Episodennotizen in Settings
sichtbar und können mit ihnen gelöscht werden. Das Gesicht zeigt beim Warten
auf das Startzeichen einen knappen Hinweis; technische Zustände bleiben in den
Settings. Die Hinweise sind auf Deutsch, Englisch, Ukrainisch und Russisch
vorhanden.

Eine räumliche Weltkarte, verlässliche autonome Objektwiedererkennung über Tage,
Menschenidentität und kalibrierte antizipierende Bewegungen bleiben weitere
Arbeit. Die lokale Handheuristik benötigt noch Geräteversuche mit
unterschiedlichem Licht, Abstand und Handhaltung.

## Tatsächlich ausgeführte Prüfungen

| Prüfung | Beobachtetes Ergebnis |
|---|---|
| `corepack pnpm run ios:check` | PASS einschließlich TypeScript, bestehender Audio-/Lifecycle-/BLE-/Memory-/Behavior-Regressions und der neuen Companion-/Szenen-/Handsignal-Suites |
| `scripts/behavior-companion.test.mjs` | Gehörte Titelfrage und Bestätigung, Herkunft, Mehrdeutigkeit, TTL, Wiederholungspausen, Restore, bestätigte Textbeschreibung, same/different/uncertain und gebundene Startzeichen |
| `scripts/behavior-companion-voice.test.mjs` | Beide Realtime-Transporte, ältere Responses, vor dem Transkript erzeugte Responses, Barge-in, Mehrsatz-Belege und Memory-Abgrenzung |
| `scripts/behavior-moments.test.mjs` | Getrennte Nutzer-/Antwortrollen, Input nur visuell, eine Output-Geste, bestätigte Episoden über Sessiongrenzen, Neugier-Opt-in, schweigender Abschluss und Privacy-Abbruch |
| `scripts/behavior-runtime-moments.test.mjs` | Echte Engine im Runtime-Adapter: sofortige Zuhör-/Denkdarstellung ohne Motor, Output-Kopfbeat und sprachliches Forget mit Dialog-/Transcript-Sperre und sofortiger Persistenz |
| `scripts/behavior-rehearsal-mock.test.mjs` | Vier Szenarien PASS über echte Engine, Controller, SDK und Mock; keine Räder, kein Netz/BLE; STOP und Quellenwechsel isolieren alte Gesten |
| `scripts/behavior-shared-scene.test.mjs` | Echte Engine und Runtime: Gerda-Beschreibung bestätigen, vorläufigen Unterschied bestätigen, fremde Frage und bloßes Ja ablehnen, explizites Startzeichen, bereits sichtbare Hand ignorieren, einmaliger Start, Sprachpfad, Timeout, STOP, Kamera aus, abgelehnte Antwort und Sprachwahl |
| `scripts/interaction-start-signal.test.mjs` | Freigabe erst nach sichtbarer Unterbrechung und stabiler Einzelhand, getrennte Zeitbasen, Lücken, doppelte Frames und Einmaligkeit |
| `scripts/social-interaction-signal.test.mjs` | Verzögerte native Umschaltung, erneute Anforderung, off→on und Kamerateardown trotz abgelehnter Handumschaltung |
| `scripts/local-hand-signal.test.mjs` | Kanonischer Swift-Klassifikator aus der nativen Quelldatei kompiliert und mit offener/geschlossener/unsicherer/unvollständiger Hand geprüft |
| Swift-Parser und Vision-API-Typecheck | PASS gegen den installierten iOS-SDK; die aktuelle native Quelldatei wurde für arm64 und x86_64 kompiliert |
| Nativer Xcode-Build | **BUILD SUCCEEDED**: Debug, `iphonesimulator`, generisches Simulatorziel, Codesigning aus; Workspace `ios/MyLOOI.xcworkspace`, Scheme `MyLOOI` |
| Offline `expo export --platform ios` | PASS; iOS-Hermes-Bundle erstellt, einschließlich neuer Settings und Gesichtszustände |
| `git diff --check` | PASS |

## Noch getrennt abzunehmen

Es wurden keine kostenpflichtigen Realtime-/Decisions-Anfragen und keine realen
Roboterbewegungen ausgelöst. Die aktuellen Änderungen wurden nicht auf dem
iPhone installiert. Der iOS-JavaScript-Export ist kein Nachweis eines nativen
App-Builds. Der vollständige Xcode-Build ist erfolgreich; die App liegt unter
`output/ios-derived/Build/Products/Debug-iphonesimulator/MyLOOI.app`. Es liegt
noch keine visuelle Abnahme der neuen Oberfläche im Simulator vor: Sowohl die
Liste gestarteter als auch verfügbarer Simulatorgeräte war leer. Es wurde
kein zusätzliches Simulator-Runtime heruntergeladen und kein Gerät verändert. Physische Kalibrierung, reale Modelllatenz, die Qualität der
modellseitigen Episodenvorschläge und Nutzerurteile zur Natürlichkeit bleiben
offen. Die vorgeschlagenen A/B- und Mehrtagesversuche aus der Untersuchung sind
weiterhin Versuchspläne, keine bereits gemessenen Erfolge.
