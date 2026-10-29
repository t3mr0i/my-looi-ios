import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const { createBehaviorCompanion } = loadTypeScript("src/behavior/behavior-companion.ts", {
  "../character/companion-personality": loadTypeScript("src/character/companion-personality.ts"),
  "./behavior-episode-search": loadTypeScript("src/behavior/behavior-episode-search.ts"),
});
const DAY = 24 * 60 * 60 * 1_000;
let clock = 50_000;
const make = () => createBehaviorCompanion({ now: () => clock });
const originTurn = "Gerda finally flew today.";

function saveEpisode(companion, title = "Gerda") {
  const text = `${title} finally flew today.`;
  companion.userTurn(text);
  const proposal = companion.act({
    type: "propose_experience", title, detail: "We repaired the paper rocket.",
    outcome: "The rocket finally flew.", motif: "happy_bob", evidence: `${title} finally flew`,
  }, { userText: text, sessionId: "voice-session" });
  assert.equal(proposal.status, "proposed");
  companion.assistantEnd(`Should I remember ${title}?`);
  companion.userTurn("Yes");
  return companion.snapshot().episodes.find((episode) => episode.title === title);
}

function prepareRitual(companion, episode, options = {}) {
  const text = options.text ?? "For Gerda, please use a happy bob and say rocket time.";
  companion.userTurn(text);
  return companion.act({
    type: "set_episode_ritual",
    id: episode.id,
    mode: "active",
    motif: options.motif ?? "happy_bob",
    phrase: Object.hasOwn(options, "phrase") ? options.phrase : "rocket time",
    evidence: text,
  }, { userText: text, sessionId: "voice-session", language: "en", ...options.source });
}

function confirmRitual(companion, pending, answer = "Yes") {
  companion.assistantEnd(pending.confirmationQuestion);
  return companion.userTurn(answer);
}

function configureActive(companion, episode) {
  const proposal = prepareRitual(companion, episode);
  assert.equal(proposal.status, "personal_ritual_pending");
  confirmRitual(companion, proposal);
  return companion.snapshot().episodes.find((item) => item.id === episode.id);
}

const companion = make();
const episode = saveEpisode(companion);

// The user's selected gesture and exact phrase need current quoted evidence.
const setupText = "For Gerda, please use a happy bob and say rocket time.";
const setup = prepareRitual(companion, episode, { text: setupText });
assert.equal(setup.status, "personal_ritual_pending");
assert.equal(setup.confirmationQuestion, companion.snapshot().pendingExperience.question);
assert.match(setup.confirmationQuestion, /rocket time/u);
assert.match(setup.confirmationQuestion, /^Should I .*\?$/u);
assert.doesNotMatch(setup.confirmationQuestion, /\bor\b|silent/iu,
  "the yes/no question asks only about the chosen motion; No is separately defined as silent");
assert.equal(companion.snapshot().episodes[0].ritualPreference, undefined,
  "a proposal remains ephemeral until its exact question is heard and confirmed");
assert.equal(companion.context(setupText).companion.ritualOffer, undefined,
  "a pending choice is not yet an eligible recurring offer");
const heardQuestion = setup.confirmationQuestion;
companion.assistantEnd(`${heardQuestion} ${heardQuestion}`);
assert.equal(companion.snapshot().pendingExperience.askedAt, null,
  "repeated questions do not authorize the next-turn preference write");
companion.userTurn("Yes");
assert.equal(companion.snapshot().episodes[0].ritualPreference, undefined,
  "an unheard question cannot be confirmed");

const confirmedSetup = prepareRitual(companion, episode, { text: setupText });
const confirmation = confirmRitual(companion, confirmedSetup, "Yes, please.");
assert.equal(confirmation.ritualDeclined, undefined);
let preference = companion.snapshot().episodes[0].ritualPreference;
assert.equal(preference.mode, "active");
assert.equal(preference.motif, "happy_bob");
assert.equal(preference.phrase, "rocket time");
assert.equal(preference.source.origin, "voice");
assert.equal(preference.source.evidence, setupText);
assert.equal(preference.lastOfferedAt, null);

// The chosen cue must be named, and a phrase must literally occur in the exact quote.
for (const [language, text, motif] of [
  ["de", "Für Gerda bitte neugierig bewegen und rocket time sagen.", "curious"],
  ["ru", "Для Gerda кивок и скажи rocket time.", "nod"],
  ["uk", "Для Gerda радісне погойдування і скажи rocket time.", "happy_bob"],
]) {
  companion.userTurn(text);
  const validation = prepareRitual(companion, episode, { text, motif, source: { language } });
  assert.equal(validation.status, "personal_ritual_pending", `the chosen cue is explicitly named in ${language}`);
  companion.cancel();
}
assert.equal(prepareRitual(companion, episode, {
  text: "For Gerda, please nod and say rocket time.",
}).status, "ritual_motif_not_named", "the action cannot select a motion the user did not name");
assert.equal(prepareRitual(companion, episode, {
  text: "For Gerda, I am curious and say rocket time.", motif: "curious",
}).status, "ritual_motif_not_named", "a mood adjective alone does not name the chosen motion");
assert.equal(prepareRitual(companion, episode, {
  text: "For Gerda, please use a happy bob and say rocket time.",
  source: {},
}).status, "personal_ritual_pending");
companion.cancel();
const phraseText = "For Gerda, please use a happy bob and say rocket time.";
companion.userTurn(phraseText);
assert.equal(companion.act({
  type: "set_episode_ritual", id: episode.id, mode: "active", motif: "happy_bob",
  phrase: "fly across the room", evidence: phraseText,
}, { userText: phraseText, sessionId: "voice-session" }).status, "ritual_phrase_not_grounded");
const invalidPhraseText = `${phraseText} rocket time?`;
companion.userTurn(invalidPhraseText);
assert.equal(companion.act({
  type: "set_episode_ritual", id: episode.id, mode: "active", motif: "happy_bob",
  phrase: "rocket time?", evidence: invalidPhraseText,
}, { userText: invalidPhraseText, sessionId: "voice-session" }).status, "ritual_phrase_invalid");

// A heard No to the binary choice commits silent and disables the legacy motif.
const declined = make();
const declinedEpisode = saveEpisode(declined);
const declineProposal = prepareRitual(declined, declinedEpisode);
assert.equal(declineProposal.status, "personal_ritual_pending");
const decline = confirmRitual(declined, declineProposal, "No");
assert.equal(decline.ritualDeclined, true);
assert.equal(declined.snapshot().episodes[0].ritualPreference.mode, "silent");
assert.equal(declined.snapshot().episodes[0].ritualPreference.lastOfferedAt, null);
assert.deepEqual(declined.userTurn("Gerda finally flew, it worked!"), {},
  "a persisted silent choice blocks legacy episode motifs on positive reports");
declined.userTurn("Tell me what happened with Gerda.");
assert.equal(declined.act({ type: "recall_experience", id: declinedEpisode.id }, {
  userText: "Tell me what happened with Gerda.", sessionId: "voice-session",
}).status, "personal_ritual_silent");
assert.equal(declined.snapshot().episodes[0].ritualPreference.mode, "silent");

for (const [language, answer] of [
  ["en", "No, stop it."],
  ["de", "Nein, lass das bitte."],
  ["ru", "Нет, не надо."],
  ["uk", "Ні, не треба."],
]) {
  const compoundDecline = make();
  const compoundEpisode = saveEpisode(compoundDecline);
  const proposal = prepareRitual(compoundDecline, compoundEpisode, { source: { language } });
  assert.equal(proposal.status, "personal_ritual_pending");
  const result = confirmRitual(compoundDecline, proposal, answer);
  assert.equal(result.ritualDeclined, true, `${language} explicit compound decline mutes the personal ritual`);
  assert.equal(compoundDecline.snapshot().episodes[0].ritualPreference.mode, "silent");
}

const ambiguousDecline = make();
const ambiguousEpisode = saveEpisode(ambiguousDecline);
configureActive(ambiguousDecline, ambiguousEpisode);
const ambiguousProposal = prepareRitual(ambiguousDecline, ambiguousEpisode);
const ambiguousResult = confirmRitual(ambiguousDecline, ambiguousProposal, "No, I think Gerda liked it.");
assert.equal(ambiguousResult.ritualDeclined, undefined,
  "an unrelated sentence beginning with No does not count as a personal-ritual decline");
assert.equal(ambiguousDecline.snapshot().episodes[0].ritualPreference.mode, "active",
  "an ambiguous answer leaves the earlier saved preference intact");

// Direct mute needs an explicit mute phrase as well as an exact named episode quote.
const directMute = make();
const muteEpisode = saveEpisode(directMute);
directMute.userTurn("Gerda");
assert.equal(directMute.act({
  type: "set_episode_ritual", id: muteEpisode.id, mode: "silent", evidence: "Gerda",
}, { userText: "Gerda", sessionId: "voice-session" }).status, "ritual_mute_not_explicit");
const muteText = "Please mute the ritual for Gerda.";
directMute.userTurn(muteText);
assert.equal(directMute.act({
  type: "set_episode_ritual", id: muteEpisode.id, mode: "silent", evidence: muteText,
}, { userText: muteText, sessionId: "voice-session" }).status, "personal_ritual_silenced");
assert.equal(directMute.snapshot().episodes[0].ritualPreference.source.evidence, muteText);

const germanMute = make();
const germanMuteEpisode = saveEpisode(germanMute);
const negatedSwitchOff = "Bitte schalte das Ritual für Gerda nicht aus.";
germanMute.userTurn(negatedSwitchOff);
assert.equal(germanMute.act({
  type: "set_episode_ritual", id: germanMuteEpisode.id, mode: "silent", evidence: negatedSwitchOff,
}, { userText: negatedSwitchOff, sessionId: "voice-session", language: "de" }).status, "ritual_mute_not_explicit",
"a request not to switch the ritual off does not mute it");
const explicitGermanMute = "Mach das Ritual für Gerda nicht.";
germanMute.userTurn(explicitGermanMute);
assert.equal(germanMute.act({
  type: "set_episode_ritual", id: germanMuteEpisode.id, mode: "silent", evidence: explicitGermanMute,
}, { userText: explicitGermanMute, sessionId: "voice-session", language: "de" }).status, "personal_ritual_silenced",
"the normal German ‘mach das Ritual ... nicht’ form is a clear mute request");
assert.equal(germanMute.snapshot().episodes[0].ritualPreference.mode, "silent");
const explicitGermanSwitchOff = "Bitte schalte das Ritual für Gerda aus.";
germanMute.userTurn(explicitGermanSwitchOff);
assert.equal(germanMute.act({
  type: "set_episode_ritual", id: germanMuteEpisode.id, mode: "silent", evidence: explicitGermanSwitchOff,
}, { userText: explicitGermanSwitchOff, sessionId: "voice-session", language: "de" }).status, "personal_ritual_silenced");
const negatedEnglishStop = "Please don't stop the ritual for Gerda.";
germanMute.userTurn(negatedEnglishStop);
assert.equal(germanMute.act({
  type: "set_episode_ritual", id: germanMuteEpisode.id, mode: "silent", evidence: negatedEnglishStop,
}, { userText: negatedEnglishStop, sessionId: "voice-session" }).status, "ritual_mute_not_explicit");

// A qualifying recall offers once; the phrase must be heard exactly once before a cue is reservable.
const recalled = make();
const recalledEpisode = saveEpisode(recalled);
configureActive(recalled, recalledEpisode);
const recallText = "Tell me what happened with Gerda.";
recalled.userTurn(recallText);
const offer = recalled.act({ type: "recall_experience", id: recalledEpisode.id }, {
  userText: recallText, sessionId: "voice-session",
});
assert.equal(offer.status, "personal_ritual_offered");
assert.equal(offer.motif, "happy_bob");
assert.equal(offer.ritualPhrase, "rocket time");
assert.match(offer.instruction, /Do not add a question/u);
assert.equal(recalled.snapshot().episodes[0].ritualPreference.lastOfferedAt, clock,
  "the 24-hour per-episode opportunity is persisted at offer time");
assert.deepEqual(recalled.context(recallText).companion.ritualOffer, {
  episodeId: recalledEpisode.id, title: "Gerda", motif: "happy_bob", phrase: "rocket time",
});
assert.equal(recalled.context("A different topic").companion.ritualOffer, undefined,
  "the chosen phrase is exposed only in its current uniquely named episode turn");
assert.equal(recalled.assistantEnd("Gerda flew. Rocket time. Rocket time."), undefined,
  "a duplicated phrase is not an actually heard one-shot ritual offer");
assert.equal(recalled.reserveMotif("happy_bob"), false,
  "a proposed gesture cannot be reserved before the phrase is actually heard");

recalled.userTurn(recallText);
const secondOffer = recalled.act({ type: "recall_experience", id: recalledEpisode.id }, {
  userText: recallText, sessionId: "voice-session",
});
assert.equal(secondOffer.status, "personal_ritual_cooldown", "one opportunity per episode is bounded to 24 hours");
assert.equal(recalled.context(recallText).companion.ritualOffer, undefined);

// The heard offer is ephemeral. The immediately following exact No mutes once;
// any intervening user turn consumes the association before a later No arrives.
const immediateNo = make();
const immediateEpisode = saveEpisode(immediateNo);
configureActive(immediateNo, immediateEpisode);
immediateNo.userTurn(recallText);
assert.equal(immediateNo.act({ type: "recall_experience", id: immediateEpisode.id }, {
  userText: recallText, sessionId: "voice-session",
}).status, "personal_ritual_offered");
assert.deepEqual(immediateNo.assistantEnd("Gerda flew. Rocket time."), { ritualMotif: "happy_bob" });
assert.equal(immediateNo.reserveMotif("nod"), false, "only the queued personal motif may be emitted");
assert.equal(immediateNo.reserveMotif("happy_bob"), true);
const declinedOffer = immediateNo.userTurn("No");
assert.equal(declinedOffer.ritualDeclined, true);
assert.equal(immediateNo.snapshot().episodes[0].ritualPreference.mode, "silent");
assert.equal(immediateNo.reserveMotif("happy_bob"), false, "the No clears an unconsumed cue candidate");

const compoundOfferDecline = make();
const compoundOfferEpisode = saveEpisode(compoundOfferDecline);
configureActive(compoundOfferDecline, compoundOfferEpisode);
compoundOfferDecline.userTurn(recallText);
compoundOfferDecline.act({ type: "recall_experience", id: compoundOfferEpisode.id }, { userText: recallText, sessionId: "voice-session" });
assert.deepEqual(compoundOfferDecline.assistantEnd("Gerda flew. Rocket time."), { ritualMotif: "happy_bob" });
const compoundOfferResult = compoundOfferDecline.userTurn("No, stop it.");
assert.equal(compoundOfferResult.ritualDeclined, true,
  "a bounded compound decline immediately after the heard ritual silences it");
assert.equal(compoundOfferDecline.snapshot().episodes[0].ritualPreference.mode, "silent");

const negatedDisableAnswer = make();
const negatedDisableEpisode = saveEpisode(negatedDisableAnswer);
configureActive(negatedDisableAnswer, negatedDisableEpisode);
negatedDisableAnswer.userTurn(recallText);
negatedDisableAnswer.act({ type: "recall_experience", id: negatedDisableEpisode.id }, { userText: recallText, sessionId: "voice-session" });
negatedDisableAnswer.assistantEnd("Gerda flew. Rocket time.");
assert.equal(negatedDisableAnswer.userTurn("No, don't turn it off.").ritualDeclined, undefined,
  "a negated disable command cannot be mistaken for a decline of the ritual itself");
assert.equal(negatedDisableAnswer.snapshot().episodes[0].ritualPreference.mode, "active");

const embeddedPhrase = make();
const embeddedEpisode = saveEpisode(embeddedPhrase);
configureActive(embeddedPhrase, embeddedEpisode);
embeddedPhrase.userTurn(recallText);
embeddedPhrase.act({ type: "recall_experience", id: embeddedEpisode.id }, { userText: recallText, sessionId: "voice-session" });
assert.equal(embeddedPhrase.assistantEnd("Gerda flew. rocket timeframe."), undefined,
  "a phrase embedded inside a different word is not counted as a heard ritual");
assert.equal(embeddedPhrase.reserveMotif("happy_bob"), false);

const noPhrase = make();
const noPhraseEpisode = saveEpisode(noPhrase);
const noPhraseProposal = prepareRitual(noPhrase, noPhraseEpisode, {
  text: "For Gerda, please use a happy bob.", phrase: null,
});
assert.equal(noPhraseProposal.status, "personal_ritual_pending");
confirmRitual(noPhrase, noPhraseProposal);
noPhrase.userTurn(recallText);
assert.equal(noPhrase.act({ type: "recall_experience", id: noPhraseEpisode.id }, { userText: recallText, sessionId: "voice-session" }).status,
  "personal_ritual_offered");
assert.deepEqual(noPhrase.assistantEnd("Gerda again."), { ritualMotif: "happy_bob" },
  "when no phrase is selected, the episode title must be spoken exactly once");
assert.equal(noPhrase.reserveMotif("happy_bob"), true);

const duplicatedTitle = make();
const duplicatedTitleEpisode = saveEpisode(duplicatedTitle);
const duplicatedTitleProposal = prepareRitual(duplicatedTitle, duplicatedTitleEpisode, {
  text: "For Gerda, please use a happy bob.", phrase: null,
});
confirmRitual(duplicatedTitle, duplicatedTitleProposal);
duplicatedTitle.userTurn(recallText);
duplicatedTitle.act({ type: "recall_experience", id: duplicatedTitleEpisode.id }, { userText: recallText, sessionId: "voice-session" });
assert.equal(duplicatedTitle.assistantEnd("Gerda flew. Gerda again."), undefined,
  "a title repeated in output cannot authorize a gesture when the phrase is null");
assert.equal(duplicatedTitle.reserveMotif("happy_bob"), false);

const laterNo = make();
const laterEpisode = saveEpisode(laterNo);
configureActive(laterNo, laterEpisode);
laterNo.userTurn(recallText);
laterNo.act({ type: "recall_experience", id: laterEpisode.id }, { userText: recallText, sessionId: "voice-session" });
laterNo.assistantEnd("Gerda flew. Rocket time.");
assert.deepEqual(laterNo.userTurn("What time is it?"), {});
assert.equal(laterNo.userTurn("No, stop it.").ritualDeclined, undefined,
  "a compound No after an intervening user turn is not attributed to the old offer");
assert.equal(laterNo.snapshot().episodes[0].ritualPreference.mode, "active");

const pendingOther = make();
const pendingEpisode = saveEpisode(pendingOther);
configureActive(pendingOther, pendingEpisode);
pendingOther.userTurn(recallText);
pendingOther.act({ type: "recall_experience", id: pendingEpisode.id }, { userText: recallText, sessionId: "voice-session" });
pendingOther.assistantEnd("Gerda flew. Rocket time.");
pendingOther.userTurn("Please remember another thing.");
pendingOther.act({ type: "propose_experience", title: "Rocket", detail: "A paper rocket.", outcome: "It flew.", motif: "nod", evidence: "remember another thing" }, {
  userText: "Please remember another thing.", sessionId: "voice-session",
});
assert.equal(pendingOther.userTurn("No").ritualDeclined, undefined,
  "a No consumed by another pending confirmation cannot mute the old ritual");
assert.equal(pendingOther.snapshot().episodes[0].ritualPreference.mode, "active");

// Restore preserves confirmed choices/opportunity cooldowns but never pending or queued offers.
const restoreSource = make();
const restoreEpisode = saveEpisode(restoreSource);
configureActive(restoreSource, restoreEpisode);
restoreSource.userTurn(recallText);
restoreSource.act({ type: "recall_experience", id: restoreEpisode.id }, { userText: recallText, sessionId: "voice-session" });
const saved = restoreSource.serialize();
const restored = make();
restored.restore(saved);
assert.equal(restored.snapshot().episodes[0].ritualPreference.mode, "active");
assert.equal(restored.snapshot().episodes[0].ritualPreference.lastOfferedAt, clock);
assert.equal(restored.snapshot().pendingExperience, null);
assert.equal(restored.context(recallText).companion.ritualOffer, undefined);
restored.userTurn(recallText);
assert.equal(restored.act({ type: "recall_experience", id: restoreEpisode.id }, { userText: recallText, sessionId: "voice-session" }).status,
  "personal_ritual_cooldown");

clock += DAY + 1;
restored.userTurn(recallText);
assert.equal(restored.act({ type: "recall_experience", id: restoreEpisode.id }, { userText: recallText, sessionId: "voice-session" }).status,
  "personal_ritual_offered", "the episode ritual can be offered again after the 24-hour window");

// Settings mute is durable, tagged as settings provenance, and clears ephemeral leases.
const settings = make();
const settingsEpisode = saveEpisode(settings);
configureActive(settings, settingsEpisode);
settings.userTurn(recallText);
settings.act({ type: "recall_experience", id: settingsEpisode.id }, { userText: recallText, sessionId: "voice-session" });
assert.equal(settings.disableRitual(settingsEpisode.id), true);
const settingsPreference = settings.snapshot().episodes[0].ritualPreference;
assert.equal(settingsPreference.mode, "silent");
assert.equal(settingsPreference.source.origin, "settings");
assert.equal(settingsPreference.source.evidence, "settings-disable");
assert.equal(settingsPreference.lastOfferedAt, clock, "settings mute preserves the 24-hour opportunity history");
assert.equal(settings.context(recallText).companion.ritualOffer, undefined);
assert.equal(settings.disableRitual("ep_missing"), false);
assert.equal(settings.forget(settingsEpisode.id), true);
assert.equal(settings.snapshot().episodes.length, 0);

// Old data keeps legacy behavior; malformed new preferences are discarded on restore.
const legacy = make();
const legacyEpisode = saveEpisode(legacy);
const legacySaved = legacy.serialize();
assert.equal(legacySaved.episodes[0].ritualPreference, undefined);
legacy.userTurn("Gerda finally flew, it worked!");
assert.deepEqual(legacy.userTurn("Gerda did not work."), {}, "legacy negative reports remain quiet");
assert.equal(legacy.userTurn("Gerda finally flew, it worked!").motif, "happy_bob");
const malformed = make();
malformed.restore({
  version: 1,
  episodes: [{
    ...legacySaved.episodes[0],
    ritualPreference: {
      mode: "active", motif: "hold", phrase: "x", confirmedAt: clock,
      source: { origin: "voice", evidence: "Gerda said x", sessionId: "s", at: clock }, lastOfferedAt: null,
    },
  }],
});
assert.equal(malformed.snapshot().episodes[0].ritualPreference, undefined,
  "an invalid persisted cue cannot be restored as a new preference");
assert.equal(legacyEpisode.id, malformed.snapshot().episodes[0].id);

// A wall-clock rollback must not turn a valid saved choice into legacy behavior.
const rollbackSilent = make();
const rollbackSilentEpisode = saveEpisode(rollbackSilent);
rollbackSilent.userTurn("Please mute the ritual for Gerda.");
rollbackSilent.act({
  type: "set_episode_ritual", id: rollbackSilentEpisode.id, mode: "silent", evidence: "Please mute the ritual for Gerda.",
}, { userText: "Please mute the ritual for Gerda.", sessionId: "voice-session" });
const rollbackSilentSaved = rollbackSilent.serialize();
clock -= DAY;
const restoredSilent = make();
restoredSilent.restore(rollbackSilentSaved);
assert.equal(restoredSilent.snapshot().episodes[0].ritualPreference.mode, "silent");
assert.deepEqual(restoredSilent.userTurn("Gerda finally flew, it worked!"), {},
  "future-dated silent provenance remains fail-closed after a clock rollback");

const rollbackActive = make();
const rollbackActiveEpisode = saveEpisode(rollbackActive);
configureActive(rollbackActive, rollbackActiveEpisode);
clock += DAY;
rollbackActive.userTurn(recallText);
assert.equal(rollbackActive.act({ type: "recall_experience", id: rollbackActiveEpisode.id }, {
  userText: recallText, sessionId: "voice-session",
}).status, "personal_ritual_offered");
const rollbackActiveSaved = rollbackActive.serialize();
clock -= 2 * DAY;
const restoredActive = make();
restoredActive.restore(rollbackActiveSaved);
assert.equal(restoredActive.snapshot().episodes[0].ritualPreference.lastOfferedAt, clock + 2 * DAY);
restoredActive.userTurn(recallText);
assert.equal(restoredActive.act({ type: "recall_experience", id: rollbackActiveEpisode.id }, {
  userText: recallText, sessionId: "voice-session",
}).status, "personal_ritual_cooldown",
  "future last-offered timestamps conservatively retain the 24-hour cooldown");
clock += 2 * DAY;

const clockRollbackOffer = make();
const clockRollbackEpisode = saveEpisode(clockRollbackOffer);
configureActive(clockRollbackOffer, clockRollbackEpisode);
clockRollbackOffer.userTurn(recallText);
clockRollbackOffer.act({ type: "recall_experience", id: clockRollbackEpisode.id }, { userText: recallText, sessionId: "voice-session" });
clock -= 1;
assert.equal(clockRollbackOffer.assistantEnd("Gerda flew. rocket time."), undefined,
  "a rollback clears a queued offer instead of extending its playback window");
assert.equal(clockRollbackOffer.reserveMotif("happy_bob"), false);
clock += 1;

const clockRollbackPending = make();
const clockRollbackPendingEpisode = saveEpisode(clockRollbackPending);
const clockRollbackProposal = prepareRitual(clockRollbackPending, clockRollbackPendingEpisode);
clockRollbackPending.assistantEnd(clockRollbackProposal.confirmationQuestion);
clock -= 1;
clockRollbackPending.userTurn("Yes");
assert.equal(clockRollbackPending.snapshot().episodes[0].ritualPreference, undefined,
  "a rollback clears a personal-ritual confirmation that has not yet been accepted");
clock += 1;

console.log("personal ritual choice, explicit mute, one-shot recall, cooldown, and restore tests passed");
