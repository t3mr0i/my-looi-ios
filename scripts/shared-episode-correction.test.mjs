import assert from "node:assert/strict";
import path from "node:path";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const createBehaviorCompanion = createTypeScriptTreeLoader()(
  path.resolve("src/behavior/behavior-companion.ts"),
).createBehaviorCompanion;

function makeCompanion(language = "en") {
  let now = 10_000;
  const companion = createBehaviorCompanion({ now: () => now });
  const sessionId = "episode-correction-" + language;
  function turn(text) { now += 10; companion.userTurn(text); return text; }
  function act(action, userText, languageOverride = language) {
    return companion.act(action, { userText, sessionId, language: languageOverride });
  }
  function saveEpisode({ title = "Gerda", detail = "We built a paper rocket.", outcome = "It landed by the red fence." } = {}) {
    const evidence = turn(title + " is the rocket we built together today.");
    const result = act({ type: "propose_experience", title, detail, outcome, motif: "happy_bob", evidence }, evidence);
    assert.equal(result.status, "proposed");
    companion.assistantEnd("Should I remember " + title + "?");
    turn("Yes.");
    return companion.snapshot().episodes.find((item) => item.title === title);
  }
  function correction(episode, options = {}) {
    const field = options.field ?? "outcome";
    const replacement = options.replacement ?? "It landed beside the oak tree.";
    const prefixes = {
      en: "Correction for " + episode.title,
      de: "Korrektur zu " + episode.title,
      ru: "Поправка к " + episode.title,
      uk: "Уточнення до " + episode.title,
    };
    const userText = options.text ?? prefixes[language] + ": " + replacement;
    turn(userText);
    return {
      userText,
      result: act({
        type: "correct_experience",
        id: options.id ?? episode.id,
        field,
        replacement,
        evidence: options.evidence ?? userText,
      }, userText),
    };
  }
  function addProtectedMetadata(episode) {
    let evidence = turn("For " + episode.title + ", please nod as our personal ritual.");
    let result = act({
      type: "set_episode_ritual",
      id: episode.id,
      mode: "active",
      motif: "nod",
      evidence,
    }, evidence);
    assert.equal(result.status, "personal_ritual_pending");
    companion.assistantEnd(result.confirmationQuestion);
    turn("Yes.");

    evidence = turn("Please remember the visible description of " + episode.title + ": silver paper wings.");
    companion.visual("A silver paper rocket with two blue fins.");
    result = act({
      type: "propose_visual_memory",
      id: episode.id,
      description: "A silver paper rocket with two blue fins.",
      evidence,
    }, evidence);
    assert.equal(result.status, "visual_memory_pending");
    companion.assistantEnd(result.confirmationQuestion);
    turn("Yes.");
    return companion.snapshot().episodes.find((item) => item.id === episode.id);
  }
  return {
    companion, sessionId, turn, act, saveEpisode, correction, addProtectedMetadata,
    advance(ms) { now += ms; },
    now: () => now,
    close() { companion.reset(); },
  };
}

// Both fields use one spoken, localized confirmation, then preserve the
// original entry identity and the creation source.
for (const [language, field, replacement, questionWord] of [
  ["de", "detail", "Wir bauten am Samstag eine blaue Papierrakete.", "Beschreibung"],
  ["en", "outcome", "It landed beside the oak tree.", "outcome"],
  ["ru", "detail", "В субботу мы сделали синюю бумажную ракету.", "описание"],
  ["uk", "outcome", "Вона приземлилася біля дуба.", "результат"],
  ["de", "outcome", "Sie landete neben der großen Eiche.", "Ergebnis"],
  ["en", "detail", "We built a blue paper rocket on Saturday.", "detail"],
  ["ru", "outcome", "Она приземлилась у большого дуба.", "результат"],
  ["uk", "detail", "Ми зробили синю паперову ракету в суботу.", "опис"],
]) {
  const h = makeCompanion(language);
  try {
    const before = structuredClone(h.addProtectedMetadata(h.saveEpisode()));
    const proposed = h.correction(before, { field, replacement });
    assert.equal(proposed.result.status, "correction_pending", language + "/" + field);
    assert.ok(proposed.result.confirmationQuestion.includes(replacement));
    assert.ok(proposed.result.confirmationQuestion.toLocaleLowerCase().includes(questionWord.toLocaleLowerCase()));
    assert.deepEqual(h.companion.snapshot().episodes[0], before, "the previous fact remains until confirmation");
    assert.equal(h.companion.snapshot().pendingExperience.askedAt, null);

    h.companion.assistantEnd(proposed.result.confirmationQuestion + " " + proposed.result.confirmationQuestion);
    assert.equal(h.companion.snapshot().pendingExperience.askedAt, null, "a duplicated question was not heard exactly once");
    h.turn(language === "de" ? "Ja." : language === "ru" ? "Да." : language === "uk" ? "Так." : "Yes.");
    assert.deepEqual(h.companion.snapshot().episodes[0], before, "yes before the exact question is heard cannot edit memory");

    const confirmed = h.correction(before, { field, replacement });
    h.companion.assistantEnd(confirmed.result.confirmationQuestion);
    assert.ok(h.companion.snapshot().pendingExperience.askedAt !== null);
    h.turn(language === "de" ? "Ja." : language === "ru" ? "Да." : language === "uk" ? "Так." : "Yes.");
    const saved = h.companion.snapshot().episodes[0];
    assert.equal(saved[field], replacement);
    assert.equal(saved.id, before.id);
    assert.equal(saved.title, before.title);
    assert.equal(saved.createdAt, before.createdAt);
    assert.deepEqual(saved.source, before.source, "the creation quote remains the original source");
    assert.equal(saved[field === "detail" ? "outcome" : "detail"], before[field === "detail" ? "outcome" : "detail"]);
    assert.equal(saved.motif, before.motif);
    assert.deepEqual(saved.ritualPreference, before.ritualPreference, "the confirmed personal ritual is untouched");
    assert.deepEqual(saved.visualMemory, before.visualMemory, "the confirmed visual baseline and its source are untouched");
    assert.equal(saved.corrections[field].evidence, confirmed.userText);
    assert.equal(saved.corrections[field].sessionId, h.sessionId);
    assert.ok(saved.corrections[field].confirmedAt >= saved.corrections[field].at);
    const contextRecord = h.companion.context(saved.title).companion.episodes.find((item) => item.id === saved.id);
    assert.ok(contextRecord[field] && replacement.startsWith(contextRecord[field]), "compact conversation context previews the corrected fact");
    assert.ok(contextRecord.corrections[field].evidence && confirmed.userText.startsWith(contextRecord.corrections[field].evidence), "compact context keeps the corrected field's own source");
    contextRecord.corrections[field].evidence = "context caller mutation";
    assert.equal(h.companion.snapshot().episodes[0].corrections[field].evidence, confirmed.userText);

    const restored = createBehaviorCompanion();
    restored.restore(h.companion.serialize());
    assert.deepEqual(restored.snapshot().episodes[0], saved, "version-one persistence retains confirmed correction provenance");
    const recallText = "Tell me what happened with " + saved.title + "?";
    restored.userTurn(recallText);
    const recalled = restored.act(
      { type: "recall_experience", id: saved.id },
      { userText: recallText, sessionId: "episode-correction-recall" },
    );
    assert.ok(["recalled", "personal_ritual_offered"].includes(recalled.status));
    assert.equal(recalled.episode[field], replacement);
    assert.deepEqual(recalled.episode.corrections, saved.corrections);
    recalled.episode.corrections[field].evidence = "caller mutation";
    assert.equal(restored.snapshot().episodes[0].corrections[field].evidence, confirmed.userText, "recall provenance is a defensive copy");

    const searchNeedle = field === "outcome"
      ? language === "de" ? "Eiche" : language === "ru" || language === "uk" ? "дуба" : "oak"
      : language === "de" ? "Papierrakete" : language === "ru" ? "синюю" : language === "uk" ? "синю" : "blue rocket";
    const searchText = "Tell me about " + searchNeedle + ".";
    restored.userTurn(searchText);
    const found = restored.act(
      { type: "search_experiences", query: searchNeedle },
      { userText: searchText, sessionId: "episode-correction-search" },
    );
    assert.equal(found.status, "candidates_found");
    const matching = found.matches.find((item) => item.episode.id === saved.id);
    assert.ok(matching);
    assert.equal(matching.episode[field], replacement);
    assert.deepEqual(matching.episode.corrections, saved.corrections, "read-only search retains the corrected fact source");
  } finally { h.close(); }
}

// A new story, quote, question, hypothetical or negation cannot authorize a
// saved-memory change. Evidence and the entire replacement must be verbatim.
{
  const h = makeCompanion();
  try {
    const episode = h.saveEpisode();
    const reject = (text, evidence = text, replacement = "It landed beside the oak tree.") =>
      h.correction(episode, { text, evidence, replacement }).result.status;
    const accept = (text, replacement) => {
      assert.equal(reject(text, text, replacement), "correction_pending");
      h.companion.cancel();
    };
    const ordinary = "Gerda landed beside the oak tree.";
    assert.equal(h.correction(episode, { text: ordinary, replacement: ordinary }).result.status, "correction_not_explicit");
    assert.equal(reject("“Correction for Gerda: It landed beside the oak tree.”"), "correction_not_explicit");
    assert.equal(reject("Correction for Gerda: It landed beside the oak tree.?"), "correction_not_explicit");
    assert.equal(reject("Hypothetically, a correction for Gerda: It landed beside the oak tree."), "correction_not_explicit");
    assert.equal(reject("Do not correct Gerda: It landed beside the oak tree."), "correction_not_explicit");
    const quotedInner = "Correction for Gerda: It landed beside the oak tree.";
    assert.equal(h.correction(episode, {
      text: `He said: "${quotedInner}"`,
      evidence: quotedInner,
      replacement: "It landed beside the oak tree.",
    }).result.status, "correction_not_explicit", "an extracted unquoted evidence slice cannot override attribution in the full turn");
    assert.equal(h.correction(episode, {
      text: `Do not correct any saved memory. ${quotedInner}`,
      evidence: quotedInner,
      replacement: "It landed beside the oak tree.",
    }).result.status, "correction_not_explicit", "an extracted evidence slice cannot override a negated full turn");
    accept("Please correct the memory for Gerda, It landed beside the oak tree.", "It landed beside the oak tree.");
    accept("Please correct the memory for Gerda. It landed beside the oak tree.", "It landed beside the oak tree.");
    accept("Please correct the memory for Gerda It landed beside the oak tree.", "It landed beside the oak tree.");
    accept('Correction for Gerda: "It landed beside the oak tree."', "It landed beside the oak tree.");
    accept("Korrektur zu Gerda, Sie landete neben dem Baum.", "Sie landete neben dem Baum.");
    accept("Bitte korrigiere die Erinnerung an Gerda. Sie landete neben dem Baum.", "Sie landete neben dem Baum.");
    accept("Kannst du die Erinnerung an Gerda korrigieren: Sie landete neben dem Baum?", "Sie landete neben dem Baum");
    accept("Поправь память о Gerda: Она приземлилась у дуба.", "Она приземлилась у дуба.");
    accept("Можешь исправить память о Gerda: Она приземлилась у дуба?", "Она приземлилась у дуба");
    accept("Виправ запис про Gerda: Вона приземлилася біля дуба.", "Вона приземлилася біля дуба.");
    accept("Можеш виправити пам'ять про Gerda: Вона приземлилася біля дуба?", "Вона приземлилася біля дуба");
    assert.equal(reject("Correction for Gerda: It landed beside the oak tree.", "Gerda landed beside the oak tree."), "missing_evidence");
    assert.equal(reject("Correction for Gerda: It landed beside the oak tree.", "Correction for Gerda: It landed beside the tree."), "missing_evidence");
    assert.equal(reject("Correction for Gerda: It landed beside the oak tree.", "Correction for Gerda: It landed beside the oak tree.", "It landed beside the red fence."), "missing_evidence");
    const second = h.saveEpisode({ title: "Rocket", detail: "A paper rocket.", outcome: "It flew." });
    const ambiguous = h.correction(episode, {
      text: "Correction for Gerda and Rocket: It landed beside the oak tree.",
      replacement: "It landed beside the oak tree.",
    });
    assert.equal(ambiguous.result.status, "ambiguous_reference");
    assert.ok(second);
    assert.equal(h.companion.snapshot().episodes[0].outcome, "It landed by the red fence.");
    assert.equal(h.companion.snapshot().pendingExperience, null);
  } finally { h.close(); }
}

// A negative answer, topic change, timeout, cancellation or restore discards a
// pending correction and keeps the original field.
for (const cancel of [
  (h) => { h.turn("No."); },
  (h) => { h.turn("Let's talk about something else."); },
  (h) => { h.advance(120_000); h.companion.tick(); },
  (h) => { h.companion.cancel(); },
  (h) => { h.companion.restore(h.companion.serialize()); },
]) {
  const h = makeCompanion();
  try {
    const episode = h.saveEpisode();
    const proposed = h.correction(episode);
    assert.equal(proposed.result.status, "correction_pending");
    h.companion.assistantEnd(proposed.result.confirmationQuestion);
    cancel(h);
    assert.equal(h.companion.snapshot().pendingExperience, null);
    assert.equal(h.companion.snapshot().episodes[0].outcome, "It landed by the red fence.");
  } finally { h.close(); }
}

// Full memory still permits correction. Repeated corrections keep only the
// latest source for the changed field and do not create another episode.
{
  const h = makeCompanion();
  try {
    for (let index = 1; index <= 8; index += 1) {
      h.saveEpisode({
        title: "Episode " + index,
        detail: "We made paper project " + index + ".",
        outcome: "Project " + index + " reached the garden.",
      });
    }
    const before = structuredClone(h.companion.snapshot().episodes[0]);
    const target = h.companion.snapshot().episodes[0];
    let proposed = h.correction(target, {
      text: "Correction for Episode 1: The first project reached the oak tree.",
      replacement: "The first project reached the oak tree.",
    });
    assert.equal(proposed.result.status, "correction_pending");
    h.companion.assistantEnd(proposed.result.confirmationQuestion);
    h.turn("Yes.");
    proposed = h.correction(target, {
      text: "Correction for Episode 1: The first project reached the maple tree.",
      replacement: "The first project reached the maple tree.",
    });
    assert.equal(proposed.result.status, "correction_pending");
    h.companion.assistantEnd(proposed.result.confirmationQuestion);
    h.turn("Yes.");
    const saved = h.companion.snapshot().episodes;
    assert.equal(saved.length, 8);
    assert.equal(saved[0].id, before.id);
    assert.equal(saved[0].createdAt, before.createdAt);
    assert.equal(saved[0].outcome, "The first project reached the maple tree.");
    assert.equal(saved[0].corrections.outcome.evidence, proposed.userText);
    assert.equal(Object.keys(saved[0].corrections).length, 1);
  } finally { h.close(); }
}

// Old version-one records remain readable; malformed correction provenance is
// ignored rather than presented as an authoritative source.
{
  const h = makeCompanion();
  try {
    const episode = h.saveEpisode();
    const legacy = structuredClone(h.companion.serialize());
    delete legacy.episodes[0].corrections;
    const oldStore = createBehaviorCompanion();
    oldStore.restore(legacy);
    assert.equal(oldStore.snapshot().episodes[0].corrections, undefined);

    const malformed = structuredClone(h.companion.serialize());
    malformed.episodes[0].corrections = {
      outcome: { evidence: "unrelated source", sessionId: "unknown", at: 1, confirmedAt: 2 },
    };
    const restored = createBehaviorCompanion();
    restored.restore(malformed);
    assert.equal(restored.snapshot().episodes[0].corrections, undefined);
    assert.equal(restored.snapshot().episodes[0].outcome, episode.outcome);
  } finally { h.close(); }
}

console.log("Shared episode corrections: explicit localized confirmation, exact evidence, bounded provenance, restore, recall/search, cancellation and full memory PASS");
