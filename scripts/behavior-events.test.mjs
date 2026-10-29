import assert from "node:assert/strict";
import { loadTypeScript, deferred } from "./helpers/load-typescript.mjs";
const events = loadTypeScript("src/behavior/behavior-events.ts");
const received = [];
const changed = [];
const listeningFrames = [];
let context = "";
let photo = deferred();
const detach = events.registerBehaviorAdapter({
  dispatch: (event) => received.push(event),
  getContext: () => context,
  inspectVisual: () => photo.promise,
  listeningFrame: (frame) => listeningFrames.push(frame),
});
events.beginBehaviorSession("a", (value) => changed.push(value));
assert.equal(received[0].type, "session-start");
context = "pending task"; events.refreshBehaviorContext(); events.refreshBehaviorContext();
assert.deepEqual(changed, ["pending task"], "unchanged context does not spam session.update");
events.publishBehaviorEvent({ type: "user-turn", sessionId: "old", text: "stale" });
assert.equal(received.length, 1);
const pending = events.inspectBehaviorVisual("data:image/jpeg;base64,AAAA", "look", "a");
events.publishBehaviorEvent({ type: "user-speech-start", sessionId: "a" });
const listeningRevision = events.getBehaviorInteractionRevision("a").revision;
const frame = { sessionId: "a", revision: listeningRevision, sequence: 1, nativeTimestampMs: 100, durationMs: 100, rms: 0.03 };
const contextUpdates = changed.length;
const semanticEvents = received.length;
events.publishBehaviorListeningFrame(frame);
events.publishBehaviorListeningFrame({ ...frame, sessionId: "old" });
events.publishBehaviorListeningFrame({ ...frame, revision: listeningRevision - 1 });
assert.deepEqual(listeningFrames, [frame], "only the current session and interaction receive local audio summaries");
assert.equal(received.length, semanticEvents, "audio summaries never create semantic engine events");
assert.equal(changed.length, contextUpdates, "audio summaries never update the model context");
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
