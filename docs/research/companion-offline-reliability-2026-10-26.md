# Offline geprüfte Companion-Verbesserungen

Stand: 26. Oktober 2026. Der Nutzer hat die lokale Weiterarbeit ausdrücklich
ohne iPhone und API-Zugang beauftragt. Diese Runde verbessert zwei vorhandene
Verhaltenspfade und prüft sie mit synthetischen Eingaben. Es wurde weder ein
Modell aufgerufen noch ein Gerät oder eine Kamera bedient.

## Zwei reproduzierte Probleme

**Bestätigte Erinnerungen:** Der Companion hat ein bestehendes Limit von acht
gemeinsamen Episoden. Bislang bestätigte er auch eine neunte und entfernte beim
Speichern mit `slice(-MAX_EPISODES)` unbemerkt die älteste. Die bestehende
Prüfung kontrollierte nur die Anzahl acht, nicht den Verlust des ersten
Eintrags. Der neue öffentliche Runtime-Test scheiterte vor der Änderung daran,
dass der volle Speicher die neue Episode weiterhin akzeptierte.

**Gesprächsabschluss und Rückkehr:** „Lass gut sein“ setzte weder `drop` noch
`gameStop`. Eine Aufgabe beziehungsweise ein Ratespiel blieb deshalb aktiv.
Auch „Lass uns später weitermachen“ und „Ich bin wieder da“ wurden von der
lokalen Policy nicht erkannt. Diese Baseline wurde direkt mit der tatsächlichen
Policy und öffentlichen Engine-/Runtime-Ereignissen reproduziert.

## Verhalten nach der Änderung

Ein voller Episodenspeicher gibt für einen gültigen neuen Eintrag
`memory_full` mit Belegung und Limit zurück. Die vorhandenen acht Einträge
bleiben unverändert. Es entsteht keine neue Bestätigungsfrage im lokalen
Zustand; ein anschließendes „Ja“ kann deshalb nichts überschreiben. Ein schon
vorhandener Titel wird weiterhin als `title_exists` erkannt. Ungültige Belege
und alte Turns behalten ihre bisherigen Fehler.

Das Limit bleibt acht. Eine größere Kapazität würde das Problem des
stillschweigenden Verdrängens nur verschieben. Ein eigener Austauschdialog
würde neuen Auswahl- und Bestätigungszustand einführen. Stattdessen nutzt das
Produkt den bestehenden gezielten Vergessen-Ablauf: Die Person kann einen
konkreten Eintrag auswählen und dessen Löschung bestätigen; anschließend ist
für eine neue Episode wieder Platz. Das Produkt wählt keinen Eintrag zum
Löschen selbst. Bereits früher verlorene Episoden werden damit nicht
wiederhergestellt.

Beide Realtime-Adapter reichen das echte Kapazitätsergebnis unverändert weiter.
Für denselben Nutzer-Turn sperren sie zusätzlich einen `remember`-Versuch als
Ausweichweg in die normale Fakten-Memory. Eine neue gewöhnliche Nutzeräußerung
hebt diese turngebundene Sperre auf. Der Produktions-Prompt verlangt bei
`memory_full` eine ehrliche Antwort ohne Speicherzusage oder erneute
Speicherbestätigung. Wie das Modell dies tatsächlich formuliert, ist damit
noch nicht gemessen.

Die deutsche Policy unterscheidet jetzt folgende vollständige Äußerungen:

| Äußerung | Lokales Verhalten |
|---|---|
| „Lass gut sein.“ | Aktuelle Aufgabe beenden und ein laufendes Ratespiel schließen |
| „Lass es gut sein, bitte.“ / „Lassen wir es gut sein.“ | Derselbe Abschluss; höfliche Varianten bleiben begrenzt |
| „Lass uns später weitermachen.“ / „Wir machen später weiter.“ | Aufgabe pausieren und letzten bestätigten Schritt erhalten |
| „Lass gut sein, wir machen später weiter.“ | Die ausdrücklich genannte spätere Fortsetzung hat Vorrang: Aufgabe pausieren |
| „Ich bin wieder da.“ | Dieselbe gewöhnliche pausierte Aufgabe wieder aufnehmen |

Ein geschlossenes Spiel verbraucht bei einer späteren alleinstehenden Zahl
keinen weiteren Versuch. Der Antwortkontext kennzeichnet es als geschlossen
und fordert keine weitere Schätzung ohne neuen ausdrücklichen Spielwunsch.
Ein aufgabenbezogenes „Vergiss die Aufgabe“ beendet weiterhin nicht nebenbei
ein Spiel.

Ein gemeinsamer Objektversuch hat weiterhin seine bestehenden Regeln:
„Ich bin wieder da“ allein startet ihn nicht erneut. Ein aktueller benannter
Wiederaufnahmevorschlag, dessen gehörte Frage und eine spätere klare Zustimmung
bleiben nötig; ein Startsignal oder physischer Versuch wird dadurch nicht
angenommen. Ein alleinstehendes „später“, Fragen, verneinte Formulierungen,
Zitate und berichtete Rede lösen die neuen Sprachübergänge nicht aus.

## Zuständigkeiten und Nachweis

Die Episoden-Kapazität bleibt beim Companion; die Bestätigung hat zusätzlich
eine abschließende Kapazitätsprüfung und entfernt keinen alten Eintrag mehr.
Die Sprachdeutung bleibt bei der Policy, die vorhandene Engine führt die
Zustandswechsel aus. In der Engine wurde nur der Antwortkontext eines
geschlossenen Spiels präzisiert. Es gibt keine neue Einstellung und keine
Änderung am Kamerabesitz, Bewegungsrechten oder Modell.

`scripts/companion-memory-capacity.test.mjs` legt acht bestätigte synthetische
Episoden über den öffentlichen Frage-/Antwortfluss an. Geprüft werden die
vollständige Erhaltung, fehlende neue Bestätigung, ein wirkungsloses späteres
Ja, Recall und Suche bei vollem Speicher, Duplikate, ungültige/alte Belege,
Wiederherstellung sowie gezieltes Vergessen und anschließendes normales
Speichern.

`scripts/companion-conversation-boundaries.test.mjs` prüft echte lokale
Runtime-Übergänge für Spielabschluss, Aufgabenende, Pause, erhaltenen
Zwischenstand, Rückkehr und bestätigte gemeinsame Wiederaufnahme. Der
Compound-Fall wurde nach unabhängigem Review ergänzt: Die ursprüngliche
Fassung ignorierte die spätere Fortsetzung, statt sie zu pausieren.

Der bestehende Sprachtest serialisiert die tatsächliche Companion-Rückgabe
über PCM und WebRTC und versucht danach im Folge-Response denselben Eintrag
über `remember` zu speichern. Beide Versuche bleiben ohne neuen Eintrag;
eine frische persönliche Information im nächsten User-Turn bleibt möglich.

Die Tests sind gemeinsam ohne API und Gerät ausführbar:

```sh
pnpm run companion:offline-test
```

Die neuen öffentlichen Prüfungen laufen außerdem über
`companion:continuity-test` im regulären `ios:check`, `behavior:test` und
Repository-Testpfad. Ein unabhängiger Quellreview hat Kapazität,
Sprachadapter-Sperre, Rückkehr und die Abgrenzung des Compound-Falls geprüft.
Nach der Korrektur blieb in diesem begrenzten Umfang kein konkreter Befund.

| Abschließende Prüfung | Ergebnis |
|---|---|
| `pnpm run companion:offline-test` | PASS: Memory-Kapazität, Gesprächsgrenzen, vollständiger Recall/Suche, Korrektur, beide Sprachadapter und bestehende Policy-/Companion-Regeln |
| `pnpm run ios:check` | PASS auf dem endgültigen Stand einschließlich TypeScript, Lifecycle, Audio-/Turn-Grenzen und neuer Companion-Tests |
| Offline `expo export --platform ios` | PASS: `entry-35910f883623a5bd84ed70e4a13b3a18.hbc`, ca. 7,4 MB, unter `output/companion-offline-reliability-ios-export` |
| `git diff --check` im geänderten Umfang | Keine Whitespacefehler |

Die erste vollständige Prüfung und der erste Export bestanden bereits vor dem
Compound-Fix. Beide wurden nach dieser Quelländerung erneut ausgeführt; die
Tabelle nennt ausschließlich den abschließenden Stand. Es wurde keine neue
native App-Version auf einem Gerät installiert.

Die tatsächliche Spracherkennung, Antwortformulierung, Verständlichkeit und
Roboterwirkung sind keine Ergebnisse dieser Offline-Tests. Die zugehörigen
offenen Live-Nachweise bleiben im
[Companion-Abnahmestand](companion-goal-acceptance-2026-10-26.md) dokumentiert.
