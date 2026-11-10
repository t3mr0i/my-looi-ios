import {
  ROBOT_CAPABILITY_TOOL_NAMES,
  ROBOT_GESTURES,
  ROBOT_MAX_NOD_COUNT,
  ROBOT_MAX_PHYSICAL_ACTIONS_PER_TURN,
  ROBOT_MOVE_ACTIONS,
  isRobotExpressionIntent,
  type RobotGesture,
  type RobotMoveAction,
} from "./robot-capability-tool-definitions";
import { isCharacterScene } from "../character/character-scene-catalog";
import { robotExpressionConductor, type RobotExpressionReply } from "../robot-mind/expression";
import type { RobotExpressionIntent } from "../robot-mind/body-state";
import { containsEmergencyStopWord } from "./explicit-robot-command";
import { useUserStore } from "../store/user";

export type RobotCapabilityTurn = {
  sessionId: string;
  userTurnRevision: number;
  /** Committed transcript of the user turn this response answers. */
  userText: string;
  isCurrent(): boolean;
  /** Turn-based voice cannot hear STOP while speaking; wheels stay parked there. */
  allowWheelMotion?: boolean;
};

export type RobotCapabilityRuntime = {
  isScene(scene: string): boolean;
  /** Queue a display scene for this voice session; false when the display is unavailable. */
  playScene(scene: string, sessionId: string): Promise<boolean>;
  nod(count: number): Promise<unknown>;
  dance(): Promise<unknown>;
  move(direction: "forward" | "backward"): Promise<unknown>;
  turn(direction: "left" | "right", degrees: 90 | 180): Promise<unknown>;
  stop(reason: string): Promise<void>;
  /** True when the user turn itself contains an emergency STOP word. */
  isStopRequest(text: string): boolean;
  /** Give the reply being spoken the model's expression; false when it no longer applies. */
  express(intent: RobotExpressionIntent, reply: RobotExpressionReply): boolean;
  /** An admitted gesture or movement owns the head for the rest of this reply. */
  notePhysicalAction(): void;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function stale(): Record<string, unknown> {
  return { ok: false, status: "stale-turn" };
}

/** Keep only small, known fields from a motion primitive's result. */
function motionOutcome(value: unknown): { completed: boolean; details: Record<string, unknown> } {
  if (!isPlainRecord(value)) return { completed: false, details: {} };
  const details: Record<string, unknown> = {};
  for (const key of ["durationMs", "degrees", "count", "style", "wheelsUsed", "safetyBounded"]) {
    const field = value[key];
    if (typeof field === "number" && Number.isFinite(field) || typeof field === "boolean" || typeof field === "string" && field.length <= 40) details[key] = field;
  }
  return { completed: value.ok === true && value.completed !== false, details };
}

const defaultRuntime: RobotCapabilityRuntime = {
  isScene: (scene) => isCharacterScene(scene),
  async playScene(scene, sessionId) {
    const runtime = await import("../character/character-action-runtime");
    return runtime.requestCharacterSceneFromAssistant(scene as Parameters<typeof runtime.requestCharacterSceneFromAssistant>[0], sessionId) !== null;
  },
  async nod(count) {
    return (await import("../device-tools/looi-robot")).performLooiHeadGesture("nod", count);
  },
  async dance() {
    return (await import("../device-tools/looi-robot")).performLooiDance("random");
  },
  async move(direction) {
    return (await import("../device-tools/looi-robot")).moveLooi(direction);
  },
  async turn(direction, degrees) {
    return (await import("../device-tools/looi-robot")).turnLooi(direction, degrees);
  },
  async stop(reason) {
    await (await import("../device-tools/looi-robot")).stopLooiMotion(reason);
  },
  isStopRequest(text) {
    const preferences = useUserStore.getState().preferences;
    return containsEmergencyStopWord(text, {
      robotName: preferences.robotName,
      robotAddressAliases: preferences.robotAddressAliases,
      robotAddressRecognitionAliases: preferences.robotAddressRecognitionAliases,
      listeningLanguage: preferences.listeningLanguage,
      customVoiceCommands: preferences.customVoiceCommands,
    });
  },
  express: (intent, reply) => robotExpressionConductor.expressFromModel(intent, reply),
  notePhysicalAction: () => robotExpressionConductor.notePhysicalAction(),
};

/**
 * One shared executor for the model's action tools, used by both Realtime
 * transports and the turn-based voice path. Every physical call is bound to the
 * current user turn, uses only bounded motion primitives, runs one at a time,
 * and yields to STOP.
 */
export function createRobotCapabilityToolBridge(runtime: RobotCapabilityRuntime = defaultRuntime) {
  let turnKey = "";
  let physicalActions = 0;
  let stopped = false;
  let queue: Promise<unknown> = Promise.resolve();

  const enterTurn = (turn: RobotCapabilityTurn) => {
    const key = `${turn.sessionId}:${turn.userTurnRevision}`;
    if (key !== turnKey) { turnKey = key; physicalActions = 0; stopped = false; }
  };
  /** Serialize motion so two tool calls of one response never overlap on the motors. */
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };
  const physical = async (
    turn: RobotCapabilityTurn,
    wheels: boolean,
    action: string,
    work: () => Promise<unknown>,
  ): Promise<Record<string, unknown>> => {
    if (!turn.userText.trim()) return { ok: false, status: "refused", reason: "no_current_user_request", action };
    if (wheels && turn.allowWheelMotion === false) return { ok: false, status: "requires_realtime", reason: "spoken_stop_unavailable", action };
    if (stopped || runtime.isStopRequest(turn.userText)) return { ok: false, status: "refused", reason: "stop_requested", action };
    if (physicalActions >= ROBOT_MAX_PHYSICAL_ACTIONS_PER_TURN) return { ok: false, status: "refused", reason: "too_many_actions_this_turn", action };
    physicalActions += 1;
    runtime.notePhysicalAction();
    return serialized(async () => {
      if (!turn.isCurrent()) return stale();
      if (stopped) return { ok: false, status: "refused", reason: "stop_requested", action };
      try {
        const outcome = motionOutcome(await work());
        if (!turn.isCurrent()) return stale();
        return outcome.completed
          ? { ok: true, status: "completed", action, ...outcome.details }
          : { ok: false, status: "blocked", reason: "interrupted_or_safety_interlock", action, ...outcome.details };
      } catch {
        return turn.isCurrent()
          ? { ok: false, status: "failed", reason: "robot_unavailable_or_safety_interlock", action }
          : stale();
      }
    });
  };

  return {
    /**
     * The model's expression for the reply it is speaking. Synchronous and not
     * bound to a user turn: it is acknowledged without a follow-up response and
     * also serves proactive replies. Wheels are never involved.
     */
    express(rawArgs: unknown, reply: RobotExpressionReply): Record<string, unknown> {
      let current = false;
      try { current = reply.isCurrent(); } catch { current = false; }
      if (!current) return stale();
      if (!isPlainRecord(rawArgs) || !hasOnlyKeys(rawArgs, ["intent"]) || !isRobotExpressionIntent(rawArgs.intent)) {
        return { ok: false, status: "invalid-arguments" };
      }
      try {
        return runtime.express(rawArgs.intent, reply)
          ? { ok: true, status: "expressed", intent: rawArgs.intent }
          : stale();
      } catch {
        return { ok: false, status: "unavailable", intent: rawArgs.intent };
      }
    },

    async execute(name: string, rawArgs: unknown, turn: RobotCapabilityTurn): Promise<Record<string, unknown>> {
      if (!turn.isCurrent()) return stale();
      if (!ROBOT_CAPABILITY_TOOL_NAMES.has(name)) return { ok: false, status: "unsupported-tool" };
      if (!isPlainRecord(rawArgs)) return { ok: false, status: "invalid-arguments" };
      const args = rawArgs;
      enterTurn(turn);

      if (name === "stop_robot") {
        if (Object.keys(args).length !== 0) return { ok: false, status: "invalid-arguments" };
        // STOP is never queued behind a running movement and never counted.
        stopped = true;
        try { await runtime.stop("assistant-tool-stop"); }
        catch { return { ok: false, status: "failed", reason: "robot_unavailable", action: "stop" }; }
        return { ok: true, status: "stopped", action: "stop" };
      }

      if (name === "play_scene") {
        if (!hasOnlyKeys(args, ["scene"]) || typeof args.scene !== "string" || !runtime.isScene(args.scene)) {
          return { ok: false, status: "invalid-arguments" };
        }
        try {
          const queued = await runtime.playScene(args.scene, turn.sessionId);
          if (!turn.isCurrent()) return stale();
          return queued
            ? { ok: true, status: "scene_queued", scene: args.scene, kind: "display_animation", starts: "after_reply" }
            : { ok: false, status: "unavailable", reason: "display_busy_or_hidden", scene: args.scene };
        } catch {
          return { ok: false, status: "unavailable", reason: "display_busy_or_hidden", scene: args.scene };
        }
      }

      if (name === "perform_gesture") {
        if (!hasOnlyKeys(args, ["gesture", "count"]) || !ROBOT_GESTURES.includes(args.gesture as RobotGesture)) {
          return { ok: false, status: "invalid-arguments" };
        }
        const rawCount = args.count;
        if (rawCount !== undefined && rawCount !== null
          && (typeof rawCount !== "number" || !Number.isInteger(rawCount) || rawCount < 1 || rawCount > ROBOT_MAX_NOD_COUNT)) {
          return { ok: false, status: "invalid-arguments" };
        }
        if (args.gesture === "dance") return physical(turn, true, "dance", () => runtime.dance());
        const count = typeof rawCount === "number" ? rawCount : 1;
        return physical(turn, false, "nod", () => runtime.nod(count));
      }

      if (!hasOnlyKeys(args, ["action"]) || !ROBOT_MOVE_ACTIONS.includes(args.action as RobotMoveAction)) {
        return { ok: false, status: "invalid-arguments" };
      }
      const action = args.action as RobotMoveAction;
      return physical(turn, true, action, () => action === "forward" || action === "backward"
        ? runtime.move(action)
        : action === "turn_around" ? runtime.turn("right", 180)
          : runtime.turn(action === "turn_left" ? "left" : "right", 90));
    },
  };
}

export const robotCapabilityToolBridge = createRobotCapabilityToolBridge();
