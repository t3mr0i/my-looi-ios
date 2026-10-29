# Aktuellen iPhone-Stand installieren und Gesprächsprüfung fortsetzen

Am 29. Oktober wurde die Arbeit nach ausdrücklicher Nutzeraufforderung wieder
aufgenommen. Die schreibgeschützte App-Liste zeigte weiterhin den regulären
B9 vom Vortag. Die frisch kopierte Diagnose endete unverändert am 28. Oktober
um 20:36:09.642 UTC. Daraus ergibt sich keine neue Gesprächsbestätigung.
Der Nutzer stellte klar, dass zunächst die neue App installiert werden soll.

Der aktuelle Build umfasst den gemeinsam weiterentwickelten Produktionsstand:
Mondaugen, Farbeinstellungen und Stilkompatibilität sowie die bisherigen
Audioverbesserungen und die Budget-Tippkorrektur. 243 lokale JavaScript-/
TypeScript-Quellen wurden für Metro eingefroren; 825 Assets und 35 native bzw.
Konfigurationsdateien sind per Hash erfasst. Der Build nutzt den vorhandenen
CocoaPods-Stand mit identischen Podfile-/Manifest-Locks. Geräteschlüssel und
App-Daten werden durch den Installationsvorgang nicht exportiert.

Der vollständige `pnpm run ios:check` besteht am eingefrorenen Quellstand.
Der signierte Release-Build wird vor Installation auf unveränderte Eingaben,
Paketidentität und Signatur geprüft. Build-, Prüf- und Installationsbelege
liegen unter `output/voice-latency-install-2026-10-29/`.

## Nachträglich ausgewertete interne Aufmerksamkeitsgrenze

Die neu kopierte Diagnose enthält zwei bereits am 28. Oktober nach dem ersten
B8-Diagnoseabruf entstandene Eingangsreaktionen. Ihre Zeitstempel liegen zwischen
dem verifizierten B8-Start und der späteren B9-Installation. Sie werden B8
zugeordnet und nicht dem neuen Build zugeschrieben.

| Interne Grenze auf dem physischen iPhone, B8 | n | Median | p95 |
| --- | --- | --- | --- |
| JS-Audioempfang bis Zustandsanforderung | 2 | 0,50 ms | 0,78 ms |
| JS-Audioempfang bis React-Effekt der Gesichtskomponente | 2 | 10,20 ms | 15,93 ms |

Die Stichprobe ist klein; p95 ist hier lediglich der größere beobachtete Wert.
Die Grenze beginnt nach Mikrofon, Pufferung und Bridge und endet vor einem
belegten sichtbaren Pixel. Das Eingangssignal wurde nicht als menschliche
Sprache annotiert. Diese Messpunkte beweisen deshalb weder die gewünschte
100-ms-Reaktion ab Sprachbeginn noch eine hörbare Antwort oder erkanntes
Verstehen. Sie zeigen nur den lokalen Weg ab JS-Empfang.

[Geräteproxy mit Einzelwerten](evidence/voice-input-attention-device-proxy-2026-10-29.json).

Für die Gesprächsabnahme bleibt als erster Schritt eine hörbare Antwort auf
„Hallo, hörst du mich?“ mit anschließend weiterlaufendem Zuhören erforderlich.
Erst danach ist eine vergleichbare Reihe für Median/p95, Denkpausen und
Unterbrechungen sinnvoll. Frühere Mock-, Simulator- und Proxy-Zeiten ersetzen
keinen dieser Geräteversuche.

## Installation abgeschlossen

Der native Release-Build und die abschließende Signaturprüfung bestehen.
Während der Kompilierung wurde parallel eine reine JavaScript-Korrektur des
Budget-Sprachkontexts fertig: Derselbe beitragsbezogene Kontext wird jetzt an
Textantwort und Sprachausgabe übergeben. Diese Datei wurde erneut eingefroren
und ins Hermes-Bundle exportiert; native Dateien und Assets blieben identisch.
TypeScript, Budget-Runtime, Sprachvorschau, Eingangsaufmerksamkeit und
Tippkorrektur bestehen auch nach dieser letzten Änderung. Der vollständige
`ios:check` bestand unmittelbar vor der Kontextänderung.

`devicectl` bestätigt die Installation des aktuellen Pakets auf dem physischen
iPhone über WLAN und dessen aktivierten Start. Die erneute App-Liste bestätigt
dieselbe neue Installationsadresse. Die Versionsanzeige bleibt 2.1.151 (41);
das neue Paket ist durch Bundle-Hash und Installationsbeleg identifiziert.
Kein erzwungener Testmodus wurde eingebaut.

[Build- und Installationsbeleg](evidence/voice-latency-current-install-2026-10-29.json).
Der menschliche Sprachtest und die Latenzabnahme sind damit noch nicht erledigt.

Die erste neue Diagnose bestätigt Budget und angefordert/gemeldet jeweils
100 ms. PCM-Blöcke erreichen die App; zwölf protokollierte Health-Fenster
zeigen jedoch exakt Nullenergie und keine erkannte Sprache. Ohne zeitgleich
bestätigten menschlichen Sprachbeitrag ist die Ursache offen. Daraus wird
kein erfolgreicher Mikrofontest abgeleitet. Nach rund 13,5 Sekunden wurde die
App inaktiv und stoppte Budget über den bestehenden Lebenszykluspfad.

[Startdiagnose des neuen Pakets](evidence/voice-latency-current-startup-2026-10-29.json).
