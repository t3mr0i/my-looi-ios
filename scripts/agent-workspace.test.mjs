import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";
import { deferred } from "./helpers/load-typescript.mjs";

const load = createTypeScriptTreeLoader();
const protocol = load("src/agent/agent-protocol.ts");
const { parseAgentSetupCode } = load("src/agent/agent-setup-code.ts");
const { parseAgentCapabilities } = load("src/agent/agent-capabilities.ts");
const examples = load("src/agent/agent-examples.ts");
const { agentWorkspaceText } = load("src/i18n/agent-workspace-strings.ts");
const { looiTheme } = load("src/ui/looi-theme.ts");
const connection = { url: "https://agent.example.org", token: "a".repeat(64) };
const code = (value) =>
  "LOOI1." + Buffer.from(JSON.stringify(value)).toString("base64url");
const validCode = code(connection);
assert.deepEqual(parseAgentSetupCode(` ${validCode}\n`), connection);
// The actual operator helper and the app must agree on one credential envelope.
const pythonCode = execFileSync(
  "python3",
  [
    "-c",
    "from services.hermes.create_connection_code import create_code; print(create_code('https://agent.example.org', 'a' * 64))",
  ],
  { encoding: "utf8" },
).trim();
assert.deepEqual(parseAgentSetupCode(pythonCode), connection);
for (const invalid of [
  "",
  "LOOI2.x",
  "https://agent.example.org?token=secret",
  "LOOI1.a",
  "LOOI1." + "a".repeat(5000),
  validCode + "=",
  code({ ...connection, instructions: "send all mail" }),
  code({ ...connection, url: "http://agent.example.org" }),
  code({ ...connection, token: "short" }),
  code({ ...connection, url: "https://agent.example.org/path" }),
]) {
  assert.throws(() => parseAgentSetupCode(invalid), {
    code: "invalid_connection",
  });
}
const baseManifest = {
  protocol: 1,
  service: "looi-hermes",
  capabilities: ["tasks", "cancel", "delete"],
};
assert.equal(parseAgentCapabilities(baseManifest).publicResearch, true);
const unknownManifest = {
  ...baseManifest,
  features: [
    { id: "gmail.send", revision: 1, availability: "available" },
    { id: "public-research", revision: 2, availability: "available" },
  ],
};
assert.deepEqual(parseAgentCapabilities(unknownManifest), {
  protocol: 1,
  service: "looi-hermes",
  publicResearch: false,
  personalAccounts: false,
  externalActions: false,
});
assert.throws(() => parseAgentCapabilities({ ...baseManifest, protocol: 2 }), {
  code: "response",
});
assert.throws(
  () => parseAgentCapabilities({ ...baseManifest, features: "all" }),
  { code: "response" },
);

let state = examples.createAgentExample("appointment");
assert.equal(
  examples.reduceAgentExample(state, { type: "approve" }),
  state,
  "approval cannot skip review",
);
state = examples.reduceAgentExample(state, { type: "run" });
state = examples.reduceAgentExample(state, { type: "review" });
state = examples.reduceAgentExample(state, { type: "simulate-uncertain" });
assert.equal(
  examples.reduceAgentExample(state, { type: "approve" }),
  state,
  "unknown outcomes cannot be retried as approvals",
);
state = examples.reduceAgentExample(state, { type: "choose", example: "mail" });
state = examples.reduceAgentExample(state, { type: "run" });
state = examples.reduceAgentExample(state, {
  type: "open-mail",
  id: "workshop",
});
state = examples.reduceAgentExample(state, {
  type: "edit-draft",
  text: "private draft",
});
assert.equal(
  examples.reduceAgentExample(state, { type: "choose", example: "day" }).draft,
  "",
);

// Mount the actual native component against a strict dependency allowlist. Any
// accidental service, voice, diagnostic or storage import fails this test.
const jsx = (type, props) => ({ type, props: props ?? {} });
function mount(name, extra = {}, language = "de") {
  let slots = [],
    index = 0,
    pending = [],
    dirty = false,
    tree,
    mounted = true;
  let listener = null;
  const depsEqual = (a, b) =>
    a &&
    b &&
    a.length === b.length &&
    a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) {
      const slot = index++;
      if (!slots[slot])
        slots[slot] = {
          value: typeof initial === "function" ? initial() : initial,
        };
      return [
        slots[slot].value,
        (next) => {
          if (mounted) {
            slots[slot].value =
              typeof next === "function" ? next(slots[slot].value) : next;
            dirty = true;
          }
        },
      ];
    },
    useReducer(reducer, initial, init) {
      const [value, setValue] = react.useState(() =>
        init ? init(initial) : initial,
      );
      return [
        value,
        (event) => setValue((previous) => reducer(previous, event)),
      ];
    },
    useRef(initial) {
      return react.useState(() => ({ current: initial }))[0];
    },
    useEffect(effect, deps) {
      const slot = index++;
      if (!slots[slot] || !depsEqual(deps, slots[slot].deps)) {
        pending.push(() => {
          slots[slot]?.cleanup?.();
          slots[slot] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const dependencies = {
    "./InterfacePressable": { InterfacePressable: "Pressable" },
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "react-native": {
      ActivityIndicator: "ActivityIndicator",
      AppState: {
        currentState: "active",
        addEventListener(_event, callback) {
          listener = callback;
          return {
            remove() {
              listener = null;
            },
          };
        },
      },
      Pressable: "Pressable",
      Text: "Text",
      TextInput: "TextInput",
      View: "View",
      StyleSheet: { create: (value) => value },
    },
    "../agent/agent-examples": examples,
    "../i18n/nous-strings": load("src/i18n/nous-strings.ts"),
    "../agent/agent-protocol": protocol,
    "../agent/agent-setup-code": { parseAgentSetupCode },
    "../i18n/agent-workspace-strings": { agentWorkspaceText },
    "./looi-theme": { looiTheme },
  };
  const output = ts.transpileModule(
    fs.readFileSync("src/ui/AgentWorkspace.tsx", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)(
    (request) => {
      assert.ok(request in dependencies, `Unexpected dependency: ${request}`);
      return dependencies[request];
    },
    module,
    module.exports,
  );
  if (name === "NousConnectionsPanel") {
    dependencies["./AgentWorkspace"] = module.exports;
    const compiled = ts.transpileModule(fs.readFileSync("src/ui/NousConnectionsPanel.tsx", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    new Function("require", "module", "exports", compiled)((request) => {
      assert.ok(request in dependencies, `Unexpected dependency: ${request}`);
      return dependencies[request];
    }, module, module.exports);
  }
  const props = { language, onBack() {}, onTry() {}, onDone() {}, ...extra };
  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") return expand(node.type(node.props));
    return {
      ...node,
      props: { ...node.props, children: expand(node.props.children) },
    };
  };
  function flush() {
    let passes = 0;
    do {
      assert.ok(++passes < 10);
      dirty = false;
      index = 0;
      pending = [];
      tree = expand(module.exports[name](props));
      for (const effect of pending) effect();
    } while (dirty);
    return tree;
  }
  const nodes = (node) =>
    !node
      ? []
      : Array.isArray(node)
        ? node.flatMap((item) => nodes(item))
        : typeof node === "object"
          ? [node, ...nodes(node.props.children)]
          : [];
  const text = (node) =>
    !node
      ? ""
      : Array.isArray(node)
        ? node.map(text).join(" ")
        : typeof node === "object"
          ? text(node.props.children)
          : String(node);
  const find = (predicate) => {
    const node = nodes(tree).find(predicate);
    assert.ok(node, "visible control must exist");
    return node;
  };
  flush();
  return {
    flush,
    text: () => text(tree),
    input(label, value) {
      find(
        (node) =>
          node.type === "TextInput" && node.props.accessibilityLabel === label,
      ).props.onChangeText(value);
      flush();
    },
    press(label) {
      const node = find(
        (item) =>
          item.type === "Pressable" &&
          (text(item) === label || item.props.accessibilityLabel === label),
      );
      assert.ok(!node.props.disabled);
      node.props.onPress();
      flush();
    },
    background() {
      listener?.("background");
      flush();
    },
    unmount() {
      mounted = false;
      for (const slot of slots) slot?.cleanup?.();
    },
    inputs() {
      return nodes(tree)
        .filter((node) => node.type === "TextInput")
        .map((node) => node.props.value);
    },
  };
}

for (const language of ["en", "de", "uk", "ru"]) {
  const t = agentWorkspaceText(language);
  const playground = mount("AgentPlayground", {}, language);
  assert.ok(playground.text().includes(t("exampleNotice")));
  playground.press(t("mail"));
  playground.press(t("runMail"));
  playground.press(t("subjectOne"));
  assert.ok(playground.text().includes("mira@example.invalid"));
  assert.ok(playground.text().includes(t("bodyOne")));
  playground.press(t("prepareReply"));
  assert.ok(playground.inputs().includes(t("replyText")));
  playground.input(t("draftTitle"), "local only");
  playground.background();
  assert.ok(!playground.inputs().includes("local only"));
  playground.press(t("appointment"));
  playground.press(t("runAppointment"));
  playground.press(t("review"));
  playground.press(t("approve"));
  assert.ok(playground.text().includes(t("approved")));
  playground.unmount();
}

let calls = 0;
const gate = deferred();
let signal;
const setup = mount("AgentConnectionSetup", {
  async connect(value, inputSignal) {
    calls += 1;
    signal = inputSignal;
    assert.deepEqual(value, connection);
    await gate.promise;
  },
});
setup.input("Verbindungscode", "https://bad.example?token=secret");
setup.press("Weiter");
assert.ok(setup.text().includes("Dieser Code stimmt nicht"));
assert.equal(calls, 0);
setup.input("Verbindungscode", validCode);
setup.press("Weiter");
assert.ok(setup.text().includes(connection.url));
assert.ok(!setup.text().includes(connection.token));
assert.deepEqual(setup.inputs(), []);
assert.equal(calls, 0, "paste and review never contact the server");
setup.press("Mit diesem Server verbinden");
assert.equal(calls, 1);
setup.background();
assert.equal(signal.aborted, true);
gate.resolve();
await gate.promise;
await new Promise((resolve) => setImmediate(resolve));
setup.flush();
assert.ok(
  !setup.text().includes("Hermes ist verbunden"),
  "late success must not resurrect paused setup",
);
assert.ok(setup.inputs().every((value) => value === ""));
setup.unmount();

// Cancellation between verification and persistence must preserve the old connection.
const { createAgentService } = load("src/agent/agent-service-core.ts");
const cancelled = new AbortController();
let writes = 0;
const service = createAgentService(
  {
    readConnection: async () => connection,
    writeConnection: async () => {
      writes += 1;
    },
  },
  { verify: async () => cancelled.abort() },
);
await assert.rejects(
  service.configureAgentConnection(connection.url, connection.token, {
    signal: cancelled.signal,
  }),
  { code: "cancelled" },
);
assert.equal(writes, 0);
console.log(
  "Agent workspace: private setup review, aborts, compatibility and four-language offline workflows passed",
);

const nous = load("src/agent/agent-nous.ts");
const ready = { status: "ready", subject: "owner:org", label: "Example Nous owner", providers: ["gmail"], accounts: [] };
assert.deepEqual(nous.parseNousSnapshot(ready), ready);
assert.throws(() => nous.parseNousSnapshot({ ...ready, providers: ["unknown-mail"] }), { code: "response" });
assert.throws(() => nous.parseNousConnectLink({ provider: "gmail", subject: "other-owner", url: "https://portal.nousresearch.com/connect" }, "gmail", ready.subject), { code: "response" });
const tick = () => new Promise((resolve) => setImmediate(resolve));
let nousReads = 0, nousStarts = 0, browserOpens = 0;
const nousPanel = mount("NousConnectionsPanel", {
  async read() { nousReads += 1; return ready; },
  async start(provider, subject) { nousStarts += 1; assert.equal(subject, ready.subject); return { provider, subject, url: "https://portal.nousresearch.com/example-authorization" }; },
  async open() { browserOpens += 1; },
});
assert.equal(nousReads, 0, "Nous metadata is fetched only after a deliberate check");
nousPanel.press("Verbindungsstatus prüfen"); await tick(); nousPanel.flush();
assert.equal(nousReads, 1);
assert.ok(nousPanel.text().includes("Nous bietet diese Verbindung für dieses Konto gerade nicht an."));
assert.throws(() => nousPanel.press("Google Mail: Konto verbinden"), "confirm the account owner before linking private data");
nousPanel.press("Das ist mein Nous-Konto");
nousPanel.press("Google Mail: Konto verbinden"); await tick(); nousPanel.flush();
assert.equal(nousStarts, 1);
assert.equal(browserOpens, 0, "a returned link is reviewed before opening a browser");
assert.ok(!nousPanel.text().includes("Über Nous verbunden"), "a link is not a connected account");
nousPanel.press("Anmeldung öffnen"); await tick(); nousPanel.flush();
assert.equal(browserOpens, 1);
nousPanel.background();
assert.ok(!nousPanel.text().includes(ready.label), "private account labels clear when backgrounded");
nousPanel.unmount();
console.log("Nous setup: explicit metadata read, account identity, catalog gate and browser confirmation passed");
