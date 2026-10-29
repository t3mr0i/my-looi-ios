# Apps als Laufzeit-Skills für LOOI

Stand: 28. Oktober 2026. Umsetzung im lokalen Arbeitsstand; die iPhone-Installation und der Live-Test dieser neuen Funktion stehen aus.

## Gewähltes Verhalten

Alle Einträge aus dem gemeinsamen öffentlichen Reachy-/MicroDuck-Katalog sind für die KI auffindbar. Die KI sucht passend zur aktuellen Anfrage und liest bei Bedarf die Details. Der Nutzer muss weder die Herkunft noch einen App-Namen auswählen.

Eine Python-App wird beim ersten Start automatisch auf dem verbundenen Companion installiert und anschließend gestartet. Installation und Start gehören zu einem reservierten Auftrag. Stoppen entfernt weder die Installation noch ihre gespeicherte Revision. Beim nächsten Einsatz verwendet der Runner diese Installation erneut. Ein neuerer Katalogstand löst kein stilles Überschreiben aus.

Web-Apps öffnen nach Vorbereitung des gemeinsamen Central-Zugangs ihre originale Oberfläche. Dafür wird kein Python-Paket installiert. Das Öffnen der Oberfläche ist ein Browser-Handoff; es bestätigt weder eine konkrete Aktion noch eine abgeschlossene Aufgabe. Die App wird durch die Protokolladapter angebunden und nicht umgeschrieben.

## Umsetzung

- `src/robot-bridge/app-skills.ts`: portabler gemeinsamer Dispatcher mit Suche, Details, Start/Stop, beobachteten Auftragszuständen und einem aktiven Eigentümer.
- `src/robot-bridge/app-skill-runtime.ts`: nativer Lebenszyklus, SecureStore-Präferenz, Central-/Browser-Anbindung und Bindung an den konfigurierten Companion.
- `src/voice/robot-app-skill-tool-definitions.ts` und `robot-app-skill-tools.ts`: vier feste KI-Werkzeuge statt einer wachsenden Liste pro App. Beide Realtime-Transporte verwenden dieselbe Ausführung. Budget kann suchen, beschreiben und stoppen; Start benötigt Realtime mit durchgehendem lokalem STOP.
- `services/robot-bridge/app-runner.mjs` und `gateway.mjs`: authentifiziertes `POST /api/apps/ensure-start`, Installation bei Erstnutzung, Wiederverwendung des gespeicherten Standes und gezieltes Stoppen über eine private Auftrags-ID.
- `src/ui/RobotAppSkillsPanel.tsx`: eigener Menüpunkt **Apps → App-Skills**, Schalter, aktueller App-Zustand, Stoppen, App-Suche und Verbindungs-Einstellungen. Texte sind in Deutsch, Englisch, Ukrainisch und Russisch vorhanden.

Katalogtexte bleiben begrenzte, untrusted Daten. Sie definieren keine Werkzeuge, URLs oder auszuführenden Befehle. Die KI kann ausschließlich eine validierte Space-ID an den Dispatcher übergeben. Credentials bleiben im nativen Speicher bzw. im privaten Transport und erscheinen nicht in Werkzeugergebnissen.

## Abbruch und Wiederverwendung

Der native Aufrufer erzeugt eine private Auftrags-ID vor dem HTTP-Aufruf. Trifft STOP zuerst am Companion ein, sperrt eine serverseitige Tombstone die verspätete Startanfrage. Trifft STOP nach der Aufnahme ein, betrifft es ausschließlich diesen Auftrag. Bei einem unbestätigten Stop bleibt dessen Identität für erneutes Stoppen oder Abgleich erhalten. Ein Wechsel der Companion-Konfiguration lenkt laufendes Polling und STOP nicht auf einen anderen Server um.

Sleep, lokaler STOP, Hintergrundwechsel, Konfigurationswechsel und veraltete Gesprächsrunden verhindern verspätete Starts. Ein späteres Fortsetzen spielt den verworfenen Auftrag nicht erneut ab. HTTP 202 und Zustände wie `installing` oder `starting` werden nicht als laufende App ausgegeben.

Der getrennte SecureStore-Schlüssel `looi-robot-app-skills-v1` steuert die KI-Nutzung. Eine neue Konfiguration ist gemäß der gewählten Produktentscheidung eingeschaltet; beschädigte oder nicht lesbare Einstellungen schalten die Nutzung bis zur Reparatur aus.

## Neue Veröffentlichungen und Deinstallation

Der Client fragt die öffentlichen Hub-Tags `reachy_mini_python_app`, `reachy_mini_js_app` und `microduck` ab. Er folgt jetzt den `Link: rel="next"`-Seiten bis zum Ende, statt nach den ersten 100 Einträgen je Quelle aufzuhören. Fortsetzungen sind auf den öffentlichen HF-Katalog beschränkt; Schleifen, fremde Hosts, zu große Antworten und unvollständige Seitengänge werden als Fehler behandelt. Es gibt keine kuratierte Liste einzelner App-IDs. Die Live-Abfrage am 28. Oktober lieferte 600 eindeutige Einträge ohne Quellenfehler.

Der Cache gilt eine Minute. Eine spätere Suche lädt danach den aktuellen Katalog; die sichtbare Aktualisieren-Aktion umgeht den Cache sofort. Das ist Abfrage-basiert und kein Push-Abonnement: Eine Veröffentlichung muss öffentlich, passend getaggt und im Hub indexiert sein. Neue Apps brauchen kein My-LOOI-Update, solange sie die bereits implementierten Schnittstellen verwenden. Neue Protokolle und neue Hardwarefunktionen benötigen einen Adapter bzw. eine bewusste Erweiterung. Katalogaufnahme allein beweist keine vollständige App-Kompatibilität.

Unter **Apps → Meine Apps → Deinstallieren** wird nach einer nativen Bestätigung die betreffende Installation samt Dateien in ihrem Installationsordner entfernt. Die authentifizierte Route `POST /api/apps/uninstall` akzeptiert ausschließlich eine Space-ID, keinen Dateipfad. Der Runner leitet den Verzeichnisnamen aus dem SHA-256 der ID ab, löscht diesen Ordner und aktualisiert `installed.json`. Laufende Apps müssen zuerst beendet werden. Start-/Installations-/Deinstallationsvorgänge können nicht gegeneinander laufen. Andere Ordner, Verbindungsdaten und Aktionszuordnungen werden nicht entfernt. Der öffentliche Katalogeintrag bleibt verfügbar; bei erneutem Einsatz kann die App wieder installiert werden. Die KI selbst hat kein Löschwerkzeug.

## Prüfstand

- `pnpm run robot:bridge:test`: bestanden, einschließlich der vier App-Werkzeuge, nativer Fassade, echter HTTP-Anbindung, Runner und bestehender Protokoll-/Media-Regressionen.
- `pnpm run ios:check`: bestanden, einschließlich TypeScript, Lebenszyklus-, STOP-, Realtime-, Budget- und Sprachprüfungen. Nach dem letzten UI-Fehlertext-/Reparaturpfad wurden TypeScript, native App-Skill-Regression und Lokalisierung erneut erfolgreich geprüft.
- Der HTTP-End-to-End-Test verwendet den echten portablen Dispatcher, den echten authentifizierten Client, den Gateway und den Runner. Nur Python-Prozesse und die Phone-Grenze sind simuliert. Er prüft Erstinstallation, erst nach Spawn gemeldetes Running, STOP vor einer verspäteten Admission, Wiederstart auf unveränderter installierter SHA trotz neuerer Katalog-SHA, Deinstallation und erneute Installation beim nächsten Einsatz.
- Runner-Dateisystemtests prüfen Entfernung auf Disk, Registry und Neustart, Abweisung paralleler Starts und Schutz benachbarter Dateien einschließlich eines Symlinks. Die Route weist fremde Browser-Origin und eingeschleuste Dateipfade ab.
- Laufende Python-Jobs werden auch nach dem ersten `running` weiter beobachtet. Natürliches Ende und Absturz lösen den aktiven Eintrag; eine neue App kann danach starten. Ein unbestätigter STOP ohne bekannte Job-ID darf aus einer älteren Historie derselben App keinen Abschluss ableiten.
- Das Produktionsmenü wurde in einer Web-Fixture mit 390 × 844 geprüft: Deutsch/Englisch, App-Skills an/aus mit Wiederöffnen, Fehlerzustand, explizites Zurücksetzen auf AUS und der Deinstallieren-Knopf. Dabei wurde die zu enge Status-/STOP-Zeile korrigiert. Screenshots liegen unter `output/robot-app-skills-preview/`. Die Fixture ersetzt native Speicher-/Companion-Grenzen durch lokalen Testzustand und beweist keine iPhone-Persistenz oder native Bestätigungsdialoge.

Ein signierter Release-Build wurde erfolgreich erzeugt und streng geprüft. Der erste Buildversuch hatte eine bereits vorhandene Sherpa-Verknüpfung auf Simulator-Bibliotheken erwischt; für den Geräte-Build wurden die vorhandenen Gerätebibliotheken explizit vorangestellt. Es wurde weder ein Paket aus dem Store real neu installiert noch das physische iPhone bedient. Die Live-Abnahme von KI-Auswahl, Bewegung und Medien mit dieser neuen Funktion bleibt ausstehend; bisherige Original-App-Live-Ergebnisse stehen im getrennten App-Abnahmebericht.

Primärquellen zur Kataloganbindung: [HF Hub API](https://huggingface.co/docs/hub/en/api), [offizieller list_spaces-Vertrag](https://huggingface.co/docs/huggingface_hub/main/en/package_reference/hf_api#huggingface_hub.HfApi.list_spaces).
