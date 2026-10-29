import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const pairingToken = "b".repeat(48);
const config = { url: "wss://robot.local:8443/device", token: pairingToken };

class TestSignal {
  aborted = false;
  listeners = new Set();
  addEventListener(type, listener) { if (type === "abort") this.listeners.add(listener); }
  removeEventListener(type, listener) { if (type === "abort") this.listeners.delete(listener); }
  abort() {
    if (this.aborted) return;
    this.aborted = true;
    for (const listener of [...this.listeners]) listener();
  }
}

class TestAbortController {
  signal = new TestSignal();
  abort() { this.signal.abort(); }
}

function loadClient({ fetch, timers = [] }) {
  return loadTypeScript("src/robot-bridge/companion-client.ts", {
    "./runtime": { loadRobotBridgeConfiguration: async () => config },
  }, {
    fetch,
    AbortController: TestAbortController,
    setTimeout(callback, delay) { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { timer.cleared = true; },
  });
}

async function testAuthenticatedRequestUsesHeaderAndScopedPath() {
  const requests = [], timers = [];
  const { requestCompanion } = loadClient({
    timers,
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      return { ok: true, status: 200, text: async () => JSON.stringify({ apps: [] }) };
    },
  });
  const result = await requestCompanion("/api/apps?query=conversation", { method: "GET" });
  assert.deepEqual(result, { apps: [] });
  assert.equal(requests[0].url, "https://robot.local:8443/api/apps?query=conversation");
  assert.equal(requests[0].options.headers.Authorization, `Bearer ${pairingToken}`);
  assert.equal(requests[0].options.headers.Accept, "application/json");
  assert.equal(requests[0].options.headers["Content-Type"], undefined);
  assert.equal(requests[0].url.includes(pairingToken), false, "pairing credentials never appear in a URL");
  assert.equal(new URL(requests[0].url).username, "");
  assert.equal(new URL(requests[0].url).password, "");
  assert.equal(timers[0].delay, 15_000);
  assert.equal(timers[0].cleared, true, "the request timeout is cleared after a response");

  const post = loadClient({
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      return { ok: true, status: 200, text: async () => "{}" };
    },
  });
  await post.requestCompanion("/api/bridge/apps/app-1/start", { method: "POST", body: { confirmed: true } });
  assert.equal(requests[1].options.headers["Content-Type"], "application/json");
  assert.equal(requests[1].options.body, JSON.stringify({ confirmed: true }));
}

async function testPathValidationRejectsOutsideAndEncodedTraversalPaths() {
  let fetchCount = 0;
  const { requestCompanion } = loadClient({ fetch: async () => { fetchCount += 1; return { ok: true, status: 200, text: async () => "{}" }; } });
  for (const path of [
    "https://evil.invalid/api/apps",
    "//evil.invalid/api/apps",
    "/api/device",
    "/api/apps/../../device",
    "/api/apps\\..\\bridge/status",
    "/api/apps#fragment",
    "/api/apps/%2e%2e/device",
  ]) {
    await assert.rejects(requestCompanion(path), /Invalid companion API path/, path);
  }
  assert.equal(fetchCount, 0, "invalid paths never reach fetch");
}

async function testTimeoutAndCallerAbortCancelFetchAndCleanListeners() {
  const timers = [];
  let internalSignal;
  const { requestCompanion } = loadClient({
    timers,
    fetch: (_url, options) => {
      internalSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    },
  });

  const timeoutRequest = requestCompanion("/api/apps");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(timers[0].delay, 15_000);
  timers[0].callback();
  await assert.rejects(timeoutRequest, /aborted/);
  assert.equal(internalSignal.aborted, true, "the request timeout aborts the fetch signal");
  assert.equal(timers[0].cleared, true, "the timer is cleaned after timeout");

  const caller = new TestAbortController();
  const pending = requestCompanion("/api/bridge/apps", { signal: caller.signal });
  await Promise.resolve();
  await Promise.resolve();
  caller.abort();
  await assert.rejects(pending, /aborted/);
  assert.equal(internalSignal.aborted, true, "caller cancellation propagates to fetch");
  assert.equal(caller.signal.listeners.size, 0, "the caller abort listener is removed in finally");
  assert.equal(timers[1].cleared, true, "the caller-aborted request also clears its timeout");
}

await testAuthenticatedRequestUsesHeaderAndScopedPath();
await testTimeoutAndCallerAbortCancelFetchAndCleanListeners();
await testPathValidationRejectsOutsideAndEncodedTraversalPaths();
console.log("robot bridge companion client: authenticated requests, path validation and abort cleanup passed");
