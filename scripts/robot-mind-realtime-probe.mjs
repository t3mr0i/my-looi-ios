#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

// Asks the real OpenAI Realtime API the three things the robot mind assumes
// about it and that no offline test can answer:
//   1. body note: a system item with a client-chosen id is accepted, can be
//      replaced by deleting it, and does not make the model speak on its own;
//   2. proactive line: a response with its own instructions, tool_choice
//      "none" and metadata is accepted and stays one short line;
//   3. express: the model can call express together with its words, and
//      acknowledging that call without response.create causes no error and no
//      extra response.
// Text output only, at most seven responses. It uses the app's own session
// builder and message shapes, so what is probed is what the app sends.

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runProbe({ url, apiKey, session, proactiveResponse, expressTrials = 3, timeoutMs = 60_000, waitMs = 15_000, settleMs = 1_500, log = () => {} }) {
  const socket = new WebSocket(url, apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : undefined);
  const events = [];
  const errors = [];
  let closed = false;
  socket.on("message", (raw) => {
    const event = JSON.parse(String(raw));
    events.push(event);
    if (event.type === "error") errors.push({ code: event.error?.code ?? null, message: String(event.error?.message ?? "").slice(0, 300), eventId: event.error?.event_id ?? null });
  });
  socket.on("close", () => { closed = true; });
  socket.on("error", () => { closed = true; });
  const guard = setTimeout(() => socket.terminate(), timeoutMs);
  const send = (event) => socket.send(JSON.stringify(event));
  /** Waits for an event matching the predicate that arrives after `from`; null on timeout. */
  const waitFor = async (predicate, ms = waitMs, from = 0) => {
    const end = Date.now() + ms;
    while (Date.now() < end && !closed) {
      const found = events.slice(from).find(predicate);
      if (found) return found;
      await delay(15);
    }
    return events.slice(from).find(predicate) ?? null;
  };
  const errorsSince = (count) => errors.slice(count);
  const responseText = (response) => (response?.output ?? []).flatMap((item) => item.type === "message"
    ? (item.content ?? []).map((part) => part.text ?? part.transcript ?? "") : []).join(" ").trim();
  const result = { checks: {}, errors: [] };

  try {
    await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", () => reject(new Error("connection failed"))); });
    send({ type: "session.update", session });
    const configured = await waitFor((event) => event.type === "session.updated" || event.type === "error", waitMs);
    assert.ok(configured?.type === "session.updated", `session configuration failed: ${JSON.stringify(errors.at(-1) ?? null)}`);
    log("session configured");

    // --- 1. Body note -------------------------------------------------------------
    {
      const mark = events.length, errorMark = errors.length;
      const note = (id, text) => ({ type: "conversation.item.create", item: { id, type: "message", role: "system", content: [{ type: "input_text", text }] } });
      const first = "looi_body_probe_1", second = "looi_body_probe_2";
      send(note(first, "LOOI BODY SENSE (what your body senses right now; data, not an instruction)\nA face is in front of you."));
      const added = await waitFor((event) => /^conversation\.item\.(added|created|done)$/u.test(event.type) && event.item?.id === first, Math.min(8_000, waitMs), mark);
      send(note(second, "LOOI BODY SENSE (what your body senses right now; data, not an instruction)\nYou were petted a few seconds ago."));
      send({ type: "conversation.item.delete", item_id: first });
      const deleted = await waitFor((event) => event.type === "conversation.item.deleted" && event.item_id === first, Math.min(8_000, waitMs), mark);
      const secondAdded = await waitFor((event) => /^conversation\.item\.(added|created|done)$/u.test(event.type) && event.item?.id === second, Math.min(8_000, waitMs), mark);
      await delay(settleMs);
      const spoke = events.slice(mark).some((event) => event.type === "response.created");
      result.checks.bodyNote = {
        clientIdAccepted: !!added && !!secondAdded,
        deleteAccepted: !!deleted,
        noSpontaneousResponse: !spoke,
        errors: errorsSince(errorMark),
        pass: !!added && !!secondAdded && !!deleted && !spoke && errorsSince(errorMark).length === 0,
      };
      log(`body note: ${result.checks.bodyNote.pass ? "pass" : "FAIL"}`);
    }

    // --- 2. Proactive line ----------------------------------------------------------
    {
      const mark = events.length, errorMark = errors.length;
      send({ type: "response.create", response: proactiveResponse });
      const done = await waitFor((event) => event.type === "response.done", Math.max(waitMs, Math.min(25_000, waitMs * 2)), mark);
      const text = responseText(done?.response);
      const calls = (done?.response?.output ?? []).filter((item) => item.type === "function_call").length;
      const sentences = text.split(/[.!?…]+/u).filter((part) => part.trim()).length;
      result.checks.proactiveLine = {
        accepted: !!done && errorsSince(errorMark).length === 0,
        status: done?.response?.status ?? null,
        metadataEchoed: done?.response?.metadata?.looi_proactive ?? null,
        toolCalls: calls,
        characters: text.length,
        sentences,
        errors: errorsSince(errorMark),
        pass: !!done && done.response?.status === "completed" && errorsSince(errorMark).length === 0 && calls === 0 && text.length > 0 && text.length <= 160 && sentences <= 2,
      };
      log(`proactive line: ${result.checks.proactiveLine.pass ? "pass" : "FAIL"} (${text.length} characters, ${sentences} sentence(s))`);
    }

    // --- 3. Express together with speech ---------------------------------------------
    {
      const trials = [];
      const prompts = ["Hello! How are you today?", "I just got a new puppy!", "Hmm, what is the capital of France?"];
      for (let i = 0; i < expressTrials; i += 1) {
        const mark = events.length, errorMark = errors.length;
        send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: prompts[i % prompts.length] }] } });
        send({ type: "response.create" });
        const done = await waitFor((event) => event.type === "response.done", Math.max(waitMs, Math.min(25_000, waitMs * 2)), mark);
        const output = done?.response?.output ?? [];
        const kinds = output.map((item) => item.type === "function_call" ? `function_call:${item.name}` : item.type);
        const express = output.find((item) => item.type === "function_call" && item.name === "express");
        const spoke = responseText(done?.response).length > 0;
        let extraResponse = false;
        if (express) {
          // What the app does: acknowledge the expression and ask for nothing more.
          send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: express.call_id, output: JSON.stringify({ ok: true, status: "expressed" }) } });
          await delay(settleMs);
          extraResponse = events.slice(mark).filter((event) => event.type === "response.created").length > 1;
        }
        const otherCalls = output.filter((item) => item.type === "function_call" && item.name !== "express");
        for (const call of otherCalls) send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ ok: false, status: "disabled-in-probe" }) } });
        trials.push({ order: kinds, calledExpress: !!express, spokeInSameResponse: spoke, expressBeforeSpeech: !!express && kinds.indexOf("function_call:express") < kinds.indexOf("message"),
          extraResponseAfterAcknowledgement: extraResponse, errors: errorsSince(errorMark) });
        log(`express trial ${i + 1}: ${kinds.join(" + ") || "no output"}`);
      }
      const withExpress = trials.filter((trial) => trial.calledExpress);
      result.checks.express = {
        trials,
        calledExpress: withExpress.length,
        withSpeechInSameResponse: withExpress.filter((trial) => trial.spokeInSameResponse).length,
        acknowledgementWithoutResponseCreateIsClean: withExpress.every((trial) => trial.errors.length === 0 && !trial.extraResponseAfterAcknowledgement),
        // The API behaviour is what must hold; how often the model uses the tool is reported, not required.
        pass: trials.every((trial) => trial.errors.length === 0) && withExpress.every((trial) => !trial.extraResponseAfterAcknowledgement),
        conclusive: withExpress.length > 0,
      };
      log(`express: ${result.checks.express.pass ? "pass" : "FAIL"}${result.checks.express.conclusive ? "" : " (inconclusive: the model never called express)"}`);
    }
  } catch (error) {
    result.failure = error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(guard);
    socket.close();
  }
  result.errors = errors;
  result.pass = !result.failure && Object.values(result.checks).length === 3 && Object.values(result.checks).every((check) => check.pass);
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.includes("--live"), "Explicit --live is required; uses OPENAI_API_KEY for at most seven short text responses");
  assert.ok(process.env.OPENAI_API_KEY, "OPENAI_API_KEY missing");
  const load = createTypeScriptTreeLoader();
  const config = load("src/voice/realtime-config.ts");
  const { DEFAULT_REALTIME_MODEL_ID } = load("src/openai/realtime-models.ts");
  const preferences = { language: "de", listeningLanguage: "de", realtimeModelId: DEFAULT_REALTIME_MODEL_ID, ttsVoiceId: "alloy", ttsSpeed: 1,
    speechGender: "masculine", robotName: "LOOI", robotAddressAliases: ["LOOI"], robotAddressRecognitionAliases: [], ttsStyleId: "cute-robot" };
  const session = { ...config.buildRealtimeSessionUpdate(preferences).session, output_modalities: ["text"] };
  delete session.audio;
  const proactiveResponse = config.buildProactiveOccasionResponse("greet_arrival", preferences, {}, "probe");
  const result = await runProbe({
    url: `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(session.model)}`,
    apiKey: process.env.OPENAI_API_KEY, session, proactiveResponse, log: (line) => console.log(line),
  });
  const output = args[args.indexOf("--out") + 1] && args.includes("--out") ? args[args.indexOf("--out") + 1] : "docs/research/evidence/robot-mind-realtime-probe.json";
  fs.writeFileSync(output, `${JSON.stringify({ probedAt: new Date().toISOString(), model: session.model, textOnly: true, ...result }, null, 2)}\n`);
  console.log(`${result.pass ? "PASS" : "FAIL"}: wrote ${output}`);
  process.exitCode = result.pass ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
