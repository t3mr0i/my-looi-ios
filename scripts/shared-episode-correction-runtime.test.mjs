import assert from "node:assert/strict";
import { createCompanionLiveRuntime } from "./helpers/companion-live-runtime.mjs";

const flush = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };

async function testTransport(name) {
  const fixture = createCompanionLiveRuntime();
  fixture.preferences.language = name === "webrtc" ? "en" : "de";
  fixture.preferences.listeningLanguage = fixture.preferences.language;
  const { events, behaviorEngine: engine } = fixture;
  const sessionId = `offline-episode-correction-${name}`;
  const transport = name === "pcm" ? new fixture.RealtimePcmConversationService() : new fixture.RealtimeConversationService();
  const messages = [];
  transport.active = true;
  transport.sessionId = sessionId;
  if (name === "pcm") {
    transport.webSocket = { readyState: 1, send(raw) { messages.push(JSON.parse(raw)); }, close() {} };
    transport.captureOwner = null;
    fixture.bindPcmAudioEventsForOfflineTest(transport);
  } else {
    transport.dataChannel = { readyState: "open", send(raw) { messages.push(JSON.parse(raw)); } };
  }
  const publish = (event) => events.publishBehaviorEvent({ ...event, sessionId });
  const action = (value) => events.performBehaviorCompanionAction(value, sessionId);
  events.beginBehaviorSession(sessionId, () => transport.applySessionPreferences("episode-correction-test"));

  try {
    const seed = "Wir haben Gerda gemeinsam gebaut. Sie landete am roten Zaun.";
    publish({ type: "user-turn", text: seed, turnId: `${name}-seed` });
    const proposal = action({
      type: "propose_experience", title: "Gerda", detail: "Wir bauten die Papierrakete Gerda.",
      outcome: "Sie landete am roten Zaun.", motif: "happy_bob", evidence: seed,
    });
    assert.equal(proposal.status, "proposed");
    publish({ type: "assistant-end", text: `Soll ich Gerda so speichern?` });
    publish({ type: "user-turn", text: "Ja.", turnId: `${name}-seed-confirmation` });
    await flush();

    const original = structuredClone(engine.getState().companion.episodes[0]);
    assert.equal(original.title, "Gerda");
    // A separate user task is part of the active local session. Correction must
    // keep its stable identity and confirmed progress.
    publish({ type: "intention", action: "pause", goal: "Papierflieger bauen", lastConfirmedStep: "Flügel gefaltet" });
    const pausedTask = structuredClone(engine.getState().pendingIntention);
    assert.equal(pausedTask.status, "paused");

    const correctionText = name === "pcm"
      ? "Korrektur zu Gerda: Sie landete neben dem Baum."
      : "Correction to Gerda: It landed beside the tree.";
    const replacement = name === "pcm" ? "Sie landete neben dem Baum." : "It landed beside the tree.";
    const correctionEvidence = correctionText;
    const sendUserTurn = async (text, itemId) => {
      const start = messages.length;
      await transport.handleEvent({ type: "input_audio_buffer.speech_started" });
      await transport.handleEvent({ type: "input_audio_buffer.speech_stopped" });
      await transport.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: text, item_id: itemId });
      await flush();
      return messages.slice(start);
    };
    const openCorrectionResponse = async (itemId, responseId) => {
      const turnMessages = await sendUserTurn(correctionText, itemId);
      assert.equal(events.requiresBehaviorTurnCommit(sessionId), true, `${name}: pending correction commits this user turn before model response`);
      const updateIndex = messages.length;
      transport.applySessionPreferences("correction-turn-admission");
      const update = messages.slice(updateIndex).filter((item) => item.type === "session.update").at(-1)
        ?? turnMessages.filter((item) => item.type === "session.update").at(-1);
      assert.equal(update?.session.audio.input.turn_detection.create_response, false, `${name}: correction has manual response admission`);
      const request = turnMessages.find((item) => item.type === "response.create");
      assert.ok(request?.response?.metadata?.looi_companion_request, `${name}: fresh correction turn requests exactly one correlated response`);
      await transport.handleEvent({ type: "response.created", response: { id: responseId, metadata: request.response.metadata } });
      return { turnMessages, request, responseId };
    };

    const inventedEvidenceTurn = await openCorrectionResponse(`${name}-invented-evidence-turn`, `${name}-invented-evidence-response`);

    await transport.handleEvent({
      type: "response.output_item.done", response_id: inventedEvidenceTurn.responseId,
      item: { type: "function_call", call_id: `${name}-invented-evidence`, name: "correct_shared_experience", arguments: JSON.stringify({
        id: original.id, field: "outcome", replacement,
        evidence: `${correctionEvidence}${name === "pcm" ? " Und zusätzlich war da ein Einhorn." : " And there was also a unicorn."}`,
      }) },
    });
    await flush();
    const inventedEvidenceOutput = messages.find((item) => item.item?.call_id === `${name}-invented-evidence` && item.item?.type === "function_call_output");
    assert.ok(inventedEvidenceOutput, `${name}: invented evidence gets a tool result`);
    assert.equal(JSON.parse(inventedEvidenceOutput.item.output).status, "missing_evidence", `${name}: engine rejects evidence not quoted by the current turn`);

    const inventedReplacementTurn = await openCorrectionResponse(`${name}-invented-replacement-turn`, `${name}-invented-replacement-response`);
    await transport.handleEvent({
      type: "response.output_item.done", response_id: inventedReplacementTurn.responseId,
      item: { type: "function_call", call_id: `${name}-invented-replacement`, name: "correct_shared_experience", arguments: JSON.stringify({
        id: original.id, field: "outcome", replacement: name === "pcm" ? "Gerda landete auf dem Mars." : "Gerda landed on Mars.", evidence: correctionEvidence,
      }) },
    });
    await flush();
    const inventedReplacementOutput = messages.find((item) => item.item?.call_id === `${name}-invented-replacement` && item.item?.type === "function_call_output");
    assert.ok(inventedReplacementOutput, `${name}: invented replacement gets a tool result`);
    assert.equal(JSON.parse(inventedReplacementOutput.item.output).status, "missing_evidence", `${name}: engine requires the complete replacement in the user's exact evidence`);
    assert.equal(engine.getState().companion.pendingExperience, null, `${name}: fabricated details cannot start a correction`);
    assert.equal(engine.getState().companion.episodes[0].outcome, original.outcome);

    const { turnMessages, request, responseId } = await openCorrectionResponse(`${name}-correction`, `${name}-correction-response`);
    await transport.handleEvent({
      type: "response.output_item.done", response_id: responseId,
      item: { type: "function_call", call_id: `${name}-correct`, name: "correct_shared_experience", arguments: JSON.stringify({
        id: original.id, field: "outcome", replacement, evidence: correctionEvidence,
      }) },
    });
    await flush();
    const toolOutput = messages.find((item) => item.item?.call_id === `${name}-correct` && item.item?.type === "function_call_output");
    assert.ok(toolOutput, `${name}: actual tool handler returns the correction proposal`);
    assert.equal(JSON.parse(toolOutput.item.output).status, "correction_pending");
    const pending = engine.getState().companion.pendingExperience;
    assert.equal(pending.kind, "correction");
    const question = pending.question ?? JSON.parse(toolOutput.item.output).confirmationQuestion;
    assert.ok(question.includes("Gerda") && question.includes(replacement), `${name}: confirmation names the title and complete replacement`);
    assert.equal(engine.getState().companion.episodes[0].outcome, original.outcome, `${name}: old confirmed fact remains until a heard question and later yes`);
    assert.equal(engine.getState().pendingIntention.id, pausedTask.id, `${name}: correction keeps another task identity`);
    assert.equal(engine.getState().pendingIntention.lastConfirmedStep, pausedTask.lastConfirmedStep);

    await transport.handleEvent({
      type: "response.output_item.done", response_id: responseId,
      item: { type: "function_call", call_id: `${name}-duplicate`, name: "correct_shared_experience", arguments: JSON.stringify({
        id: original.id, field: "outcome", replacement, evidence: correctionEvidence,
      }) },
    });
    await flush();
    const duplicateOutput = messages.find((item) => item.item?.call_id === `${name}-duplicate` && item.item?.type === "function_call_output");
    assert.ok(duplicateOutput, `${name}: duplicate same-turn tool gets an explicit bounded result`);
    assert.notEqual(JSON.parse(duplicateOutput.item.output).status, "correction_pending", `${name}: a same-turn duplicate cannot replace or reopen the fact`);
    assert.equal(engine.getState().companion.pendingExperience.replacement, replacement);
    assert.equal(engine.getState().companion.episodes[0].outcome, original.outcome);

    // The confirmation must have actually passed the adapter's heard-output
    // seam before the local pending record gains askedAt. The tool call above
    // returns its correction question request; only this follow-up response is
    // permitted to ask that exact question.
    const requestIndex = messages.findLastIndex((item) => item.type === "response.create");
    const confirmationRequest = messages[requestIndex];
    assert.ok(confirmationRequest?.response?.metadata?.looi_companion_request, `${name}: tool result schedules a correlated follow-up question response`);
    const confirmationResponseId = `${name}-confirmation-question`;
    await transport.handleEvent({ type: "response.done", response: { id: responseId, status: "completed", output: [] } });
    await transport.handleEvent({ type: "response.created", response: { id: confirmationResponseId, metadata: confirmationRequest.response.metadata } });
    if (name === "pcm") {
      await transport.handleEvent({ type: "response.output_audio.delta", response_id: confirmationResponseId, item_id: `${name}-question-item`, content_index: 0, delta: "AAAA" });
      await transport.handleEvent({ type: "response.output_audio_transcript.done", response_id: confirmationResponseId, transcript: question });
      await transport.handleEvent({ type: "response.done", response: { id: confirmationResponseId, status: "completed", output: [] } });
      fixture.emitPcmAudioEvent("onPlaybackDrained", { playedDurationMs: 150 });
    } else {
      await transport.handleEvent({ type: "output_audio_buffer.started", response_id: confirmationResponseId });
      await transport.handleEvent({ type: "response.output_audio_transcript.done", response_id: confirmationResponseId, transcript: question });
      await transport.handleEvent({ type: "response.done", response: { id: confirmationResponseId, status: "completed", output: [] } });
      await transport.handleEvent({ type: "output_audio_buffer.stopped", response_id: confirmationResponseId });
    }
    await flush();
    assert.ok(engine.getState().companion.pendingExperience.askedAt, `${name}: heard assistant end marks the exact correction question`);

    const confirmationTurn = await sendUserTurn(name === "pcm" ? "Ja." : "Yes.", `${name}-yes`);
    assert.equal(engine.getState().companion.episodes[0].id, original.id, `${name}: confirmation preserves episode identity`);
    assert.equal(engine.getState().companion.episodes[0].outcome, replacement, `${name}: later affirmative commits the field correction`);
    assert.equal(engine.getState().companion.episodes[0].detail, original.detail);
    assert.equal(engine.getState().companion.episodes[0].source.evidence, original.source.evidence);
    assert.equal(engine.getState().companion.pendingExperience, null);
    assert.deepEqual(engine.getState().pendingIntention, pausedTask, `${name}: independent paused task remains unchanged`);
    assert.ok(confirmationTurn.some((item) => item.type === "response.create"), `${name}: confirmation gets one normal reply after local commit`);

    const memoryBefore = await fixture.localMemoryDatabase.search("Gerda landed beside tree");
    const yesResponseRequest = confirmationTurn.findLast((item) => item.type === "response.create");
    assert.ok(yesResponseRequest, `${name}: confirmation turn has a normal assistant response request`);
    const yesResponseId = `${name}-yes-response`;
    await transport.handleEvent({ type: "response.created", response: { id: yesResponseId, metadata: yesResponseRequest.response?.metadata ?? {} } });
    await transport.handleEvent({
      type: "response.output_item.done", response_id: yesResponseId,
      item: { type: "function_call", call_id: `${name}-remember-bypass`, name: "remember", arguments: JSON.stringify({ note: "Gerda landed beside tree" }) },
    });
    await flush();
    const rememberOutput = messages.find((item) => item.item?.call_id === `${name}-remember-bypass` && item.item?.type === "function_call_output");
    assert.ok(rememberOutput, `${name}: ordinary remember gets a tool result on the correction-confirmation turn`);
    assert.equal(JSON.parse(rememberOutput.item.output).status, "pending-shared-experience", `${name}: remember cannot bypass shared correction confirmation`);
    assert.deepEqual(await fixture.localMemoryDatabase.search("Gerda landed beside tree"), memoryBefore, `${name}: blocked remember writes no personal fact`);

    const recallTurn = name === "pcm" ? "Was ist mit Gerda passiert?" : "What happened to Gerda?";
    publish({ type: "user-turn", text: recallTurn, turnId: `${name}-recall` });
    const recalled = action({ type: "recall_experience", id: original.id });
    assert.equal(recalled.status, "recalled");
    assert.equal(recalled.episode.outcome, replacement, `${name}: exact recall exposes the corrected fact`);
    assert.equal(recalled.episode.corrections.outcome.evidence, correctionEvidence, `${name}: corrected fact has its own provenance`);
    assert.equal(engine.getState().companion.episodes[0].createdAt, original.createdAt);
    assert.deepEqual(engine.getState().companion.episodes[0].source, original.source, `${name}: original creation provenance remains intact`);

    const searchNeedle = name === "pcm" ? "Baum" : "tree";
    const searchText = name === "pcm" ? "Erzähl mir vom Baum." : "Tell me about the tree.";
    publish({ type: "user-turn", text: searchText, turnId: `${name}-search` });
    const search = action({ type: "search_experiences", query: searchNeedle });
    assert.equal(search.status, "candidates_found", `${name}: search finds the corrected fact`);
    const searchMatch = search.matches.find((item) => item.episode.id === original.id);
    assert.ok(searchMatch, `${name}: search preserves the stable episode identity`);
    assert.equal(searchMatch.episode.outcome, replacement);
    assert.deepEqual(searchMatch.episode.corrections, engine.getState().companion.episodes[0].corrections);

    // A response that was active before new speech loses authorization. Its
    // delayed correction tool must be rejected without a follow-up response.
    const responseCountBeforeStaleTool = messages.filter((item) => item.type === "response.create").length;
    const pendingBeforeStaleTool = structuredClone(engine.getState().companion.pendingExperience);
    await transport.handleEvent({ type: "input_audio_buffer.speech_started" });
    await transport.handleEvent({ type: "input_audio_buffer.speech_stopped" });
    await transport.handleEvent({ type: "response.output_item.done", response_id: yesResponseId, item: {
      type: "function_call", call_id: `${name}-late-tool`, name: "correct_shared_experience",
      arguments: JSON.stringify({ id: original.id, field: "outcome", replacement: "Invented", evidence: correctionEvidence }),
    } });
    await flush();
    const lateOutput = messages.find((item) => item.item?.call_id === `${name}-late-tool` && item.item?.type === "function_call_output");
    assert.ok(lateOutput, `${name}: stale tool gets an explicit rejection`);
    assert.equal(JSON.parse(lateOutput.item.output).status, "stale-turn", `${name}: revoked response cannot use otherwise valid evidence`);
    assert.equal(messages.filter((item) => item.type === "response.create").length, responseCountBeforeStaleTool, `${name}: stale tool cannot schedule a follow-up response`);
    assert.equal(engine.getState().companion.episodes[0].outcome, replacement);
    assert.deepEqual(engine.getState().companion.pendingExperience, pendingBeforeStaleTool, `${name}: stale response leaves pending correction state unchanged`);
    assert.equal(engine.getState().pendingIntention.id, pausedTask.id);

    // Exercise correction with a live shared-activity task. Its checked
    // milestone survives, while the unconfirmed prepared step is deliberately
    // dropped when the correction intent pauses the activity.
    publish({ type: "intention", action: "drop", sessionId });
    const beginEvidence = name === "pcm" ? "Lass uns Gerda gemeinsam ausprobieren" : "Let's try Gerda together";
    await sendUserTurn(`${beginEvidence}.`, `${name}-activity-begin`);
    const begin = action({ type: "manage_shared_activity", operation: "begin", id: original.id, evidence: beginEvidence });
    assert.equal(begin.status, "pending_confirmation", `${name}: public events create a user-confirmed shared activity`);
    publish({ type: "assistant-end", text: begin.confirmationQuestion });
    await sendUserTurn(name === "pcm" ? "Ja." : "Yes.", `${name}-activity-begin-yes`);
    let activityTask = engine.getState().pendingIntention;
    assert.equal(activityTask.status, "active");
    assert.ok(activityTask.activity.confirmedAt, `${name}: activity start is confirmed through the public event/action seam`);

    const checkedEvidence = name === "pcm" ? "Die Pappe liegt bereit" : "The cardboard is ready";
    await sendUserTurn(`${checkedEvidence}.`, `${name}-activity-checked`);
    const checked = action({ type: "manage_shared_activity", operation: "confirm_step", id: original.id,
      step: "checked", detail: checkedEvidence, evidence: checkedEvidence });
    assert.equal(checked.status, "pending_confirmation");
    publish({ type: "assistant-end", text: checked.confirmationQuestion });
    await sendUserTurn(name === "pcm" ? "Ja." : "Yes.", `${name}-activity-checked-yes`);
    const checkedTask = structuredClone(engine.getState().pendingIntention);
    assert.equal(checkedTask.status, "active");
    assert.deepEqual(checkedTask.activity.confirmed.map((step) => step.step), ["checked"]);

    const preparedDetail = name === "pcm" ? "Die Schere und der Kleber liegen bereit" : "The scissors and glue are ready";
    await sendUserTurn(`${preparedDetail}.`, `${name}-activity-prepared`);
    const prepared = action({ type: "manage_shared_activity", operation: "confirm_step", id: original.id,
      step: "prepared", detail: preparedDetail, evidence: preparedDetail });
    assert.equal(prepared.status, "pending_confirmation");
    const taskWithUnconfirmedStep = structuredClone(engine.getState().pendingIntention);
    assert.equal(taskWithUnconfirmedStep.status, "active");
    assert.equal(taskWithUnconfirmedStep.activity.pending.step, "prepared");
    assert.equal(taskWithUnconfirmedStep.activity.pending.askedAt, null);

    const detailReplacement = name === "pcm"
      ? "Gerda war eine Papierrakete. Die Schere und der Kleber liegen bereit."
      : "Gerda was a paper rocket. The scissors and glue were ready.";
    const detailCorrectionText = name === "pcm"
      ? `Korrektur zu Gerda: ${detailReplacement}`
      : `Correction to Gerda: ${detailReplacement}`;
    await sendUserTurn(detailCorrectionText, `${name}-active-activity-correction`);
    const pausedByCorrection = structuredClone(engine.getState().pendingIntention);
    assert.equal(pausedByCorrection.id, taskWithUnconfirmedStep.id, `${name}: correction preserves the active task identity`);
    assert.equal(pausedByCorrection.status, "paused", `${name}: correction deliberately pauses an active shared activity`);
    assert.equal(pausedByCorrection.activity.pending, null, `${name}: correction discards its unconfirmed prepared step`);
    assert.deepEqual(pausedByCorrection.activity.confirmed, checkedTask.activity.confirmed, `${name}: confirmed checked milestone survives correction`);
    assert.equal(pausedByCorrection.lastConfirmedStep, checkedEvidence);
    assert.equal(events.requiresBehaviorTurnCommit(sessionId), true);

    const activeCorrection = action({ type: "correct_experience", id: original.id, field: "detail",
      replacement: detailReplacement, evidence: detailCorrectionText });
    assert.equal(activeCorrection.status, "correction_pending", `${name}: paused active task does not block grounded memory correction`);
    assert.equal(engine.getState().companion.episodes[0].detail, original.detail, `${name}: corrected detail stays unchanged while confirmation is pending`);
    publish({ type: "assistant-end", text: activeCorrection.confirmationQuestion });
    const taskAfterCorrectionQuestion = structuredClone(engine.getState().pendingIntention);
    await sendUserTurn(name === "pcm" ? "Ja." : "Yes.", `${name}-active-activity-correction-yes`);
    assert.equal(engine.getState().companion.episodes[0].detail, detailReplacement);
    assert.deepEqual(engine.getState().pendingIntention, taskAfterCorrectionQuestion, `${name}: final yes does not advance or resume the activity`);
    assert.equal(engine.getState().pendingIntention.id, taskWithUnconfirmedStep.id);
    assert.deepEqual(engine.getState().pendingIntention.activity.confirmed, checkedTask.activity.confirmed);
    assert.equal(engine.getState().pendingIntention.activity.pending, null);

    await sendUserTurn(name === "pcm" ? "Was lag bereit: Schere und der Kleber?" : "What was ready: scissors and glue?", `${name}-activity-correction-search`);
    const correctedSearch = action({ type: "search_experiences", query: name === "pcm" ? "Schere und der Kleber" : "scissors and glue" });
    assert.equal(correctedSearch.status, "candidates_found", `${name}: public search matches the exact corrected detail`);
    const correctedEpisode = correctedSearch.matches.find((item) => item.episode.id === original.id)?.episode;
    assert.ok(correctedEpisode, `${name}: public search returns the activity correction`);
    assert.equal(correctedEpisode.detail, detailReplacement);
    assert.equal(correctedEpisode.corrections.detail.evidence, detailCorrectionText);
    assert.equal(correctedEpisode.corrections.outcome.evidence, correctionEvidence);
    assert.equal(correctedEpisode.id, original.id);
    assert.deepEqual(correctedEpisode.source, original.source);
  } finally {
    events.endBehaviorSession(sessionId);
    transport.active = false;
    fixture.uninstallRuntime();
    engine.dispose();
  }
}

await testTransport("pcm");
await testTransport("webrtc");
console.log("Shared episode correction runtime: real PCM + WebRTC tool handlers, heard confirmation, stable episode identity, correction provenance and independent task continuity PASS (local transcripts/native playback fixture; no model or hardware)");
