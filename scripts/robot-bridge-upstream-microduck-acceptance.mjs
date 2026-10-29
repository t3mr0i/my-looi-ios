import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startRobotGateway } from "../services/robot-bridge/gateway.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UPSTREAM_ROOT = process.argv[2];
const UPSTREAM_PIN = "942e58e3aa6dbb28e7037203fff11866122c7567";
const UPSTREAM = "https://github.com/pollen-robotics/microduck/tree/" + UPSTREAM_PIN;
const PORT = 18_200;
const SIGNALING_PORT = 18_243;
const UPSTREAM_FILES = [
  { path: "mediad/webclient/index.html", blob: "88ac6520bb642fcead60af289f7aafbafd595540" },
  { path: "spaces/shared/control.py", blob: "f9b8faf243ff4f8846b1823bf25a06c9a95febac" },
  { path: "spaces/shared/wire.py", blob: "0fb9e35d8647296bd22fb0360a191783254bef6b" },
  { path: "spaces/shared/rendezvous.py", blob: "555e18abe060af6eca96ab0dbba3457b332616ac" },
];

if (!UPSTREAM_ROOT) {
  throw new Error("Pass the path to an unmodified MicroDuck source snapshot or checkout at the pinned commit.");
}

const controlPath = path.join(UPSTREAM_ROOT, "spaces/shared/control.py");
const consolePath = path.join(UPSTREAM_ROOT, "mediad/webclient/index.html");
const sourceFiles = UPSTREAM_FILES.map(({ path: relativePath, blob }) => {
  const absolutePath = path.join(UPSTREAM_ROOT, relativePath);
  assert.ok(fs.existsSync(absolutePath), `Missing upstream file: ${absolutePath}`);
  const bytes = fs.readFileSync(absolutePath);
  const actual = createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
  assert.equal(actual, blob, `${relativePath} does not match the pinned MicroDuck Git blob`);
  return { path: relativePath, gitBlob: actual };
});

const consoleHtml = fs.readFileSync(consolePath, "utf8");
const consoleMethods = new Set();
for (const match of consoleHtml.matchAll(/(?:call|tell)\(["']([^"']+)["']/g)) consoleMethods.add(match[1]);
for (const match of consoleHtml.matchAll(/data-call=["']([^"']+)["']/g)) consoleMethods.add(match[1]);
// These two are intentionally displayed as refusal probes in the console's collapsed raw panel.
consoleMethods.delete("net.connect");
consoleMethods.delete("system.pairingPin");

const pythonHarness = String.raw`
import base64
import hashlib
import importlib.util
import json
import os
import socket
import struct
import threading
import time

control_path = os.environ["UPSTREAM_CONTROL_PATH"]
spec = importlib.util.spec_from_file_location("microduck_control", control_path)
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)

class WebSocket:
    def __init__(self, host, port):
        self.sock = socket.create_connection((host, port), timeout=5)
        self.sock.settimeout(None)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        self.sock.sendall((
            f"GET /microduck HTTP/1.1\r\nHost: {host}:{port}\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        ).encode("ascii"))
        response = bytearray()
        while b"\r\n\r\n" not in response:
            chunk = self.sock.recv(1)
            if not chunk:
                raise RuntimeError("socket closed during WebSocket handshake")
            response.extend(chunk)
        headers = bytes(response).split(b"\r\n\r\n", 1)[0].decode("latin1")
        if " 101 " not in headers.splitlines()[0]:
            raise RuntimeError("WebSocket upgrade failed: " + headers.splitlines()[0])
        expected = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        if ("sec-websocket-accept: " + expected).lower() not in headers.lower():
            raise RuntimeError("WebSocket handshake accept did not match RFC 6455")

    def send_json(self, message):
        payload = json.dumps(message, separators=(",", ":")).encode("utf-8")
        mask = os.urandom(4)
        size = len(payload)
        head = bytearray([0x81])
        if size < 126:
            head.append(0x80 | size)
        elif size < 65536:
            head.append(0x80 | 126)
            head.extend(struct.pack("!H", size))
        else:
            head.append(0x80 | 127)
            head.extend(struct.pack("!Q", size))
        masked = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        self.sock.sendall(bytes(head) + mask + masked)
        return True

    def _read_exactly(self, size):
        result = bytearray()
        while len(result) < size:
            chunk = self.sock.recv(size - len(result))
            if not chunk:
                raise EOFError("WebSocket closed")
            result.extend(chunk)
        return bytes(result)

    def read_frame(self):
        first, second = self._read_exactly(2)
        opcode = first & 0x0f
        length = second & 0x7f
        if length == 126:
            length = struct.unpack("!H", self._read_exactly(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self._read_exactly(8))[0]
        mask = self._read_exactly(4) if second & 0x80 else None
        payload = self._read_exactly(length)
        if mask:
            payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        return opcode, payload

    def close(self):
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.sock.close()

ws = WebSocket("127.0.0.1", int(os.environ["COMPANION_PORT"]))
rpc = control.Rpc(timeout=2.0)
rpc.bound_to(ws.send_json)
reader_error = []
state_count = 0
original_on_message = rpc.on_message
def count_state_notifications(raw):
    global state_count
    try:
        message = json.loads(raw)
        if message.get("method") == "robot.state":
            state_count += 1
    except (TypeError, ValueError):
        pass
    original_on_message(raw)
rpc.on_message = count_state_notifications
def read_forever():
    try:
        while True:
            opcode, payload = ws.read_frame()
            if opcode == 0x1:
                rpc.on_message(payload.decode("utf-8", "replace"))
            elif opcode == 0x8:
                return
            elif opcode == 0x9:
                # The companion does not ping this test client, but answer if it ever does.
                ws.sock.sendall(b"\x8a\x00")
    except (EOFError, OSError) as error:
        reader_error.append(type(error).__name__ + ": " + str(error))
        rpc.abandon("test WebSocket closed")

reader = threading.Thread(target=read_forever, daemon=True)
reader.start()

def call(method, params=None):
    try:
        result = rpc.call(method, params or {}, timeout=2.0)
        return {"ok": True, "result": result}
    except control.RpcError as error:
        return {"ok": False, "code": error.code, "message": error.message}
    except Exception as error:
        return {"ok": False, "error": type(error).__name__ + ": " + str(error)}

results = {}
for method, params in [
    ("hello", {"api_version": 44}),
    ("system.info", {}),
    ("media.video", {}),
    ("robot.subscribe", {"hz": 2}),
    ("robot.policies", {}),
    ("robot.mode", {}),
    ("robot.health", {}),
    ("robot.enable", {"on": True, "toggle": True}),
    ("robot.init", {}),
    ("robot.relax", {}),
    ("robot.stop", {}),
    ("robot.shutdown", {}),
    ("robot.move", {"vx": 0.1, "vy": 0.0, "vyaw": 0.0}),
    ("robot.move", {"vx": 0.0, "vy": 0.1, "vyaw": 0.0}),
    ("robot.look", {"x": 1.0, "y": 0.0, "z": 1.0, "neck_pitch": 0.0}),
    ("robot.do", {"skill": "nod"}),
    ("robot.sound", {"tag": "chirp"}),
    ("robot.stop", {}),
]:
    label = method + ("#lateral" if method == "robot.move" and params.get("vy") else "")
    results[label] = call(method, params)

# Exclude initial handshake notifications and RPC-call latency from the subscription-rate sample.
state_count = 0
state_measure_started = time.monotonic()
time.sleep(3.05)
state_measure_seconds = time.monotonic() - state_measure_started
deadline = time.monotonic() + 0.1
while "robot.state" not in rpc.notifications and time.monotonic() < deadline:
    time.sleep(0.02)
state = rpc.notifications.get("robot.state")
state_shape = {
    "received": isinstance(state, dict),
    "has_required_fields": isinstance(state, dict) and all(key in state for key in (
        "t", "move", "head", "policy", "safety", "loop", "joints", "targets",
        "velocities", "currents_ma", "odom")),
    "has_move_vectors": isinstance(state, dict) and all(
        isinstance(state.get("move", {}).get(key), list) and len(state["move"][key]) == 3
        for key in ("requested", "applied")),
    "has_head_vector": isinstance(state, dict) and isinstance(state.get("head"), list) and len(state["head"]) == 4,
    "safety_shape": isinstance(state, dict) and isinstance(state.get("safety"), dict) and all(
        key in state["safety"] for key in ("fallen", "limp", "gravity", "gain", "picked_up")),
}
print(json.dumps({"results": results, "state_shape": state_shape,
    "state_notifications": state_count, "state_measure_seconds": state_measure_seconds,
    "state_hz_observed": state_count / state_measure_seconds if state_measure_seconds else 0,
    "reader_error": reader_error}, separators=(",", ":")))
ws.close()
`;

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "looi-upstream-microduck-"));
const pythonPath = path.join(temporaryDirectory, "acceptance_client.py");
fs.writeFileSync(pythonPath, pythonHarness);

let instance;
let child;
try {
  instance = await startRobotGateway({
    host: "127.0.0.1",
    port: PORT,
    demo: true,
    allowApproximation: true,
    signalingPort: SIGNALING_PORT,
    centralToken: "",
  });

  const output = await new Promise((resolve, reject) => {
    child = spawn("python3", [pythonPath], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH,
        PYTHONDONTWRITEBYTECODE: "1",
        UPSTREAM_CONTROL_PATH: controlPath,
        COMPANION_PORT: String(PORT),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) reject(new Error(`upstream MicroDuck RPC client exited ${code}: ${stderr || stdout}`));
      else {
        const line = stdout.trim().split("\n").at(-1);
        try { resolve(JSON.parse(line)); }
        catch { reject(new Error(`upstream client did not return JSON: ${stderr || stdout}`)); }
      }
    });
  });

  const methodResults = Object.fromEntries([...consoleMethods].map((method) => [method, output.results[method] ?? null]));
  const unsupportedConsoleMethods = [...consoleMethods].filter((method) => output.results[method]?.code === -32601);
  const acceptedCore = ["hello", "robot.subscribe", "robot.move", "robot.look", "robot.do", "robot.stop"]
    .every((method) => output.results[method]?.ok === true);
  const stateShapeValid = Object.values(output.state_shape).every(Boolean);
  const refusedConsoleActions = ["robot.enable", "robot.init", "robot.relax", "robot.shutdown", "robot.sound"]
    .filter((method) => output.results[method]?.ok !== true || output.results[method]?.result?.accepted === false);
  const stateRateMatchesRequest = output.state_hz_observed >= 1.5 && output.state_hz_observed <= 2.5;
  const report = {
    verdict: unsupportedConsoleMethods.length || refusedConsoleActions.length || !acceptedCore
      || !stateShapeValid || !stateRateMatchesRequest || output.results["robot.move#lateral"]?.result?.accepted === false
      ? "FAIL" : "PASS",
    scope: "Official MicroDuck RPC client and pinned browser console method calls over the companion /microduck WebSocket; no camera, microphone, cloud token, or physical robot.",
    upstream: { repository: "pollen-robotics/microduck", commit: UPSTREAM_PIN, source: UPSTREAM },
    upstreamSourceFiles: sourceFiles,
    endpoints: { companion: `ws://127.0.0.1:${PORT}/microduck`, localSignalingPort: SIGNALING_PORT, mode: "demo + approximate" },
    consoleMethods: [...consoleMethods].sort(),
    results: methodResults,
    interactionResults: {
      forwardMove: output.results["robot.move"],
      lateralMove: output.results["robot.move#lateral"],
      look: output.results["robot.look"],
      gesture: output.results["robot.do"],
    },
    stateShape: output.state_shape,
    stateNotifications: output.state_notifications,
    stateHzObserved: Number(output.state_hz_observed.toFixed(1)),
    refusedConsoleActions,
    unsupportedConsoleMethods,
  };
  fs.writeFileSync(path.join(UPSTREAM_ROOT, "acceptance-result.json"), JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (report.verdict !== "PASS") process.exitCode = 1;
} finally {
  child?.kill("SIGTERM");
  if (instance) await instance.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
