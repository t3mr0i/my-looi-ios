# Companion-Ziel: Anforderungen und Abnahme

Stand: 26. Oktober 2026. Das unveränderte Ziel bleibt ein süßer, verspielter,
erinnerungsfähiger und verlässlicher Roboter-Companion, der aus offenen Fragen
etwas Passendes machen kann. Die bisherigen Bauabschnitte sind Fortschritt;
sie beweisen dieses Gesamtziel noch nicht.

Die bisherigen Arbeitsrunden haben den autoritativen Quellstand um bestätigte
gemeinsame Tätigkeiten, persönliche Rituale und ausführbare Prüfungen erweitert.
Das [Anknüpfen und Korrigieren im Gespräch](companion-conversation-continuity-2026-10-26.md)
ist lokal geprüft. Die nächste Abnahme ist als
[begrenzter echter Modellprüflauf](companion-live-evaluation-2026-10-26.md)
ausführbar vorbereitet. Der einmalige Zugriff mit dem Shell-Schlüssel scheiterte
mit `401 invalid_api_key`; es fand noch keine Realtime-Inferenz statt.
Für Verweise ohne exakten Eintragstitel ist zusätzlich eine
[lesende beschreibende Erinnerungssuche](companion-descriptive-memory-search-2026-10-26.md)
implementiert. Sie liefert bestätigte Fakten unter ihrem gespeicherten Titel,
ohne daraus eine aktuelle Objektidentität oder Ritualfreigabe abzuleiten.
Die anschließend ausdrücklich beauftragte lokale Weiterarbeit verbessert
[Erinnerungserhalt und Gesprächsgrenzen](companion-offline-reliability-2026-10-26.md):
volle Episodenspeicher verdrängen keine alten Einträge mehr; klare deutsche
Abschluss-, Pause- und Rückkehrsätze ändern den lokalen Aufgaben-/Spielzustand.
Diese lokal geprüften Verbesserungen benötigen bei der Entwicklung keinen
iPhone- oder API-Zugang und ersetzen weiterhin keine echte Gesprächsabnahme.
Die weitere lokale Runde ergänzt eine
[echte Pause im Zahlenratespiel](companion-game-pause-2026-10-26.md):
Zwischenstand erhalten, keine Rateversuche während des Wartens, ausdrückliche
Wiederaufnahme und keine versehentlich angelegte Aufgabe aus dem vorherigen
Gesprächsthema.
Die darauffolgende lokale Arbeit ergänzt die
[bestätigte Faktenkorrektur einer gemeinsamen Episode](companion-episode-correction-2026-10-26.md),
ohne dafür den Eintrag mit seinen Ritualen und Tätigkeiten löschen zu müssen.
Für offene Rückblickfragen wird die Sammlung über einen
[lesenden Überblick aller gespeicherten gemeinsamen Erlebnisse](companion-episode-overview-2026-10-26.md)
erreichbar, ohne einen Namen oder passende Suchwörter vorauszusetzen.
Die neue [Abnahme zusammenhängender Textgespräche](companion-continuity-evaluation-2026-10-26.md)
bereitet Übersicht, Korrektur mit Bestätigung und späterem Abruf sowie die
Spielpause für einen getrennt ausgewählten Modellprüflauf vor. Sie ändert
keine Modell-, Audio- oder Hardware-Nachweisgrenze.

| Anforderung aus dem Ziel | Aktueller belegbarer Stand | Was als Abnahme noch fehlt |
|---|---|---|
| Offen fragen können, passende Antworten und Handlungen bekommen | Beide Realtime-Transports, aktuelle Turn-Evidenz, lokale Werkzeugrückgaben und begrenzte Spiele/Tätigkeiten sind implementiert und testbar | Repräsentative freie Gespräche mit tatsächlichem Sprachmodell; Verständlichkeit, Antwortlatenz und sinnvolle Reparatur bei Missverständnissen |
| Sich wie ein anwesender Roboter verhalten | Gemeinsame Hör-/Denk-/Sprechphasen, Bildschirmblick, vorhandene Kopfgesten und Bewegungs-Arbitrierung; ausgewählte lokale Bildregion | Tatsächlicher iPhone-/Roboterlauf; Blickbezug, Bewegung, Timing und Unterbrechbarkeit bei realer Beleuchtung und Sprache |
| Süß und angenehm wirken | Konfigurierbarer Sprachstil, Gesichtsreaktionen und explizit gewählte kleine persönliche Rituale | Urteil der Person im Alltag; keine Codeprüfung kann „süß“ oder passende Dosis allein nachweisen |
| Gemeinsam Spaß haben | Kleines lokales Spiel, bestätigter Objektversuch und einmaliges vereinbartes Startzeichen | Freiwilliges Wiederaufgreifen und positive Nutzerreaktionen ohne störende Wiederholung oder starres Frageprogramm |
| Sich an uns erinnern | Persönliche Memory, bestätigte gemeinsame Episoden, bestätigte Textbeschreibung und Herkunft; genauer Abruf und beschreibende Kandidatensuche liefern vollständige gespeicherte Details statt nur Vorschauen; Aufgabenstand und Präferenz können lokal wiederhergestellt werden | Reale Erinnerungsgespräche über Tage mit Korrektur/Vergessen; tatsächliche Modellzuordnung ohne exakten Titel, falsche Zuschreibungen und Verwechslungen messen |
| Verlässlich sein | Explizite Bestätigung, Session-/Turn-/Fokus-/Schlafgrenzen, STOP, Bewegungsgrenzen, Ablauf und Ressourcenfreigabe sowie das lokale Ersetzen einer frühen Antwort nach einer Korrektur sind durch Verhaltensprüfungen abgesichert | Geräteversuche zu Verbindungswechsel, Audio, Handzeichen, Objektverlust, Abbruch und Wiederaufnahme; echte Ereignisfolgen und Grenzen des Antwortprotokolls prüfen; kein Test darf eine nicht ausgeführte Aktion als erledigt melden |
| Ein schöner Companion im Gesamtfluss sein | Die Einzelpfade teilen Zustand und bestehende Kamerabesitzer; neue technische Einstellungen bleiben außerhalb des Hauptgesichts | Durchgehende echte Nutzungsabläufe und subjektive Abnahme; Kombination und Alltagseffekt sind bislang nicht ausreichend belegt |

## Nachweise, die nicht verwechselt werden dürfen

- Ein lokaler Test mit injiziertem Sprachmodell belegt Zustandswechsel und
  Verträge, keine tatsächliche Sprachqualität oder Modellzuverlässigkeit.
- Ein exportiertes iOS-Hermes-Bundle belegt Bundling. Ein Xcode-Build belegt
  Kompilierung. Beides ist noch kein auf dem iPhone geprüfter Roboterablauf.
- Eine verfolgte 2D-Region ist keine nachgewiesene Objektidentität. Ein
  angenommenes Startzeichen belegt keinen physischen Versuch. Ein reservierter
  Ritualversuch belegt keine tatsächlich ausgeführte Kopfbewegung.
- Die lokale Browsersteuerung war für frühere synthetische Auswahlprüfungen
  verfügbar. Beim Versuch der neuen Ritual-Settings-Prüfung war sie in Work
  deaktiviert. Deshalb liegt für diese neue Zeile noch keine visuelle Abnahme
  vor; ein Quell-/Rendertest ersetzt sie nicht.

## Verknüpfte Bauabschnitte

- [Lebendigkeit und bestätigte Episoden](lebendigkeit-implementation-2026-10-26.md)
- [Lokale gemeinsame Aufmerksamkeit](object-attention-implementation-2026-10-26.md)
- [Stabile Auswahl und Wiederholung](object-attention-refinement-2026-10-26.md)
- [Bestätigter gemeinsamer Objektversuch](shared-activity-implementation-2026-10-26.md)
- [Persönliche Rituale](personal-ritual-implementation-2026-10-26.md)
- [Vollständiger Erinnerungsabruf und Gesprächskorrektur](companion-conversation-continuity-2026-10-26.md)
- [Vorbereitete freie Modellgespräche und tatsächlicher Zugangsfehler](companion-live-evaluation-2026-10-26.md)
- [Gemeinsame Erinnerungen über eine Beschreibung finden](companion-descriptive-memory-search-2026-10-26.md)
- [Offline geprüfter Erinnerungserhalt und Gesprächsgrenzen](companion-offline-reliability-2026-10-26.md)
- [Echte Spielpause und bewahrter Zwischenstand](companion-game-pause-2026-10-26.md)
- [Bestätigte Episodenfakten berichtigen](companion-episode-correction-2026-10-26.md)
- [Offener Rückblick auf die gespeicherten gemeinsamen Erlebnisse](companion-episode-overview-2026-10-26.md)
- [Zusammenhängende Gespräche abnehmen](companion-continuity-evaluation-2026-10-26.md)

## Früherer Gesamtabgleich und offene Abnahme

Am 26. Oktober gegen 17:18 UTC wurde die verfügbare Umgebung erneut geprüft.
`xcrun devicectl list devices` meldet das physische iPhone weiterhin als
`unavailable`; die verbundenen Einträge sind Simulatoren. Die native
CUA-Inventur meldet erneut einen gesperrten Mac, dessen automatische
Entsperrung nicht gelang. Lokale Browsersteuerung ist weiterhin in Work
deaktiviert. Bestehende Sitzungen anderer Chats wurden nicht bedient.

Der [zuletzt tatsächlich geprüfte Shell-Zugang](evidence/companion-live-evaluation-2026-10-26/access-check.json)
wurde mit `401 invalid_api_key` abgewiesen. Ein neuer gültiger Zugang wurde in
diesem Chat noch nicht bereitgestellt. Der bekannte abgewiesene Schlüssel
wurde nicht erneut angefragt; der getrennte App-Schlüssel wurde nicht
exportiert oder geprüft. Es gibt weiterhin keinen echten Realtime-Modellbericht
für die vorbereiteten sechs Fälle.

Der Gesamtabgleich hat die sieben Anforderungen in der Tabelle oben gegen die
aktuellen Implementierungsberichte, Quelle, tatsächlichen iOS-Prüflog und das
exportierte Hermes-Bundle geprüft. Die letzte Zielrunde war konkreter
Implementierungsfortschritt. Die jetzige Prüfung zeigt weiterhin fehlende
Modell-, Geräte- und Nutzerbelege; sie macht daraus keinen erfolgreichen
Abschluss. Ein unabhängiger Lesepfad fand keinen belegten notwendigen
Quellfehler, der vor dem nächsten echten Versuch noch zu beheben wäre.

Diese fehlende Abnahmeumgebung besteht seit drei aufeinanderfolgenden
Zielrunden: dem vorbereiteten Modellprüflauf, der beschreibenden
Erinnerungssuche und der jetzigen erneuten Prüfung. Der nächste notwendige
Fortschritt braucht eine Änderung außerhalb des Quellcodes: gültigen
Modellzugang bzw. den zugänglichen App-Schlüssel, einen entsperrten Mac und
ein erreichbares iPhone mit LOOI für die Sprach-/Roboterabnahme. Für Wirkung,
Spaß und passende Dosierung ist außerdem die Rückmeldung einer Person nötig.

Dieser damalige Gesamtabgleich führte zum Status **blockiert und nicht
abgeschlossen**. Danach hat die Person weitere Companion-Verbesserungen ohne
iPhone und API-Zugang ausdrücklich beauftragt. Erinnerungserhalt,
Gesprächsgrenzen, Spielpause und Faktenkorrektur sind solche eigenständig
ausführbaren Fortschritte. Das Ziel ist während dieser Weiterarbeit wieder
aktiv; die früheren Umgebungsbeobachtungen sind kein frisch geprüfter
Gerätestatus. Der vollständige Anspruch bleibt bestehen und wird erst nach
passenden echten Nachweisen für die offenen Anforderungen abgeschlossen.
Erfolgreiche Einzel-Suites allein reichen dafür nicht.
