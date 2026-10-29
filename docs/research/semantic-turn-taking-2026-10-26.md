# Gesprächswechsel: feste Pause und semantisches Beitragsende

Stand: 26. Oktober 2026. Fortsetzung des aktiven Forschungs- und Umsetzungsziels.
Die vorige Runde war Fortschritt: Die explizite Verknüpfung einer lokalen Region
mit einer bestätigten Tätigkeit und eine native Ausdrucksprobe wurden eingebaut.
Diese Runde behandelt die noch offene Koordination des Gesprächswechsels.

## Frage und belegter Ausgangspunkt

Wie kann LOOI Denkpausen besser zulassen, ohne jede Pause als Erlaubnis für eine
Antwort oder Bewegung zu behandeln? Beide Realtime-Transporte verwendeten
ausschließlich `server_vad`: Schwelle 0,15, 500 ms Vorlauf und 1.000 ms Stille.
Normale Antworten entstehen automatisch; nur lokale autoritative Abläufe wie
Spiel und Referenzkorrektur beanspruchen einen manuellen Antwort-Commit.
Der abgeschlossene Transkripttext kommt getrennt von der serverseitigen
Entscheidung zum Beitragsende an.

Der fachliche Hebel ist der Endpointer im gemeinsamen
`src/voice/realtime-config.ts`. Ein nachgeschalteter Decisions-Aufruf über das
fertige Transkript wäre für die gewöhnliche automatische Antwort zu spät.
Er würde außerdem die bereits beobachtete Modelllaufzeit in den Sprechwechsel
einführen. Die alternative Erklärung bleibt offen: Auf dem echten Gerät können
Akustik, Echounterdrückung, Transkription oder Wiedergabe einen größeren Anteil
der Verzögerung verursachen. Bisher gibt es dafür keinen gepaarten Sprachtest.

Die Ausgabe wird schon heute erst nach bestätigtem Wiedergabeabschluss als
gehört gemeldet. Diese Eigenschaft wurde nicht als fehlende Funktion neu gebaut.
Geprüfte Quellen im Repository waren die beiden Realtime-Dienste,
`realtime-config.ts`, `realtime-reference-repair.test.mjs`,
`behavior-realtime-integration.test.mjs` und der bisherige
[Ausdrucksbericht](state-of-the-art-expression-2026-10-26.md).

## Primärquellen und Gegenbelege

Die aktuelle **OpenAI-Dokumentation**, abgerufen am 26. Oktober 2026, beschreibt
neben akustischer Stille ein semantisches Beitragsende. Der Klassifikator kann
bei unvollständiger Sprache länger warten. Die Modi bleiben mit automatischer
Antwort und Unterbrechung kombinierbar. Das ist eine dokumentierte API-Fähigkeit,
kein gemessener Nutzen für LOOI.
[Realtime VAD guide](https://developers.openai.com/api/docs/guides/realtime-vad)

Die **API-Referenz** grenzt die Parameter ab: Schwelle, Vorlauf und feste
Stilledauer gehören zu Server-VAD; semantische VAD hat `eagerness`.
`auto` entspricht `medium`; dort beträgt der dokumentierte maximale Timeout vier
Sekunden. Das ist keine zugesicherte Antwortlatenz. Unsere semantische
Konfiguration enthält deshalb keine scheinbar weiterwirkenden akustischen
Schwellenwerte.
[Realtime client events](https://developers.openai.com/api/reference/resources/realtime/client-events)

**Skantze und Irfan, HRI 2025**, eingereicht am 15. Januar 2025, kombinieren
TurnGPT und audio-basierte Voice Activity Projection. In einer Studie mit
39 Erwachsenen und Furhat berichten sie weniger Unterbrechungen und kürzere
Antwortverzögerungen sowie eine Präferenz für das kombinierte System. Diese
Kontrollstudie begründet die Untersuchung zusätzlicher semantischer Evidenz;
LOOI reproduziert weder ihre Modelle noch ihren Hardwareaufbau.
[Originalarbeit](https://arxiv.org/abs/2501.08946)

**TurnBench v2, 16. September 2026**, vergleicht 14 Systeme auf annotierten
Gesprächen. Die Autoren finden keinen Ansatz, der zugleich schnell, selektiv
und vollständig bei der Erkennung ist. Sie benennen ausdrücklich die Grenzen
englischer, im Studio aufgenommener Zweiergespräche sowie fehlende
Unterbrechungsbewertung für Full-Duplex-Modelle. Deshalb kann ein günstiger
Benchmarkwert weder unsere vier Sprachen noch die Fernfeldakustik abnehmen.
[Benchmark und Einschränkungen](https://arxiv.org/html/2608.25218v2)

## Abwägung und ausgeführter Auftrag

| Weg | Erwarteter Nutzen | Grenze und Entscheidung |
|---|---|---|
| Stillefenster verkürzen | Weniger feste Wartezeit | Würde Denkpausen weiterhin allein akustisch behandeln. Keine Senkung ohne Vergleich. |
| Decisions vor jede Antwort schalten | Eigene semantische Freigabe | Fertiges Transkript liegt nach dem heutigen automatischen Start vor; zusätzlicher Umbau und Wartepfad. Nicht gewählt. |
| Zusätzliche lokale VAP-/Prosodiemodelle | Kontinuierliche Vorhersage aus Audiosignalen | Braucht zusätzliche Modelle, Daten, Integration und Messungen. Offener Forschungsweg. |
| Semantische Realtime-Endpunktierung wählbar ergänzen | Nutzt den bestehenden Audiostream und lässt sich mit demselben System vergleichen | Vollständig eingebaut; bisherige Fernfeldkonfiguration bleibt bis zu echter Evidenz Standard. |

Der umgesetzte Auftrag ist ein wählbarer Gesprächswechsel in den vorhandenen
Spracheinstellungen. Die Auswahl muss persistieren, im tatsächlich gestarteten
Sprachdienst ankommen, während dieser Sitzung stabil bleiben und erst beim
nächsten Start wechseln. Lokale Antwortfreigaben, STOP, Unterbrechung und die
Bindung körperlicher Cues an gehörte Ausgabe bleiben unverändert. Der Vertrag
ist durch reale Konfigurations- und Dienstaufrufe mit ersetzten externen
Audio-/Netzwerkschnittstellen prüfbar; bessere Gesprächsqualität ist erst durch
einen echten Vergleich prüfbar.

## Implementierter Datenweg

- `src/store/user.ts` speichert `realtimeTurnTaking` als `fixed` oder `semantic`.
  Fehlende oder ungültige Werte werden zu `fixed`; eine gültige Auswahl bleibt
  bei anderen Einstellungsänderungen und Neustart erhalten.
- `app/(tabs)/settings.tsx` zeigt die zwei Möglichkeiten in den bestehenden
  Gesprächseinstellungen nur für Realtime. Die vier Übersetzungen in
  `src/i18n/ui-strings.ts` erklären Denkpausen, möglicherweise längeres Warten
  und den nächsten Gesprächsstart. Der Wechsel startet kein Gespräch abrupt neu.
- `src/voice/realtime-config.ts` erzeugt bei `semantic` die dokumentierte
  `semantic_vad` mit `eagerness: auto`. Sonst bleibt die bisherige
  Fernfeldkonfiguration erhalten. In beiden Modi gilt
  `create_response: !manualBehaviorTurns` und `interrupt_response: true`.
- `realtime-conversation.ts` und `realtime-pcm-conversation.ts` erfassen die
  Auswahl beim Start und verwenden sie auch bei späteren Kontext-, Spiel-,
  Reparatur- und Preference-Updates; WebRTC berücksichtigt zusätzlich seinen
  bestehenden VAD-Recovery-Pfad.
- Erst ein `session.updated` protokolliert das vom Server zurückgemeldete
  Profil und dessen semantische Eagerness. Fehlende Angaben bleiben unbekannt.
  Die neuen Felder enthalten weder Audio noch Transkript. Es entsteht kein
  zusätzlicher Modellaufruf und keine neue Motorfreigabe.

## Ausgeführte Prüfungen

`scripts/realtime-turn-taking.test.mjs` prüft den tatsächlichen gemeinsamen
Konfigurations-Builder für alle vier Sprachen und manuelle/automatische
Antwortfreigabe. Die echte Preferences-Logik läuft gegen In-Memory-Speicher und
Zustand: Altbestand, ungültige Werte, Schreiben, Neustart und Erhalt bei anderen
Änderungen sind geprüft.

`scripts/realtime-turn-taking-runtime.test.mjs` durchläuft den tatsächlichen
Start-, Stopp- und Neustartpfad beider Sprachdienste mit ersetzten Audio-,
Socket-, Peer- und Secret-Schnittstellen. Er prüft semantische Initialisierung,
stabile Auswahl trotz Live-Preference-Wechsel, manuelle Antwortfreigabe,
Unterbrechung, ausbleibende Erfolgsmeldung vor Serverbestätigung und den nächsten
Start mit fester Pause. Das ist kein Server- oder Sprachqualitätstest.

Beide Prüfungen bestehen über `pnpm run realtime:turn-taking-test` und sind im
iOS-Gesamtlauf registriert. `pnpm run realtime:test`,
`realtime-reference-repair.test.mjs` und der vollständige `pnpm run ios:check`
bestehen. Zwei veraltete Erwartungen im bisherigen Realtime-Test wurden mit
bereits vorhandenen Aktivitäts-/Ritual-Tools und dem Budget-Modus abgeglichen;
die Prüfung der Modusnormalisierung ruft jetzt die tatsächliche Funktion auf.
Die Sprach- und TypeScript-Prüfungen bestehen ebenfalls.

Der aktualisierte signierte native Release-Build für `iphoneos` besteht.
`codesign --verify --deep --strict` bestätigt die Signatur des fertigen
Pakets unter
`/private/tmp/my-looi-iphone-derived/Build/Products/Release-iphoneos/MyLOOI.app`.
Buildlog: `/private/tmp/my-looi-semantic-turn-taking-device-build.log`.
Die vorhandenen Offline-Sprachmodelle bleiben enthalten. Auch der aktuelle
Release-Build für `iphonesimulator` besteht; die App wurde im eigenen
iPhone-16-Simulator „LOOI Expression Review“ installiert und gestartet.
Buildlog: `/private/tmp/my-looi-semantic-turn-taking-simulator-build.log`.
Das bestätigt Paketbau, Installation und Prozessstart, keine sichtbare
Einstellungs- oder Sprachabnahme.

Ein unabhängiger Review fand keinen konkreten Fehler bei Profilbindung,
Antwortfreigabe, Migration und Einstellungswechsel. Die Computerbedienung meldet den Mac erneut als
gesperrt. Eine sichtbare Abnahme der neuen Einstellung oder ein echter
Sprachversuch wurde deshalb nicht als bestanden gewertet. `devicectl` meldet
das physische iPhone weiterhin als `unavailable`; dieses Update wurde dort
nicht installiert. Test- und Gesamtlauflog:
`/private/tmp/my-looi-semantic-turn-taking-ios-check.log`.

## Noch benötigter Vergleich

Für jede unterstützte Sprache werden dieselben gesprochenen Beiträge unter
beiden Profilen getestet: klar abgeschlossene kurze Frage, Pause im Nebensatz
mit Fortsetzung, „ähm“ und Selbstkorrektur, längere Denkpause, kurzer
Zustimmungslaut während LOOI spricht, ausdrückliches Unterbrechen und STOP.
Nah- und Fernfeld sowie störende Hintergrundgeräusche sind getrennte Bedingungen.
Einstellungen, Modell, Sprachlautstärke und Reihenfolge müssen festgehalten
und die Bedingungen abwechselnd beziehungsweise randomisiert ausgeführt werden.

Gemeinsam auszuwerten sind falsche Antwortanfänge vor beabsichtigtem Ende,
abgeschnittene Beiträge, erkannte Unterbrechungen und Verzögerung bis hörbarer
Ausgabe. Lokale Event-Empfangszeiten sind keine Messung des akustischen
Beitragsendes; ihre Differenz darf nicht als echte menschliche Antwortlücke
ausgegeben werden. Eine getrennte erlaubte Aufnahme oder unabhängige Annotation
ist für diesen Vergleich nötig. Es wurden hier keine Aufnahmen erstellt.

Vor einer Standardumstellung brauchen wir einen solchen Vergleich auf dem
tatsächlichen iPhone. Die neue Auswahl macht ihn durchführbar, ersetzt ihn
aber nicht. Natürlichkeit, reale Motorik, Trackingqualität und die übrigen
offenen Nachweise des Gesamtziels bleiben offen.
