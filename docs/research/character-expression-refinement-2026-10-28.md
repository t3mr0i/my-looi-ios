# Expression refinement after better

The brief stays at 200 scenes. This pass improves the shared expression and
staging system rather than adding motifs. The raw material was the upstream
SVG geometry, current face poses, original native motion capture and actual
conversation-selection code.

## Findings and implementation

- Sadness previously reused the concerned line mouth. It now has a frown,
  raised inner eye corners, a lower posture and no celebratory beat. Concern
  has a smaller frown; concentration retains the quiet line mouth.
- Generic prop offsets did not encode which part should touch the mouth.
  Nine food/drink vectors now have authored contact points. Rotation and
  scale compensation preserve that point through the sip/bite accent.
- The tea vector is a teapot. It now uses the offer motion rather than the
  sip motion. Reading scans one line and then returns to center. The scan is
  independent of camera-attention updates but yields to higher face priorities.
- The original native capture showed prop differences from reference renders,
  including a fragmented cookie. The exact decoder failure was not isolated.
  Native props now use transparent 384px librsvg PNG renders, with runtime
  palette tinting. Upstream SVG bytes, license and commit hashes are preserved.
- Several prop poses approached or crossed the lower export boundary.
  Reveal, enjoy, rest and read positions now leave space at the lower edge.
- Quoted examples, indirect hypothetical statements, narrative requests and
  reported statements receive a conservative neutral fallback. Ukrainian
  apostrophes inside actual commands remain supported.

## Verification and limits

`scripts/character-scenes.test.mjs` checks all 200 scenes, 800 localized picture
commands, source/render hashes, lifecycles and context boundaries. Painted prop
bounds come from the independently rasterized alpha channel, then include prop
rotation, scale and whole-face tilt. Visible key poses fit the 360×320 export
canvas with a four-unit margin. Every authored contact is sampled over the
accent and remains within 0.001 logical units of the mouth center. This proves
geometry and registration, not perceptual recognition or native rendering.

`pnpm run behavior:expression-test` passed. The final RobotFace component test
also checks that changing object attention does not restart a reading scan,
that ending the use phase ends the scan, and that speech takes over. Shared
values in that test now persist between renders, matching Reanimated's lifetime.
TypeScript checks passed. No microphone conversation or physical LOOI action
was used as evidence.

All 200 complete PNG pictures and 200 native transparent props were regenerated
from the current shared rig. PNG exports remain 720×640. Original licenses and
source hashes remain unchanged.

The native recheck used the existing visual fixture with the actual RobotFace
and CharacterProp source, bundled offline with mocked voice/camera/robot services.
A distinct review bundle identifier avoided changing the normal app install.
Root signing succeeded; `simctl install` exceeded its 35-second limit. Therefore
the updated native sharpness, frown rendering and motion are **not visually
confirmed**. The owned review simulator was shut down; no physical iPhone was
touched. Evidence: `output/character-expression-review/native-attempt.json`.

The subsequent active-object pass succeeded on a fresh iPhone simulator and on
the iPad simulator. Representative native scenes are now recorded; see
`character-object-choreography-2026-10-28.md`. That supersedes the installation
blocker above, while unrecorded individual poses and human recognition remain
unverified.

## Independent recognition protocol

`node scripts/build-character-expression-review.mjs` prepares a local review at
`output/character-expression-review/recognition.html`. It randomizes twelve
unlabelled key poses: six face-only emotion cases and six complete action cases.
Participants choose an interpretation or “Unklar”; the intended label appears
only after all answers. JSON export contains responses and timings. The source
contains the scoring key, so this is ordinary blinded presentation, not a secure
assessment. The page explicitly does not assess animation.

Browser UI verification advanced from image 1 to image 2 with “Unklar”, then
reloaded to discard that synthetic response. No result was exported and **no
human recognition results have been collected**. The prepared review and its
screenshot must not be presented as a passed recognition study. Recruit people
who have not seen the intended expressions before using recognition rates or
confusion pairs to judge the design.
