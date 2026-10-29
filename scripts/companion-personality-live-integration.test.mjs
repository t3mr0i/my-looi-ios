import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { getCompanionLiveSuite } from "./companion-live-suites.mjs";
import { createSyntheticPersonalityProfile } from "./companion-personality-live-cases.mjs";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";
import { runLiveEvaluation } from "./companion-live-eval.mjs";

// Scripted server responses verify transport/context wiring only. They are
// deliberately ordinary fixtures, never evidence of model quality or hearing.
class PersonalityProtocolSocket extends EventEmitter {
  readyState = 1;
  instructions = "";
  contexts = [];
  outputs = [];
  responses = 0;
  sentTool = false;
  constructor(testCase) {
    super(); this.testCase = testCase;
    setImmediate(() => { this.emitServer({ type: "session.created", session: { id: `fake-${testCase.id}` } }); this.emit("open"); });
  }
  send(raw) {
    const event = JSON.parse(raw);
    if (event.type === "session.update") {
      this.instructions = String(event.session?.instructions ?? "");
      setImmediate(() => this.emitServer({ type: "session.updated", session: {} }));
    } else if (event.type === "conversation.item.create" && event.item?.type === "function_call_output") {
      this.outputs.push(JSON.parse(event.item.output));
      setImmediate(() => this.emitServer({ type: "conversation.item.created", item: { type: "function_call_output", call_id: event.item.call_id } }));
    } else if (event.type === "response.create") {
      const id = `fake-response-${++this.responses}`;
      const metadata = event.response?.metadata;
      const response = { id, ...(metadata ? { metadata } : {}) };
      this.contexts.push(readContext(this.instructions));
      assert.match(this.instructions, /stable temperament is gentle curiosity/u);
      const needsTool = this.testCase.expected?.requiredTool && !this.sentTool;
      this.sentTool ||= !!needsTool;
      setImmediate(() => {
        this.emitServer({ type: "response.created", response });
        if (needsTool) {
          this.emitServer({ type: "response.output_item.done", response_id: id, item: { type: "function_call", call_id: "fake-interest-call", name: "list_companion_interests", arguments: "{}" } });
          this.emitServer({ type: "response.done", response: { ...response, status: "completed", output: [{ type: "function_call" }] } });
        } else {
          this.emitServer({ type: "response.done", response: { ...response, status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Eine kurze Testantwort." }] }] } });
        }
      });
    }
  }
  emitServer(event) { this.emit("message", Buffer.from(JSON.stringify(event))); }
  close() { this.readyState = 3; }
  terminate() { this.readyState = 3; }
}

function readContext(instructions) {
  const marker = instructions.indexOf("LOCAL ROBOT INTERACTION STATE (");
  assert.ok(marker >= 0);
  const start = instructions.indexOf(":\n", marker) + 2;
  const end = instructions.indexOf("\nUse a pending robot task", start);
  assert.ok(end > start);
  return JSON.parse(instructions.slice(start, end));
}

const now = Date.now();
const first = createSyntheticPersonalityProfile("new", now);
const developed = createSyntheticPersonalityProfile("familiar", now);
const quiet = createSyntheticPersonalityProfile("quiet", now);
assert.equal(first.episodes.length, 0);
assert.equal(first.life.days.length, 0);
assert.equal(developed.episodes[0].learnedInterest.encounters.length, 3);
assert.equal(developed.life.days.length, 22);
assert.equal(quiet.life.days.length, 22, "dense conversation is not extra affection");
assert.ok(quiet.life.vitality.energy < 0.45);
assert.throws(() => createSyntheticPersonalityProfile("unknown"));
assert.deepEqual(createSyntheticPersonalityProfile("familiar", now), developed, "synthetic setup is reproducible at a fixed time");

const suite = getCompanionLiveSuite("personality");
assert.equal(suite.cases.length, 6);
assert.notEqual(getCompanionLiveSuite("personality").cases, suite.cases);
const sockets = [];
let socketIndex = 0;
const sentinel = "synthetic-personality-key-never-log";
const report = await runLiveEvaluation({
  suiteId: suite.id, cases: suite.cases, apiKey: sentinel, testOnly: true,
  socketFactory: () => { const socket = new PersonalityProtocolSocket(suite.cases[socketIndex++]); sockets.push(socket); return socket; },
});
assert.equal(report.status, "test_harness_only", "scripted output can never qualify as a real model run");
assert.equal(report.cases.length, 6);
for (const result of report.cases) {
  assert.equal(result.status, "mechanical_checks_passed", JSON.stringify({ id: result.id, checks: result.checks }));
}
assert.equal(sockets[0].contexts[0].personality.life.familiarity, "new");
assert.equal(sockets[1].contexts[0].personality.life.familiarity, "at_ease");
assert.equal(sockets[1].contexts[0].personality.greetingInterest.title, "Gerda");
assert.deepEqual(sockets[2].outputs[0].interests, ["Gerda"]);
assert.equal(sockets[2].outputs[0].status, "interest-overview");
assert.equal(sockets[3].contexts[0].personality.conversationMoment.valence, "negative");
assert.equal(sockets[4].contexts[0].personality.tone, "calm");
assert.equal(sockets[5].contexts[0].personality.life.energy, "quiet");
assert.equal(sockets[5].contexts[0].personality.life.playfulness, "gentle");
const quietSnapshot = structuredClone(report.cases[5].observed.engine);
assert.equal(suite.cases[5].expected.state(quietSnapshot), true);
quietSnapshot.personality.life.energy = "rested";
assert.equal(suite.cases[5].expected.state(quietSnapshot), false, "a quiet fixture cannot pass if its actual state is energetic");
quietSnapshot.personality.life.energy = "quiet";
quietSnapshot.personality.life.playfulness = "ready";
assert.equal(suite.cases[5].expected.state(quietSnapshot), false, "a quiet fixture cannot pass if its actual state still invites lively play");
assert.ok(!JSON.stringify(report).includes(sentinel));
assert.ok(!JSON.stringify(report.cases.map((item) => item.observed?.engine?.personality)).includes("lastPetAt"), "derived report data never leaks touch timestamps");

// The same captured production character context also controls Budget wording
// and delivery; this is still a local prompt check, not a Budget model reply.
const load = createTypeScriptTreeLoader({ "./openai-api-key": { getOpenAiApiKey: async () => { throw new Error("No network"); } } });
const { buildBudgetConversationInstructions } = load("src/openai/budget-conversation.ts");
const { buildCompanionDeliveryInstructions } = load("src/character/companion-personality.ts");
for (const socket of sockets) {
  const context = JSON.stringify(socket.contexts[0].personality);
  assert.match(buildBudgetConversationInstructions("LOOI", "de", undefined, false, context), /stable temperament is gentle curiosity/u);
}
for (const index of [3, 4, 5]) assert.match(buildCompanionDeliveryInstructions(JSON.stringify(sockets[index].contexts[0].personality)), /calmer manner/u);
console.log("Personality live-eval preparation: six production PCM/context fixtures, mature interest tool, setbacks, calm/quiet priority and bounded reporting PASS (scripted protocol only; no model, hearing, weeks or hardware evidence)");
