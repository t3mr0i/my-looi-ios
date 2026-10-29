# MicroDuck upstream acceptance evidence

**Run date:** 2026-10-26  
**Upstream:** [`pollen-robotics/microduck` at `942e58e3aa6dbb28e7037203fff11866122c7567`](https://github.com/pollen-robotics/microduck/tree/942e58e3aa6dbb28e7037203fff11866122c7567), MicroDuck API v44  
**Overall:** **FAIL** for the full stock Console; the shared JSON-RPC path has a working subset.

The pinned [`robotd/src/main.rs`](https://github.com/pollen-robotics/microduck/blob/942e58e3aa6dbb28e7037203fff11866122c7567/robotd/src/main.rs) defines `hz > 0` as a per-connection `1/hz` interval. Omitted `hz` and `hz=0` disable decimation, and another subscribe replaces the existing interval.

The acceptance runner starts the real local companion in `--demo --approximate` mode on loopback port 18200 and its signaling listener on 18243. It loads the unmodified upstream `spaces/shared/control.py` RPC implementation and extracts the ordinary method names from upstream `mediad/webclient/index.html`; it sends those JSON-RPC requests without changing their method or parameter shapes. The source snapshot is checked against Git blob hashes at the pinned revision before the run.

Run it with:

```sh
node scripts/robot-bridge-upstream-microduck-acceptance.mjs /private/tmp/looi-upstream-microduck-acceptance
```

## Results

| Area | Result | Evidence |
|---|---|---|
| WebSocket RPC transport | **PASS** | The upstream Python `Rpc` client connected to `/microduck`, correlated replies, and received notifications. |
| API identity | **PASS** | `hello({api_version: 44})` returned API 44. |
| Initial and streaming state | **PASS** | Upstream client received `robot.state`; required state fields, three-value move vectors, four-value head vector, and safety fields were present. |
| Core controls | **PASS** | Forward move, look, `robot.do({skill: "nod"})`, and `robot.stop` returned usable responses in the simulator. |
| Stock Console RPC coverage | **FAIL** | `system.info`, `media.video`, `robot.policies`, `robot.mode`, `robot.health`, and `robot.sound` returned JSON-RPC `-32601`. |
| Stock Console posture controls | **FAIL** | `robot.init`, `robot.relax`, and `robot.shutdown` returned `-32001`. The Console’s `robot.enable({on:true,toggle:true})` returned `accepted:false`. |
| Stock Console sideways movement | **FAIL** | `robot.move({vx:0,vy:0.1,vyaw:0})` returned `accepted:false` because LOOI has no lateral drive capability. |
| Requested state rate | **PASS** | The Console requested `robot.subscribe({hz:2})`; a clean 3.05-second sample of the unchanged upstream Python RPC client received **6 notifications (2.0 Hz)**. |
| Hosted Central/WebRTC and live RTP | **BLOCKED** | This run did not use a Hugging Face token, cloud rendezvous, camera, microphone, speaker, or physical robot. The upstream `wire.py` and `rendezvous.py` sources were pinned and inspected, while the production peer/media negotiation was not exercised. |

The stock Console can establish the control session and render telemetry state. The subscription now honors the requested 2 Hz rate; the 10 Hz transport pump remains the upper bound. Its skills menu calls `robot.policies`; because that call is rejected and the page suppresses the error, the menu remains at “asking the robot…” and its gesture button cannot select the working `robot.do` method. The health/mode rows stay empty. Sound and posture buttons cannot complete. Sideways pad input is explicitly refused; forward and look work in the simulated backend. `media.video` is also unanswered, so the Console cannot obtain that metadata; this run did not open an RTP video stream.

The source roles were verified at the same pinned commit: `mediad/webclient/index.html` defines the browser Console methods and `control` data channel, `spaces/shared/control.py` is the upstream RPC client used here, and `spaces/shared/wire.py` plus `spaces/shared/rendezvous.py` define the hosted app’s Central/WebRTC path. The LOOI WebRTC peer uses the matching `control` label. A cloud session still needs an authorized Central registration and a real peer exchange to prove that full path.

## Work needed for full stock Console behavior

1. Add the Console’s read calls with their expected response shapes: `system.info`, `robot.policies`, `robot.mode`, `robot.health`, and `media.video`. `robot.policies` should at minimum return the existing supported LOOI gestures under `skills`, which lets the unchanged Console populate its menu.
2. Decide and implement the LOOI equivalents for `robot.sound` and `robot.enable` toggle. The current adapter correctly avoids claiming that MicroDuck policy enablement or sound playback happened when no equivalent action is available.
3. Keep `robot.init`, `robot.relax`, and `robot.shutdown` mapped only where there is a safe LOOI action with matching semantics; otherwise the stock controls need a compatible supported behavior.
4. Reconcile MicroDuck’s lateral pad axis with LOOI’s directional drive, or make the Console’s movement surface reflect the axes LOOI can actually perform. The current adapter rejects the whole lateral intent.
5. After those changes, run the unchanged Console against a real Pollen Central session and validate the WebRTC control channel plus camera/audio media path.

The runner writes the machine-readable result to `acceptance-result.json` in the supplied temporary upstream source directory. Its expected nonzero exit code reflects the current **FAIL** verdict, not a harness crash.
