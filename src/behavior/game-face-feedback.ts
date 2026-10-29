export type BehaviorMomentPhase = "settled" | "attending" | "reflecting" | "speaking" | "reacting";
export type GameFaceStatus = "active" | "paused" | "won" | "stopped" | "expired";
export type GameFaceOutcome = "waiting" | "too_low" | "too_high" | "correct" | "stopped";

/** A deliberately public-only view of the local guessing game. */
export type GameFaceFeedbackGame = Readonly<{
  round: number;
  status: GameFaceStatus;
  lastOutcome: GameFaceOutcome;
}>;

export type GameFaceFeedbackInput = Readonly<{
  sessionId: string | null;
  generation: number;
  turnId: number;
  phase: BehaviorMomentPhase;
  phaseAt: number;
  game: GameFaceFeedbackGame | null;
}>;

export type GameFaceFeedback = Readonly<{
  id: string;
  kind: "game";
  mood: "expectant" | "victory";
  generation: number;
  expiresAt: number;
}>;

export interface GameFaceFeedbackTracker {
  /** Emits a one-shot face cue only at an observed, heard assistant-end edge. */
  observe(input: GameFaceFeedbackInput, now: number): GameFaceFeedback | null;
  /** Clears the in-flight phase baseline without reopening an issued win. */
  reset(): void;
}

const EXPECTANT_LIFETIME_MS = 15_000;
const VICTORY_LIFETIME_MS = 1_100;
const MOMENT_PHASES = new Set<BehaviorMomentPhase>(["settled", "attending", "reflecting", "speaking", "reacting"]);
const GAME_STATUSES = new Set<GameFaceStatus>(["active", "paused", "won", "stopped", "expired"]);
const GAME_OUTCOMES = new Set<GameFaceOutcome>(["waiting", "too_low", "too_high", "correct", "stopped"]);

type Snapshot = {
  sessionId: string;
  generation: number;
  turnId: number;
  phase: BehaviorMomentPhase;
  phaseAt: number;
  game: GameFaceFeedbackGame | null;
};

function copySnapshot(input: GameFaceFeedbackInput): Snapshot | null {
  if (
    typeof input !== "object" || input === null
    || typeof input.sessionId !== "string" || input.sessionId.length === 0
    || !Number.isSafeInteger(input.generation) || input.generation < 0
    || !Number.isSafeInteger(input.turnId) || input.turnId < 0
    || !MOMENT_PHASES.has(input.phase)
    || !Number.isFinite(input.phaseAt)
  ) return null;

  let copiedGame: GameFaceFeedbackGame | null = null;
  if (input.game !== null) {
    if (
      typeof input.game !== "object"
      || !Number.isSafeInteger(input.game.round) || input.game.round < 1
      || !GAME_STATUSES.has(input.game.status)
      || !GAME_OUTCOMES.has(input.game.lastOutcome)
    ) return null;
    // Copy just the public result fields. In particular, never retain the
    // mutable game object, secret number, attempt count, or unrelated state.
    copiedGame = {
      round: input.game.round,
      status: input.game.status,
      lastOutcome: input.game.lastOutcome,
    };
  }

  return {
    sessionId: input.sessionId,
    generation: input.generation,
    turnId: input.turnId,
    phase: input.phase,
    phaseAt: input.phaseAt,
    game: copiedGame,
  };
}

export function createGameFaceFeedbackTracker(): GameFaceFeedbackTracker {
  let previous: Snapshot | null = null;
  let currentSessionId: string | null = null;
  let highestVictoryRound = 0;
  let winningRound: number | null = null;
  let winningTurnId: number | null = null;
  let feedbackSequence = 0;

  function clearSession(): void {
    previous = null;
    currentSessionId = null;
    highestVictoryRound = 0;
    winningRound = null;
    winningTurnId = null;
  }

  function clearGameScope(): void {
    highestVictoryRound = 0;
    winningRound = null;
    winningTurnId = null;
  }

  function rememberWin(snapshot: Snapshot, before: Snapshot | null = null): void {
    const result = snapshot.game;
    if (!result || result.status !== "won" || result.lastOutcome !== "correct") return;
    if (winningRound === result.round) return;
    // The first turn that observes this local result owns its single victory
    // expression. A later turn cannot revive the old game result after an
    // interruption or runtime reset.
    if (winningRound === null || result.round > winningRound) {
      winningRound = result.round;
      const resultAppearedWithoutANewTurn = before !== null
        && before.game?.round === result.round
        && before.game.status !== "won"
        && before.turnId === snapshot.turnId;
      winningTurnId = resultAppearedWithoutANewTurn ? null : snapshot.turnId;
    }
  }

  function createFeedback(snapshot: Snapshot, now: number, mood: GameFaceFeedback["mood"]): GameFaceFeedback | null {
    const lifetime = mood === "victory" ? VICTORY_LIFETIME_MS : EXPECTANT_LIFETIME_MS;
    const phaseDeadline = snapshot.phaseAt + lifetime;
    const requestDeadline = now + lifetime;
    const expiresAt = Math.min(phaseDeadline, requestDeadline);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
    return {
      id: `game-face-${++feedbackSequence}`,
      kind: "game",
      mood,
      generation: snapshot.generation,
      expiresAt,
    };
  }

  return {
    observe(input, now) {
      if (!Number.isFinite(now)) return null;
      if (input?.sessionId === null) {
        clearSession();
        return null;
      }

      const next = copySnapshot(input);
      if (next === null) {
        previous = null;
        return null;
      }
      if (currentSessionId !== next.sessionId) {
        currentSessionId = next.sessionId;
        clearGameScope();
        previous = next;
        if (next.game === null) clearGameScope();
        else rememberWin(next);
        return null;
      }

      const before = previous;
      if (before === null) {
        previous = next;
        if (next.game === null) clearGameScope();
        else rememberWin(next);
        return null;
      }
      // State snapshots can race React renders. Ignore backwards copies without
      // replacing the newer baseline they will eventually catch up to.
      if (next.generation < before.generation || next.turnId < before.turnId || next.phaseAt < before.phaseAt) return null;
      previous = next;
      if (next.game === null) clearGameScope();
      else rememberWin(next, before);

      if (
        before.sessionId !== next.sessionId
        || before.turnId !== next.turnId
        || before.game === null
        || next.game === null
        || before.game.round !== next.game.round
        || before.phase !== "speaking"
        || next.phase !== "reacting"
      ) return null;

      if (next.game.status === "won" && next.game.lastOutcome === "correct") {
        if (before.game.status !== "won" || before.game.lastOutcome !== "correct") return null;
        if (winningRound !== next.game.round || winningTurnId !== next.turnId) return null;
        if (next.game.round <= highestVictoryRound) return null;
        // Record the round even when a delayed observation has already missed
        // its brief display window; a later poll must never replay it.
        highestVictoryRound = next.game.round;
        return createFeedback(next, now, "victory");
      }

      if (before.game.status === "active" && next.game.status === "active") {
        return createFeedback(next, now, "expectant");
      }
      return null;
    },

    reset() {
      // An interrupted result is spent even if its celebration had not begun.
      // A later same-turn answer must not revive it after STOP or sleep.
      if (winningRound !== null) highestVictoryRound = Math.max(highestVictoryRound, winningRound);
      previous = null;
    },
  };
}
