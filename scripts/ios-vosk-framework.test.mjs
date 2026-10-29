import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const {
  VOSK_VERSION,
  sourceArchives,
  parseVoskExports,
  archiveExports,
} = require("./stage-ios-vosk-framework.cjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { packageJsonPath, archives } = sourceArchives(root);
const packageInfo = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

assert.equal(packageInfo.version, "2.1.7", "the native wrapper must use the pinned Vosk source version");
assert.equal(VOSK_VERSION, packageInfo.version);
assert.deepEqual(archives.map(({ sdk, arch }) => `${sdk}/${arch}`), [
  "iphoneos/arm64",
  "iphonesimulator/arm64",
  "iphonesimulator/x86_64",
]);
assert.ok(archives[0].archive.endsWith("ios-arm64_armv7_armv7s/libvosk.a"));
assert.ok(archives.slice(1).every(({ archive }) => archive.endsWith("ios-arm64_x86_64-simulator/libvosk.a")));

const expectedExports = [
  "_vosk_batch_model_free", "_vosk_batch_model_new", "_vosk_batch_model_wait",
  "_vosk_batch_recognizer_accept_waveform", "_vosk_batch_recognizer_finish_stream",
  "_vosk_batch_recognizer_free", "_vosk_batch_recognizer_front_result",
  "_vosk_batch_recognizer_get_pending_chunks", "_vosk_batch_recognizer_new",
  "_vosk_batch_recognizer_pop", "_vosk_batch_recognizer_set_nlsml", "_vosk_gpu_init",
  "_vosk_gpu_thread_init", "_vosk_model_find_word", "_vosk_model_free", "_vosk_model_new",
  "_vosk_recognizer_accept_waveform", "_vosk_recognizer_accept_waveform_f",
  "_vosk_recognizer_accept_waveform_s", "_vosk_recognizer_final_result",
  "_vosk_recognizer_free", "_vosk_recognizer_new", "_vosk_recognizer_new_grm",
  "_vosk_recognizer_new_spk", "_vosk_recognizer_partial_result", "_vosk_recognizer_reset",
  "_vosk_recognizer_result", "_vosk_recognizer_set_max_alternatives",
  "_vosk_recognizer_set_nlsml", "_vosk_recognizer_set_partial_words",
  "_vosk_recognizer_set_spk_model", "_vosk_recognizer_set_words", "_vosk_set_log_level",
  "_vosk_spk_model_free", "_vosk_spk_model_new",
];
assert.deepEqual(parseVoskExports([
  "0000000000000000 T _vosk_model_new",
  "0000000000000000 W _FLAGS_fst_error_fatal",
  "0000000000000000 T __ZN3fst12FlagRegisterEv",
].join("\n")), ["_vosk_model_new"], "only the public Vosk C ABI enters the export list");

if (process.platform === "darwin") {
  const actualBySlice = archives.map(({ archive, arch }) => archiveExports(archive, arch));
  for (const actual of actualBySlice) {
    assert.deepEqual(actual, expectedExports, "all pinned public Vosk entry points must stay available in every slice");
    assert.ok(actual.every((symbol) => /^_vosk_[A-Za-z0-9_]+$/.test(symbol)));
    assert.ok(!actual.some((symbol) => /FLAGS|FlagRegister|FlagDescription|^__Z/.test(symbol)));
  }

  // If the wrapper has already been staged, inspect its platform slices and Mach-O load identity.
  const frameworkRoot = path.join(root, "modules/vosk-command-recognizer/ios/Native/LooiVoskNative.xcframework");
  if (fs.existsSync(path.join(frameworkRoot, "Info.plist"))) {
    const xcInfo = spawnSync("plutil", ["-convert", "json", "-o", "-", path.join(frameworkRoot, "Info.plist")], {
      encoding: "utf8",
    });
    assert.equal(xcInfo.status, 0, xcInfo.stderr);
    const libraries = JSON.parse(xcInfo.stdout).AvailableLibraries;
    assert.deepEqual(libraries.map(({ LibraryIdentifier }) => LibraryIdentifier).sort(), [
      "ios-arm64", "ios-arm64_x86_64-simulator",
    ]);
    assert.deepEqual(libraries.find(({ SupportedPlatformVariant }) => !SupportedPlatformVariant), {
      BinaryPath: "LooiVoskNative.framework/LooiVoskNative",
      LibraryIdentifier: "ios-arm64",
      LibraryPath: "LooiVoskNative.framework",
      SupportedArchitectures: ["arm64"],
      SupportedPlatform: "ios",
    });
    assert.deepEqual(libraries.find(({ SupportedPlatformVariant }) => SupportedPlatformVariant === "simulator"), {
      BinaryPath: "LooiVoskNative.framework/LooiVoskNative",
      LibraryIdentifier: "ios-arm64_x86_64-simulator",
      LibraryPath: "LooiVoskNative.framework",
      SupportedArchitectures: ["arm64", "x86_64"],
      SupportedPlatform: "ios",
      SupportedPlatformVariant: "simulator",
    });
    const binaries = [
      { path: path.join(frameworkRoot, "ios-arm64/LooiVoskNative.framework/LooiVoskNative"), arch: "arm64" },
      { path: path.join(frameworkRoot, "ios-arm64_x86_64-simulator/LooiVoskNative.framework/LooiVoskNative"), arch: "arm64" },
      { path: path.join(frameworkRoot, "ios-arm64_x86_64-simulator/LooiVoskNative.framework/LooiVoskNative"), arch: "x86_64" },
    ];
    for (const { path: binary, arch } of binaries) {
      assert.ok(fs.existsSync(binary), `missing ${arch} framework executable`);
      const result = spawnSync("xcrun", ["nm", "-gU", "-arch", arch, binary], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      const symbols = parseVoskExports(result.stdout);
      const external = result.stdout.split(/\r?\n/).map((line) => line.trim().split(/\s+/).at(-1))
        .filter((symbol) => symbol?.startsWith("_"));
      assert.deepEqual(symbols, expectedExports, `${arch} wrapper must retain the full public Vosk ABI`);
      assert.deepEqual(external, expectedExports, `${arch} wrapper must not export C++ or OpenFST globals`);

      const header = spawnSync("xcrun", ["otool", "-arch", arch, "-hv", binary], { encoding: "utf8" });
      assert.equal(header.status, 0, header.stderr);
      assert.match(header.stdout, /\bDYLIB\b/, `${arch} executable must be Mach-O MH_DYLIB`);

      const installName = spawnSync("xcrun", ["otool", "-arch", arch, "-D", binary], { encoding: "utf8" });
      assert.equal(installName.status, 0, installName.stderr);
      assert.equal(installName.stdout.trim().split(/\r?\n/).at(-1),
        "@rpath/LooiVoskNative.framework/LooiVoskNative",
        `${arch} executable must use the framework @rpath install name`);
    }
  }
} else {
  console.log("Skipping xcrun/nm/plutil/otool checks: they require macOS with Xcode; parser and pinned-source checks ran.");
}

console.log("iOS Vosk framework parser and pinned-source checks passed");
