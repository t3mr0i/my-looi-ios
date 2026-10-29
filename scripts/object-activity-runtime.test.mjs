import assert from "node:assert/strict";
import path from "node:path";
import { deferred } from "./helpers/load-typescript.mjs";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

function createStore(initialState) {
  let state = initialState;
  const listeners = new Set();
  const store = (selector = (value) => value) => selector(state);
  store.getState = () => state;
  store.setState = (patch) => {
    const previous = state;
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    for (const listener of [...listeners]) listener(state, previous);
  };
  store.subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  return store;
}

const flush = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };
const rect = { left: 0.2, top: 0.25, right: 0.4, bottom: 0.5 };
const sessionId = "object-activity-runtime-session";
const evidence = "Lass uns Gerda zusammen ausprobieren";

function harness({ trackingPromise = Promise.resolve(true) } = {}) {
  let mono = 10_000;
  let wall = Date.now();
  let focused = true;
  let appState = "active";
  let nextTimer = 0;
  const timers = new Map();
  const nativeListeners = new Map();
  const robotListeners = new Set();
  const focusListeners = new Set();
  const appListeners = new Set();
  const calls = [];
  const robotSideEffects = [];
  const permissionCalls = [];
  const diagnostics = [];
  let robot = { motionActive: false, stopGeneration: 0 };
  const userStore = createStore({ preferences: { cameraAttentionEnabled: true }, robotSleeping: false });
  const conversationStore = createStore({ isUserSpeaking: false, isSpeaking: false, isProcessing: false });
  const behaviorStore = createStore({ settings: { mode: "off" }, state: { sessionId: null, referenceVersion: 0,
    pendingIntention: null, companion: { episodes: [], scene: { status: "idle" } }, objectReference: null } });
  const native = {
    addListener(name, fn) {
      const set = nativeListeners.get(name) ?? new Set(); set.add(fn); nativeListeners.set(name, set);
      return { remove: () => set.delete(fn) };
    },
    async startObjectSelection(id) { calls.push(["selection", id]); return true; },
    async startObjectTracking(id, frameId, selectedRect) { calls.push(["tracking", id, frameId, selectedRect]); return trackingPromise; },
    async stopObjectTracking(id) { calls.push(["stop", id]); },
  };
  const dependencies = {
    "react-native": { AppState: { get currentState() { return appState; }, addEventListener(_name, fn) { appListeners.add(fn); return { remove: () => appListeners.delete(fn) }; } }, Platform: { OS: "ios" } },
    zustand: { create: (initializer) => createStore(initializer()) },
    "../../modules/local-face-attention": { getLocalFaceAttentionModule: () => native },
    "./social-attention": {
      async acquireSocialObjectAttention(id, onEnd) { return (socialLease = { id, onEnd }), true; },
      releaseSocialObjectAttention(id) { if (socialLease?.id === id) socialLease = null; },
      getSocialAttentionControllerState: () => ({ running: true, objectTrackingSupported: true }),
    },
    "./main-screen-presence": { isMainScreenFocused: () => focused, subscribeMainScreenFocused(fn) { focusListeners.add(fn); return () => focusListeners.delete(fn); } },
    "./ambient-motion": { setAmbientObjectAttentionHeld() {} },
    "../permissions/camera": { requestCameraAccess: async () => { permissionCalls.push("camera"); return true; } },
    "../store/user": { useUserStore: userStore },
    "../store/conversation": { useConversationStore: conversationStore },
    "../behavior/behavior-runtime": { useBehaviorStore: behaviorStore },
    "../device-tools/looi-robot": { getLooiRobotRuntimeState: () => robot, subscribeLooiRobotRuntimeState(fn) { robotListeners.add(fn); return () => robotListeners.delete(fn); } },
    "../voice/driving-control-session": { isDrivingControlSessionActive: () => false },
    "../diagnostics/diagnostic-log": { recordDiagnosticEvent: (...args) => diagnostics.push(args) },
  };
  let socialLease = null;
  const load = createTypeScriptTreeLoader(dependencies);
  const originalPerformance = globalThis.performance;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => mono } });
  globalThis.setInterval = (fn, intervalMs) => { const id = ++nextTimer; timers.set(id, { fn, intervalMs }); return id; };
  globalThis.clearInterval = (id) => timers.delete(id);
  const events = load(path.resolve("src/behavior/behavior-events.ts"));
  const { createBehaviorEngine } = load(path.resolve("src/behavior/behavior-engine.ts"));
  const engine = createBehaviorEngine({ now: () => mono, wallNow: () => wall,
    decide: async ({ questions }) => ({ answers: questions.map((q) => q.type === "choice"
      ? { name: q.name, type: "choice", choice: q.choices[0].value, confidence: 1 }
      : { name: q.name, type: "score", score: 0, confidence: 1 }),
      usage: { inputTokens: 1, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0 }, requestId: "local-mock" }),
    executeCue: () => robotSideEffects.push("unexpected-cue") });
  engine.configure({ mode: "active", dailyBudgetUsd: 1, visualEnabled: false, candidateScoring: true });
  engine.setEnvironment({ foreground: true, focused: true, sleeping: false, connected: true, ambientEnabled: true,
    cameraEnabled: true, userSpeaking: false, assistantSpeaking: false, motionActive: false });
  const adapter = { dispatch: (event) => engine.dispatch(event), getContext: () => engine.getConversationContext(),
    inspectVisual: (...args) => engine.inspectVisual(...args), companionAction: (action) => engine.companionAction(action),
    isGameActive: () => engine.getState().game?.status === "active" };
  const unregister = events.registerBehaviorAdapter(adapter);
  events.beginBehaviorSession(sessionId, () => {});
  const unsubscribe = engine.subscribe((state) => behaviorStore.setState({ settings: { mode: "active" }, state }));
  behaviorStore.setState({ settings: { mode: "active" }, state: engine.getState() });
  const attention = load(path.resolve("src/core/object-attention.ts"));
  return {
    engine, events, attention, behaviorStore, conversationStore, calls, robotSideEffects, permissionCalls, diagnostics,
    get mono() { return mono; },
    advance(ms) { mono += ms; wall += ms; for (const timer of [...timers.values()]) timer.fn(); },
    setWall(value) { wall = value; },
    emit(name, value) { for (const fn of [...(nativeListeners.get(name) ?? [])]) fn(value); },
    freshPreview(requestId, frameId = "roi-frame") { this.emit("onObjectPreview", { requestId, frameId, timestampMs: this.mono, cameraFacing: "front", width: 640, height: 480, dataUrl: "data:image/jpeg;base64,AA==" }); },
    frame(requestId, stamp) { this.emit("onObjectTrack", { requestId, trackId: requestId, timestampMs: stamp, status: "tracking", rect: { ...rect }, confidence: 0.95 }); },
    get requestId() { return [...calls].reverse().find(([kind]) => kind === "selection")?.[1]; },
    setSpeaking({ user = false, assistant = false, processing = false } = {}) { conversationStore.setState({ isUserSpeaking: user, isSpeaking: assistant, isProcessing: processing }); },
    replaceRobot(patch) { robot = { ...robot, ...patch }; for (const fn of [...robotListeners]) fn(robot); },
    setFocused(value) { focused = value; for (const fn of [...focusListeners]) fn(value); },
    changeAppState(value) { appState = value; for (const fn of [...appListeners]) fn(value); },
    close() {
      attention.stopObjectAttention(); unsubscribe(); unregister(); events.endBehaviorSession(sessionId); engine.dispose();
      Object.defineProperty(globalThis, "performance", { configurable: true, value: originalPerformance });
      globalThis.setInterval = originalSetInterval; globalThis.clearInterval = originalClearInterval;
    },
  };
}

async function userTurn(h, text) {
  h.engine.dispatch({ type: "user-turn", text, sessionId });
  await flush();
}
async function assistantEnd(h, text) { h.engine.dispatch({ type: "assistant-end", text, sessionId }); await flush(); }
async function setupConfirmedActivity(h) {
  await userTurn(h, "Wir haben Gerda gemeinsam gebastelt.");
  const episodeEvidence = "Wir haben Gerda gemeinsam gebastelt";
  const proposal = h.engine.companionAction({ type: "propose_experience", title: "Gerda", detail: "Ein blauer Papierflieger", outcome: "Gemeinsam gebaut", motif: "curious", evidence: episodeEvidence });
  assert.equal(proposal.status, "proposed");
  await assistantEnd(h, "Sollen wir Gerda als Erfahrung speichern?");
  await userTurn(h, "Ja");
  const episode = h.engine.getState().companion.episodes.find((item) => item.title === "Gerda");
  assert.ok(episode, "test uses the engine's actual confirmed episode flow");
  await userTurn(h, evidence + ".");
  const begin = h.engine.companionAction({ type: "manage_shared_activity", operation: "begin", id: episode.id, evidence });
  assert.equal(begin.status, "pending_confirmation");
  assert.equal(h.engine.getState().pendingIntention.activity.confirmedAt, null);
  await assistantEnd(h, begin.confirmationQuestion);
  await userTurn(h, "Ja");
  const task = h.engine.getState().pendingIntention;
  assert.equal(task.status, "active");
  assert.ok(task.activity.confirmedAt);
  return { episode, task, evidence };
}

async function bindConfirmedRegion(h) {
  const { episode } = await setupConfirmedActivity(h);
  const helper = createTypeScriptTreeLoader()(path.resolve("src/core/object-activity-reference.ts"));
  const candidate = helper.getObjectActivityReferenceCandidate(h.engine.getState(), "active", Date.now());
  await h.attention.startObjectAttentionSelection();
  const trackId = h.requestId;
  h.freshPreview(trackId, `frame-${trackId}`);
  assert.equal(await h.attention.selectObjectAttention(`frame-${trackId}`, rect, candidate), true);
  h.frame(trackId, h.mono + 1);
  assert.equal(h.engine.getState().objectReference.trackId, trackId);
  return { episode, candidate, trackId };
}

// Bind only after the actual engine confirms the task. An unbound selection remains local and
// never publishes an engine reference; a bound selection is published after native acceptance
// and the first valid local track frame.
{
  const h = harness();
  const { task } = await setupConfirmedActivity(h);
  const motorBaseline = h.robotSideEffects.length;
  const helper = createTypeScriptTreeLoader()(path.resolve("src/core/object-activity-reference.ts"));
  const candidate = helper.getObjectActivityReferenceCandidate(h.engine.getState(), "active", Date.now());
  assert.equal(candidate.taskId, task.id);
  await h.attention.startObjectAttentionSelection();
  const requestId = h.requestId;
  h.freshPreview(requestId);
  const requestBefore = h.engine.getState().metrics.requests;
  assert.equal(await h.attention.selectObjectAttention("roi-frame", rect, candidate), true);
  assert.equal(h.attention.useObjectAttentionStore.getState().activityReference, null,
    "native acceptance alone is not an executed ROI binding before a current track frame");
  h.frame(requestId, h.mono + 1);
  const store = h.attention.useObjectAttentionStore.getState();
  assert.equal(store.status, "tracking");
  assert.equal(store.activityReference.trackId, requestId);
  assert.equal(h.engine.getState().objectReference.trackId, requestId,
    "the real event adapter sets semantic context from the confirmed user binding");
  const semanticContext = JSON.parse(h.engine.getConversationContext());
  assert.deepEqual({ episodeId: semanticContext.selectedObjectReference.episodeId,
    title: semanticContext.selectedObjectReference.title, source: semanticContext.selectedObjectReference.source },
    { episodeId: task.activity.episodeId, title: task.activity.title, source: "user_selected_region" },
    "the current semantic context labels the target as a user-selected ROI, not inferred identity");
  assert.equal(JSON.stringify(semanticContext).includes("remainingMs"), false,
    "semantic context does not churn per frame with a countdown");
  assert.equal(h.engine.serialize().includes(requestId), false,
    "ephemeral ROI track metadata is never serialized into durable behavior state");
  assert.equal(store.activityAttention, "person", "conversation begins with person attention");
  assert.equal(h.engine.getState().metrics.requests, requestBefore,
    "binding and local track updates do not call the Decisions API");

  for (let i = 0; i < 4; i += 1) { h.advance(100); h.frame(requestId, h.mono + 1); }
  assert.equal(h.attention.useObjectAttentionStore.getState().activityAttention, "person");
  h.advance(100); h.frame(requestId, h.mono + 1);
  assert.equal(h.attention.useObjectAttentionStore.getState().activityAttention, "object",
    "after 500 ms continuous quiet, the local runtime directs a brief gaze to the ROI");
  h.setSpeaking({ user: true });
  assert.equal(h.attention.useObjectAttentionStore.getState().activityAttention, "person",
    "user speech immediately returns attention to the person");
  h.setSpeaking({});
  h.advance(100); h.frame(requestId, h.mono + 1);
  assert.equal(h.attention.useObjectAttentionStore.getState().activityAttention, "person",
    "an interrupted glance is not resumed");
  for (let i = 0; i < 6; i += 1) { h.advance(100); h.frame(requestId, h.mono + 1); }
  assert.equal(h.attention.useObjectAttentionStore.getState().activityAttention, "person",
    "the cadence is one glance per activity phase");
  assert.equal(h.robotSideEffects.length, motorBaseline, "object tracking adds no physical behavior cue or motor command");

  const taskBeforeTurn = h.engine.getState().pendingIntention;
  await userTurn(h, "Ich bin wieder da.");
  assert.equal(h.engine.getState().pendingIntention.id, taskBeforeTurn.id,
    "ordinary turns do not change binding identity");
  assert.equal(h.attention.useObjectAttentionStore.getState().activityReference.trackId, requestId,
    "ordinary engine lifecycle generation changes do not invalidate a still-current task binding");

  const milestoneEvidence = "Die Pappe liegt bereit";
  await userTurn(h, `${milestoneEvidence}.`);
  const milestone = h.engine.companionAction({ type: "manage_shared_activity", operation: "confirm_step",
    id: task.activity.episodeId, step: "checked", detail: milestoneEvidence, evidence: milestoneEvidence });
  assert.equal(milestone.status, "pending_confirmation");
  assert.equal(h.attention.useObjectAttentionStore.getState().activityAttention, "person",
    "a pending user confirmation immediately takes gaze priority");
  assert.equal(h.attention.useObjectAttentionStore.getState().activityReference.trackId, requestId,
    "a checked/prepared confirmation does not silently sever the confirmed activity binding");
  await assistantEnd(h, milestone.confirmationQuestion);
  await userTurn(h, "Ja");
  assert.equal(h.engine.getState().pendingIntention.activity.phase, "preparing");
  assert.equal(h.attention.useObjectAttentionStore.getState().activityReference.trackId, requestId,
    "the same bound region can remain associated across confirmed task phases");

  h.setSpeaking({ assistant: true });
  assert.equal(h.attention.useObjectAttentionStore.getState().activityAttention, "person",
    "assistant speech holds conversational/person attention over the selected object");
  h.close();
}

// A correction while native tracking startup is pending invalidates the candidate synchronously;
// resolving an old native promise afterward cannot restore or publish the old binding.
{
  const pendingNative = deferred();
  const h = harness({ trackingPromise: pendingNative.promise });
  const { task } = await setupConfirmedActivity(h);
  const motorBaseline = h.robotSideEffects.length;
  const helper = createTypeScriptTreeLoader()(path.resolve("src/core/object-activity-reference.ts"));
  const candidate = helper.getObjectActivityReferenceCandidate(h.engine.getState(), "active", Date.now());
  await h.attention.startObjectAttentionSelection();
  const requestId = h.requestId;
  h.freshPreview(requestId, "race-frame");
  const selecting = h.attention.selectObjectAttention("race-frame", rect, candidate);
  await flush();
  assert.ok(h.calls.some(([kind]) => kind === "tracking"));
  h.engine.dispatch({ type: "correction", sessionId, correctedReference: "a different activity" });
  await flush();
  assert.equal(h.engine.getState().pendingIntention?.id, task.id);
  assert.equal(h.engine.getState().pendingIntention?.status, "paused",
    "the correction pauses the task through its actual behavior-engine path");
  assert.equal(h.engine.getState().referenceVersion, candidate.referenceVersion + 1);
  assert.equal(h.attention.useObjectAttentionStore.getState().activityReference, null);
  pendingNative.resolve(true);
  assert.equal(await selecting, false, "stale native acceptance cannot finish the old binding");
  h.frame(requestId, h.mono + 1);
  assert.equal(h.attention.useObjectAttentionStore.getState().status, "ended");
  assert.equal(h.engine.getState().objectReference ?? null, null);
  assert.equal(h.robotSideEffects.length, motorBaseline);
  h.close();
}

// STOP pauses/cancels the semantic task and clears the camera lease/reference; a later unrelated
// selection is unbound unless the user explicitly supplies another current candidate.
{
  const h = harness();
  await setupConfirmedActivity(h);
  const motorBaseline = h.robotSideEffects.length;
  const helper = createTypeScriptTreeLoader()(path.resolve("src/core/object-activity-reference.ts"));
  const candidate = helper.getObjectActivityReferenceCandidate(h.engine.getState(), "active", Date.now());
  await h.attention.startObjectAttentionSelection();
  let requestId = h.requestId;
  h.freshPreview(requestId);
  assert.equal(await h.attention.selectObjectAttention("roi-frame", rect, candidate), true);
  h.frame(requestId, h.mono + 1);
  assert.equal(h.engine.getState().objectReference.trackId, requestId);
  h.events.publishBehaviorEvent({ type: "interrupt", reason: "stop button", sessionId });
  assert.notEqual(h.attention.useObjectAttentionStore.getState().status, "tracking");
  assert.equal(h.attention.useObjectAttentionStore.getState().activityReference, null);
  assert.equal(h.engine.getState().objectReference ?? null, null);

  await h.attention.startObjectAttentionSelection();
  requestId = h.requestId;
  h.freshPreview(requestId, "new-object-frame");
  assert.equal(await h.attention.selectObjectAttention("new-object-frame", rect), true,
    `a replacement selection can be tracked locally; status=${h.attention.useObjectAttentionStore.getState().status}, reason=${h.attention.useObjectAttentionStore.getState().reason}`);
  h.frame(requestId, h.mono + 1);
  assert.equal(h.attention.useObjectAttentionStore.getState().activityReference, null,
    "the replacement ROI does not inherit the prior activity binding");
  assert.equal(h.engine.getState().objectReference ?? null, null);
  assert.equal(h.robotSideEffects.length, motorBaseline);
  h.close();
}

// The bound engine reference is cleared by real pause, forgetting, session-end, task expiry,
// and native track loss transitions. None of these paths can silently retain old region identity.
for (const scenario of ["pause", "forget", "session-end", "task-expiry", "track-loss"]) {
  const h = harness();
  const { episode, trackId } = await bindConfirmedRegion(h);
  if (scenario === "pause") h.events.publishBehaviorEvent({ type: "intention", action: "pause", sessionId });
  if (scenario === "forget") h.engine.forgetExperience(episode.id);
  if (scenario === "session-end") h.events.endBehaviorSession(sessionId);
  if (scenario === "task-expiry") { h.setWall(Date.now() + 8 * 24 * 60 * 60 * 1000); h.engine.tick(); }
  if (scenario === "track-loss") h.advance(501);
  assert.notEqual(h.attention.useObjectAttentionStore.getState().status, "tracking", `${scenario} ends the live region lease`);
  assert.equal(h.attention.useObjectAttentionStore.getState().activityReference, null, `${scenario} clears local bound metadata`);
  assert.equal(h.engine.getState().objectReference ?? null, null, `${scenario} clears the real engine reference`);
  assert.ok(h.calls.some(([kind, id]) => kind === "stop" && id === trackId), `${scenario} requests stop for only the old native track`);
  h.close();
}

// A delayed clear event from an older ROI is track-scoped and cannot erase a newer explicit bind.
{
  const h = harness();
  await setupConfirmedActivity(h);
  const helper = createTypeScriptTreeLoader()(path.resolve("src/core/object-activity-reference.ts"));
  const candidate = helper.getObjectActivityReferenceCandidate(h.engine.getState(), "active", Date.now());
  await h.attention.startObjectAttentionSelection();
  const oldTrack = h.requestId;
  h.freshPreview(oldTrack, "old-roi");
  assert.equal(await h.attention.selectObjectAttention("old-roi", rect, candidate), true);
  h.frame(oldTrack, h.mono + 1);
  assert.equal(h.engine.getState().objectReference.trackId, oldTrack);
  h.attention.stopObjectAttention();
  assert.equal(h.engine.getState().objectReference, null);

  await h.attention.startObjectAttentionSelection();
  const newTrack = h.requestId;
  assert.notEqual(newTrack, oldTrack);
  h.freshPreview(newTrack, "new-roi");
  assert.equal(await h.attention.selectObjectAttention("new-roi", rect, candidate), true);
  h.frame(newTrack, h.mono + 1);
  assert.equal(h.engine.getState().objectReference.trackId, newTrack);
  h.events.publishBehaviorEvent({ type: "object-reference", sessionId, trackId: oldTrack, reference: null });
  assert.equal(h.engine.getState().objectReference.trackId, newTrack,
    "an old track's delayed clear cannot remove the current track-scoped binding");
  h.close();
}

console.log("Object activity runtime: confirmed ROI binding, real event/context integration, stale cancellation, speech priority and no silent rebind PASS");
