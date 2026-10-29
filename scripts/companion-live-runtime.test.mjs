import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";
import { createCompanionLiveRuntime } from "./helpers/companion-live-runtime.mjs";
import { companionLiveCases } from "./companion-live-cases.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flush = async () => {
  for (let index = 0; index < 32; index += 1) await Promise.resolve();
};

function evaluationSnapshot(engine) {
  const state = engine.getState();
  const episodes = (state.companion?.episodes ?? []).map((episode) => ({
    id: episode.id,
    title: episode.title,
    ritualMode: episode.personalRitual?.mode ?? null,
  }));
  return {
    repairRequired: state.repairRequired === true,
    game: state.game ? { status: state.game.status } : null,
    pendingIntention: state.pendingIntention ? {
      status: state.pendingIntention.status,
      goal: state.pendingIntention.goal,
      lastConfirmedStep: state.pendingIntention.lastConfirmedStep ?? null,
      activity: state.pendingIntention.activity ? {
        phase: state.pendingIntention.activity.phase,
        pending: state.pendingIntention.activity.pending
          ? { step: state.pendingIntention.activity.pending.step }
          : null,
      } : null,
    } : null,
    companion: { episodes },
    interactionPhase: state.moment?.phase ?? null,
  };
}

const defaultModelId = createTypeScriptTreeLoader()(path.join(root, "src/openai/realtime-models.ts")).DEFAULT_REALTIME_MODEL_ID;
const independentRealtimeConfig = createTypeScriptTreeLoader()(path.join(root, "src/voice/realtime-config.ts"));
const cases = [...companionLiveCases];
assert.equal(cases.length, 6, "the offline runtime check covers every current live-eval fixture");
assert.equal(new Set(cases.map((item) => item.id)).size, cases.length, "fixture ids are unique");

const results = [];
for (const testCase of cases) {
  const runtime = createCompanionLiveRuntime({
    robotName: testCase.robotName ?? "LOOI",
    memoryFacts: testCase.memoryFacts ?? [],
  });
  const sessionId = `offline-companion-${testCase.id}`;
  const contextUpdates = [];
  const beforeSetup = runtime.behaviorEngine.getState();
  assert.equal(beforeSetup.sessionId, null, `${testCase.id} starts with an isolated engine`);
  assert.equal(beforeSetup.companion.episodes.length, 0, `${testCase.id} starts without another fixture's episodes`);
  assert.equal(beforeSetup.pendingIntention, null, `${testCase.id} starts without another fixture's task`);
  assert.equal(runtime.preferences.cameraAttentionEnabled, false, `${testCase.id} does not grant Camera Attention`);
  assert.equal(runtime.runtime.useBehaviorStore.getState().settings.visualEnabled, false, `${testCase.id} keeps visual behavior disabled`);

  try {
    runtime.events.beginBehaviorSession(sessionId, (context) => contextUpdates.push(context));
    assert.equal(runtime.behaviorEngine.getState().sessionId, sessionId);
    assert.equal(runtime.events.requiresBehaviorTurnCommit(sessionId), false);

    const setup = {
      events: runtime.events,
      sessionId,
      engine: runtime.behaviorEngine,
      performAction: (action) => runtime.events.performBehaviorCompanionAction(action, sessionId),
      publishEvent: (event) => runtime.events.publishBehaviorEvent({ ...event, sessionId }),
    };
    if (typeof testCase.setup === "function") await testCase.setup(setup);

    // Mirror the live runner's public transcript handoff. No response or model
    // is synthesized here; tests exercise only local setup/action policy.
    setup.publishEvent({ type: "user-turn", text: testCase.userText });
    await flush();

    const seededEpisodes = runtime.behaviorEngine.getState().companion.episodes;
    if (testCase.id === "de-open-task-gated-checking-step" || (testCase.id === "de-recall-confirmed-long-detail-tail" && testCase.expected.requiredStatus === "candidates_found")) {
      assert.equal(seededEpisodes.length, 1, `${testCase.id} independently seeds exactly one confirmed Gerda episode`);
      assert.equal(seededEpisodes[0].title, "Gerda");
      assert.ok(seededEpisodes[0].confirmedAt, "setup confirms the episode only after its question and affirmative turn");
    }

    if (testCase.expected?.requiredTool === "manage_shared_activity") {
      const episode = seededEpisodes.find((item) => item.title === "Gerda");
      assert.ok(episode, "activity setup resolves its own confirmed episode id");
      const result = setup.performAction({
        type: "manage_shared_activity",
        operation: "begin",
        id: episode.id,
        evidence: testCase.userText,
      });
      assert.equal(result.status, testCase.expected.requiredStatus);
      assert.equal(testCase.expected.state(evaluationSnapshot(runtime.behaviorEngine)), true,
        "the real runtime exposes the expected pending, non-started activity state");
      assert.equal(runtime.behaviorEngine.getState().pendingIntention.activity.phase, "checking");
      assert.equal(runtime.behaviorEngine.getState().pendingIntention.activity.pending.step, "begin");
    } else if (testCase.expected?.requiredTool === "search_shared_experiences") {
      const beforeSearch = JSON.stringify(seededEpisodes);
      const result = setup.performAction({
        type: "search_experiences",
        query: testCase.expected.searchQuery,
      });
      assert.equal(result.status, testCase.expected.requiredStatus);
      if (testCase.expected.requiredStatus === "candidates_found") {
        assert.equal(result.totalMatches, 1, "candidate search counts the one stored matching episode");
        assert.equal(result.matches.length, 1, "candidate search returns the matching episode");
        const candidate = result.matches[0];
        assert.equal(candidate.episode.title, "Gerda", "candidate facts retain their saved episode attribution");
        assert.equal(candidate.episode.detail, seededEpisodes[0].detail, "search returns the full bounded detail, including its tail");
        assert.equal(candidate.episode.outcome, seededEpisodes[0].outcome, "search returns the confirmed outcome without claiming current identity");
        assert.ok(candidate.matchedTerms.includes("rakete"), "candidate result explains the lexical match");
        assert.ok(candidate.episode.detail.includes("Flossen dreimal") && candidate.episode.detail.includes("Nase"),
          "the candidate preserves late fin-check and nose-repair facts");
        assert.ok(candidate.episode.outcome.includes("ersten Wurf") && candidate.episode.outcome.includes("Zaun"),
          "the candidate preserves the first-throw landing detail");
      } else {
        assert.equal(result.totalMatches, 0, "a quoted but unconfirmed event matches no saved episode");
        assert.deepEqual(result.matches, [], "a no-candidate search returns no episode facts");
        assert.equal(seededEpisodes.length, 0, "the quoted-event fixture has no episode to mutate or attribute");
      }
      assert.equal(JSON.stringify(runtime.behaviorEngine.getState().companion.episodes), beforeSearch,
        "read-only candidate search does not update episode use, ritual offer, or cooldown state");
      assert.equal(testCase.expected.state(evaluationSnapshot(runtime.behaviorEngine)), true);
      if (testCase.expected.requiredStatus === "candidates_found") {
        setup.publishEvent({ type: "user-turn", text: "Gerda, weißt du noch, wie wir die Papierrakete gebaut haben und was beim ersten Wurf passiert ist?" });
        const exactRecall = setup.performAction({ type: "recall_experience", id: result.matches[0].episode.id });
        assert.equal(exactRecall.status, "recalled", "a later exact-title turn still uses the existing explicit recall path");
        assert.equal(exactRecall.episode.detail, seededEpisodes[0].detail, "exact-title recall still returns the full confirmed detail");
        assert.equal(exactRecall.episode.outcome, seededEpisodes[0].outcome, "exact-title recall still returns the confirmed outcome");
        assert.ok(exactRecall.episode.detail.includes("Flossen dreimal") && exactRecall.episode.detail.includes("Nase"),
          "exact-title recall retains the long detail-tail facts");
        assert.ok(exactRecall.episode.outcome.includes("ersten Wurf") && exactRecall.episode.outcome.includes("Zaun"),
          "exact-title recall retains the late outcome facts");
      }
    } else if (testCase.expected?.requiredTool === "recall_shared_experience") {
      const episode = seededEpisodes.find((item) => item.title === "Gerda");
      assert.ok(episode, "recall setup resolves its own confirmed episode id");
      const result = setup.performAction({ type: "recall_experience", id: episode.id });
      assert.equal(result.status, testCase.expected.requiredStatus);
      assert.equal(result.episode.id, episode.id);
      assert.equal(result.episode.detail, episode.detail, "successful runtime recall returns the full bounded detail, including its tail");
      assert.equal(result.episode.outcome, episode.outcome, "successful runtime recall returns the confirmed outcome");
      assert.ok(result.episode.detail.length > 70, "the recalled detail includes facts beyond the compact prompt preview");
      assert.ok(result.episode.detail.includes("Flossen dreimal") && result.episode.detail.includes("Nase"),
        "the recalled detail preserves the fixture's late fin-check and nose-repair facts");
      assert.ok(result.episode.outcome.includes("ersten Wurf") && result.episode.outcome.includes("Zaun"),
        "the recalled outcome preserves the fixture's late first-throw landing detail");
      assert.equal(testCase.expected.state(evaluationSnapshot(runtime.behaviorEngine)), true);
    } else if (testCase.id === "de-natural-reference-correction") {
      assert.equal(testCase.expected.state(evaluationSnapshot(runtime.behaviorEngine)), true,
        "the real runtime marks the corrected reference as needing repair");
      assert.equal(runtime.events.requiresBehaviorTurnCommit(sessionId), true,
        "the correction gate requires a committed transcript before the next response");
      assert.match(runtime.events.getBehaviorConversationContext(sessionId), /referenceRepair/u,
        "the real behavior context carries the structured correction marker");
    } else {
      if (typeof testCase.expected?.state === "function") {
        assert.equal(testCase.expected.state(evaluationSnapshot(runtime.behaviorEngine)), true,
          `${testCase.id} setup/input leaves its expected local state`);
      }
    }

    if (testCase.id === "de-personal-memory-and-robot-alias") {
      const records = await runtime.localMemoryDatabase.search("Lena");
      assert.equal(records.length, 1, "the case-local memory fixture can be retrieved from local memory only");
      assert.equal(records[0].memory, "Die Nutzerin heißt Lena.");
      assert.equal(runtime.preferences.robotName, "LOOI", "the robot's configured primary name remains distinct from the address alias");
    }

    if (testCase.id === "de-quoted-event-and-unsupported-physical-action") {
      assert.equal(seededEpisodes.length, 0, "quoted story text does not seed a shared episode");
      assert.equal(runtime.behaviorEngine.getState().pendingIntention, null);
      assert.notEqual(runtime.behaviorEngine.getState().game?.status, "active");
    }

    const update = runtime.config.buildRealtimeSessionUpdate(
      runtime.preferences,
      undefined,
      (testCase.memoryFacts ?? []).map((fact) => `- ${String(fact.memory).slice(0, 350)}`).join("\n") || undefined,
      runtime.events.getBehaviorConversationContext(sessionId),
      runtime.events.requiresBehaviorTurnCommit(sessionId),
    );
    assert.equal(update.session.model, defaultModelId, "the actual production config keeps the configured realtime model");
    assert.equal(update.session.max_output_tokens, 768, "the production response token limit remains 768");
    const toolNames = update.session.tools.map((tool) => tool.name);
    for (const name of ["search_memory", "remember", "recall_shared_experience", "manage_shared_activity", "set_language_preferences"]) {
      assert.ok(toolNames.includes(name), `the production tool list retains ${name}`);
    }
    assert.equal(update.session.audio.input.turn_detection.create_response,
      !runtime.events.requiresBehaviorTurnCommit(sessionId),
      "only the actual correction/pending-confirmation gate disables automatic response admission");
    const directExecutionTools = update.session.tools
      .map((tool) => tool.name)
      .filter((name) => /^(?:move|drive|turn|capture|take_photo|look_here|start_audio|play_audio|record_audio|execute_physical)/iu.test(name));
    assert.deepEqual(directExecutionTools, [], "production Realtime tools expose no direct motor, camera, or audio execution action");
    if (testCase.memoryFacts?.length) {
      assert.ok(update.session.instructions.includes(testCase.memoryFacts[0].memory), "case-local memory reaches the production instruction builder");
    }

    assert.equal(await runtime.behaviorEngine.inspectVisual("local synthetic image", "describe it", sessionId), "",
      "the actual runtime denies visual inspection when visual behavior is disabled");
    const handSignal = setup.performAction({
      type: "prepare_shared_ritual",
      id: seededEpisodes[0]?.id ?? "ep_offline_fixture",
      signal: "open_palm",
      evidence: testCase.userText,
    });
    assert.equal(handSignal.status, "invalid_action", "the fixture reports open-palm analysis unavailable instead of reaching camera capture");

    // Exercise the actual PCM transport's session-config path with a local
    // socket seam. A null capture owner makes a real session.updated event
    // configure transport state without invoking native capture APIs.
    const localSends = [];
    const service = new runtime.RealtimePcmConversationService();
    service.active = true;
    service.sessionId = sessionId;
    service.captureOwner = null;
    service.webSocket = {
      readyState: 1,
      send(raw) { localSends.push(JSON.parse(raw)); },
    };
    assert.equal(service.applySessionPreferences("offline-companion-runtime"), true);
    assert.equal(localSends.length, 1);
    assert.equal(localSends[0].type, "session.update");
    assert.equal(localSends[0].session.model, defaultModelId);
    assert.equal(localSends[0].session.max_output_tokens, 768);
    const independentlyBuiltSession = independentRealtimeConfig.buildRealtimeSessionUpdate(
      { ...runtime.preferences, realtimeTurnTaking: "fixed" },
      undefined,
      undefined,
      runtime.events.getBehaviorConversationContext(sessionId),
      runtime.events.requiresBehaviorTurnCommit(sessionId),
    ).session;
    assert.deepEqual(localSends[0].session.tools, independentlyBuiltSession.tools,
      "the live PCM transport sends the exact production tool schema without a fixture rewrite");
    assert.equal(localSends[0].session.model, independentlyBuiltSession.model);
    assert.equal(localSends[0].session.max_output_tokens, independentlyBuiltSession.max_output_tokens);
    await service.handleEvent({
      type: "session.updated",
      session: { audio: { input: { turn_detection: { type: "server_vad", interrupt_response: true } } } },
    });
    assert.equal(service.configured, true, "the actual PCM event handler accepts session.updated without capture ownership");
    assert.equal(localSends.length, 1, "session.updated with no capture owner does not start a second transport action");

    results.push({ id: testCase.id, episodeCount: seededEpisodes.length, requiredTool: testCase.expected?.requiredTool ?? null });
    assert.ok(contextUpdates.length > 0, `${testCase.id} publishes real bounded behavior context through the session callback`);
  } finally {
    runtime.events.endBehaviorSession(sessionId);
    runtime.uninstallRuntime();
    runtime.behaviorEngine.dispose();
  }
  assert.equal(runtime.behaviorEngine.getState().sessionId, null, `${testCase.id} ends its own public session`);
}

assert.deepEqual(results.map((item) => item.id), cases.map((item) => item.id));
assert.equal(results.find((item) => item.id === "de-open-boredom-small-choice").episodeCount, 0,
  "a subsequent unseeded case does not inherit Gerda from another runtime");
assert.equal(results.find((item) => item.id === "de-quoted-event-and-unsupported-physical-action").episodeCount, 0,
  "the quoted-event case remains isolated from the seeded recall/activity fixtures");

console.log(`Actual companion live runtime: ${results.length} isolated offline fixtures, setup/action gates, production Realtime config, and local PCM session-config path PASS (no model, network, or hardware verification)`);
