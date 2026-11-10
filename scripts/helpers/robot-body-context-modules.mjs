import { loadTypeScript } from "./load-typescript.mjs";

const bodyState = loadTypeScript("src/robot-mind/body-state.ts");
/** The real body-context renderer (pure). */
export const robotBodyContextModule = loadTypeScript("src/robot-mind/body-context.ts", { "./body-state": bodyState });

/** Inert body-context delivery for transport tests that do not exercise body sense. */
export const inertRobotBodyContextRuntime = {
  readRobotBodyContext: () => "",
  startRealtimeBodyContextFeed: () => ({ start() {}, flush() {}, stop() {}, currentItemId: null }),
};

/** Mock entries for modules that import the body-context modules. */
/** Inert speech-level hooks for transport tests that do not exercise mouth or head movement. */
export const inertSpeechLevelModule = {
  noteSpeechPcm16Base64() {}, noteSpeechPcm16() {}, noteSpeechWav() {},
  speechLevel: { subscribe: () => () => {}, isLive: () => false, reset() {} },
};

export const robotBodyContextMocks = {
  "../robot-mind/speech-level": inertSpeechLevelModule,
  "../robot-mind/body-context": robotBodyContextModule,
  "../robot-mind/body-context-runtime": inertRobotBodyContextRuntime,
};
