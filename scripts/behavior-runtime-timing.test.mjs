import assert from "node:assert/strict";
import { deferred, loadTypeScript } from "./helpers/load-typescript.mjs";

const flush = async () => {
  for (let index = 0; index < 60; index += 1) await Promise.resolve();
};

function createFakeClock(startAt = 1_800_000_000_000) {
  let now = startAt;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, delay = 0) {
      const id = nextId++;
      const normalized = Number.isFinite(delay) ? Math.max(0, delay) : 0;
      timers.set(id, { id, dueAt: now + normalized, callback });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { return nextId++; },
    clearInterval() {},
    pendingTimers() { return [...timers.values()].map(({ dueAt }) => dueAt - now).sort((a, b) => a - b); },
    async advance(duration) {
      assert.ok(Number.isFinite(duration) && duration >= 0);
      const target = now + duration;
      let executions = 0;
      while (true) {
        const next = [...timers.values()].filter((timer) => timer.dueAt <= target)
          .sort((a, b) => a.dueAt - b.dueAt || a.id - b.id)[0];
        if (!next) break;
        assert.ok(++executions < 1_000, "fake clock must remain bounded");
        timers.delete(next.id);
        now = next.dueAt;
        next.callback();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}

function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  const store = (selector = (value) => value) => selector(state);
  store.getState = () => state;
  store.setState = (patch) => {
    const previous = state;
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    for (const listener of listeners) listener(state, previous);
  };
  store.subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  return store;
}

function makeHarness({ holdMacroOpen = false, reduceMotionEnabled = false, pendingReduceMotionQuery = false } = {}) {
  const clock = createFakeClock();
  const appState = {
    currentState: "active",
    addEventListener(_type, listener) {
      this.listener = listener;
      return { remove: () => { if (this.listener === listener) this.listener = null; } };
    },
  };
  const userStore = createStore({
    preferences: {
      language: "en", listeningLanguage: "en", ambientMotionLevel: "normal",
      cameraAttentionEnabled: true, robotName: "LOOI",
    },
    robotSleeping: false,
  });
  const conversationStore = createStore({ isUserSpeaking: false, isSpeaking: false, isProcessing: false });
  conversationStore.getState().clearSession = () => {};
  conversationStore.getState().clearInputAttention = () => {};
  const reactionStore = createStore({ mood: null, reactionId: 0 });
  const robotState = { connected: true, motionActive: false, stopGeneration: 0, safety: { lastSafetyStopReason: null } };
  const robotListeners = new Set();
  let reduceMotion = reduceMotionEnabled;
  let reduceMotionListener = null;
  const initialReduceMotionQuery = pendingReduceMotionQuery ? deferred() : null;
  const headCalls = [];
  const cancelledHeadCalls = [];
  const reactionCalls = [];
  const clearedReactionCalls = [];
  const decisionCalls = [];
  const assistantDecision = deferred();
  const macroCompletion = deferred();
  const macroSteps = [];
  let nextReactionId = 0;
  let runtimeModule;
  let engineConfiguration = null;

  class FakeDate extends Date {
    static now() { return clock.now(); }
  }
  const timerGlobals = {
    performance: { now: clock.now },
    Date: FakeDate,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
  };

  const behaviorPolicy = loadTypeScript("src/behavior/behavior-policy.ts");
  const behaviorCompanion = loadTypeScript("src/behavior/behavior-companion.ts", {
  "../character/companion-personality": loadTypeScript("src/character/companion-personality.ts"),
    "./behavior-episode-search": loadTypeScript("src/behavior/behavior-episode-search.ts"),
  });
  const engineModule = loadTypeScript("src/behavior/behavior-engine.ts", {
    "./behavior-policy": behaviorPolicy,
    "./behavior-companion": behaviorCompanion, "./shared-activity": loadTypeScript("src/behavior/shared-activity.ts"),
  }, timerGlobals);
  const behaviorEvents = loadTypeScript("src/behavior/behavior-events.ts");

  const dependencies = {
    "react-native": {
      AppState: appState,
      AccessibilityInfo: {
        isReduceMotionEnabled: () => initialReduceMotionQuery?.promise ?? Promise.resolve(reduceMotion),
        addEventListener(_event, listener) {
          reduceMotionListener = listener;
          return { remove: () => { if (reduceMotionListener === listener) reduceMotionListener = null; } };
        },
      },
    },
    zustand: {
      create: (initializer) => createStore(initializer(
        (patch) => behaviorStore.setState(patch),
        () => behaviorStore.getState(),
      )),
    },
    "react-native-mmkv": {
      createMMKV: () => ({ getString: () => undefined, set() {} }),
    },
    "./behavior-engine": {
      ...engineModule,
      createBehaviorEngine(deps) {
        engineConfiguration = { ...deps };
        return engineModule.createBehaviorEngine(deps);
      },
    },
    "./game-face-feedback": loadTypeScript("src/behavior/game-face-feedback.ts"),
  "./listening-opportunity": loadTypeScript("src/behavior/listening-opportunity.ts"),
  "./behavior-face-feedback": loadTypeScript("src/behavior/behavior-face-feedback.ts"),
  "./behavior-expression": loadTypeScript("src/behavior/behavior-expression.ts", {}, timerGlobals),
    "../core/interaction-start-signal": loadTypeScript("src/core/interaction-start-signal.ts"),
    "./behavior-events": behaviorEvents,
    "../memory/memory-mutation": loadTypeScript("src/memory/memory-mutation.ts"),
    "../memory/memory-service": { async stopConversationForMemoryChange() {} },
    "../openai/decisions": {
      async requestDecisions(input, options) {
        const call = { input, signal: options?.signal, at: clock.now() };
        decisionCalls.push(call);
        if (input.context.eventType === "assistant-end") return assistantDecision.promise;
        return decisionResult(input.questions, "hold");
      },
    },
    "../store/user": { useUserStore: userStore },
    "../store/conversation": { useConversationStore: conversationStore },
    "../core/main-screen-presence": {
      isMainScreenFocused: () => true,
      subscribeMainScreenFocused: () => () => {},
    },
    "../core/ambient-motion": {
      configureAmbientBehaviorPolicy() {}, holdAmbientMotionFor() {}, holdAmbientHeadMotionFor() {},
    },
    "../core/social-attention": {
      configureSocialBehaviorPolicy() {},
      getSocialAttentionControllerState: () => ({ faces: [], objectAttentionActive: false }),
      holdSocialAttentionMotionFor() {}, setSocialInteractionSignalRequest() {},
    },
    "../device-tools/looi-robot": {
      cancelLooiHeadMotion: (reason, owner) => cancelledHeadCalls.push({ reason, owner }),
      getLooiRobotRuntimeState: () => robotState,
      subscribeLooiRobotRuntimeState(listener) { robotListeners.add(listener); return () => robotListeners.delete(listener); },
      async performLooiBehaviorHeadGesture(gesture, isCurrent) {
        if (!isCurrent()) return { completed: false };
        const call = { gesture, isCurrent, at: clock.now() };
        headCalls.push(call);
        if (holdMacroOpen) {
          macroSteps.push("first-guarded-phase");
          await macroCompletion.promise;
          if (isCurrent()) macroSteps.push("next-guarded-phase");
        }
        return { completed: isCurrent() };
      },
    },
    "../character/character-reaction": {
      clearCharacterReaction(reason) { clearedReactionCalls.push(reason); reactionStore.setState({ mood: null }); },
      triggerCharacterReaction(mood) {
        reactionCalls.push(mood);
        nextReactionId += 1;
        reactionStore.setState({ mood, reactionId: nextReactionId });
        return nextReactionId;
      },
      useCharacterReactionStore: reactionStore,
    },
    "../voice/driving-control-session": { isDrivingControlSessionActive: () => false },
  };

  let behaviorStore;
  // Zustand's create callback is invoked synchronously while the runtime module loads.
  dependencies.zustand.create = (initializer) => {
    behaviorStore = createStore(initializer((patch) => behaviorStore.setState(patch), () => behaviorStore.getState()));
    return behaviorStore;
  };
  runtimeModule = loadTypeScript("src/behavior/behavior-runtime.ts", dependencies, timerGlobals);
  runtimeModule.updateBehaviorSettings({ mode: "active", candidateScoring: false, curiosityEnabled: false, visualEnabled: false });
  const uninstall = runtimeModule.installBehaviorRuntime();
  behaviorEvents.beginBehaviorSession("timing-session", () => {});

  function publish(type, fields = {}) {
    behaviorEvents.publishBehaviorEvent({ type, sessionId: "timing-session", ...fields });
  }

  function speechStart() {
    conversationStore.setState({ isUserSpeaking: true });
    publish("user-speech-start");
  }

  function speechEnd() {
    conversationStore.setState({ isUserSpeaking: false });
    publish("user-speech-end");
  }

  async function queueAssistantEnd({ beforeAssistantEndMs = 1_000 } = {}) {
    speechStart();
    assert.equal(runtimeModule.useBehaviorStore.getState().presentation?.mood, "attentive", "speech-start updates local expression synchronously");
    speechEnd();
    assert.equal(runtimeModule.useBehaviorStore.getState().presentation?.mood, "thoughtful", "speech-end updates local expression synchronously");
    assert.equal(decisionCalls.length, 0, "speech phase events do not wait for or issue a cloud decision");

    publish("user-turn", { text: "We can try a small idea together." });
    await flush();
    assert.equal(headCalls.length, 0, "the input-side decision is presentation-only");
    await clock.advance(beforeAssistantEndMs);

    conversationStore.setState({ isSpeaking: true });
    publish("assistant-start");
    conversationStore.setState({ isSpeaking: false });
    publish("assistant-end", { text: "That sounds like a curious idea." });
    await flush();

    const assistantCall = decisionCalls.find((call) => call.input.context.eventType === "assistant-end");
    return { assistantCall: assistantCall ?? null, assistantEndAt: clock.now() };
  }

  function stopRobot(reason = "manual-stop") {
    robotState.stopGeneration += 1;
    robotState.safety.lastSafetyStopReason = reason;
    for (const listener of robotListeners) listener();
  }

  function destroy() {
    uninstall();
    behaviorEvents.endBehaviorSession("timing-session");
    runtimeModule.behaviorEngine.dispose();
  }

  return {
    clock, appState, userStore, conversationStore, reactionStore, robotState,
    decisionCalls, assistantDecision, headCalls, cancelledHeadCalls, reactionCalls,
    clearedReactionCalls, macroSteps, macroCompletion, engineConfiguration,
    runtimeModule, publish, speechStart, speechEnd, queueAssistantEnd, stopRobot, destroy,
    setReduceMotion(value) { reduceMotion = value; reduceMotionListener?.(value); },
    resolveInitialReduceMotion(value) { initialReduceMotionQuery?.resolve(value); },
  };
}

function observeExpressionPhases(harness) {
  const observed = [];
  let lastPhase = null;
  const unsubscribe = harness.runtimeModule.useBehaviorStore.subscribe((value) => {
    const presentation = value.presentation;
    if (presentation?.expressionPhase && presentation.expressionPhase !== lastPhase) {
      lastPhase = presentation.expressionPhase;
      observed.push({ phase: presentation.expressionPhase, gaze: presentation.gaze ?? null, mood: presentation.mood ?? null });
    }
  });
  return { observed, unsubscribe };
}

function decisionResult(questions, assistantCue) {
  return {
    answers: questions.map((question) => {
      if (question.type !== "choice") throw new Error(`Unexpected test question type ${question.type}`);
      const choice = question.name === "cue"
        ? assistantCue
        : question.name === "attention"
          ? "keep_target"
          : "wait";
      return { name: question.name, type: "choice", choice, confidence: 0.99 };
    }),
    usage: { inputTokens: 23, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0.000001 },
    requestId: "fake-runtime-timing",
  };
}

// The production runtime configures the real engine with an 1,800 ms decision
// allowance. The assistant's semantic end is emitted after its audio has drained.
{
  const harness = makeHarness({ holdMacroOpen: true });
  const phases = observeExpressionPhases(harness);
  try {
    assert.equal(harness.engineConfiguration.decisionTimeoutMs, 1_800);
    const { assistantCall: initiallyQueued, assistantEndAt } = await harness.queueAssistantEnd({ beforeAssistantEndMs: 400 });
    assert.equal(initiallyQueued, null, "assistant-end waits for the remaining request-spacing interval");
    await harness.clock.advance(600);
    const request = harness.decisionCalls.find((call) => call.input.context.eventType === "assistant-end");
    assert.ok(request, "audible assistant-end begins a real-runtime request after queue spacing");
    assert.equal(request.at - assistantEndAt, 600, "queue wait consumes the original assistant-end window");
    assert.equal(harness.headCalls.length, 0, "no head motion starts while the assistant-end decision is pending");
    assert.equal(harness.reactionCalls.length, 0, "no response mood is applied before the decision returns");
    assert.equal(request.signal.aborted, false);

    await harness.clock.advance(879);
    assert.equal(harness.headCalls.length, 0, "the delayed 1,480 ms answer has not acted early");
    assert.equal(harness.reactionCalls.length, 0, "the delayed answer has not applied response mood early");
    await harness.clock.advance(1);
    assert.equal(harness.clock.now() - assistantEndAt, 1_480);
    harness.assistantDecision.resolve(decisionResult(request.input.questions, "curious"));
    await flush();

    assert.equal(harness.runtimeModule.useBehaviorStore.getState().state.metrics.lastLatencyMs, 880, "reported provider latency excludes the queue interval");
    assert.equal(harness.headCalls.length, 0, "the existing cue expiry includes the expression preparation time");
    assert.equal(harness.runtimeModule.useBehaviorStore.getState().presentation.expressionPhase, "prepare");
    assert.equal(harness.runtimeModule.useBehaviorStore.getState().presentation.mood, null, "mood waits for the accent instead of appearing during preparation");
    const prepareGaze = harness.runtimeModule.useBehaviorStore.getState().presentation.gaze;
    assert.ok(Math.abs(prepareGaze.x) <= 0.2 && Math.abs(prepareGaze.y) <= 0.2, "preparation gaze stays within the bounded local range");
    const decisionCount = harness.decisionCalls.length;

    await harness.clock.advance(149);
    assert.equal(harness.headCalls.length, 0, "the physical accent waits for the complete 150 ms preparation lead");
    assert.equal(harness.runtimeModule.useBehaviorStore.getState().presentation.expressionPhase, "prepare");
    await harness.clock.advance(1);
    assert.equal(harness.clock.now() - assistantEndAt, 1_630, "preparation consumes 150 ms of the original event-time window");
    assert.equal(harness.headCalls.length, 1, "the real runtime starts one mock head gesture after preparation");
    assert.equal(harness.headCalls[0].gesture, "curious");
    assert.equal(harness.runtimeModule.useBehaviorStore.getState().presentation.expressionPhase, "accent");
    assert.deepEqual(harness.macroSteps, ["first-guarded-phase"], "the mock head macro is held open during the accent");
    assert.deepEqual(harness.reactionCalls, ["curious"], "the curious response keeps its distinct visual mood");
    assert.deepEqual(phases.observed.map(({ phase }) => phase), ["prepare", "accent"], "the visible expression reaches accent only after preparation");
    harness.macroCompletion.resolve();
    await flush();
    assert.equal(harness.runtimeModule.useBehaviorStore.getState().presentation.expressionPhase, "settle", "a completed head gesture enters its screen settle phase");
    assert.deepEqual(phases.observed.map(({ phase }) => phase), ["prepare", "accent", "settle"], "the actual runtime publishes preparation, accent, and settle in order");
    assert.equal(harness.decisionCalls.length, decisionCount, "the expression phases do not issue another Decisions request");
    await harness.clock.advance(220);
    assert.equal(harness.runtimeModule.useBehaviorStore.getState().presentation, null, "the visible expression clears after the 220 ms settle tail");
  } finally {
    phases.unsubscribe();
    harness.destroy();
  }
}

// STOP invalidates a delayed response before it can create a head or mood cue.
{
  const harness = makeHarness();
  try {
    const { assistantCall: request } = await harness.queueAssistantEnd();
    assert.ok(request);
    await harness.clock.advance(900);
    harness.stopRobot("manual-stop");
    assert.equal(request.signal.aborted, true, "STOP aborts the pending assistant-end request");
    assert.equal(harness.headCalls.length, 0);
    assert.equal(harness.reactionCalls.length, 0);

    await harness.clock.advance(580);
    harness.assistantDecision.resolve(decisionResult(request.input.questions, "curious"));
    await flush();
    assert.equal(harness.headCalls.length, 0, "a late post-STOP answer cannot actuate the mock head");
    assert.equal(harness.reactionCalls.length, 0, "a late post-STOP answer cannot set response mood");
  } finally {
    harness.destroy();
  }
}

// STOP during the local preparation delay aborts the waiting phase immediately.
{
  const harness = makeHarness();
  const phases = observeExpressionPhases(harness);
  try {
    const { assistantCall: request } = await harness.queueAssistantEnd();
    assert.ok(request);
    await harness.clock.advance(1_480);
    harness.assistantDecision.resolve(decisionResult(request.input.questions, "curious"));
    await flush();
    assert.equal(harness.runtimeModule.useBehaviorStore.getState().presentation.expressionPhase, "prepare");
    assert.equal(harness.headCalls.length, 0);
    const decisionCount = harness.decisionCalls.length;

    harness.stopRobot("manual-stop");
    assert.equal(harness.runtimeModule.useBehaviorStore.getState().presentation, null, "STOP clears the preparing face phase synchronously");
    await harness.clock.advance(1_500);
    assert.equal(harness.headCalls.length, 0, "an aborted preparation never reaches the physical accent");
    assert.deepEqual(phases.observed.map(({ phase }) => phase), ["prepare"], "no stale accent or settle phase is published after STOP");
    assert.equal(harness.decisionCalls.length, decisionCount, "canceling a local expression does not issue another Decisions request");
  } finally {
    phases.unsubscribe();
    harness.destroy();
  }
}

// Reduce Motion is read from the OS setting. When it is already enabled, the
// robot keeps the accepted head accent but skips the spatial preparation and
// settle presentation phases.
{
  const harness = makeHarness({ holdMacroOpen: true, reduceMotionEnabled: true });
  const phases = observeExpressionPhases(harness);
  try {
    await flush(); // Let the initial AccessibilityInfo query settle.
    const { assistantCall: request } = await harness.queueAssistantEnd();
    assert.ok(request);
    await harness.clock.advance(1_480);
    harness.assistantDecision.resolve(decisionResult(request.input.questions, "curious"));
    await flush();

    assert.equal(harness.headCalls.length, 1, "Reduce Motion preserves the approved head accent");
    assert.equal(harness.runtimeModule.useBehaviorStore.getState().presentation.expressionPhase, "accent");
    assert.equal(harness.runtimeModule.useBehaviorStore.getState().presentation.gaze, undefined, "Reduce Motion does not add a spatial gaze movement");
    assert.deepEqual(phases.observed.map(({ phase }) => phase), ["accent"], "Reduce Motion omits spatial prepare and settle phases");
    assert.deepEqual(harness.reactionCalls, ["curious"]);
    const decisionCount = harness.decisionCalls.length;

    harness.macroCompletion.resolve();
    await flush();
    assert.equal(harness.runtimeModule.useBehaviorStore.getState().presentation, null, "the accent returns directly to the normal presentation without a settle hold");
    assert.deepEqual(phases.observed.map(({ phase }) => phase), ["accent"]);
    assert.equal(harness.decisionCalls.length, decisionCount, "Reduce Motion phases do not issue another Decisions request");
  } finally {
    phases.unsubscribe();
    harness.destroy();
  }
}

// Enabling Reduce Motion during preparation invalidates that in-flight cue.
{
  const harness = makeHarness();
  const phases = observeExpressionPhases(harness);
  try {
    const { assistantCall: request } = await harness.queueAssistantEnd();
    assert.ok(request);
    await harness.clock.advance(1_480);
    harness.assistantDecision.resolve(decisionResult(request.input.questions, "curious"));
    await flush();
    assert.equal(harness.runtimeModule.useBehaviorStore.getState().presentation.expressionPhase, "prepare");
    assert.equal(harness.headCalls.length, 0);
    const decisionCount = harness.decisionCalls.length;

    harness.setReduceMotion(true);
    assert.equal(harness.runtimeModule.useBehaviorStore.getState().presentation, null, "the preference change clears the preparing cue synchronously");
    await harness.clock.advance(1_500);
    assert.equal(harness.headCalls.length, 0, "a cue aborted by Reduce Motion cannot reach the head accent");
    assert.deepEqual(phases.observed.map(({ phase }) => phase), ["prepare"], "no stale accent or settle phase follows the preference change");
    assert.equal(harness.decisionCalls.length, decisionCount, "canceling preparation does not issue another Decisions request");
  } finally {
    phases.unsubscribe();
    harness.destroy();
  }
}

// Until the initial OS query resolves, the runtime conservatively suppresses
// extra spatial motion while retaining the approved head accent.
{
  const harness = makeHarness({ holdMacroOpen: true, pendingReduceMotionQuery: true });
  const phases = observeExpressionPhases(harness);
  try {
    const { assistantCall: request } = await harness.queueAssistantEnd();
    assert.ok(request);
    await harness.clock.advance(1_480);
    harness.assistantDecision.resolve(decisionResult(request.input.questions, "curious"));
    await flush();

    assert.equal(harness.headCalls.length, 1, "a pending OS query cannot suppress the existing head accent");
    assert.equal(harness.runtimeModule.useBehaviorStore.getState().presentation.expressionPhase, "accent");
    assert.equal(harness.runtimeModule.useBehaviorStore.getState().presentation.gaze, undefined);
    assert.deepEqual(phases.observed.map(({ phase }) => phase), ["accent"], "no prepare or settle phase is presented before the OS query resolves");

    harness.resolveInitialReduceMotion(false);
    await flush();
    harness.macroCompletion.resolve();
    await flush();
    assert.equal(harness.runtimeModule.useBehaviorStore.getState().presentation, null);
    assert.deepEqual(phases.observed.map(({ phase }) => phase), ["accent"], "the running cue keeps its safe phase score after query completion");
  } finally {
    phases.unsubscribe();
    harness.destroy();
  }
}

// A newer OS preference event wins over a stale initial query result. The
// resulting cue uses the updated Reduce Motion value and may prepare normally.
{
  const harness = makeHarness({ holdMacroOpen: true, pendingReduceMotionQuery: true });
  const phases = observeExpressionPhases(harness);
  try {
    harness.setReduceMotion(false);
    harness.resolveInitialReduceMotion(true);
    await flush();

    const { assistantCall: request } = await harness.queueAssistantEnd();
    assert.ok(request);
    await harness.clock.advance(1_480);
    harness.assistantDecision.resolve(decisionResult(request.input.questions, "curious"));
    await flush();

    assert.equal(harness.headCalls.length, 0, "the stale initial true result cannot overwrite the newer false event");
    assert.equal(harness.runtimeModule.useBehaviorStore.getState().presentation.expressionPhase, "prepare");
    assert.ok(harness.runtimeModule.useBehaviorStore.getState().presentation.gaze);
    assert.deepEqual(phases.observed.map(({ phase }) => phase), ["prepare"]);
    await harness.clock.advance(150);
    assert.equal(harness.headCalls.length, 1);
    assert.equal(harness.runtimeModule.useBehaviorStore.getState().presentation.expressionPhase, "accent");
    harness.macroCompletion.resolve();
  } finally {
    phases.unsubscribe();
    harness.destroy();
  }
}

// Rate-spacing time remains part of the assistant-end deadline; dispatching a
// queued request does not grant it a fresh 1,800 ms response window.
{
  const harness = makeHarness();
  try {
    const { assistantEndAt } = await harness.queueAssistantEnd({ beforeAssistantEndMs: 400 });
    await harness.clock.advance(600);
    const request = harness.decisionCalls.find((call) => call.input.context.eventType === "assistant-end");
    assert.ok(request);
    assert.equal(request.at - assistantEndAt, 600);
    await harness.clock.advance(1_199);
    assert.equal(request.signal.aborted, false, "the request remains eligible up to the original deadline");
    await harness.clock.advance(1);
    assert.equal(request.signal.aborted, true, "the original 1,800 ms window expires despite the 600 ms queue wait");
    harness.assistantDecision.resolve(decisionResult(request.input.questions, "curious"));
    await flush();
    assert.equal(harness.headCalls.length, 0, "a response after the queued deadline cannot start motion");
    assert.equal(harness.reactionCalls.length, 0, "a response after the queued deadline cannot apply mood");
  } finally {
    harness.destroy();
  }
}

// New user speech during the 1,800 ms window suppresses the old assistant response.
{
  const harness = makeHarness();
  try {
    const { assistantCall: request } = await harness.queueAssistantEnd();
    assert.ok(request);
    await harness.clock.advance(900);
    harness.speechStart();
    assert.equal(request.signal.aborted, true, "new speech aborts the previous assistant-end request");
    assert.equal(harness.headCalls.length, 0);
    assert.equal(harness.reactionCalls.length, 0, "speech-start's local attentive state is not mistaken for an assistant response mood");

    await harness.clock.advance(580);
    harness.assistantDecision.resolve(decisionResult(request.input.questions, "curious"));
    await flush();
    assert.equal(harness.headCalls.length, 0, "a late answer after new speech cannot actuate the head");
    assert.equal(harness.reactionCalls.length, 0, "a late answer after new speech cannot apply response mood");
    assert.equal(harness.runtimeModule.useBehaviorStore.getState().presentation?.mood, "attentive");
  } finally {
    harness.destroy();
  }
}

// Once a guarded gesture macro starts, STOP invalidates every later macro phase.
{
  const harness = makeHarness({ holdMacroOpen: true });
  try {
    const { assistantCall: request, assistantEndAt } = await harness.queueAssistantEnd();
    assert.ok(request);
    await harness.clock.advance(1_480);
    harness.assistantDecision.resolve(decisionResult(request.input.questions, "curious"));
    await flush();
    assert.equal(harness.headCalls.length, 0, "the long-lived mock head macro is not opened during eye preparation");
    assert.equal(harness.runtimeModule.useBehaviorStore.getState().presentation.expressionPhase, "prepare");
    await harness.clock.advance(150);
    assert.equal(harness.headCalls.length, 1, "the accepted decision starts the guarded mock macro");
    assert.deepEqual(harness.macroSteps, ["first-guarded-phase"]);
    assert.equal(harness.runtimeModule.useBehaviorStore.getState().presentation.expressionPhase, "accent");
    assert.equal(harness.headCalls[0].isCurrent(), true);

    await harness.clock.advance(171);
    assert.equal(harness.clock.now() - assistantEndAt, 1_801, "the started macro enters its bounded closing phase beyond cue freshness");
    assert.equal(harness.headCalls[0].isCurrent(), true, "a started macro remains current during its bounded close window");

    harness.stopRobot("manual-stop");
    assert.equal(harness.headCalls[0].isCurrent(), false, "STOP closes the current-owner guard for the active macro");
    harness.macroCompletion.resolve();
    await flush();
    assert.deepEqual(harness.macroSteps, ["first-guarded-phase"], "a post-STOP macro phase is never admitted");
    assert.ok(harness.cancelledHeadCalls.some(({ owner }) => owner === "behavior"), "runtime cleanup cancels only its behavior-owned head motion");
  } finally {
    harness.destroy();
  }
}

console.log("Behavior runtime timing: synchronous local speech state, 1,480 ms assistant-end response, STOP/speech invalidation, and guarded macro preemption PASS");
