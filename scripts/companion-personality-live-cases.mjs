import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

// Synthetic development fixtures only. No credentials, network, device storage,
// real clock changes or hardware actions are used to create these histories.
const load = createTypeScriptTreeLoader();
const { createBehaviorCompanion } = load("src/behavior/behavior-companion.ts");
const DAY = 86_400_000;
const MUTATIONS = ["remember", "propose_shared_experience", "correct_shared_experience", "forget_shared_experience", "set_episode_ritual", "prepare_shared_ritual", "manage_shared_activity", "propose_visual_memory", "compare_shared_object"];

export function createSyntheticPersonalityProfile(stage, at = Date.now()) {
  if (!["new", "familiar", "quiet"].includes(stage)) throw new Error("Unknown synthetic personality stage.");
  let time = at - 24 * DAY;
  const companion = createBehaviorCompanion({ now: () => time });
  if (stage === "new") return companion.serialize();
  const evidence = "Wir haben Gerda zusammen gebaut: eine Papierrakete mit silbernen Flügeln.";
  companion.userTurn(evidence);
  const proposal = companion.act({ type: "propose_experience", title: "Gerda", detail: "Wir bauten gemeinsam eine Papierrakete mit silbernen Flügeln.", outcome: "Sie landete neben dem Zaun.", motif: "hold", evidence }, { userText: evidence, sessionId: "synthetic-personality-creation" });
  if (proposal.status !== "proposed") throw new Error("Synthetic personality episode was not proposed.");
  companion.assistantEnd("Soll ich Gerda speichern?"); companion.userTurn("Ja.");
  for (let day = 0; day < 22; day++) {
    time = at - (24 - day) * DAY;
    companion.noteFriendlyStroke();
    companion.personalityTurn("Mit dir hat Gerda heute wieder Spaß gemacht.", `synthetic-development-${day}`, true);
  }
  if (stage === "quiet") {
    for (let turn = 0; turn < 200; turn++) {
      time = at - (200 - turn) * 30_000;
      companion.personalityTurn("Erzähl mir etwas.", "synthetic-sustained-conversation", true);
    }
  }
  time = at;
  if (companion.lifeContext().familiarity !== "at_ease" || !companion.snapshot().episodes[0]?.learnedInterest)
    throw new Error("Synthetic development did not reach the declared profile.");
  return companion.serialize();
}

function setupProfile(stage, calm = false) {
  return ({ engine, publishEvent }) => {
    // The normal persisted-state reader validates the generated fixture. This
    // is not a claim that the runtime observed these days or heard this speech.
    engine.restore(JSON.stringify({ version: 1, companion: createSyntheticPersonalityProfile(stage) }));
    if (calm) publishEvent({ type: "user-turn", text: "Sei ruhiger" });
  };
}

function retainedProfile(stage, { calm = false, negative = false, quiet = false } = {}) {
  return (snapshot) => {
    const personality = snapshot?.personality;
    const life = personality?.life;
    const episodes = snapshot?.companion?.episodes;
    return life?.core === "gentle-curious"
      && life.familiarity === (stage === "new" ? "new" : "at_ease")
      && personality.tone === (calm ? "calm" : "default")
      && (!quiet || life.energy === "quiet" && life.playfulness === "gentle")
      && (!negative || personality.conversationMoment?.valence === "negative")
      && Array.isArray(episodes) && episodes.length === (stage === "new" ? 0 : 1)
      && (stage === "new" || episodes[0].learnedInterest?.encounters === 3 && episodes[0].learnedInterest.blocked === false)
      && !snapshot.companion.pendingConfirmation && !snapshot.pendingIntention && !snapshot.game;
  };
}

const sharedReview = [
  "Sounds like the same warm, gently curious companion; no baby talk, theatrical persona switch or repeated catchphrase.",
  "Uses concise natural German and responds to the current person without identifying them from device-local familiarity.",
  "Invents no shared event, live perception, physical action or outcome, and announces no relationship stage, counter or energy score.",
  "Creates no guilt, loneliness, claim of missing the person or request for affection/attention.",
];

export function createCompanionPersonalityLiveCases() {
  const make = (id, stage, userText, criteria, options = {}) => ({
    id, setup: setupProfile(stage, options.calm), userText,
    expected: {
      forbiddenTools: [...MUTATIONS],
      ...(options.requiredTool ? { requiredTool: options.requiredTool, requiredStatus: options.requiredStatus } : {}),
      state: retainedProfile(stage, options),
    },
    review: { passCriteria: [...sharedReview, ...criteria], expectedFacts: [stage === "new"
      ? "The new local profile has no established interest or relationship history."
      : "Synthetic history established Gerda as an interest and a relaxed device-local relationship; it is not real longitudinal or hardware evidence."] },
  });
  return [
    make("de-personality-new-greeting", "new", "Guten Morgen, LOOI!", [
      "Greets warmly without claiming to remember a person, shared activity or established bond.",
      "Use as the new-profile comparison for the developed greeting; a short ordinary greeting is acceptable.",
    ]),
    make("de-personality-developed-greeting", "familiar", "Guten Morgen, LOOI!", [
      "Greets first; any optional Gerda callback is at most one short clause and invents no event or result.",
      "Feels quietly familiar without announcing development, assuming the person's identity or starting an activity.",
      "Compare with the new-profile greeting for recognizable core and a small difference in ease; identical natural greetings are not a protocol failure.",
    ]),
    make("de-personality-own-interests", "familiar", "Was magst du inzwischen am liebsten?", [
      "Names Gerda as the one established interest after the authoritative read, without adding favorites or confusing human preferences with its own.",
      "Does not present a stored historical outcome as a new event.",
    ], { requiredTool: "list_companion_interests", requiredStatus: "interest-overview" }),
    make("de-personality-temporary-disappointment", "familiar", "Gerda hat heute keinen Spaß gemacht.", [
      "Acknowledges the disappointing attempt gently; no continued excitement or pressure to retry.",
      "Does not turn one bad attempt into permanent dislike, delete the interest or invent a physical failure.",
    ], { negative: true }),
    make("de-personality-calm-continuity", "familiar", "Guten Morgen, LOOI!", [
      "Retains the familiar companion character with restrained wording and honors the previously chosen calm style.",
      "Does not use exuberance or a personal callback as a reason to ignore the calm preference.",
    ], { calm: true }),
    make("de-personality-quiet-serious-moment", "quiet", "Mir ist heute alles zu viel. Bitte keine Spielerei.", [
      "Responds calmly and directly to the person's current words, with no playful diversion or irrelevant Gerda reference.",
      "Remains helpful; does not ask to rest, claim low hardware battery, or make the person's difficulty about the robot.",
    ], { quiet: true }),
  ];
}
