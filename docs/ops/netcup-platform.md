# Netcup-Plattform und Fly-Migration

Stand: 26. Oktober 2026. Dieser Betriebsstand unterscheidet umgestellte Dienste von noch offenen Schritten. Zugangsdaten stehen ausschließlich in geschützten Dateien und Coolify, nicht in diesem Dokument.

## Server und Verwaltung

- Netcup VPS 1000 G12, 4 vCPU, 8 GB RAM und 256 GB NVMe. Vertrag: 11,94 € monatlich; einmalig 5 € für das Upgrade.
- Coolify: https://coolify.kaidetmers.de, Projekt „Eigene Apps“, Umgebung „production“. Coolify verwaltet die Compose-Dienste und verschlüsselt deren Variablen. Sein `APP_KEY` muss zusammen mit der Datenbank erhalten bleiben.
- Bestehendes Living Planet samt beiden Workern läuft weiter.
- Zusätzlich sind 4 GB Swap auf der vorhandenen SSD eingerichtet. Der Next-Build läuft separat begrenzt auf 4 GB RAM, maximal 4 GB Swap und zwei CPUs. Der Build erhält keine Produktionsschlüssel.

## Adressen

| Dienst | Adresse | Zustand |
| --- | --- | --- |
| LOOI Agent | https://159-195-212-54.sslip.io | Auf Netcup aktiv; Recherche auf dem iPhone 16 erfolgreich abgeschlossen |
| Walkaround | https://explainer.kaidetmers.de | Aktiv; gespeicherte Erklärung und GitHub-Anmeldung geprüft |
| Plance | https://plane.kaidetmers.de | Aktiv; gewünschter neuer Hostname `plance.kaidetmers.de` noch offen |
| Plance-Dateien | https://plane-files.kaidetmers.de | Privates S3; anonyme Zugriffe ergeben 403 |
| Runrate | https://runrates.de und https://www.runrates.de | Aktiv; TLS, Startseite und Bereitschaftsprüfung erfolgreich |

### Gewünschte Plance-Domain

Die Anwendung zeigt bereits „Plance — The Place to Plan“. Für `https://plance.kaidetmers.de` fehlen noch DNS, anschließend TLS und die gemeinsame Anpassung von öffentlicher Basisadresse, Package-Flow-OAuth-Adresse und S3-CORS. Die Netcup-CCP-Sitzung ist abgelaufen. Solange der A-Eintrag nicht gespeichert werden kann, bleibt die funktionierende alte Adresse bestehen. Der vollständige Ablauf liegt privat unter `/root/fly-migration-20261026/plance-domain-change.pending.json`.

Keine neue Domain als erreichbar melden, bevor öffentliches DNS und TLS geprüft sind. `plane-files.kaidetmers.de` bleibt als separater Dateihost bestehen.

## Daten und Netzwerke

Die Dienste verwenden externe Docker-Volumes. Datenbanken haben keine veröffentlichten Host-Ports.

| Dienst | Datenbestand / Volume | Wiederherstellung geprüft |
| --- | --- | --- |
| Plance und IXI | `migrated-plane-data`; PostgreSQL 17.11 in `/data/postgres` | Nach gestoppten Fly-Schreibprozessen 270 Tabellen und 1.777 Zeilen übertragen; native Wiederherstellung geprüft |
| Dateien | `migrated-plane-storage`; Garage 2.5.0 | Vollständig paginierte Quelle: zwei Objekte, 208.021 Bytes; Inhalt und Metadaten abgeglichen |
| Runrate PostgreSQL | `migrated-runrate-postgres`; PostgreSQL 14.23 | 131 Tabellen, 380 Zeilen; Rollen und Constraints erhalten; native Wiederherstellung geprüft |
| Runrate Trial-Mongo | `migrated-runrate-mongo`; MongoDB 7.0.43 | Saubere Kaltkopie; sieben Collections, 41.980 Dokumente, elf Indexe und vier Benutzer übertragen |
| Walkaround | `migrated-walkaround-data` | 41 Erklärungen, 442 TTS-Dateien, 44 Bilder und drei GitHub-Benutzer übertragen |

Die ursprünglichen App-Images wurden übernommen. Notwendige Provider-Anpassungen werden auf diese tatsächlichen Images gelegt; ein Build des gesamten parallelen, veränderten Arbeitsverzeichnisses ist kein Ersatz für die ausgelieferte Anwendung. Fly-Verwaltungstokens wurden nicht auf Netcup kopiert.

## Proof-Worker: laufende Umstellung

Der alte Worker verwendet Fly-spezifische Nachweise. Der eigene Server bekommt einen ausdrücklichen Provider `SELF_HOSTED_ROOTLESS`, keine erfundenen Fly-Identitäten. Standort `nue` ist eine Betreiberangabe. Neue Aufträge benötigen eine neue, an diese Umgebung gebundene Zustimmung. Alte Fly-Zustimmungen werden nicht übernommen.

Die getrennte Rootless-Docker-Umgebung läuft unter UID 995/GID 988, hat zwei GB RAM, eine CPU und ein internes Netz. Ein privilegierter lokaler Prüfdienst signiert beobachtete Fakten; der Worker erhält nur den öffentlichen Schlüssel und die Nachweisdatei. Die Prüfungen decken festgelegte Ziele und Einstellungen ab, keinen universellen Sicherheitsbeweis.

Die bestehende Source-Credential-Map enthält fünf Projekte, deren Mongo-Host auf die migrierte Trial-Mongo verweist. In der migrierten Datenbank fehlen jedoch aktuelle ausgestellte Source-Context-/Binding-Datensätze, und die bisherige Worker-Konfiguration enthält keine Source-Bindings. Diese Referenzen und Zustimmungen werden nicht erfunden. Ein echter Source-backed Businessbeweis bleibt bis zur legitimen Einrichtung dieser Bindungen offen.

Die endgültige Worker-Aktivierung ist noch offen. Vor dem Start müssen signierte Projektbindung, endgültige Image-Identität, frische Isolationsergebnisse und ein synthetischer Lauf mit dem ausgelieferten Image zusammenpassen. Es wird kein echter Geschäftsauftrag als Test erzeugt.

## Sicherungen

| Zeit Europe/Berlin | Timer | Inhalt |
| --- | --- | --- |
| 03:30 | Living-Planet-Backup | Bestehender täglicher Lauf; neue Generationen komprimiert, 14 Tage |
| 06:00 | `looi-platform-backup.timer` | Coolify-Datenbank und Konfiguration einschließlich APP_KEY, Proxy, SSH-Verwaltung und LOOI-SQLite |
| 07:00 | `looi-apps-daily-backup.timer` | PostgreSQL 17 und 14 mit Rollen, Mongo logisch und als saubere Kaltkopie, Walkaround-Dateien und aktuelle S3-Objekte |

App-Sicherungen liegen unter `/var/backups/looi-migrated-apps`. Der Sicherungslauf prüft Manifest und SHA-256. Erst nach Veröffentlichung einer gültigen neuen Generation werden gültige eigene Generationen entfernt, die älter als 14 Tage sind und mindestens 14 gültige neuere Generationen haben. Unbekannte Dateien oder veränderte Generationen werden erhalten.

Der Mongo-Lauf stoppt nur den konfigurierten Mongo-Container kurz. Wiederanlauf ist über eine Markierung, einen separaten Wächter und einen Systemd-Recovery-Hook abgesichert. PostgreSQL- und Mongo-Wiederherstellungen wurden in getrennten Containern ohne Netzwerk geprüft.

Eine vollständige einmalige Sicherungsbasis samt ursprünglichen App-Images liegt zusätzlich privat auf dem Mac unter `.build-assets/hermes/fly-migration-2026-10-26/recovery-baseline/`. **Ein laufendes externes Backup ist noch nicht eingerichtet.** Die täglichen Sicherungen liegen auf demselben VPS.

## Fly und Rückweg

Die ursprünglichen Fly-Anwendungen sind gestoppt; öffentlicher automatischer Start ist abgeschaltet. Alte Fly-Deploy- und Warmhalte-Workflows für SoPlan und Walkaround sind auf GitHub deaktiviert. Die ursprünglichen Geschäftsdaten-Volumes bleiben für einen kontrollierten Rückweg erhalten. Vor einem Rückweg müssen die seit der Umschaltung auf Netcup geschriebenen Daten berücksichtigt werden. Ein altes Fly-Volume ungeprüft wieder zu starten würde neue Daten auslassen.

Reine Migrationshelfer und deren Klone wurden nach Prüfung entfernt. Der alte Fly-Buildserver und sein 50-GB-Cache wurden als Builder-Daten geprüft und entfernt. Dadurch entfallen rechnerisch 7,50 US-Dollar pro Monat für dessen Volume. Nach der Bereinigung sind 36 GB Fly-Volumes vorhanden: 16 GB Geschäftsdaten als Rückweg und 20 GB Proof-Cache. Weitere Cache-Bereinigung und abschließende Kostenbasis sind noch in Arbeit.

Preis- und Rollbackstand sind keine Bestätigung einer Fly-Rechnung. KI-API-Nutzung, Snapshots und verbleibende Fly-Ressourcen werden separat abgerechnet.
