const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VOSK_VERSION = '2.1.7';
const FRAMEWORK_NAME = 'LooiVoskNative';
const FRAMEWORK_IDENTIFIER = 'com.superlooi.LooiVoskNative';
const MINIMUM_IOS = '16.4';
const FINGERPRINT_FILE = '.looi-vosk-build-fingerprint';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed${output ? `:\n${output}` : ''}`);
  }
  return result.stdout.trim();
}

function sourceArchives(root) {
  const packageJsonPath = require.resolve('react-native-vosk/package.json', { paths: [root] });
  const packageInfo = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  if (packageInfo.version !== VOSK_VERSION) {
    throw new Error(`Expected react-native-vosk ${VOSK_VERSION}, found ${packageInfo.version}.`);
  }
  const packageRoot = path.dirname(packageJsonPath);
  const iosRoot = path.join(packageRoot, 'ios', 'libvosk.xcframework');
  const archives = [
    {
      sdk: 'iphoneos',
      arch: 'arm64',
      target: `arm64-apple-ios${MINIMUM_IOS}`,
      archive: path.join(iosRoot, 'ios-arm64_armv7_armv7s', 'libvosk.a'),
    },
    {
      sdk: 'iphonesimulator',
      arch: 'arm64',
      target: `arm64-apple-ios${MINIMUM_IOS}-simulator`,
      archive: path.join(iosRoot, 'ios-arm64_x86_64-simulator', 'libvosk.a'),
    },
    {
      sdk: 'iphonesimulator',
      arch: 'x86_64',
      target: `x86_64-apple-ios${MINIMUM_IOS}-simulator`,
      archive: path.join(iosRoot, 'ios-arm64_x86_64-simulator', 'libvosk.a'),
    },
  ];
  for (const { archive } of archives) {
    if (!fs.existsSync(archive)) throw new Error(`Pinned Vosk archive is missing: ${archive}`);
  }
  return { packageJsonPath, archives };
}

function parseVoskExports(nmOutput) {
  return [...new Set(nmOutput.split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/).at(-1))
    .filter((symbol) => symbol && /^_vosk_[A-Za-z0-9_]+$/.test(symbol)))].sort();
}

function archiveExports(archive, arch) {
  const output = run('xcrun', ['nm', '-gU', '-arch', arch, archive]);
  const symbols = parseVoskExports(output);
  if (symbols.length === 0) throw new Error(`No public _vosk_* symbols found in ${archive} (${arch}).`);
  return symbols;
}

function sdkInfo(sdk) {
  const sdkPath = run('xcrun', ['--sdk', sdk, '--show-sdk-path']);
  const sdkVersion = run('xcrun', ['--sdk', sdk, '--show-sdk-version']);
  const settingsPath = path.join(sdkPath, 'SDKSettings.plist');
  return { sdkPath, sdkVersion, settingsPath };
}

function buildFingerprint(archives, sdks) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(__filename));
  for (const [index, source] of archives.entries()) {
    hash.update(`archive:${index}:${source.sdk}:${source.arch}:${source.target}\0`);
    hash.update(fs.readFileSync(source.archive));
  }
  hash.update(JSON.stringify({
    minimumIos: MINIMUM_IOS,
    sdkVersions: Object.fromEntries(Object.entries(sdks).map(([name, info]) => [name, info.sdkVersion])),
    sdkSettings: Object.fromEntries(Object.entries(sdks).map(([name, info]) => [
      name,
      crypto.createHash('sha256').update(fs.readFileSync(info.settingsPath)).digest('hex'),
    ])),
    xcode: run('xcodebuild', ['-version']),
    clang: run('xcrun', ['clang++', '--version']).split(/\r?\n/)[0],
  }));
  return hash.digest('hex');
}

function frameworkInfoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key><string>en</string>
	<key>CFBundleExecutable</key><string>${FRAMEWORK_NAME}</string>
	<key>CFBundleIdentifier</key><string>${FRAMEWORK_IDENTIFIER}</string>
	<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
	<key>CFBundleName</key><string>${FRAMEWORK_NAME}</string>
	<key>CFBundlePackageType</key><string>FMWK</string>
	<key>CFBundleShortVersionString</key><string>${VOSK_VERSION}</string>
	<key>CFBundleVersion</key><string>${VOSK_VERSION}</string>
	<key>MinimumOSVersion</key><string>${MINIMUM_IOS}</string>
</dict>
</plist>
`;
}

function ensureSameSymbols(archives) {
  const byArchitecture = archives.map((source) => ({
    arch: source.arch,
    sdk: source.sdk,
    symbols: archiveExports(source.archive, source.arch),
  }));
  const expected = JSON.stringify(byArchitecture[0].symbols);
  for (const entry of byArchitecture.slice(1)) {
    if (JSON.stringify(entry.symbols) !== expected) {
      throw new Error(`Vosk public C ABI differs for ${entry.sdk}/${entry.arch}; refusing to drop slice APIs.`);
    }
  }
  return byArchitecture[0].symbols;
}

function writeFrameworkInfo(frameworkPath, supportedPlatform) {
  fs.mkdirSync(frameworkPath, { recursive: true });
  const plist = frameworkInfoPlist().replace(
    '\t<key>MinimumOSVersion</key><string>',
    `\t<key>CFBundleSupportedPlatforms</key><array><string>${supportedPlatform}</string></array>\n\t<key>MinimumOSVersion</key><string>`,
  );
  fs.writeFileSync(path.join(frameworkPath, 'Info.plist'), plist);
}

function linkSlice(source, sdkInfoForSlice, exportsPath, outputPath) {
  const args = [
    '--sdk', source.sdk,
    'clang++',
    '-dynamiclib',
    '-target', source.target,
    '-isysroot', sdkInfoForSlice.sdkPath,
    '-arch', source.arch,
    '-Wl,-exported_symbols_list,' + exportsPath,
    `-Wl,-install_name,@rpath/${FRAMEWORK_NAME}.framework/${FRAMEWORK_NAME}`,
    '-framework', 'Accelerate',
    '-framework', 'AVFoundation',
    '-lc++',
    '-lz',
    // Root every public C entry point, then let ld pull only its required object graph.
    // Forcing the entire vendor archive also pulls unused Kaldi trainer objects with unresolved refs.
    ...archiveExports(source.archive, source.arch).flatMap((symbol) => ['-Wl,-u,' + symbol]),
    source.archive,
    '-o', outputPath,
  ];
  run('xcrun', args);
}

function assertDynamicExports(binaryPath, arch, expectedSymbols) {
  const fullOutput = run('xcrun', ['nm', '-gU', '-arch', arch, binaryPath]);
  const actualSymbols = parseVoskExports(fullOutput);
  const externalDefined = fullOutput.split(/\r?\n/).map((line) => line.trim().split(/\s+/).at(-1))
    .filter((symbol) => symbol && symbol.startsWith('_'));
  const leaked = externalDefined.filter((symbol) => !/^_vosk_[A-Za-z0-9_]+$/.test(symbol));
  if (JSON.stringify(actualSymbols) !== JSON.stringify(expectedSymbols) || leaked.length > 0) {
    throw new Error(`Unexpected exported symbols in ${binaryPath} (${arch}). Leaked symbols: ${leaked.slice(0, 12).join(', ') || '(none)'}`);
  }
}

function stageIosVoskFramework(root) {
  if (process.platform !== 'darwin') {
    throw new Error('Staging LooiVoskNative.xcframework requires macOS with Xcode command line tools.');
  }
  const { archives } = sourceArchives(root);
  const symbols = ensureSameSymbols(archives);
  const sdks = {
    iphoneos: sdkInfo('iphoneos'),
    iphonesimulator: sdkInfo('iphonesimulator'),
  };
  const fingerprint = buildFingerprint(archives, sdks);
  const nativeDirectory = path.join(root, 'modules/vosk-command-recognizer/ios/Native');
  const destination = path.join(nativeDirectory, `${FRAMEWORK_NAME}.xcframework`);
  const markerPath = path.join(destination, FINGERPRINT_FILE);
  if (fs.existsSync(path.join(destination, 'Info.plist'))
    && fs.existsSync(markerPath)
    && fs.readFileSync(markerPath, 'utf8').trim() === fingerprint) {
    return destination;
  }

  fs.mkdirSync(nativeDirectory, { recursive: true });
  const stagingRoot = fs.mkdtempSync(path.join(nativeDirectory, '.looi-vosk-stage-'));
  const exportsPath = path.join(stagingRoot, 'exported-symbols.txt');
  fs.writeFileSync(exportsPath, `${symbols.join('\n')}\n`);
  const deviceFramework = path.join(stagingRoot, 'device', `${FRAMEWORK_NAME}.framework`);
  const simulatorFramework = path.join(stagingRoot, 'simulator', `${FRAMEWORK_NAME}.framework`);
  const deviceBinary = path.join(deviceFramework, FRAMEWORK_NAME);
  const simulatorBinary = path.join(simulatorFramework, FRAMEWORK_NAME);
  writeFrameworkInfo(deviceFramework, 'iPhoneOS');
  writeFrameworkInfo(simulatorFramework, 'iPhoneSimulator');

  try {
    linkSlice(archives[0], sdks.iphoneos, exportsPath, deviceBinary);
    assertDynamicExports(deviceBinary, 'arm64', symbols);

    const simulatorArm64 = path.join(stagingRoot, 'simulator-arm64');
    const simulatorX64 = path.join(stagingRoot, 'simulator-x86_64');
    linkSlice(archives[1], sdks.iphonesimulator, exportsPath, simulatorArm64);
    linkSlice(archives[2], sdks.iphonesimulator, exportsPath, simulatorX64);
    run('xcrun', ['lipo', '-create', simulatorArm64, simulatorX64, '-output', simulatorBinary]);
    assertDynamicExports(simulatorBinary, 'arm64', symbols);
    assertDynamicExports(simulatorBinary, 'x86_64', symbols);

    const stagedFramework = path.join(stagingRoot, `${FRAMEWORK_NAME}.xcframework`);
    run('xcodebuild', [
      '-create-xcframework',
      '-framework', deviceFramework,
      '-framework', simulatorFramework,
      '-output', stagedFramework,
    ]);
    fs.writeFileSync(path.join(stagedFramework, FINGERPRINT_FILE), `${fingerprint}\n`);

    const backup = `${destination}.previous-${process.pid}`;
    fs.rmSync(backup, { recursive: true, force: true });
    if (fs.existsSync(destination)) fs.renameSync(destination, backup);
    try {
      fs.renameSync(stagedFramework, destination);
    } catch (error) {
      if (fs.existsSync(backup)) fs.renameSync(backup, destination);
      throw error;
    }
    fs.rmSync(backup, { recursive: true, force: true });
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
  return destination;
}

module.exports = {
  VOSK_VERSION,
  sourceArchives,
  parseVoskExports,
  archiveExports,
  stageIosVoskFramework,
};

if (require.main === module) {
  try {
    const destination = stageIosVoskFramework(path.resolve(__dirname, '..'));
    process.stdout.write(`Staged ${destination}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  }
}
