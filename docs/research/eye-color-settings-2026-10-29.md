# Augenfarbe direkt auswählen

Unter „Gesicht gestalten“ stehen Mint, Rosa, Limette, Bernstein und Violett
direkt zur Auswahl. Die vorherigen zwei Aufklappschritte für die Farbpalette
entfallen. Eine statische Vorschau verwendet die produktiven `GlassEye`- und
`GlassMouth`-Komponenten und zeigt die gewählte Farbe sofort.

Die Einstellung verwendet weiterhin `preferences.facePalette` und
`updatePreferences({ facePalette })`. Normalisierung, Speicherung und Laden
bleiben beim vorhandenen User-Store. Es gibt keinen neuen Farbzustand und
keinen situationsabhängigen Wechsel in der App. Der gespeicherte Wert gilt
auch während Reaktionen, Sprache und Szenen. Die bestehenden Gesichtsformen
bleiben unter ihrer eigenen aufklappbaren Zeile erreichbar.

Die Vorschau startet keine Unterhaltung, Reaktion oder Robotertätigkeit.
Alle fünf Farbfelder haben Text, sichtbare Auswahl, Radio-Semantik und mindestens
52pt Höhe. Englisch, Deutsch, Ukrainisch und Russisch benennen den Bereich
als Augenfarbe. Die bisherige `cyan`-ID bleibt aus Speicherkompatibilität
erhalten und heißt sichtbar Mint.

Geprüft: TypeScript, die bestehende Stil-/Palettenregression und
RobotFace-Komponentenprüfungen; Umschalten aller fünf Farben im Browser,
einschließlich `aria-checked`; native Darstellung der produktiven Farbauswahl
auf iPhone 16 Pro und iPad Pro 11 Zoll (iOS 18.5). Die native Darstellung
lief in einer isolierten Test-App, nicht in einer veröffentlichten App-Version.
Der Browser nutzt einen lokalen Vorschauzustand; die App bindet die Auswahl
an den bestehenden persistenten Store.

Belege und Quellstandsvergleiche:
`output/eye-color-settings-2026-10-29/`, insbesondere
`mobile-rose.png`, `native-picker.png`, `native-ipad-picker.png` sowie die
TypeScript- und Prüflogs. Die Überprüfung der kontrollierten Farbauswahl
beansprucht keine neue Hardware-, Audio- oder BLE-Verifikation.
