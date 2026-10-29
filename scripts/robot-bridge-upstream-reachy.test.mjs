import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// End-to-end check for pollen-robotics/reachy_mini at
// 9fb2bfcbdf4c9800b0649acb8f0c18027673943f (1.13.0.dev0). Set
// REACHY_UPSTREAM_PYTHON to its isolated venv interpreter before running.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.LOOI_REACHY_ACCEPTANCE_PORT ?? 18100);
const signalPort = Number(process.env.LOOI_REACHY_ACCEPTANCE_SIGNAL_PORT ?? 18443);
const python = process.env.REACHY_UPSTREAM_PYTHON;
assert.ok(python, "Set REACHY_UPSTREAM_PYTHON to the isolated Python that has the pinned official reachy_mini SDK installed");

const sdkProgram = String.raw`
import json
import math
import time
import urllib.request

import numpy as np
import reachy_mini
from reachy_mini.apps.app import ReachyMiniApp
from reachy_mini.motion.recorded_move import RecordedMove
from reachy_mini.io.protocol import SetFullTargetCmd
from reachy_mini.io.ws_client import WSClient

PORT = int(__import__("os").environ["LOOI_REACHY_ACCEPTANCE_PORT"])
ReachyMiniApp._check_daemon_on_localhost = staticmethod(lambda port=8000, timeout=0.5: True)
report = {"sdk_version": reachy_mini.__version__, "entrypoint": "ReachyMiniApp.wrapped_run"}
_send_command = WSClient.send_command
def _observe_send_command(client, command):
    if isinstance(command, SetFullTargetCmd):
        report["set_full_target_wire"] = json.loads(command.model_dump_json())
    return _send_command(client, command)
WSClient.send_command = _observe_send_command

def pose(pitch):
    c, s = math.cos(pitch), math.sin(pitch)
    return np.array([[c, 0.0, s, 0.0], [0.0, 1.0, 0.0, 0.0], [-s, 0.0, c, 0.0], [0.0, 0.0, 0.0, 1.0]])

def bridge_state():
    with urllib.request.urlopen(f"http://localhost:{PORT}/api/robot-bridge/state", timeout=3) as response:
        return json.loads(response.read())

class AcceptanceApp(ReachyMiniApp):
    request_media_backend = "no_media"
    dont_start_webserver = True

    def run(self, robot, stop_event):
        # ReachyMini consumes the one daemon_status envelope during its own
        # initialization; the SDK keeps that parsed status cached afterward.
        daemon = robot.client.get_status(wait=False)
        joints, antennas = robot.get_current_joint_positions()
        head = robot.get_current_head_pose()
        report["startup_and_get_state"] = {
            "status_received": True,
            "robot_name": daemon.robot_name,
            "head_shape": list(head.shape),
            "head_joint_count": len(joints),
            "antenna_count": len(antennas),
        }
        if head.shape != (4, 4) or len(joints) != 7 or len(antennas) != 2:
            raise AssertionError("Reachy SDK state models did not parse the bridge's startup envelopes")

        robot.wake_up()
        report["wake_up"] = "completed"

        robot.goto_target(head=pose(0.12), antennas=[0.21, -0.21], duration=0.24, body_yaw=0.0)
        report["goto_target"] = "completed"
        after_goto = bridge_state()
        goto_pose = after_goto["virtualPose"]

        # Exercise the official SDK's fire-and-forget SetFullTargetCmd, whose
        # body_yaw field is serialized as JSON null when omitted.
        robot.set_target(head=pose(-0.10), antennas=[0.11, -0.11])
        time.sleep(0.25)
        after_set = bridge_state()
        set_pose = after_set["virtualPose"]
        report["set_target"] = {
            "wire_body_yaw": report["set_full_target_wire"].get("body_yaw"),
            "before_antennas": goto_pose.get("antennas"),
            "after_antennas": set_pose.get("antennas"),
            "before_command_id": (after_goto.get("lastResult") or {}).get("commandId"),
            "after_command_id": (after_set.get("lastResult") or {}).get("commandId"),
            "state_advanced": set_pose.get("antennas") != goto_pose.get("antennas"),
        }

        # Run the upstream RecordedMove + ReachyMini.play_move code path with
        # an in-memory move so the test uses no model, dataset, account, or media.
        frames = []
        for index, pitch in enumerate((0.0, 0.05, -0.04, 0.0)):
            frames.append({"head": pose(pitch).tolist(), "antennas": [0.08 + index * 0.01, -0.08 - index * 0.01], "body_yaw": 0.0})
        move = RecordedMove({
            "description": "local compatibility acceptance move",
            "time": [0.0, 0.1, 0.2, 0.4],
            "set_target_data": frames,
        })
        robot.play_move(move, play_frequency=10, sound=False)
        report["recorded_move"] = "completed"

        robot.goto_sleep()
        report["sleep"] = "completed"
        final_state = bridge_state()
        report["backend_demo_state"] = {
            "backend": final_state.get("backend"),
            "last_result_status": (final_state.get("lastResult") or {}).get("status"),
            "session_open_during_app": bool(final_state.get("sessionId")),
            "physical_measurements": (final_state.get("observed") or {}).get("measuredPose"),
        }

AcceptanceApp().wrapped_run(host="localhost", port=PORT, timeout=5.0)
report["close"] = "ReachyMiniApp context manager returned"
print("UPSTREAM_REACHY_ACCEPTANCE=" + json.dumps(report, separators=(",", ":")))
if not report["set_target"]["state_advanced"]:
    raise SystemExit("ReachyMini.set_target did not advance the LOOI backend state")
`;

function start(command, args, options) {
  const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], ...options });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return { child, stdout: () => stdout, stderr: () => stderr };
}

async function waitForHealth(child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Demo companion exited before health check: ${child.exitCode}`);
    try {
      const response = await fetch(`http://localhost:${port}/health`);
      if (response.ok && (await response.json()).demo) return;
    } catch { /* server is starting */ }
    await delay(100);
  }
  throw new Error("Timed out waiting for the demo companion health endpoint");
}

const companion = start(process.execPath, [path.join(root, "services/robot-bridge/gateway.mjs"), "--demo", "--approximate"], {
  env: {
    ...process.env,
    ROBOT_BRIDGE_HOST: "localhost",
    ROBOT_BRIDGE_PORT: String(port),
    ROBOT_BRIDGE_SIGNALING_PORT: String(signalPort),
    HF_TOKEN: "",
    LOOI_REACHY_ACCEPTANCE_PORT: String(port),
  },
});

try {
  await waitForHealth(companion.child);
  const sdk = start(python, ["-c", sdkProgram], {
    env: { ...process.env, LOOI_REACHY_ACCEPTANCE_PORT: String(port), PYTHONUNBUFFERED: "1" },
  });
  const result = await new Promise((resolve, reject) => {
    sdk.child.once("error", reject);
    sdk.child.once("close", (code, signal) => resolve({ code, signal }));
    const timer = setTimeout(() => {
      sdk.child.kill("SIGTERM");
      reject(new Error("Official Reachy SDK process exceeded 45 seconds"));
    }, 45_000);
    timer.unref();
  });
  const appOutput = sdk.stdout();
  const match = /UPSTREAM_REACHY_ACCEPTANCE=(\{[^\n]+\})/.exec(appOutput);
  if (match) console.log(JSON.stringify(JSON.parse(match[1]), null, 2));
  if (result.code !== 0) {
    if (sdk.stderr()) console.error(sdk.stderr());
    if (appOutput && !match) console.error(appOutput);
    throw new Error(`Official Reachy SDK process failed (exit=${result.code}, signal=${result.signal ?? "none"})`);
  }
  assert.ok(match, `Official SDK did not emit its acceptance report. Output:\n${appOutput}`);
  console.log("Reachy upstream SDK and RecordedMove app path passed against LOOI demo backend.");
} finally {
  companion.child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => companion.child.once("close", resolve)), delay(3_000)]);
  if (companion.child.exitCode === null) companion.child.kill("SIGKILL");
}
