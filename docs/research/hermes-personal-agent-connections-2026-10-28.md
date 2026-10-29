# Persönliche Agenten und Arbeitsabläufe in My LOOI

Stand: 28. Oktober 2026. **Recherche, Architekturvorschlag und erster UI-/Nous-Ausbau; noch kein Live-Nachweis mit einem persönlichen Google-Konto.**

## Frage und Empfehlung

Wie können Menschen innerhalb der App Hermes-Aufgaben ausprobieren, ihre eigenen Konten und Agenten verbinden und später eine App-Store-Version benutzen, ohne dabei unbemerkt Daten weiterzugeben oder externe Aktionen auszulösen?

Empfehlung: My LOOI bekommt eine native Oberfläche für **Agenten, Verbindungen, Aufgaben und Freigaben**. Realtime bleibt für Gespräche zuständig. Ein kleiner, versionierter Adapter vor der persönlichen Agenteninstanz vermittelt Aufgaben und geprüfte Fähigkeiten. Hermes kann dahinter weiterhin planen und Werkzeuge benutzen. Die App spricht keinen beliebigen Hermes-Administrationszugang an. **Die Person hat Nous ausdrücklich als einzigen Weg für die Kontoverbindungen gewählt.** Ein eigener Google-OAuth-Client unserer App und direkt eingerichtete Google-MCPs sind damit für diesen Ausbau nicht ausgewählt.

Zuerst entstehen ein durchspielbarer Testmodus mit erfundenen Daten und ein echter Kalender-Lesezugriff für eine persönliche Instanz. Danach folgen Mail-Lesezugriff und vorbereitete Aktionen mit verbindlicher Freigabe. Ein von uns betriebener Dienst für mehrere Personen ist ein eigener späterer Ausbau.

Diese Empfehlung ist eine Produkt- und Architekturentscheidung aus den unten belegten Möglichkeiten und Grenzen, keine Zusicherung einer App-Store-Zulassung oder vollständigen Sicherheit.

## Was heute im Repository existiert

Die folgenden Beobachtungen stammen aus dem aktuellen lokalen Code. Sie sind keine erneute Prüfung der laufenden Serverkonfiguration.

| Bereich | Beobachtung | Konsequenz |
| --- | --- | --- |
| Agentenlaufzeit | [Dockerfile](../../services/hermes/Dockerfile) pinnt Hermes v0.22.5 einschließlich Image-Digest. [worker.py](../../services/hermes/worker.py) erlaubt und prüft ausschließlich `web_search`. | Hermes ist tatsächlich eingebunden; persönliche Werkzeuge sind noch nicht freigeschaltet. |
| Server | [server.py](../../services/hermes/server.py) verwendet einen gemeinsamen Bearer-Token und meldet Protokoll 1 mit `tasks`, `cancel`, `delete`. [store.py](../../services/hermes/store.py) enthält keine Aufgaben-Eigentümer pro Nutzer. | Der aktuelle Dienst ist für einen Eigentümer ausgelegt. Mehrere Kunden dürfen diesen Zugang nicht gemeinsam benutzen. |
| Kompatibilität | [agent-client.ts](../../src/agent/agent-client.ts) verlangt `service: looi-hermes` und Protokoll 1. | Eine beliebige Hermes-, MCP- oder andere Agenten-URL funktioniert heute nicht automatisch. |
| Zugangsdaten | [agent-service.ts](../../src/agent/agent-service.ts) speichert den Zugang in SecureStore; iOS-Schreibzugriffe nutzen gerätegebundene Keychain-Zugänglichkeit. HTTPS-Origin-Prüfung und abgelehnte Redirects sind vorhanden. | Gute Grundlage, aber noch keine Geräteverwaltung, Token-Rotation oder Mehrnutzer-Anmeldung. |
| Wiederholung | [agent-service-core.ts](../../src/agent/agent-service-core.ts) journalisiert Aufgaben vor dem Senden und wiederholt dieselbe UUID. Offene Übermittlungen sind nach URL gespeichert. | Für weitere Identitäten muss der Speicher zusätzlich Instanz, Eigentümer und Verbindung unterscheiden. |
| Gespräch | [hermes-task-tools.ts](../../src/voice/hermes-task-tools.ts) startet und liest Aufgaben. Ergebnisse können an das Gespräch zurückgegeben werden. | Persönliche Ergebnisse brauchen vor dieser Weitergabe eine eigene Datenfreigabe. |
| Datenlebenszyklus | [hermes-agent.md](../hermes-agent.md) und [PRIVACY.md](../../PRIVACY.md) beschreiben Aufgaben im Server-SQLite, getrennte Provider-/Backup-Lebenszyklen und fehlende Zeitpläne/Push-Mitteilungen. | Die heutige Beschreibung darf nach einem Ausbau nicht unverändert weiterverwendet werden. |

## Was die Primärquellen hergeben

### Loona als Produktreferenz

KEYi beschreibt DeskMate als Begleiter mit Gmail-Zusammenfassungen und Antwortentwürfen, Kalenderverwaltung, Slack und Besprechungsorganisation. Hilfreiche Präsenz und Rücksicht auf konzentrierte Arbeit gehören ausdrücklich zum Konzept. Der Artikel ist eine Herstellerbeschreibung; er belegt weder deren technische Umsetzung noch eine unabhängige Datenschutzprüfung. Seine Verschlüsselungsversprechen übernehmen wir nicht als Sicherheitsnachweis für unsere App. [KEYi: Meet LOONA DeskMate](https://keyirobot.com/de-de/blogs/news/meet-loona-deskmate-the-desktop-ai-companion-for-work)

### Hermes: zwei unterschiedliche Anbindungswege

Schon die Dokumentation im bei uns gepinnten Tag v0.22.5 beschreibt verwaltete Connectors über eine Nous-Identität, Werkzeug-Suche und `manage_connections`. Außerhalb der Hermes-Desktop-Oberfläche kann die Verbindung einen Autorisierungslink liefern. Das belegt eine mögliche Grundlage; es belegt keine sofort verwendbare Verwaltungs-API unseres eigenen HTTP-Dienstes. [Hermes v0.22.5: Tool Search, Connectors](https://github.com/NousResearch/hermes-agent/blob/v0.22.5/website/docs/user-guide/features/tool-search.md#connectors-remote-tools)

Alternativ unterstützt Hermes externe MCP-Server einschließlich OAuth und Werkzeugfiltern. Für unsere Integration sind explizite Werkzeugnamen in `tools.include` und abgeschaltete Ressourcen-/Prompt-Hilfswerkzeuge sinnvoll. Ein ungefilterter Katalog kann mehr Fähigkeiten aufnehmen, als wir geprüft haben. [Hermes v0.22.5: MCP](https://github.com/NousResearch/hermes-agent/blob/v0.22.5/website/docs/user-guide/features/mcp.md)

Nous dokumentiert für seinen verwalteten Weg verschlüsselt verwahrte Google-Zugangsdaten bei einem Integrationsanbieter und bis zu 14 Tage Aufbewahrung zurückgegebener Inhalte im Connector-Dienst. Das Trennen eines Kontos löscht nicht automatisch schon vorhandene Gespräche. Diese Angaben sind Anbieterangaben, kein von uns durchgeführter Betriebsaudit. Eine eigene Hermes-Instanz macht diesen verwalteten Weg daher nicht zu einer ausschließlich selbst betriebenen Datenverarbeitung. [Nous: Connected-account data](https://portal.nousresearch.com/help/connected-data)

### Google: vorhandene MCPs, aber keine automatische Rechtebegrenzung

Google bietet einen offiziellen Gmail-MCP-Server. Die dokumentierten Werkzeuge umfassen Suche, Thread-Abruf, Entwürfe und Label-Änderungen; die Liste enthält aktuell kein Werkzeug zum direkten Versenden. Die Einrichtung nennt `gmail.readonly` und `gmail.compose`. Für einen reinen Lesezugriff müssen wir den tatsächlich minimal funktionierenden Scope gesondert erproben. [Google: Gmail MCP](https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server)

Der offizielle Calendar-MCP-Server bietet sowohl lesende als auch verändernde Werkzeuge. Seine Anleitung beschreibt OAuth, ein für KI-Agenten gekennzeichnetes OAuth-Client-Setup und Schutz gegen indirekte Prompt Injection. Wir können diesen Weg prüfen, müssen aber die tatsächlichen Lesezugriffe und Scope-Anforderungen mit unserer Hermes-Version testen. [Google: Calendar MCP](https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server)

`gmail.readonly` und sogar `gmail.metadata` gelten als eingeschränkte Berechtigungen. Metadatenzugriff erlaubt keine Mailtext-Zusammenfassung. `gmail.compose` umfasst Entwürfe **und Versand**; eine Oberfläche mit nur einem Entwurf-Knopf begrenzt den Token nicht entsprechend. [Google: Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)

Öffentliche Anwendungen mit eingeschränkten Scopes benötigen grundsätzlich die entsprechende Prüfung, soweit keine Ausnahme greift. Zugriff auf solche Daten über Server kann eine jährlich zu erneuernde Sicherheitsprüfung erfordern. Persönliche Nutzung und öffentliche Verteilung sind dabei unterschiedliche Fälle. Ein selbst betriebener Server ist keine pauschale Ausnahme für unser öffentliches Produkt. [Google: Restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)

Für Kalender existieren unter anderem `calendar.events.owned.readonly`, `calendar.events.readonly` und Free/Busy-Berechtigungen. Wir wählen den engsten für den konkreten Ablauf funktionierenden Scope. Die Auswahl eines einzelnen Kalenders in unserer Oberfläche muss zusätzlich serverseitig begrenzt werden; ein breiterer OAuth-Scope wird dadurch nicht enger. [Google: Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)

Google verlangt zweckgebundene, transparente Datennutzung und begrenzte Berechtigungen. Die Weitergabe für sichtbare Nutzerfunktionen ist an Bedingungen gebunden; Workspace-Daten dürfen nicht zum Training allgemeiner Modelle verwendet werden. Modellanbieter, Verträge und Datenaufbewahrung sind deshalb Teil der Integration. [Google: Workspace user data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)

## Zielarchitektur

Alle folgenden Abschnitte beschreiben den vorgeschlagenen Ausbau.

```mermaid
flowchart LR
  U[Person] --> A[My LOOI: Gespräch und Aufgaben]
  A --> R[Realtime: freigegebener Gesprächskontext]
  A --> G[Persönlicher Agentenadapter: Identität und Rechte]
  G --> H[Hermes oder anderer Agent]
  H --> X[Kontrollierte Werkzeugausführung]
  G --> X
  X --> P[Google oder ausdrücklich gewählter Connector]
  A --> F[Freigabe einer konkreten Änderung]
  F --> X
```

Die Pfeile sind beabsichtigte Kommunikationswege. Sie versprechen keine Ende-zu-Ende-Verschlüsselung: Agent, ausführender Dienst und gegebenenfalls Modellanbieter müssen die für ihre Aufgabe benötigten Inhalte verarbeiten können.

### Instanzen und Kompatibilität

| Variante | Vorteil | Aufwand und Grenze | Entscheidung |
| --- | --- | --- | --- |
| Persönliche Hermes-Instanz mit LOOI-Adapter | Daten und Betrieb bleiben beim gewählten Eigentümer; geringerer Umfang für unseren Hostingbetrieb. | Einrichtung, Updates und OAuth-Konfiguration bleiben anspruchsvoll; der Betreiber kann Daten verarbeiten. | Zuerst unterstützen. |
| Nous-Connectors hinter dem persönlichen Adapter | Vorhandene Verbindungsabläufe, weniger eigene Providerimplementierung. | Weitere Dienste, deren Bedingungen und Aufbewahrung; Rechtefilter und Identitätsbindung müssen geprüft werden. | Vom Nutzer gewählter Verbindungsweg. |
| Von uns gehosteter Dienst | Einfacherer Einstieg für normale Nutzer. | Nutzerverwaltung, Isolation, Geheimnisverwaltung, Kosten, Support, Löschung und Compliance werden Betriebsaufgaben. | Später gesondert planen. |

Andere Agenten unterstützen denselben kleinen App-Vertrag über einen Adapter. MCP ist dabei ein mögliches Werkzeugprotokoll hinter dem Agenten, keine automatische Gleichsetzung mit unserer Aufgaben- und Freigabeschnittstelle. Die App bekommt keinen generischen Terminalzugriff und führt keine nachgeladenen Agenten-Skripte aus.

### Verbindung einrichten

1. Die Person wählt **Testmodus** oder **Eigene Instanz verbinden**.
2. Für eine echte Verbindung zeigt die App die vollständige HTTPS-Adresse, Betreiberangabe und gemeldeten Datenempfänger. Serverangaben sind als Angaben des Betreibers erkennbar.
3. Eine einmalige Kopplung liefert einen widerrufbaren, gerätespezifischen Zugang. Er gilt für genau diese Instanz, Identität und erlaubten Funktionen. Ein QR-Code oder Deep Link darf diese Bestätigung nicht überspringen.
4. Die App zeigt getrennt: **verfügbar**, **Konto verbunden**, **Berechtigung erteilt**, **Nutzung erfolgreich geprüft**. Ein vorhandenes Werkzeug ist noch kein funktionierender Kontozugriff.
5. Bei **Google Calendar verbinden** beginnt eine an die aktuelle Kopplung gebundene Browser-Autorisierung. Gewähltes Konto, konkrete Rechte, Datenempfänger und mögliche Modellweitergabe stehen davor sichtbar in der App.
6. Ein kleiner, explizit gestarteter Leseabruf prüft die Verbindung. Abbruch, verweigerte Teilrechte, abgelaufener Zugang und falsches Konto bleiben sichtbare Zustände.

OAuth wird mit einer gepflegten Bibliothek umgesetzt: `state`, PKCE soweit der gewählte Flow es vorsieht, exakte Redirect-/Issuer-Prüfung und kurzlebige, einmalige Transaktionen. Native und serverseitige OAuth-Clients sind verschiedene Konfigurationen. Ein geheimer Web-Client-Schlüssel gehört auf den Server; ein öffentlicher iOS-Client darf kein eingebautes Geheimnis voraussetzen. Google beschreibt dafür eigene [iOS-Autorisierung](https://developers.google.com/identity/sign-in/ios/sign-in), [öffentliche Desktop-Clients mit PKCE](https://developers.google.com/identity/protocols/oauth2/native-app) und [Server-Flows](https://developers.google.com/identity/protocols/oauth2/web-server).

Der bevorzugte Hintergrundbetrieb verwahrt Provider-Refresh-Tokens beim gewählten persönlichen Ausführungsdienst beziehungsweise dessen ausdrücklich gewähltem Connector. Die App hält ihren eigenen begrenzten Instanzzugang in der Keychain. Provider-Tokens gelangen weder in Modellprompts noch in Diagnoseexporte. Unsere Infrastruktur ist für diese persönliche Variante nicht als Datenproxy erforderlich.

### Kleiner App-Vertrag statt allgemeiner Fernverwaltung

Der bestehende Aufgabenvertrag bleibt für bisherige Verbindungen gültig. Neue Fähigkeiten werden ausdrücklich ausgehandelt. Die folgenden Gruppen sind ein Entwurf, noch keine implementierten Endpunkte:

| Gruppe | Benötigte Information oder Operation |
| --- | --- |
| Instanz | Protokollversion, stabile Instanz-ID, authentifizierte Eigentümer-ID, aktuelle Verbindungsgeneration und unterstützte Funktionen. |
| Verbindungen | Konto-ID und verständliche Bezeichnung, Provider, Autorisierungsstatus, tatsächlich erteilte Rechte, Datenempfänger, Ablauf/erneute Anmeldung. |
| Fähigkeiten | Stabile geprüfte ID, konkrete lesende oder verändernde Wirkung, zulässige Konten/Ressourcen, notwendige Rechte, freigegebene Datenwege. |
| Aufgaben | Instanz und Eigentümer, ausgewählte Verbindungen, Zweck, Rechte-Snapshot, Zustand, begrenztes Ergebnis und strukturierte Herkunft. |
| Aktionen | Unveränderlicher Vorschlag, Zielkonto, genauer Inhalt, Ablaufzeit, Bestätigung und anschließend getrennte Ausführung mit Ergebnisbeleg. |
| Lebenszyklus | Gerätezugang widerrufen, Provider-Verbindung trennen, Routinen stoppen, Inhalte löschen, Aufbewahrung und Export anzeigen. |

Bekannte Fähigkeiten werden in der App nativ dargestellt. Unbekannte oder geänderte Werkzeuge sind standardmäßig gesperrt. Toolnamen, Beschreibungen und vermeintliche `readOnly`-Hinweise eines Servers reichen nicht als Sicherheitsentscheidung. Auch neue Werkzeugversionen benötigen eine geprüfte Zuordnung. Ein fremder Server kann über seine Fähigkeiten und Richtlinien falsche Angaben machen; die App kann keine ehrliche Ausführung erzwingen.

Lokale Wiederherstellung, Aufgabenansichten, Freigaben und Caches werden nach **Origin + Instanz + authentifiziertem Eigentümer + Verbindung** getrennt. Ein Kontowechsel beendet alte Streams, verwirft verspätete Antworten und lädt keine offene Übermittlung in den neuen Kontext. Stabile, serverseitig bestätigte Konto-IDs dienen als Identität; Bezeichnungen wie „Arbeit“ reichen nicht.

## In der App durchspielbare Abläufe

Der Testmodus verwendet ausschließlich erfundene Konten, Mails und Termine. Er benötigt weder Google-Anmeldung noch einen Modellaufruf. Aufgaben und Ergebnisse tragen durchgehend **Beispieldaten**; sie werden weder in persönliche Erinnerungen übernommen noch als echte Serverausführung dargestellt. Derselbe Ablauf lässt sich anschließend bewusst mit einem verbundenen Konto starten.

| Beispiel | Was der Roboter beiträgt | Was die App zeigt |
| --- | --- | --- |
| „Wie sieht mein Vormittag aus?“ | Nach erteiltem Lesezugriff eine knappe Zusammenfassung; Detailausgabe zunächst auf dem Bildschirm. | Konto, Zeitzone, Zeitbereich und Herkunft der gelesenen Termine. |
| „Hilf mir beim Tagesstart.“ | Auf Wunsch Mail- und Kalenderübersicht; wenige konkrete Prioritätsvorschläge. | Getrennte Ergebnisse pro Konto und nachvollziehbare Quellenobjekte. |
| „Bereite eine Antwort darauf vor.“ | Formuliert einen lokalen Vorschlag zum gewählten Thread. | Empfänger, Betreff, Antwortbezug und Text; noch keine Provideränderung. |
| „Lege den Termin an.“ | Bereitet Zeit, Kalender, Teilnehmer und Einladung vor. | Konkrete Vorschau mit Freigabe; Erfolg erst nach bestätigter Providerantwort. |
| „Gib mir morgens eine Übersicht.“ | Nach Einrichtung eine begrenzte Routine, die Aufmerksamkeit und Ruhezeiten berücksichtigt. | Zweck, Konten, Zeitplan, Rechte, letzte Ausführung, Kostenlimit und Pause. |

Eine rein lokale Antwortvorlage braucht kein `gmail.compose`. Das Speichern eines Entwurfs bei Gmail ist dagegen schon eine externe Änderung. Der echte Versand ist eine weitere Fähigkeit, die mit dem oben dokumentierten Gmail-MCP allein aktuell nicht belegt ist.

Die Persönlichkeit bleibt präsent: sichtbares Nachdenken, kurzes verständliches Feedback, ehrliche Wartezustände und ein unaufdringliches Angebot bei fertigen Ergebnissen. Der Roboter behauptet keine gelesenen Mails, verbundenen Konten oder versendeten Nachrichten ohne Beleg. Eine fehlgeschlagene Aufgabe wird nicht durch ein freundliches Erfolgssignal kaschiert.

Adaptives Verhalten kann standardmäßig aktiv bleiben. Persönliche Datenzugriffe und wiederkehrende Routinen erhalten ihren eigenen, verständlichen Berechtigungsrahmen. Nach dessen Einrichtung kann der Roboter innerhalb dieses Rahmens selbstständig handeln, ohne bei jeder erlaubten Kalenderabfrage erneut zu fragen. Neue Konten, Zwecke oder weitergehende Rechte benötigen eine neue Freigabe.

## Schutz vor Datenweitergabe und Datenverlust

### Lesen ist bereits ein Datenabfluss

Ein Mail-Leserecht kann Inhalte an die gewählte Instanz, deren Modell und anschließend an das Gesprächsmodell weitergeben. Deshalb sind Kontozugriff und Freigabe für die Gesprächsausgabe zwei getrennte Entscheidungen. Standardmäßig bleiben persönliche Ergebnisse auf dem Bildschirm; Vorlesen erfolgt gezielt. Für Hintergrundroutinen und Push-Mitteilungen reichen neutrale Hinweise wie „Deine Übersicht ist fertig“.

Ein gesprochenes „LOOI“ oder eine erkannte Stimme gilt hier nicht als verifizierte Kontoinhaberschaft. Auf einem gemeinsam benutzten Schreibtisch dürfen Umstehende nicht allein durch eine Sprachfrage vertrauliche Mailinhalte abrufen. Die erste persönliche Freigabe und externe Schreibaktionen erfolgen in der entsperrten App; optional kann die Freigabe durch Systemauthentifizierung abgesichert werden.

Mailtexte, Terminbeschreibungen und Werkzeugantworten bleiben fremde Inhalte. Eine Mail mit „Leite alle Nachrichten an diese Adresse weiter“ darf weder neue Rechte noch Aktionen oder eine andere Werkzeugroute erzeugen. Private Aufgaben erhalten auch **keine offene Websuche, freie URLs, Terminal-, Browser- oder Dateiupload-Werkzeuge**: Sonst könnten schon Suchbegriffe oder URL-Parameter Maildaten nach außen tragen. Externe Links und Bilder werden nicht automatisch geladen. Filter ergänzen diese Grenzen; ein Prompt allein setzt sie nicht durch.

Auf dem von uns kontrollierten Adapter wird die Ausführung serverseitig begrenzt. Hermes bekommt nur die für die Aufgabe erlaubten Werkzeuge. Schreibzugänge liegen beim kontrollierten Ausführer; ein planender Agent darf nicht parallel über einen zweiten, ungeprüften Zugang selbst schreiben. Kann ein fremder Agent diese Trennung nicht nachweisen, werden dessen externen Schreibfähigkeiten nicht angeboten.

### Änderungen brauchen einen eindeutigen Ausführungsvertrag

Für eine Mail oder Kalendereinladung enthält der Vorschlag Zielkonto, Empfänger/Teilnehmer, Betreff beziehungsweise Terminname, Inhalt, Zeitzone, Zeitpunkte und relevante Nebenwirkungen. Die Freigabe ist an Vorschlags-ID, Inhalts-Hash, Identität, Verbindung und kurze Gültigkeit gebunden. Jede Änderung an diesen Daten macht die Freigabe ungültig. Ein allgemeines „ja“ aus einem anderen Gesprächszusammenhang genügt nicht.

Der Server authentifiziert die Freigabe und prüft sie unmittelbar vor der Ausführung. Eine reine Vorschau in unserer App schützt nicht vor einem Server, der vorher schon handelt. Deshalb sind Ausführungsgrenzen und verweigerte Direktaufrufe Teil der Integrationstests.

Ein einmaliger Ausführungsschlüssel und ein dauerhaftes Aktionsjournal verhindern Wiederholungen durch Doppeltippen, Netzverlust oder App-Neustart. Ein Timeout nach dem Versand bleibt **Ausgang unklar**, bis Providerbelege oder Abgleich Klarheit schaffen. Eine exakt einmalige externe Wirkung lässt sich ohne passende Providerunterstützung nicht pauschal versprechen. In unklaren Fällen wird nicht automatisch noch einmal gesendet.

Löschen, Massenänderungen, Zahlungen und Buchungen gehören nicht zum ersten Ausbau. „Abbrechen“ kann nach einer bestätigten externen Wirkung keine Rücknahme versprechen. Auch eine Kalenderänderung kann Benachrichtigungen an andere auslösen; diese Wirkung gehört in die Vorschau.

### Betrieb, Trennen und Löschen

Verbindung trennen, Gerätezugang widerrufen, Providerzugriff widerrufen, Aufgaben löschen und ein Konto löschen sind unterschiedliche Vorgänge. Die App zeigt deren Wirkung und stoppt zugehörige Routinen. Bei fehlgeschlagenem Provider-Widerruf bleibt ein sichtbarer offener Zustand samt Weg zur Kontoverwaltung.

Neue persönliche Aufgaben erhalten eine kurze, ausdrücklich angezeigte Aufbewahrung. Rohdaten, abgeleitete Zusammenfassungen, Gesprächsverlauf und Langzeitgedächtnis werden getrennt behandelt. Mailinhalte werden nicht automatisch zu dauerhaften persönlichen Fakten. Logs enthalten standardmäßig nur technische IDs/Zustände und keine Inhalte, Tokens, Betreffzeilen oder Empfänger. Supportexporte sind gesondert prüfbar.

Backups werden verschlüsselt, mit eigener Aufbewahrung versehen und bei Wiederherstellung gegen Lösch- und Aktionsjournale abgeglichen. Eine alte Sicherung darf keine bereits versendete Mail oder abgelaufene Freigabe erneut ausführen. Der MVP verzichtet auf destruktive Wiederherstellung oder automatische Wiederholung unklarer Aktionen.

Für einen späteren Mehrnutzerbetrieb reichen getrennte Profile nicht: Jeder Abruf und jede Ausführung benötigt serverseitig geprüfte Eigentümerschaft. Datenbank, Queue, Worker, Providerzugänge, Zwischenspeicher, Gedächtnis und Logs müssen diese Grenze erhalten. Gezielte Tests versuchen fremde Aufgaben-/Verbindungs-/Aktions-IDs mit einem anderen Nutzerzugang abzurufen. Ein Nutzer darf die Zuordnung niemals selbst über ein frei wählbares Headerfeld festlegen.

Bei benutzerdefinierten Servern gilt außerdem: TLS schützt den Transport, bestätigt aber keine vertrauenswürdige Datenverarbeitung. Keine automatische Weiterleitung von Zugangsdaten an neue Origins. Vom Server gelieferte Loginziele müssen zum geprüften Authentifizierungsablauf passen. Serverseitige URL-Abrufe benötigen Schutz gegen Zugriff auf interne Dienste; eine bewusst gekoppelte eigene Instanz im Heimnetz ist ein davon getrennt zu behandelnder Fall.

## App Store und öffentliche Verteilung

Apple verlangt vor der Weitergabe persönlicher Daten an Dritte einschließlich KI eine deutliche Offenlegung und ausdrückliche Zustimmung. Die Richtlinien behandeln außerdem Datenschutz/Löschung, nachgeladene Funktionalität und Chatbots/Plugins. Ob und wie 4.7 auf unseren endgültigen Funktionsumfang angewendet wird, ist vor Einreichung zu klären. Native fest definierte Oberflächen und serverseitige Adapter vermeiden einen beliebigen Plugin- oder Code-Installer, garantieren aber keine Zulassung. Auch das spätere Bezahlmodell muss separat gegen die dann geltenden Regeln geprüft werden. [Apple: App Review Guidelines, 2.5.2, 3.1, 4.7, 5.1](https://developer.apple.com/app-store/review/guidelines/)

Die Datenschutzangaben in App Store Connect müssen tatsächliche eigene und relevante Drittanbieterpraktiken abbilden und aktuell bleiben. „Wir betreiben keinen zentralen Mailserver“ ersetzt keine Prüfung der Datenwege. [Apple: App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)

Für die Veröffentlichung brauchen wir eine überprüfbare Testinstanz beziehungsweise einen vollständigen Beispielmodus, verständliche Einrichtungsunterlagen, korrekte Datenschutzhinweise und einen funktionierenden Weg zum Widerruf/Löschen. App-Store-Freigabe, Google-OAuth-Prüfung und technische Sicherheit sind eigenständige Ergebnisse. Eine private Entwicklerausnahme wird nicht als Nachweis für öffentliche Verteilung verwendet.

## Empfohlene Umsetzung in fünf Schritten

1. **Testmodus und Verbindungsgrundlage.** Native Agentenübersicht, erfundene Mail-/Kalenderabläufe, Vorschau/Freigabe/Ausgang-unklar durchspielbar. Versionierter Fähigkeitenvertrag, Instanz-/Eigentümerbindung und klare Trennung vom bisherigen Dienst. Fertig, wenn kein Testdatum als echte Aktion erscheint und Kontowechsel keine alten Ergebnisse übernimmt.
2. **Persönliche Instanz und Kalender lesen.** Kontrollierter Adapter, Gerätezugänge, OAuth-Browserablauf, engste funktionierende Scopes, explizit ausgewählte Kalender und Datenweitergabe. Echter Abruf nur nach Einrichtung. Fertig nach Konto-/Scope-/Widerrufs- und Neustarttests mit einem Testkonto; ein erfolgreicher Login allein reicht nicht.
3. **Gmail lesen und lokal entwerfen.** Nach geklärtem OAuth-Betriebsmodell und Prüfpflichten: gezielte Threadauswahl, begrenzte Inhalte, lokale Entwürfe, keinerlei Versand. Angriffsmails testen, insbesondere Datenabfluss über andere Werkzeuge und Übernahme ins Gedächtnis.
4. **Freigegebene Aktionen.** Einzelne Kalendereinladung beziehungsweise Provider-Entwurf mit unveränderlichem Vorschlag, serverseitiger Freigabe und Wiederholungsjournal. Versand erst nach separat geprüftem Werkzeug und Scope. Netzverlust unmittelbar vor/nach Providerwirkung gezielt testen.
5. **Routinen und öffentliche Verteilung.** Eng begrenzte Zeitpläne, kontogebundene Regeln, Ruhezeiten, Kostenkontrolle, pausierbare Ausführung und inhaltsarme Benachrichtigungen. Server erledigen geplante Arbeit unabhängig von der iPhone-App. Mehrnutzerhosting kommt erst mit nachgewiesener Isolation und eigenem Betriebskonzept hinzu.

## Offene Nachweise

- Der gewählte Weg ist Nous. Die vollständige Kette aus Anmeldung, erneutem Zugriff und Widerruf braucht noch einen Nachweis mit einem echten eigenen Konto.
- Lassen sich die konkreten Google-MCP-Lesewerkzeuge ausschließlich mit den gewünschten minimalen Scopes betreiben? Die allgemeinen Einrichtungsanleitungen belegen das noch nicht für unsere Teilmenge.
- Welche Nutzungsbedingungen, Modellanbieter, Aufbewahrungen und Prüfpflichten gelten für den ausgewählten privaten beziehungsweise öffentlichen Betrieb?
- Wie lässt sich die gewünschte Trennung zwischen Planer, Werkzeugausführung und Kontozugang für einen fremden Agenten nachweisen? Nicht nachgewiesene Schreibwege bleiben gesperrt.
- Wie gut funktioniert die ruhige, verständliche Übergabe im echten Gespräch und auf einem gemeinsam genutzten Schreibtisch? Noch keine Nutzer- oder Geräteabnahme.

## UI-Ausbau nach der Freigabe

Die bestehende Agentenseite wird zum Einstieg **Dein Assistent**. Sie hat zwei verständliche Wege: **Mit Beispielen ausprobieren** und **Hermes einrichten**. Bereits verbundene Dienste behalten ihre echten Aufgaben einschließlich Wiederaufnahme, Status, Abbruch und Löschung. Die neuen Ansichten verwenden die vorhandene dunkle Farbwelt, eine einzelne Lesespalte, mindestens 48 Punkte hohe Schaltflächen und Text, der mit der Systemschriftgröße wachsen kann.

### Einrichtung ohne Serverbegriffe im Standardweg

1. **Code einfügen.** Die Person, die den vorhandenen Hermes betreibt, gibt einen privaten Verbindungscode weiter. Ein einzelnes geschütztes Eingabefeld ersetzt im Standardweg die getrennte Eingabe von Adresse und Schlüssel. Adresse/Schlüssel bleiben als Alternative erreichbar. Die App liest weder automatisch die Zwischenablage noch einen Link mit Zugangsdaten.
2. **Verbindung prüfen.** Die vollständige Zieladresse wird angezeigt. Der Bildschirm erklärt, welche Aufgabentexte später dorthin und an den KI-Anbieter gehen. Erst die eindeutige Schaltfläche **Mit diesem Server verbinden** startet die Prüfung und Speicherung.
3. **Zu den Aufgaben.** Erst nach erfolgreicher Prüfung und Speicherung erscheint die bestätigte Verbindung. Fehler behalten einen sinnvollen nächsten Schritt. Verlassen oder Hintergrund unterbricht die Einrichtung und entfernt die eingegebenen Zugangsdaten aus dem Bildschirmzustand; verspätete Antworten setzen den Ablauf nicht fort.

Der Betreiber erzeugt den Code mit [create_connection_code.py](../../services/hermes/create_connection_code.py). Dieser erste Ausbau verpackt den bereits vorhandenen privaten Single-Owner-Zugang. **Er ist noch keine einmalige Gerätekopplung und erzeugt keine getrennten Nutzerrechte.** Der Code ist ein Zugangsschlüssel und muss privat bleiben. Ohne eigenen Server beziehungsweise betreibende Person gibt es noch keine automatische Bereitstellung. Das ist ausdrücklich eine verbleibende Hürde für ein späteres öffentliches Produkt.

### Mail auf dem Roboterdisplay

Die neuen Routen [agent-playground.tsx](../../app/agent-playground.tsx) und [agent-connect.tsx](../../app/agent-connect.tsx) nutzen die volle verfügbare Breite. Eine seitliche Navigation nimmt der Mail keinen Platz weg. **Zurück** führt zum vorherigen Arbeitsbereich, **Zu LOOI** zur Roboteransicht.

Im Beispiel-Postfach öffnet ein Tipp die Mail mit Absender, vollständiger Beispieladresse, Empfänger, Betreff, Zeit und auswählbarem Klartext. Während des Lesens verschwinden die Auswahltabs; die Kennzeichnung **Beispieldaten** bleibt außerhalb des Scrollbereichs sichtbar. Es werden keine Mail-HTML-Inhalte, externen Bilder oder Trackingressourcen gerendert. Antwortentwürfe sind bearbeitbar und bleiben im flüchtigen Bildschirmzustand. Eine vorhandene Eingabe wird durch den Knopf für einen Beispielentwurf nicht überschrieben.

Der spätere echte Mailbildschirm soll dieselbe Lesestruktur verwenden, braucht davor aber eine getrennte Freigabe für Kontozugriff und Modellweitergabe. Liste, einzelner Thread und konkreter Antwortentwurf bleiben getrennte Schritte. Ein tatsächlicher Provider-Entwurf beziehungsweise Versand darf erst nach der dafür vorgesehenen Freigabe erscheinen.

### Beispielaufgaben und Fehler

**Mein Tag**, **E-Mails** und **Termin planen** laufen ohne Konto, Modell oder Netzwerkdienst. Die Beispielzustände sind eigene Typen und werden nicht als echte `AgentTask` gespeichert. Beim Termin sind Kalender, Zeitzone und Gast vor der Freigabe sichtbar. Die Rückmeldung sagt ausdrücklich, dass keine Einladung verschickt wurde. Ein zusätzlich durchspielbarer Verbindungsfehler erklärt den Zustand **Ausgang noch unklar**; derselbe Zustand bietet keine erneute Freigabe an.

Der Server meldet jetzt eine versionierte Fähigkeit `public-research`. Alte Protokoll-1-Dienste bleiben kompatibel. Unbekannte Fähigkeiten oder spätere Werkzeugrevisionen geben weder persönliche Daten noch externe Aktionen frei. Diese Erweiterung ersetzt noch keinen vollständigen Identitäts-, Konto- oder Aktionsvertrag.

### Weiterer UI-Plan für echte Konten

| Zustand | Sichtbare Erklärung und nächste Aktion |
| --- | --- |
| Server kann Kalenderzugriff nicht anbieten | **Mit diesem Hermes noch nicht verfügbar**; Beispiele sind weiterhin erreichbar. |
| Fähigkeit verfügbar, Konto fehlt | **Google Calendar verbinden** mit Erklärung vor der Browser-Anmeldung. |
| Anmeldung läuft | Gewählter Dienst und Abbrechen; keine vorweggenommene Erfolgsmeldung. |
| Konto verbunden, Rechte fehlen | Konkrete fehlende Berechtigung nennen; vorhandene Aufgaben bleiben nutzbar. |
| Mehrere Konten | Verständlicher Kontoname plus echte Kontoidentität; keine stillschweigende Auswahl. |
| Schule oder Eltern verweigern den Zugriff | Einschränkung verständlich erklären und zurückführen; kein Umgehen der Vorgabe. |
| Zugriff abgelaufen oder widerrufen | **Erneut anmelden**; keine alte Mail als frisch abgerufen ausgeben. |
| Leeres Postfach oder kein Termin | Ehrlicher Leerzustand mit Konto und geprüftem Zeitraum. |
| Verbindung fällt aus | Letzten bestätigten Stand kennzeichnen und gezielte Wiederholung des Leseabrufs anbieten. |
| Änderung vorbereitet | Empfänger, Inhalt und Nebenwirkungen in einer eigenständigen Vorschau. |
| Externe Wirkung unklar | Kein automatischer zweiter Versand; zuerst Statusabgleich. |

Der zusätzliche Nous-Ausbau kann Kontostatus und Verbindungslinks über den Hermes-SDK verwalten. Seine konkrete Umsetzung und verbleibende Grenzen stehen im folgenden Abschnitt. Die weitergehenden Zustände für Mailabrufe und externe Änderungen bleiben geplant.

### Nous als tatsächlicher Verbindungsweg

Die Route [agent-nous.tsx](../../app/agent-nous.tsx) ist von der verbundenen Assistentenseite aus erreichbar. Die Person prüft zuerst den Status, sieht die für ihren Hermes verwendete Nous-Identität und bestätigt vor dem Verknüpfen, dass dieses Nous-Konto ihr gehört. Ein gültiger Verbindungscode allein beweist diese menschliche Eigentümerschaft nicht. Der private Single-Owner-Betrieb bleibt deshalb eine ausdrückliche Grenze.

Der neue [Serveradapter](../../services/hermes/nous_connections.py) verwendet `PortalConnectorClient` für den angemeldeten Katalog und Kontostatus sowie `ConnectorClient.connections` für einen bewusst gestarteten Verbindungslink. Diese Schnittstellen sind im gepinnten SDK vorhanden. [Hermes v0.22.5: Portal-Client](https://github.com/NousResearch/hermes-agent/blob/v0.22.5/tools/connectors/portal/client.py), [Gateway-Client](https://github.com/NousResearch/hermes-agent/blob/v0.22.5/tools/connectors/gateway/client.py)

Der Vertrag ist klein:

- `GET /v1/capabilities` meldet `connectionProviders: ["nous-v1"]`; ältere Server werden verständlich als noch nicht unterstützt behandelt.
- `GET /v1/nous` liefert entweder die erforderliche Server-Anmeldung oder die aktuelle Nous-Identität, tatsächlich verfügbare Anbieter und bestätigte Kontostatus.
- `POST /v1/nous/connect` akzeptiert ausschließlich den ausgewählten bekannten Anbieter und die zuvor angezeigte Nous-Identität. Bei Identitätswechsel oder einem vorhandenen Konto wird kein weiteres Konto still angelegt.

Der Browser öffnet erst nach einer weiteren bewussten Aktion. Die App zeigt die Ziel-Webseite; Verbindungslinks werden weder als Quellenlinks noch als Diagnoseereignisse gespeichert. Nach Rückkehr muss der Kontostatus erneut geprüft werden. Ein erzeugter Link und ein geschlossener Browser bestätigen keine Verbindung. Ein unklarer Start setzt die Oberfläche zum Statusabgleich zurück und wird nicht automatisch wiederholt.

Der Adapter setzt einen vorhandenen regulären Nous-Login in der dedizierten Hermes-Installation voraus. Er erstellt keinen Gastzugang, nimmt keine Nous-Tokens vom Modell entgegen und stellt keine Terminal-/Werkzeugausführung bereit. Das Konto wird mit den offiziellen Nous-Clients aus der bestehenden Hermes-Anmeldung gelesen; ein neuer anonymer Zugang wird nicht erzeugt. Bei fehlendem Login verweist die App die Person verständlich an den Betreiber ihres Hermes. Eine vollständig in der App abgeschlossene erstmalige Nous-Geräteanmeldung bleibt ein weiterer Schritt für ein öffentliches Produkt.

Metadatenanfragen gehen ausschließlich an die festgelegten offiziellen Portal-/Connector-Origins. Die Transportgrenze verweigert Weiterleitungen und begrenzt Antworten. Die frisch abgefragte Nous-Identität wird an das tatsächlich verwendete OAuth-Token gebunden; ein abweichender globaler Gateway-Token wird nicht übernommen. Der Recherche-Agent erhält dadurch weder ein Gmail-Werkzeug noch Kalenderrechte. Sein Profil deaktiviert zusätzlich Connectors, Tool Search und automatische Gastidentitäten. Seine bestehende `web_search`-Begrenzung bleibt bestehen. Der Adapter kann auch keinen Versand ausführen.

**Beobachtete Verfügbarkeit:** Der am 28. Oktober direkt abgerufene öffentliche Nous-Katalog enthält 54 Einträge und keine Gmail-/Google-Calendar-Zeile. Die [gesicherte Auswahl](evidence/nous-google-catalog-2026-10-28.json) ist deshalb leer. Das widerspricht nicht zwingend der Dokumentation zu verbundenen Google-Konten, belegt aber auch keine allgemeine aktuelle Verfügbarkeit. Der angemeldete Katalog ist die Entscheidungsgrundlage; die App bietet nur dort bestätigte Anbieter an. Warum die öffentliche Liste Google nicht enthält und welche Konten es nutzen können, ist noch offen. [Öffentlicher Nous-Katalog](https://portal.nousresearch.com/api/v1/connectors/catalog/public)

Persönliche Mailinhalte und Kalenderdaten werden in diesem Ausbau noch nicht über Nous gelesen. Ihre Typen, begrenzten Lesewerkzeuge und die Freigabe einer eventuellen Modellweitergabe bleiben der nächste Integrationsschritt. Die bestehende Beispiel-Mailansicht ist dafür als Interaktionsentwurf vorhanden.

### Verständlichkeit nachweisen

Die implementierten [Komponenten](../../src/ui/AgentWorkspace.tsx) und [Bildschirmtests](../../scripts/agent-workspace.test.mjs) prüfen die durchspielbaren Abläufe in vier Sprachen, Klartext-Mails, flüchtige Entwürfe, Vorschau vor Netzverkehr und abgebrochene Einrichtung. Zusätzlich werden die tatsächlichen Komponenten als Browser-Vorschau mit React Native Web geprüft. Das prüft Darstellung und Bedienfluss, nicht native iOS-Eigenheiten.

Die Aussage „für Zwölfjährige verständlich“ ist damit noch nicht belegt. Für die Zielgruppenprüfung sollen mehrere unabhängige Personen dieser Altersgruppe ohne mündliche Hilfe (1) ein Beispiel starten, (2) eine Mail öffnen und deren Beispielcharakter erkennen, (3) einen gültigen Code einfügen und den Zielserver benennen sowie (4) vor einer Einladung erklären, was passieren würde. Gemessen werden Abschluss, Hilfebedarf und Fehlinterpretationen. Erst danach lässt sich die gewünschte Einfachheit bewerten.

## Prüfung dieses Arbeitsstands

Primärquellen und lokaler Quelltext wurden am angegebenen Datum geprüft. Es wurden keine Google-Konten verbunden, keine persönlichen Inhalte gelesen und keine externen Aktionen ausgelöst. Der erste UI-/Nous-Ausbau ist lokal implementiert. Der echte gepinnte Hermes-Container wurde ohne Netzwerk und ohne Zugangsdaten mit dem neuen Adapter geprüft: SDK-Import und der erwartete abgemeldete Zustand waren erfolgreich. Das ist kein Live-OAuth-Nachweis.

Browser-Belege zeigen die tatsächlichen nativen Komponenten über React Native Web: [Mailansicht](evidence/agent-workspace-mail-2026-10-28.png) und [Verbindungsprüfung](evidence/agent-workspace-setup-2026-10-28.png). In einer 320 Pixel breiten Vorschau gab es im Einrichtungsbildschirm keinen horizontalen Überlauf; die beobachteten Schaltflächen waren mindestens 49 Pixel hoch. Die vollständige Expo-Web-App bleibt durch den fehlenden bestehenden `wa-sqlite.wasm`-Import blockiert, deshalb ist dies eine isolierte Komponentenvorschau. Native iOS- und Zielgruppenabnahme sind offen.

Getrennte Geräte-/Nutzeridentitäten, die erstmalige Nous-Anmeldung innerhalb der App, echte persönliche Lesewerkzeuge, freigegebene Änderungen und wiederkehrende Aufgaben bleiben weitere Umsetzungsschritte. Ein öffentlicher Mehrnutzerbetrieb ist damit noch nicht freigegeben.

Abschließende technische Prüfung: `pnpm run ios:check` lief vollständig durch. Die Agenten-/Nous-Bildschirmtests, vier Sprachvarianten, 33 Python-Servertests und der echte Loopback-HTTP-Test waren erfolgreich. Im vorhandenen Service-Container wurden die aktuelle Profilkonfiguration, die tatsächliche Werkzeugliste mit ausschließlich `web_search` und der abgemeldete Nous-SDK-Zustand ohne Netzwerk geprüft. Keiner dieser Checks bestätigt einen echten Google-OAuth-Ablauf, Mailabruf oder eine menschliche Usability-Abnahme.

Beim ersten Bereitstellungsversuch endete SSH auf Port 22 mit einem Timeout. Der nachfolgende, ausdrücklich beauftragte Deployment-Lauf fand den bereits eingerichteten SSH-Zugang über TLS auf Port 443 und stellte den Dienst darüber bereit. Zertifikats- und SSH-Hostprüfung bleiben aktiv; die Firewall wurde nicht verändert.

### Live-Bereitstellung am 28. Oktober

Der neue Nous-Adapter läuft auf dem konfigurierten Netcup-Server. Vor der Umschaltung wurden die Datenbank online gesichert und das neue Image mit einer separaten Datenkopie ohne Netzwerk geprüft. Eine Eigenheit des tatsächlich installierten SDK wurde korrigiert: Seine frische Konto-Normalisierung lässt `user_id` leer. Die vom offiziellen Portal mit exakt demselben Bearer authentifizierte Token-Identität wird deshalb mit den vorhandenen Nutzer-/Organisationsangaben verbunden; abweichende Kennungen bleiben gesperrt.

34 Python-Tests, die echte installierte SDK-Anbindung mit Testdaten sowie externe HTTPS-Prüfungen waren erfolgreich. `/v1/capabilities` meldet `nous-v1`; ohne App-Schlüssel antworten die geschützten Routen mit HTTP 401. Eine echte Rechercheaufgabe wurde über HTTP 202 angenommen, mit fünf Quellen abgeschlossen und danach als eigene Testaufgabe gelöscht. Die vorherige Aufgabe blieb unverändert erhalten; der Container ist gesund und hatte keine Neustarts.

Beim Deployment war im dedizierten persistenten Profil noch kein reguläres Nous-Konto angemeldet; die API lieferte `server_login_required`. Am 29. Oktober hat der Eigentümer den offiziellen Geräteablauf bestätigt. Die Serverprüfung und der unabhängige öffentliche HTTPS-Aufruf liefern jetzt HTTP 200, `ready` und eine bestätigte Identität. Der tatsächlich angemeldete SDK-Katalog enthält ebenfalls 54 Einträge ohne Gmail, Google Calendar oder einen anderen in Kennung/Anzeigename erkennbaren Google-/Mail-/Kalenderanbieter. Es gibt keine verbundenen Konten; die API liefert deshalb `providers: []`. Die Nous-Anmeldung ist damit live belegt. Ein Mail-/Kalenderabruf ist weiterhin nicht implementiert oder nachgewiesen. Die Authentifizierungsdateien liegen mit privaten Dateirechten im dedizierten persistenten Profil. [Bereinigter Live-Nachweis](evidence/hermes-nous-authenticated-2026-10-29.json), [Betriebsprotokoll und Rückwechsel](../ops/hermes-nous-deployment-2026-10-28.md).
