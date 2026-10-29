import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const { createSpeechExpressionTracker, splitBudgetSpeechSections } = loadTypeScript("src/character/speech-expression.ts");

assert.deepEqual(splitBudgetSpeechSections("Eins. Zwei? Drei! Vier."), ["Eins.", "Zwei?", "Drei! Vier."], "Budget voice keeps clips sentence-bounded and capped at three requests");
const longBudgetReply = "Satz ".repeat(1_800).trim();
assert.equal(splitBudgetSpeechSections(longBudgetReply).join(" "), longBudgetReply, "Budget clip grouping never silently truncates a long response");

function event(overrides = {}) {
  return {
    responseId: "response-1",
    sessionId: "session-1",
    generation: 7,
    language: "de",
    endpoint: true,
    audioDurationMs: 4_000,
    words: [
      { word: "Wow", startMs: 80, endMs: 260, confidence: 0.92 },
      { word: "das", startMs: 300, endMs: 420, confidence: 0.9 },
      { word: "ist", startMs: 440, endMs: 570, confidence: 0.91 },
      { word: "fantastisch", startMs: 590, endMs: 990, confidence: 0.95 },
      { word: "Wirklich", startMs: 1_120, endMs: 1_420, confidence: 0.94 },
      { word: "toll", startMs: 1_450, endMs: 1_760, confidence: 0.9 },
    ],
    ...overrides,
  };
}

function create(onHeard = () => {}) {
  const tracker = createSpeechExpressionTracker({
    responseId: "response-1",
    sessionId: "session-1",
    generation: 4,
    language: "de",
    onHeard,
  });
  tracker.setNativeGeneration(7);
  return tracker;
}

{
  const changes = [];
  const tracker = create((text) => changes.push(text));
  tracker.setTranscript("Wow, das ist fantastisch! Wirklich toll.");
  tracker.acceptRecognition(event({ generation: 7 }));
  tracker.advancePlayback(980);
  assert.deepEqual(changes, [], "generation and ASR alone must not move expression before its actual word end");
  tracker.advancePlayback(989);
  assert.deepEqual(changes, [], "the next millisecond remains unheard before the word end");
  tracker.advancePlayback(990);
  assert.deepEqual(changes, ["Wow, das ist fantastisch!"], "the exact ASR-confirmed first sentence is released at its actual playback end");
  tracker.advancePlayback(1_120);
  assert.deepEqual(changes, ["Wow, das ist fantastisch!", null], "a prior mood is cleared when reliable ASR timing shows that the next passage has begun");
  tracker.advancePlayback(1_759);
  assert.equal(changes.length, 2, "the next section stays neutral until its complete playback end");
  tracker.advancePlayback(1_760);
  assert.deepEqual(changes, ["Wow, das ist fantastisch!", null, "Wirklich toll."], "the next matching section takes over when it is actually heard");
}

{
  const changes = [];
  const tracker = create((text) => changes.push(text));
  tracker.setTranscript("Wow, das ist fantastisch! Wirklich toll.");
  tracker.advancePlayback(3_000);
  assert.deepEqual(changes, [], "text and a fast playhead cannot substitute for local ASR words");
  tracker.acceptRecognition(event({ words: event().words.map((word) => ({ ...word, confidence: 0.2 })) }));
  assert.deepEqual(changes, [], "low-confidence words never confirm a phrase");
  tracker.acceptRecognition(event({ words: [{ ...event().words[0], word: "Vielleicht" }] }));
  assert.deepEqual(changes, [], "ASR tokens must match the exact current assistant transcript");
}

{
  const changes = [];
  const tracker = create((text) => changes.push(text));
  tracker.setTranscript("Wow, das ist fantastisch! Wirklich toll. Noch besser! Weiter so!");
  tracker.acceptRecognition(event({ words: [
    ...event().words,
    { word: "Noch", startMs: 1_900, endMs: 2_100, confidence: 0.94 },
    { word: "besser", startMs: 2_120, endMs: 2_450, confidence: 0.92 },
    { word: "Weiter", startMs: 2_600, endMs: 2_900, confidence: 0.9 },
    { word: "so", startMs: 2_920, endMs: 3_100, confidence: 0.9 },
  ] }));
  tracker.advancePlayback(2_450);
  assert.deepEqual(changes, ["Noch besser!"], "late ASR catches up to the latest fully heard section without replaying stale moods");
  tracker.setTranscript("Wow, das ist fantastisch! Wirklich toll. Noch besser! Weiter so!");
  tracker.advancePlayback(3_100);
  assert.deepEqual(changes, ["Noch besser!", "Weiter so!"], "a long response is limited to two heard-section changes");
}

{
  const changes = [];
  const tracker = create((text) => changes.push(text));
  tracker.setTranscript("Wow, das ist fantastisch!");
  tracker.acceptRecognition(event({
    sessionId: "stale-session",
  }));
  tracker.acceptRecognition(event({ generation: 3 }));
  tracker.acceptRecognition(event({ responseId: "stale-response" }));
  tracker.acceptRecognition(event({ language: "en" }));
  tracker.advancePlayback(4_000);
  assert.deepEqual(changes, [], "stale response, session, generation, and language events are ignored");
  tracker.acceptRecognition(event({ audioDurationMs: 1_000, words: event().words.slice(0, 4) }));
  tracker.advancePlayback(1_500);
  assert.deepEqual(changes, ["Wow, das ist fantastisch!"]);
  tracker.invalidate();
  assert.deepEqual(changes, ["Wow, das ist fantastisch!", null], "invalidation immediately clears confirmed speech");
  tracker.advancePlayback(4_000);
  assert.equal(changes.length, 2, "invalidated playback cannot resurrect old speech mood");
}

{
  const changes = [];
  const invalidations = [];
  const tracker = createSpeechExpressionTracker({
    responseId: "response-1", sessionId: "session-1", generation: 4, language: "de",
    onHeard: (text) => changes.push(text),
    onInvalidated: (reason) => invalidations.push(reason),
  });
  tracker.setNativeGeneration(7);
  tracker.setTranscript("Wow, das ist fantastisch! Wirklich toll.");
  tracker.acceptRecognition(event({ audioDurationMs: 1_000, words: event().words.slice(0, 4) }));
  tracker.advancePlayback(990);
  assert.deepEqual(changes, ["Wow, das ist fantastisch!"]);
  tracker.acceptRecognition(event({
    audioDurationMs: 2_000,
    words: [
      { word: "Wider", startMs: 1_120, endMs: 1_420, confidence: 0.94 },
      { word: "toll", startMs: 1_450, endMs: 1_760, confidence: 0.9 },
    ],
  }));
  assert.deepEqual(changes, ["Wow, das ist fantastisch!", null], "a later final ASR mismatch immediately retires the previous mood");
  assert.deepEqual(invalidations, ["transcript-recognition-mismatch"]);
}

{
  const changes = [];
  const tracker = create((text) => changes.push(text));
  tracker.setTranscript("Wow, das ist fantastisch! Wirklich toll.");
  tracker.acceptRecognition(event({ audioDurationMs: 1_000, words: event().words.slice(0, 4) }));
  tracker.advancePlayback(990);
  tracker.acceptRecognition(event({
    endpoint: false,
    audioDurationMs: 1_500,
    words: [{ word: "Wirklich", startMs: 1_120, endMs: 1_300, confidence: 0.1 }],
  }));
  tracker.advancePlayback(1_120);
  assert.deepEqual(
    changes,
    ["Wow, das ist fantastisch!", null],
    "a matching partial next-sentence token clears the previous mood without promoting partial ASR",
  );
}

{
  const changes = [];
  const invalidations = [];
  const tracker = createSpeechExpressionTracker({
    responseId: "response-1", sessionId: "session-1", generation: 4, language: "de",
    onHeard: (text) => changes.push(text),
    onInvalidated: (reason) => invalidations.push(reason),
  });
  tracker.setNativeGeneration(7);
  tracker.setTranscript("Wow, das ist fantastisch!");
  tracker.acceptRecognition(event({ words: [
    ...event().words.slice(0, 3),
    { word: "fantastisch", startMs: 590, endMs: 590, confidence: 0.95 },
  ] }));
  tracker.advancePlayback(2_000);
  assert.deepEqual(changes, []);
  assert.deepEqual(invalidations, ["invalid-recognition-timing"], "a missing final word end cannot leave or create a speech expression");
}

{
  const changes = [];
  const tracker = create((text) => changes.push(text));
  tracker.setTranscript("Wow! Leider ist es kaputt.");
  tracker.acceptRecognition(event({ audioDurationMs: 400,
    words: [{ word: "Wow", startMs: 80, endMs: 260, confidence: 0.98 }] }));
  tracker.advancePlayback(500);
  tracker.acceptRecognition(event({ endpoint: false, audioDurationMs: 1500,
    words: [{ word: "Leiter", startMs: 1120, endMs: 1300, confidence: 0.3 }] }));
  tracker.advancePlayback(1119);
  assert.deepEqual(changes, ["Wow!"], "unheard uncertain continuation cannot preempt the current phrase");
  tracker.advancePlayback(1300);
  assert.deepEqual(changes, ["Wow!", null], "a mismatching partial continuation retires the old smile when it is heard");
  tracker.acceptRecognition(event({ audioDurationMs: 2400, words: [
    { word: "Leider", startMs: 1120, endMs: 1300, confidence: 0.95 },
    { word: "ist", startMs: 1320, endMs: 1450, confidence: 0.95 },
    { word: "es", startMs: 1470, endMs: 1600, confidence: 0.95 },
    { word: "kaputt", startMs: 1650, endMs: 2200, confidence: 0.95 },
  ] }));
  assert.deepEqual(changes, ["Wow!", null], "partial ASR never promotes a replacement expression");
  tracker.advancePlayback(2200);
  assert.deepEqual(changes, ["Wow!", null, "Leider ist es kaputt."], "a final matching heard section can recover from tentative uncertainty");
}
assert.deepEqual(splitBudgetSpeechSections("Der Wert ist 3.14. Das sind 1.000,50 Euro."),
  ["Der Wert ist 3.14.", "Das sind 1.000,50 Euro."], "numeric separators must neither split clips nor acquire extra spaces");
assert.deepEqual(splitBudgetSpeechSections("Use 192.168.0.1. Then continue."),
  ["Use 192.168.0.1.", "Then continue."], "a dotted address remains a single spoken section");
console.log("speech-expression tests passed");
