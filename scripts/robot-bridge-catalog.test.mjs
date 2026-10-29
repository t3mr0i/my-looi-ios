import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAppCatalog } from "../services/robot-bridge/app-catalog.mjs";
import { createAppRunner } from "../services/robot-bridge/app-runner.mjs";

const REVISION = "a".repeat(40);
const fixtures = {
  "reachy_mini_python_app": [{
    id: "pollen-robotics/demo-python-app", sha: REVISION, subdomain: "pollen-robotics-demo-python-app", author: "pollen-robotics", sdk: "gradio", tags: ["reachy_mini_python_app"], private: false, likes: 4,
    cardData: { title: "Demo Python app", short_description: "A Python app fixture." },
  }],
  "reachy_mini_js_app": [{
    id: "pollen-robotics/demo-js-app", sha: "b".repeat(40), subdomain: "pollen-robotics-demo-js-app", host: "https://pollen-robotics-demo-js-app.static.hf.space", author: "pollen-robotics", sdk: "static", tags: ["reachy_mini_js_app"], private: false,
  }, {
    id: "pollen-robotics/sdk-js-demo-app", sha: "e".repeat(40), subdomain: "pollen-robotics-sdk-js-demo-app", author: "pollen-robotics", sdk: "static", tags: ["reachy_mini_js_app"], private: false,
    cardData: { title: "Demo JS app", short_description: "A static app fixture.", hf_oauth: true },
  }],
  microduck: [{
    id: "pollen-robotics/vision-demo", sha: "c".repeat(40), subdomain: "not.a.valid.host", author: "pollen-robotics", sdk: "docker", tags: ["microduck", "vision-demo"], private: false,
    cardData: { title: "MicroDuck vision demo", short_description: "Metadata-only fixture." },
  }],
};

const seen = [];
const catalog = createAppCatalog({
  timeoutMs: 1_000,
  cacheMs: 60_000,
  fetchImpl: async (url) => {
    seen.push(new URL(url));
    const tag = new URL(url).searchParams.get("filter");
    const body = tag ? fixtures[tag] ?? [] : null;
    if (!body) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  },
});

const listing = await catalog.list();
assert.equal(listing.source, "huggingface-spaces");
assert.equal(listing.items.length, 4);
assert.equal(listing.items.find((item) => item.spaceId === "pollen-robotics/demo-python-app").kind, "python");
assert.equal(listing.items.find((item) => item.spaceId === "pollen-robotics/demo-python-app").launch.revision, REVISION);
const jsApp = listing.items.find((item) => item.spaceId === "pollen-robotics/demo-js-app");
assert.equal(jsApp.launch.mode, "hosted");
assert.equal(jsApp.launch.handoff, "reachy-hosted-shell");
assert.equal(jsApp.launch.appHost, "pollen-robotics-demo-js-app.static.hf.space");
assert.equal(jsApp.launch.url, "https://pollen-robotics-demo-js-app.static.hf.space/");
assert.equal(jsApp.launch.hubUrl, "https://huggingface.co/spaces/pollen-robotics/demo-js-app");
assert.match(jsApp.compatibility.requirements.join(" "), /official host shell/);
assert.ok(jsApp.compatibility.limitations.some((reason) => /Central connection/.test(reason)));
const officialJsDemo = listing.items.find((item) => item.spaceId === "pollen-robotics/sdk-js-demo-app");
assert.equal(officialJsDemo.launch.appHost, "pollen-robotics-sdk-js-demo-app.static.hf.space");
assert.equal(officialJsDemo.launch.url, "https://pollen-robotics-sdk-js-demo-app.static.hf.space/");
assert.equal(listing.items.find((item) => item.spaceId === "pollen-robotics/vision-demo").family, "microduck");
const microduckApp = listing.items.find((item) => item.spaceId === "pollen-robotics/vision-demo");
assert.equal(microduckApp.compatibility.level, "partial");
assert.equal(microduckApp.launch.appHost, null);
assert.equal(microduckApp.launch.url, microduckApp.launch.hubUrl);
assert.ok(seen.every((url) => url.origin === "https://huggingface.co" && url.pathname === "/api/spaces"));
assert.ok(seen.every((url) => url.searchParams.getAll("expand").includes("sha") && url.searchParams.getAll("expand").includes("subdomain")));
assert.equal(seen.length, 3);
const cached = await catalog.list({ query: "vision", robotFamily: "microduck" });
assert.equal(cached.items.length, 1);
assert.equal(seen.length, 3);
assert.equal((await catalog.resolve("pollen-robotics/demo-python-app", { revision: REVISION })).revision, REVISION);
await assert.rejects(catalog.resolve("pollen-robotics/demo-python-app", { revision: "f".repeat(40) }), /not the current catalog revision/);
await assert.rejects(catalog.resolve("pollen-robotics/vision-demo"), /Only public Reachy Python/);
await assert.rejects(catalog.resolve("attacker.example/repo"), /HTTP 404/);

const detailRequests = [];
const revisionFallback = createAppCatalog({
  fetchImpl: async (urlValue) => {
    const url = new URL(urlValue);
    detailRequests.push(url);
    if (url.pathname === "/api/spaces/pollen-robotics/revision-app") {
      return new Response(JSON.stringify({
        id: "pollen-robotics/revision-app", sha: "d".repeat(40), subdomain: "pollen-robotics-revision-app",
        author: "pollen-robotics", sdk: "gradio", tags: ["reachy_mini_python_app"], private: false,
        cardData: { title: "Revision fallback" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const tag = url.searchParams.get("filter");
    const body = tag === "reachy_mini_python_app" ? [{
      id: "pollen-robotics/revision-app", author: "pollen-robotics", sdk: "gradio",
      tags: ["reachy_mini_python_app"], private: false,
    }] : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  },
});
const resolvedMissingSha = await revisionFallback.resolve("pollen-robotics/revision-app");
assert.equal(resolvedMissingSha.revision, "d".repeat(40));
assert.ok(detailRequests.some((url) => url.pathname === "/api/spaces/pollen-robotics/revision-app"
  && url.searchParams.getAll("expand").includes("sha")));

class FakeChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
  }
  kill(signal) {
    this.killedWith = signal;
    if (this.exitCode === null) {
      this.exitCode = 0;
      queueMicrotask(() => { this.emit("close", 0, signal); this.stdout.end(); this.stderr.end(); });
    }
    return true;
  }
}

const rootDir = await mkdtemp(path.join(os.tmpdir(), "looi-app-runner-"));
const commands = [];
let nextPid = 900_000;
let startedChild = null;
const runner = createAppRunner({
  rootDir,
  catalog,
  pythonExecutable: "python3",
  mediaBackend: "webrtc",
  stopGraceMs: 100,
  getRuntimeEnv: () => ({ LOOI_ROBOT_BRIDGE_URL: "ws://127.0.0.1:8443/device" }),
  killProcessGroup: (child, signal) => child.kill(signal),
  spawnImpl: (command, args, options) => {
    commands.push({ command, args, options });
    const child = new FakeChild(nextPid++);
    const isVenv = args[0] === "-m" && args[1] === "venv";
    const isAppLaunch = args[0] === "-I";
    if (isVenv) {
      const venv = args[2];
      const site = path.join(venv, "lib", "python3.12", "site-packages", "demo_pkg-1.0.dist-info");
      void mkdir(site, { recursive: true }).then(() => writeFile(path.join(site, "entry_points.txt"), "[some_other_group]\nignore = ignore\n[reachy_mini_apps]\ndemo-python-app = demo_pkg.main:DemoApp\n")).then(() => {
        child.exitCode = 0; child.emit("spawn"); child.emit("close", 0, null); child.stdout.end(); child.stderr.end();
      });
    }
    if (isAppLaunch) startedChild = child;
    if (!isVenv && !isAppLaunch) queueMicrotask(() => { child.exitCode = 0; child.emit("spawn"); child.emit("close", 0, null); child.stdout.end("fixture output\n"); child.stderr.end(); });
    else if (isAppLaunch) queueMicrotask(() => { child.emit("spawn"); child.stdout.write("app ready\n"); });
    return child;
  },
});
try {
  await runner.ready;
  await assert.rejects(runner.install("https://attacker.example/repo"), /owner\/name/);
  await assert.rejects(runner.install("pollen-robotics/unlisted"), /HTTP 404/);
  assert.equal(commands.length, 0);
  const queued = await runner.install("pollen-robotics/demo-python-app", { revision: REVISION });
  assert.equal(queued.state, "running");
  let job;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    job = runner.getJob(queued.id);
    if (job?.state !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(job.state, "complete", job.error);
  assert.ok(job.logs.includes("fixture output"));
  assert.equal(runner.listInstalled().length, 1);
  assert.ok(commands.every((entry) => entry.options.shell === false));
  const installCommand = commands.find((entry) => entry.args.includes("install"));
  assert.ok(installCommand.args.at(-1).endsWith(`@${REVISION}`));
  assert.ok(installCommand.args.at(-1).startsWith("git+https://huggingface.co/spaces/"));

  const started = await runner.start("pollen-robotics/demo-python-app");
  assert.equal(started.state, "starting");
  await assert.rejects(runner.start("pollen-robotics/demo-python-app"), /Only one companion app/);
  const launch = commands.at(-1);
  assert.equal(launch.args[0], "-I");
  assert.equal(launch.args.at(-2), "demo_pkg.main");
  assert.equal(launch.args.at(-1), "webrtc");
  assert.match(launch.args[3], /ReachyMiniApp\.request_media_backend = requested_backend/);
  assert.equal(launch.options.env.LOOI_ROBOT_BRIDGE_URL, "ws://127.0.0.1:8443/device");
  await runner.stop();
  assert.equal(runner.status().running.state, "stopped");

  const registry = JSON.parse(await readFile(path.join(rootDir, "installed.json"), "utf8"));
  assert.equal(registry.apps[0].revision, REVISION);
  assert.ok(startedChild.killedWith);
} finally {
  await rm(rootDir, { recursive: true, force: true });
}

console.log("robot bridge catalog and app runner tests passed");
