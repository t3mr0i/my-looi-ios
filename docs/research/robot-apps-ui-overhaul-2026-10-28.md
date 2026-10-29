# Apps UI overhaul

Scope confirmed by the user: the complete Apps area, preserving other app routes,
the LOOI face, bridge protocols, credentials and safety behavior.

Mode: Operate. The task path is Discover → choose an app → open/install/start;
My apps owns running and uninstall controls, With AI owns the app-skill preference,
and App setup owns connection, media and mappings. The existing dark/cyan identity
is retained; this is a structural layout and navigation overhaul.

The previous fixed rail consumed 92pt plus frame spacing on a phone, forcing long
labels into a narrow content column. The previous menu also required returning to
a menu between ordinary app tasks. The new area uses a full-width safe-area shell,
a direct three-way section switch and a separate setup hierarchy. The local STOP
remains visible above scrolling content. Other DeviceShell callers are unchanged.

Rhythm uses 24pt outer spacing, 20pt app surfaces, 16pt between app entries and
compact related controls. Existing LOOI text/tint colors remain authoritative.
All text keeps native scaling; icons use SF Symbols on native and crisp vector
equivalents only for the web preview.

## Review and verification

| Area | Before | Result |
| --- | --- | --- |
| Phone reading width | Fixed 92pt rail plus nested frame/padding | Full-width safe-area layout; no rail in Apps |
| Navigation | Menu round trips between ordinary tasks | Direct Discover/My apps/With AI sections; separate setup hierarchy |
| App entries | Small title, SDK metadata, equally prominent actions | Readable title/author/purpose and one primary action; quieter Details |
| Library | Competing Start and red uninstall buttons | Start/Stop separated from a 44pt trash control; native confirmation retained |
| STOP | Scrolls away with the catalog | Remains visible outside the scroller; verified at the end of a long list |
| Catalog size | UI receives only the first 200 entries | Shared client offset and 60-entry batches with Show more; all indexed entries searchable |
| Selection semantics | Visual selection lacked a web selected state | Native accessibility state plus explicit aria-selected; checked true in preview |
| Form rendering | Literal whitespace child in a toggle View | Removed; forms retain the existing saved configuration and consent paths |

The final web fixture pass covered 320 × 740, 390 × 844 and 1024 × 768,
German and English, setup and all three detail screens, empty search, single-result
search, loading additional catalog entries, and AI selection OFF after leaving and
reopening the page. The fixture loaded 66 test records through the actual production
UI; no real package was installed or started. The final images are under
`output/robot-apps-overhaul/` and show simulated catalog/native boundaries.

`pnpm run ios:check`, TypeScript, the full robot bridge suite, the native app-skill facade regression,
action-runtime regression and localization regression pass. The signable iOS Release
build and strict signature verification pass. Source/runtime checks do not establish
physical iPhone behavior, native swipe-back/VoiceOver, 200% Dynamic Type, or LOOI
hardware acceptance; this turn did not operate the physical iPhone.

The layout detector returned an empty list. It has no native runtime verdict; the
rendered web fixture and source checks provide the stated coverage only. Existing
dark/cyan tokens remain authoritative; no global design system or unrelated route was
rewritten. The preview supplies in-memory settings and a fake Companion and is not a
SecureStore or real-device test. No new motion or image assets were introduced.
