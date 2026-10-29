import { companionLiveCases } from "./companion-live-cases.mjs";
import { createCompanionContinuityLiveCases } from "./companion-continuity-live-cases.mjs";
import { createCompanionPersonalityLiveCases } from "./companion-personality-live-cases.mjs";

export const availableCompanionLiveSuites = Object.freeze(["baseline", "continuity", "personality"]);

/** Resolve a named live-evaluation suite without doing any setup or I/O. */
export function getCompanionLiveSuite(name = "baseline") {
  if (name === "baseline") return { id: "baseline", cases: companionLiveCases };
  if (name === "continuity") return { id: "continuity", cases: createCompanionContinuityLiveCases() };
  if (name === "personality") return { id: "personality", cases: createCompanionPersonalityLiveCases() };
  throw new Error(`Unknown companion live suite "${String(name)}". Available suites: ${availableCompanionLiveSuites.join(", ")}.`);
}
