/**
 * When does a body event deserve words? Pure decision for LOOI's
 * self-initiated speech: no React Native, store, network or timer import.
 * Times are epoch milliseconds from the caller's clock.
 *
 * The goal is a pleasant companion, not a chatty one: every occasion has its
 * own cooldown, all self-initiated lines share a minimum gap and an hourly cap,
 * and LOOI stays silent while asleep, while a person or the model is talking,
 * during a local game and for a while after the person asked for quiet.
 */
import type { RobotBodyEvent, RobotBodyState } from "./body-state";

export type ProactiveSpeechLevel = "off" | "reactions" | "lively";
export const PROACTIVE_SPEECH_LEVELS: readonly ProactiveSpeechLevel[] = ["off", "reactions", "lively"];
/** Event reactions only, bounded by the caps below; see the workstream report for the cost reasoning. */
export const DEFAULT_PROACTIVE_SPEECH_LEVEL: ProactiveSpeechLevel = "reactions";

export function normalizeProactiveSpeechLevel(value: unknown): ProactiveSpeechLevel {
  return value === "off" || value === "reactions" || value === "lively" ? value : DEFAULT_PROACTIVE_SPEECH_LEVEL;
}

export type ProactiveOccasion =
  | "greet_arrival"
  | "welcome_back_after_quiet"
  | "react_petting"
  | "warn_edge"
  | "gave_up_search"
  | "arrived";

export const PROACTIVE_OCCASIONS: readonly ProactiveOccasion[] = [
  "greet_arrival", "welcome_back_after_quiet", "react_petting", "warn_edge", "gave_up_search", "arrived",
];

export function isProactiveOccasion(value: unknown): value is ProactiveOccasion {
  return typeof value === "string" && (PROACTIVE_OCCASIONS as readonly string[]).includes(value);
}

/** "reactions": things done to or near the robot. "lively": also remarks from its own idle behaviour. */
export const PROACTIVE_OCCASION_LEVEL: Record<ProactiveOccasion, Exclude<ProactiveSpeechLevel, "off">> = {
  greet_arrival: "reactions",
  welcome_back_after_quiet: "reactions",
  react_petting: "reactions",
  warn_edge: "reactions",
  gave_up_search: "lively",
  arrived: "lively",
};

const MINUTE = 60_000;
export const PROACTIVE_OCCASION_COOLDOWN_MS: Record<ProactiveOccasion, number> = {
  greet_arrival: 10 * MINUTE,
  welcome_back_after_quiet: 30 * MINUTE,
  react_petting: 3 * MINUTE,
  warn_edge: 2 * MINUTE,
  gave_up_search: 20 * MINUTE,
  arrived: 10 * MINUTE,
};
/** Minimum time between any two self-initiated lines (the edge warning is exempt). */
export const PROACTIVE_GLOBAL_MIN_GAP_MS = 2 * MINUTE;
/** Rolling one-hour cap on self-initiated lines; this also bounds the cost per hour. */
export const PROACTIVE_MAX_PER_HOUR: Record<Exclude<ProactiveSpeechLevel, "off">, number> = { reactions: 4, lively: 8 };
const HOUR = 60 * MINUTE;
/** Face detection flickers: a person who returns within this window is still on the same visit. */
export const PROACTIVE_VISIT_GAP_MS = 3 * MINUTE;
/** A person appearing after this long without anyone around is welcomed back rather than greeted. */
export const PROACTIVE_WELCOME_BACK_AFTER_MS = 45 * MINUTE;
/** Silence after the person asked LOOI to be quiet or calmer. */
export const PROACTIVE_QUIET_REQUEST_MS = 20 * MINUTE;
/** After anyone spoke in a conversation, leave room for the next turn before talking unprompted. */
export const PROACTIVE_CONVERSATION_SETTLE_MS = 8_000;
/** An event delivered later than this no longer describes the present moment. */
export const PROACTIVE_EVENT_MAX_AGE_MS = 5_000;
/** Ignore lastHumanInteractionAt values that the appearance event itself may have set. */
const SAME_MOMENT_MS = 1_000;

export interface ProactiveVisit {
  startedAt: number;
  greeted: boolean;
  leftAt: number | null;
  /** When the previous visit ended, if known. */
  quietSince: number | null;
}

export interface ProactiveSpeechMemory {
  /** Self-initiated lines of the last hour, oldest first. */
  spoken: ReadonlyArray<{ occasion: ProactiveOccasion; at: number }>;
  visit: ProactiveVisit | null;
  quietUntil: number;
}

export function createProactiveSpeechMemory(): ProactiveSpeechMemory {
  return { spoken: [], visit: null, quietUntil: 0 };
}

/** What the rest of the app is doing right now; gathered by the runtime. */
export interface ProactiveSpeechEnvironment {
  foreground: boolean;
  mainScreenFocused: boolean;
  robotSleeping: boolean;
  mediaExternallyOwned: boolean;
  gameActive: boolean;
  /** The person is speaking (VAD) in an active conversation. */
  userSpeaking: boolean;
  /** The model is thinking, answering, or its audio is still playing; or another line is being delivered. */
  assistantBusy: boolean;
  /** Last moment either side spoke in a conversation, or null. */
  lastConversationSpeechAt: number | null;
}

export type ProactiveSilenceReason =
  | "not_an_occasion"
  | "setting_off"
  | "setting_level"
  | "stale_event"
  | "sleeping"
  | "app_not_attending"
  | "game_active"
  | "person_speaking"
  | "assistant_busy"
  | "conversation_settling"
  | "quiet_requested"
  | "already_greeted_this_visit"
  | "occasion_cooldown"
  | "global_gap"
  | "hourly_cap";

export type ProactiveSpeechDecision =
  | { speak: true; occasion: ProactiveOccasion; detail: ProactiveOccasionDetail }
  | { speak: false; reason: ProactiveSilenceReason; occasion: ProactiveOccasion | null };

export type ProactiveOccasionDetail = { edgeSide?: "front" | "rear" };

export interface ProactiveSpeechInput {
  event: RobotBodyEvent;
  body: RobotBodyState;
  now: number;
  level: ProactiveSpeechLevel;
  /** Memory after noteProactiveBodyEvent(event) was applied. */
  memory: ProactiveSpeechMemory;
  environment: ProactiveSpeechEnvironment;
}

const GREETINGS: ReadonlySet<ProactiveOccasion> = new Set(["greet_arrival", "welcome_back_after_quiet", "arrived"]);

/** The occasion a body event would be, independent of whether LOOI may speak now. */
export function proactiveOccasionFor(event: RobotBodyEvent, body: RobotBodyState, memory: ProactiveSpeechMemory): ProactiveOccasion | null {
  switch (event.type) {
    case "person_appeared": {
      const interaction = body.lastHumanInteractionAt !== null && body.lastHumanInteractionAt < event.at - SAME_MOMENT_MS
        ? body.lastHumanInteractionAt : null;
      const candidates = [memory.visit?.quietSince ?? null, interaction].filter((value): value is number => value !== null);
      const quietSince = candidates.length ? Math.max(...candidates) : null;
      return quietSince !== null && event.at - quietSince >= PROACTIVE_WELCOME_BACK_AFTER_MS
        ? "welcome_back_after_quiet" : "greet_arrival";
    }
    case "petted": return "react_petting";
    case "edge_reached": return "warn_edge";
    case "search_gave_up": return "gave_up_search";
    case "arrived_at_person": return "arrived";
    default: return null;
  }
}

export function decideProactiveSpeech(input: ProactiveSpeechInput): ProactiveSpeechDecision {
  const { event, body, now, level, memory, environment: env } = input;
  const occasion = proactiveOccasionFor(event, body, memory);
  const silent = (reason: ProactiveSilenceReason): ProactiveSpeechDecision => ({ speak: false, reason, occasion });
  if (!occasion) return silent("not_an_occasion");
  if (level === "off") return silent("setting_off");
  if (PROACTIVE_OCCASION_LEVEL[occasion] === "lively" && level !== "lively") return silent("setting_level");
  if (now - event.at > PROACTIVE_EVENT_MAX_AGE_MS) return silent("stale_event");
  if (env.robotSleeping || body.activity.mode === "sleeping") return silent("sleeping");
  if (!env.foreground || !env.mainScreenFocused || env.mediaExternallyOwned) return silent("app_not_attending");
  if (env.gameActive) return silent("game_active");
  if (env.userSpeaking) return silent("person_speaking");
  if (env.assistantBusy) return silent("assistant_busy");
  if (env.lastConversationSpeechAt !== null && now - env.lastConversationSpeechAt < PROACTIVE_CONVERSATION_SETTLE_MS) {
    return silent("conversation_settling");
  }
  if (memory.quietUntil > now) return silent("quiet_requested");
  if (GREETINGS.has(occasion) && memory.visit?.greeted) return silent("already_greeted_this_visit");
  const recent = memory.spoken.filter((item) => now - item.at < HOUR);
  const lastSame = recent.filter((item) => item.occasion === occasion).at(-1);
  if (lastSame && now - lastSame.at < PROACTIVE_OCCASION_COOLDOWN_MS[occasion]) return silent("occasion_cooldown");
  const last = recent.at(-1);
  if (occasion !== "warn_edge" && last && now - last.at < PROACTIVE_GLOBAL_MIN_GAP_MS) return silent("global_gap");
  if (recent.length >= PROACTIVE_MAX_PER_HOUR[level]) return silent("hourly_cap");
  const detail: ProactiveOccasionDetail = event.type === "edge_reached" ? { edgeSide: event.side } : {};
  return { speak: true, occasion, detail };
}

/** Track visits from every body event, whether or not LOOI speaks about it. */
export function noteProactiveBodyEvent(
  memory: ProactiveSpeechMemory,
  event: RobotBodyEvent,
  context: { conversationActive: boolean },
): ProactiveSpeechMemory {
  const pruned = memory.spoken.filter((item) => event.at - item.at < HOUR);
  const base = pruned.length === memory.spoken.length ? memory : { ...memory, spoken: pruned };
  const visit = base.visit;
  const continues = visit !== null && (visit.leftAt === null || event.at - visit.leftAt < PROACTIVE_VISIT_GAP_MS);
  // Someone already talking with LOOI needs no greeting when their face shows up.
  const startVisit = (): ProactiveVisit => ({
    startedAt: event.at, greeted: context.conversationActive, leftAt: null, quietSince: visit?.leftAt ?? visit?.quietSince ?? null,
  });
  switch (event.type) {
    case "person_appeared":
    case "arrived_at_person":
      if (continues) return visit!.leftAt === null ? base : { ...base, visit: { ...visit!, leftAt: null } };
      return { ...base, visit: startVisit() };
    case "person_left":
      return visit && visit.leftAt === null ? { ...base, visit: { ...visit, leftAt: event.at } } : base;
    default:
      return base;
  }
}

export function recordProactiveUtterance(memory: ProactiveSpeechMemory, occasion: ProactiveOccasion, at: number): ProactiveSpeechMemory {
  const spoken = [...memory.spoken.filter((item) => at - item.at < HOUR), { occasion, at }];
  const visit = GREETINGS.has(occasion) && memory.visit ? { ...memory.visit, greeted: true } : memory.visit;
  return { ...memory, spoken, visit };
}

export function requestProactiveQuiet(memory: ProactiveSpeechMemory, now: number, durationMs = PROACTIVE_QUIET_REQUEST_MS): ProactiveSpeechMemory {
  return { ...memory, quietUntil: Math.max(memory.quietUntil, now + durationMs) };
}

/**
 * Short, complete requests for silence that the shared behaviour text parser
 * does not already cover ("be quiet"/"sei ruhiger" are handled there as "calmer").
 * Quoted text and longer sentences do not count.
 */
export function isExplicitQuietRequest(text: string): boolean {
  const clean = text.normalize("NFKC").toLowerCase()
    .replace(/"[^"\n]*"|“[^”\n]*”|„[^“\n]*“|«[^»\n]*»/gu, " ")
    .replace(/[.!…,]+/gu, " ").replace(/\s+/gu, " ").trim();
  if (!clean || clean.length > 60) return false;
  return /^(?:(?:please |bitte )?(?:shh+|psst|pst|quiet please|be quiet|be silent|stop talking|hush|sei (?:mal )?(?:still|leise|ruhig)|ruhe(?: bitte)?|halt (?:mal )?die klappe|не болтай|помолчи|тише|тихо|замолчи|помовч|тихіше|тихо будь|мовчи)(?: please| bitte| пожалуйста| будь ласка)?)$/u.test(clean);
}
