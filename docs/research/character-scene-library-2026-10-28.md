# 200 character situations

Scope: extend LOOI's existing cyan face/prop system to 200 separately named
situations in ten groups of twenty. Each has its own vector prop, a full face
picture, a mood, a bounded display motion and labels in DE/EN/UK/RU. This is an
Experience extension inside the existing Home menu, without a new visual identity.

The catalog module owns IDs, localized names, categories, face/motion profiles,
search and the allowed context phrases. Main callers are the existing character
action controller, RobotFace and the Home menu's searchable picture selection.
One scene ID is the request interface; callers do not coordinate artwork, mood
and timers. The controller retains replacement, reply completion, cancellation
and lifecycle ownership. The two trigger adapters are menu selection and
committed conversation turns. Both remain display-only.

The catalog is synchronous and local, with indexed ID lookup and a small
precomputed search index. Unknown IDs are refused before a scene starts. No
network fetch or image generation runs on the phone. Source symbols and their
licenses are pinned locally; the build script deterministically generates the
200 full pictures and static Metro asset registrations from the curated catalog.

Automatic selection requires a clear current human phrase, with sensitive
contexts taking priority and an explicit neutral fallback when no match is
reliable. System status, agreement and understanding pictures have no automatic
text triggers: drawing a battery or a checkmark is not evidence of device status
or comprehension. The model cannot trigger physical actions through this seam.
The existing sleep, speech, processing, correction and STOP priorities remain.

Trade-off: 200 curated scenes cover common situations rather than every possible
human situation. They share a consistent geometric character rig and nine motion
profiles; they are not 200 bespoke films. Search and virtualized thumbnails make
the complete collection inspectable without displaying 200 controls at once.

## Delivered assets and checks

Exactly 200 curated entries, 200 original props, 200 full SVG face pictures and
200 matching 720×640 PNG pictures. `RENDERED.json` records source, PNG and decoded
pixel hashes; all 200 decoded pixel hashes differ. This counts motifs once,
regardless of file format. The 6.4 MB ZIP includes the searchable offline gallery,
PNGs, vectors, original props, catalog and full upstream licenses.

The 200-scene test checks all source hashes, render correspondence, dimensions,
unique pixels, every scene's complete four-phase lifecycle, 800 localized exact
selections, search/filtering, Unicode phrases, negation, quoted/reported text,
translation boundaries, conflicting topics and sensitive-context precedence.
The runtime test checks reply ownership, twelve-second context spacing, explicit
selection during that interval, and the number-game guard. Rest and comfort
fade in place instead of sweeping across the face.

`pnpm run ios:check` passed in `output/character-library-final-ios-check.log`.
An earlier run failed the existing task-expiry assertion in the object-activity
runtime suite; that suite passed alone and the complete rerun passed. No object
tracking source or expiry behavior was changed for this picture work. Focused
scene/face checks were rerun after the final display-only rest transition.

Native evidence in `output/character-library-native-review/` uses the actual
RobotFace, CharacterProp, HomeMenu and scene controller, plus substituted voice,
robot and camera services. The offline iPhone fixture exported 401 assets and
shows eight representative live scenes, the 200-picture grid, a category filter
with 20 entries, search with one result, an empty result, reset to all 200, and
selection of Origami from search into the real face. The keyboard remained usable
and the selected scene closed the sheet before starting. Motion was also sampled
at ten percent playback speed. The native review is presentation evidence, not
an actual microphone conversation or physical-device acceptance.

The separate local HTML gallery was checked in the in-app browser: all 200
entries, category filtering to 20, search to one, then reset to 200. The original
vector licenses are Lucide ISC/Feather MIT and Tabler MIT; commits and per-file
hashes are pinned in `assets/character-scenes/SOURCE.json`.

The earlier 288px native SVG intermediates have now been superseded by
transparent 384px PNG renders from the original vectors. Original source bytes
stay in `props/`; `native-props/` is generated with librsvg and recorded in
`RENDERED.json`. This removes the platform SVG decoder from the prop display
path. Export pictures remain 720×640. The updated native result still requires
visual verification; see `character-expression-refinement-2026-10-28.md`.

All 800 localized show-picture requests are additionally passed through the real
addressed physical-command parser. They cannot become a movement, sleep, nod
or dance request; the existing unconditional STOP priority is retained. This
specifically guards the English title “On-screen dance”. The legacy physical
routing assertion now accepts the current “no raw physical movement tool”
wording as well as its earlier wording, without changing the product prompt.

The extra final native sharpness comparison could not be completed: CoreSimulator
stalled on reinstallation and the installer reported Mach server death. A smaller
232 MB visual-only copy, excluding the four voice model bundles, also stalled.
The earlier eight scene cycles and search/selection evidence remain valid; the
288px canvas itself is source-tested and bundled, with its final native sharpness
not independently confirmed. The test simulator was stopped; no physical iPhone
was used. Static 720×640 PNG pictures are already rendered and verified.

The complete iOS check passed again after the display/physical-command guard.
The last conservative text-selection refinement (neutral fallback for sick or
missing pet reports) received the focused catalog/controller, physical-command
and type checks. It changes no picture or native layout.
