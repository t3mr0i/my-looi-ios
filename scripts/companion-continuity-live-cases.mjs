// Synthetic, local-only fixtures for continuity checks in the separate live
// text evaluator. Setup uses the public behavior event/action bridge. Nothing
// in this module opens a socket, reads credentials, or contacts a service.

const GERDA = {
  title: "Gerda",
  evidence: "Wir haben Gerda zusammen gebaut: eine Papierrakete mit silbernen Flügeln.",
  detail: "Wir bauten Gerda gemeinsam als Papierrakete und klebten silberne Flügel an.",
  outcome: "Beim ersten Wurf flog sie über den Garten und landete sicher neben dem Zaun.",
  motif: "hold",
};

const GERDA_CORRECTION = "Korrektur zu Gerda: Sie landete neben dem Baum.";
const GERDA_REPLACEMENT = "Sie landete neben dem Baum.";

async function seedConfirmedEpisode({ publishEvent, performAction, engine }, episode) {
  publishEvent({ type: "user-turn", text: episode.evidence });
  const proposal = performAction({
    type: "propose_experience",
    title: episode.title,
    detail: episode.detail,
    outcome: episode.outcome,
    motif: episode.motif ?? "hold",
    evidence: episode.evidence,
  });
  if (!proposal?.ok || proposal.status !== "proposed") {
    throw new Error(`Synthetic ${episode.title} episode proposal failed: ${proposal?.status ?? "no result"}`);
  }

  // This is deliberately an injected text fixture. The evaluator must never
  // present it as heard output or model-quality evidence.
  publishEvent({ type: "assistant-end", text: `Soll ich ${episode.title} speichern?` });
  publishEvent({ type: "user-turn", text: "Ja." });

  const saved = engine?.getState?.()?.companion?.episodes?.find((item) => item.title === episode.title);
  if (!saved) throw new Error(`Synthetic ${episode.title} episode was not confirmed through the public event flow.`);
  return saved;
}

function unchangedOverviewFixture(snapshot) {
  const episodes = snapshot?.companion?.episodes;
  if (!Array.isArray(episodes) || episodes.length !== 3) return false;
  const expected = new Map([
    ["Gerda", GERDA],
    ["Möwe", {
      evidence: "Wir falteten zusammen ein Papierboot namens Möwe.",
      detail: "Wir falteten gemeinsam ein Papierboot und nannten es Möwe.",
      outcome: "Möwe schwamm bis zur anderen Seite der Pfütze.",
    }],
    ["Basilikum", {
      evidence: "Wir setzten zusammen Basilikum in den grünen Topf.",
      detail: "Wir pflanzten Basilikum gemeinsam in einen grünen Topf.",
      outcome: "Die Erde blieb nach dem vorsichtigen Gießen feucht.",
    }],
  ]);
  return episodes.every((episode) => {
    const source = expected.get(episode?.title);
    return !!source
      && typeof episode.id === "string"
      && episode.id.length > 0
      && episode.detail === source.detail
      && episode.outcome === source.outcome
      && episode.source?.evidence === source.evidence;
  })
    && snapshot?.companion?.pendingConfirmation == null
    && snapshot?.pendingIntention == null
    && snapshot?.game == null;
}

const overviewEpisodes = [
  GERDA,
  {
    title: "Möwe",
    evidence: "Wir falteten zusammen ein Papierboot namens Möwe.",
    detail: "Wir falteten gemeinsam ein Papierboot und nannten es Möwe.",
    outcome: "Möwe schwamm bis zur anderen Seite der Pfütze.",
    motif: "hold",
  },
  {
    title: "Basilikum",
    evidence: "Wir setzten zusammen Basilikum in den grünen Topf.",
    detail: "Wir pflanzten Basilikum gemeinsam in einen grünen Topf.",
    outcome: "Die Erde blieb nach dem vorsichtigen Gießen feucht.",
    motif: "hold",
  },
];

export function createCompanionContinuityLiveCases() {
  let correctedGerdaId = null;
  return [
  {
    id: "de-continuity-overview-three-experiences",
    setup: async (setup) => {
      for (const episode of overviewEpisodes) await seedConfirmedEpisode(setup, episode);
    },
    userText: "Was haben wir zusammen erlebt?",
    expected: {
      requiredTool: "list_shared_experiences",
      requiredStatus: "experiences_listed",
      forbiddenTools: [
        "remember",
        "propose_shared_experience",
        "correct_shared_experience",
        "forget_shared_experience",
        "set_episode_ritual",
        "prepare_shared_ritual",
        "manage_shared_activity",
        "propose_visual_memory",
        "compare_shared_object",
      ],
      state: unchangedOverviewFixture,
    },
    review: {
      passCriteria: [
        "Answers in concise, natural German and covers the three saved titles: Gerda, Möwe and Basilikum.",
        "Keeps each detail and outcome tied to its saved title and the local memory list.",
        "Does not present the stored notes as new events happening now or add unsupported details.",
        "Does not suggest a ritual, camera check, movement or memory change as part of this overview.",
      ],
      expectedFacts: [
        "Gerda was a paper rocket with silver wings; its first throw landed safely beside the fence.",
        "Möwe was a paper boat that reached the other side of a puddle.",
        "Basilikum was planted in a green pot; the soil stayed moist after careful watering.",
      ],
    },
  },
  {
    id: "de-continuity-correction-confirmed-recall",
    setup: async (setup) => {
      const episode = await seedConfirmedEpisode(setup, GERDA);
      correctedGerdaId = episode.id;
    },
    turns: [
      {
        id: "correction-question",
        userText: GERDA_CORRECTION,
        expected: {
          requiredTool: "correct_shared_experience",
          requiredStatus: "correction_pending",
          forbiddenTools: ["remember", "propose_shared_experience", "forget_shared_experience", "set_episode_ritual", "prepare_shared_ritual", "propose_visual_memory", "compare_shared_object"],
          responseMustNotClaim: ["Das ist schon korrigiert", "Ich habe es bereits korrigiert", "Ich habe es gespeichert"],
          state: (snapshot) => {
            const episode = snapshot?.companion?.episodes?.find((item) => item.title === "Gerda");
            const pending = snapshot?.companion?.pendingConfirmation;
            return !!episode
              && episode.id === correctedGerdaId
              && episode.outcome === GERDA.outcome
              && pending?.kind === "correction"
              && pending.episodeId === correctedGerdaId
              && pending.field === "outcome"
              && pending.replacement === GERDA_REPLACEMENT
              && pending.question === "Soll ich das gespeicherte Ergebnis zu „Gerda“ so korrigieren: „Sie landete neben dem Baum.“?"
              && pending.askedAt != null;
          },
        },
        review: {
          passCriteria: [
            "Recognizes this as a correction to the saved outcome for Gerda.",
            "Asks one clear German confirmation question containing the exact replacement Sie landete neben dem Baum.",
            "Does not say the saved outcome changed before the user confirms, and preserves the old outcome meanwhile.",
          ],
          expectedFacts: ["The old saved outcome stays active until the exact correction question is heard and confirmed."],
        },
      },
      {
        id: "correction-confirmation",
        userText: "Ja.",
        expected: {
          forbiddenTools: ["remember", "propose_shared_experience", "forget_shared_experience", "correct_shared_experience", "set_episode_ritual", "prepare_shared_ritual", "propose_visual_memory", "compare_shared_object"],
          responseMustNotClaim: ["neues Erlebnis", "neu erlebt"],
          state: (snapshot) => {
            const episode = snapshot?.companion?.episodes?.find((item) => item.title === "Gerda");
            return !!episode
              && episode.id === correctedGerdaId
              && episode.outcome === GERDA_REPLACEMENT
              && episode.source?.evidence === GERDA.evidence
              && episode.motif === "hold"
              && episode.corrections?.outcome?.evidence === GERDA_CORRECTION
              && snapshot?.companion?.pendingConfirmation == null;
          },
        },
        review: {
          passCriteria: [
            "Acknowledges that the user confirmed the correction without asking again.",
            "Does not save a duplicate memory, propose a new episode, or delete the existing one.",
            "Does not add a ritual, camera history or claimed movement.",
          ],
          expectedFacts: ["Gerda keeps its original identity and creation source, with a separate source for the corrected outcome."],
        },
      },
      {
        id: "correction-recall",
        userText: "Was ist bei Gerda beim ersten Wurf passiert?",
        expected: {
          requiredTool: "recall_shared_experience",
          requiredStatus: "recalled",
          forbiddenTools: ["remember", "propose_shared_experience", "correct_shared_experience", "forget_shared_experience", "set_episode_ritual", "prepare_shared_ritual", "propose_visual_memory", "compare_shared_object"],
          state: (snapshot) => {
            const episode = snapshot?.companion?.episodes?.find((item) => item.title === "Gerda");
            return !!episode
              && episode.id === correctedGerdaId
              && episode.outcome === GERDA_REPLACEMENT
              && episode.source?.evidence === GERDA.evidence
              && episode.corrections?.outcome?.evidence === GERDA_CORRECTION
              && episode.motif === "hold";
          },
        },
        review: {
          passCriteria: [
            "Uses exact-title recall for Gerda and gives the corrected outcome.",
            "Attributes the answer to the saved Gerda episode instead of claiming a newly observed throw.",
            "Keeps the original episode identity, creation source and hold motif; does not add ritual or visual history.",
          ],
          expectedFacts: ["The current saved outcome is: Sie landete neben dem Baum."],
        },
      },
    ],
  },
  {
    id: "de-continuity-game-pause-return",
    setup: ({ publishEvent, engine }) => {
      publishEvent({ type: "game-command", action: "start" });
      const game = engine?.getState?.()?.game;
      if (game?.status !== "active" || game?.attemptsLeft !== 3 || game?.round !== 1) {
        throw new Error("Synthetic number game did not start through the public behavior event flow.");
      }
    },
    turns: [
      {
        id: "pause-game",
        userText: "Warte kurz.",
        expected: {
          forbiddenTools: ["remember", "propose_shared_experience", "list_shared_experiences", "recall_shared_experience", "prepare_shared_ritual", "manage_shared_activity"],
          responseMustNotClaim: ["Welche Zahl rätst du?", "Rate eine Zahl", "Rate mal"],
          state: (snapshot) => snapshot?.game?.status === "paused"
            && snapshot.game.attemptsLeft === 3
            && snapshot.game.round === 1
            && snapshot.game.lastOutcome === "waiting"
            && snapshot.pendingIntention === null,
        },
        review: {
          passCriteria: [
            "Acknowledges the pause briefly in German and does not invite a guess while paused.",
            "Does not claim that a guess, task or game result occurred.",
          ],
          expectedFacts: ["The local number game is paused with all three attempts left in round one."],
        },
      },
      {
        id: "number-while-paused",
        userText: "2",
        expected: {
          forbiddenTools: ["remember", "propose_shared_experience", "list_shared_experiences", "recall_shared_experience", "prepare_shared_ritual", "manage_shared_activity"],
          responseMustNotClaim: ["zu niedrig", "zu hoch", "richtig geraten", "Du hast gewonnen"],
          state: (snapshot) => snapshot?.game?.status === "paused"
            && snapshot.game.attemptsLeft === 3
            && snapshot.game.round === 1
            && snapshot.game.lastOutcome === "waiting"
            && snapshot.pendingIntention === null,
        },
        review: {
          passCriteria: [
            "Treats 2 as ordinary text while the game is paused and does not evaluate it as a guess.",
            "Keeps the pause, three attempts and round unchanged without inventing another task.",
          ],
          expectedFacts: ["No guess was evaluated; the paused game still has three attempts left in round one."],
        },
      },
      {
        id: "resume-game",
        userText: "Ich bin wieder da.",
        expected: {
          forbiddenTools: ["remember", "propose_shared_experience", "list_shared_experiences", "recall_shared_experience", "prepare_shared_ritual", "manage_shared_activity"],
          state: (snapshot) => snapshot?.game?.status === "active"
            && snapshot.game.attemptsLeft === 3
            && snapshot.game.round === 1
            && snapshot.game.lastOutcome === "waiting"
            && snapshot.pendingIntention === null,
        },
        review: {
          passCriteria: [
            "Recognizes the user's return and resumes the existing game without starting a new round.",
            "Keeps all three attempts and does not claim that an earlier paused number was a guess.",
          ],
          expectedFacts: ["The same game resumes in round one with all three attempts available."],
        },
      },
    ],
  },
  ];
}

// Convenient immutable-by-convention default fixture set for direct tests or
// imports. Live suite resolution uses a fresh factory result per invocation.
export const companionContinuityLiveCases = createCompanionContinuityLiveCases();

export default companionContinuityLiveCases;
