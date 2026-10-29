/**
 * Selects which runtime owns LOOI commands. `hardware` is the legacy default;
 * `mock` uses the in-memory SDK transport; `disconnected` prevents all
 * automatic reconnection.
 */
export type LooiConnectionMode = "hardware" | "mock" | "disconnected";

export type LooiConnectionDebugSource = "hardware" | "mock" | "none";

export function isLooiConnectionMode(value: unknown): value is LooiConnectionMode {
  return value === "hardware" || value === "mock" || value === "disconnected";
}
