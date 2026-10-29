import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const { createBehaviorCompanion } = loadTypeScript("src/behavior/behavior-companion.ts", {
  "../character/companion-personality": loadTypeScript("src/character/companion-personality.ts"),
  "./behavior-episode-search": loadTypeScript("src/behavior/behavior-episode-search.ts"),
});
let clock = 10_000;
const makeCompanion = () => createBehaviorCompanion({ now: () => clock });
const makeProposal = (companion, userText, overrides = {}) => {
  companion.userTurn(userText);
  const action = {
    type: "propose_experience",
    title: "Gerda",
    detail: "We repaired the paper rocket together.",
    outcome: "The rocket finally flew.",
    motif: "happy_bob",
    evidence: "Gerda finally flew",
    ...overrides,
  };
  const result = companion.act(action, { userText, sessionId: "session-1" });
  if (result.ok) companion.assistantEnd(`Should I remember ${action.title}?`);
  return result;
};

// Exact current-turn evidence and explicit confirmation are required to save.
const companion = makeCompanion();
const initialProposal = makeProposal(companion, "Gerda finally flew today.");
assert.equal(initialProposal.ok, true);
assert.match(initialProposal.instruction, /current conversation language.*“Gerda” exactly.*question mark/u);
assert.equal(companion.snapshot().episodes.length, 0, "a proposal is not a saved episode");
assert.equal(companion.snapshot().pendingExperience.kind, "create");
assert.ok(companion.snapshot().pendingExperience.askedAt !== null, "a title-specific spoken confirmation question arms the next-turn confirmation");
assert.equal(companion.userTurn("maybe later").motif, undefined);
assert.equal(companion.snapshot().episodes.length, 0, "an ambiguous next turn expires the proposal");
assert.equal(companion.snapshot().pendingExperience, null);

assert.equal(makeProposal(companion, "Gerda finally flew today.").ok, true);
const confirmation = companion.userTurn("Yes, please.");
assert.deepEqual(confirmation, {}, "a plain confirmation does not claim the episode succeeded now");
const episode = companion.snapshot().episodes[0];
assert.equal(episode.title, "Gerda");
assert.equal(episode.source.evidence, "Gerda finally flew", "provenance preserves the exact user excerpt");
assert.equal(episode.source.sessionId, "session-1");
assert.equal(episode.source.at, 10_000);
assert.equal(episode.createdAt, 10_000);
assert.equal(episode.updatedAt, 10_000);
assert.equal(episode.lastUsedAt, null);
assert.ok(episode.id.startsWith("ep_"));

const germanConfirmation = makeCompanion();
makeProposal(germanConfirmation, "Gerda finally flew today.");
germanConfirmation.userTurn("Ja, mach das.");
assert.equal(germanConfirmation.snapshot().episodes.length, 1, "a clear German affirmative confirms the proposal");
assert.deepEqual(germanConfirmation.userTurn("Gerda steht endlich!"), { motif: "happy_bob" }, "the German outcome order ‘steht endlich’ can trigger the saved motif");
const quotedConfirmation = makeCompanion();
makeProposal(quotedConfirmation, "Gerda finally flew today.");
quotedConfirmation.userTurn('"Yes"');
assert.equal(quotedConfirmation.snapshot().episodes.length, 0, "quoted affirmatives do not confirm a proposal");
const unheardQuestion = makeCompanion();
unheardQuestion.userTurn("Gerda finally flew today.");
unheardQuestion.act({ type: "propose_experience", title: "Gerda", detail: "We repaired it.", outcome: "It flew.", motif: "happy_bob", evidence: "Gerda finally flew" }, { userText: "Gerda finally flew today.", sessionId: "s" });
unheardQuestion.assistantEnd("Do you want me to save that?");
unheardQuestion.userTurn("Yes, please.");
assert.equal(unheardQuestion.snapshot().episodes.length, 0, "a generic or unheard title-free question cannot authorize saving");
const unaskedQuestion = makeCompanion();
unaskedQuestion.userTurn("Gerda finally flew today.");
unaskedQuestion.act({ type: "propose_experience", title: "Gerda", detail: "We repaired it.", outcome: "It flew.", motif: "happy_bob", evidence: "Gerda finally flew" }, { userText: "Gerda finally flew today.", sessionId: "s" });
unaskedQuestion.assistantEnd("Should I remember Gerda");
unaskedQuestion.userTurn("Yes.");
assert.equal(unaskedQuestion.snapshot().episodes.length, 0, "a title without a spoken question mark does not authorize saving");
const ttl = makeCompanion();
makeProposal(ttl, "Gerda finally flew today.");
clock += 120_000;
ttl.userTurn("Yes.");
assert.equal(ttl.snapshot().episodes.length, 0, "a stale proposal expires before a later affirmative turn");

// A model cannot invent or paraphrase provenance, and stale source turns fail closed.
assert.equal(makeProposal(companion, "Gerda finally flew!", { evidence: "the rocket flew" }).status, "missing_evidence");
companion.userTurn("A newer user turn");
assert.equal(companion.act({ type: "propose_experience", title: "X", detail: "Y", outcome: "Z", motif: "nod", evidence: "Gerda" }, { userText: "Gerda finally flew!", sessionId: "session-1" }).status, "stale-turn");

// Retrieval needs one unambiguous saved title in the current user turn.
const retrieve = "Tell me what happened with Gerda.";
companion.userTurn(retrieve);
const recalled = companion.act({ type: "recall_experience", id: episode.id }, { userText: retrieve, sessionId: "session-1" });
assert.equal(recalled.status, "recalled");
assert.equal(recalled.motif, "happy_bob");
assert.match(recalled.instruction, /Do not invent a new event or outcome/u);
assert.equal(companion.snapshot().episodes[0].lastUsedAt, null, "recall alone does not consume cooldown or claim an emitted motif");
assert.equal(companion.reserveMotif(recalled.motif), true, "the caller reserves the cooldown at cue emission");
assert.equal(companion.snapshot().episodes[0].lastUsedAt, clock);
assert.equal(companion.reserveMotif("happy_bob"), false, "only one motif can be reserved during cooldown");
const serializedWithCooldown = companion.serialize();
const restoredCooldown = makeCompanion();
restoredCooldown.restore(serializedWithCooldown);
const restoredRecall = "Tell me about Gerda.";
restoredCooldown.userTurn(restoredRecall);
assert.equal(restoredCooldown.act({ type: "recall_experience", id: episode.id }, { userText: restoredRecall, sessionId: "session-1" }).status, "motif_cooldown", "the cooldown survives restore through lastUsedAt");
companion.cancel();
companion.userTurn(retrieve);
assert.equal(companion.act({ type: "recall_experience", id: episode.id }, { userText: retrieve, sessionId: "session-1" }).status, "motif_cooldown", "cancel cannot reset the session's motif cooldown");

const unrelated = "What did we do together?";
companion.userTurn(unrelated);
assert.equal(companion.act({ type: "recall_experience", id: episode.id }, { userText: unrelated, sessionId: "session-1" }).status, "reference_not_named");
const partial = "Gerda-2 was fun";
companion.userTurn(partial);
assert.equal(companion.act({ type: "recall_experience", id: episode.id }, { userText: partial, sessionId: "session-1" }).status, "reference_not_named", "titles must not match inside a longer token");

// Positive movement follows an explicit user report and a uniquely named episode.
clock += 60_001;
const positive = "Gerda finally flew, it worked!";
assert.deepEqual(companion.userTurn(positive), { motif: "happy_bob" });
assert.equal(companion.reserveMotif("happy_bob"), true);
assert.deepEqual(companion.userTurn("Gerda did not work."), {}, "negated outcomes never trigger a motif");
assert.deepEqual(companion.userTurn("Did Gerda work?"), {}, "questions never trigger a success motif");

// Duplicate titles are refused, and a turn naming multiple distinct episodes is ambiguous.
const duplicate = makeCompanion();
makeProposal(duplicate, "Gerda finally flew.");
duplicate.userTurn("Yes.");
clock += 1;
assert.equal(makeProposal(duplicate, "Gerda flew again.", { evidence: "Gerda flew again", detail: "We tried another launch." }).status, "title_exists");
makeProposal(duplicate, "Rocket flew today.", { title: "Rocket", evidence: "Rocket flew today", detail: "We launched it again." });
duplicate.userTurn("Yes.");
const ambiguous = "Tell me about Gerda and Rocket.";
duplicate.userTurn(ambiguous);
assert.equal(duplicate.act({ type: "recall_experience", id: duplicate.snapshot().episodes[0].id }, { userText: ambiguous, sessionId: "session-1" }).status, "ambiguous_reference");
assert.ok(JSON.stringify(duplicate.context(ambiguous)).length <= 2_400, "the compact context fits its prompt budget without slicing JSON");
const forgetWrongTitle = "Please forget Gerda.";
duplicate.userTurn(forgetWrongTitle);
assert.equal(duplicate.act({ type: "forget_experience", id: duplicate.snapshot().episodes[1].id }, { userText: forgetWrongTitle, sessionId: "session-1" }).status, "reference_not_named", "forget actions cannot target an unrelated id");

// Forget actions require confirmation; direct forget is reserved for an explicit routed user command.
const forgetId = companion.snapshot().episodes[0].id;
const forgetTurn = "Please forget Gerda.";
companion.userTurn(forgetTurn);
assert.equal(companion.act({ type: "forget_experience", id: forgetId }, { userText: forgetTurn, sessionId: "session-1" }).status, "forget_pending");
assert.equal(companion.snapshot().episodes.length, 1, "forget proposal leaves the episode intact");
companion.assistantEnd("Should I forget Gerda?");
companion.userTurn("No.");
assert.equal(companion.snapshot().episodes.length, 1, "negative confirmation keeps the episode");
assert.equal(companion.forget(forgetId), true);
assert.equal(companion.snapshot().episodes.length, 0);

// Visual curiosity is one-shot, short-lived, and has no path to image persistence.
const curious = makeCompanion();
const visualTurn = "What do you see in this picture?";
curious.userTurn(visualTurn);
assert.equal(curious.act({ type: "offer_interest", topic: "paper rocket", question: "Where should it fly?" }, { userText: visualTurn, sessionId: "s" }).status, "visual_not_authorized");
curious.visual("Look at the paper rocket.");
const offered = curious.act({ type: "offer_interest", topic: "paper rocket", question: "Where should it fly?" }, { userText: visualTurn, sessionId: "s" });
assert.equal(offered.status, "interest_offered");
assert.match(offered.instruction, /Speak this exact question once, without rephrasing: “Where should it fly\?”/u);
assert.match(curious.context().companion.instruction, /interest\.question exactly once, verbatim/u);
assert.equal(curious.snapshot().interest.status, "ready");
assert.equal(curious.snapshot().visualGrant.used, true);
assert.equal(curious.act({ type: "offer_interest", topic: "paper rocket", question: "Who made it?" }, { userText: visualTurn, sessionId: "s" }).status, "visual_already_used");
curious.assistantEnd("Where should it fly?");
assert.equal(curious.snapshot().interest.status, "waiting");
clock += 20_000;
curious.tick();
assert.equal(curious.snapshot().interest.status, "closed", "silence closes the one question without speaking from a timer");
assert.equal(curious.context().companion.interest, null);

const answered = makeCompanion();
answered.userTurn(visualTurn);
answered.visual("Look at the paper rocket.");
answered.act({ type: "offer_interest", topic: "paper rocket", question: "Where should it fly?" }, { userText: visualTurn, sessionId: "s" });
answered.assistantEnd("Where should it fly?");
answered.userTurn("To the moon!");
assert.equal(answered.snapshot().interest.status, "answered");
answered.assistantEnd("Let's send it to the moon.");
assert.equal(answered.snapshot().interest.status, "closed", "the next assistant completion closes an answered interest");

const unheardInterest = makeCompanion();
unheardInterest.userTurn(visualTurn);
unheardInterest.visual("Look at the paper rocket.");
unheardInterest.act({ type: "offer_interest", topic: "paper rocket", question: "Where should it fly?" }, { userText: visualTurn, sessionId: "s" });
unheardInterest.assistantEnd("I was curious about the rocket.");
assert.equal(unheardInterest.snapshot().interest.status, "closed", "a missing spoken question closes the interest instead of entering the wait state");

const normalizedInterest = makeCompanion();
normalizedInterest.userTurn(visualTurn);
normalizedInterest.visual("Look at the paper rocket.");
normalizedInterest.act({ type: "offer_interest", topic: "paper rocket", question: "Where should it fly?" }, { userText: visualTurn, sessionId: "s" });
normalizedInterest.assistantEnd("WHERE   SHOULD IT FLY?");
assert.equal(normalizedInterest.snapshot().interest.status, "waiting", "question matching tolerates case and whitespace differences");

const repeatedInterest = makeCompanion();
repeatedInterest.userTurn(visualTurn);
repeatedInterest.visual("Look at the paper rocket.");
repeatedInterest.act({ type: "offer_interest", topic: "paper rocket", question: "Where should it fly?" }, { userText: visualTurn, sessionId: "s" });
repeatedInterest.assistantEnd("Where should it fly? Where should it fly?");
assert.equal(repeatedInterest.snapshot().interest.status, "closed", "a repeated offered question does not start an answer wait");

const expiring = makeCompanion();
expiring.userTurn(visualTurn);
expiring.visual("Look at the paper rocket.");
clock += 60_000;
assert.equal(expiring.act({ type: "offer_interest", topic: "rocket", question: "Where should it fly?" }, { userText: visualTurn, sessionId: "s" }).status, "visual_not_authorized", "expired visual grants are removed before the action is evaluated");
assert.equal(expiring.snapshot().visualGrant, null);

// Persistence contains durable episodes and character, never pending actions or images.
const saved = duplicate.serialize();
assert.deepEqual(Object.keys(saved).sort(), ["episodes", "life", "version"]);
assert.equal(saved.life.core, "gentle-curious");
assert.equal(saved.life.days.length, 0, "ordinary episode persistence does not invent relationship history");
const restored = makeCompanion();
restored.userTurn("a pending thing");
restored.act({ type: "propose_experience", title: "Maybe", detail: "d", outcome: "o", motif: "nod", evidence: "pending" }, { userText: "a pending thing", sessionId: "s" });
restored.visual("an image");
restored.act({ type: "offer_interest", topic: "object", question: "What should we do with it?" }, { userText: "a pending thing", sessionId: "s" });
restored.assistantEnd("What should we do with it?");
assert.equal(restored.snapshot().interest.status, "waiting");
restored.restore(saved);
assert.equal(restored.snapshot().episodes.length, 2);
assert.equal(restored.snapshot().pendingExperience, null);
assert.equal(restored.snapshot().visualGrant, null);
assert.equal(restored.snapshot().interest, null);
restored.cancel();
assert.equal(restored.snapshot().episodes.length, 2, "cancel clears ephemeral state, not episodes");

const compact = makeCompanion();
makeProposal(compact, "Rocket A finally flew.", { title: "Rocket A", evidence: "Rocket A finally flew" });
compact.userTurn("Yes.");
makeProposal(compact, "Rocket B finally flew.", { title: "Rocket B", evidence: "Rocket B finally flew" });
compact.userTurn("Yes.");
const currentCompactTurn = "Please remember Rocket C now.";
compact.userTurn(currentCompactTurn);
compact.act({ type: "propose_experience", title: "Rocket C", detail: "A detailed event that can be compacted safely.", outcome: "It worked well and ended successfully.", motif: "curious", evidence: "Please remember Rocket C now" }, { userText: currentCompactTurn, sessionId: "session-c" });
compact.assistantEnd("Should I remember Rocket C?");
compact.visual("Inspect the paper model and its markings.");
compact.act({ type: "offer_interest", topic: "paper model", question: "Where should it go next?" }, { userText: currentCompactTurn, sessionId: "session-c" });
const compactContext = compact.context(currentCompactTurn);
assert.equal(compactContext.companion.episodes.length, 2);
assert.ok(compactContext.companion.pendingConfirmation);
assert.ok(compactContext.companion.interest);
assert.ok(JSON.stringify(compactContext).length <= 2_400, "episodes, pending confirmation, and current interest all fit without cutting JSON");

// The 2030 shared-scene flow stores only a confirmed text baseline, then asks
// before accepting a visual comparison and arms only a named, explicit signal.
const shared = makeCompanion();
const originTurn = "We built Gerda together, and the paper rocket fell over.";
shared.userTurn(originTurn);
assert.equal(shared.act({ type: "propose_experience", title: "Gerda", detail: "We built a paper rocket together.", outcome: "It fell over.", motif: "happy_bob", evidence: "We built Gerda together" }, { userText: originTurn, sessionId: "scene-session" }).status, "proposed");
shared.assistantEnd("Should I remember Gerda?");
shared.userTurn("Yes.");
const sharedEpisodeId = shared.snapshot().episodes[0].id;
const secondEpisodeTurn = "We built Rocket together, and it stayed upright.";
shared.userTurn(secondEpisodeTurn);
shared.act({ type: "propose_experience", title: "Rocket", detail: "We built another paper model.", outcome: "It stayed upright.", motif: "nod", evidence: "We built Rocket together" }, { userText: secondEpisodeTurn, sessionId: "scene-session" });
shared.assistantEnd("Should I remember Rocket?");
shared.userTurn("Yes.");

const baselineTurn = "Look at Gerda and remember its red paper body and narrow base.";
shared.userTurn(baselineTurn);
shared.visual(baselineTurn);
const baselineDescription = "A red paper rocket with a narrow base.";
const baselineProposal = shared.act({ type: "propose_visual_memory", id: sharedEpisodeId, description: baselineDescription, evidence: baselineTurn }, { userText: baselineTurn, sessionId: "scene-session" });
assert.equal(baselineProposal.status, "visual_memory_pending");
assert.equal(baselineProposal.confirmationQuestion, "Should I remember this description of Gerda: A red paper rocket with a narrow base?");
assert.equal(shared.snapshot().episodes[0].visualMemory, undefined, "a visual proposal is not saved before its heard question and confirmation");
assert.equal(shared.snapshot().pendingExperience.askedAt, null);
shared.userTurn("Yes.");
assert.equal(shared.snapshot().episodes[0].visualMemory, undefined, "an unheard proposal cannot be confirmed");

shared.userTurn(baselineTurn);
shared.visual(baselineTurn);
const unrelatedBaseline = shared.act({ type: "propose_visual_memory", id: sharedEpisodeId, description: baselineDescription, evidence: baselineTurn }, { userText: baselineTurn, sessionId: "scene-session" });
shared.assistantEnd("Gerda is on the table. What should we build next?");
assert.equal(shared.snapshot().pendingExperience.askedAt, null, "an unrelated title mention plus another question is not consent");
shared.userTurn("Yes.");
assert.equal(shared.snapshot().episodes[0].visualMemory, undefined);

shared.userTurn(baselineTurn);
shared.visual(baselineTurn);
const extraQuestionBaseline = shared.act({ type: "propose_visual_memory", id: sharedEpisodeId, description: baselineDescription, evidence: baselineTurn }, { userText: baselineTurn, sessionId: "scene-session" });
shared.assistantEnd(`${extraQuestionBaseline.confirmationQuestion} Shall we eat?`);
assert.equal(shared.snapshot().pendingExperience.askedAt, null, "an exact confirmation followed by another question leaves consent ambiguous");
shared.userTurn("Yes.");
assert.equal(shared.snapshot().episodes[0].visualMemory, undefined);

shared.userTurn(baselineTurn);
shared.visual(baselineTurn);
const localizedBaseline = shared.act({ type: "propose_visual_memory", id: sharedEpisodeId, description: baselineDescription, evidence: baselineTurn }, { userText: baselineTurn, sessionId: "scene-session", language: "de-DE" });
assert.equal(localizedBaseline.status, "visual_memory_pending");
assert.equal(localizedBaseline.confirmationQuestion, "Soll ich mir diese Beschreibung von Gerda merken: A red paper rocket with a narrow base?");
shared.assistantEnd(localizedBaseline.confirmationQuestion);
shared.userTurn("Yes, please.");
const baseline = shared.snapshot().episodes[0].visualMemory;
assert.equal(baseline.description, baselineDescription);
assert.equal(baseline.source.evidence, baselineTurn);
assert.equal(baseline.source.visualTask, baselineTurn);
assert.equal(JSON.stringify(shared.serialize()).includes("data:image"), false, "image payloads are never persisted");

function proposeComparison(match = "different", observedDescription = "A red paper rocket with a wide base.", change = "The base looks wider.", language = "en") {
  const text = "Look at Gerda now and compare it with the previous description.";
  shared.userTurn(text);
  shared.visual(text);
  return { text, result: shared.act({ type: "compare_shared_object", id: sharedEpisodeId, observedDescription, change, match }, { userText: text, sessionId: "scene-session", language }) };
}

const uncertain = proposeComparison("uncertain");
assert.equal(uncertain.result.status, "comparison_uncertain");
assert.equal(shared.snapshot().scene.status, "closed", "uncertain matching cannot open a shared scene");
assert.equal(shared.snapshot().episodes[0].visualMemory.description, baselineDescription, "a comparison hypothesis never overwrites the confirmed baseline");

const sameComparison = proposeComparison("same", baselineDescription, "No visible change.", "uk");
assert.equal(sameComparison.result.status, "comparison_pending", "even a same-object hypothesis requires confirmation");
assert.match(sameComparison.result.confirmationQuestion, /^Це знову Gerda/u);
shared.assistantEnd(`${sameComparison.result.confirmationQuestion} ${sameComparison.result.confirmationQuestion}`);
assert.equal(shared.snapshot().pendingExperience.askedAt, null, "a repeated question is not treated as a single heard consent prompt");
shared.userTurn("Yes.");
assert.equal(shared.snapshot().scene.status, "closed");
assert.equal(shared.snapshot().episodes[0].visualMemory.description, baselineDescription);

const confirmedSameComparison = proposeComparison("same", baselineDescription, "No visible change.", "ru-RU");
assert.match(confirmedSameComparison.result.confirmationQuestion, /^Это снова Gerda/u);
shared.assistantEnd(confirmedSameComparison.result.confirmationQuestion);
shared.userTurn("Yes.");
assert.equal(shared.snapshot().scene.status, "ready");
assert.equal(shared.snapshot().episodes[0].visualMemory.description, baselineDescription);
shared.userTurn("Let's talk about something else.");

const comparison = proposeComparison();
assert.equal(comparison.result.status, "comparison_pending");
assert.equal(shared.snapshot().scene.status, "awaiting_confirmation");
assert.equal(shared.act({ type: "prepare_shared_ritual", id: sharedEpisodeId, signal: "voice", evidence: "Gerda" }, { userText: comparison.text, sessionId: "scene-session" }).status, "scene_not_ready");
shared.assistantEnd("Gerda is on the table. What should we build next?");
assert.equal(shared.snapshot().pendingExperience.askedAt, null, "scene comparison cannot be approved by an unrelated title question");
shared.userTurn("Yes.");
assert.equal(shared.snapshot().scene.status, "closed");
assert.equal(shared.snapshot().episodes[0].visualMemory.description, baselineDescription);

const confirmedComparison = proposeComparison();
shared.assistantEnd(confirmedComparison.result.confirmationQuestion);
shared.userTurn("Yes.");
assert.equal(shared.snapshot().scene.status, "ready", "a heard title-specific confirmation advances the scene");
assert.equal(shared.snapshot().episodes[0].visualMemory.description, "A red paper rocket with a wide base.");

const ambiguousSignalTurn = "For Gerda and Rocket, wait for my open palm.";
shared.userTurn(ambiguousSignalTurn);
assert.equal(shared.act({ type: "prepare_shared_ritual", id: sharedEpisodeId, signal: "open_palm", evidence: ambiguousSignalTurn }, { userText: ambiguousSignalTurn, sessionId: "scene-session" }).status, "ambiguous_reference", "a ritual cannot select one of multiple named saved episodes");
const wrongSignalTurn = "For Gerda, wait for my open palm.";
shared.userTurn(wrongSignalTurn);
assert.equal(shared.act({ type: "prepare_shared_ritual", id: sharedEpisodeId, signal: "voice", evidence: "Gerda" }, { userText: wrongSignalTurn, sessionId: "scene-session" }).status, "signal_not_named", "a title alone cannot arm a ritual or choose its signal");
const vagueHandTurn = "For Gerda, wait for my hand.";
shared.userTurn(vagueHandTurn);
assert.equal(shared.act({ type: "prepare_shared_ritual", id: sharedEpisodeId, signal: "open_palm", evidence: vagueHandTurn }, { userText: vagueHandTurn, sessionId: "scene-session" }).status, "signal_not_named", "a generic hand mention does not select an open-palm signal");
const palmTurn = "For Gerda, wait for my open palm.";
shared.userTurn(palmTurn);
const palmEvidence = "For Gerda, wait for my open palm";
const armed = shared.act({ type: "prepare_shared_ritual", id: sharedEpisodeId, signal: "open_palm", evidence: palmEvidence }, { userText: palmTurn, sessionId: "scene-session" });
assert.equal(armed.status, "ritual_armed");
assert.equal(armed.episodeTitle, "Gerda");
assert.equal(shared.snapshot().scene.status, "armed");
assert.equal(shared.acceptStartSignal("voice"), false, "only the explicitly selected signal can start the scene");
assert.equal(shared.acceptStartSignal("open_palm"), true);
assert.equal(shared.snapshot().scene.startedBy.kind, "open_palm");
assert.equal(shared.acceptStartSignal("open_palm"), false, "the signal is one-shot");
assert.equal(shared.snapshot().scene.status, "started");
shared.userTurn("Let's talk about something else.");
assert.equal(shared.snapshot().scene.status, "closed", "unrelated turns close a started scene");

const beforeVoice = proposeComparison();
shared.assistantEnd(beforeVoice.result.confirmationQuestion);
shared.userTurn("Yes.");
const voiceTurn = "For Gerda, wait until I say start.";
shared.userTurn(voiceTurn);
const voiceArmed = shared.act({ type: "prepare_shared_ritual", id: sharedEpisodeId, signal: "voice", evidence: voiceTurn }, { userText: voiceTurn, sessionId: "scene-session" });
assert.equal(voiceArmed.status, "ritual_armed");
assert.deepEqual(shared.userTurn("Yes."), {}, "a generic English affirmative does not satisfy the requested start word");
assert.equal(shared.snapshot().scene.status, "closed");
function rearmVoiceScene() {
  const recheck = proposeComparison();
  shared.assistantEnd(recheck.result.confirmationQuestion);
  shared.userTurn("Yes.");
  shared.userTurn(voiceTurn);
  return shared.act({ type: "prepare_shared_ritual", id: sharedEpisodeId, signal: "voice", evidence: voiceTurn }, { userText: voiceTurn, sessionId: "scene-session" });
}
assert.equal(rearmVoiceScene().status, "ritual_armed");
assert.deepEqual(shared.userTurn("Ja."), {}, "a generic German affirmative does not satisfy the requested start word");
assert.equal(shared.snapshot().scene.status, "closed");
const voiceArmedForStart = rearmVoiceScene();
assert.equal(voiceArmedForStart.status, "ritual_armed");
const startedByVoice = shared.userTurn("Start");
assert.deepEqual(startedByVoice, { ritualStarted: voiceArmedForStart.sceneId }, "a voice start needs a fresh explicit command and returns its scene id");
assert.equal(shared.snapshot().scene.startedBy.kind, "voice");
shared.cancel();
assert.equal(shared.snapshot().scene.status, "closed", "cancel closes transient scene permission");
assert.equal(shared.snapshot().episodes[0].visualMemory.description, "A red paper rocket with a wide base.", "cancel preserves confirmed text memory");

const beforeLocalizedVoice = proposeComparison();
shared.assistantEnd(beforeLocalizedVoice.result.confirmationQuestion); shared.userTurn("Yes.");
const localizedVoiceTurn = "Für Gerda, warte bis ich старт sage.";
shared.userTurn(localizedVoiceTurn);
assert.equal(shared.act({ type: "prepare_shared_ritual", id: sharedEpisodeId, signal: "voice", evidence: localizedVoiceTurn }, { userText: localizedVoiceTurn, sessionId: "scene-session" }).status, "ritual_armed", "a mixed German/Russian explicit signal setup is recognized");
assert.deepEqual(shared.userTurn("Старт."), { ritualStarted: shared.snapshot().scene.id }, "a conservative Russian start word can activate an armed voice scene once");

const pendingCompare = makeCompanion();
const pendingTurn = "Gerda finally flew today.";
pendingCompare.userTurn(pendingTurn);
pendingCompare.act({ type: "propose_experience", title: "Gerda", detail: "A paper rocket.", outcome: "It flew.", motif: "nod", evidence: pendingTurn }, { userText: pendingTurn, sessionId: "s" });
pendingCompare.assistantEnd("Should I remember Gerda?");
pendingCompare.userTurn("Yes.");
const pendingId = pendingCompare.snapshot().episodes[0].id;
const pendingVisualTurn = "Look at Gerda and remember its red nose.";
pendingCompare.userTurn(pendingVisualTurn); pendingCompare.visual(pendingVisualTurn);
const pendingVisualProposal = pendingCompare.act({ type: "propose_visual_memory", id: pendingId, description: "A red nose.", evidence: pendingVisualTurn }, { userText: pendingVisualTurn, sessionId: "s" });
pendingCompare.assistantEnd(pendingVisualProposal.confirmationQuestion);
pendingCompare.userTurn("Yes.");
const compareText = "Look at Gerda now and compare it with the previous description.";
pendingCompare.userTurn(compareText); pendingCompare.visual(compareText);
const pendingComparison = pendingCompare.act({ type: "compare_shared_object", id: pendingId, observedDescription: "A blue nose.", change: "The nose looks blue.", match: "different" }, { userText: compareText, sessionId: "s" });
pendingCompare.assistantEnd(pendingComparison.confirmationQuestion);
pendingCompare.userTurn("Yes.");
pendingCompare.userTurn(voiceTurn);
pendingCompare.act({ type: "prepare_shared_ritual", id: pendingId, signal: "voice", evidence: voiceTurn }, { userText: voiceTurn, sessionId: "s" });
clock += 20_001;
assert.equal(pendingCompare.acceptStartSignal("voice"), false, "armed start permission expires after 20 seconds");
assert.equal(pendingCompare.snapshot().scene.status, "closed");
const restoredShared = makeCompanion();
restoredShared.restore(shared.serialize());
assert.equal(restoredShared.snapshot().episodes[0].visualMemory.description, "A red paper rocket with a wide base.");
assert.equal(restoredShared.snapshot().scene.status, "idle", "restore never revives an armed or started scene");

// Retention stays capped at eight episodes and reset removes everything.
const bounded = makeCompanion();
for (let index = 0; index < 10; index += 1) {
  clock += 1;
  const text = `Episode${index} happened today`;
  bounded.userTurn(text);
  const proposal = bounded.act({ type: "propose_experience", title: `Episode${index}`, detail: "A bounded event.", outcome: "It happened.", motif: "nod", evidence: text }, { userText: text, sessionId: `s${index}` });
  if (index < 8) {
    assert.equal(proposal.status, "proposed");
    bounded.assistantEnd(`Should I remember Episode${index}?`);
  } else {
    assert.equal(proposal.ok, false);
    assert.equal(proposal.status, "memory_full");
    assert.deepEqual(proposal.capacity, { used: 8, limit: 8 });
    assert.equal(bounded.snapshot().pendingExperience, null);
    bounded.assistantEnd(`Should I remember Episode${index}?`);
  }
  bounded.userTurn("Yes.");
}
assert.equal(bounded.snapshot().episodes.length, 8);
assert.deepEqual(bounded.snapshot().episodes.map((episode) => episode.title), Array.from({ length: 8 }, (_, index) => `Episode${index}`),
  "the first eight confirmed episodes remain intact when later proposals exceed capacity");
bounded.reset();
assert.equal(bounded.snapshot().episodes.length, 0);
assert.equal(bounded.snapshot().pendingExperience, null);

console.log("Behavior companion bounded memory and curiosity: PASS");
