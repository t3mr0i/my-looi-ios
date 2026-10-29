# Weiche Mondaugen in der App

Die freigegebene Variante „Weicher“ aus
`output/moon-eyes-2026-10-29/study.js` ist in den gemeinsamen App-Renderer
übernommen: die unten vollere Glaskontur, dunkle Tiefe oben, Mintlicht unten,
der vergrößerte Augenabstand und das breite, flache Lächeln mit schmalen Enden.

## Umsetzung

- `glass-face.ts` beschreibt die originale Kontur durch vier kubische Segmente.
  Die Ruhekontur und der Mund werden gegen die freigegebene Studie geprüft.
  Neugier, Freude, Überraschung, Sorge und Missfallen morphen entsprechende
  Kontrollpunkte. Blinzeln schließt weiterhin eine Blende über stabilem Material.
- `GLASS_FACE_LAYOUT` skaliert die Proportionen der Studie gleichmäßig um den
  bestehenden Mundkontakt bei `(180, 216)`. Die Augen stehen weiter auseinander;
  Statusbeschriftungen verschieben ihre Position nicht mehr.
- `GlassFace.tsx` zeichnet das neue Material und den gefüllten, abgestuften Mund.
  Der vorhandene Blick bewegt das untere Licht innerhalb der Augen. Die
  vorhandenen Uhren steuern Blinzeln, Sprachpuls und Szenen.
- Alle fünf gespeicherten Farbfamilien erhalten das Mondmaterial. Die sieben
  Stil-IDs, Dekorationen und der kleine Avatar bleiben verwendbar. Die
  Farbfelder in den Einstellungen beziehen ihre Farben aus derselben Palette.
- Die 200 SVG-Szenenbilder und ihre PNG-Vorschauen sind neu erzeugt. Ihr
  Generator verwendet die Geometrie des App-Gesichts. Requisitenquellen und
  ihre Kontaktpunkte sind unverändert.

Die Auflösung von Reaktionen, tatsächlich gehörten Sprachabschnitten,
Streicheln, Eingangsaufmerksamkeit, Spielen, STOP und Szenen bleibt bei ihren
bisherigen Verantwortlichen. Diese Änderung fügt keinen Sensor, keinen
Sprachaufruf und keine physische Roboterbewegung hinzu.

## Gefundene native Abweichung

Der Browser akzeptierte Verlaufspunkte wie `offset=".25"`. Der installierte
native SVG-Parser erwartet bei Zeichenketten eine Ziffer vor dem Dezimalpunkt;
die Punkte wurden dort als Null gelesen. Dadurch blieb die untere Hälfte der
Augen dunkel. Alle Verlaufspunkte dieses Renderers sind jetzt Zahlen, etwa
`offset={0.25}`. Ein Komponententest prüft die tatsächlich gerenderten Stops.
Die native Diagnose ist unter `output/moon-eyes-integration-2026-10-29/`
erhalten; sie vergleicht eine einfache Fläche und den App-Renderer.

## Prüfung und Belege

- TypeScript: `pnpm exec tsc --noEmit`.
- Charakter-, Ausdrucks-, Sprachübergabe-, Streichel-, Bedienungs- und
  Lebenszyklusprüfungen; alle 200 Szenen einschließlich Kontaktgeometrie,
  800 lokalisierter Auslöser und reduzierter Bewegung.
- Szenenbilder reproduzierbar: `node scripts/build-character-scenes.mjs --check`.
- Browser: Produktionskomponenten in isolierter Umgebung, Telefonbreite,
  Avatar, Farbwahl, Dekoration, Requisiten und Übergänge bei 10 % Tempo.
- iPhone-16-Pro-Simulator, iOS 18.5: vollständige native Folge mit Ruhe,
  Neugier, Überraschung, Freude, Streicheln, Sprachdarstellung, Getränk,
  Kaffee, Keks, Buch, Schlaf und Rückkehr. `native-verification.json`
  bestätigt Montage, zwölf Aufnahmen und erfolgreich beendete Videoaufnahme.

Der abschließende iPad-Lauf ist nicht freigegeben: Der isolierte Teststarter
kehrt auf dem iPad zur Serverauswahl zurück, bevor die Produktionskomponente
montiert wird. Ein früherer iPad-Mount vor der Verlaufskorrektur ersetzt diese
Prüfung nicht. Die Startversuche und Logs sind erhalten. Eine native
iPad-Darstellungsprüfung bleibt damit offen.

`output/moon-eyes-integration-2026-10-29/native-animation.mp4` ist ein Ausschnitt
dieser Simulatoraufnahme. Die Browserprüfung ist unter
`http://127.0.0.1:8771/moon-eyes-integration-2026-10-29/index.html` erreichbar.
Quellstände vor der Änderung, Diffs, Hashes und Prüflogs liegen daneben.

Die native Prüfung lädt die aktuellen Produktionskomponenten in eine isolierte
Test-App mit dem vorhandenen Simulator-Build und unveränderten nativen
Abhängigkeiten. Audio, Kamera und Roboterdienste sind dort ersetzt. Sie belegt
die native Darstellung, keine Mikrofon-, Lautsprecher-, BLE- oder
Leistungsprüfung auf einem physischen Gerät. Kein Release wurde erstellt.
