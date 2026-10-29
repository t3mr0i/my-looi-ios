import assert from "node:assert/strict";
import { createCompanionLiveRuntime } from "./helpers/companion-live-runtime.mjs";

const flush = async () => { for (let index = 0; index < 40; index += 1) await Promise.resolve(); };

function configureTransport(fixture, name, sessionId) {
  fixture.preferences.language = name === "webrtc" ? "en" : "de";
  fixture.preferences.listeningLanguage = fixture.preferences.language;
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
  fixture.events.beginBehaviorSession(sessionId, () => transport.applySessionPreferences("shared-episode-overview-test"));
  return { transport, messages };
}

function toolOutput(messages, callId) {
  const event = messages.find((item) => item.item?.type === "function_call_output" && item.item.call_id === callId);
  assert.ok(event, `the transport returns a function_call_output for ${callId}`);
  return JSON.parse(event.item.output);
}

async function sendUserTurn(transport, messages, text, itemId) {
  const start = messages.length;
  await transport.handleEvent({ type: "input_audio_buffer.speech_started" });
  await transport.handleEvent({ type: "input_audio_buffer.speech_stopped" });
  await transport.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: text, item_id: itemId });
  await flush();
  return messages.slice(start);
}

async function openResponse(transport, messages, text, itemId, responseId) {
  const turnEvents = await sendUserTurn(transport, messages, text, itemId);
  const clientRequest = turnEvents.find((item) => item.type === "response.create");
  await transport.handleEvent({ type: "response.created", response: {
    id: responseId,
    ...(clientRequest?.response?.metadata ? { metadata: clientRequest.response.metadata } : {}),
  } });
  await flush();
  return { turnEvents, clientRequest };
}

async function invokeTool(transport, responseId, callId, name, args) {
  await transport.handleEvent({
    type: "response.output_item.done",
    response_id: responseId,
    item: { type: "function_call", call_id: callId, name, arguments: JSON.stringify(args) },
  });
  await flush();
  return callId;
}

function expectedEpisode(episode) {
  return {
    id: episode.id,
    title: episode.title,
    detail: episode.detail,
    outcome: episode.outcome,
    createdAt: episode.createdAt,
    source: { ...episode.source },
    ...(episode.corrections ? { corrections: structuredClone(episode.corrections) } : {}),
  };
}

function readOnlyState(fixture, transport) {
  const state = fixture.behaviorEngine.getState();
  return {
    companion: structuredClone(state.companion),
    pendingIntention: structuredClone(state.pendingIntention),
    game: structuredClone(state.game),
    objectReference: structuredClone(state.objectReference),
    armedRituals: transport.armedSharedRituals.size,
    attemptedRituals: transport.attemptedSharedRituals.size,
  };
}

async function seedConfirmedEpisodes(fixture, sessionId, publish, action, language) {
  const entries = [
    {
      title: "Gerda",
      evidence: language === "de" ? "Wir haben heute gemeinsam den Papierdrachen Gerda gebaut." : "We built the paper kite Gerda together today.",
      detail: language === "de"
        ? "Wir bauten Gerda aus dünnem Papier, verstärkten die Kanten mit Holzstäbchen, banden einen langen blauen Schwanz an und ließen den Drachen am windigen Feld hinter dem alten Gewächshaus steigen."
        : "We built Gerda from thin paper, reinforced its edges with wooden sticks, tied on a long blue tail, and flew the kite in the windy field behind the old greenhouse.",
      outcome: language === "de"
        ? "Gerda stieg bis über die Birke und landete schließlich neben dem roten Gartenstuhl."
        : "Gerda rose above the birch tree and finally landed beside the red garden chair.",
    },
    {
      title: "Mondvogel",
      evidence: language === "de" ? "Wir haben zusammen den Mondvogel aus Karton gefaltet." : "We folded the Moonbird from cardboard together.",
      detail: language === "de"
        ? "Wir falteten den Mondvogel aus festem Karton, zeichneten silberne Federn auf beide Flügel und stellten ihn auf das Bücherregal neben das Fenster."
        : "We folded the Moonbird from sturdy cardboard, drew silver feathers on both wings, and placed it on the bookshelf beside the window.",
      outcome: language === "de"
        ? "Er blieb beim ersten Flugversuch auf dem Teppich liegen, und wir verstärkten danach seinen Schnabel."
        : "It stayed on the rug during its first flight attempt, and afterward we reinforced its beak.",
    },
    {
      title: "Kieselpfad",
      evidence: language === "de" ? "Wir haben am Bach gemeinsam einen kleinen Kieselpfad gelegt." : "We laid a small pebble path by the creek together.",
      detail: language === "de"
        ? "Wir sortierten flache Kiesel nach Form, legten sie zwischen die beiden großen Ufersteine und ließen in der Mitte eine schmale Lücke für das Wasser."
        : "We sorted flat pebbles by shape, laid them between the two large bank stones, and left a narrow opening in the middle for the water.",
      outcome: language === "de"
        ? "Das Wasser floss durch die Lücke, ohne den Pfad wegzuspülen, und wir wollten beim nächsten Spaziergang nachsehen."
        : "The water flowed through the opening without washing the path away, and we planned to check it on our next walk.",
    },
  ];

  for (const entry of entries) {
    publish({ type: "user-turn", text: entry.evidence, turnId: `${language}-seed-${entry.title}` });
    const proposal = action({
      type: "propose_experience", title: entry.title, detail: entry.detail, outcome: entry.outcome,
      motif: "hold", evidence: entry.evidence,
    });
    assert.equal(proposal.status, "proposed", `${entry.title} starts as a pending proposal`);
    publish({ type: "assistant-end", text: language === "de" ? `Soll ich ${entry.title} speichern?` : `Should I remember ${entry.title}?` });
    publish({ type: "user-turn", text: language === "de" ? "Ja, bitte." : "Yes, please.", turnId: `${language}-confirm-${entry.title}` });
    await flush();
  }

  const originalEpisode = fixture.behaviorEngine.getState().companion.episodes.find((episode) => episode.title === "Gerda");
  assert.ok(originalEpisode, "the fixture has a confirmed episode to correct");
  const replacement = language === "de"
    ? "Gerda flog über die Birke hinaus und landete hinter dem langen Holztisch neben der gelben Gießkanne; beim nächsten Mal knoten wir den Schwanz weiter oben fest."
    : "Gerda flew past the birch and landed behind the long wooden table beside the yellow watering can; next time we will tie the tail higher up.";
  const correctionEvidence = language === "de"
    ? `Korrektur zu Gerda: ${replacement}`
    : `Correction for Gerda: ${replacement}`;
  publish({ type: "user-turn", text: correctionEvidence, turnId: `${language}-correct-gerda` });
  const correction = action({
    type: "correct_experience", id: originalEpisode.id, field: "outcome", replacement, evidence: correctionEvidence,
  });
  assert.equal(correction.status, "correction_pending", "a correction remains pending until its heard question is confirmed");
  publish({ type: "assistant-end", text: correction.confirmationQuestion });
  publish({ type: "user-turn", text: language === "de" ? "Ja." : "Yes.", turnId: `${language}-confirm-correction` });
  await flush();

  const saved = fixture.behaviorEngine.getState().companion.episodes;
  assert.equal(saved.length, 3, "only the three explicitly confirmed episodes are saved");
  const corrected = saved.find((episode) => episode.id === originalEpisode.id);
  assert.equal(corrected.outcome, replacement, "the fixture stores the corrected current fact");
  assert.equal(corrected.corrections.outcome.evidence, correctionEvidence, "the corrected fact keeps its exact source quote");
  return saved;
}

async function testTransport(name) {
  // This uses the real behavior runtime, public behavior event adapter, and the
  // selected production Realtime transport's event/tool handler. The server,
  // model response events, native PCM/WebRTC devices, audio capture and robot
  // hardware are replaced by this helper's offline shims; no API or device is started.
  const fixture = createCompanionLiveRuntime();
  const sessionId = `offline-shared-episode-overview-${name}`;
  const { transport, messages } = configureTransport(fixture, name, sessionId);
  const { events, behaviorEngine: engine } = fixture;
  const language = fixture.preferences.language;
  const publish = (event) => events.publishBehaviorEvent({ ...event, sessionId });
  const action = (value) => events.performBehaviorCompanionAction(value, sessionId);

  try {
    const currentEpisodes = await seedConfirmedEpisodes(fixture, sessionId, publish, action, language);
    assert.equal(events.requiresBehaviorTurnCommit(sessionId), false, `${name}: ordinary conversation keeps automatic VAD admission`);
    const normalSession = fixture.config.buildRealtimeSessionUpdate(
      fixture.preferences, undefined, undefined, events.getBehaviorConversationContext(sessionId), events.requiresBehaviorTurnCommit(sessionId),
    ).session;
    assert.equal(normalSession.audio.input.turn_detection.create_response, true, `${name}: the ordinary VAD response path remains enabled`);

    const previewQuestion = language === "de" ? "Was ist mit Gerda passiert?" : "What happened to Gerda?";
    publish({ type: "user-turn", text: previewQuestion, turnId: `${name}-compact-preview-turn` });
    await flush();
    const previewContext = JSON.parse(events.getBehaviorConversationContext(sessionId));
    const compactPreview = previewContext.companion.episodes.find((episode) => episode.title === "Gerda");
    assert.ok(compactPreview, `${name}: exact-title interaction context has the existing compact preview`);
    const correctedFact = currentEpisodes.find((episode) => episode.title === "Gerda");
    assert.ok(compactPreview.outcome.length < correctedFact.outcome.length, `${name}: ordinary interaction context truncates the current corrected fact`);

    const toolByName = new Map(normalSession.tools.map((tool) => [tool.name, tool]));
    const overviewTool = toolByName.get("list_shared_experiences");
    assert.ok(overviewTool, `${name}: the actual production session config exposes the overview function`);
    assert.deepEqual(overviewTool.parameters.required, [], `${name}: overview takes no required arguments`);
    assert.deepEqual(overviewTool.parameters.properties, {}, `${name}: overview has an empty argument object`);
    assert.equal(overviewTool.parameters.additionalProperties, false, `${name}: overview rejects extra properties`);
    assert.match(normalSession.instructions, /broad question[^\n]*list_shared_experiences/u, `${name}: production instructions route broad questions to the list`);

    // A paused ordinary task is independent state and should survive retrieval.
    publish({ type: "intention", action: "pause", goal: "Papierflieger fertigstellen", lastConfirmedStep: "Flügel gefaltet" });
    const pausedTask = structuredClone(engine.getState().pendingIntention);
    assert.equal(pausedTask.status, "paused");

    // A separately pending, unconfirmed proposal is retired by the next broad
    // user turn through the existing turn rule. The list itself is measured
    // only after that transcript commit, so it cannot be blamed for the clear.
    const pendingEvidence = language === "de" ? "Wir haben noch eine unbestätigte Erinnerung." : "We have one unconfirmed memory draft.";
    publish({ type: "user-turn", text: pendingEvidence, turnId: `${name}-unconfirmed-draft` });
    const unconfirmed = action({ type: "propose_experience", title: "Entwurf", detail: "A draft only.", outcome: "Not saved yet.", motif: "hold", evidence: pendingEvidence });
    assert.equal(unconfirmed.status, "proposed");
    publish({ type: "assistant-end", text: language === "de" ? "Soll ich den Entwurf speichern?" : "Should I save the draft?" });
    assert.ok(engine.getState().companion.pendingExperience, `${name}: the setup has a real pending confirmation before the overview turn`);

    const broadQuestion = language === "de" ? "Was haben wir zusammen erlebt?" : "What have we experienced together?";
    const responseId = `${name}-overview-response`;
    assert.ok(engine.getState().companion.pendingExperience, `${name}: pending confirmation is still present immediately before fresh speech and transcript events`);
    const { turnEvents } = await openResponse(transport, messages, broadQuestion, `${name}-overview-turn`, responseId);
    assert.equal(engine.getState().companion.pendingExperience, null, `${name}: the ordinary new-turn rule clears the unanswered draft before the list call`);
    assert.deepEqual(engine.getState().pendingIntention, pausedTask, `${name}: the new overview turn leaves the paused task as the ordinary event path does`);
    assert.equal(events.getBehaviorInteractionSnapshot(sessionId)?.userTurnRevision > 0, true, `${name}: response.created has a committed transcript binding`);
    if (events.requiresBehaviorTurnCommit(sessionId)) assert.ok(turnEvents.some((item) => item.type === "response.create"), `${name}: any pre-existing manual gate still commits its response`);
    const sessionUpdate = messages.findLast((item) => item.type === "session.update");
    assert.ok(sessionUpdate?.session?.tools?.some((tool) => tool.name === "list_shared_experiences"), `${name}: the actual transport session update carries the production overview tool`);

    const beforeList = readOnlyState(fixture, transport);
    for (const [callId, malformedArgs] of [
      [`${name}-overview-extra-arg`, { extra: true }],
      [`${name}-overview-array-args`, []],
      [`${name}-overview-null-args`, null],
    ]) {
      await invokeTool(transport, responseId, callId, "list_shared_experiences", malformedArgs);
      assert.equal(toolOutput(messages, callId).status, "invalid_action", `${name}: malformed overview arguments are rejected by the actual handler`);
      assert.deepEqual(readOnlyState(fixture, transport), beforeList, `${name}: malformed overview calls have no side effects`);
    }
    const listCallId = `${name}-overview-list`;
    await invokeTool(transport, responseId, listCallId, "list_shared_experiences", {});
    const listed = toolOutput(messages, listCallId);
    const expectedEpisodes = currentEpisodes
      .slice()
      .sort((left, right) => right.createdAt - left.createdAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map(expectedEpisode);
    assert.equal(listed.ok, true);
    assert.equal(listed.status, "experiences_listed");
    assert.equal(listed.total, 3);
    assert.deepEqual(listed.episodes, expectedEpisodes, `${name}: the actual no-argument handler returns all confirmed episodes in deterministic order`);
    assert.match(listed.instruction, /later current user turn names exactly one saved title/u);
    assert.deepEqual(listed.episodes[0], expectedEpisodes[0]);
    const fullCorrected = listed.episodes.find((episode) => episode.title === "Gerda");
    assert.equal(fullCorrected.outcome, currentEpisodes.find((episode) => episode.title === "Gerda").outcome, `${name}: overview returns the full corrected current outcome`);
    assert.ok(fullCorrected.outcome.includes(language === "de" ? "gelben Gießkanne" : "yellow watering can"), `${name}: overview includes the corrected factual tail beyond the compact preview`);
    assert.ok(!compactPreview.outcome.includes(language === "de" ? "gelben Gießkanne" : "yellow watering can"), `${name}: that saved factual tail was absent from the compact preview`);
    assert.equal(fullCorrected.corrections.outcome.evidence, `${language === "de" ? "Korrektur zu Gerda: " : "Correction for Gerda: "}${fullCorrected.outcome}`, `${name}: the full result retains correction provenance`);
    assert.equal(fullCorrected.source.evidence, currentEpisodes.find((episode) => episode.title === "Gerda").source.evidence, `${name}: original source evidence remains available`);
    assert.equal(engine.getState().companion.pendingExperience, null, `${name}: listing creates no new pending confirmation`);
    assert.ok(!["armed", "started"].includes(engine.getState().companion.scene.status), `${name}: listing does not create an armed ritual or activity scene`);
    assert.deepEqual(readOnlyState(fixture, transport), beforeList, `${name}: the list call leaves episodes, provenance, task, game, scene and ritual leases unchanged`);

    // The one-action-per-turn guard is shared with every other companion tool.
    const duplicateCallId = `${name}-overview-duplicate`;
    await invokeTool(transport, responseId, duplicateCallId, "list_shared_experiences", {});
    assert.equal(toolOutput(messages, duplicateCallId).status, "already-handled-this-turn", `${name}: a second companion action on this turn is rejected`);
    assert.deepEqual(readOnlyState(fixture, transport), beforeList, `${name}: the rejected duplicate also leaves state unchanged`);

    // Knowing the id from the overview alone is not an exact title reference.
    const unnamedQuestion = language === "de" ? "Kannst du mir noch einmal etwas davon erzählen?" : "Could you tell me a little more about one of those?";
    const unnamedResponseId = `${name}-overview-unnamed-response`;
    await openResponse(transport, messages, unnamedQuestion, `${name}-overview-unnamed-turn`, unnamedResponseId);
    const unnamedCallId = `${name}-overview-unnamed-recall`;
    await invokeTool(transport, unnamedResponseId, unnamedCallId, "recall_shared_experience", { id: fullCorrected.id });
    assert.equal(toolOutput(messages, unnamedCallId).status, "reference_not_named", `${name}: the overview id does not grant a title-specific recall`);
    assert.deepEqual(engine.getState().companion.episodes, currentEpisodes, `${name}: the rejected untitled recall leaves episodes unchanged`);

    const exactQuestion = language === "de" ? "Erzähl mir bitte noch einmal von Gerda." : "Please tell me about Gerda again.";
    const exactResponseId = `${name}-overview-exact-response`;
    await openResponse(transport, messages, exactQuestion, `${name}-overview-exact-turn`, exactResponseId);
    const exactCallId = `${name}-overview-exact-recall`;
    await invokeTool(transport, exactResponseId, exactCallId, "recall_shared_experience", { id: fullCorrected.id });
    const exactRecall = toolOutput(messages, exactCallId);
    assert.equal(exactRecall.status, "recalled", `${name}: a later exact-title turn reuses the existing recall path`);
    assert.equal(exactRecall.episode.outcome, fullCorrected.outcome, `${name}: exact recall carries the same current corrected fact`);
    assert.deepEqual(exactRecall.episode.corrections, fullCorrected.corrections, `${name}: exact recall keeps correction provenance`);
    assert.deepEqual(engine.getState().pendingIntention, pausedTask, `${name}: recall keeps the independent paused task intact`);

    // Existing active game state still owns manual response admission. Listing
    // does not advance/stop it or consume a guess.
    publish({ type: "game-command", action: "start" });
    assert.equal(engine.getState().game.status, "active", `${name}: game setup is active`);
    assert.equal(events.requiresBehaviorTurnCommit(sessionId), true, `${name}: active game keeps its committed-turn response gate`);
    const gameUpdateStart = messages.length;
    transport.applySessionPreferences("overview-preserve-game-gate");
    const gameSessionUpdate = messages.slice(gameUpdateStart).findLast((item) => item.type === "session.update");
    assert.equal(gameSessionUpdate.session.audio.input.turn_detection.create_response, false, `${name}: the active game keeps automatic VAD response creation disabled`);
    const gameQuestion = language === "de" ? "Welche gemeinsamen Erinnerungen sind gespeichert?" : "Which shared memories are saved?";
    const gameResponseId = `${name}-overview-game-response`;
    const gameTurn = await openResponse(transport, messages, gameQuestion, `${name}-overview-game-turn`, gameResponseId);
    assert.ok(gameTurn.clientRequest, `${name}: the existing game path explicitly requests its committed response`);
    const beforeGameList = readOnlyState(fixture, transport);
    const gameListCallId = `${name}-overview-game-list`;
    await invokeTool(transport, gameResponseId, gameListCallId, "list_shared_experiences", {});
    assert.equal(toolOutput(messages, gameListCallId).total, 3, `${name}: overview remains available on the existing manual game response path`);
    assert.deepEqual(readOnlyState(fixture, transport), beforeGameList, `${name}: listing leaves active game, paused task and companion state unchanged`);

    // A response that lost authorization after fresh speech and a committed
    // later turn cannot mutate memory or schedule its follow-up.
    const responseCreatesBeforeNewTurn = messages.filter((item) => item.type === "response.create").length;
    const staleTurn = language === "de" ? "Was haben wir zusammen erlebt?" : "What have we experienced together?";
    const staleTurnEvents = await sendUserTurn(transport, messages, staleTurn, `${name}-overview-stale-new-turn`);
    assert.ok(staleTurnEvents.some((item) => item.type === "response.create"), `${name}: the active game still commits a fresh turn before the delayed old tool`);
    const newResponseId = `${name}-overview-new-current-response`;
    await transport.handleEvent({ type: "response.created", response: { id: newResponseId } });
    await flush();
    const responseCreatesAtCommit = messages.filter((item) => item.type === "response.create").length;
    const beforeStale = readOnlyState(fixture, transport);
    const staleCallId = `${name}-overview-stale-list`;
    await invokeTool(transport, gameResponseId, staleCallId, "list_shared_experiences", {});
    assert.equal(toolOutput(messages, staleCallId).status, "stale-turn", `${name}: the prior response is revoked by fresh speech/turn commit`);
    assert.equal(messages.filter((item) => item.type === "response.create").length, responseCreatesAtCommit, `${name}: stale tool output schedules no follow-up`);
    assert.ok(responseCreatesAtCommit > responseCreatesBeforeNewTurn, `${name}: a new committed response exists before stale output rejection`);
    assert.deepEqual(readOnlyState(fixture, transport), beforeStale, `${name}: stale overview action leaves all state unchanged`);
  } finally {
    events.endBehaviorSession(sessionId);
    transport.active = false;
    transport.webSocket = null;
    transport.dataChannel = null;
    fixture.uninstallRuntime();
    engine.dispose();
  }
}

async function testEmptyCollection(name) {
  const fixture = createCompanionLiveRuntime();
  const sessionId = `offline-shared-episode-overview-empty-${name}`;
  const { transport, messages } = configureTransport(fixture, name, sessionId);
  try {
    assert.deepEqual(fixture.behaviorEngine.getState().companion.episodes, [], `${name}: empty fixture starts with no confirmed episodes`);
    const language = fixture.preferences.language;
    const question = language === "de" ? "Was haben wir zusammen erlebt?" : "What have we experienced together?";
    const responseId = `${name}-overview-empty-response`;
    await openResponse(transport, messages, question, `${name}-overview-empty-turn`, responseId);
    const callId = `${name}-overview-empty-list`;
    await invokeTool(transport, responseId, callId, "list_shared_experiences", {});
    const result = toolOutput(messages, callId);
    assert.equal(result.ok, true);
    assert.equal(result.status, "no_saved_experiences", `${name}: empty state distinguishes no saved memories`);
    assert.deepEqual(result.episodes, []);
    assert.equal(result.total, 0);
    assert.equal(fixture.behaviorEngine.getState().companion.pendingExperience, null);
    assert.ok(!["armed", "started"].includes(fixture.behaviorEngine.getState().companion.scene.status));
  } finally {
    fixture.events.endBehaviorSession(sessionId);
    transport.active = false;
    transport.webSocket = null;
    transport.dataChannel = null;
    fixture.uninstallRuntime();
    fixture.behaviorEngine.dispose();
  }
}

for (const name of ["pcm", "webrtc"]) {
  await testTransport(name);
  await testEmptyCollection(name);
}

console.log("Shared episode overview runtime (offline PCM + WebRTC): PASS");
