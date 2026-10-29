import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

/** Load the portable TS bridge on Node without importing React Native or generating artifacts. */
export function createTypeScriptTreeLoader(overrides = {}, globals = {}) {
  const cache = new Map();
  const require = createRequire(import.meta.url);
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const localRequire = (name) => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (!name.startsWith(".")) return require(name);
      return load(path.resolve(path.dirname(file), `${name}.ts`));
    };
    new Function("require", "module", "exports", ...Object.keys(globals), code)(localRequire, module, module.exports, ...Object.values(globals));
    return module.exports;
  }
  return load;
}
