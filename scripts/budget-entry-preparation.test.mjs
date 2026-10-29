import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

// Execute the real entry method. Native capture deliberately cannot satisfy
// the WebRTC handoff barrier, as observed in the failed physical Budget run.
const source = fs.readFileSync("src/perceivers/voice-perceiver.ts", "utf8");
const ast = ts.createSourceFile("voice-perceiver.ts", source, ts.ScriptTarget.Latest, true);
const subject = ast.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === "VoicePerceiver");
const method = subject.members.find((node) => ts.isMethodDeclaration(node) && node.name.getText(ast) === "runFreshLaunchAutoListen");
assert.ok(method);
const constants = ast.statements.filter((node) => ts.isVariableStatement(node)
  && node.declarationList.declarations.every((d) => d.name.getText(ast).startsWith("FRESH_LAUNCH_")))
  .map((node) => node.getText(ast)).join("\n");
const code = ts.transpileModule(`${constants}\nclass Entry { ${method.getText(ast)} }\nmodule.exports = Entry;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

for (const mode of ["budget", "realtime", "realtime_pcm", "classic"]) {
  let starts = 0, preparationCalls = 0;
  const readiness = [];
  const dependencies = {
    useUserStore: { getState: () => ({ preferences: { conversationMode: mode } }) },
    useConversationStore: { getState: () => ({ setCurrentTranscript() {}, setStreamingText() {}, setOverlayVisible() {}, setRealtimeReadiness(value) { readiness.push(value); } }) },
    isManagedConversationMode: (value) => ["budget", "realtime", "realtime_pcm"].includes(value),
    isRealtimeConversationMode: (value) => ["realtime", "realtime_pcm"].includes(value),
    kwsAudioFeeder: { diagnosticStatus: { running: true, pcmFlowing: true, pcmAgeMs: 800 }, async stop() {} },
    recordDiagnosticEvent() {}, setTimeout: (callback) => { queueMicrotask(callback); return 1; },
  };
  const module = { exports: {} };
  new Function(...Object.keys(dependencies), "module", "exports", code)(...Object.values(dependencies), module, module.exports);
  const entry = new module.exports();
  entry.isFreshLaunchAutoListenStillEligible = () => true;
  entry.freshLaunchAudioStatusFields = () => ({});
  entry.prepareFreshLaunchRealtimeMicrophone = async () => { preparationCalls++; return { ok: false, stage: "stable-pcm", firstPcmWaitMs: 0 }; };
  entry.handleWakeword = async () => { starts++; };
  entry.cancelFreshLaunchRealtimePreparation = () => {};
  await entry.runFreshLaunchAutoListen("manual-retry");
  const isRealtime = ["realtime", "realtime_pcm"].includes(mode);
  assert.equal(starts, isRealtime ? 0 : 1, `${mode}: only Realtime needs its handoff barrier before starting`);
  assert.equal(preparationCalls, isRealtime ? 2 : 0, `${mode}: native handoff preparation has the correct owner`);
  assert.equal(readiness.includes("microphone-error"), isRealtime, `${mode}: Budget must not inherit a failed Realtime gate`);
}
console.log("Budget entry: direct start, retained Realtime handoff barrier, Classic entry passed");
