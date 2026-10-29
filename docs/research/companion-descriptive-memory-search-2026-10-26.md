# Gemeinsame Erinnerungen über eine Beschreibung finden

Stand: 26. Oktober 2026. Diese Änderung betrifft die sprachliche Suche in schon
bestätigten gemeinsamen Erinnerungen. Sie ergänzt keine Kameraerkennung und
keine dauerhafte Objektidentität.

## Beobachtete Lücke

Eine bestätigte Episode kann „Gerda“ heißen und in ihrer Beschreibung eine
Papierrakete enthalten. Bei „Weißt du noch unsere Papierrakete?“ fand der bisherige
Kontextpfad zwar einen Kandidaten, `recall_experience` lehnte den Abruf aber mit
`reference_not_named` ab. Der aktuelle Turn musste den gespeicherten Titel
wörtlich enthalten. Vollständige Fakten wurden dabei nicht zurückgegeben.

Daneben verwendet die kurze Kontextvorschau exakte Wort-Tokens. „Rakete“ und
„Papierrakete“ ergaben dort keinen gemeinsamen Suchbegriff. Beide Grenzen wurden
über den öffentlichen Runtime-, Engine- und Events-Pfad reproduziert. Die
bestehenden Recall-Tests bestätigen die Titelbindung ausdrücklich.

Das ist für den Alltag relevant: Eine Person erinnert sich eher an „unsere
Rakete“ als an den Namen eines gespeicherten Eintrags. Die Erinnerung ist
vorhanden; der fehlende genaue Titel sollte eine sinnvolle Antwort nicht
verhindern.

## Entscheidung und Grenzen

Die bestehende Recall-Aktion kann ein persönliches Ritual anbieten und dessen
Wiederholungspause ändern. Ihre Titelprüfung pauschal zu lockern würde daher
auch die Aktionsregeln verändern. Ein zusätzlicher Bestätigungsdialog für jede
Suche würde neuen Gesprächszustand und zusätzliche Rückfragen einführen.

Gewählt ist stattdessen eine eigene, lesende Suche. Sie gibt passende gespeicherte
Fakten unter ihrem Eintragstitel zurück. LOOI kann beispielsweise sagen, dass
eine Erinnerung an Gerda dazu passt, und daraus die bestätigten Details nennen.
Passen mehrere Einträge oder ist der Bezug unklar, soll er kurz unterscheiden
lassen. Es wird kein Alias gespeichert und keine aktuelle Identität behauptet.
Auch ein einzelner Worttreffer ist keine Identitätsprüfung.

Der neue Pfad führt vom Produktionswerkzeug `search_shared_experiences` über
beide bestehenden Realtime-Adapter zur Aktion `search_experiences` beim
Companion. Dieser besitzt die bestätigten Episoden und deren Löschung weiterhin
allein. Es entsteht kein zweiter Speicher und kein externer Suchdienst.

Die Suche hat folgende Grenzen:

- `query` ist ein unverändertes, kurzes wörtliches Stück aus dem aktuellen
  User-Turn, maximal 240 Zeichen. Umformulierungen, Übersetzungen, fremde Turns
  und Steuerzeichen werden nicht als gültiger Suchbeleg angenommen.
- Die lokale Wortsuche prüft alle gespeicherten Episoden, nicht nur die zwei
  kurzen Kontextvorschauen. Übliche Frage- und Füllwörter tragen keinen Treffer.
  Eine begrenzte Suche nach Wortendungen findet zum Beispiel „Rakete“ in
  „Papierrakete“. Das ist keine semantische Suche und keine Übersetzung.
- Höchstens drei Treffer enthalten vollständige, weiterhin begrenzte
  bestätigte Fakten und eine unabhängige Herkunftskopie. `totalMatches` zählt
  alle passenden Einträge vor dieser Begrenzung; `matchedTerms` nennt die
  tatsächlich passenden Suchwörter. Es gibt keine behauptete
  Identitätswahrscheinlichkeit.
- Ein Treffer belegt den gespeicherten Inhalt, nicht dass sich die aktuelle
  Äußerung auf genau dasselbe Ereignis oder Objekt bezieht. Titel und Herkunft
  dienen der Einordnung. Kein Treffer bedeutet nur, dass nichts Passendes
  gefunden wurde; daraus folgt nicht, dass etwas nie passiert ist.
- Zitate und verneinte Beschreibungen können Suchdaten sein. Daraus entstehen
  keine gemeinsame Episode, bestätigte aktuelle Identität oder Handlungsrechte.
  Gespeicherte Quellen bleiben Daten und werden nicht zu Anweisungen.
- Die Suche legt keine Ritualangebote oder Motiv-Freigaben an und verändert
  keine Bestätigung, Aufgabenphase, Ritualpräferenz oder Nutzungszeit einer
  Episode. Normale Ablaufbereinigung bleibt bestehen. Der genaue Recall und
  alle bestehenden Änderungs- und Startregeln behalten ihre Titelbindung.
- Die vorhandenen Session-, Turn- und Werkzeuggrenzen gelten in beiden
  Sprachadaptern. Eine verworfene Antwort darf weder eine alte Suche nutzen
  noch aus deren Ergebnis eine neue Folgeantwort beginnen.

Der Produktions-Prompt unterscheidet nun persönliche Fakten, beschreibende
Episodensuche und den genauen Recall. Der neue Werkzeugaufruf verändert weder
Modell noch Antwortbudget, Sprachstil oder API-Zugang.

## Nachweisumfang

Die Verifikation nutzt bestätigte synthetische Episoden, die über den normalen
Frage-/Antwortfluss angelegt werden. Ein Einzeltest muss vollständige Fakten
hinter der kurzen Vorschau, mehrere Treffer, Wortendungen, generische und
unpassende Fragen, gelöschte Daten, falsche Belegstücke, fremde Turns und
unabhängige Rückgabekopien unterscheiden. Ein gespeichertes aktives Ritual darf
durch die Suche weder angeboten noch in seiner Pause verändert werden.

Die Sprachintegration muss die echten Companion-Ergebnisse über PCM und WebRTC
weiterreichen. Der vorbereitete Live-Prüflauf enthält weiterhin sechs Fälle;
sein Erinnerungsfall fragt nun ohne Gerda-Titel nach „unserer Rakete“. Der
separate Fake-Protokolltest behält zusätzlich den bisherigen genauen Recall
und die Korrekturkennung bei. Vorgegebene Antworten sind dort weiterhin als
Protokolltests gekennzeichnet.

| Ausgeführte Prüfung | Beobachtetes Ergebnis |
|---|---|
| `scripts/shared-episode-search.test.mjs` | PASS: öffentlicher Bestätigungs-/Engine-/Eventpfad, Wortendungen, vollständige Fakten, Treffer über dem Rückgabelimit, Mehrdeutigkeit, keine Treffer für Füllwörter/unpassende Fragen, keine Übersetzung, gelöschte Daten, Kopierisolation, Beleg-/Turngrenzen und unveränderte Ritual-/Motivzustände |
| `scripts/behavior-companion-voice.test.mjs` | PASS: echte Companion-Rückgaben über PCM und WebRTC, vollständiges JSON, eine Folgeantwort, keine Treffer, falsche Querytypen/Belege, unveränderte Query und bestehende Duplicate-/Session-/Turngrenzen |
| `pnpm run companion:continuity-test` | PASS: neue Suche zusammen mit vollständigem genauem Recall, früher Antwortkorrektur und beiden Werkzeugrouten |
| `pnpm run companion:live-eval-test` | PASS: aktualisierte sechs Fixtures, begrenzte Fake-Socket-Fehlerfälle und echte PCM-Integration mit Suchtreffern im ausgehenden Ergebnis und im Bericht; genauer Recall und Korrektur bleiben geprüft |
| `pnpm run ios:check` | PASS einschließlich TypeScript und vollständiger bestehender iOS-/Behavior-/Sprachprüfungen |
| Offline `expo export --platform ios` | PASS: Hermes-Bundle `entry-8c43d54d06fb8f463df55387014f3bda.hbc`, ca. 7,4 MB, unter `output/companion-descriptive-memory-ios-export` |
| `git diff --check` für die Dateien dieses Ausbaus und `--no-index --check` für neues Suchmodul/Tests | PASS |

Bestehende isolierte Tests luden den früher vollständig in einer Datei
enthaltenen Companion mit einem restriktiven Loader. Sie laden jetzt zusätzlich
das tatsächliche reine Suchmodul; die bestehenden Assertions und Zeitgeber
bleiben erhalten. Die Produktionssuche wurde nicht zur Anpassung an diese
Test-Doppelgänger in den Companion hineinkopiert.

Der unabhängige Quellreview fand in diesem begrenzten Ausbau keine belegte
Umgehung der bestehenden Ritual-, Titel- oder Turngrenzen. Die Kandidatensuche
prüft den gesamten derzeit auf acht bestätigte Episoden begrenzten Bestand.
Dieses Speicherlimit wurde nicht erweitert. Der Prüflauf-Bericht bewahrt auch
die vollständigen begrenzten Kandidatenfakten, Herkunft und Trefferbegriffe;
er vergibt weiterhin keinen automatischen semantischen Modell-Pass.

Die tatsächliche Formulierung und Zuordnung durch das Sprachmodell muss im
[vorbereiteten Modellprüflauf](companion-live-evaluation-2026-10-26.md) beurteilt
werden. Der zuletzt überprüfte Shell-Zugang lieferte `401 invalid_api_key`; damit
wurde kein neuer Inferenzversuch gestartet. Das physische iPhone ist bei der
erneuten Geräteprüfung weiterhin nicht erreichbar. Diese Änderung ersetzt
keine natürliche Gesprächs-, Sprach- oder Roboterabnahme.
