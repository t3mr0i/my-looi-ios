import { createTypeScriptTreeLoader } from "../../scripts/helpers/load-typescript-tree.mjs";
import { fileURLToPath } from "node:url";

// Keep the Node companion API stable while sharing all catalog behavior with
// the native app through the dependency-free TypeScript implementation.
const load = createTypeScriptTreeLoader();
const catalog = load(fileURLToPath(new URL("../../src/robot-bridge/app-catalog.ts", import.meta.url)));

export const createAppCatalog = catalog.createAppCatalog;
export const HF_API = catalog.HF_API;
export const SPACE_ID = catalog.SPACE_ID;
export const COMMIT = catalog.COMMIT;
