# Hermes-/Nous-Bereitstellung am 28. Oktober 2026

Der aktualisierte Hermes-Dienst ist auf dem konfigurierten Netcup-Server aktiv.
Die neue Nous-Verwaltung ist über HTTPS erreichbar. Eine angemeldete persönliche
Nous-Identität wurde bislang nicht bestätigt; der Dienst meldet deshalb korrekt
`server_login_required`. Mail-/Kalenderinhalte werden mit diesem Ausbau nicht gelesen.

Die [bereinigten Prüfergebnisse](../research/evidence/hermes-nous-deployment-2026-10-28.json)
enthalten keine Zugangsdaten oder persönlichen Kontoinhalte.

## Zugang und Bereitstellung

Direktes SSH auf Port 22 läuft aus dieser Umgebung in einen Timeout. In den
vorhandenen Betriebsartefakten war bereits ein funktionierender TLS-Zugang auf
Port 443 hinterlegt. Der neue
[SSH-Helfer](../../services/hermes/self-host/ssh_via_tls.py) macht diesen Weg
wiederverwendbar. TLS-Zertifikatsprüfung und der vorhandene SSH-Hostschlüssel
werden geprüft. Es wurden keine Firewallregeln, DNS-Einträge oder fremden Dienste
verändert. Die genaue Ursache der fehlenden Erreichbarkeit von Port 22 ist nicht
lokalisiert; der vorhandene Wartungszugang über Port 443 ist live nachgewiesen.

- Release: `nous-20261028-0766ceab`.
- Aktives Image: `sha256:6ccd47260d189aff9f4d51068503264c607c8a1901dc32afb9c5e0320d76cc59`.
- Vorheriges Image: `sha256:2f8147216111edfd5065ab5b1133a3f5dd3c990c0016d22c683d3e3369a958c5`.
- Rückwechseltag: `looi-hermes-self-host-agent:pre-nous-20261028-0766ceab`.
- Geschützte Release-Dateien: `/opt/looi-hermes-releases/nous-20261028-0766ceab`.
- SQLite-Online-Sicherung: `/var/backups/looi-hermes/nous-20261028-0766ceab.sqlite3`, Modus `0600`, Integritätsprüfung erfolgreich.

Das neue Image wurde als Quelltextschicht auf dem tatsächlich laufenden Image
gebaut. Hermes-SDK und installierte Abhängigkeiten wurden dabei beibehalten.
Vor dem Wechsel wurde der Kandidat mit einer separaten Sicherungskopie,
`--network none` und ohne veröffentlichte Ports gestartet. Erst nach bestandener
Prüfung wurde ausschließlich der Compose-Dienst `agent` neu erstellt.

Der erste isolierte Start scheiterte am root-eigenen temporären Elternverzeichnis
mit Modus `0700`. Modus `0755` am temporären Elternverzeichnis behob den Testaufbau;
das eigentliche Datenverzeichnis blieb nur für UID 10000 zugänglich. Die Produktion
wurde erst nach dem erfolgreichen erneuten Test umgestellt.

`HERMES_HOME=/opt/data/looi-hermes/home` und
`HERMES_SHARED_AUTH_DIR=/opt/data/looi-hermes/home/shared` zeigen jetzt ausdrücklich
in dasselbe dedizierte persistente Volume. Der Dienst läuft als UID 10000. Die
vorhandenen Volume-Zuordnungen und die vorherige Aufgabe wurden erhalten. Der
Proxy verwendet weiter das bestehende Netz `infra_edge`; es gibt keine
veröffentlichten Host-Ports des Agenten.

## Beobachtete Prüfungen

| Prüfung | Beobachtung |
| --- | --- |
| Lokale Servertests | 34 erfolgreich |
| Isolierter Kandidat | Start und HTTP-Vertrag erfolgreich |
| Tatsächlich installiertes SDK | Konto-Normalisierung und Adapter mit Testdaten erfolgreich |
| Werkzeuge des Rechercheagenten | Ausschließlich `web_search` |
| Öffentliches `/health` | HTTP 200, `status: ok` |
| Geschützte Routen ohne App-Schlüssel | HTTP 401 |
| Authentifiziertes `/v1/capabilities` | HTTP 200, `connectionProviders: ["nous-v1"]` |
| Authentifiziertes `/v1/nous` | HTTP 200, `server_login_required` |
| Echter Rechercheauftrag | HTTP 202, danach `completed`, Antwort und fünf Quellen |
| Aufräumen des eigenen Testauftrags | HTTP 204; Löschquittung bleibt gemäß API bestehen |
| Vorherige Aufgaben | Eine Aufgabe unverändert, gegen Sicherung verglichen |
| SQLite nach Deployment und Test | Integritätsprüfung erfolgreich |
| Container | `healthy`, null Neustarts |
| Nous-Portal vom Server aus | Öffentlicher Katalog HTTP 200, 54 Einträge |
| Gmail/Google Calendar im öffentlichen Katalog | Keine Einträge |

Die SDK-Normalisierung befüllt bei einer frischen Kontoantwort keine `user_id`.
Der Adapter nimmt deshalb die Nutzerkennung aus genau dem Bearer, den das Portal
soeben authentifiziert hat. Vorhandene Nutzerkennungen und die Organisation müssen
übereinstimmen. Das Dekodieren von JWT-Claims allein gilt nicht als Anmeldung.
Globale Gateway-Tokens werden weiterhin nicht übernommen.

## Noch erforderliche Anmeldung

Der offizielle SDK-Geräteablauf wurde im Container unter UID 10000 gestartet.
Der Eigentümer muss sich auf der offiziellen Nous-Seite anmelden und die
Geräteanmeldung bestätigen. Die Zugangsdaten bleiben im dedizierten Serverprofil.
Es wurden keine Zugangsdaten anderer Installationen übernommen, keine
Google-Konten verknüpft und keine persönlichen Inhalte angefragt. Ein abgelaufener
Gerätecode muss durch einen neuen offiziellen Anmeldelauf ersetzt werden.

Bei der erneuten Live-Prüfung war der erste Gerätecode abgelaufen
(`DeviceCodeExpired`); `/v1/nous` meldete weiterhin `server_login_required`.
Ein neuer offizieller Geräteablauf wurde gestartet. Die Rückmeldung eines Codes
im Chat gilt nicht als Bestätigung auf der Nous-Seite.

Nach der Bestätigung muss `/v1/nous` live die tatsächliche Identität und den
angemeldeten Katalog prüfen. Erst dieser Katalog entscheidet, welche Anbieter für
dieses Konto verfügbar sind. Der erfolgreiche Recherchetest prüft die bisherige
OpenAI-/DDGS-Funktion, keine Nous-Anmeldung. Die App-Anbindung an einen privaten
Einzelbesitzer ist damit technisch vorbereitet; ein öffentlicher Mehrnutzerbetrieb
und ein echter Mail-/Kalenderabruf sind weiterhin nicht nachgewiesen.

## Rückwechsel

Vor einem Rückwechsel auf aktive Aufgaben prüfen. Im bestehenden Compose-Verzeichnis
`/opt/looi-hermes/services/hermes/self-host` das gesicherte vorherige Image als
`looi-hermes-self-host-agent:latest` taggen und den Dienst `agent` mit denselben
beiden Compose-Dateien, `LOOI_PROXY_NETWORK=infra_edge` und
`LOOI_ENV_FILE=/etc/looi-hermes.env` per `up -d --no-build --no-deps agent` neu
erstellen. Der vorherige Quelltext liegt als `source-before.tar.gz` im
Release-Verzeichnis. Anschließend Container, HTTPS und Aufgabenbestand prüfen.

Das Datenvolume bleibt bestehen. Eine alte Datenbank nicht über neu entstandene
Aufgaben oder Zugangsdaten kopieren; die Sicherung dient der gezielten
Wiederherstellung. Das vorhandene zusätzliche `/opt/data`-Volume bleibt ebenfalls
erhalten. Kein `down -v` und keine Bereinigung fremder Volumes oder Images.
