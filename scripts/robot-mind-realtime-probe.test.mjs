import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { runProbe } from "./robot-mind-realtime-probe.mjs";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

// The probe itself is an instrument, so it is checked against a local stand-in
// for the API: it must pass a server that behaves as assumed and must fail,
// naming the reason, when one of the three assumptions does not hold. This
// says nothing about the real API; only the live run does.
function fakeRealtime(behaviour = {}) {
  const server = new WebSocketServer({ port: 0 });
  const received = [];
  server.on("connection", (socket) => {
    let responses = 0;
    const send = (event) => socket.send(JSON.stringify(event));
    const respond = (output, metadata) => {
      const id = `resp_${++responses}`;
      send({ type: "response.created", response: { id } });
      send({ type: "response.done", response: { id, status: "completed", output, ...(metadata ? { metadata } : {}) } });
    };
    socket.on("message", (raw) => {
      const event = JSON.parse(String(raw));
      received.push(event);
      if (event.type === "session.update") return send({ type: "session.updated", session: event.session });
      if (event.type === "conversation.item.create") {
        if (event.item.id && behaviour.rejectClientIds) return send({ type: "error", error: { code: "invalid_value", message: "item id must be server-generated" } });
        if (event.item.type === "function_call_output" && behaviour.respondToToolOutput) respond([{ type: "message", content: [{ type: "text", text: "And another thing." }] }]);
        return send({ type: "conversation.item.added", item: { id: event.item.id ?? `item_${received.length}`, type: event.item.type } });
      }
      if (event.type === "conversation.item.delete") return send({ type: "conversation.item.deleted", item_id: event.item_id });
      if (event.type === "response.create") {
        if (event.response?.metadata?.looi_proactive) {
          if (behaviour.rejectToolChoice) return send({ type: "error", error: { code: "unknown_parameter", message: "tool_choice is not allowed here" } });
          const text = behaviour.chattyProactive ? "Oh hallo! Schön dich zu sehen. Wie geht es dir heute? Ich habe schon gewartet. Erzähl mal!" : "Oh, hallo!";
          return respond([{ type: "message", content: [{ type: "text", text }] }], event.response.metadata);
        }
        const express = { type: "function_call", name: "express", call_id: `call_${responses + 1}`, arguments: "{\"intent\":\"happy\"}" };
        return respond(behaviour.neverExpress ? [{ type: "message", content: [{ type: "text", text: "Hallo!" }] }]
          : [{ type: "message", content: [{ type: "text", text: "Hallo!" }] }, express]);
      }
    });
  });
  return { url: () => `ws://127.0.0.1:${server.address().port}`, received, close: () => new Promise((resolve) => server.close(resolve)) };
}

const load = createTypeScriptTreeLoader();
const config = load("src/voice/realtime-config.ts");
const preferences = { language: "de", listeningLanguage: "de", realtimeModelId: "test", ttsVoiceId: "alloy", ttsSpeed: 1, speechGender: "masculine", robotName: "LOOI", robotAddressAliases: ["LOOI"], robotAddressRecognitionAliases: [] };
const session = { ...config.buildRealtimeSessionUpdate(preferences).session, output_modalities: ["text"] };
const proactiveResponse = config.buildProactiveOccasionResponse("greet_arrival", preferences, {}, "probe");
assert.equal(proactiveResponse.tool_choice, "none");
assert.ok(session.tools.some((tool) => tool.name === "express"), "the probed session carries the app's real tools");

async function probeAgainst(behaviour) {
  const server = fakeRealtime(behaviour);
  try { return { result: await runProbe({ url: server.url(), session, proactiveResponse, expressTrials: 2, timeoutMs: 40_000, waitMs: 400, settleMs: 120 }), received: server.received }; }
  finally { await server.close(); }
}

{
  const { result, received } = await probeAgainst({});
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.deepEqual(result.checks.bodyNote, { clientIdAccepted: true, deleteAccepted: true, noSpontaneousResponse: true, errors: [], pass: true });
  assert.equal(result.checks.proactiveLine.metadataEchoed, "probe");
  assert.deepEqual([result.checks.express.calledExpress, result.checks.express.withSpeechInSameResponse, result.checks.express.conclusive], [2, 2, true]);
  assert.equal(result.checks.express.trials[0].expressBeforeSpeech, false, "the probe reports the order the server used");
  // It sends what the app sends.
  const note = received.find((event) => event.type === "conversation.item.create" && event.item.role === "system");
  assert.deepEqual([note.item.type, note.item.content[0].type, /^looi_body_/u.test(note.item.id)], ["message", "input_text", true]);
  const acknowledgements = received.filter((event) => event.type === "conversation.item.create" && event.item.type === "function_call_output");
  assert.equal(acknowledgements.length, 2);
  assert.equal(received.filter((event) => event.type === "response.create").length, 3, "one proactive line and two turns; no response is requested after an expression");
}
{
  const { result } = await probeAgainst({ rejectClientIds: true });
  assert.equal(result.pass, false);
  assert.equal(result.checks.bodyNote.clientIdAccepted, false);
  assert.match(result.checks.bodyNote.errors[0].message, /server-generated/u);
}
{
  const { result } = await probeAgainst({ rejectToolChoice: true });
  assert.equal(result.checks.proactiveLine.pass, false);
  assert.equal(result.checks.proactiveLine.accepted, false);
}
{
  const { result } = await probeAgainst({ chattyProactive: true });
  assert.equal(result.checks.proactiveLine.pass, false, "a proactive line that runs on is reported");
  assert.ok(result.checks.proactiveLine.sentences > 2);
}
{
  const { result } = await probeAgainst({ respondToToolOutput: true });
  assert.equal(result.checks.express.pass, false, "an API that answers the acknowledgement with another response is reported");
  assert.equal(result.checks.express.acknowledgementWithoutResponseCreateIsClean, false);
}
{
  const { result } = await probeAgainst({ neverExpress: true });
  assert.deepEqual([result.checks.express.pass, result.checks.express.conclusive], [true, false], "a model that never calls express leaves that check inconclusive, not failed");
}

console.log("Robot mind Realtime probe: instrument verified against a local stand-in (the live run is separate) PASS");
