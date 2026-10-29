import assert from "node:assert/strict";
import { loadTypeScript, deferred } from "./helpers/load-typescript.mjs";

const policy = loadTypeScript("src/behavior/behavior-policy.ts");
const companion = loadTypeScript("src/behavior/behavior-companion.ts", {
  "../character/companion-personality": loadTypeScript("src/character/companion-personality.ts"),
  "./behavior-episode-search": loadTypeScript("src/behavior/behavior-episode-search.ts"),
});
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function harness({ curiosity = true, decide } = {}) {
  let time = 1_000;
  let serial = 0;
  const timers = new Map();
  const calls = [];
  const cues = [];
  const module = loadTypeScript("src/behavior/behavior-engine.ts", {
    "./behavior-policy": policy, "./behavior-companion": companion, "./shared-activity": loadTypeScript("src/behavior/shared-activity.ts"),
  }, {
    setTimeout(callback, ms = 0) { const id = ++serial; timers.set(id, { callback, at: time + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  function answer(input) {
    return {
      answers: input.questions.map((question) => ({
        name: question.name, type: "choice", confidence: 0.99,
        choice: question.name === "cue" ? (input.context.recentAssistantText.includes("fixed") ? "happy_bob" : "curious")
          : question.name === "visual" ? "use_view" : question.name === "attention" ? "keep_target" : "wait",
      })),
      usage: { inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0 }, requestId: "offline-moment",
    };
  }
  const engine = module.createBehaviorEngine({
    now: () => time, wallNow: () => Date.UTC(2026, 9, 26) + time,
    decide: async (input) => { calls.push(input); return decide ? decide(input, answer) : answer(input); },
    executeCue: (cue) => cues.push({ ...cue }),
  });
  engine.configure({ mode: "active", dailyBudgetUsd: 1, candidateScoring: false, visualEnabled: true, curiosityEnabled: curiosity });
  engine.setEnvironment({ foreground: true, focused: true, sleeping: false, connected: true, ambientEnabled: true, cameraEnabled: false, userSpeaking: false, assistantSpeaking: false, motionActive: false });
  const event = (type, fields = {}) => engine.dispatch({ type, sessionId: "moment-session", ...fields });
  event("session-start");
  async function advance(ms) {
    const target = time + ms;
    let count = 0;
    while (true) {
      const next = [...timers.entries()].filter(([, value]) => value.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      assert.ok(++count < 500, "scheduled work settles");
      timers.delete(next[0]); time = next[1].at; next[1].callback(); await flush();
    }
    time = target; await flush();
  }
  async function turn(text) {
    event("user-speech-start"); event("user-speech-end"); event("user-turn", { text }); await flush();
  }
  async function reply(text) {
    await advance(1_100); event("assistant-start"); event("assistant-end", { text }); await flush();
  }
  return { engine, calls, cues, event, advance, turn, reply, answer,
    physical: () => cues.filter((cue) => !cue.presentationOnly && cue.gesture !== "hold") };
}

const moment = harness();
await moment.turn("Why did the paper rocket fall?");
assert.equal(moment.engine.getState().moment.phase, "reflecting");
assert.equal(moment.cues.at(-1).presentationOnly, true);
assert.equal(moment.physical().length, 0, "input expression reserves the physical beat for the heard outcome");
await moment.reply("We fixed it. The rocket stands now!");
const outputContext = moment.calls.at(-1).context;
assert.equal(outputContext.eventType, "assistant-end");
assert.equal(outputContext.recentUserText, "Why did the paper rocket fall?");
assert.equal(outputContext.recentAssistantText, "We fixed it. The rocket stands now!");
assert.equal(outputContext.eventText, outputContext.recentAssistantText);
assert.equal(moment.physical().length, 1);
assert.equal(moment.physical()[0].gesture, "happy_bob");
await moment.advance(1_501); moment.engine.tick();
assert.equal(moment.engine.getState().moment.phase, "settled");
assert.equal(moment.engine.getState().posture, "settle");

const delayed = deferred();
const late = harness({ decide: () => delayed.promise });
await late.turn("Tell me something");
late.event("assistant-start");
delayed.resolve(late.answer(late.calls[0])); await flush();
assert.equal(late.cues.length, 0, "a delayed input cue cannot start after audible output begins");
assert.equal(late.engine.getState().moment.phase, "speaking");

const history = harness();
await history.turn("We built the paper rocket Gerda together and it fell over.");
const draft = { type: "propose_experience", title: "Gerda", detail: "Our paper rocket tipped over.", outcome: "It needed a wider foot.", motif: "happy_bob", evidence: "We built the paper rocket Gerda together" };
assert.equal(history.engine.companionAction(draft).status, "proposed");
assert.equal(history.engine.getState().companion.episodes.length, 0);
await history.reply("Should I remember Gerda and our wider-foot idea?");
await history.turn("Yes");
assert.equal(history.engine.getState().companion.episodes.length, 1, "normal speech edges preserve the heard confirmation until its answer");
const stored = history.engine.serialize();
const reload = harness(); reload.engine.restore(stored);
assert.equal(reload.engine.getState().companion.episodes.length, 1);
assert.equal(reload.engine.getState().companion.pendingExperience, null);
assert.equal(reload.engine.getState().companion.interest, null);
await reload.turn("Gerda it stands now");
assert.equal(reload.physical().at(-1).gesture, "happy_bob", "an explicitly reported outcome can use the confirmed episode motif");
const motifCount = reload.physical().length;
await reload.advance(1_100); await reload.turn("Gerda it stands now");
assert.equal(reload.physical().length, motifCount, "repeated success respects the motif cooldown");
assert.doesNotThrow(() => JSON.parse(reload.engine.getConversationContext()));
assert.ok(reload.engine.getConversationContext().length <= 8_000);
const id = reload.engine.getState().companion.episodes[0].id;
reload.engine.forgetExperience(id);
assert.equal(reload.engine.getState().companion.episodes.length, 0);
assert.equal(JSON.stringify(JSON.parse(reload.engine.serialize()).companion).includes("Gerda"), false);

const curiosity = harness();
await curiosity.turn("Look at our rocket");
assert.equal(curiosity.engine.companionAction({ type: "offer_interest", topic: "flight", question: "Will it fly?" }).ok, false);
await curiosity.advance(1_100);
const view = curiosity.engine.inspectVisual("data:image/jpeg;base64,AA==", "Look at our rocket", "moment-session");
await flush(); assert.match(await view, /usable/u);
const offer = { type: "offer_interest", topic: "rocket flight", question: "Is this rocket meant to fly?" };
assert.equal(curiosity.engine.companionAction(offer).status, "interest_offered");
assert.equal(curiosity.engine.companionAction(offer).ok, false, "one explicit visual grants only one offer");
await curiosity.reply(offer.question);
assert.equal(curiosity.engine.getState().companion.interest.status, "waiting");
const requestsBeforeSilence = curiosity.calls.length;
await curiosity.advance(20_001); curiosity.engine.tick();
assert.equal(curiosity.engine.getState().companion.interest.status, "closed");
assert.equal(curiosity.calls.length, requestsBeforeSilence, "silence closes the interest without another model request or spoken follow-up");

const disabled = harness({ curiosity: false });
await disabled.turn("Look at our rocket"); await disabled.advance(1_100);
const disabledView = disabled.engine.inspectVisual("image", "Look at our rocket", "moment-session"); await flush(); await disabledView;
assert.equal(disabled.engine.companionAction(offer).ok, false, "visual opt-in alone cannot enable curiosity");
assert.ok(disabled.engine.getState().companion.visualGrant, "an explicit usable image can support confirmed object memory while optional curiosity remains off");

const privacy = harness();
await privacy.turn("We built the paper rocket Gerda together and it fell over.");
privacy.engine.companionAction(draft);
privacy.engine.setEnvironment({ foreground: false });
assert.equal(privacy.engine.getState().companion.pendingExperience, null);
assert.equal(privacy.engine.companionAction(draft).ok, false);
assert.equal(privacy.engine.getState().moment.phase, "settled");
for (const h of [moment, late, history, reload, curiosity, disabled, privacy]) h.engine.dispose();
console.log("Coordinated moments, heard output context, confirmed episode continuity, one-shot visual curiosity, silence and privacy PASS");
