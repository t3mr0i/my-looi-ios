# LOOI – 200 Situationsbilder

200 eigenständige Motive in zehn Bereichen mit je 20 Einträgen. Jedes Bild
verbindet LOOIs Gesicht mit einem eigenen Requisit und passender Mimik.
Keine Emojis, Emoji-Schriftarten oder zur Laufzeit geladenen Bilder.

- `index.html`: vollständige, lokal durchsuchbare Galerie im Browser.
- `pictures/*.png`: alle 200 fertigen Bilder, je 720 × 640 Pixel.
- `pictures/*.svg`: dieselben 200 Motive als skalierbare Vektorbilder.
- `props/*.svg`: die zugehörigen Originalsymbole.
- Im Quellprojekt: `native-props/*.png` enthält transparente Requisiten mit
  384 × 384 Pixeln aus denselben Originalvektoren. Die App färbt sie passend
  zur gewählten Palette ein und benötigt dafür keinen SVG-Decoder.
- `catalog.txt`: Bezeichnungen in Deutsch, Englisch, Ukrainisch und Russisch,
  Mimik, Bewegung und die zulässigen klaren Gesprächsbezüge.
- `SOURCE.json`: Originalquelle, festgelegter Commit und Prüfsumme jedes Symbols.
- `RENDERED.json`: Zuordnung und Prüfsummen von Vektoren, PNGs und Bildpixeln.

Trink- und Essszenen führen Strohhalm, Tassenrand oder Bisskante zum Mund.
Der Kontakt bleibt beim kleinen Bewegungsakzent bestehen. Beim Lesen wandert
der Blick einmal über die Zeile; neue Kameraaufmerksamkeit startet ihn nicht
erneut. Traurigkeit und Sorge haben eigene Mundbögen. Ruhige Szenen blenden
ihr Requisit an Ort und Stelle aus.

In der App: Menü → Kleine Aktionen → Alle 200 Bilder ansehen. Suche und
Bereichsauswahl führen zum gewünschten Motiv. Antippen startet eine kurze
Szene. „Zeig mir Teepause“ funktioniert als ausdrücklicher Sprachwunsch;
klare aktuelle Aussagen wie „Mir ist kalt“ können nach der Antwort eine
passende Szene auslösen. Mehrdeutige, verneinte und zitierte Aussagen bleiben
neutral. Zwischen automatischen Szenen liegen mindestens zwölf Sekunden.

Technische Statusmotive sind auswählbare Bilder, keine neuen Messwerte.
Sie werden nicht aus einer Gesprächserwähnung als Gerätestatus abgeleitet.
Alle Szenen betreffen die Anzeige und bewegen keine Hardware.

Symbole: Lucide (ISC, einschließlich Feather-MIT-Hinweisen) und Tabler (MIT).
Die vollständigen Lizenzen müssen bei Weitergabe erhalten bleiben.

Im Quellprojekt: `pnpm character:scenes-build` erzeugt Daten, Bilddateien und
Asset-Zuordnung neu. Der PNG-Renderer benötigt Python mit Pillow sowie
librsvg (`rsvg-convert`). `pnpm character:scenes-test` prüft den fertigen
Katalog ohne Netzwerk und ohne diese Grafikwerkzeuge.
