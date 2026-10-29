import { IDENTITY_HEAD } from "./types";
import type { RobotCapabilities, RobotCommand, RobotPose } from "./types";

export const ROBOT_APP_ACTIONS = Object.freeze([
  Object.freeze({ id: "nod", category: "expression" as const }),
  Object.freeze({ id: "curious", category: "expression" as const }),
  Object.freeze({ id: "happy_bob", category: "expression" as const }),
  Object.freeze({ id: "sleepy", category: "expression" as const }),
  Object.freeze({ id: "thinking", category: "expression" as const }),
  Object.freeze({ id: "speaking_soft", category: "expression" as const }),
  Object.freeze({ id: "head_up", category: "head" as const }),
  Object.freeze({ id: "head_center", category: "head" as const }),
  Object.freeze({ id: "head_down", category: "head" as const }),
  Object.freeze({ id: "move_forward", category: "movement" as const }),
  Object.freeze({ id: "move_back", category: "movement" as const }),
  Object.freeze({ id: "turn_left", category: "movement" as const }),
  Object.freeze({ id: "turn_right", category: "movement" as const }),
  Object.freeze({ id: "light_on", category: "light" as const }),
  Object.freeze({ id: "light_off", category: "light" as const }),
]);

export type RobotAppActionId = typeof ROBOT_APP_ACTIONS[number]["id"];
export type RobotAppActionCategory = typeof ROBOT_APP_ACTIONS[number]["category"];
export type RobotAppActionMapping = { readonly source: string; readonly target: RobotAppActionId };
export type RobotAppActionProfile = { readonly schemaVersion: 1; readonly mappings: readonly RobotAppActionMapping[] };
export type ResolvedRobotAppAction = { command: RobotCommand; adapted: boolean };
type RobotAppActionDescriptor = typeof ROBOT_APP_ACTIONS[number];

export const EMPTY_ROBOT_APP_ACTION_PROFILE: RobotAppActionProfile = Object.freeze({
  schemaVersion: 1,
  mappings: Object.freeze([]),
});

const MAX_MAPPINGS = 64;
const MAX_ACTION_SOURCE_CODE_POINTS = 200;
const ACTION_SOURCE_CONTROLS = /[\u0000-\u001F\u007F-\u009F]/;
const RESERVED_ACTION_SOURCES = new Set(["__proto__"]);
const ACTION_BY_ID = new Map<string, RobotAppActionDescriptor>(ROBOT_APP_ACTIONS.map((action) => [action.id, action]));
const CANONICAL_IDS = new Set<string>(ROBOT_APP_ACTIONS.map((action) => action.id));
const HEAD_PITCH_RADIANS = 0.25;
const ACTION_DRIVE_MS = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && ownKeys.every((key) => typeof key === "string" && keys.includes(key));
}

function isRobotAppActionId(value: unknown): value is RobotAppActionId {
  return typeof value === "string" && ACTION_BY_ID.has(value);
}

/** Accept exact printable upstream action names; they are only literal map keys. */
export function isRobotAppActionSource(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value || RESERVED_ACTION_SOURCES.has(value)) return false;
  const codePoints = Array.from(value).length;
  return codePoints >= 1
    && codePoints <= MAX_ACTION_SOURCE_CODE_POINTS
    && !ACTION_SOURCE_CONTROLS.test(value);
}

/** Validate untrusted persisted profile data and return a detached canonical copy. */
export function normalizeRobotAppActionProfile(value: unknown): RobotAppActionProfile {
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "mappings"]) || value.schemaVersion !== 1) {
    throw new TypeError("Robot app action profile must contain only schemaVersion: 1 and a mappings array");
  }
  const inputMappings = value.mappings;
  if (!Array.isArray(inputMappings)) throw new TypeError("Robot app action profile mappings must be an array");
  if (inputMappings.length > MAX_MAPPINGS) throw new TypeError(`Robot app action profiles support at most ${MAX_MAPPINGS} mappings`);
  const mappingKeys = Reflect.ownKeys(inputMappings);
  if (mappingKeys.length !== inputMappings.length + 1
    || !mappingKeys.includes("length")
    || mappingKeys.some((key) => key !== "length" && (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= inputMappings.length))) {
    throw new TypeError("Robot app action mappings must be a dense array without extra properties");
  }

  const seen = new Set<string>();
  const mappings: RobotAppActionMapping[] = [];
  for (let index = 0; index < inputMappings.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(inputMappings, index)) {
      throw new TypeError("Robot app action mappings must not contain empty entries");
    }
    const entry = inputMappings[index];
    if (!isRecord(entry) || !hasExactKeys(entry, ["source", "target"])) {
      throw new TypeError(`Robot app action mapping ${index} must contain only source and target`);
    }
    const source = entry.source;
    const target = entry.target;
    if (!isRobotAppActionSource(source)) {
      throw new TypeError(`Robot app action mapping ${index} has an invalid source name`);
    }
    if (CANONICAL_IDS.has(source)) {
      throw new TypeError(`Robot app action source '${source}' is canonical and cannot be overridden`);
    }
    if (!isRobotAppActionId(target)) throw new TypeError(`Robot app action mapping ${index} has an invalid target`);
    if (seen.has(source)) throw new TypeError(`Robot app action source '${source}' is mapped more than once`);
    seen.add(source);
    mappings.push(Object.freeze({ source, target }));
  }

  return Object.freeze({ schemaVersion: 1, mappings: Object.freeze(mappings) });
}

function headPose(pitch: number): RobotPose {
  if (pitch === 0) return { head: [...IDENTITY_HEAD] };
  const cosine = Math.cos(pitch);
  const sine = Math.sin(pitch);
  return {
    // Row-major Ry(pitch); positive pitch points the LOOI head down.
    head: [cosine, 0, sine, 0, 0, 1, 0, 0, -sine, 0, cosine, 0, 0, 0, 0, 1],
  };
}

function canonicalCommand(id: RobotAppActionId, capabilities: RobotCapabilities): RobotCommand | null {
  const descriptor = ACTION_BY_ID.get(id)!;
  if (descriptor.category === "expression") {
    return capabilities.gestures.includes(id) ? { kind: "gesture", name: id } : null;
  }
  if (descriptor.category === "head") {
    if (capabilities.pose.head === "none") return null;
    const pitch = id === "head_up" ? -HEAD_PITCH_RADIANS : id === "head_down" ? HEAD_PITCH_RADIANS : 0;
    return { kind: "target", pose: headPose(pitch) };
  }
  if (descriptor.category === "movement") {
    if ((id === "move_forward" || id === "move_back") && !capabilities.locomotion.forward) return null;
    if ((id === "turn_left" || id === "turn_right") && !capabilities.locomotion.yaw) return null;
    return {
      kind: "drive",
      forward: id === "move_forward" ? 1 : id === "move_back" ? -1 : 0,
      lateral: 0,
      yawRate: id === "turn_left" ? 1 : id === "turn_right" ? -1 : 0,
      durationMs: ACTION_DRIVE_MS,
    };
  }
  if (!capabilities.light) return null;
  return { kind: "light", enabled: id === "light_on" };
}

/** Resolve only known app actions to commands this backend says it can support. */
export function resolveRobotAppAction(
  name: string,
  profile: RobotAppActionProfile,
  capabilities: RobotCapabilities,
): ResolvedRobotAppAction | null {
  const mapping = profile.mappings.find((entry) => entry.source === name);
  if (mapping) {
    const command = canonicalCommand(mapping.target, capabilities);
    return command ? { command, adapted: true } : null;
  }

  if (!isRobotAppActionId(name)) {
    // Preserve direct custom gestures from other backends that advertise them by name.
    return capabilities.gestures.includes(name)
      ? { command: { kind: "gesture", name }, adapted: false }
      : null;
  }
  const command = canonicalCommand(name, capabilities);
  return command ? { command, adapted: false } : null;
}

/** Stable menu entries: supported built-ins first, then configured aliases alphabetically. */
export function availableRobotAppActionNames(
  capabilities: RobotCapabilities,
  profile: RobotAppActionProfile,
): string[] {
  const names = ROBOT_APP_ACTIONS.flatMap(({ id }) => canonicalCommand(id, capabilities) ? [id] : []);
  const aliases = profile.mappings
    .filter(({ source }) => !!resolveRobotAppAction(source, profile, capabilities))
    .map(({ source }) => source)
    .sort();
  return [...names, ...aliases];
}
