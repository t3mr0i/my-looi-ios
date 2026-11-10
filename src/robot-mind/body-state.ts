/**
 * LOOI's body state: one small, device-local picture of what the robot senses
 * and does right now. Sensors and controllers write here; the conversational
 * model, proactive speech and idle autonomy read from here. This is the seam
 * that connects "what LOOI says" with "what LOOI's body experiences".
 *
 * Pure module: no React Native, BLE, camera or network import. Times are
 * epoch milliseconds from the injected clock.
 */
export type RobotBearing = "left" | "center" | "right";
export type RobotActivityMode =
  | "sleeping" | "resting" | "looking_around" | "seeking_person"
  | "approaching" | "attending" | "conversation" | "commanded_motion";
export type RobotExpressionIntent =
  | "neutral" | "curious" | "happy" | "thinking" | "surprised" | "sad" | "playful" | "calm";

export interface RobotBodyState {
  connection: "connected" | "disconnected" | "unknown";
  /** Surface under the wheels as reported by the edge sensors. */
  surface: "safe" | "edge_front" | "edge_rear" | "unknown";
  wheelsMoving: boolean;
  people: {
    /** Faces currently visible to the camera; null when the camera is not looking. */
    visible: number | null;
    /** The face LOOI is turned to, if any. Never an identity. */
    attended: { bearing: RobotBearing; distance: "near" | "far" | "unknown"; since: number } | null;
    lastSeenAt: number | null;
  };
  touch: { lastPettedAt: number | null };
  activity: { mode: RobotActivityMode; since: number };
  /** Scene currently playing on the face display, by catalog id. */
  displayScene: string | null;
  expression: { intent: RobotExpressionIntent; since: number };
  lastHumanInteractionAt: number | null;
}

/** Discrete moments worth reacting to. Additive: new types may be appended. */
export type RobotBodyEvent =
  | { type: "person_appeared"; at: number; bearing: RobotBearing }
  | { type: "person_left"; at: number }
  | { type: "petted"; at: number }
  | { type: "edge_reached"; at: number; side: "front" | "rear" }
  | { type: "connected"; at: number }
  | { type: "disconnected"; at: number }
  | { type: "woke_up"; at: number }
  | { type: "fell_asleep"; at: number }
  | { type: "search_gave_up"; at: number }
  | { type: "arrived_at_person"; at: number };

export type RobotBodyStatePatch = {
  [K in keyof RobotBodyState]?: RobotBodyState[K] extends object | null
    ? RobotBodyState[K] extends null ? RobotBodyState[K] : Partial<NonNullable<RobotBodyState[K]>> | RobotBodyState[K]
    : RobotBodyState[K];
};

export function createInitialRobotBodyState(now: number): RobotBodyState {
  return {
    connection: "unknown",
    surface: "unknown",
    wheelsMoving: false,
    people: { visible: null, attended: null, lastSeenAt: null },
    touch: { lastPettedAt: null },
    activity: { mode: "resting", since: now },
    displayScene: null,
    expression: { intent: "neutral", since: now },
    lastHumanInteractionAt: null,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** A store instance; production uses the shared one below, tests create their own. */
export function createRobotBodyStateStore(now: () => number = Date.now) {
  let state = createInitialRobotBodyState(now());
  let revision = 0;
  const stateListeners = new Set<(state: RobotBodyState, source: string) => void>();
  const eventListeners = new Set<(event: RobotBodyEvent) => void>();
  const notify = <T extends unknown[]>(listeners: Set<(...args: T) => void>, ...args: T) => {
    for (const listener of [...listeners]) {
      try { listener(...args); } catch (error) { console.warn("[BodyState] listener failed", error); }
    }
  };
  return {
    now,
    getState: (): RobotBodyState => state,
    /** Increases only when a patch changed something. */
    getRevision: () => revision,
    /** Shallow-merge top-level keys; nested objects merge one level. Unchanged patches notify nobody. */
    update(patch: RobotBodyStatePatch, source: string): boolean {
      let changed = false;
      const next: Record<string, unknown> = { ...state };
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        const current = (state as unknown as Record<string, unknown>)[key];
        const merged = isRecord(value) && isRecord(current) ? { ...current, ...value } : value;
        if (JSON.stringify(merged) !== JSON.stringify(current)) { next[key] = merged; changed = true; }
      }
      if (!changed) return false;
      state = next as unknown as RobotBodyState;
      revision += 1;
      notify(stateListeners, state, source);
      return true;
    },
    publishEvent(event: RobotBodyEvent): void { notify(eventListeners, event); },
    subscribeState(listener: (state: RobotBodyState, source: string) => void): () => void {
      stateListeners.add(listener); return () => { stateListeners.delete(listener); };
    },
    subscribeEvents(listener: (event: RobotBodyEvent) => void): () => void {
      eventListeners.add(listener); return () => { eventListeners.delete(listener); };
    },
    reset(): void { state = createInitialRobotBodyState(now()); revision += 1; notify(stateListeners, state, "reset"); },
  };
}

export type RobotBodyStateStore = ReturnType<typeof createRobotBodyStateStore>;
/** The one body state of this app process. */
export const robotBodyState: RobotBodyStateStore = createRobotBodyStateStore();
