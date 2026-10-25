import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const api = loadTypeScript("src/openai/web-research.ts", {
  "./openai-api-key": { getOpenAiApiKey: async () => "unused-test-key" },
});

const completedResponse = (output, overrides = {}) => ({
  status: "completed",
  output,
  ...overrides,
});

const citationOutput = (text, url = "https://example.org/facts", options = {}) => [{
  type: "message",
  status: options.messageStatus ?? "completed",
  content: [{
    type: "output_text",
    text,
    annotations: [{
      type: "url_citation",
      url,
      title: "Example facts",
      start_index: options.startIndex ?? 0,
      end_index: options.endIndex ?? Array.from(text).length,
    }],
  }],
}];

const validAnswer = "Paris is in France, according to the cited page.";
const validOutput = citationOutput(validAnswer, "https://example.org/facts", {
  endIndex: Array.from(validAnswer).length,
});

const validQuery = api.validateWebResearchQuery("  What changed this week?  ");
assert.deepEqual(validQuery, { query: "What changed this week?", error: null });
assert.equal(api.validateWebResearchQuery(" ").error, "empty");
assert.equal(api.validateWebResearchQuery("x".repeat(601)).error, "too_long");

const requestBody = api.createWebResearchRequestBody("  Compare current launch dates  ");
assert.equal(requestBody.model, "gpt-6-luna");
assert.equal(requestBody.input, "Compare current launch dates");
assert.equal(requestBody.tool_choice, "required");
assert.deepEqual(requestBody.tools, [{ type: "web_search", search_context_size: "low" }]);
assert.deepEqual(requestBody.include, ["web_search_call.action.sources"]);
assert.equal(requestBody.store, false);
assert.equal(requestBody.max_output_tokens, 900);
assert.equal("memory" in requestBody, false);
assert.throws(() => api.createWebResearchRequestBody("\n"), { name: "WebResearchError" });

const parsed = api.parseWebResearchResponse(completedResponse([
  ...validOutput,
  {
    type: "web_search_call",
    status: "completed",
    action: {
      sources: [
        { url: "https://example.org/facts", title: "Duplicate result" },
        { url: "javascript:alert(1)", title: "Unsafe" },
          { url: "https://user:pass" + String.fromCharCode(64) + "example.net/", title: "Credential URL" },
        { url: "http://example.net/backup", title: "Second source" },
      ],
    },
  },
]));
assert.equal(parsed.answer, validAnswer);
assert.deepEqual(parsed.sources, [
  { title: "Example facts", url: "https://example.org/facts" },
  { title: "Second source", url: "http://example.net/backup" },
]);
assert.deepEqual(parsed.citations, [{
  sourceIndex: 0,
  startIndex: 0,
  endIndex: Array.from(validAnswer).length,
}]);
assert.deepEqual(api.splitWebResearchAnswer(parsed.answer, parsed.citations), [
  { type: "text", text: validAnswer },
  { type: "citation", text: "[1]", sourceIndex: 0 },
]);

// OpenAI describes citation bounds as character indices. This fixture exercises
// an astral Unicode character before the cited text; native JS offsets are UTF-16.
const unicodeAnswer = "👋 Sources support this sentence.";
const unicodeJsStart = unicodeAnswer.indexOf("Sources");
const unicodeJsEnd = unicodeAnswer.indexOf(" sentence") + " sentence".length;
const unicodeStart = Array.from(unicodeAnswer.slice(0, unicodeJsStart)).length;
const unicodeEnd = Array.from(unicodeAnswer.slice(0, unicodeJsEnd)).length;
const unicodeParsed = api.parseWebResearchResponse(completedResponse(citationOutput(
  unicodeAnswer,
  "https://example.org/unicode",
  { startIndex: unicodeStart, endIndex: unicodeEnd },
)));
assert.equal(unicodeParsed.citations[0].startIndex, unicodeJsStart);
assert.equal(unicodeParsed.citations[0].endIndex, unicodeJsEnd);
assert.deepEqual(api.splitWebResearchAnswer(unicodeParsed.answer, unicodeParsed.citations), [
  { type: "text", text: unicodeAnswer.slice(0, unicodeJsEnd) },
  { type: "citation", text: "[1]", sourceIndex: 0 },
  { type: "text", text: unicodeAnswer.slice(unicodeJsEnd) },
]);

const secondBlockText = "Second fact is confirmed.";
const secondBlockJsStart = secondBlockText.indexOf("fact");
const secondBlockJsEnd = secondBlockText.indexOf(" confirmed") + " confirmed".length;
const secondBlock = api.parseWebResearchResponse(completedResponse([
  { type: "message", status: "completed", content: [{ type: "output_text", text: "First." }] },
  ...citationOutput(secondBlockText, "https://example.org/second-block", {
    startIndex: Array.from(secondBlockText.slice(0, secondBlockJsStart)).length,
    endIndex: Array.from(secondBlockText.slice(0, secondBlockJsEnd)).length,
  }),
]));
assert.equal(secondBlock.answer, `First.\n\n${secondBlockText}`);
assert.equal(
  secondBlock.answer.slice(secondBlock.citations[0].startIndex, secondBlock.citations[0].endIndex),
  "fact is confirmed"
);
assert.deepEqual(api.splitWebResearchAnswer(secondBlock.answer, secondBlock.citations), [
  { type: "text", text: "First.\n\nSecond fact is confirmed" },
  { type: "citation", text: "[1]", sourceIndex: 0 },
  { type: "text", text: "." },
]);

// An invalid local end offset must stay invalid even when a later output text
// block makes that number fit within the concatenated answer.
assert.throws(
  () => api.parseWebResearchResponse(completedResponse([
    {
      type: "message",
      status: "completed",
      content: [{
        type: "output_text",
        text: "abc",
        annotations: [{
          type: "url_citation",
          url: "https://example.org/local-bounds",
          title: "Invalid local range",
          start_index: 1,
          end_index: 8,
        }],
      }],
    },
    {
      type: "message",
      status: "completed",
      content: [{ type: "output_text", text: " and later content makes the combined answer long enough" }],
    },
  ])),
  (error) => error.code === "no_citations"
);

assert.throws(
  () => api.parseWebResearchResponse(completedResponse(citationOutput(
    "No safe citations.",
    "https://example.org/",
    { startIndex: 2, endIndex: 999 },
  ))),
  (error) => error.code === "no_citations"
);

for (const responseStatus of ["failed", "incomplete", "in_progress", "cancelled", "queued"]) {
  assert.throws(
    () => api.parseWebResearchResponse(completedResponse(validOutput, { status: responseStatus })),
    (error) => error.code === "response",
    `must not render output with ${responseStatus} response status`
  );
}
assert.throws(
  () => api.parseWebResearchResponse(completedResponse(validOutput, { error: { message: "partial error" } })),
  (error) => error.code === "response",
  "must not render an errored Responses payload"
);
assert.throws(
  () => api.parseWebResearchResponse(completedResponse(citationOutput(validAnswer, undefined, {
    endIndex: Array.from(validAnswer).length,
    messageStatus: "incomplete",
  }))),
  (error) => error.code === "response",
  "must not render an incomplete output message inside a completed response"
);
assert.throws(
  () => api.parseWebResearchResponse(completedResponse([{
    type: "message",
    status: "completed",
    content: [{ type: "refusal", refusal: "I cannot help with that." }],
  }])),
  (error) => error.code === "response",
  "refusal output must not be rendered as a research answer"
);

let requestUrl = null;
let requestInit = null;
let apiKeyReads = 0;
const requestResult = await api.searchWebResearch("current answer?", {
  dependencies: {
    getApiKey: async () => {
      apiKeyReads += 1;
      return "private-test-key";
    },
    fetcher: async (url, init) => {
      requestUrl = url;
      requestInit = init;
      return new Response(JSON.stringify(completedResponse(citationOutput(
        "A current answer from this page.",
        "https://example.org/current",
        { endIndex: Array.from("A current answer from this page.").length },
      ))), { status: 200, headers: { "content-type": "application/json" } });
    },
    timeoutMs: 500,
  },
});
assert.equal(requestUrl, "https://api.openai.com/v1/responses");
assert.equal(requestInit.method, "POST");
assert.equal(requestInit.headers.Authorization, "Bearer private-test-key");
assert.equal(apiKeyReads, 1);
const sentBody = JSON.parse(requestInit.body);
assert.equal(sentBody.model, "gpt-6-luna");
assert.equal(sentBody.input, "current answer?");
assert.deepEqual(requestResult.sources, [{ title: "Example facts", url: "https://example.org/current" }]);

let keylessFetcherCalled = false;
await assert.rejects(
  api.searchWebResearch("question?", {
    dependencies: {
      getApiKey: async () => null,
      fetcher: async () => {
        keylessFetcherCalled = true;
        return new Response("{}", { status: 200 });
      },
      timeoutMs: 500,
    },
  }),
  (error) => error.code === "missing_key"
);
assert.equal(keylessFetcherCalled, false, "no request should leave the device without a BYOK key");

await assert.rejects(
  api.searchWebResearch("question?", {
    dependencies: {
      getApiKey: async () => "test-key",
      fetcher: async () => new Response("{}", { status: 401 }),
      timeoutMs: 500,
    },
  }),
  (error) => error.code === "api" && error.status === 401
);

await assert.rejects(
  api.searchWebResearch("question?", {
    dependencies: {
      getApiKey: async () => "test-key",
      fetcher: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
      timeoutMs: 5,
    },
  }),
  (error) => error.code === "timeout"
);

const timeoutGate = new api.WebResearchRequestGate();
const timeoutToken = timeoutGate.begin();
let resolveLateResponse;
let lateSignal;
const lateResponse = api.searchWebResearch("late answer?", {
  signal: timeoutToken.signal,
  dependencies: {
    getApiKey: async () => "test-key",
    fetcher: async (_url, init) => {
      lateSignal = init.signal;
      return new Promise((resolve) => { resolveLateResponse = resolve; });
    },
    timeoutMs: 5,
  },
});
const lateOutcome = lateResponse.then(() => "success", (error) => error.code);
assert.equal(await lateOutcome, "timeout");
assert.equal(lateSignal.aborted, true, "timeout should abort the fetch signal");
if (timeoutToken.isCurrent()) timeoutGate.finish(timeoutToken.id);
assert.equal(timeoutToken.isCurrent(), false, "timeout completion should invalidate its UI generation");
assert.equal(timeoutGate.isPending, false);
resolveLateResponse(new Response(JSON.stringify(completedResponse(validOutput)), {
  status: 200,
  headers: { "content-type": "application/json" },
}));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(await lateOutcome, "timeout", "a fetcher ignoring abort must not replace a timeout with a late result");
assert.equal(timeoutToken.isCurrent(), false, "late completion must remain stale");

const externalAbort = new AbortController();
const externallyCancelled = api.searchWebResearch("question?", {
  signal: externalAbort.signal,
  dependencies: {
    getApiKey: async () => "test-key",
    fetcher: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
    timeoutMs: 500,
  },
});
externalAbort.abort();
await assert.rejects(externallyCancelled, (error) => error.code === "cancelled");

const gate = new api.WebResearchRequestGate();
const firstRequest = gate.begin();
const secondRequest = gate.begin();
assert.equal(firstRequest.signal.aborted, true);
assert.equal(firstRequest.isCurrent(), false, "a superseded response must be stale");
assert.equal(secondRequest.isCurrent(), true);
gate.finish(secondRequest.id);
assert.equal(gate.isPending, false);
assert.equal(secondRequest.isCurrent(), false, "a finished request must no longer be current");
gate.cancel();
assert.equal(secondRequest.isCurrent(), false, "background/cancel must invalidate a response even if fetch ignores abort");

console.log("Web research request and citation behavior: PASS");
