import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

function extractPrivateMethod(filePath, className, methodName) {
  const source = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let classNode = null;
  const visit = (node) => {
    if (ts.isClassDeclaration(node) && node.name?.text === className) classNode = node;
    if (classNode === null) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(classNode, `found original ${className} declaration in ${filePath}`);
  const method = classNode.members.find((member) =>
    ts.isMethodDeclaration(member) && member.name?.getText(sourceFile) === methodName
  );
  assert.ok(method, `found original ${className}.${methodName}`);
  assert.ok(method.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword),
    `${className}.${methodName} remains a private implementation method`);
  assert.ok(method.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword),
    `${className}.${methodName} remains async`);
  return method.getText(sourceFile);
}

function evaluateOriginalMethod(methodSource, bindings) {
  const source = `class ExtractedFinalizer {\n${methodSource}\n}\nmodule.exports = ExtractedFinalizer;`;
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function(...Object.keys(bindings), "module", "exports", output)(
    ...Object.values(bindings), module, module.exports
  );
  return module.exports;
}

const pcmFinalizeSource = extractPrivateMethod(
  "src/voice/realtime-pcm-conversation.ts",
  "RealtimePcmConversationService",
  "finalizeAssistantTurn",
);
const webrtcFinalizeSource = extractPrivateMethod(
  "src/voice/realtime-conversation.ts",
  "RealtimeConversationService",
  "finalizeAssistantTurnIfReady",
);

const transcript = "A clearer answer from LOOI.";

function makeHarness({ transport, active = true, status = "completed", playbackOutcome = "stopped", interrupted = false } = {}) {
  const timeline = [];
  const behaviorEvents = [];
  const mirroredMessages = [];
  const diagnostics = [];
  const state = {
    isSpeaking: true,
    isProcessing: true,
    isListening: false,
    heardSpeechText: "Here is what I am saying",
    streamingText: "unfinished thought",
    messages: [],
    setHeardSpeechText(value) { this.heardSpeechText = value; timeline.push(["heard", value]); },
    setSpeaking(value) { this.isSpeaking = value; timeline.push(["speaking", value]); },
    setProcessing(value) { this.isProcessing = value; timeline.push(["processing", value]); },
    setListening(value) { this.isListening = value; timeline.push(["listening", value]); },
    setStreamingText(value) { this.streamingText = value; timeline.push(["streaming", value]); },
    addMessage(message) { this.messages.push(message); timeline.push(["message", message]); },
  };
  const userState = {
    voiceState: "speaking",
    setVoiceState(value) { this.voiceState = value; timeline.push(["voiceState", value]); },
  };
  const bindings = {
    useConversationStore: { getState: () => state },
    useUserStore: { getState: () => userState },
    mirrorSessionMessage(sessionId, message) {
      mirroredMessages.push([sessionId, message]);
      timeline.push(["mirror", sessionId, message]);
    },
    recordDiagnosticEvent(...args) { diagnostics.push(args); timeline.push(["diagnostic", ...args]); },
    publishBehaviorEvent(event) {
      // This callback observes live application state at the face handoff.
      // Checking it here catches the old ordering where assistant-end arrived
      // while voice playback still owned the face.
      assert.equal(state.isSpeaking, false, "assistant-end is published after conversation speaking clears");
      assert.equal(state.isProcessing, false, "assistant-end is published after conversation processing clears");
      assert.equal(state.isListening, true, "assistant-end is published after listening is restored");
      assert.equal(userState.voiceState, "listening", "assistant-end is published after voice state is restored");
      assert.equal(state.heardSpeechText, null, "the spoken word cue is retired before the face handoff");

      if (transport === "pcm") {
        assert.equal(instance.assistantTranscript, "", "PCM transcript state is cleared before the face handoff");
        assert.equal(instance.responseDone, false, "PCM response completion is cleared before the face handoff");
        assert.equal(instance.assistantItemId, null, "PCM assistant item ownership is cleared before the face handoff");
        assert.equal(instance.assistantContentIndex, 0, "PCM content index is reset before the face handoff");
        assert.equal(instance.playbackInterrupted, false, "PCM interruption state is reset before the face handoff");
        assert.deepEqual(instance.retiredSpeechTracking, [true], "PCM speech tracking is retired before the face handoff");
      } else {
        assert.equal(instance.pendingAssistantCompletion, null, "WebRTC completion is consumed before the face handoff");
        assert.equal(instance.assistantTranscript, "", "WebRTC transcript state is cleared before the face handoff");
        assert.equal(instance.playbackTerminal, null, "WebRTC playback terminal state is cleared before the face handoff");
        assert.equal(instance.playbackActive, false, "WebRTC playback ownership is cleared before the face handoff");
      }

      assert.deepEqual(state.messages, [{ role: "assistant", content: transcript }], "the heard assistant turn is stored before handoff");
      assert.deepEqual(mirroredMessages, [[sessionId, { role: "assistant", content: transcript }]],
        "the original session and transcript are mirrored before handoff");
      assert.deepEqual(event, { type: "assistant-end", text: transcript, sessionId },
        "the face receives the original heard transcript and session");
      behaviorEvents.push(event);
      timeline.push(["assistant-end", event]);
    },
  };
  const Finalizer = evaluateOriginalMethod(
    transport === "pcm" ? pcmFinalizeSource : webrtcFinalizeSource,
    bindings,
  );
  const instance = new Finalizer();
  const sessionId = transport === "pcm" ? "pcm-face-handoff-session" : "webrtc-face-handoff-session";
  instance.active = active;
  instance.sessionId = sessionId;
  instance.assistantTranscript = transcript;
  if (transport === "pcm") {
    instance.playbackInterrupted = interrupted;
    instance.responseStatus = status;
    instance.responseDone = true;
    instance.assistantItemId = "assistant-item-1";
    instance.assistantContentIndex = 2;
    instance.retiredSpeechTracking = [];
    instance.retireSpeechTracking = (cancelNative) => {
      instance.retiredSpeechTracking.push(cancelNative);
      state.setHeardSpeechText(null);
    };
  } else {
    instance.pendingAssistantCompletion = { transcript, status, totalTokens: 12 };
    instance.playbackTerminal = playbackOutcome;
    instance.playbackActive = true;
  }
  return {
    instance, state, userState, timeline, behaviorEvents, mirroredMessages, diagnostics, sessionId,
    run: () => transport === "pcm"
      ? instance.finalizeAssistantTurn()
      : instance.finalizeAssistantTurnIfReady(playbackOutcome),
  };
}

for (const transport of ["pcm", "webrtc"]) {
  const handoff = makeHarness({ transport });
  await handoff.run();
  assert.equal(handoff.behaviorEvents.length, 1, `${transport}: heard output publishes one assistant-end`);
  const handoffIndex = handoff.timeline.findIndex(([type]) => type === "assistant-end");
  for (const cue of ["speaking", "processing", "listening", "voiceState", "heard", "message", "mirror"]) {
    const cueIndex = handoff.timeline.findIndex(([type]) => type === cue || (cue === "heard" && type === "heard"));
    assert.ok(cueIndex >= 0 && cueIndex < handoffIndex, `${transport}: ${cue} state is settled before assistant-end`);
  }
  assert.equal(handoff.diagnostics.length, 1, `${transport}: the original finalizer still records its completion diagnostic`);
}

for (const scenario of [
  { name: "interrupted", status: "completed", interrupted: true },
  { name: "failed", status: "failed" },
  { name: "incomplete", status: "incomplete" },
]) {
  const handoff = makeHarness({ transport: "pcm", ...scenario });
  await handoff.run();
  assert.equal(handoff.behaviorEvents.length, 0, `PCM ${scenario.name} output never publishes an audible assistant-end`);
  assert.equal(handoff.state.messages.length, 0, `PCM ${scenario.name} output is not persisted as heard`);
  assert.equal(handoff.mirroredMessages.length, 0, `PCM ${scenario.name} output is not mirrored as heard`);
}

for (const scenario of [
  { name: "interrupted", status: "completed", playbackOutcome: "interrupted" },
  { name: "failed", status: "failed", playbackOutcome: "stopped" },
  { name: "incomplete response", status: "incomplete", playbackOutcome: "stopped" },
  { name: "cleared before audible completion", status: "completed", playbackOutcome: "cleared" },
]) {
  const handoff = makeHarness({ transport: "webrtc", ...scenario });
  await handoff.run();
  assert.equal(handoff.behaviorEvents.length, 0, `WebRTC ${scenario.name} output never publishes an audible assistant-end`);
  assert.equal(handoff.state.messages.length, 0, `WebRTC ${scenario.name} output is not persisted as heard`);
  assert.equal(handoff.mirroredMessages.length, 0, `WebRTC ${scenario.name} output is not mirrored as heard`);
}

for (const transport of ["pcm", "webrtc"]) {
  const inactive = makeHarness({ transport, active: false });
  await inactive.run();
  assert.deepEqual(inactive.timeline, [], `${transport}: inactive finalization has no state or diagnostic side effects`);
  assert.deepEqual(inactive.behaviorEvents, [], `${transport}: inactive finalization never hands off to face behavior`);
  assert.deepEqual(inactive.mirroredMessages, [], `${transport}: inactive finalization never mirrors a message`);
}

console.log("Realtime PCM/WebRTC face speech handoff ordering and audible-turn guards: PASS");
