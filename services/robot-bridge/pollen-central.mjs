import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTypeScriptTreeLoader } from "../../scripts/helpers/load-typescript-tree.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const load = createTypeScriptTreeLoader();
const signaling = load(path.join(root, "src/robot-bridge/pollen-signaling.ts"));

export const DEFAULT_POLLEN_CENTRAL_URL = signaling.DEFAULT_POLLEN_CENTRAL_URL;
export const createPollenCentralClient = signaling.createPollenCentralClient;
export const createGStreamerSignalingRelay = signaling.createGStreamerSignalingRelay;
