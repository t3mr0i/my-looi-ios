import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const {
  proposeSharedActivity,
  hearSharedActivity,
  advanceSharedActivity,
  markSharedActivityStart,
  pauseSharedActivity,
  restoreSharedActivity,
} = loadTypeScript("src/behavior/shared-activity.ts");

let now = 10_000;
const source = (overrides = {}) => ({
  userText: "Lass uns Gerda gemeinsam bauen.",
  sessionId: "session-a",
  language: "de",
  now,
  episodeTitle: "Gerda",
  paused: false,
  ...overrides,
});
const beginAction = (overrides = {}) => ({
  type: "manage_shared_activity",
  operation: "begin",
  id: "ep_gerda",
  evidence: "Lass uns Gerda gemeinsam bauen",
  ...overrides,
});
const run = (activity, action, options = {}) => proposeSharedActivity(activity, action, source(options));
const ask = (activity) => hearSharedActivity(activity, activity.pending.question, now + 1);
const affirm = (activity, text = "Ja", sessionId = "session-a") => {
  now += 2;
  return advanceSharedActivity(activity, text, sessionId, now);
};
const beginPending = run(null, beginAction()).activity;

// A new activity starts as an unconfirmed proposal; it cannot overwrite another live activity.
assert.equal(beginPending.phase, "checking");
assert.equal(beginPending.confirmedAt, null);
assert.deepEqual(beginPending.confirmed, []);
assert.equal(beginPending.pending.step, "begin");
assert.equal(beginPending.pending.askedAt, null);
assert.equal(run(null, beginAction()).result.confirmationQuestion,
  "Sollen wir die gemeinsame Tätigkeit für Gerda starten?");
assert.equal(run(null, beginAction({ evidence: "Давай вместе займёмся Gerda" }), { language: "ru", userText: "Давай вместе займёмся Gerda" }).result.confirmationQuestion,
  "Начать совместное занятие для Gerda?");
assert.equal(run(null, beginAction({ evidence: "Почнімо спільну справу для Gerda" }), { language: "uk", userText: "Почнімо спільну справу для Gerda" }).result.confirmationQuestion,
  "Почати спільне заняття для Gerda?");
assert.equal(run(null, beginAction({ evidence: "Let's build Gerda together" }), { language: "en", userText: "Let's build Gerda together" }).result.confirmationQuestion,
  "Should we start the shared activity for Gerda?");
const unrelated = run(beginPending, { type: "manage_shared_activity", operation: "begin", id: "ep_other", evidence: "Start another" });
assert.equal(unrelated.result.status, "pending_exists");
assert.equal(unrelated.activity, beginPending, "a pending or active activity is never replaced by another begin request");

// Confirmations are facts only after the exact question was heard and the next turn clearly agrees.
const unheard = affirm(beginPending);
assert.equal(unheard.accepted, null);
assert.equal(unheard.activity, null, "an unheard begin proposal does not create a task");
let activity = ask(beginPending);
const heardOnce = activity.pending.askedAt;
assert.equal(hearSharedActivity(activity, activity.pending.question, now + 2).pending.askedAt, heardOnce,
  "rehearing a one-shot confirmation question cannot extend its answer window");
const acceptedBegin = affirm(activity, "Ja");
assert.equal(acceptedBegin.accepted, "begin");
activity = acceptedBegin.activity;
assert.equal(activity.phase, "checking");
assert.equal(activity.confirmedAt, now);
assert.equal(activity.pending, null);

// Each milestone is proposed in order and only enters confirmed history after acceptance.
const checkedAction = {
  type: "manage_shared_activity", operation: "confirm_step", id: "ep_gerda", step: "checked",
  detail: "Die Pappe ist da", evidence: "Ich sehe: Die Pappe ist da, und das Material ist trocken.",
};
let proposal = run(activity, checkedAction, { userText: "Ich sehe: Die Pappe ist da, und das Material ist trocken.", language: "de" });
assert.equal(proposal.result.status, "pending_confirmation");
assert.equal(proposal.activity.phase, "checking");
assert.deepEqual(proposal.activity.confirmed, [], "proposed checks are not saved as confirmed facts");
assert.equal(proposal.result.confirmationQuestion, "Haben wir für Gerda das geprüft: Die Pappe ist da?");
const caseMismatch = run(activity, {
  ...checkedAction,
  detail: "die Pappe ist da",
  evidence: "Die Pappe ist da.",
}, { userText: "Die Pappe ist da. die Pappe ist da" });
assert.equal(caseMismatch.result.status, "detail_not_in_evidence",
  "milestone details must be a case-sensitive verbatim substring of the evidence quote");
assert.equal(caseMismatch.activity, activity, "an unsupported detail cannot replace the current activity snapshot");
activity = ask(proposal.activity);
const beforeAcceptance = structuredClone(activity);
const acceptedCheck = affirm(activity, "Ja, bitte");
assert.equal(acceptedCheck.accepted, "checked");
assert.equal(acceptedCheck.activity.phase, "preparing");
assert.deepEqual(acceptedCheck.activity.confirmed.map((item) => item.step), ["checked"]);
assert.deepEqual(activity, beforeAcceptance, "advancing a step never mutates the previous snapshot");

const preparedAction = {
  type: "manage_shared_activity", operation: "confirm_step", id: "ep_gerda", step: "prepared",
  detail: "Schere und Kleber liegen bereit", evidence: "Schere und Kleber liegen bereit, und der Tisch ist frei.",
};
proposal = run(acceptedCheck.activity, preparedAction, { userText: "Schere und Kleber liegen bereit, und der Tisch ist frei." });
assert.equal(proposal.result.status, "pending_confirmation");
assert.equal(proposal.activity.phase, "preparing");
activity = ask(proposal.activity);
const acceptedPreparation = affirm(activity, "Genau");
assert.equal(acceptedPreparation.accepted, "prepared");
assert.equal(acceptedPreparation.activity.phase, "waiting_for_start");
assert.deepEqual(acceptedPreparation.activity.confirmed.map((item) => item.step), ["checked", "prepared"]);

// Starting only changes the local phase. It records neither physical movement nor a result.
assert.equal(markSharedActivityStart(acceptedPreparation.activity, "ep_wrong", now), acceptedPreparation.activity,
  "an unrelated signal leaves the waiting task untouched");
activity = markSharedActivityStart(acceptedPreparation.activity, "ep_gerda", now);
assert.equal(activity.phase, "awaiting_result");
assert.equal(activity.startedAt, now);
assert.equal(activity.confirmed.length, 2);

// A reported outcome remains a proposal until the exact question and next-turn confirmation.
const resultAction = {
  type: "manage_shared_activity", operation: "report_result", id: "ep_gerda",
  detail: "Der breite Boden hält die Rakete aufrecht", evidence: "Der breite Boden hält die Rakete aufrecht.",
};
const embellishedResult = run(activity, {
  ...resultAction,
  detail: "Die Rakete flog quer durch den Raum",
  evidence: "Die Rakete ist gestartet",
}, { userText: "Die Rakete ist gestartet. Sie flog quer durch den Raum." });
assert.equal(embellishedResult.result.status, "detail_not_in_evidence",
  "a confirmation question must not introduce a result detail that the exact quote does not support");
assert.equal(embellishedResult.activity, activity);
proposal = run(activity, resultAction, { userText: "Der breite Boden hält die Rakete aufrecht." });
assert.equal(proposal.result.status, "pending_confirmation");
assert.equal(proposal.activity.phase, "awaiting_result");
assert.equal(proposal.activity.confirmed.length, 2);
activity = ask(proposal.activity);
assert.equal(affirm(activity, '“Ja”').accepted, null, "a quoted affirmation is ambiguous and cannot commit a result");
activity = ask(proposal.activity);
const acceptedResult = affirm(activity, "Ja");
assert.equal(acceptedResult.accepted, "result");
assert.equal(acceptedResult.activity.phase, "completed");
assert.deepEqual(acceptedResult.activity.confirmed.map((item) => item.step), ["checked", "prepared", "result"]);

// A result cannot be proposed before a fresh explicit start, and phases cannot be skipped.
assert.equal(run(acceptedCheck.activity, checkedAction, { userText: checkedAction.evidence }).result.status, "wrong_phase");
assert.equal(run(acceptedPreparation.activity, resultAction, { userText: resultAction.evidence }).result.status, "wrong_phase");
assert.equal(run(null, checkedAction).result.status, "no_activity");

// Pausing drops an in-flight proposal. An activity that was awaiting its result needs a fresh start.
const beforeReportedResult = markSharedActivityStart(acceptedPreparation.activity, "ep_gerda", now);
proposal = run(beforeReportedResult, resultAction, { userText: resultAction.evidence });
assert.equal(proposal.activity.pending.step, "result");
assert.equal(pauseSharedActivity(proposal.activity).pending, null);
assert.equal(pauseSharedActivity(proposal.activity).phase, "waiting_for_start");
const resumedProposal = run(pauseSharedActivity(acceptedPreparation.activity), {
  type: "manage_shared_activity", operation: "resume", id: "ep_gerda", evidence: "Weiter mit Gerda",
}, { userText: "Weiter mit Gerda", paused: true });
assert.equal(resumedProposal.result.status, "pending_confirmation");
assert.equal(run(acceptedPreparation.activity, {
  type: "manage_shared_activity", operation: "resume", id: "ep_gerda", evidence: "Weiter mit Gerda",
}, { userText: "Weiter mit Gerda", paused: false }).result.status, "not_paused");
activity = ask(resumedProposal.activity);
const resumed = affirm(activity, "Так");
assert.equal(resumed.accepted, "resume");
assert.equal(resumed.activity.phase, "waiting_for_start");

// New user turns consume the one-shot question, including denial, ambiguity, another session, or expiry.
for (const [answer, sessionId] of [["Yes, but maybe later", "session-a"], ["No", "session-a"], ["Yes", "session-b"], ["Is it ready?", "session-a"]]) {
  const asked = ask(beginPending);
  const outcome = advanceSharedActivity(asked, answer, sessionId, now + 2);
  assert.equal(outcome.accepted, null);
  assert.equal(outcome.activity, null, "a rejected begin proposal cannot be retried against a later turn");
}
let expiredAt = beginPending.pending.proposedAt + 120_000;
assert.equal(advanceSharedActivity(ask(beginPending), "Yes", "session-a", expiredAt).activity, null);
const repeatedQuestion = hearSharedActivity(beginPending, `${beginPending.pending.question} ${beginPending.pending.question}`, now + 1);
assert.equal(repeatedQuestion.pending.askedAt, null, "a repeated assistant question is not a valid one-shot confirmation prompt");
const twoQuestions = hearSharedActivity(beginPending, `${beginPending.pending.question} Really?`, now + 1);
assert.equal(twoQuestions.pending.askedAt, null, "an answer is not accepted when the assistant utterance asks multiple questions");
assert.equal(hearSharedActivity(beginPending, beginPending.pending.question, beginPending.pending.proposedAt + 120_000), null,
  "an unconfirmed begin expires instead of leaving behind a phantom task");

// Begin, resume, and cancel require a current exact quote that names the saved episode.
assert.equal(run(null, beginAction({ evidence: "Let's do this" }), { userText: "Let's do this", episodeTitle: "Gerda" }).result.status, "missing_title");
assert.equal(run(null, beginAction(), { userText: "Maybe we should build it", episodeTitle: "Gerda" }).result.status, "missing_evidence");
const cancel = run(acceptedPreparation.activity, {
  type: "manage_shared_activity", operation: "cancel", id: "ep_gerda", evidence: "Vergiss die Tätigkeit für Gerda",
}, { userText: "Vergiss die Tätigkeit für Gerda" });
assert.equal(cancel.result.status, "cancelled");
assert.equal(cancel.activity, null);
assert.equal(run(acceptedPreparation.activity, {
  type: "manage_shared_activity", operation: "cancel", id: "ep_wrong", evidence: "Cancel Gerda",
}, { userText: "Cancel Gerda" }).result.status, "wrong_episode");

// Restore retains only confirmed facts, drops proposals/start permission, and requires a new signal.
const awaitingResult = markSharedActivityStart(acceptedPreparation.activity, "ep_gerda", now);
const restored = restoreSharedActivity({
  ...awaitingResult,
  pending: { ...resultAction, step: "result", proposedAt: now, askedAt: now },
}, now + 1);
assert.equal(restored.phase, "waiting_for_start");
assert.equal(restored.startedAt, null);
assert.equal(restored.pending, null);
assert.deepEqual(restored.confirmed.map((item) => item.step), ["checked", "prepared"]);
assert.equal(markSharedActivityStart(restored, "ep_gerda", now + 2).phase, "awaiting_result",
  "restored activity requires a fresh matching start event");
assert.equal(restoreSharedActivity(beginPending, now + 1), null, "an unconfirmed begin cannot survive restoration");
assert.equal(restoreSharedActivity(acceptedResult.activity, now + 1).phase, "completed");
const [savedChecked, savedPrepared, savedResult] = acceptedResult.activity.confirmed;
const outOfOrder = restoreSharedActivity({
  ...acceptedResult.activity,
  confirmedAt: now - 300,
  confirmed: [
    { ...savedChecked, at: now - 100 },
    { ...savedPrepared, at: now - 200 },
    { ...savedResult, at: now - 50 },
  ],
}, now);
assert.equal(outOfOrder.phase, "preparing");
assert.deepEqual(outOfOrder.confirmed.map((item) => item.step), ["checked"],
  "an out-of-order preparation/result cannot advance past the last continuous confirmed step");
const beforeBeginConfirmation = restoreSharedActivity({
  ...acceptedResult.activity,
  confirmedAt: now - 100,
  confirmed: [
    { ...savedChecked, at: now - 101 },
    { ...savedPrepared, at: now - 99 },
    { ...savedResult, at: now - 98 },
  ],
}, now);
assert.equal(beforeBeginConfirmation.phase, "checking");
assert.deepEqual(beforeBeginConfirmation.confirmed, [], "milestones before the accepted begin are discarded");
const futureChecked = restoreSharedActivity({
  ...acceptedResult.activity,
  confirmed: [
    { ...savedChecked, at: now + 1 },
    { ...savedPrepared, at: now + 2 },
    { ...savedResult, at: now + 3 },
  ],
}, now);
assert.equal(futureChecked.phase, "checking");
assert.deepEqual(futureChecked.confirmed, [], "future timestamps cannot restore progress or a result");

// Inputs are bounded before they can enter questions or confirmed activity history.
assert.equal(run(acceptedCheck.activity, {
  ...preparedAction, detail: "x".repeat(181),
}, { userText: preparedAction.evidence }).result.status, "invalid_detail");
assert.equal(run(acceptedCheck.activity, {
  ...preparedAction, detail: "Is this okay?",
}, { userText: preparedAction.evidence }).result.status, "invalid_detail");
assert.equal(run(null, beginAction({ evidence: "x".repeat(241) }), { userText: "x".repeat(241) }).result.status, "missing_evidence");

console.log("shared activity confirmation, ordering, interruption, result, and restore tests passed");
