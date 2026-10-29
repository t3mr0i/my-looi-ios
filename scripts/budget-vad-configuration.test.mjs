import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const configs = [];
const { VadService } = loadTypeScript("src/voice/vad-service.ts", {
  "@siteed/sherpa-onnx.rn": { VAD: {
    async init(config) { configs.push(config); return { success: true }; },
    async reset() {}, async release() {},
  } },
  "./sherpa-models": {
    DEFAULT_VAD_MODEL_DIR: "mock-models", DEFAULT_VAD_MODEL_FILE: "silero.onnx",
    resolveSherpaModelDir: (value) => value,
    checkSherpaModelFiles: async () => ({ ready: true }), formatSherpaModelError: () => "missing model",
  },
});
const service = new VadService();
await service.start();
assert.equal(configs[0].minSilenceDuration, 1, "retain the accepted one-second pause tolerance");
assert.equal(configs[0].maxSpeechDuration, 20,
  "the native five-second default must not force a completed segment inside a Budget turn that allows twenty seconds");
await service.stop();
console.log("Budget VAD: explicit twenty-second cap with retained one-second endpoint silence passed");
