# iPhone-Abnahme: Mock-Roboter und Hochformat

Stand: 26. Oktober 2026. Gerät: iPhone 16 mit iOS 27.0. Der abschließend
korrigierte, signierte Release-Build wurde mit Xcode 27.1 gebaut und installiert.
Ein physischer LOOI ist noch nicht vorhanden; Bewegungs- und Sensorprüfungen
erfolgten ausdrücklich mit dem Mock-Transport.

| Prüfung | Ergebnis |
|---|---|
| Finaler Release-Build, Signatur und Installation | PASS; Installation als Update, App-Daten blieben erhalten |
| Ersteinrichtung im Hochformat | PASS; Schlüssel-Eingabe und Speichern sichtbar; Done zeigt Schlüssel gespeichert, Modelle bereit, Mikrofon erlaubt und Roboter optional; Hauptansicht geöffnet |
| API-Schlüssel und Modellzugriff | PASS für Modellsuche: OpenAI Settings zeigt „Models available: 4“ nach authentifizierter Modelllistenabfrage; dies bestätigt weder Realtime-/Decisions-Anfragen noch Guthaben oder abrechenbare Modellverarbeitung |
| Berechtigungen | PASS; Mikrofon und Kamera am Gerät ausdrücklich autorisiert und vom System gewährt |
| Adaptive Behavior | PASS aktiviert: Mode Active, „Allow requested snapshots“ EIN, „Compare possible reactions“ EIN und Tagesbudget $1 ausgewählt |
| Kamera-Aufmerksamkeit | PASS aktiviert; iOS-Kamerazugriff gewährt. Keine tatsächliche Gesichtserkennung oder Kamerawahrnehmung abgenommen |
| Mock-Modus und Touchflächen | PASS; Mock/Connected angezeigt, große gerahmte Bedienelemente sichtbar und bedienbar |
| Kopf, Licht und Bewegung | PASS; Look up, Licht an, Vorwärtsfahrt 500 ms, Linksdrehung 350 ms und explizites STOP bestätigt; Trace enthält die passenden Befehle |
| Sensorzustand ohne Roboterbefehl | PASS nach Korrektur; Mock-Sensorupdates aktualisieren den sichtbaren Sicherheitsstatus selbstständig von `cliff-rearming` zu `safe` |
| Tischkanten- und Hindernisblockade | PASS für Frontkante: Sicherheitsstatus `Blocked/cliff-all`, Vorwärtsfahrt `Blocked/cliff-front`; Hindernisblockade ist im Controller-Test bestätigt, finale Geräte-Feedbackmeldung dafür noch nicht erneut geprüft |
| Unbekannte Sensoren | PASS; Zustand `fed9-never-seen` blockiert Vorwärtsfahrt; Feedback am Gerät sichtbar |
| Mock-Link und Modi | PASS; Trennen zeigt `Not Connected` und `Drive Stopped`, erneutes Verbinden stellt Mock wieder her; `Disconnected` zeigt getrennten und leeren Roboterzustand |
| Abschließender Mock-Zustand | PASS; Mock Connected, Kopf Centered, Drive Stopped, Licht Off, Clear floor und Sicherheitsstatus Safe ohne aktuelle Blockade |
| `pnpm run ios:check` | PASS nach Sensorbeobachter-Korrektur, einschließlich Mock-Transport-, Modus- und Integrationstests |
| `pnpm run ble:lifecycle-test` | PASS; Autoconnect-, Abbruch- und Scan-Lifecycle-Tests |
| Echte Sprach-/Entscheidungsanfrage und Hardware | Noch nicht abgenommen; keine Realtime-Audio- oder Decisions-Anfrage ausgeführt und kein physischer LOOI vorhanden |

Die Geräteprüfung fand einen Cachefehler im Debugstatus: FED9-Sensorwerte wurden
im Robotercontroller aktualisiert, aber nicht an Beobachter weitergegeben. Daher
blieb die Anzeige bei `cliff-rearming`, bis ein anderer Controllerbefehl einen
Status-Refresh auslöste. Sensoränderungen veröffentlichen den Diagnosestatus jetzt
gebündelt und höchstens zehnmal pro Sekunde; veraltete Verbindungsgenerationen
werden verworfen. Ein Integrationstest bestätigt, dass der gecachte UI-Status
ohne Controllerbefehl `safe` und neue ToF-Werte empfängt.

Die Touchflächen waren in einem früheren Build durch dynamische Pressable-Styles
als unformatierte Textlinks gerendert. Statische StyleSheet-Arrays beheben das;
die abschließenden Bedienelemente wurden auf dem installierten Build sichtbar
und funktionsfähig geprüft.

Der API-Schlüssel wurde ausschließlich über die autorisierte, sichere Eingabe in
My LOOI gespeichert. Dieses Protokoll enthält weder Schlüssel noch Eingabebilder.
Die authentifizierte Modelllistenabfrage zeigt vier verfügbare Modelle. Sie belegt
Zugriff auf diesen Listenendpunkt, aber nicht, dass Guthaben vorhanden ist oder
Realtime und Decisions funktionieren. Es wurde keine Modellinferenz ausgelöst.

Der Sherpa-Download ist abgeschlossen; der Done-Schritt und die Hauptansicht
wurden erreicht. Mikrofon und Kamera sind erlaubt. Adaptive Behavior, angeforderte
Snapshots, der Vergleich möglicher Reaktionen und Camera Attention sind aktiviert.
Eine echte Realtime-Unterhaltung, Decisions-Ausführung, erkannte Gesichter oder
Bewegung eines physischen Roboters wurden damit nicht geprüft.
