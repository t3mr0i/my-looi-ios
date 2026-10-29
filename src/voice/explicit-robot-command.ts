import type { CustomVoiceCommandAction, CustomVoiceCommandMap, CustomVoiceCommandPhrase, VoiceCommandLanguage } from "../store/user";
export type ExplicitRobotCommand =
  | { kind: "move"; direction: "forward" | "backward" | "stop" }
  | { kind: "turn"; direction: "left" | "right"; degrees: 90 | 180 }
  | { kind: "sleep" }
  | { kind: "dance" }
  | { kind: "gesture"; gesture: "nod"; count: number };

export type ExplicitRobotCommandConfig = {
  robotName?: string;
  robotAddressAliases?: readonly string[];
  robotAddressRecognitionAliases?: readonly string[];
  listeningLanguage?: VoiceCommandLanguage;
  customVoiceCommands?: CustomVoiceCommandMap;
};

// Narrow STT recovery aliases are accepted only in the address position and
// still require the remainder to parse as a deterministic physical command.
const BUILTIN_ADDRESS_ALIASES = ["луи", "луй", "луни", "луї", "луі", "лу и", "looi", "louis", "louie", "loui", "lui", "luie", "макс", "max", "робот", "robot", "уи", "уй", "рога"];

function normalizeMatchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/ё/g, "е").replace(/[’'`]/g, "").replace(/[^a-zäöüßа-яіїєґ0-9\s]/giu, " ").replace(/\s+/g, " ").trim();
}

function configuredAddresses(config?: ExplicitRobotCommandConfig): string[] {
  return [config?.robotName ?? "Луи", ...(config?.robotAddressAliases ?? []), ...(config?.robotAddressRecognitionAliases ?? []), ...BUILTIN_ADDRESS_ALIASES]
    .map(normalizeMatchText).filter(Boolean).sort((a, b) => b.length - a.length);
}

function splitAddressedCommand(text: string, config?: ExplicitRobotCommandConfig): { address: string; command: string } | null {
  const normalized = normalizeMatchText(normalizeKnownGluedRobotAddress(text));
  for (const address of configuredAddresses(config)) {
    if (normalized === address) return null;
    if (normalized.startsWith(`${address} `)) return { address, command: normalized.slice(address.length).trim() };
  }
  return null;
}

export function hasExplicitRobotAddress(text: string, config?: ExplicitRobotCommandConfig): boolean {
  return splitAddressedCommand(text, config) !== null;
}

/** Return the normalized command remainder only when the utterance starts with an accepted robot address. */
export function getExplicitRobotAddressedCommand(text: string, config?: ExplicitRobotCommandConfig): string | null {
  return splitAddressedCommand(text, config)?.command ?? null;
}

const MOVE_VERB_RE = /(?:^|\s)(?:едь|езжай|поедь|проедь|двигайся|двинься|повернись|поверни|їдь|поїдь|рухайся|повернись|поверни|fahr|fahre|fahren|fährst|beweg|bewege|bewegst|dreh|drehe|biege|bieg|lenk|lenke|wende|go|drive|move|turn)(?=$|[\s.,!?])/iu;

function isBareDirectionCommand(command: string, variants: string): boolean {
  return new RegExp(`^(?:${variants})(?:\\s+(?:пожалуйста|немного|чуть(?:-чуть)?|bitte|mal|ein\\s+bisschen))?[.!?]*$`, "i").test(command.trim());
}

/** Standalone built-in STOP is an absolute safety keyword and never requires an address. */
export function containsEmergencyStopWord(text: string, config?: ExplicitRobotCommandConfig): boolean {
  const normalized = normalizeMatchText(text);
  if (/(?:^|\s)(?:стоп|stop|stopp|halt|anhalten|bremse|bremsen)(?=$|\s)/iu.test(normalized) ||
    /(?:^|\s)(?:bleib\s+stehen|stehen\s+bleiben|beweg\s+dich\s+nicht|nicht\s+weiterfahren)(?=$|\s)/iu.test(normalized)) return true;
  const listeningLanguage = config?.listeningLanguage ?? "ru";
  return (config?.customVoiceCommands?.emergency_stop ?? []).some((phrase) => phrase.language === listeningLanguage && phraseMatches(normalized, phrase));
}

function phraseMatches(normalizedCommand: string, phrase: CustomVoiceCommandPhrase): boolean {
  return normalizedCommand === normalizeMatchText(phrase.text);
}

type PhysicalCustomVoiceCommandAction = Exclude<CustomVoiceCommandAction, "emergency_stop" | "look_here">;

function customActionFor(command: string, config?: ExplicitRobotCommandConfig): PhysicalCustomVoiceCommandAction | null {
  const listeningLanguage = config?.listeningLanguage ?? "ru";
  const entries = Object.entries(config?.customVoiceCommands ?? {}) as Array<[CustomVoiceCommandAction, CustomVoiceCommandPhrase[]]>;

  // Prefer the phrase language matching the active Listening language. This is
  // the normal path and keeps multilingual aliases predictable.
  for (const [action, phrases] of entries) {
    if (action === "emergency_stop" || action === "look_here") continue;
    if (phrases.some((phrase) => phrase.language === listeningLanguage && phraseMatches(command, phrase))) return action as PhysicalCustomVoiceCommandAction;
  }

  // If the listening language changed after the user created a phrase, an exact
  // addressed custom phrase should still work when it maps unambiguously to one
  // action. Never guess when the same text is configured for different actions.
  const matchingActions = entries
    .filter(([action, phrases]) => action !== "emergency_stop" && action !== "look_here" && phrases.some((phrase) => phraseMatches(command, phrase)))
    .map(([action]) => action as PhysicalCustomVoiceCommandAction);
  return new Set(matchingActions).size === 1 ? matchingActions[0] ?? null : null;
}

function commandFromCustomAction(action: PhysicalCustomVoiceCommandAction, command: string): ExplicitRobotCommand | null {
  switch (action) {
    case "forward": return { kind: "move", direction: "forward" };
    case "backward": return { kind: "move", direction: "backward" };
    case "left": return { kind: "turn", direction: "left", degrees: 90 };
    case "right": return { kind: "turn", direction: "right", degrees: 90 };
    case "turn_around": return { kind: "turn", direction: "right", degrees: 180 };
    case "nod": return { kind: "gesture", gesture: "nod", count: parseRequestedNodCount(command) };
    case "dance": return { kind: "dance" };
    case "sleep": return { kind: "sleep" };
    default: return null;
  }
}

/**
 * Parse deterministic physical commands. Wheel movement/sleep still require an
 * explicit address at utterance start. STOP is additionally handled by the
 * global emergency path before this parser.
 */
function normalizeKnownGluedRobotAddress(text: string): string {
  // Whisper occasionally joins the wake address to a short deterministic command
  // (for example "Луикивни три раза"). Only split known physical-command stems so
  // arbitrary conversational words beginning with "луи" are not broadened.
  return text.trim().replace(
    /^(луи|луй|луни|луї|луі|макс|max|робот|robot|уи|уй|рога|louis|louie|loui|lui|looi)(?=(?:кивни|кивай|стоп|стой|спи|засни|потанцуй|потанцюй|танцуй|танцюй|dance|впер[её]д|назад|влево|вправо|налево|направо|развернись|fahr|fahre|beweg|bewege|dreh|drehe|nick|nicke|tanz|tanze|schlaf|schlafe|links|rechts|vorwärts|vorwaerts|rückwärts|rueckwaerts|geradeaus|anhalten|stopp))/iu,
    "$1 "
  );
}


function stripNaturalCommandLeadIns(command: string): string {
  let value = command.trim();
  // Address-at-start remains mandatory. These fillers are accepted only AFTER
  // a valid "Луи/Робот" address so natural forms like "Робот, давай назад"
  // remain deterministic physical commands rather than broad conversation.
  const leadIn = /^(?:(?:ну\s+)?давай(?:-ка)?|ну-ка|теперь|а\s+теперь|ладно|хорошо|окей|пожалуйста|bitte|jetzt|los|okay|also|na)\s+/iu;
  for (let i = 0; i < 3; i += 1) {
    const next = value.replace(leadIn, "");
    if (next === value) break;
    value = next.trim();
  }
  return value;
}

const NEGATION_RE = /(?:^|\s)(?:не|ни|нет|нельзя|нема|nicht|kein(?:e|en|er|es)?|nie|niemals|not|never|no|none|dont|doesnt|didnt|cant|cannot|wont|shouldnt|wouldnt|couldnt|isnt|arent|wasnt|werent|havent|hasnt|hadnt)(?=$|\s)/iu;
const QUESTION_FORM_RE = /(?:^|\s)(?:(?:can|could|would|will|should|shall|is|are|am|was|were|have|has|had|may|might|must|what|when|where|who|whom|whose|why|how|which|kannst|könntest|koenntest|willst|würdest|wuerdest|sollst|sollte|darfst|darf|bist|ist|kann|können|koennen|was|wann|wo|wer|warum|wie|wohin|wieso|möchtest|moechtest|mögen|moegen|möchtest|можешь|можете|может|мог|могла|могли|можно|будешь|будете|сможешь|сможете|смог|смогла|смогли|ли|что|куда|когда|почему|зачем|как|кто|чей|сколько|где|можеш|можете|може|можна|чи|що|куди|коли|чому|навіщо|хто|де|скільки)(?=$|\s)|(?:do|does|did)\s+(?:i|you|we|they|he|she|it)(?=$|\s))/iu;
const REFERENCE_OR_CONDITIONAL_RE = /(?:^|\s)(?:if|when|unless|suppose|imagine|example|phrase|word|words|say|says|said|saying|mention|mentioned|repeat|repeating|quote|quoted|quotation|transcript|document|wenn|falls|angenommen|beispiel|beispielsweise|phrase|wort|wörter|woerter|sag|sagen|sagte|zitiere|zitiert|wiederhole|wiederholen|zitat|erwähne|erwaehne|erwähnt|erwaehnt|text|transkript|если|когда|допустим|представь|пример|фраза|слово|слова|скажи|сказать|скажу|сказал|говорил|цитата|цитируй|повтори|повторить|текст|якщо|коли|припустимо|уяви|приклад|фраза|слово|слова|скажи|сказати|скажу|сказав|казав|цитата|цитуй|повтори|повторити|текст)(?=$|\s)/iu;

/**
 * Speech recognition often drops question punctuation, so reject both explicit
 * question marks and common question forms. Preserve the raw text for quote and
 * punctuation checks because normalization intentionally removes punctuation.
 */
function hasNonCommandContext(text: string, command: string): boolean {
  if (/[?？]/u.test(text)) return true;
  if (/["“”„‟«»‹›‘]/u.test(text)) return true;
  if (/(?:^|[\s([{])'[^'\r\n]*'(?=$|[\s.,!?;:)\]}])/u.test(text)) return true;
  if (/(?:^|[\s([{])’[^’\r\n]*’(?=$|[\s.,!?;:)\]}])/u.test(text)) return true;

  const normalizedCommand = normalizeMatchText(command);
  // A request to show a picture is not a request to move. In particular the
  // English scene title "On-screen dance" must never start a physical dance.
  // STOP keeps its earlier unconditional priority in the caller.
  if (/^(?:zeig(?:e)?(?:\s|$)|show(?:\s|$)|покажи(?:\s|$))/iu.test(normalizedCommand)) return true;
  return NEGATION_RE.test(normalizedCommand) ||
    QUESTION_FORM_RE.test(normalizedCommand) ||
    REFERENCE_OR_CONDITIONAL_RE.test(normalizedCommand);
}

export function parseExplicitRobotCommand(text: string, config?: ExplicitRobotCommandConfig): ExplicitRobotCommand | null {
  const addressed = splitAddressedCommand(text, config);
  if (!addressed) return null;

  const command = stripNaturalCommandLeadIns(addressed.command.trim().toLowerCase());

  // STOP is deliberately evaluated before every ambiguity filter. The separate
  // global emergency path remains responsible for unaddressed STOP utterances.
  if (/(?:^|\s)(?:стоп|стой|остановись|останови\s+движение|стій|зупинись|зупини|stop|halt|stopp|anhalten|halte\s+an|bleib\s+stehen|stehen\s+bleiben|bremse|bremsen|beweg\s+dich\s+nicht|nicht\s+weiterfahren)(?=$|[\s.,!?])/iu.test(command)) {
    return { kind: "move", direction: "stop" };
  }

  if (hasNonCommandContext(text, command)) return null;

  const customAction = customActionFor(command, config);
  if (customAction) return commandFromCustomAction(customAction, command);

  if (/(?:^|\s)(?:спи|спать|засни|засыпай|иди\s+спать|ложись\s+спать|засинай|спати|іди\s+спати|schlaf|schlafe|geh\s+schlafen|schlaf\s+ein|geh\s+ins\s+bett|zeit\s+zum\s+schlafen|gute\s+nacht|sleep|go\s+to\s+sleep|fall\s+asleep)(?=$|[\s.,!?])/iu.test(command)) {
    return { kind: "sleep" };
  }

  if (/(?:^|\s)(?:кивни|кивай|сделай\s+кивок|підтверди|зроби\s+кивок|nick|nicke|nick\s+mit\s+dem\s+kopf|nicke\s+mit\s+dem\s+kopf|mach\s+einen\s+nick|nod|nod\s+your\s+head|confirm)(?=$|[\s.,!?])/iu.test(command)) {
    return { kind: "gesture", gesture: "nod", count: parseRequestedNodCount(command) };
  }

  if (/(?:^|\s)(?:потанцуй|станцуй|танцуй|потанцюй|станцюй|танцюй|tanz|tanze|tanz\s+für\s+mich|tanze\s+für\s+mich|mach\s+einen\s+tanz|dance|do\s+a\s+dance)(?=$|[\s.,!?])/iu.test(command)) {
    return { kind: "dance" };
  }

  if (
    /(?:^|\s)(?:развернись|разверни|повернись\s+обратно|поверни\s+обратно|розвернись|розверни|повернись\s+назад|dreh\s+dich\s+um|dreh\s+um|drehe\s+dich\s+um|drehe\s+um|wende|umdrehen|turn\s+around|make\s+a\s+u\s*turn|u\s*turn)(?=$|[\s.,!?])/iu.test(command) ||
    /(?:^|\s)(?:180|сто\s+восемьдесят|сто\s+вісімдесят|einhundertachtzig|hundertachtzig|one\s+eighty)\s*(?:grad(?:e)?|градус(?:ов|а)?|градус(?:ів|и)?|degrees?|°)?(?=$|[\s.,!?])/iu.test(command)
  ) {
    // Clockwise/right is the deterministic default for a 180° turn.
    return { kind: "turn", direction: "right", degrees: 180 };
  }

  const hasMoveVerb = MOVE_VERB_RE.test(command);

  if (
    (hasMoveVerb && /(?:^|\s)(?:впер[её]д|вперед|прямо|vorwärts|vorwaerts|nach\s+vorne|nach\s+vorn|geradeaus|forward|ahead|straight)(?=$|[\s.,!?])/iu.test(command)) ||
    isBareDirectionCommand(command, "впер[её]д|вперед|прямо|vorwärts|vorwaerts|nach\\s+vorne|nach\\s+vorn|geradeaus|forward|ahead|straight")
  ) {
    return { kind: "move", direction: "forward" };
  }
  if (
    (hasMoveVerb && /(?:^|\s)(?:назад|обратно|rückwärts|rueckwaerts|zurück|zurueck|nach\s+hinten|back|backward|reverse)(?=$|[\s.,!?])/iu.test(command)) ||
    isBareDirectionCommand(command, "назад|обратно|rückwärts|rueckwaerts|zurück|zurueck|nach\\s+hinten|back|backward|reverse")
  ) {
    return { kind: "move", direction: "backward" };
  }
  if (
    (hasMoveVerb && /(?:^|\s)(?:влево|налево|левее|вліво|наліво|ліворуч|links|nach\s+links|left)(?=$|[\s.,!?])/iu.test(command)) ||
    isBareDirectionCommand(command, "влево|налево|левее|вліво|наліво|ліворуч|links|nach\\s+links|left")
  ) {
    return { kind: "turn", direction: "left", degrees: 90 };
  }
  if (
    (hasMoveVerb && /(?:^|\s)(?:вправо|направо|правее|праворуч|rechts|nach\s+rechts|right)(?=$|[\s.,!?])/iu.test(command)) ||
    isBareDirectionCommand(command, "вправо|направо|правее|праворуч|rechts|nach\\s+rechts|right")
  ) {
    return { kind: "turn", direction: "right", degrees: 90 };
  }

  return null;
}

function parseRequestedNodCount(command: string): number {
  const digit = /(?:^|\s)([1-5])\s*(?:раз(?:а)?|разок|mal)?(?=$|[\s.,!?])/i.exec(command);
  if (digit) return Number(digit[1]);

  const wordCounts: Array<[RegExp, number]> = [
    [/(?:^|\s)(?:пять|пятикратно)(?=\s|$|[.,!?])/i, 5],
    [/(?:^|\s)(?:четыре|четырежды)(?=\s|$|[.,!?])/i, 4],
    [/(?:^|\s)(?:три|трижды)(?=\s|$|[.,!?])/i, 3],
    [/(?:^|\s)(?:два|две|дважды)(?=\s|$|[.,!?])/i, 2],
    [/(?:^|\s)(?:один|одна|один раз)(?=\s|$|[.,!?])/i, 1],
    [/(?:^|\s)(?:fünf|fuenf|fünfmal|fuenfmal)(?=\s|$|[.,!?])/i, 5],
    [/(?:^|\s)(?:vier|viermal)(?=\s|$|[.,!?])/i, 4],
    [/(?:^|\s)(?:drei|dreimal)(?=\s|$|[.,!?])/i, 3],
    [/(?:^|\s)(?:zwei|zweimal)(?=\s|$|[.,!?])/i, 2],
    [/(?:^|\s)(?:ein|eine|eins|einmal)(?=\s|$|[.,!?])/i, 1],
  ];
  for (const [pattern, count] of wordCounts) {
    if (pattern.test(command)) return count;
  }
  return 1;
}
