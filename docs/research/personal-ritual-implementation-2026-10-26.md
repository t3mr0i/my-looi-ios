# Persönliche Rituale zu bestätigten Erinnerungen

Stand: 26. Oktober 2026. Dritter Baustein der
[2030-Phase](lebendigkeit-phase-2-2030-2026-10-26.md). Der Ausbau knüpft an
bestätigte Episoden und den [gemeinsamen Objektversuch](shared-activity-implementation-2026-10-26.md)
an. Er ist vom einmaligen Startzeichen eines Versuchs getrennt.

## Nutzerwert und Ausgangspunkt

LOOI soll eine gemeinsam gewählte kleine Eigenheit später wiedererkennen können,
ohne sie bei jeder Erwähnung zu wiederholen. Bisher hatte jede Episode bereits
ein beim Anlegen vorgeschlagenes Motiv. Es fehlten eine ausdrückliche spätere
Wahl, ein stiller Override ohne Vergessen der Erinnerung und ein optionaler
gemeinsam gewählter Satz.

Die neue Präferenz liegt deshalb direkt an der bestehenden Episode, statt einen
weiteren Erinnerungsspeicher einzuführen. Eine aktive Präferenz hält die gewählte
Geste, den optionalen Satz, Herkunft und Bestätigungszeit. Eine stille Präferenz
überschreibt auch das alte Episodenmotiv. Die bestehenden alten Erinnerungen
bleiben lesbar.

## Auswahl und Wiederaufgreifen

In einer aktiven Realtime-Unterhaltung kann eine bereits bestätigte Episode
benannt werden, zum Beispiel: „Bei Gerda möchte ich ein kleines Nicken und den
Satz Mission Gerda!“ Die Geste muss in der aktuellen Nutzeräußerung tatsächlich
benannt sein. Ein Satz ist optional, auf 80 Zeichen begrenzt und muss wörtlich
im Nutzerzitat stehen. Das Sprachmodell darf keinen neuen Satz dazuerfinden.

Die lokale App erzeugt eine Rückfrage auf Deutsch, Englisch, Ukrainisch oder
Russisch. Erst die genau einmal gehörte Frage und die klare nächste Bestätigung
speichern die aktive Wahl. Ein Nein nach der gehörten Auswahlfrage hält das
Ritual still; ein ungehörter oder mehrdeutiger Vorgang erzeugt keine neue Wahl.

Das spätere Ritual wird nur beim eindeutigen, aktuell benannten Abruf einer
bestätigten Erinnerung angeboten. Es erzeugt keine zusätzliche Antwort oder
ungefragte Ansprache. Ist ein Satz gewählt, darf er in der aktuellen Antwort
einmal vorkommen. Die Geste wartet auf das gehörte Ende dieser Antwort mit dem
gewählten Satz; ohne Satz muss die Antwort die Episode benennen. Ein neuer Turn,
Abbruch oder abgelaufener Bezug verwirft die wartende Geste.

Die Grenze beträgt ein angebotenes Ritual pro Episode innerhalb von 24 Stunden,
zusätzlich zum bestehenden globalen Gestenabstand. Diese Zahl ist ein bewusst
konservativer Ausgangswert, keine aus Nutzungsdaten abgeleitete optimale Dosis.
Gespeichert wird der Zeitpunkt des **Angebotsversuchs**, auch wenn danach die
Sprachausgabe unterbrochen oder eine Bewegung abgewiesen wird. Er ist kein
Nachweis einer gehörten Phrase oder erfolgreich ausgeführten Kopfbewegung.
Die Pause gilt auch nach Neustart oder erneuter Auswahl derselben Episode.

Ein unmittelbares Nein nach einem tatsächlich gehörten Ritual macht genau
dieses Ritual still. Dazu gehören auch klare Antworten wie „Nein, lass das
bitte“ oder „No, stop it“. Mehrdeutige Sätze oder ein verneintes Ausschalten
werden nicht als solche Ablehnung gespeichert. Die Zuordnung gilt nur für die
nächste Nutzerantwort und
kurzzeitig, damit ein späteres Nein zu einer anderen Frage nichts deaktiviert.
Die stille Wahl bleibt gespeichert. In den Einstellungen lässt sich das Ritual
ebenfalls ausschalten, ohne die Erinnerung zu löschen. Dabei wird die laufende
Unterhaltung über die vorhandene Mutation-Sperre beendet, damit sie keinen
alten Ritualentwurf mehr abspielen kann. Neue Aktivierung benötigt wieder die
ausdrückliche Auswahl und Bestätigung.

## Technischer Vertrag

`behavior-companion.ts` besitzt Präferenz, Vorschlag, gehörte Rückfrage,
Wiederholungsabstand und den kurzlebigen Angebotsbezug. Der Behavior-Engine
nimmt die gehörte Geste in seine bisherige Ein-Gesten-Arbitrierung auf.
„Weniger nicken“, Schlaf, Fokus, Fahrsteuerung, STOP und Kamerabesitz behalten
Vorrang. Neue Kopf- oder Fahrbefehle wurden nicht hinzugefügt; die Auswahl nutzt
die vorhandene Gesten-Whitelist.

Beide Realtime-Transports reichen `set_episode_ritual` durch denselben lokalen
Companion-Pfad. Genaues aktuelles Zitat, Sitzung, Turnrevision und die bestehende
Beschränkung auf eine Companion-Aktion pro Turn gelten weiterhin. Das aktive
Angebot steht nur im passenden aktuellen Gesprächskontext. Ein gespeicherter Satz
ist Nutzerdaten, keine allgemeine Anweisung an das Modell.

Die Settings-Abschaltung nutzt denselben Gesprächs-/Mutationsschutz wie eine
Erinnerungsänderung, verwirft wartende Cues und speichert die stille Präferenz
sofort. Vergessen einer Episode und Löschen des Gelernten entfernen die
gebundene Präferenz mit.

## Prüfstand und offene Abnahme

Am 26. Oktober auf dem integrierten lokalen Quellstand ausgeführt:

| Prüfung | Beobachtetes Ergebnis |
|---|---|
| `scripts/personal-ritual.test.mjs` | PASS: Auswahl, genaue gehörte Rückfrage, Wortlautbindung, kurze und zusammengesetzte Ablehnung, explizite und verneinte Abschaltung, genau einmal gehörte Phrase bzw. Titel, Fristen, 24-Stunden-Abstand über Restore, rückwärts gestellte Uhr, Vergessen und Settings-Abschaltung |
| `scripts/personal-ritual-engine.test.mjs` | PASS: keine persönliche Geste vor passender gehörter Antwort, höchstens eine gewählte Geste, Unterbrechung und alte Antworten, weniger Nicken, stille Präferenz ohne altes Motiv, Ablehnung gegen eine enthusiastische Modell-Cue, konkurrierende Aktivitätsbestätigung |
| `scripts/behavior-runtime-moments.test.mjs` | PASS: tatsächlicher Runtime-Adapter mit offline injizierten Abhängigkeiten; persönliche Auswahl überschreibt die generische Geste, Abschalten während der Vorbereitungsphase verhindert den Motoraufruf, beendet den Gesprächskontext und speichert Stumm ohne die Episode zu löschen |
| `scripts/behavior-companion-voice.test.mjs` | PASS: beide Realtime-Transports, aktuelles Zitat, Sitzung, Turnrevision, gültige und ungültige Werkzeugargumente |
| `scripts/personal-ritual-settings.test.mjs` | PASS: tatsächliche Settings-Komponente serverseitig gerendert; aktive, stille und ältere Einträge in vier Sprachen; richtiger Eintrag im Abschalt-Handler |
| Impeccable `detect --json src/ui/BehaviorSettings.tsx` | Exit 0, `[]`; keine mechanischen Befunde |
| `pnpm exec tsc --noEmit` und `pnpm run ios:check` | PASS; die Gesamtprüfung enthält auch Ausdrucks-, Timing-, Aktivitäts-, BLE-, Lifecycle-, Sprach- und Objektaufmerksamkeitsprüfungen |
| Offline `expo export --platform ios` | PASS; iOS-Hermes-Bundle in `output/personal-ritual-ios-export` erzeugt |
| `git diff --check` | PASS |

Die neue Settings-Zeile ist noch nicht visuell abgenommen. Die lokale
Browsernutzung war in Work deaktiviert; der SSR-Test ist kein Screenshot- oder
Layoutnachweis. In dieser Runde wurde kein neues iPhone-Update installiert,
kein echter Sprachmodelllauf durchgeführt und keine physische Geste ausgelöst.

Die nächste Geräteabnahme soll eine bestätigte Episode mit gewähltem Satz
abrufen, einmal die Geste zulassen und einmal während der Vorbereitung
unterbrechen bzw. in den Settings ausschalten. Danach sind Stummschaltung und
Wiederholungsabstand über einen Neustart zu prüfen. Ein bereits angebotenes
Ritual verbraucht die 24-Stunden-Gelegenheit auch dann, wenn die Person es
danach ablehnt oder unterbricht.

Diese Prüfungen ersetzen keine Beurteilung der Natürlichkeit. Ob ein konkretes
Ritual süß, passend oder zu häufig wirkt, bleibt im Alltag mit der Person zu
prüfen. Es werden keine autonome Personenidentität, verlässliche Erkennung über
Tage oder menschliche Gefühle behauptet.
