import { AppState } from "react-native";
import { forceReconnectSavedLooiRobot } from "../device-tools/looi-robot-autoconnect";
import { cutLooiLinkDuringMotionForDeviceCheck, getLooiRobotRuntimeState, setLooiHead, subscribeLooiFed9Frames, turnLooi } from "../device-tools/looi-robot";
import { recordDiagnosticEvent } from "../diagnostics/diagnostic-log";
import { useUserStore } from "../store/user";
import {
  LIFT_POSES, LINK_LOSS_CUT_AFTER_MS, LINK_LOSS_OBSERVE_MS, LINK_LOSS_TURN_DIRECTION, TOF_STEPS,
  deviceCheckBlockersFor, evaluateLift, evaluateLinkLoss, evaluateTof, runHeadCheck, runHoldSequence, runLinkLossAttempt,
  type DeviceCheckBlocker, type Fed9Frame, type HeadAnswer, type HeadReport, type HoldDeps, type LiftReport, type LinkLossAnswer,
  type LinkLossAttemptResult, type LinkLossSummary, type TofReport,
} from "./device-check";

const MAX_FRAMES = 4_000;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const list = (values: readonly string[]) => (values.length ? values.join(",") : "none");

export interface DeviceCheckUi {
  ready(step: string): Promise<boolean>;
  phase(step: string, phase: "positioning" | "holding" | "starting" | "observing", remainingMs: number): void;
  askLinkLoss(): Promise<LinkLossAnswer | null>;
  askHead(): Promise<HeadAnswer | null>;
  cancelled(): boolean;
}

let running = false;
async function exclusive<T>(job: () => Promise<T>): Promise<T> {
  if (running) throw new Error("device-check-already-running");
  running = true;
  try { return await job(); } finally { running = false; }
}

export function currentDeviceCheckBlockers(): DeviceCheckBlocker[] {
  const robot = getLooiRobotRuntimeState();
  const p = useUserStore.getState().preferences;
  return deviceCheckBlockersFor({ connected: robot.connected, driveControlReady: robot.driveControlReady,
    idleAutonomyLevel: p.idleAutonomyLevel, ambientMotionLevel: p.ambientMotionLevel, cameraAttentionEnabled: p.cameraAttentionEnabled });
}

async function withFrames<T>(seedCliff: boolean, job: (frames: Fed9Frame[]) => Promise<T>): Promise<T> {
  const frames: Fed9Frame[] = [];
  const flags = getLooiRobotRuntimeState().sensors.cliffGroundFlags;
  if (seedCliff && flags?.length === 5) frames.push({ at: Date.now(), hex: flags.map((v) => (v ? "01" : "00")).join(""), seeded: true });
  const unsubscribe = subscribeLooiFed9Frames((frame) => { if (frames.length < MAX_FRAMES) frames.push(frame); });
  try { return await job(frames); } finally { unsubscribe(); }
}

function holdDeps(ui: DeviceCheckUi): HoldDeps {
  return {
    now: Date.now, wait, ready: ui.ready, phase: ui.phase, cancelled: ui.cancelled,
    robot: () => { const r = getLooiRobotRuntimeState(); return { connected: r.connected, motionActive: r.motionActive }; },
  };
}

export function runLiftCheckOnDevice(ui: DeviceCheckUi): Promise<LiftReport | null> {
  return exclusive(() => withFrames(true, async (frames) => {
    const run = await runHoldSequence(holdDeps(ui), LIFT_POSES);
    if (run.outcome === "cancelled") return null;
    const report = evaluateLift(run, frames);
    for (const pose of report.poses) {
      recordDiagnosticEvent("robot", "device-check-lift-pose", {
        pose: pose.pose, rawFlags: pose.rawFlags ?? "none", fresh: pose.fresh, noGround: list(pose.noGround), types: pose.types,
        other: Object.entries(pose.lastByType).map(([type, hex]) => `${type}=${hex}`).join(";") || "none",
      });
    }
    recordDiagnosticEvent("robot", "device-check-lift", {
      verdict: report.verdict, invalidReason: report.invalidReason ?? "none", liftedNoGround: list(report.liftedNoGround),
      liftedFrontGround: report.liftedFrontGround, mappingConsistent: report.mappingConsistent, otherTypesChanged: list(report.otherTypesChanged),
    });
    return report;
  }));
}

export function runTofCheckOnDevice(ui: DeviceCheckUi): Promise<TofReport | null> {
  return exclusive(() => withFrames(false, async (frames) => {
    const run = await runHoldSequence(holdDeps(ui), TOF_STEPS);
    if (run.outcome === "cancelled") return null;
    const report = evaluateTof(run, frames);
    for (const step of report.steps) {
      recordDiagnosticEvent("robot", "device-check-tof-step", {
        step: step.step, frames: step.frames, values: step.values.length ? step.values.join("|") : "none",
        lastHex: step.lastHex ?? "none", lastValue: step.lastValue,
      });
    }
    recordDiagnosticEvent("robot", "device-check-tof", {
      verdict: report.verdict, invalidReason: report.invalidReason ?? "none", totalFrames: report.totalFrames,
      responsiveSteps: report.responsiveSteps, monotonic: report.monotonic, separated: report.separated,
      nearSteps: list(report.nearSteps), thresholdMm: report.thresholdMm,
      values: report.steps.map((s) => `${s.step}=${s.lastValue ?? "none"}`).join(","),
    });
    return report;
  }));
}

export function runLinkLossAttemptOnDevice(ui: DeviceCheckUi, attempt: number): Promise<LinkLossAttemptResult> {
  return exclusive(async () => {
    let leftAt: number | null = null;
    const sub = AppState.addEventListener("change", (s) => { if (s !== "active" && leftAt === null) leftAt = Date.now(); });
    try {
      const r = await runLinkLossAttempt({
        now: Date.now, wait,
        robot: () => {
          const s = getLooiRobotRuntimeState();
          return { connected: s.connected, driveControlReady: s.driveControlReady, motionActive: s.motionActive,
            activeDirection: s.activeDirection, lastMotionBlockReason: s.safety.lastMotionBlockReason };
        },
        // AppState also catches a short "inactive" blip that the 25 ms polling could miss.
        appActive: () => leftAt === null && AppState.currentState === "active",
        startTurn: () => { void turnLooi(LINK_LOSS_TURN_DIRECTION, 180).catch(() => undefined); },
        cutLink: cutLooiLinkDuringMotionForDeviceCheck,
        reconnect: () => { void forceReconnectSavedLooiRobot().catch(() => undefined); },
        phase: (p) => ui.phase("link_loss", p, 0),
        ask: ui.askLinkLoss,
      }, attempt);
      recordDiagnosticEvent("robot", "device-check-link-loss-attempt", {
        attempt: r.attempt, valid: r.valid, invalidReason: r.invalidReason ?? "none", motion: "turn-left-180", direction: r.cutDirection ?? "none",
        blockReason: r.blockReason ?? "none", answer: r.answer ?? "none", cutAfterMs: LINK_LOSS_CUT_AFTER_MS, observeMs: LINK_LOSS_OBSERVE_MS,
        reconnectedAfterMs: r.reconnectedAt !== null && r.cutAt !== null ? r.reconnectedAt - r.cutAt : null,
        appLeftForegroundBeforeCut: r.appLeftActiveAt !== null && r.cutAt !== null && r.appLeftActiveAt <= r.cutAt,
      });
      return r;
    } finally { sub.remove(); }
  });
}

export function recordLinkLossVerdict(attempts: readonly LinkLossAttemptResult[]): LinkLossSummary {
  const summary = evaluateLinkLoss(attempts);
  recordDiagnosticEvent("robot", "device-check-link-loss", {
    verdict: summary.verdict, recommendation: summary.recommendation, attempts: summary.attempts,
    validAttempts: summary.validAttempts, answers: list(summary.answers),
  });
  return summary;
}

export function runHeadCheckOnDevice(ui: DeviceCheckUi): Promise<HeadReport | null> {
  return exclusive(async () => {
    const report = await runHeadCheck({
      ready: ui.ready,
      setHead: async (value) => { try { return (await setLooiHead(value, { priority: "explicit" })).completed === true; } catch { return false; } },
      ask: ui.askHead,
      restore: async () => { await setLooiHead("center", { priority: "explicit" }).catch(() => undefined); },
    });
    if (report) recordDiagnosticEvent("robot", "device-check-head", { verdict: report.verdict, answer: report.answer ?? "none", wrote87: report.wrote87, wrote5a: report.wrote5a });
    return report;
  });
}
