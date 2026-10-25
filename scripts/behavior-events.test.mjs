import assert from "node:assert/strict";
import { loadTypeScript, deferred } from "./helpers/load-typescript.mjs";
const events = loadTypeScript("src/behavior/behavior-events.ts");
const received = [];
const changed = [];
let context = "";
let photo = deferred();
const detach = events.registerBehaviorAdapter({
  dispatch: (event) => received.push(event),
  getContext: () => context,
  inspectVisual: () => photo.promise,
});
events.beginBehaviorSession("a", (value) => changed.push(value));
assert.equal(received[0].type, "session-start");
context = "pending task"; events.refreshBehaviorContext(); events.refreshBehaviorContext();
assert.deepEqual(changed, ["pending task"], "unchanged context does not spam session.update");
events.publishBehaviorEvent({ type: "user-turn", sessionId: "old", text: "stale" });
assert.equal(received.length, 1);
const pending = events.inspectBehaviorVisual("data:image/jpeg;base64,AAAA", "look", "a");
events.publishBehaviorEvent({ type: "user-speech-start", sessionId: "a" });
photo.resolve("retake image");
assert.equal(await pending, "", "barge-in invalidates a delayed visual assessment");
photo = deferred();
const replaced = events.inspectBehaviorVisual("data:image/jpeg;base64,AAAA", "look", "a");
events.beginBehaviorSession("b", () => {});
events.endBehaviorSession("a");
assert.equal(events.getBehaviorConversationContext("b"), "pending task");
photo.resolve("old advice");
assert.equal(await replaced, "");
assert.equal(events.getBehaviorConversationContext("a"), "");
events.endBehaviorSession("b");
const before = received.length;
events.publishBehaviorEvent({ type: "faces", faces: [] });
assert.equal(received.length, before);
detach();
events.beginBehaviorSession("c", () => {});
assert.equal(await events.inspectBehaviorVisual("image", "task", "c"), "");
events.endBehaviorSession("c");
console.log("Behavior voice/session bridge: PASS");
