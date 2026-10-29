# My LOOI User Guide

This guide covers the public **My LOOI v2.1.151** Android source line.

My LOOI is an unofficial, community-developed Android companion for the LOOI robot. It combines Realtime voice conversation, local memory, multilingual interaction, configurable robot commands, explicit visual look, local-only Camera Attention, appearance options, and safety-bounded BLE control.

## 1. What you need

- A compatible Android phone mounted on or used with the LOOI robot.
- The My LOOI APK.
- Bluetooth enabled.
- An OpenAI API key for Realtime conversation.
- Microphone permission.
- Camera permission when Camera Attention or an explicit visual-look command is used.

The OpenAI API key is entered inside the app and stored with Android SecureStore. Do not put API keys into source files or share them in diagnostics.

## 2. First setup

1. Open **Settings**.
2. Choose the **Interface language**, **Listening language**, and **Response language**. They are independent.
3. Enter and save your **OpenAI API key**.
4. Refresh the available Realtime models and choose a model.
5. Choose a Realtime voice and use the preview button if desired. You can also choose the independent **Speech grammatical gender** used when LOOI refers to itself in Russian/Ukrainian.
6. In **Robot**, scan for your LOOI and save/connect it.
7. Optionally configure the robot name, command aliases, natural motion, Camera Attention, appearance, backup folder, and custom phrases.

The interface, listening, and response languages support **German, Ukrainian, English and Russian**.

For German, select **DE · Deutsch** as the interface language and **DE** for both listening and responses. These choices persist independently. During a conversation, say **„Sprich ab jetzt Deutsch mit mir“** to switch the conversation to German, or **„Antworte auf Deutsch“** to change only the reply language. A request such as **„Übersetze das ins Deutsche“** remains a one-off translation.

## 3. OpenAI API status and billing

**Settings → OpenAI** shows the last known API state next to the saved key. My LOOI can report states such as a valid key, a successfully working Realtime session, rejected credentials, or exhausted prepaid credits.

A normal project API key does not expose the exact prepaid dollar balance to the app. Use **Open OpenAI Billing** in Settings to view the authoritative balance and add credits. If OpenAI returns `credit_balance_exhausted`, My LOOI also shows a visible error on the main face instead of silently appearing unresponsive.

## 4. Normal conversation

The primary conversation mode is **Realtime PCM**. My LOOI owns microphone capture and playback directly and supports natural interruption: if you start speaking while the assistant is talking, playback can be interrupted and the unheard portion of the reply is truncated from conversation state.

**Settings → Conversation → Budget · cloud voice** offers a separate, turn-based alternative: local Whisper recognizes your speech, GPT-6 Luna generates a short text reply, and GPT-4o mini TTS speaks it using your selected cloud voice and robot style. Microphone audio stays on the device; the text conversation and relevant local memories are supplied to the text model. The microphone is released while generating and speaking a reply. Tap the face to interrupt and listen again. Text-model and generated-speech charges still apply; there is no fixed per-minute price or automatic fallback to a more expensive mode.

Budget supports conversation, personal memory, head nods, sleep, and STOP while listening. Photos, wheel movement, turns, dancing and shared rituals require Realtime. Wheel commands are refused because this turn-based path cannot keep the local voice STOP recognizer listening throughout playback.

This Budget backend is experimental: OpenAI has announced the shutdown of GPT-4o mini TTS on **January 6, 2027**. Realtime remains selectable and existing mode choices are preserved. See the [official shutdown schedule](https://developers.openai.com/api/docs/deprecations) and [current model pricing](https://developers.openai.com/api/docs/pricing).

You can talk naturally, ask follow-up questions, request translations or pronunciation, and ask the assistant to switch the default response language. Ordinary conversation does not require saying the robot name first.

In **Apps → With AI**, **Let AI use apps** lets LOOI search the shared Reachy Mini and MicroDuck catalog and choose an app for your current request during Realtime conversation. You can ask it to find a suitable app without knowing its name. A Python app installs automatically on your connected companion at first use; stopping it keeps the installation for next time. Web apps open their original interface. The With AI page shows the current app and a stop control; connection settings and the full catalog are reachable from the same page. Public apps with the supported Hub tags appear on the next catalog refresh; the cache lasts one minute. In **My apps → Uninstall**, stop a running app first, then confirm removal of its installation and files in that folder. It remains in the public catalog and can be installed again when needed.

With active Companion behavior in Realtime, correct a misunderstood reference
directly: “No, I meant the blue box” or “Nein, ich meinte die blaue Schachtel”.
The app replaces a preliminary reply with one requested after the correction
reaches the local conversation state. LOOI may still need to clarify which
object you mean.

With active Companion behavior in Realtime, German conversation markers also
manage the local task state: **„Lass gut sein“** closes the current task or
number game. **„Lass uns später weitermachen“** pauses an ordinary task and
keeps its last confirmed step; **„Ich bin wieder da“** resumes it. The combined
**„Lass gut sein, wir machen später weiter“** also pauses the task. A shared
object trial still needs its existing named resume request and confirmation.
Quoted examples, questions and negated phrases do not trigger these changes.

During the number game, **„Warte kurz“** pauses the round itself. A number spoken
while it is paused does not use an attempt. **„Weiter“** or **„Ich bin wieder da“**
continues the same round with its remaining attempts; an unrelated paused task
is kept separately. The existing five-minute idle limit also applies to a game
pause. Backgrounding or robot motion also pauses the round; returning to the
foreground or ending motion alone does not resume it. Local STOP ends an active
or paused round. **Stop game** in Companion settings can end a paused round.

The default **Cute robot voice** preset uses Shimmer with a sweet, gentle, playful delivery and a subtle synthetic cadence. Select it in **Settings → LOOI voice** to restore this preset. Voice previews use the selected speaking style and speed; saved changes apply to the next conversation.

### Speech grammatical gender

In **Settings → LOOI voice**, choose **Masculine** or **Feminine** grammatical self-reference independently from the OpenAI voice and visual character. This mainly affects languages such as Russian and Ukrainian: for example, LOOI can say `я увидел` / `я побачив` or `я увидела` / `я побачила`. This setting describes LOOI's own speech only; it does not infer the human user's gender.

## 5. Robot name and addressing

The robot has a configurable **primary spoken name**. You can also add normal address aliases and narrower speech-recognition aliases in **Settings → Voice Commands**.

Common built-in robot addresses include **LOOI / Луи / Луї / Макс / Max / Robot / Робот**. Configured aliases are names of the robot, not names of the human user.

German speech also recognizes **Louis / Louie** as robot addresses, for example **„Louis, fahr vorwärts“**, **„Louis, dreh dich nach links“** and **„Louis, schau mal“**. **„Stopp“** stops movement without a robot address.

For safety, deterministic physical commands normally require the robot address at the beginning of the utterance. Emergency STOP is the exception.

## 6. Built-in physical voice commands

Representative examples include:

| Action | Russian | Ukrainian | English |
| --- | --- | --- | --- |
| Emergency stop | `Стоп`, `Луи, остановись` | `Стоп`, `Луї, зупинись` | `Stop`, `LOOI, halt` |
| Forward | `Луи, вперёд` | `Луї, вперед` | `LOOI, forward` |
| Backward | `Луи, назад` | `Луї, назад` | `LOOI, backward` |
| Left | `Луи, поверни налево` | `Луї, поверни вліво` | `LOOI, turn left` |
| Right | `Луи, поверни направо` | `Луї, поверни вправо` | `LOOI, turn right` |
| Turn around | `Луи, развернись` | `Луї, розвернись` | `LOOI, turn around` |
| Nod | `Луи, кивни` | `Луї, кивни` | `LOOI, nod` |
| Dance | `Луи, потанцуй` | `Луї, потанцюй` | `LOOI, dance` |
| Sleep | `Луи, иди спать` | `Луї, іди спати` | `LOOI, go to sleep` |

**`Стоп` / `Stop` is a universal safety command and does not require the robot name.** Movement remains bounded by the existing BLE/deadman/cliff safety path.

## 7. Custom voice phrases

Open **Settings → Voice Commands → Custom phrases**. The section is collapsed by default and shows the configured phrase count.

Custom phrases can be tagged as **UK**, **EN**, or **RU**. Physical actions still route through the same deterministic parser and protected executor. The phrase tester checks parsing only and does not move the robot or take a photograph.

The visual action **Look here / see this** can also have custom language-tagged phrases. Like the built-in visual action, it still requires an explicit robot address.

## 8. Explicit visual look

You can explicitly show LOOI a page, package, label, object, diagram, or other visual content and continue discussing it by voice.

Examples:

- `Луи, посмотри сюда.`
- `Бобик, смотри, что я показываю.`
- `Луи, посмотри на эту страницу.`
- `Бобик, прочитай, что здесь написано.`
- `LOOI, look at this.`

A visual request must start with the robot name or an accepted robot alias. Broad unaddressed phrases such as just `смотри` do not trigger cloud image capture.

### Front and rear camera

The **front camera is the default** because it points toward the person interacting with a phone mounted on LOOI.

For fine text or a document that is easier to aim with the main phone camera, explicitly request the rear camera, for example:

- `Бобик, посмотри задней камерой.`
- `Луи, сфотографируй это задней камерой.`
- `LOOI, look at this with the rear camera.`

My LOOI selects a suitable rear camera through Android Camera2 instead of relying on a hard-coded camera ID. It prefers a normal autofocus-capable rear camera when the device exposes several rear sensors.

### Image quality and light

Explicit-look capture uses a higher-resolution JPEG than the local Camera Attention analysis stream. The app lets Camera2 auto-exposure and auto-white-balance settle before a newly opened camera takes the still. Rear-camera capture may use automatic flash when the selected camera reports flash capability.

Diagnostic metadata can include the camera side, image dimensions, AF/AE/AWB state, exposure time, ISO and a low-light hint. The image bytes themselves are not written to diagnostics.

For tiny packaging text, use the rear camera when practical, fill a useful part of the frame, avoid glare, and provide enough light. If the visible text is genuinely unreadable, LOOI should say so rather than inventing it.

### Privacy of explicit visual look

The still is captured in memory and sent to the **current OpenAI Realtime conversation** only after an explicit addressed visual request. My LOOI does not write the snapshot to its own photo files or diagnostic archive. The newest image remains conversation context for follow-up questions until the conversation context changes.

### Local object following on iOS

With a current native iOS build, enable Camera Attention and allow camera access.
On the face screen, tap the viewfinder beside the photo control. Drag a box
around one object, tap a small area, or use **Choose the center area**. The
selection window lasts 15 seconds; an accepted selection is followed for at most
10 seconds. Only the screen eyes follow the selected image region. Actual user
speech takes priority over that gaze.

The preview holds the loaded frame while you draw, so the box stays on that
image. If it becomes too old, wait for the live view and select again; tapping
or choosing the center avoids a long drag. A tracking-start failure has a
separate retry message, and the normal end of the 10-second window is shown as
following ended.

This local mode reuses the existing front camera. Its preview and tracking frames
are neither uploaded nor saved, and the preview cache is disabled. Cancel, Stop,
backgrounding, leaving the face screen, turning Camera Attention off, robot
motion, or a camera handoff ends the attempt. If tracking becomes uncertain,
choose the object again; it does not automatically reacquire a target.

The tracker follows a selected 2D region, not a verified object identity. Similar
objects, occlusion, lighting and camera motion still need real-device evaluation.
No physical pointing or driving is added by this feature. Requested cloud image
discussion remains the separate explicit visual-look action above.

### Shared object trials

In an active Realtime conversation with Companion behavior enabled, name an
existing confirmed shared episode, for example: **“Let's prepare a trial with
Gerda.”** Confirm LOOI's question to begin. Report what you checked and what is
ready; LOOI repeats a short exact excerpt for confirmation before recording
each step. Checking comes before preparation.

The existing explicitly requested visual comparison and agreed voice or palm
signal still govern the countdown. It does not prove the object actually moved.
After the signal, report what happened and confirm the result, including an
unsuccessful result if appropriate. The activity never launches the object.

Pause or STOP keeps confirmed steps while discarding unanswered questions and
start permission. Name the episode and ask to resume, then confirm the question.
After an interruption, a new start signal is required before reporting a result.
The local task expires after one day and restores paused; it stores confirmed
text, not images. Forgetting the episode also removes its task. A result is not
automatically added as another permanent shared memory.

### Choose a personal ritual for a shared memory

Name a confirmed shared episode and choose a small gesture, for example:
**“For Gerda, use a nod and say Mission Gerda!”** The optional phrase must be
your exact wording. Confirm LOOI's question to save the choice. A clear No after
that question keeps the ritual silent.

On a later explicit recall of Gerda, LOOI may use the chosen phrase once and the
gesture after that answer has actually been heard. This does not start a new
conversation or create a reminder. Each episode allows at most one offered
ritual in 24 hours, including an attempt interrupted before it finishes. This
pause survives a restart.

Say No, or a clear refusal such as “No, stop it”, immediately after a heard
ritual to keep it silent, or ask explicitly to
disable Gerda's ritual. **Settings → Companion behavior → Shared experiences**
also offers **Turn off ritual** without deleting the memory. Turning it off
ends and clears the current conversation so an old answer cannot replay the
previous ritual. To choose another ritual later, name the memory and confirm a
new choice. This personal habit is separate from the single voice/palm start
signal used for a shared object trial.

### Choose photos from Android Photo Picker

Tap the small **photo/gallery icon** on LOOI's face to open Android Photo Picker. You can choose **up to four** existing images. Android grants My LOOI scoped access only to the photos you explicitly select; My LOOI does not request permission to browse the whole gallery. My LOOI reads those selected images immediately after the picker returns and may temporarily persist the scoped read grant for those exact selections when Android/provider support is available; the grant is released when the photos have been prepared and sent into the discussion.

After you return, the selected images are added to the current Realtime discussion in selection order as photo 1, photo 2, and so on. You can then continue naturally by voice, for example: `what is on the first photo?`, `compare the first and second`, or `read the text on the second photo`.

Opening the system picker temporarily backgrounds My LOOI. Sensitive microphone/BLE/Realtime runtime is still suspended while the picker is open, but the app uses an explicit external-activity lease so the normal five-second background process kill does not terminate the selection flow. When My LOOI returns, it reseeds a bounded recent text transcript and then adds the selected photos before continuing the discussion.

Selected photos are temporary conversation context. They are converted in memory for Realtime, are not copied into durable My LOOI storage, are not added to diagnostics, and are not written into long-term memory automatically.

## 9. Sleep and wake

An addressed sleep command puts LOOI into the app sleep state with a visibly sleeping face. Manual wake uses a **single tap on the face**.

## 10. Natural motion

In **Settings → Robot → Natural motion**, choose Off, Subtle, Normal, or Lively. Actual human speech and explicit commands take priority. Ambient body motion stays small and safety-bounded.

## 11. Camera Attention

**Camera Attention** is optional and off by default. During an active interaction it can detect a visible face locally, direct the on-screen eyes toward it, make bounded head/body recentering corrections, and perform a finite search when appropriate.

Camera Attention is not permanent surveillance and does not autonomously drive forward toward a person. Its face-analysis frames remain local in memory and are not uploaded by My LOOI. This is separate from the explicit user-requested visual still described above.

## 12. Face appearance

Open **Settings → Appearance** to choose a face style and color palette independently. Current styles include Classic, Soft, Playful, Cap, Cowboy, Bandana and Sharp.


## 13. Memory and history

Conversation history and durable extracted facts are stored locally in SQLite. Realtime sessions can preload bounded relevant memory and use targeted local search for deeper recall. My LOOI does not require a companion backend for normal operation.

For an open retrospective in Realtime, ask **“What have we experienced together?”**
or **„Was haben wir zusammen erlebt?“** LOOI can retrieve all confirmed saved
shared experiences and give a short overview before you choose one to revisit.
This collection contains saved memories, not every event that happened. An
empty collection means no shared experience has been confirmed and saved yet.
The overview does not start a ritual or change a memory.

In Realtime, you can also ask about a confirmed shared experience by description, for example
**“Do you remember our paper rocket?”**, without knowing its saved title.
LOOI can look for matching saved experiences and answer from their confirmed
details under the saved name. If several experiences fit, it can ask which one
you mean. A matching memory does not identify a current camera object, start a
ritual, or change the saved experience.

The local Companion store holds up to eight confirmed shared experiences. If
it is full, a new proposal is rejected and the existing experiences stay saved.
LOOI should explain that the new experience was not saved. You can choose a
specific existing experience to forget through its normal confirmation flow,
then propose the new one again; a plain “yes” after a full-store rejection
does not replace anything.

To correct one saved shared-experience fact in Realtime, name it and give the
complete new wording, for example **“Korrektur zu Gerda: Sie landete neben dem
Baum.”** LOOI asks whether to replace that description or outcome. Only a clear
Yes after the full confirmation question saves the correction. No, a different
topic or an interrupted confirmation keeps the old fact. The saved name,
personal ritual and confirmed activity steps remain attached to the same
experience; the correction records its own source.
An ongoing shared object trial pauses during a correction and keeps its
confirmed steps. Confirming the memory does not resume the trial or confirm an
unfinished trial step.

Open **Memory** to search the saved facts and filter by category. Each fact shows
its recorded source, origin and time. **Edit** changes the selected fact; **Delete**
asks for confirmation and removes it individually. Save or cancel an edit before
changing filters. Corrections and deletion end the active conversation so its
cached context cannot keep using an old fact. Start a new conversation afterward.
Changes affect new memory searches and new backups; conversation history and
previously exported backup files remain separate. A source session is provenance,
not a guarantee that an extracted fact is correct or belongs to a known person.

From **Conversations**, open **Web research** for a current question with sources.
Enter the question and choose **Search the web** after reviewing the cost notice.
This uses your saved OpenAI key for a separate Responses/Web Search request and
does not send your conversation or memories. Click an inline citation or source
to check it. Cancel or leave the page to stop the local request. Model/tool access
depends on your OpenAI account; a successful Realtime session does not establish
Web Search access. No search answer is automatically saved as a personal fact.

For longer requests, open **Agent tasks** from Conversations. Enter your own
HTTPS service URL and its LOOI access token, then choose **Save and verify
connection**. This is separate from your OpenAI key. Enter a task and explicitly
start it; you can return later to check status and expand its answer and sources.
Load older tasks to browse earlier results. Cancel requests the server to stop;
delete is available for terminal tasks. Leaving the page or disconnecting does
not cancel server work. If sending had an unknown outcome, retry the same task
to reuse its saved ID. Only entered task text is sent as user content, and the
server retains that text and results. [Setup and limits](docs/hermes-agent.md).

Once connected, you can also explicitly ask LOOI in a Realtime conversation to
prepare a plan or research a question in the background, and later ask about the
task or its result. The spoken request is sent as task text. If the connection
fails during submission, ask about the pending task before requesting a retry;
the retry uses the same saved task identity. LOOI does not announce completion
automatically.

Adaptive behavior starts in Active mode if no preference has been saved. You can
change it under **Settings → Robot → Adaptive behavior**. Active and Observe use
the configured OpenAI key for additional requests and usage. Camera assessment
and curiosity have separate controls. A previous Off or Observe choice is kept.

## 14. Backup and restore

Open **Settings → Advanced → Memory and backup**, then select a folder through Android's system document picker. You can create a backup, restore it, or forget/change the selected folder.

## 15. Diagnostics

Open **Settings → Advanced → Diagnostics** to share a diagnostic ZIP, choose a persistent SAF folder and save diagnostics there, or clear diagnostic events.

Normal diagnostics do not retain microphone WAV recordings or visual-look image bytes. When reporting a reproducible problem, export diagnostics immediately after the test.

## 16. Updates

My LOOI can check GitHub Releases from **Settings → Updates**, verify the expected package/version/checksum/signing identity, and hand the APK to Android's installer.

## 17. Privacy summary

- OpenAI Realtime audio is sent to OpenAI only while a Realtime conversation is active.
- The OpenAI API key is stored in Android SecureStore.
- Conversation history and durable memory are local by default.
- Backgrounding the app or turning the screen off triggers a hard sensitive-runtime suspend.
- Camera Attention face-analysis frames remain local-only.
- An explicit visual-look still is sent only after an addressed user request and is not stored by My LOOI as a photo or diagnostic payload.
- Diagnostic export is manual and user-triggered.

See `PRIVACY.md` for the detailed privacy policy.

## 18. Safety summary

- Say **`Стоп` / `Stop`** at any time for the emergency STOP path.
- Address ordinary physical commands explicitly.
- Movement remains bounded and protected by BLE/deadman/cliff checks.
- Explicit visual look does not grant the LLM unrestricted movement control.
- Camera Attention never adds autonomous forward/backward person-following.
- The custom-phrase test checks parsing only and never moves the robot or captures an image.

---

My LOOI is community-developed and is not affiliated with or endorsed by the LOOI robot manufacturer.

## Performance diagnostics

Diagnostic ZIP exports include performance/memory snapshots and previous Android process-exit reasons when supported. This is intended to help diagnose freezes, ANRs and low-memory kills even when ADB is unavailable.
