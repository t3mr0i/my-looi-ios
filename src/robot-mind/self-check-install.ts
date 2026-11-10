import { getSocialAttentionControllerState } from "../core/social-attention";
import { getLooiRobotRuntimeState } from "../device-tools/looi-robot";
import { recordDiagnosticEvent } from "../diagnostics/diagnostic-log";
import { useUserStore } from "../store/user";
import { SURFACE_SENSOR_FRESH_MS } from "./idle-autonomy";
import { runRobotMindSelfCheck, type SelfCheckReport } from "./self-check";

const STOP_DECODER_PREPARE_TIMEOUT_MS = 4_000;
let running: Promise<SelfCheckReport> | null = null;

/** Runs the passive robot-mind self-check against the real device. One run at a time. */
export function runRobotMindSelfCheckOnDevice(): Promise<SelfCheckReport> {
  running ??= (async () => {
    const [{ kwsAudioFeeder }, { wakewordService }, { speechClipCache }] = await Promise.all([
      import("../voice/kws-audio-feeder"), import("../voice/wakeword"), import("./speech-clip-cache-storage"),
    ]);
    return runRobotMindSelfCheck({
      now: Date.now,
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      robot() {
        const robot = getLooiRobotRuntimeState();
        return { connected: robot.connected, driveControlReady: robot.driveControlReady, lastSensorFrameAt: robot.sensors.lastFed9At,
          frameCounts: { ...robot.sensors.fed9FrameCounts },
          cliff: robot.sensors.cliffSensors ? { ...robot.sensors.cliffSensors } : null, obstacleNear: robot.sensors.obstacleNear };
      },
      sensorFreshMs: SURFACE_SENSOR_FRESH_MS,
      microphoneLive: () => kwsAudioFeeder.diagnosticStatus.pcmFlowing,
      prepareStopDecoder: () => Promise.race([
        wakewordService.prepareDrivingControl(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), STOP_DECODER_PREPARE_TIMEOUT_MS)),
      ]),
      keywordStopAvailable: () => wakewordService.isNativeKwsAvailable,
      clipCache: speechClipCache,
      camera() {
        const social = getSocialAttentionControllerState();
        return { enabled: useUserStore.getState().preferences.cameraAttentionEnabled, looking: social.running && social.attentionActive && social.nativeStarted, faces: social.faces.length };
      },
      record(report) {
        recordDiagnosticEvent("robot", "robot-mind-self-check", { ok: report.ok, durationMs: report.durationMs });
        for (const line of report.lines) recordDiagnosticEvent("robot", "robot-mind-self-check-line", { id: line.id, status: line.status, ...line.values });
      },
    });
  })().finally(() => { running = null; });
  return running;
}
