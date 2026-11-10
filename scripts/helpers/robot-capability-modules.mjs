import { loadTypeScript } from "./load-typescript.mjs";

/** The real capability manifest with its scene catalog, for tests that build prompts or tool lists. */
export function loadRobotCapabilityModules() {
  const sceneData = loadTypeScript("src/character/character-scene-data.ts");
  const sceneCatalog = loadTypeScript("src/character/character-scene-catalog.ts", { "./character-scene-data": sceneData });
  const definitions = loadTypeScript("src/voice/robot-capability-tool-definitions.ts", {
    "../character/character-scene-catalog": sceneCatalog,
  });
  return { sceneCatalog, definitions };
}

/** Inert bridge for transport tests that do not exercise robot actions. */
export const inertRobotCapabilityToolBridge = {
  async execute() { return { ok: false, status: "disabled-in-test" }; },
  express() { return { ok: false, status: "disabled-in-test" }; },
};
