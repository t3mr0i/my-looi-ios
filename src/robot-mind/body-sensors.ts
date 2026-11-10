/**
 * Maps raw sensor snapshots onto the shared body state. Pure decision logic:
 * no React Native, BLE or camera import. The runtime wiring in
 * body-sensors-runtime.ts samples the real controllers and calls in here.
 *
 * Owned fields (see the common brief): connection, surface, wheelsMoving,
 * people, touch, displayScene, lastHumanInteractionAt and the activity modes
 * sleeping / conversation / commanded_motion / resting.
 */
import type { RobotActivityMode, RobotBearing, RobotBodyState, RobotBodyStatePatch, RobotBodyStateStore } from "./body-state";

export type RobotBodyFaceSample = {
  /** Normalised 0..1 centre in the camera frame, as reported by local face detection. */
  centerX: number;
  /** Normalised 0..1 width of the face box. */
  width: number;
  /** True for the face social attention is currently turned to. */
  selected?: boolean;
};

export type RobotBodySensorSnapshot = {
  robot: {
    /** A BLE transport has been bound at least once in this process. */
    configured: boolean;
    connected: boolean;
    motionActive: boolean;
    /** Directional near-edge latches from looi-robot (set by a cliff seen while driving). */
    nearEdgeFront: boolean;
    nearEdgeRear: boolean;
    /** Raw downward sensors (true = ground); null before the first calibrated FED9 cliff frame. */
    cliff: { frontLeft: boolean; frontRight: boolean; rearLeft: boolean; rearRight: boolean } | null;
    /** An explicit driving command session (voice/bridge) is active. */
    drivingSession: boolean;
  };
  /** null while the local face camera is not running. */
  faces: RobotBodyFaceSample[] | null;
  sleeping: boolean;
  /** Someone is speaking, the model is processing or LOOI is speaking. */
  conversationBusy: boolean;
  displayScene: string | null;
};

export const ROBOT_BODY_SENSOR_TIMING = Object.freeze({
  /** A face must be seen this long before it counts as a person appearing. */
  appearConfirmMs: 500,
  /** A face must be missing this long, with the camera watching, before the person has left. */
  leaveAfterMs: 8_000,
  /** After a camera pause, a face seen again within this window is the same visit. */
  cameraGapContinuityMs: 60_000,
  /** Face count or bearing must be stable this long before it is written. */
  stableDetailMs: 1_000,
  /** lastSeenAt is refreshed at most this often while a face stays visible. Idle autonomy treats a sighting older than 2 s as stale, so this stays well below that. */
  lastSeenRefreshMs: 1_000,
  /** Raw edge readings while standing still must persist this long. */
  rawEdgeConfirmMs: 500,
  /** A disconnect must last this long before it is reported (BLE can flap). */
  disconnectConfirmMs: 3_000,
  /** Conversation mode is held this long after the last speech/processing signal. */
  conversationGraceMs: 20_000,
  /** Wheels moving longer than ambient/attention micro-pivots (<= 240 ms) count as commanded. */
  commandedMotionMinMs: 400,
  /** Two accepted strokes closer than this are one petting moment. */
  pettedMinIntervalMs: 1_500,
  /** lastHumanInteractionAt is written at most this often. */
  interactionRefreshMs: 1_000,
});

/** Activity modes written by idle autonomy (workstream C); this mapper leaves them alone. */
const IDLE_MODES: ReadonlySet<RobotActivityMode> = new Set(["looking_around", "seeking_person", "approaching", "attending"]);

/**
 * Bearing in the robot's steering frame. social-attention pivots "left" when
 * the face centre is below 0.5 - 0.20, so the same convention is used here.
 */
function rawBearing(centerX: number, previous: RobotBearing | null): RobotBearing {
  // Small hysteresis so a face near a boundary does not toggle.
  const enter = 0.2, exit = 0.14;
  const offset = centerX - 0.5;
  if (previous === "left" && offset < -exit) return "left";
  if (previous === "right" && offset > exit) return "right";
  if (offset < -enter) return "left";
  if (offset > enter) return "right";
  return "center";
}

/**
 * Face box width is the only distance cue the camera gives. The thresholds are
 * uncalibrated, so only clear cases are labelled (with a little hysteresis);
 * everything in between stays unknown.
 */
function distanceFromWidth(width: number, previous: "near" | "far" | "unknown"): "near" | "far" | "unknown" {
  if (width >= 0.3 || (previous === "near" && width >= 0.25)) return "near";
  if ((width > 0 && width <= 0.1) || (previous === "far" && width > 0 && width <= 0.13)) return "far";
  return "unknown";
}

export function createRobotBodySensorMapper(store: RobotBodyStateStore, timing = ROBOT_BODY_SENSOR_TIMING) {
  const source = "body-sensors";
  // A visit runs from person_appeared to person_left. A camera pause does not end it.
  let visitSince: number | null = null;
  let faceCandidateSince: number | null = null;
  let cameraOnSince: number | null = null;
  let lastRawFaceAt: number | null = null;
  let lastSeenAt: number | null = store.getState().people.lastSeenAt;
  let lastSeenWrittenAt = -Infinity;
  let stableCount = 0;
  let countCandidate: { value: number; since: number } | null = null;
  let bearing: RobotBearing = "center";
  let bearingCandidate: { value: RobotBearing; since: number } | null = null;
  let distance: "near" | "far" | "unknown" = "unknown";
  // Edges and connection.
  let rawEdgeCandidate: { side: "front" | "rear"; since: number } | null = null;
  let disconnectedSince: number | null = null;
  let reportedConnection: RobotBodyState["connection"] = store.getState().connection;
  // Motion and conversation.
  let motionSince: number | null = null;
  let lastConversationBusyAt: number | null = null;
  let lastPettedEventAt = -Infinity;
  let lastInteractionWrittenAt = -Infinity;

  function updateConnection(robot: RobotBodySensorSnapshot["robot"], now: number): RobotBodyState["connection"] {
    if (robot.connected) {
      disconnectedSince = null;
      if (reportedConnection !== "connected") store.publishEvent({ type: "connected", at: now });
      reportedConnection = "connected";
    } else if (reportedConnection === "connected") {
      disconnectedSince ??= now;
      if (now - disconnectedSince >= timing.disconnectConfirmMs) {
        reportedConnection = "disconnected";
        store.publishEvent({ type: "disconnected", at: now });
      }
    } else if (robot.configured) {
      // Not connected since start: a plain fact, not an event.
      reportedConnection = "disconnected";
    }
    return reportedConnection;
  }

  function updateSurface(robot: RobotBodySensorSnapshot["robot"], now: number): RobotBodyState["surface"] {
    if (!robot.connected) { rawEdgeCandidate = null; return "unknown"; }
    if (robot.nearEdgeFront) return "edge_front";
    if (robot.nearEdgeRear) return "edge_rear";
    const cliff = robot.cliff;
    if (!cliff) { rawEdgeCandidate = null; return "unknown"; }
    const frontOff = !cliff.frontLeft || !cliff.frontRight;
    const rearOff = !cliff.rearLeft || !cliff.rearRight;
    // Front and rear both off the ground is most likely being lifted, not an edge: say nothing.
    if (frontOff && rearOff) { rawEdgeCandidate = null; return "unknown"; }
    if (!frontOff && !rearOff) { rawEdgeCandidate = null; return "safe"; }
    const side = frontOff ? "front" : "rear";
    if (rawEdgeCandidate?.side !== side) rawEdgeCandidate = { side, since: now };
    if (now - rawEdgeCandidate.since >= timing.rawEdgeConfirmMs) return side === "front" ? "edge_front" : "edge_rear";
    return "unknown";
  }

  function updatePeople(faces: RobotBodyFaceSample[] | null, now: number): RobotBodyState["people"] {
    if (faces === null) {
      // The camera is not looking. Absence is not evidence, so no person_left;
      // a long pause closes the visit silently instead.
      cameraOnSince = null;
      faceCandidateSince = null;
      countCandidate = null;
      bearingCandidate = null;
      if (lastRawFaceAt !== null) lastSeenAt = lastRawFaceAt;
      if (visitSince !== null &&(lastRawFaceAt === null || now - lastRawFaceAt > timing.cameraGapContinuityMs)) visitSince = null;
      return { visible: null, attended: null, lastSeenAt };
    }
    cameraOnSince ??= now;

    if (faces.length > 0) {
      const target = faces.find((face) => face.selected) ?? largest(faces);
      lastRawFaceAt = now;
      if (now - lastSeenWrittenAt >= timing.lastSeenRefreshMs) { lastSeenAt = now; lastSeenWrittenAt = now; }
      distance = distanceFromWidth(target.width, distance);
      if (visitSince === null) {
        faceCandidateSince ??= now;
        if (now - faceCandidateSince >= timing.appearConfirmMs) {
          visitSince = now;
          bearing = rawBearing(target.centerX, null);
          stableCount = faces.length;
          countCandidate = null;
          bearingCandidate = null;
          store.publishEvent({ type: "person_appeared", at: now, bearing });
        }
      } else {
        stableCount = stabilise(faces.length, stableCount, countCandidate, (next) => { countCandidate = next; }, now);
        bearing = stabilise(rawBearing(target.centerX, bearing), bearing, bearingCandidate, (next) => { bearingCandidate = next; }, now);
      }
    } else {
      faceCandidateSince = null;
      if (lastRawFaceAt !== null) lastSeenAt = lastRawFaceAt;
      const absentSince = Math.max(lastRawFaceAt ?? -Infinity, cameraOnSince);
      if (visitSince !== null && now - absentSince >= timing.leaveAfterMs) {
        visitSince = null;
        distance = "unknown";
        store.publishEvent({ type: "person_left", at: now });
      }
    }

    if (visitSince === null) return { visible: 0, attended: null, lastSeenAt };
    return { visible: Math.max(1, stableCount), attended: { bearing, distance, since: visitSince }, lastSeenAt };
  }

  function stabilise<T>(raw: T, current: T, candidate: { value: T; since: number } | null, setCandidate: (next: { value: T; since: number } | null) => void, now: number): T {
    if (raw === current) { setCandidate(null); return current; }
    if (candidate?.value !== raw) { setCandidate({ value: raw, since: now }); return current; }
    if (now - candidate.since < timing.stableDetailMs) return current;
    setCandidate(null);
    return raw;
  }

  function updateActivity(snapshot: RobotBodySensorSnapshot, now: number): RobotBodyStatePatch["activity"] | undefined {
    const current = store.getState().activity;
    if (snapshot.conversationBusy) lastConversationBusyAt = now;
    const moving = snapshot.robot.connected && snapshot.robot.motionActive;
    if (moving) motionSince ??= now; else motionSince = null;

    let next: RobotActivityMode | null;
    if (snapshot.sleeping) {
      next = "sleeping";
      lastConversationBusyAt = null; // Falling asleep ends the conversation.
    }
    else if (moving && (current.mode === "commanded_motion" || (!IDLE_MODES.has(current.mode)
      && (snapshot.robot.drivingSession || now - (motionSince ?? now) >= timing.commandedMotionMinMs)))) next = "commanded_motion";
    else if (lastConversationBusyAt !== null && now - lastConversationBusyAt < timing.conversationGraceMs) next = "conversation";
    else next = IDLE_MODES.has(current.mode) ? null : "resting";

    if (next === null || next === current.mode) return undefined;
    if (current.mode === "sleeping") store.publishEvent({ type: "woke_up", at: now });
    if (next === "sleeping") store.publishEvent({ type: "fell_asleep", at: now });
    return { mode: next, since: now };
  }

  return {
    /** Feed one complete snapshot of all sources. Returns true when the body state changed. */
    sample(snapshot: RobotBodySensorSnapshot, now = store.now()): boolean {
      const previousSurface = store.getState().surface;
      const connection = updateConnection(snapshot.robot, now);
      const surface = updateSurface(snapshot.robot, now);
      const patch: RobotBodyStatePatch = {
        connection,
        surface,
        wheelsMoving: snapshot.robot.connected && snapshot.robot.motionActive,
        people: updatePeople(snapshot.faces, now),
        displayScene: snapshot.displayScene,
      };
      const activity = updateActivity(snapshot, now);
      if (activity) patch.activity = activity;
      const changed = store.update(patch, source);
      if ((surface === "edge_front" || surface === "edge_rear") && previousSurface !== surface) {
        store.publishEvent({ type: "edge_reached", at: now, side: surface === "edge_front" ? "front" : "rear" });
      }
      return changed;
    },
    /** A friendly stroke the face recogniser accepted. */
    notePetted(now = store.now()): void {
      lastInteractionWrittenAt = now;
      store.update({ touch: { lastPettedAt: now }, lastHumanInteractionAt: now }, source);
      if (now - lastPettedEventAt < timing.pettedMinIntervalMs) return;
      lastPettedEventAt = now;
      store.publishEvent({ type: "petted", at: now });
    },
    /** A human-originated interaction (screen touch, accepted speech turn, wake by face tap). */
    noteHumanInteraction(now = store.now()): void {
      if (now - lastInteractionWrittenAt < timing.interactionRefreshMs) return;
      lastInteractionWrittenAt = now;
      store.update({ lastHumanInteractionAt: now }, source);
    },
  };
}

function largest(faces: RobotBodyFaceSample[]): RobotBodyFaceSample {
  return faces.reduce((best, face) => face.width > best.width ? face : best, faces[0]);
}

export type RobotBodySensorMapper = ReturnType<typeof createRobotBodySensorMapper>;
