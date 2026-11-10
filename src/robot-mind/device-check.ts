/**
 * Guided device checks for the questions only the real robot can answer
 * (docs/research/robot-mind-device-check-2026-11-10.md, checklist items 1, 3, 4, 5).
 * Pure: step sequencing and verdicts from recorded FED9 frames. Device wiring is in
 * device-check-install.ts. Nothing here changes a setting or a safety gate.
 */
import { decodeFed9SensorFrame, PROVISIONAL_TOF_OBSTACLE_MM, TOF_NO_TARGET, type Fed9CliffSensors } from "../device-tools/fed9-sensors";

export type DeviceCheckId = "link_loss" | "lift" | "tof" | "head";
export interface Fed9Frame {
  at: number;
  hex: string;
  /** Synthesised from runtime state at check start; never counts as a frame received during the check. */
  seeded?: boolean;
}

export const DEVICE_CHECK_POSITION_MS = 3_000;
export const DEVICE_CHECK_HOLD_MS = 3_000;
export const DEVICE_CHECK_TICK_MS = 100;

// Preconditions -------------------------------------------------------------
export type DeviceCheckBlocker = "not-connected" | "autonomy-on" | "ambient-on" | "camera-on";
export function deviceCheckBlockersFor(facts: {
  connected: boolean; driveControlReady: boolean; idleAutonomyLevel: string; ambientMotionLevel: string; cameraAttentionEnabled: boolean;
}): DeviceCheckBlocker[] {
  const blockers: DeviceCheckBlocker[] = [];
  if (!facts.connected || !facts.driveControlReady) blockers.push("not-connected");
  if (facts.idleAutonomyLevel !== "off") blockers.push("autonomy-on");
  if (facts.ambientMotionLevel !== "off") blockers.push("ambient-on");
  if (facts.cameraAttentionEnabled) blockers.push("camera-on");
  return blockers;
}

// Frame helpers -------------------------------------------------------------
const clean = (hex: string) => hex.replace(/[^0-9a-f]/gi, "").toLowerCase();
function bytesOf(hex: string): Uint8Array {
  const h = clean(hex);
  return Uint8Array.from({ length: Math.floor(h.length / 2) }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16));
}
const frameType = (hex: string) => clean(hex).slice(0, 2) || "empty"; // same key as looi-robot.ts fed9FrameCounts
function cliffOf(frame: Fed9Frame) { const d = decodeFed9SensorFrame(bytesOf(frame.hex)); return d.kind === "cliff" ? d : null; }
function tofValueOf(frame: Fed9Frame): number | null {
  const b = bytesOf(frame.hex);
  return decodeFed9SensorFrame(b).kind === "tof" ? b[1] | (b[2] << 8) : null;
}
function isCliffOrDock(frame: Fed9Frame) { const k = decodeFed9SensorFrame(bytesOf(frame.hex)).kind; return k === "cliff" || k === "dock"; }
function lastAtOrBefore(frames: readonly Fed9Frame[], to: number, pick: (f: Fed9Frame) => boolean): Fed9Frame | null {
  let found: Fed9Frame | null = null;
  for (const f of frames) if (f.at <= to && pick(f)) found = f;
  return found;
}
/**
 * Frames that belong to step i: after the previous step's measurement ended, up to the end of this one.
 * A robot that only reports on change sends its frame while the owner moves into position, so the
 * countdown belongs to the step.
 */
function inStep(f: Fed9Frame, windows: readonly HoldWindow[], i: number) {
  const after = i === 0 ? -Infinity : windows[i - 1].to;
  return f.at > after && f.at <= windows[i].to;
}

// Guided hold sequence (lift, tof) -----------------------------------------
export interface HoldWindow { step: string; from: number; to: number; motion: boolean }
export interface HoldRun { windows: HoldWindow[]; outcome: "complete" | "cancelled" | "disconnected" }
export interface HoldDeps {
  now(): number;
  wait(ms: number): Promise<void>;
  /** Shows the step; resolves true when the owner taps Start, false when the check is cancelled. */
  ready(step: string): Promise<boolean>;
  phase(step: string, phase: "positioning" | "holding", remainingMs: number): void;
  cancelled(): boolean;
  robot(): { connected: boolean; motionActive: boolean };
}
export async function runHoldSequence(deps: HoldDeps, steps: readonly string[]): Promise<HoldRun> {
  const windows: HoldWindow[] = [];
  for (const step of steps) {
    if (!(await deps.ready(step))) return { windows, outcome: "cancelled" };
    const positionUntil = deps.now() + DEVICE_CHECK_POSITION_MS;
    while (deps.now() < positionUntil) {
      deps.phase(step, "positioning", positionUntil - deps.now());
      await deps.wait(DEVICE_CHECK_TICK_MS);
      if (deps.cancelled()) return { windows, outcome: "cancelled" };
      if (!deps.robot().connected) return { windows, outcome: "disconnected" };
    }
    const from = deps.now();
    const until = from + DEVICE_CHECK_HOLD_MS;
    let motion = false;
    while (deps.now() < until) {
      deps.phase(step, "holding", until - deps.now());
      await deps.wait(DEVICE_CHECK_TICK_MS);
      if (deps.cancelled()) return { windows, outcome: "cancelled" };
      const robot = deps.robot();
      if (!robot.connected) return { windows, outcome: "disconnected" };
      motion ||= robot.motionActive;
    }
    windows.push({ step, from, to: deps.now(), motion });
  }
  return { windows, outcome: "complete" };
}

// Lift ----------------------------------------------------------------------
export const LIFT_POSES = ["table", "lifted", "front_lifted", "rear_lifted"] as const;
export type LiftPose = (typeof LIFT_POSES)[number];
export type CliffSensorName = keyof Fed9CliffSensors;
const SENSORS: CliffSensorName[] = ["frontLeft", "frontRight", "rearLeft", "rearRight"];
export interface LiftPoseReading {
  pose: LiftPose;
  /** "mFLFRRLRR" from the last edge frame at or before the end of this pose's measurement; null when none. */
  rawFlags: string | null;
  /** An edge frame arrived during this step (countdown or measurement). */
  fresh: boolean;
  noGround: CliffSensorName[];
  /** Frames during this step by type, e.g. "01:2,02:5", or "none". */
  types: string;
  /** Other frame types (not edge, not dock): last hex at or before the end of this pose's measurement. */
  lastByType: Record<string, string>;
}
export interface LiftReport {
  verdict: "all_four" | "partial" | "none" | "no_frames" | "invalid";
  invalidReason: "incomplete" | "motion" | "table-not-on-ground" | null;
  poses: LiftPoseReading[];
  liftedNoGround: CliffSensorName[];
  /** Both front sensors still report ground while fully lifted, so an explicit "forward" would not be blocked. */
  liftedFrontGround: boolean | null;
  /** Front-lifted shows only front sensors off and rear-lifted only rear sensors off. */
  mappingConsistent: boolean | null;
  /** "02@lifted+front_lifted": other frame types whose last value differs from the table pose. */
  otherTypesChanged: string[];
}
export function evaluateLift(run: HoldRun, frames: readonly Fed9Frame[]): LiftReport {
  const poses: LiftPoseReading[] = run.windows.map((window, index) => {
    const cliffFrame = lastAtOrBefore(frames, window.to, (f) => cliffOf(f) !== null);
    const cliff = cliffFrame ? cliffOf(cliffFrame) : null;
    const during = frames.filter((f) => !f.seeded && inStep(f, run.windows, index));
    const counts: Record<string, number> = {};
    for (const f of during) counts[frameType(f.hex)] = (counts[frameType(f.hex)] ?? 0) + 1;
    const lastByType: Record<string, string> = {};
    for (const f of frames) if (!f.seeded && f.at <= window.to && !isCliffOrDock(f)) lastByType[frameType(f.hex)] = clean(f.hex);
    return {
      pose: window.step as LiftPose,
      rawFlags: cliff ? cliff.rawFlags.map((v) => (v ? "1" : "0")).join("") : null,
      fresh: during.some((f) => cliffOf(f) !== null),
      noGround: cliff ? SENSORS.filter((key) => !cliff.sensors[key]) : [],
      types: Object.keys(counts).sort().map((t) => `${t}:${counts[t]}`).join(",") || "none",
      lastByType,
    };
  });
  const base = { poses, liftedNoGround: [] as CliffSensorName[], liftedFrontGround: null, mappingConsistent: null, otherTypesChanged: [] as string[] };
  if (run.outcome !== "complete" || run.windows.length !== LIFT_POSES.length) return { ...base, verdict: "invalid", invalidReason: "incomplete" };
  if (run.windows.some((w) => w.motion)) return { ...base, verdict: "invalid", invalidReason: "motion" };
  if (!frames.some((f) => !f.seeded && cliffOf(f) !== null)) return { ...base, verdict: "no_frames", invalidReason: null };
  const pose = (p: LiftPose) => poses.find((r) => r.pose === p)!;
  const table = pose("table"), lifted = pose("lifted"), front = pose("front_lifted"), rear = pose("rear_lifted");
  if (table.rawFlags === null || table.noGround.length > 0) return { ...base, verdict: "invalid", invalidReason: "table-not-on-ground" };
  const isFront = (k: CliffSensorName) => k === "frontLeft" || k === "frontRight";
  const mappingConsistent = front.noGround.length > 0 && front.noGround.every(isFront)
    && rear.noGround.length > 0 && rear.noGround.every((k) => !isFront(k));
  const otherTypes = [...new Set(poses.flatMap((p) => Object.keys(p.lastByType)))].sort();
  const otherTypesChanged = otherTypes.flatMap((type) => {
    const changedIn = poses.filter((p) => p.pose !== "table" && p.lastByType[type] !== table.lastByType[type]).map((p) => p.pose);
    return changedIn.length ? [`${type}@${changedIn.join("+")}`] : [];
  });
  const off = lifted.noGround;
  return {
    poses, invalidReason: null,
    verdict: off.length === 4 ? "all_four" : off.length === 0 ? "none" : "partial",
    liftedNoGround: off, liftedFrontGround: !off.includes("frontLeft") && !off.includes("frontRight"),
    mappingConsistent, otherTypesChanged,
  };
}

// FED9 0E in front of an obstacle --------------------------------------------
export const TOF_STEPS = ["nothing_before", "cm40", "cm20", "cm10", "cm5", "nothing_after"] as const;
export type TofStep = (typeof TOF_STEPS)[number];
const DISTANCE_STEPS: TofStep[] = ["cm5", "cm10", "cm20", "cm40"];
export interface TofStepReading { step: TofStep; frames: number; values: string[]; lastHex: string | null; lastValue: number | null }
export interface TofReport {
  verdict: "distance_like" | "not_a_distance" | "no_frames" | "invalid";
  invalidReason: "incomplete" | "motion" | null;
  steps: TofStepReading[];
  totalFrames: number;
  responsiveSteps: number;
  monotonic: boolean;
  separated: boolean;
  nearSteps: TofStep[];
  thresholdMm: number;
}
export function evaluateTof(run: HoldRun, frames: readonly Fed9Frame[]): TofReport {
  const tof = frames.filter((f) => !f.seeded && tofValueOf(f) !== null);
  const steps: TofStepReading[] = run.windows.map((window, index) => {
    const during = tof.filter((f) => inStep(f, run.windows, index));
    const last = lastAtOrBefore(tof, window.to, () => true);
    return { step: window.step as TofStep, frames: during.length, values: [...new Set(during.map((f) => clean(f.hex)))].slice(0, 8),
      lastHex: last ? clean(last.hex) : null, lastValue: last ? tofValueOf(last) : null };
  });
  const base = { steps, totalFrames: tof.length, responsiveSteps: 0, monotonic: false, separated: false, nearSteps: [] as TofStep[], thresholdMm: PROVISIONAL_TOF_OBSTACLE_MM };
  if (run.outcome !== "complete" || run.windows.length !== TOF_STEPS.length) return { ...base, verdict: "invalid", invalidReason: "incomplete" };
  if (run.windows.some((w) => w.motion)) return { ...base, verdict: "invalid", invalidReason: "motion" };
  if (tof.length === 0) return { ...base, verdict: "no_frames", invalidReason: null };
  const at = (s: TofStep) => steps.find((r) => r.step === s)!;
  // No reading yet, 0x1fff ("no target") and anything above it count as "nothing in range".
  const rank = (s: TofStep) => { const v = at(s).lastValue; return v === null || v >= TOF_NO_TARGET ? Infinity : v; };
  const responsiveSteps = DISTANCE_STEPS.filter((s) => at(s).frames > 0).length;
  const monotonic = rank("cm5") <= rank("cm10") && rank("cm10") <= rank("cm20") && rank("cm20") <= rank("cm40");
  const separated = rank("cm5") < rank("cm20") && rank("cm5") < rank("nothing_before") && rank("cm5") < rank("nothing_after");
  const nearSteps = DISTANCE_STEPS.filter((s) => { const v = at(s).lastValue; return v !== null && v !== TOF_NO_TARGET && v <= PROVISIONAL_TOF_OBSTACLE_MM; });
  return { ...base, responsiveSteps, monotonic, separated, nearSteps, invalidReason: null,
    verdict: responsiveSteps >= 2 && monotonic && separated ? "distance_like" : "not_a_distance" };
}

// Link loss ----------------------------------------------------------------
export const LINK_LOSS_TURN_DIRECTION = "left" as const;
export const LINK_LOSS_START_TIMEOUT_MS = 2_500;
export const LINK_LOSS_CUT_AFTER_MS = 400;
export const LINK_LOSS_OBSERVE_MS = 4_000;
export const LINK_LOSS_MAX_ATTEMPTS = 3;
const LINK_LOSS_POLL_MS = 25;
export type LinkLossAnswer = "within_1s" | "later" | "kept_going";
export interface LinkLossAttemptFacts {
  attempt: number;
  started: boolean;
  blockReason: string | null;
  startedAt: number | null;
  cutAt: number | null;
  /** previousDirection of the ble-disconnected the cut produced. */
  cutDirection: string | null;
  /** First moment the app was not "active" since the attempt was armed. */
  appLeftActiveAt: number | null;
  /** First moment the runtime reported a connection again after the cut. */
  reconnectedAt: number | null;
  answer: LinkLossAnswer | null;
}
export type LinkLossInvalidReason = "not-started" | "no-cut" | "app-left-foreground" | "reconnected-too-early" | "no-answer";
export interface LinkLossAttemptResult extends LinkLossAttemptFacts { valid: boolean; invalidReason: LinkLossInvalidReason | null }
export function evaluateLinkLossAttempt(f: LinkLossAttemptFacts): LinkLossAttemptResult {
  const invalid = (invalidReason: LinkLossInvalidReason): LinkLossAttemptResult => ({ ...f, valid: false, invalidReason });
  if (!f.started) return invalid("not-started");
  if (f.cutAt === null || f.cutDirection === null || f.cutDirection === "stop") return invalid("no-cut");
  // Leaving the foreground makes the app send STOP itself (looi-robot-autoconnect.ts ensureMotionSafetyLifecycle).
  if (f.appLeftActiveAt !== null && f.appLeftActiveAt <= f.cutAt) return invalid("app-left-foreground");
  // Every reconnect sends STOP first, so one inside the observation window decides the outcome for the robot.
  if (f.reconnectedAt !== null && f.reconnectedAt - f.cutAt < LINK_LOSS_OBSERVE_MS) return invalid("reconnected-too-early");
  if (f.answer === null) return invalid("no-answer");
  return { ...f, valid: true, invalidReason: null };
}
export type LinkLossVerdict = "stops" | "needs_more" | "stops_late" | "keeps_going" | "undecided";
export type LinkLossRecommendation = "confirm-steps" | "repeat" | "keep-unchecked" | "keep-unchecked-autonomy-off";
export interface LinkLossSummary { verdict: LinkLossVerdict; recommendation: LinkLossRecommendation; attempts: number; validAttempts: number; answers: LinkLossAnswer[] }
export function evaluateLinkLoss(attempts: readonly LinkLossAttemptResult[]): LinkLossSummary {
  const valid = attempts.filter((a) => a.valid);
  const answers = valid.map((a) => a.answer!);
  const summary = (verdict: LinkLossVerdict, recommendation: LinkLossRecommendation): LinkLossSummary =>
    ({ verdict, recommendation, attempts: attempts.length, validAttempts: valid.length, answers });
  if (valid.length === 0) return summary("undecided", "repeat");
  if (answers.includes("kept_going")) return summary("keeps_going", "keep-unchecked-autonomy-off");
  if (answers.includes("later")) return summary("stops_late", "keep-unchecked");
  if (valid.length >= 2) return summary("stops", "confirm-steps");
  return summary("needs_more", "repeat");
}
export interface LinkLossDeps {
  now(): number;
  wait(ms: number): Promise<void>;
  robot(): { connected: boolean; driveControlReady: boolean; motionActive: boolean; activeDirection: string | null; lastMotionBlockReason: string | null };
  appActive(): boolean;
  /** Starts the ordinary safety-gated 180° turn; must not throw. */
  startTurn(): void;
  cutLink(): Promise<{ cut: boolean; direction: string | null }>;
  /** Reconnects after the observation window; fire-and-forget. Its first drive frame is STOP. */
  reconnect(): void;
  phase(phase: "starting" | "observing"): void;
  ask(): Promise<LinkLossAnswer | null>;
}
export async function runLinkLossAttempt(deps: LinkLossDeps, attempt: number): Promise<LinkLossAttemptResult> {
  let appLeftActiveAt: number | null = null;
  const watch = () => { if (appLeftActiveAt === null && !deps.appActive()) appLeftActiveAt = deps.now(); };
  const facts = (more: Partial<LinkLossAttemptFacts>): LinkLossAttemptFacts => ({
    attempt, started: false, blockReason: null, startedAt: null, cutAt: null, cutDirection: null,
    appLeftActiveAt, reconnectedAt: null, answer: null, ...more,
  });
  watch();
  const first = deps.robot();
  if (!first.connected || !first.driveControlReady) return evaluateLinkLossAttempt(facts({ blockReason: "not-connected" }));
  deps.phase("starting");
  deps.startTurn();
  const deadline = deps.now() + LINK_LOSS_START_TIMEOUT_MS;
  let startedAt: number | null = null;
  while (deps.now() < deadline) {
    await deps.wait(LINK_LOSS_POLL_MS);
    watch();
    const r = deps.robot();
    if (r.motionActive && r.activeDirection === LINK_LOSS_TURN_DIRECTION) { startedAt = deps.now(); break; }
  }
  if (startedAt === null) return evaluateLinkLossAttempt(facts({ blockReason: deps.robot().lastMotionBlockReason ?? "turn-did-not-start" }));
  while (deps.now() - startedAt < LINK_LOSS_CUT_AFTER_MS) { await deps.wait(LINK_LOSS_POLL_MS); watch(); }
  const cut = await deps.cutLink();
  const cutAt = deps.now();
  deps.phase("observing");
  let reconnectedAt: number | null = null;
  while (deps.now() - cutAt < LINK_LOSS_OBSERVE_MS) {
    await deps.wait(DEVICE_CHECK_TICK_MS);
    watch();
    if (reconnectedAt === null && deps.robot().connected) reconnectedAt = deps.now();
  }
  deps.reconnect();
  const answer = cut.cut ? await deps.ask() : null;
  return evaluateLinkLossAttempt(facts({ started: true, startedAt, cutAt: cut.cut ? cutAt : null, cutDirection: cut.direction, reconnectedAt, answer, appLeftActiveAt }));
}

// Head centre --------------------------------------------------------------
export type HeadAnswer = "87" | "5a" | "neither" | "same";
export interface HeadReport { verdict: "level_87" | "level_5a" | "neither" | "no_difference" | "incomplete"; answer: HeadAnswer | null; wrote87: boolean; wrote5a: boolean }
export function evaluateHead(input: { wrote87: boolean; wrote5a: boolean; answer: HeadAnswer | null }): HeadReport {
  const { wrote87, wrote5a, answer } = input;
  if (!wrote87 || !wrote5a || answer === null) return { verdict: "incomplete", answer, wrote87, wrote5a };
  const verdict = answer === "87" ? "level_87" : answer === "5a" ? "level_5a" : answer === "neither" ? "neither" : "no_difference";
  return { verdict, answer, wrote87, wrote5a };
}
export interface HeadDeps {
  ready(step: "head_87" | "head_5a"): Promise<boolean>;
  setHead(value: "87" | "5a"): Promise<boolean>;
  ask(): Promise<HeadAnswer | null>;
  /** Puts the head back to what the app uses today ("center" = 0x87). */
  restore(): Promise<void>;
}
/** null when cancelled. */
export async function runHeadCheck(deps: HeadDeps): Promise<HeadReport | null> {
  if (!(await deps.ready("head_87"))) return null;
  const wrote87 = await deps.setHead("87");
  if (!(await deps.ready("head_5a"))) { await deps.restore(); return null; }
  const wrote5a = await deps.setHead("5a");
  const answer = await deps.ask();
  await deps.restore();
  if (answer === null) return null;
  return evaluateHead({ wrote87, wrote5a, answer });
}
