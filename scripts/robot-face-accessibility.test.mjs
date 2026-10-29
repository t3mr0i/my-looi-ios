import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";
const loadCharacterModule = createTypeScriptTreeLoader();
import assert from "node:assert/strict";
import ts from "typescript";
import { deferred, loadTypeScript } from "./helpers/load-typescript.mjs";

const jsx = (type, props) => ({ type, props: props ?? {}, children: props?.children });
const jsxRuntime = { jsx, jsxs: jsx, Fragment: Symbol("Fragment") };

function createRenderer(accessibility, appState) {
  let slots = [];
  let hookIndex = 0;
  let pendingEffects = [];
  let mounted = true;
  let dirty = false;
  let renders = 0;
  let postUnmountStateUpdates = 0;
  let tree = null;
  let renderedComponents = [];

  const depsEqual = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const react = {
    useState(initial) {
      const slot = hookIndex++;
      if (!slots[slot]) slots[slot] = { value: typeof initial === "function" ? initial() : initial };
      const setter = (next) => {
        if (!mounted) { postUnmountStateUpdates += 1; return; }
        const value = typeof next === "function" ? next(slots[slot].value) : next;
        if (!Object.is(value, slots[slot].value)) { slots[slot].value = value; dirty = true; }
      };
      return [slots[slot].value, setter];
    },
    useRef(initial) {
      const slot = hookIndex++;
      if (!slots[slot]) slots[slot] = { value: { current: initial } };
      return slots[slot].value;
    },
    useMemo(factory, deps) {
      const slot = hookIndex++;
      if (!slots[slot] || !depsEqual(slots[slot].deps, deps)) slots[slot] = { deps, value: factory() };
      return slots[slot].value;
    },
    useId() { return react.useRef(`id-${hookIndex}`).current; },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(effect, deps) {
      const slot = hookIndex++;
      const previous = slots[slot];
      if (!previous || !depsEqual(previous.deps, deps)) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          if (!mounted) return;
          const cleanup = effect();
          slots[slot] = { deps, cleanup };
        });
      }
    },
  };

  const flush = () => {
    let passes = 0;
    do {
      assert.ok(++passes < 30, "component effects should settle without an infinite render loop");
      dirty = false;
      pendingEffects = [];
      hookIndex = 0;
      renderedComponents = [];
      const expand = (node) => {
        if (Array.isArray(node)) return node.map(expand);
        if (!node || typeof node !== "object") return node;
        if (typeof node.type === "function") {
          renderedComponents.push({ name: node.type.name, props: node.props });
          return expand(node.type(node.props));
        }
        const props = node.props ?? {};
        if (props.children !== undefined) return { ...node, props: { ...props, children: expand(props.children) } };
        return node;
      };
      tree = expand(component({}));
      renders += 1;
      const effects = pendingEffects;
      pendingEffects = [];
      for (const run of effects) run();
    } while (dirty);
    return tree;
  };
  const unmount = () => {
    mounted = false;
    for (const slot of slots) slot?.cleanup?.();
  };
  let component = null;
  return {
    hooks: react,
    mount(value) { component = value; return flush(); },
    flush, unmount,
    get tree() { return tree; }, get renders() { return renders; },
    get components() { return renderedComponents; },
    get postUnmountStateUpdates() { return postUnmountStateUpdates; },
  };
}

const glassSource = ts.transpileModule(await (await import("node:fs/promises")).readFile("src/ui/GlassFace.tsx", "utf8"), {
  fileName: "src/ui/GlassFace.tsx",
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

const faceSource = ts.transpileModule(await (await import("node:fs/promises")).readFile("src/ui/RobotFace.tsx", "utf8"), {
  fileName: "src/ui/RobotFace.tsx",
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function loadFace(accessibility, appState, overrides = {}) {
  const user = { voiceState: "attention", robotSleeping: false, preferences: { faceStyle: "classic", facePalette: "cyan", conversationMode: "realtime" }, ...overrides.user };
  const conversation = { streamingText: "", heardSpeechText: null, realtimeReadiness: "ready", isUserSpeaking: false, isSpeaking: false,
    inputAttention: null, activeSessionId: "test", clearInputAttention(expectedId) {
      if (!expectedId || this.inputAttention?.id === expectedId) this.inputAttention = null;
    }, ...overrides.conversation };
  const behavior = { presentation: null, state: { companion: { scene: { status: "idle" } } }, ...overrides.behavior };
  const reaction = { mood: null, reactionId: 0, ...overrides.reaction };
  const action = { active: null, ...overrides.action };
  const objectAttention = { status: "idle", gaze: null, activityAttention: null, ...overrides.objectAttention };
  const gazeSelections = [];
  const animationSequences = [];
  const animationTimings = [];
  const { chooseObjectAttentionGaze } = loadTypeScript("src/core/object-attention-gaze.ts");
  const noStore = (state) => Object.assign((selector) => selector(state), { getState: () => state });
  let react;
  const renderer = createRenderer(accessibility, appState);
  react = renderer.hooks;
  const store = { exports: {} };
  const deps = {
    react: {}, "react/jsx-runtime": jsxRuntime,
    "expo-router": { useFocusEffect: (callback) => react.useEffect(callback, [callback]) },
    "react-native": { AccessibilityInfo: accessibility, AppState: appState, Pressable: "Pressable", StyleSheet: { create: (value) => value, hairlineWidth: 1 }, Text: "Text", View: "View", useWindowDimensions: () => ({ width: 390, height: 844 }) },
    "react-native-reanimated": Object.assign({
      cancelAnimation() {}, Easing: { out: (value) => value, cubic: "cubic", linear: "linear" }, interpolate: (value) => value,
      useAnimatedStyle: (factory) => factory(), useAnimatedProps: (factory) => factory(), useSharedValue: (value) => react.useRef({ value }).current, useReducedMotion: () => false,
      useDerivedValue: (factory) => { const current = react.useRef(factory); current.current = factory; return react.useMemo(() => ({ get value() { return current.current(); } }), []); },
      withRepeat: (value) => value, withSequence: (...values) => { animationSequences.push(values); return values.at(-1); }, withTiming: (value, options) => { animationTimings.push({ value, options }); return value; },
    }, { __esModule: true, default: { View: "AnimatedView", createAnimatedComponent: component => component } }),
    "react-native-svg": Object.assign({ __esModule: true, default: "Svg" }, Object.fromEntries(["ClipPath", "Defs", "Ellipse", "FeGaussianBlur", "Filter", "G", "LinearGradient", "Path", "RadialGradient", "Stop"].map(name => [name, `Svg${name}`]))),
    "@/src/character/glass-face": loadTypeScript("src/character/glass-face.ts"),
    "@/src/store/user": { isManagedConversationMode: () => false, useUserStore: noStore(user) },
    "@/src/store/conversation": { useConversationStore: noStore(conversation) },
    "@/src/voice/input-attention": loadTypeScript("src/voice/input-attention.ts"),
    "@/src/ui/looi-theme": { looiTheme: {} },
    "@/src/i18n/use-ui-text": { useUiText: () => ({ t: (key) => key }) },
    "@/src/character/character-reaction": {
      useCharacterReactionStore: noStore(reaction),
      clearCharacterReaction() { reaction.mood = null; },
    },
    "@/src/diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
    "@/src/core/social-attention": { useSocialAttentionStore: noStore({ active: false, faceVisible: false, gazeX: 0, gazeY: 0 }) },
    "@/src/character/character-action-runtime": { useCharacterActionStore: noStore(action), cancelCharacterAction() { action.active = null; } },
    "@/src/character/character-scene-catalog": loadCharacterModule("src/character/character-scene-catalog.ts"),
    "@/src/character/character-action": loadCharacterModule("src/character/character-action.ts"),
    "@/src/character/character-choreography": loadCharacterModule("src/character/character-choreography.ts"),
    "@/src/ui/CharacterProp": { CharacterProp: (props) => jsx("CharacterProp", props) },
    "@/src/behavior/behavior-runtime": { useBehaviorStore: noStore(behavior) },
    "@/src/core/object-attention": { useObjectAttentionStore: noStore(objectAttention) },
    "@/src/core/object-attention-gaze": { chooseObjectAttentionGaze(input) {
      const result = chooseObjectAttentionGaze(input);
      gazeSelections.push({ input, result });
      return result;
    } },
    "@/src/character/face-expression": loadCharacterModule("src/character/face-expression.ts"),
    "@/src/character/face-motion": loadTypeScript("src/character/face-motion.ts"),
    "@/src/character/face-stroke": loadTypeScript("src/character/face-stroke.ts"),
  };
  deps.react = react;
  const glassModule = { exports: {} };
  new Function("require", "module", "exports", glassSource)((name) => {
    assert.ok(name in deps, `Unexpected GlassFace dependency ${name}`);
    return deps[name];
  }, glassModule, glassModule.exports);
  deps["@/src/ui/GlassFace"] = glassModule.exports;
  const module = { exports: {} };
  new Function("require", "module", "exports", faceSource)((name) => {
    assert.ok(name in deps, `Unexpected RobotFace dependency ${name}`);
    return deps[name];
  }, module, module.exports);
  renderer.mount((props) => module.exports.RobotFace({ ...props, ...overrides.props }));
  renderer.states = { user, conversation, behavior, reaction, action, objectAttention };
  renderer.gazeSelections = gazeSelections;
  renderer.animationSequences = animationSequences;
  renderer.animationTimings = animationTimings;
  return renderer;
}

function makeAccessibility() {
  const query = deferred();
  const listeners = new Set();
  const accessibility = {
    isReduceMotionEnabled: () => query.promise,
    addEventListener(_event, listener) {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
  return {
    accessibility, query, listeners,
    emit(value) { for (const listener of [...listeners]) listener(value); },
    snapshotListeners() { return [...listeners]; },
  };
}

function makeAppState() {
  const listeners = new Set();
  return {
    currentState: "active",
    addEventListener(_event, listener) { listeners.add(listener); return { remove: () => listeners.delete(listener) }; },
    emit(state) { this.currentState = state; for (const listener of listeners) listener(state); },
  };
}

function faceMotionActive(renderer) { return renderer.components.find(({ name }) => name === "ExpressiveMouth")?.props.motionActive ?? null; }

// The real RobotFace effect starts an OS query and subscribes to events. A
// newer accessibility event must retain authority when that older query wins
// the promise race in the opposite order.
{
  const controlled = makeAccessibility();
  const appState = makeAppState();
  const renderer = loadFace(controlled.accessibility, appState);
  assert.equal(faceMotionActive(renderer), true, "Reduce Motion starts from the mocked hook value");

  controlled.emit(true);
  renderer.flush();
  assert.equal(faceMotionActive(renderer), false, "new Reduce Motion event disables actual face motion");
  controlled.query.resolve(false);
  await controlled.query.promise;
  await Promise.resolve();
  renderer.flush();
  assert.equal(faceMotionActive(renderer), false,
    "a stale initial false query must not re-enable ExpressiveMouth animation after a newer true event");

  // Repeat with the opposite event/query values to ensure the fix is symmetric.
  const next = makeAccessibility();
  const nextRenderer = loadFace(next.accessibility, makeAppState());
  const nextListener = next.snapshotListeners()[0];
  next.emit(false);
  nextRenderer.flush();
  next.query.resolve(true);
  await next.query.promise;
  await Promise.resolve();
  nextRenderer.flush();
  assert.equal(faceMotionActive(nextRenderer), true,
    "a stale initial true query must not suppress motion after a newer false event");

  renderer.unmount();
  const noEvent = makeAccessibility();
  const noEventRenderer = loadFace(noEvent.accessibility, makeAppState());
  noEvent.query.resolve(true);
  await noEvent.query.promise;
  await Promise.resolve();
  noEventRenderer.flush();
  assert.equal(faceMotionActive(noEventRenderer), false,
    "without a newer event, the initial OS query still applies its Reduce Motion value");
  noEventRenderer.unmount();

  const pendingUnmount = makeAccessibility();
  const unmountedRenderer = loadFace(pendingUnmount.accessibility, makeAppState());
  const queuedListener = pendingUnmount.snapshotListeners()[0];
  unmountedRenderer.unmount();
  const afterUnmountCleanup = unmountedRenderer.postUnmountStateUpdates;
  pendingUnmount.query.resolve(true);
  await pendingUnmount.query.promise;
  await Promise.resolve();
  queuedListener?.(false); // Simulate an accessibility event already queued when native removed the listener.
  assert.equal(unmountedRenderer.postUnmountStateUpdates, afterUnmountCleanup,
    "an unmounted face ignores late query results and queued accessibility callbacks");

  nextRenderer.unmount();
  const nextAfterCleanup = nextRenderer.postUnmountStateUpdates;
  nextListener?.(true);
  assert.equal(nextRenderer.postUnmountStateUpdates, nextAfterCleanup);
}

// Exercise the real component and pure policy together: a transient look must
// yield to actual speech/sleep and must not reappear after that owner leaves.
{
  const control = makeAccessibility();
  const renderer = loadFace(control.accessibility, makeAppState(), { user: { voiceState: "sleeping" } });
  const eyes = () => renderer.components.find(({ name }) => name === "ExpressiveEye").props.expression;
  const mouth = () => renderer.components.find(({ name }) => name === "ExpressiveMouth").props;
  assert.ok(eyes().leftEyeScaleY > 0.5, "awake idle shows open ready eyes");

  renderer.states.reaction.mood = "curious";
  renderer.states.reaction.reactionId += 1;
  renderer.flush();
  assert.equal(eyes().emotion, "curious");
  assert.notEqual(eyes().leftEyeScaleY, eyes().rightEyeScaleY);

  renderer.states.behavior.presentation = { mood: "attentive", gaze: { x: 0.2, y: 0.2 } };
  renderer.states.behavior.state.companion.scene.status = "armed";
  renderer.states.conversation.isSpeaking = true; // Voice state may lag audible speech.
  renderer.states.conversation.streamingText = "Das ist großartig!";
  renderer.states.conversation.heardSpeechText = "Das ist großartig!";
  renderer.flush();
  assert.equal(eyes().emotion, "excited", "actual speech wins over a stale tap and armed-scene presentation");
  assert.equal(renderer.states.reaction.mood, null, "speech takeover discards the suppressed transient");
  renderer.states.conversation.isSpeaking = false;
  renderer.states.behavior.presentation = null;
  renderer.flush();
  assert.equal(eyes().emotion, "neutral", "speech ending returns to the current ready state without an old curious look");

  renderer.states.user.robotSleeping = true;
  renderer.states.user.preferences.faceStyle = "soft";
  renderer.states.reaction.mood = "victory";
  renderer.states.reaction.reactionId += 1;
  renderer.states.conversation.isSpeaking = true;
  renderer.flush();
  assert.equal(eyes().emotion, "sleeping", "deep sleep owns the face even if speech flags are stale");
  assert.equal(mouth().shape, "none", "the soft style's idle smile cannot leak into true sleep");
  assert.equal(mouth().motionActive, false, "deep sleep stops display loops");
  assert.equal(renderer.states.reaction.mood, null, "sleep discards old victory/tap reactions");

  renderer.states.user.robotSleeping = false;
  renderer.states.conversation.isSpeaking = false;
  renderer.states.user.voiceState = "processing";
  renderer.states.reaction.mood = "annoyed";
  renderer.states.reaction.reactionId += 1;
  renderer.flush();
  assert.equal(eyes().emotion, "thoughtful", "processing owns the face");
  assert.equal(renderer.states.reaction.mood, null);
  renderer.unmount();
}

{
  const renderer = loadFace(makeAccessibility().accessibility, makeAppState(), {
    user: { voiceState: "speaking" },
    conversation: { isSpeaking: false },
    objectAttention: { status: "tracking", gaze: { x: 0.8, y: -0.5 } },
  });
  assert.equal(renderer.gazeSelections.at(-1).input.assistantSpeaking, true,
    "gaze uses the same derived speaking state when the conversation flag lags");
  assert.equal(renderer.gazeSelections.at(-1).result, null,
    "tracked objects cannot keep the eyes while voiceState already owns speaking");
  renderer.unmount();
}

{
  const renderer = loadFace(makeAccessibility().accessibility, makeAppState(), {
    user: { voiceState: "processing" },
    behavior: { feedback: { id: "repair", mood: "repairing", generation: 1, expiresAt: 2000 } },
    reaction: { mood: "angry", reactionId: 3 },
  });
  const eyes = () => renderer.components.find(({ name }) => name === "ExpressiveEye").props.expression;
  assert.equal(eyes().emotion, "repairing", "a local correction is visible during processing");
  assert.ok(eyes().leftLid < 0.2 && eyes().rightLid < 0.2, "repair remains open and friendly");
  assert.equal(renderer.states.reaction.mood, null, "repair discards an old tap expression");
  renderer.states.conversation.isSpeaking = true;
  renderer.flush();
  assert.equal(eyes().emotion, "neutral", "actual output owns the face over repair");
  renderer.states.user.robotSleeping = true;
  renderer.flush();
  assert.equal(eyes().emotion, "sleeping");
  renderer.unmount();
}
{
  const renderer = loadFace(makeAccessibility().accessibility, makeAppState(), {
    user: { voiceState: "speaking" },
    conversation: { isSpeaking: true, streamingText: "Leider. Aber jetzt ist es großartig!", heardSpeechText: null },
  });
  const eyes = () => renderer.components.find(({ name }) => name === "ExpressiveEye").props.expression;
  assert.equal(eyes().emotion, "neutral", "generated future text cannot select a speaking emotion");
  renderer.states.conversation.heardSpeechText = "Leider."; renderer.flush();
  assert.equal(eyes().emotion, "concerned");
  renderer.states.conversation.heardSpeechText = "Aber jetzt ist es großartig!"; renderer.flush();
  assert.equal(eyes().emotion, "excited", "a confirmed new section retires the earlier negative word");
  renderer.unmount();
}
{
  let presses = 0, strokes = 0, controls = 0, consumed = false;
  const renderer = loadFace(makeAccessibility().accessibility, makeAppState(), {
    props: { onPress: () => presses++, onFriendlyStroke: () => strokes++, onContactStart: () => { controls++; return consumed; } },
  });
  const pressable = () => renderer.tree.props;
  const event = (x, time, ended = false, ids = ["one"]) => {
    const touches = ids.map(identifier => ({ identifier, pageX: x, pageY: 100, timestamp: time }));
    return { nativeEvent: { ...touches[0], touches: ended ? [] : touches, changedTouches: touches } };
  };
  assert.equal(pressable().onLongPress, undefined, "without a real callback, holding does not swallow the gesture");
  for (const order of ["touch-first", "press-first"]) {
    pressable().onTouchStart(event(100, 1000));
    pressable().onTouchMove(event(140, 1350));
    const end = event(180, 1700, true);
    if (order === "touch-first") { pressable().onTouchEnd(end); pressable().onPress(end); }
    else { pressable().onPress(end); pressable().onTouchEnd(end); }
  }
  assert.equal(strokes, 2, "either native ordering produces one stroke each");
  assert.equal(presses, 0, "a stroke cannot also start a conversation");
  pressable().onTouchStart(event(100, 2000));
  pressable().onPress(event(101, 2060, true));
  pressable().onTouchEnd(event(101, 2060, true));
  assert.equal(presses, 1, "ordinary tap still reaches the primary action");
  pressable().onPress({ nativeEvent: {} });
  assert.equal(presses, 2, "VoiceOver activate does not inherit the previous stroke result");
  pressable().onAccessibilityAction({ nativeEvent: { actionName: "pet" } });
  assert.equal(strokes, 3, "the friendly action is available without a swipe");
  pressable().onTouchStart(event(100, 3000));
  pressable().onTouchCancel();
  pressable().onTouchEnd(event(180, 3700, true));
  pressable().onPress(event(180, 3700, true));
  assert.equal(strokes, 3);
  assert.equal(presses, 2, "cancelled touch cannot become a tap");
  consumed = true;
  pressable().onTouchStart(event(100, 4000));
  pressable().onTouchMove(event(150, 4300));
  pressable().onPress(event(180, 4700, true));
  pressable().onTouchEnd(event(180, 4700, true));
  assert.equal(strokes, 3); assert.equal(presses, 2);
  assert.equal(controls, 5, "the control check runs exactly once at each touch start");
  renderer.unmount();
}
// Tracking updates cannot restart a reading scan; speech still takes ownership.
{
  const renderer = loadFace(makeAccessibility().accessibility, makeAppState(), {
    action: { active: { id: 8, kind: "read", phase: "use" } },
    objectAttention: { status: "tracking", gaze: { x: 0.7, y: -0.3 } },
  });
  const scans = () => renderer.animationTimings.filter(({ value, options }) => value === 1 && options?.duration === 3000).length;
  const initial = scans(); assert.equal(initial, 1);
  renderer.states.objectAttention.gaze = { x: -0.6, y: 0.4 }; renderer.flush();
  assert.equal(scans(), initial, "new camera attention does not restart the reading line");
  renderer.states.action.active = { id: 8, kind: "read", phase: "enjoy" }; renderer.flush();
  assert.equal(scans(), initial, "reading scan ends with the use phase");
  renderer.states.conversation.isSpeaking = true; renderer.flush();
  assert.equal(renderer.components.find(({ name }) => name === "CharacterProp"), undefined);
  renderer.unmount();
}
// Props and their own face expression share the same priority decision.
{
  const controlled = makeAccessibility();
  const renderer = loadFace(controlled.accessibility, makeAppState(), {
    action: { active: { id: 1, kind: "drink", phase: "use" } }, reaction: { mood: "angry", reactionId: 1 },
  });
  const prop = () => renderer.components.find(({ name }) => name === "CharacterProp")?.props;
  const eyes = () => renderer.components.find(({ name }) => name === "ExpressiveEye").props.expression;
  assert.equal(prop()?.frame.kind, "drink");
  assert.equal(eyes().emotion, "drinking");
  assert.equal(renderer.states.reaction.mood, null, "the action retires an old tap reaction");
  controlled.emit(true); renderer.flush();
  assert.equal(prop()?.motionActive, false, "Reduce Motion reaches the prop renderer");
  const still = prop()?.motion.value.prop;
  assert.ok(Math.hypot(still.x + (15 - 12) * 88 / 24, 197 + still.y + 44 + (2 - 12) * 88 / 24 - 216) < 0.001,
    "Reduce Motion preserves the straw's mouth contact without movement");
  assert.equal(prop()?.motion.value.mouthY, 1, "Reduce Motion removes chewing/puckering accents");
  renderer.states.conversation.isSpeaking = true; renderer.flush();
  assert.equal(prop(), undefined, "actual speech hides the prop immediately");
  assert.equal(renderer.states.action.active, null, "speech takeover cancels rather than postpones the prop");
  renderer.states.conversation.isSpeaking = false; renderer.flush();
  assert.equal(eyes().emotion, "attentive");
  renderer.unmount();
  const fixture = loadFace(makeAccessibility().accessibility, makeAppState(), {
    action: { active: { id: 2, kind: "coffee", phase: "use" } }, props: { fixture: { voiceState: "attention", presentation: null } },
  });
  assert.equal(fixture.components.find(({ name }) => name === "CharacterProp"), undefined, "offline fixtures isolate production props");
  fixture.unmount();
}
{
  const controls = makeAccessibility();
  const renderer = loadFace(controls.accessibility, makeAppState(), {
    user: { voiceState: "listening" }, conversation: { isUserSpeaking: true },
    behavior: { presentation: { id: "listening-1", gesture: "hold", mood: "listening", presentationOnly: true } },
  });
  const eyes = () => renderer.components.find(({ name }) => name === "ExpressiveEye").props.expression;
  const mouth = () => renderer.components.find(({ name }) => name === "ExpressiveMouth").props;
  assert.equal(eyes().emotion, "listening", "the real face component renders the local listening accent");
  assert.equal(mouth().shape, "line", "listening does not imply a spoken yes or a smile");
  renderer.states.user.preferences.faceStyle = "soft"; renderer.flush();
  assert.equal(mouth().shape, "line", "a skin's idle smile cannot turn neutral listening into a smile");
  controls.emit(true); renderer.flush();
  assert.equal(mouth().motionActive, false, "Reduce Motion controls the same native face renderer");
  renderer.states.conversation.isSpeaking = true; renderer.flush();
  assert.equal(eyes().emotion, "neutral", "assistant speech takes ownership from the old listening accent");
  renderer.states.user.robotSleeping = true; renderer.flush();
  assert.equal(eyes().emotion, "sleeping");
  renderer.unmount();
}
console.log("RobotFace motion, heard-section priority, repair, props, gesture ordering, control ownership and accessibility: passed");


// Blink closes an SVG aperture while preserving material and light-core geometry.
{
  const renderer = loadFace(makeAccessibility().accessibility, makeAppState());
  const eye = renderer.components.find(({ name }) => name === "ExpressiveEye").props;
  function nodes(node) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children)];
  }
  const props = id => nodes(renderer.tree).find(node => node.props?.testID === id).props.animatedProps;
  assert.equal(nodes(renderer.tree).some(node => typeof node.props?.filter === "string"), false,
    "native bloom avoids the SVG/CSS filter-prop collision in RN 0.85");
  const gradientStops = nodes(renderer.tree).filter(node => node.type === "SvgStop");
  assert.ok(gradientStops.length >= 10, "the rendered native gradient stops are inspected");
  for (const stop of gradientStops) {
    assert.equal(typeof stop.props.offset, "number", "native SVG accepts numeric gradient stops; leading-dot strings parse as zero");
  }
  const gradient = nodes(renderer.tree).find(node => node.props?.id?.endsWith("-shell"));
  assert.equal(gradient.props.fx, gradient.props.cx,
    "native first paint has the same explicit focus and gradient center");
  assert.equal(gradient.props.fy, gradient.props.cy);
  assert.equal(gradient.props.fy, "94%", "the moon light stays low in its own glass contour");
  const initialCore = props("glass-eye-core-left").d;
  const initialEnvelope = props("glass-eye-envelope-left").d;
  const initialAperture = props("glass-eye-aperture-left").d;
  eye.blink.value = .5; renderer.flush();
  assert.equal(props("glass-eye-core-left").d, initialCore, "the luminous core does not squash during blink");
  assert.equal(props("glass-eye-envelope-left").d, initialEnvelope, "glass material does not squash during blink");
  assert.notEqual(props("glass-eye-aperture-left").d, initialAperture, "the aperture closes independently");
  eye.blink.value = 0; renderer.flush();
  assert.equal(props("glass-eye-body-left").opacity, 0, "closed eyes hide every material layer");
  assert.equal(props("glass-eye-closed-left").opacity, 1, "a clean closed curve remains");
  renderer.states.user.robotSleeping = true; renderer.flush(); renderer.flush();
  assert.equal(props("glass-eye-body-right").opacity, 0, "sleep has no lingering white core");
  const anchor = nodes(renderer.tree).find(node => node.props?.testID === "glass-mouth-anchor");
  assert.equal(anchor.props.style.top + anchor.props.style.height / 2, 216, "scene contact point stays fixed");
  const mouthSvg = anchor.props.children;
  assert.equal(mouthSvg.props.style.position, "absolute", "the SVG cannot flex-shrink to the 18pt contact slot");
  assert.equal(mouthSvg.props.style.top + mouthSvg.props.height / 2, 9, "the full mouth drawing remains centered in that slot");
  renderer.unmount();
}
console.log("Native glass envelope, light-core, blink aperture and mouth-contact integration: PASS");

// The production adapter keeps persisted appearance choices and avatar sizing.
for (const palette of ["cyan", "rose", "lime", "amber", "violet"]) {
  const renderer = loadFace(makeAccessibility().accessibility, makeAppState(), {
    user: { preferences: {faceStyle:"classic",facePalette:palette,conversationMode:"realtime"} },
    props: {mode:"avatar"},
  });
  const eye = renderer.components.find(({name})=>name==="GlassEye").props;
  const mouth = renderer.components.find(({name})=>name==="GlassMouth").props;
  assert.equal(eye.paletteId,palette); assert.equal(mouth.paletteId,palette);
  assert.equal(eye.width,24.8); assert.ok(Math.abs(eye.height - 124 * 68 / 66 * .2) < 1e-9);
  assert.equal(mouth.shape,"smile"); assert.equal(mouth.isAvatar,true);
  assert.equal(renderer.states.user.preferences.facePalette,palette,"rendering never migrates a user's saved palette");
  renderer.unmount();
}
console.log("Native glass avatar and five persisted palettes: PASS");

// Incoming sound gets only the existing neutral listening pose. Exercise the
// actual component effects, including suppression and lifecycle retirement.
function freshInputCue() {
  const now = performance.now();
  return { id: "input-test", sessionId: "test", receivedAtMs: now, requestedAtMs: now, expiresAtMs: now + 420 };
}
{
  const controls = makeAccessibility();
  const app = makeAppState();
  const renderer = loadFace(controls.accessibility, app, {
    user: { voiceState: "listening" },
  });
  renderer.states.conversation.inputAttention = freshInputCue(); renderer.flush();
  const eyes = () => renderer.components.find(({ name }) => name === "GlassEye").props;
  const mouth = () => renderer.components.find(({ name }) => name === "GlassMouth").props;
  assert.equal(eyes().expression.emotion, "listening", "raw input can draw a neutral attention pose before confirmed speech");
  assert.equal(mouth().shape, "line");
  assert.equal(renderer.states.conversation.isUserSpeaking, false);
  controls.emit(true); renderer.flush();
  assert.equal(eyes().expression.emotion, "listening", "Reduced Motion preserves the static input cue");
  assert.equal(eyes().motionActive, false);
  app.emit("background"); renderer.flush();
  assert.equal(renderer.states.conversation.inputAttention, null, "background discards the cue");
  app.emit("active"); renderer.flush();
  assert.equal(eyes().expression.emotion, "attentive", "returning to foreground cannot revive attention");
  renderer.unmount();
}
for (const overrides of [
  { user: { voiceState: "processing" } },
  { user: { voiceState: "speaking" } },
  { user: { voiceState: "listening", robotSleeping: true } },
  { behavior: { state: { companion: { scene: { status: "idle" } }, game: { status: "active" } } } },
  { behavior: { state: { companion: { scene: { status: "idle" } }, pendingIntention: { waitingFor: "clarification" } } } },
  { behavior: { state: { companion: { scene: { status: "idle" }, pendingExperience: { kind: "remember" } } } } },
  { reaction: { mood: "curious", reactionId: 1 } },
]) {
  const renderer = loadFace(makeAccessibility().accessibility, makeAppState(), {
    ...overrides, user: { voiceState: "listening", ...overrides.user },
  });
  renderer.states.conversation.inputAttention = freshInputCue(); renderer.flush();
  assert.equal(renderer.states.conversation.inputAttention, null, "a higher priority state discards input attention");
  renderer.unmount();
}
{
  const cue = freshInputCue(); cue.expiresAtMs = performance.now() + 30;
  const renderer = loadFace(makeAccessibility().accessibility, makeAppState(), {
    user: { voiceState: "listening" },
  });
  renderer.states.conversation.inputAttention = cue; renderer.flush();
  await new Promise(resolve => setTimeout(resolve, 45)); renderer.flush();
  assert.equal(renderer.states.conversation.inputAttention, null, "component expiry releases input attention");
  renderer.unmount();
}
console.log("Input attention component: neutral onset, static Reduced Motion, expiry, suppression and lifecycle PASS");
