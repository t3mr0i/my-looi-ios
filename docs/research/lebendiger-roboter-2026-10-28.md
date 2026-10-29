# Wann wirkt ein Roboter lebendig?

Recherche: 28. Oktober 2026. Frage: Welche untersuchten Eigenschaften sozialer
Roboter könnten LOOI als aufmerksamen, lebendigen Gesprächspartner erfahrbar
machen? Quellen sind Forschungsarbeiten beziehungsweise Seiten der jeweiligen
Forschungsgruppen. Ergebnisse anderer Roboter sind keine Wirksamkeitsnachweise
für LOOI; ungeprüfte Übertragungen sind unten als solche bezeichnet.

## Befunde

1. **Passendes Zuhören schlägt zufällige Reaktion.** Park et al. verglichen bei
   erzählten Geschichten einen auf Sprechanlässe reagierenden Tega-Roboter mit
   einem ähnlich ausdrucksstarken, aber zufällig reagierenden Roboter. Von 23
   rekrutierten Kindern wurden 20 ausgewertet. Beim Erzählen schauten sie häufiger
   zum reagierenden Roboter; die Gesamtblickzeit über die ganze Sitzung war
   dagegen nicht signifikant verschieden. Die Studie betrifft Kinder und zwei
   gleichzeitig anwesende Roboter, nicht die alltägliche LOOI-Nutzung.
   [Originalarbeit](https://learning-with-social-robots.media.mit.edu/resources/papers/park2017hri-backchannel.pdf).
2. **Gesprächsphasen müssen erkennbar sein.** Nicken, Gesichtsausdruck, Blick
   und Redewechsel können Hören, Nachdenken und Sprechen koordinieren; falsches
   Timing führt zu Überlappungen. Die Übersichtsarbeit von Skantze beschreibt
   unterschiedliche Verfahren und ihre Grenzen, keine allgemeingültige
   Millisekundenzahl für LOOI. [Review](https://doi.org/10.1016/j.csl.2020.101178).
   Eine Reservierungsstudie mit 48 Personen untersuchte ein blinkendes Signal
   für Verarbeitungszustände und fand weniger Sprachkollisionen; das ist ein
   anderer Roboter und eine andere Aufgabe. [Originalarbeit](https://www.jstage.jst.go.jp/article/tjsai/26/2/26_2_353/_article/-char/en).
3. **Blick kann eine Funktion vermitteln.** Bei 30 Teilnehmenden wurde ein
   Gesprächsblick des NAO, einschließlich gezieltem Wegblicken, als absichtsvoll
   und nachdenklich wahrgenommen. Die Bewegungen waren auf diesen Körper und die
   Versuchsaufgaben abgestimmt. [Andrist et al.](https://graphics.cs.wisc.edu/Papers/2014/ATGM14/hri14-andrist-CameraReady.pdf).
4. **Mehr Aktivität ist nicht automatisch besser.** Ein Vergleich von zwei
   Eingriffsstrategien in einer simulierten Krankenhausaufgabe mit 32 Personen
   berichtet einen Zielkonflikt zwischen Unterstützung und Aufdringlichkeit.
   [Forschungsgruppe IRI](https://www.iri.upc.edu/publications/show/3161).
   Eine Untersuchung virtueller Agenten berichtet, dass natürliche Füllsignale
   längere Latenz subjektiv abmildern können, bei kurzer Latenz aber keinen
   signifikanten zusätzlichen Vorteil zeigten. Die Ergebnisse betreffen Avatare,
   keine physischen LOOI-Roboter. [Autorenseite und Publikation](https://mykola.io/publication/iva-cui/).
5. **Reaktionen während der Rede sind vielversprechend, aber anspruchsvoll.**
   Sun et al. untersuchten während der Sprache erzeugte nonverbale Reaktionen in
   einer Machbarkeitsstudie mit sechs Personen, ohne Kontrollbedingung. Die Autoren
   berichten auch mehrdeutige Gesten und ein Vorhersagesystem, das oft ohne
   erkannten Sprecherintent auf eine voreingestellte Haltung zurückfiel.
   Daraus folgt kein Beleg, dass ein einfacher Timer passende Signale erkennt.
   [Originalarbeit](https://doi.org/10.1145/3820253.3831400).

## Abgleich und Umsetzung in LOOI

LOOI besitzt bereits einen sofortigen, lokalen Aufmerksamkeitszustand bei
Sprachbeginn, einen Denkzustand nach Sprachende, Geste-Ausdruck-Koordination
nach gehörter Antwort und lokale STOP-/Fokus-/Schlafsperren. Die Auswertung
gesprochener Mimik verwendet nur vom Wiedergabepfad freigegebene Abschnitte.
Diese Aussagen beschreiben den Code, keine Messung am Roboter.

Zwei konkrete Brüche wurden geändert:

- Der bestehende lokale Bildschirmzustand für Zuhören und Nachdenken wird bei
  tatsächlich weiterlaufender Nutzerrede beziehungsweise Verarbeitung über die
  bisherige Zehn-Sekunden-Grenze hinaus erneuert. Wenn das jeweilige lokale
  Signal endet, läuft die Verlängerung aus. Es gibt keinen zusätzlichen
  Modellaufruf, keine Sprachäußerung und keinen Motorbefehl. Die Zeitwerte sind
  technische Aufbewahrungsgrenzen und nicht aus den Studien kalibriert.
- Die regelbasierte Mimik prüft bei gehörtem Ausgabetext weitere Verneinungen.
  Beispiele wie „nicht schön“ und „not great“ sollen keine fröhliche oder
  begeisterte Mimik auslösen. Das ist ein eng begrenzter Fehlerfilter, keine
  zuverlässige Emotionserkennung und keine Interpretation der Nutzeremotion.

Die Erneuerung ist eine **Designableitung** aus Kontingenz und Zustandslesbarkeit,
kein im Labor nachgewiesener Lebendigkeitsgewinn. Die Wortregel behebt eine im
Code nachvollziehbare Inkonsistenz; die genannten Studien evaluieren nicht diese
Regel. Blick- und Gesichtsprioritäten, Reduce Motion und STOP bleiben lokal.

## Offene Überprüfung

### Ergänzung: lokale Zuhörakzente

Im Standardmodus Realtime PCM wird jetzt der bereits vorhandene Audiopfad
ausgewertet. Die laufende serverseitige Spracherkennung muss die Person als
sprechend führen. Ein lokaler Detektor sammelt ausschließlich Pegel und Dauer
frischer, aufeinanderfolgender Audioblöcke. Nach einem längeren Sprechabschnitt
kann eine kurze, deutliche Pegelpause einen 600-ms-Akzent mit neutralen Augen
und leichter Neigung des gezeichneten Gesichts auslösen. Dies bezeichnet
Aufmerksamkeit und weder Zustimmung noch verstandenen Inhalt. Es gibt maximal
zwei Akzente je Sprechabschnitt und mindestens sechs Sekunden Abstand.

Die Erstgrenzen (mindestens drei Sekunden laufender Abschnitt, 1,6 Sekunden
ausreichendes Signal, 220–500 ms Pegelpause) sind konservative technische
Startwerte, keine aus den Studien für LOOI validierten Parameter. Paketlücken,
falsche Reihenfolge, schnelle Wiedergabe einer Warteschlange oder unzureichendes
Signal verwerfen die gesammelten Hinweise. Native Uhr und JS-Uhr werden über
Zeitdifferenzen geprüft; ihre verschiedenen Ursprünge werden nicht gleichgesetzt.
Diese neue Auswertung speichert keine Audiokopie und schickt keine
Pegelzusammenfassungen an Modelle. Der bestehende Realtime-Audiostream läuft
weiter. Die neue Auswertung interpretiert die Pegel nicht als Nutzeremotion.

Der Akzent verwendet ausschließlich die vorhandene Bildschirmdarstellung.
Physische Kopf- und Fahraktionen werden daraus nicht abgeleitet. Ausgabe,
STOP, Routen-/App-Wechsel, Schlaf, Reduce Motion, laufende Bewegung, Spiele und
ausstehende Bestätigungen unterdrücken oder beenden ihn. Ohne lokalen
PCM-Strom, etwa im bisherigen WebRTC-Pfad oder Budget-Modus, bleibt es bei den
vorhandenen Aufmerksamkeitszuständen; es wird kein zweites Mikrofon gestartet.
Tests führen den tatsächlichen PCM-Ereignispfad und die Verhaltenssteuerung
mit synthetischem Audio und ersetzten nativen Grenzen aus.

Im vollständigen Prüflauf fiel außerdem ein Budget-Übergang auf: Ein vom nativen
VAD bereits abgeschlossenes Segment wurde ignoriert, sodass weitere Stille
abgewartet wurde. Der Pfad übernimmt das bestätigte Segmentende nun direkt,
sofern der aktuelle Block keine erneute Sprache enthält. Der vorhandene
Integrationstest für diese Übergabe besteht damit; dies fügt dem Budget-Modus
keine Zuhörakzente hinzu.

- In einem längeren Gespräch beurteilen, ob der stabile Zustand tatsächlich
  aufmerksam wirkt oder ob er zu statisch bleibt; dabei Unterbrechungen, Fokus,
  Spracheingabe und Schlaf getrennt prüfen.
- Für semantisch passende oder physische Zuhörgesten während längerer
  Äußerungen fehlen noch validierte Sprechanlässe. Die implementierte
  Pegelpause ist eine begrenzte Gelegenheit für einen neutralen Bildschirmakzent,
  kein Nachweis für Inhalt, Einverständnis oder Gefühl. Kein Nicken nach Timer.
- Später vorhandene prosodische oder Pausensignale zuerst mit aufgenommenen,
  freiwillig bereitgestellten Tests und einem Vergleich gegen keine bzw.
  zufällige Reaktion evaluieren; STOP, Grenzen und kurze Nutzersignale behalten
  Vorrang. Reale Räume, Mikrofonabstände und Sprachen benötigen eigene Daten.
- Quelle, Simulation, physisches Gerät und subjektives Urteil getrennt nennen.
  Die automatisierten Tests belegen Zustandsübergänge, nicht wahrgenommene
  Lebendigkeit oder physische Sicherheit unter realen Bedingungen.
