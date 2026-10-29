# Ein offener Rückblick auf gemeinsame Erlebnisse

Stand: 26. Oktober 2026. Lokale Weiterarbeit am unveränderten Companion-Ziel,
ohne Modellaufruf, iPhone oder Roboterbetrieb.

## Belegter Ausgangspunkt

Ein unabhängiger öffentlicher Runtime-/Eventprüflauf hat drei verschiedene
Episoden gespeichert und jeweils nach einer gehörten Frage durch einen späteren
Nutzerturn bestätigt. Auf „Was haben wir zusammen erlebt?“ waren weiterhin alle
drei Einträge gespeichert. Der allgemeine Gesprächskontext zeigte aber nur zwei,
und `search_experiences` lieferte `no_candidates`: Die Frage enthält keine
identifizierenden Suchbegriffe. Ein anderer vorhandener Sprachweg löst das
nicht; genauer Abruf braucht einen gespeicherten Namen, und die beschreibende
Suche bleibt lexikalisch.

Die vorherige Zielrunde war Implementierungsfortschritt: bestätigte Korrektur
einzelner Episodenfakten mit eigener Quelle und Erhalt der Eintragsidentität.
Diese Runde schließt den davon unabhängigen offenen Rückblick ab.

## Gewählter Ablauf und Abwägung

LOOI bekommt einen lesenden Überblick über die bestätigte gespeicherte Sammlung.
Aus diesen Fakten kann die Antwort einen kurzen Rückblick bilden und bei Bedarf
fragen, welches Erlebnis die Person näher aufgreifen möchte. Eine leere
Sammlung bedeutet nur, dass keine bestätigte gemeinsame Episode gespeichert
ist. Sie ist keine Aussage darüber, was tatsächlich gemeinsam erlebt wurde.

Ein Fallback der Suche bei fehlenden Begriffen würde „kein Treffer“ und
„gespeicherte Sammlung“ vermischen. Alle acht Einträge dauerhaft in jeden
Gesprächskontext aufzunehmen würde auch unbeteiligte Turns vergrößern. Der
ausdrückliche Abruf hält beide bestehenden Verträge unverändert und übergibt
vollständige Fakten nur bei Bedarf.

## Modul und Schnittstelle

Das bestehende Companion-Modul besitzt die neue Aktion `list_experiences` ohne
weitere Parameter. Es liefert `episodes`, `total` und den Status
`experiences_listed` oder `no_saved_experiences`. Das Sprachwerkzeug
`list_shared_experiences` und die beiden vorhandenen PCM-/WebRTC-Adapter
übersetzen nur diese kleine Schnittstelle; Session- und Turn-Bindung bleiben
maßgeblich. Argumente außer dem leeren Objekt sind im Sprachwerkzeug ungültig.

Die Sammlung umfasst höchstens die bestehenden acht bestätigten Episoden.
Vorgeschlagene Erinnerungen und persönliche SQLite-Fakten gehören nicht dazu.
Die Rückgabe verwendet dieselben vollständig begrenzten aktuellen Fakten und
defensiv kopierten Erstell- und Korrekturquellen wie der genaue Abruf. Es gibt
keine weitere gespeicherte Ansicht, keinen neuen Persistenztyp und keine
seitenspezifische Pagination. Die Ordnung ist Speicheranlage absteigend und
danach stabile ID aufsteigend. Eine Speicheranlagezeit beweist kein Ereignisdatum.

Der Abruf selbst verändert weder Einträge, Nutzungstermine, Aufgaben,
Bestätigungen, Szenen, Interessen noch Ritual- oder Gestenfreigaben. Die
vorhandene reguläre Ablaufprüfung darf weiterhin abgelaufene temporäre Zustände
bereinigen; der Überblick verlängert sie nicht. Ein Listen-Eintrag bestätigt
keine aktuelle Objektidentität und erlaubt kein Ritual, Tracking, Löschen,
Korrigieren oder Beginnen einer Tätigkeit. Diese Vorgänge benötigen weiterhin
ihren jeweils eigenen aktuellen Nutzerauftrag und Bestätigungsablauf.

Der Nutzen der Schnittstelle liegt im vollständigen Rückblick auf eine kleine
vorhandene Sammlung. Die Adapter lernen keine zweite Suchstrategie und müssen
weder sortieren noch Quellen zusammensetzen. Die größere Werkzeugrückgabe ist
bewusst auf acht begrenzte Records beschränkt; sie ersetzt keine dauerhafte
Vergrößerung des normalen Kontexts.

## Prüfung

Der Kernprüflauf prüft leere, einzelne und volle Sammlungen, die deterministische
Ordnung, vorhandene bestätigte Korrekturen und deren Quellen, Kopierisolation
und fehlende Nebenwirkungen. Der öffentliche Runtime-Prüflauf führt die
tatsächlichen PCM- und WebRTC-Werkzeughandler mit vorgegebenen Transkripten aus.
Er prüft auch veraltete Antworten, den unveränderten genauen Abruf und fehlende
Ritualrechte durch eine Listenausgabe.

Das ist ein Nachweis des lokalen Daten- und Protokollwegs. Eine vom echten
Sprachmodell gebildete, natürliche Zusammenfassung und ihre Wirkung auf eine
Person bleiben offen; das gesamte Companion-Ziel ist damit nicht abgeschlossen.

## Beobachtete Ergebnisse

- `pnpm run companion:offline-test`: PASS. Enthalten sind die neuen Kern- und
  Runtime-Prüfungen sowie die bestehenden Abruf-, Such-, Korrektur-, Speicher-,
  Gesprächsgrenzen-, Spiel- und Ritualprüfungen.
- `pnpm run ios:check`: PASS auf dem abschließenden Quellstand, einschließlich
  TypeScript und der bestehenden lokalen Runtime-, Safety-, Sprach-,
  Aufmerksamkeits- und Companion-Prüfungen.
- Beide tatsächlichen PCM-/WebRTC-Handler liefern im vorgegebenen Rückblickturn
  alle drei bestätigten Test-Episoden und die vollständige korrigierte Fassung
  samt Quellen. Ungültige Argumente, doppelte Turn-Aktionen und veraltete
  Antworten werden abgewehrt. Die ID eines Listeneintrags erlaubt weiterhin keinen genauen
  Ritualabruf, solange der aktuelle Nutzerturn den Titel nicht nennt.
- Das vollständige Fixture mit acht ASCII-Episoden misst 7.455 Bytes als
  JSON-Werkzeugantwort. Das ist ein Messwert dieses Fixtures, kein globales
  Byte-Maximum; Unicode und bis zu zwei Korrekturquellen pro Eintrag können
  größere Antworten ergeben. Die tatsächliche Struktur bleibt auf acht
  Records mit den bestehenden Feldgrenzen begrenzt.
- Der unabhängige enge Code-Review fand keine weitere konkrete Regression
  dieser Änderung. Die normale Ablaufprüfung und der Themenwechsel bleiben
  von den Seiteneffekten eines Listenaufrufs getrennt.
- Offline-iOS-Export: PASS mit
  `EXPO_OFFLINE=1 pnpm exec expo export --platform ios --output-dir output/companion-episode-overview-ios-export`.
  Bundle: `entry-d40a8283f709655c5953b3aaa735241d.hbc`.

Die Änderung liegt in `src/behavior/behavior-companion.ts`,
`src/voice/realtime-config.ts` und den beiden Realtime-Transports. Die neuen
Prüfdateien heißen `scripts/shared-episode-overview.test.mjs` und
`scripts/shared-episode-overview-runtime.test.mjs`; `package.json` bindet sie in
die vorhandenen Prüfkommandos ein. `USER_GUIDE.md` beschreibt die offene Frage.
Es gibt keine neue Oberfläche, Kameraberechtigung oder Bewegungsschnittstelle.

Sämtliche Transkripte, Antworten sowie externe und native Abhängigkeiten dieser
Prüfung sind lokale Vorgaben oder Ersatzadapter. Es wurde kein Modell/API-Zugang,
Mikrofon, Kamera, physischer Roboter oder Simulator benutzt. Der Export ist ein
JS-/Asset-Build und kein nativer Xcode-Build.
