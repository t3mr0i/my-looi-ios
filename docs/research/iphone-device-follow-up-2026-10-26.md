# iPhone: erneute Geräteprüfung am 26. Oktober 2026

Status: auf ausdrücklichen Nutzerwunsch beendet, Geräteabnahme unvollständig.
iPhone 16, iOS 27.0; kein physischer LOOI vorhanden.
Die folgenden Beobachtungen ersetzen keine Hardware-Abnahme.

## Direkt beobachtet vor erneuter Installation

- My LOOI ließ sich öffnen und die Roboterdiagnose per Deep Link erreichen.
- Mock-Verbindung aus: `Nicht verbunden`, `Simulated LOOI link loss`, Antrieb angehalten.
- Mock-Verbindung wieder an: `Verbunden`, anschließend Stabilisierung/sicherer Sensorzustand.
- Offline-Szenario **Neugier**: `Bestanden`, erwarteter und beobachteter `Neugieriger Blick`, eine simulierte Entscheidung und ein Gestenversuch, Trace `curious`.
- Ein expliziter STOP wurde im Mock mit `Abgeschlossen: STOPP.` bestätigt.

Beleg: [Neugier auf dem iPhone](evidence/iphone-behavior-curiosity-2026-10-26.png).
Die native Gesichtsvorschau war im beobachteten Neugier-Ergebnis nicht sichtbar.
Der installierte Bundle-Inhalt war zu diesem Zeitpunkt nicht eindeutig zugeordnet.

## Erneut installierter vorbereiteter Build

Die Installation als Update wurde durch CoreDevice bestätigt. Bundle-ID:
`io.github.razor79.mylooi`; Version 2.1.151, Build 41. Verwendetes lokales Artefakt:
`/private/tmp/my-looi-iphone-derived/Build/Products/Release-iphoneos/MyLOOI.app`.
SHA-256 von `main.jsbundle`:
`d5ba55da6e31e192f42eaff1a9662f465ac368b260ced40b8cf9bd96b6c60af8`.
Das vorbereitete Bundle enthält die native Gesichtsvorschau und deren Wiedergabe.

Device Hub musste nach `The connection was invalidated` neu verbunden werden.
Eine überlagernde Videowiedergabe wurde für die Prüfung beendet. Anschließend war
die Roboterdiagnose im Hochformat auf dem physischen Gerät sichtbar. Der gewählte
Mock-Modus blieb erhalten. Vor dem erneuten Verbindungswechsel standen Schalter
und Status vorübergehend widersprüchlich auf ein bzw. `Nicht verbunden`.
Eine erneute Auswahl des bereits ausgewählten Mock-Modus stellte sichtbar
`Verbunden` her. Der Quellcode stützt als Ursache einen Kaltstart direkt in die
Diagnose: gespeicherte Einstellungen werden geladen, die übliche Initialisierung
der Verbindung im Hauptbildschirm wird dabei möglicherweise umgangen. Ein
vollständiger Vergleich mit einem Kaltstart über den Hauptbildschirm fehlt.

## Noch nicht in diesem Durchlauf bestätigt

Freude, Weniger nicken, Unterbrochen, native Gesichtsphasen und visuelle Wiedergabe;
erneute Bewegungs-/Sensorprüfungen im oben identifizierten Build; eine echte
Decisions-Anfrage; Hochformat-Einrichtung mit eingeblendeter Softwaretastatur.
Ältere erfolgreiche Prüfungen stehen separat in
[iphone-mock-acceptance-2026-10-26.md](iphone-mock-acceptance-2026-10-26.md).

Der API-Schlüssel wurde in diesem Durchlauf weder ausgelesen, ersetzt noch exportiert.
Bis zu diesem Stand wurde keine echte Decisions-Modellinferenz ausgelöst.

## Gemeinsame Geräteansicht

Der Chat „Reachy Mini-Kompatibilität prüfen“ wurde mit ausdrücklicher Zustimmung
des Nutzers um vorübergehende Freigabe gebeten und bestätigte diese. Später
wechselte dasselbe Device-Hub-Fenster während einer Eingabe auf den Simulator
„LOOI Four Features iPhone Review“. Diese Eingabe gilt deshalb nicht als
physischer iPhone-Test. Mit zusätzlicher ausdrücklicher Zustimmung wurde auch
der Chat „Roboter ausdrucksstärker gestalten“ um Freigabe gebeten; er bestätigte
die Freigabe. Nach Wiederherstellung der Ansicht blieb eine Videowiedergabe als
Bild-in-Bild-Überlagerung sichtbar.

Der Nutzer stoppte danach ausdrücklich weitere Handy-Aktionen. Seit dieser
Anweisung erfolgten keine weiteren Geräteaktionen. Beide koordinierten Chats
wurden über das Ende der Reservierung und den Stopp weiterer iPhone-Tests
informiert. Die oben offenen Prüfungen werden nicht als bestanden gewertet.
