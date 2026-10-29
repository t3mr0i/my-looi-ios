import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTypeScriptTreeLoader } from "./load-typescript-tree.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const load = createTypeScriptTreeLoader();

export function getSupportedInterfaceLanguageCount() {
  const { INTERFACE_LANGUAGE_OPTIONS } = load(path.join(root, "src/i18n/ui-language.ts"));
  return new Set(INTERFACE_LANGUAGE_OPTIONS.map(({ id }) => id)).size;
}
