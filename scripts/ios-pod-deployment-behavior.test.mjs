import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { ensureMinimumPodDeploymentTarget } = require("../plugins/with-looi-ios.js");
const original = `target 'MyLOOI' do
  post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
    )
  end
end`;
const modified = ensureMinimumPodDeploymentTarget(original);
assert.equal(ensureMinimumPodDeploymentTarget(modified), modified, "prebuild must be idempotent");
assert.throws(() => ensureMinimumPodDeploymentTarget("unrecognized template"), /Could not locate/);
// Execute the generated Ruby hook with representative CocoaPods target settings.
const ruby = `require 'rubygems'
def target(name); yield; end
def react_native_post_install(*args); end
def post_install
  configurations = [nil, '12.0', '16.4', '18.0', '$(inherited)'].map do |value|
    Struct.new(:build_settings).new({'IPHONEOS_DEPLOYMENT_TARGET' => value})
  end
  pod = Struct.new(:build_configurations).new(configurations)
  installer = Struct.new(:pods_project).new(Struct.new(:targets).new([pod]))
  yield installer
  expected = ['16.4', '16.4', '16.4', '18.0', '$(inherited)']
  actual = configurations.map { |c| c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] }
  raise actual.inspect unless actual == expected
end
config = {reactNativePath: 'unused'}
podfile_properties = {'ios.deploymentTarget' => '16.4'}
${modified}
`;
const result = spawnSync("ruby", ["-e", ruby], { encoding: "utf8" });
if (result.error?.code === "ENOENT") {
  // Ruby is a required native iOS tool; don't claim execution on hosts without it.
  console.log("iOS Pod deployment transform/idempotency passed; Ruby execution unavailable on this host");
} else {
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
  console.log("iOS Pod deployment behavior: generated Ruby preserves newer/inherited targets and raises older targets");
}
