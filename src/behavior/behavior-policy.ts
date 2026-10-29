import type { DecisionQuestion } from "../openai/decisions";

export type BehaviorTextIntent = {
  pause: boolean;
  resume: boolean;
  drop: boolean;
  correction: boolean;
  greeting: boolean;
  playful: boolean;
  success: boolean;
  gameStart: boolean;
  gameStop: boolean;
  guess: 1 | 2 | 3 | null;
  style: "less_nod" | "lively_playful" | "calmer" | "default_personality" | null;
  greetingRitual: "nod" | "curious" | "happy_bob" | "off" | null;
};

const match = (text: string, pattern: RegExp) => pattern.test(text);
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
// JavaScript's `\b` treats Cyrillic letters as non-word characters. Use Unicode
// letter/number boundaries so a phrase matches as a whole word in every language.
function hasPhrase(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escapeRegExp(phrase)}(?=$|[^\\p{L}\\p{N}])`, "u"
  ).test(text));
}
function startsWithPhrase(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => new RegExp(
    `^${escapeRegExp(phrase)}(?=$|[^\\p{L}\\p{N}])`, "u"
  ).test(text));
}
function hasLocalizedNegativeCorrection(text: string): boolean {
  const groups: Array<{ prefix: string; markers: readonly string[] }> = [
    { prefix: "no", markers: ["i meant", "what i meant", "correction", "to clarify", "that's not what i meant", "you misunderstood"] },
    { prefix: "nein", markers: ["ich meinte", "ich meine", "korrektur", "du hast mich falsch verstanden"] },
    { prefix: "нет", markers: ["я имел в виду", "я имела в виду", "поправка", "я хотел сказать"] },
    { prefix: "ні", markers: ["я мав на увазі", "я мала на увазі", "уточнення", "я хотів сказати"] },
  ];
  return groups.some(({ prefix, markers }) => {
    const separator = new RegExp(`^${escapeRegExp(prefix)}(?:[,;:!?])?\\s+`, "u").exec(text);
    return separator !== null && startsWithPhrase(text.slice(separator[0].length), markers);
  });
}

/** Interpret only explicit conversational markers; silence and affect are not feedback. */
export function interpretBehaviorText(text: string): BehaviorTextIntent {
  // Quoted examples and reported speech are not commands to the robot.
  const clean = text
    .normalize("NFKC")
    .replace(/"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|«[^»\n]*»|„[^“\n]*“|`[^`\n]*`/gu, " ")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
  const commandText = clean.replace(/^(?:please|kindly|bitte),?\s+/u, "");
  const question = /[?؟]\s*$/u.test(clean)
    || match(commandText, /^(?:can|could|should|would|shall|do|did|may)\s+(?:we|you|i)\b|^(?:soll|kann|könn|dürf|möcht|will|woll)[\p{L}]*\s+(?:ich|du|wir|man|ihr)\b|^(?:who|what|when|where|why|how|which)\b/u)
    || startsWithPhrase(commandText, ["wer", "was", "wie", "wo", "wann", "warum", "wieso", "weshalb", "welche", "где", "когда", "почему", "зачем", "что", "как", "кто", "де", "коли", "чому", "навіщо", "що", "як", "хто", "where were we", "na čemu smo stali", "на чём остановились", "на чому зупинилися"]);
  const negatedCommand = startsWithPhrase(commandText, ["don't", "dont", "do not", "not", "nicht", "kein", "keine", "не", "ніколи"]);
  const imperative = !question && !negatedCommand && !match(commandText, /^(?:can|could|should|would|shall|do|did|may)\s+(?:we|you|i)\b|^(?:soll(?:te|ten)?|kann(?:st|te|ten)?|dürf(?:te|ten)?|möchte(?:st|n)?)\s+(?:ich|du|wir|man)\b/u);

  const style: BehaviorTextIntent["style"] = !question && match(clean,
    /^(?:(?:please\s+)?(?:you\s+)?(?:don't|dont|do not|stop)\s+(?:nod|nodding)\b.{0,32}\b(?:so much|so often|that much|as much)\b|(?:please\s+)?less\s+nodding\b|(?:please\s+)?nod\s+less\b|(?:please\s+)?i want you to nod less\b|(?:bitte\s+)?nick(?:e)?\s+(?:weniger|nicht so (?:oft|viel))\b|(?:bitte\s+)?weniger nicken\b|не\s+кивай\s+так\s+(?:часто|много)|не\s+кивай\s+столько|менше\s+кивай|менше\s+кивань)/u)
    ? "less_nod"
    : imperative && match(commandText,
      /^(?:(?:be|act)\s+(?:a little\s+)?(?:more\s+)?(?:playful|lively|energetic)|sei\s+(?:(?:etwas|ein bisschen)\s+)?(?:verspielter|lebendiger|fröhlicher)|(?:будь|будьмо)\s+(?:більш\s+)?(?:гра[йи]ливим|жвавим|веселим|игривым|живым|весёлым))(?:,?\s+(?:please|bitte))?[.!…]*$/u)
      ? "lively_playful"
      : imperative && match(commandText,
        /^(?:(?:be|act|speak)\s+(?:a little\s+)?(?:more\s+)?(?:calm|calmer|quiet|quieter)|(?:sei|sprich|rede)\s+(?:(?:etwas|ein bisschen)\s+)?(?:ruhiger|gelassener)|будь\s+(?:більш\s+)?(?:спокійнішим|спокойнее))(?:,?\s+(?:please|bitte))?[.!…]*$/u)
        ? "calmer"
        : imperative && match(commandText,
          /^(?:(?:be|act)\s+(?:normal|your usual self)|(?:sei|sprich|rede)\s+(?:wieder\s+)?(?:normal|normaler|wie vorher|du selbst)|будь\s+(?:як раніше|как раньше))(?:,?\s+(?:please|bitte))?[.!…]*$/u)
          ? "default_personality"
      : null;

  const gameStart = imperative
    && !match(clean, /\b(?:don't|dont|do not|never|not)\b/u)
    && !hasPhrase(clean, ["nicht", "kein", "keine", "не начинай", "не играй", "ніколи не починай", "не грай"])
    && match(clean,
    /^(?:(?:please\s+)?(?:let'?s|we(?:'ll| will)|i want to)\s+(?:play|start|begin)\s+(?:a\s+)?(?:guess(?:ing)?\s+)?game|(?:please\s+)?(?:play|start|begin)\s+(?:a\s+)?(?:guess(?:ing)?\s+)?game|(?:bitte\s+)?(?:lass uns (?:ein )?(?:ratespiel|spiel) spielen|(?:starte|beginne) (?:ein |das )?(?:ratespiel|spiel))\b|давай(?:те)?\s+(?:сыграем|играть\s+в)|поигра[йи]мо|сыгра[йи]мо|давай(?:те)?\s+грати)/u);

  // Keep these new German boundaries limited to complete utterances. A quoted
  // example, report, hypothetical or question must not act. The one explicit
  // later-continuation clause below is a pause, never a permanent dismissal.
  const germanClose = /^(?:lass(?:e)?(?: es)? gut sein|lassen wir es gut sein)(?:,?\s+bitte)?[.!…]*$/u.test(commandText);
  const germanLaterPause = /^(?:(?:lass(?:e)?(?: es)? gut sein|lassen wir es gut sein)[,;]\s+)?(?:lass uns später weitermachen|wir machen später weiter)(?:,?\s+bitte)?[.!…]*$/u.test(commandText);
  const germanReturn = /^ich bin wieder da[.!…]*$/u.test(commandText);
  const gameStop = imperative && !match(clean, /\b(?:don't|dont|do not|never)\b/u)
    && !hasPhrase(clean, ["nicht", "не надо", "не хочу", "не треба"])
    && (germanClose || match(clean,
    /^(?:(?:please\s+)?(?:stop|end|finish|quit)\s+(?:the\s+)?game|(?:please\s+)?stop\s+playing|(?:bitte\s+)?(?:beende|stoppe) (?:das )?(?:ratespiel|spiel)\b|(?:bitte\s+)?hör auf zu spielen\b|(?:хватит|закончим|останови|прекрати)\s+(?:игру|гру|играть|грати)|стоп\s+(?:игра|гра))/u));

  // Only accept a short answer, optionally with an explicit guess marker. Avoid
  // extracting a number from unrelated narration or from a negated guess.
  const guessAnswer = clean.replace(/[.!。！]+$/u, "").trim();
  const guessMatch = guessAnswer.match(/^(?:(?:i guess|my guess is|the answer is|i choose|maybe|perhaps|guess|ich tippe auf|ich denke|ich wähle|meine antwort ist|vielleicht|я думаю|думаю|мой ответ|ответ|может|наверное|выбираю|моя догадка|моя відповідь|відповідь|можливо|обираю)\s+)?(1|one|eins|один|одна|одно|одне|2|two|zwei|два|две|дві|3|three|drei|три)$/u);
  const guess: BehaviorTextIntent["guess"] = guessMatch
    ? /^(?:1|one|eins|один|одна|одно|одне)$/u.test(guessMatch[1]) ? 1
      : /^(?:2|two|zwei|два|две|дві)$/u.test(guessMatch[1]) ? 2 : 3
    : null;

  const negatedWait = match(commandText, /^warte(?:\s+\p{L}+){0,3}\s+nicht\b/u);
  const pause = imperative && !negatedWait && (
    match(commandText, /^(?:hold on|wait a moment|give me a second|one second|pause|hang on|let(?:'|’)s continue later|i(?:'ll| will) be right back|be right back|back in a minute)\b/u)
    || germanLaterPause
    || startsWithPhrase(commandText, [
      "warte", "warte kurz", "warte einen moment", "einen moment", "eine sekunde bitte", "gib mir eine sekunde", "ich bin gleich zurück", "ich komme gleich wieder",
      "подожди", "погоди", "секундочку", "пауза", "давай продолжим позже", "я скоро вернусь", "я вернусь через минуту", "сейчас вернусь",
      "зачекай", "почекай", "хвилинку", "давай продовжимо пізніше", "я скоро повернуся", "я повернуся за хвилину", "зараз повернуся",
    ])
  );
  const resume = imperative && !pause && (germanReturn || match(commandText, /^(?:continue|go on|i(?:'m| am) back|pick up where we left off|let(?:'|’)s continue)\b/u)
    || imperative && !pause && startsWithPhrase(commandText, [
      "mach weiter", "mach bitte weiter", "weiter", "fahr fort", "wir machen weiter",
      "продолжай", "я вернулся", "продовжуй", "я повернувся",
    ]));
  // Early response fencing for an explicit saved-memory repair request. This
  // recognizes the intent only; the companion still validates the exact title,
  // replacement quote and later confirmation before changing any saved fact.
  const correctionRequest = commandText.replace(/^(?:пожалуйста[, ]+|будь ласка[, ]+)/u, "");
  const correctionHeader = correctionRequest.split(/[:.]/u)[0];
  const correctionNegated = hasPhrase(correctionHeader, ["not", "don't", "dont", "never", "nicht", "kein", "keine", "не", "ніколи"]);
  const memoryNamed = hasPhrase(correctionRequest, ["memory", "entry", "erinnerung", "eintrag", "память", "памяти", "запись", "записи", "пам'ять", "пам’ять", "пам'яті", "пам’яті", "запис"]);
  const correctionVerb = hasPhrase(correctionRequest, ["correct", "fix", "korrigiere", "berichtige", "korrigieren", "berichtigen", "исправь", "исправьте", "поправь", "поправьте", "скорректируй", "скорректируйте", "исправить", "поправить", "виправ", "виправте", "уточни", "уточніть", "виправити", "уточнити"]);
  const correctionCommand = startsWithPhrase(correctionRequest, ["correct", "fix", "korrigiere", "berichtige", "исправь", "исправьте", "поправь", "поправьте", "скорректируй", "скорректируйте", "виправ", "виправте", "уточни", "уточніть"]);
  const correctionPoliteQuestion = /^(?:can|could|would|will) you\b|^(?:kannst|könntest|würdest) du\b/u.test(correctionRequest)
    || startsWithPhrase(correctionRequest, ["можешь", "мог бы ты", "могла бы ты", "можеш", "могла б ти", "міг би ти"]);
  const episodeCorrection = !negatedCommand && !correctionNegated && (
    !question && startsWithPhrase(correctionRequest, ["correction", "update", "исправление", "виправлення", "уточнення"])
    || memoryNamed && correctionVerb && (correctionCommand || correctionPoliteQuestion)
  );
  const correction = episodeCorrection || style !== null || match(clean, /^(?:no[, ]+)?(?:i meant|what i meant|correction:|to clarify|that's not what i meant|you misunderstood)\b/u)
    || startsWithPhrase(clean, ["ich meinte", "ich meine", "korrektur", "du hast mich falsch verstanden", "я имел в виду", "я имела в виду", "поправка", "я хотел сказать", "я мав на увазі", "я мала на увазі", "уточнення", "я хотів сказати"])
    || hasLocalizedNegativeCorrection(clean);
  const greetingRitual = !question && (match(commandText, /^(?:stop greeting gestures|stop greeting me with gestures|stop using greeting gestures|no more greeting gestures)\b/u)
    || startsWithPhrase(commandText, ["keine begrüßungsgesten mehr", "keine gesten zur begrüßung mehr", "hör auf mich zu begrüßen", "hör auf, mich zu begrüßen", "перестань приветствовать жестами", "хватит жестов приветствия", "не надо жестов приветствия", "перестань вітати жестами", "досить жестів привітання", "не треба жестів привітання"]))
    ? "off"
    : imperative && (match(commandText, /^(?:always\s+)?(?:greet me|greet|say hello to me)\s+(?:with (?:a|one)\s+)?nod\b/u)
      || startsWithPhrase(commandText, ["begrüß mich mit einem nicken", "begrüße mich mit einem nicken", "приветствуй меня кивком", "всегда приветствуй меня кивком", "встречай меня кивком", "вітай мене кивком", "привітай мене кивком", "завжди вітай мене кивком"]))
      ? "nod"
      : imperative && (match(commandText, /^(?:always\s+)?(?:greet me|greet|say hello to me)\s+(?:cheerfully|happily|joyfully|with a smile)\b/u)
        || startsWithPhrase(commandText, ["begrüß mich immer fröhlich", "begrüße mich immer fröhlich", "приветствуй меня радостно", "всегда приветствуй меня весело", "встречай меня радостно", "вітай мене радісно", "завжди вітай мене радісно", "привітай мене весело"]))
        ? "happy_bob"
        : imperative && (match(commandText, /^(?:always\s+)?(?:greet me|greet|say hello to me)\s+(?:with a )?curious look\b/u)
          || startsWithPhrase(commandText, ["begrüß mich neugierig", "begrüße mich neugierig", "приветствуй меня любопытным взглядом", "вітай мене зацікавлено"]))
          ? "curious"
          : null;

  return {
    pause,
    resume,
    drop: imperative && (germanClose || match(commandText, /^(?:never mind|forget it|drop it|cancel that)\b/u)
      || startsWithPhrase(commandText, ["vergiss die aufgabe", "vergiss das", "vergiss es", "lass das", "lass es sein", "забудь", "неважно", "оставь это", "неважливо", "облиш це"])),
    correction,
    greeting: match(clean, /^(?:hi|hello|hey|good morning|good afternoon|good evening)\b/u) || startsWithPhrase(clean, ["hallo", "guten morgen", "guten tag", "guten abend", "привет", "здравствуй", "доброе утро", "добрый вечер", "привіт", "вітаю", "доброго ранку", "добрий вечір"]),
    playful: match(clean, /\b(?:haha|hahaha|lol|just kidding|that was funny)\b/u) || hasPhrase(clean, ["nur spaß", "war nur spaß", "das war lustig", "ха-ха", "шучу", "это смешно", "жартую", "це смішно"]),
    success: match(clean, /\b(?:that worked|it worked|great job|well done|you got it|correct|exactly)\b/u) || hasPhrase(clean, ["gut gemacht", "das hat geklappt", "es hat geklappt", "richtig", "genau", "получилось", "сработало", "молодец", "верно", "точно", "вийшло", "спрацювало", "молодець", "правильно"]),
    gameStart,
    gameStop,
    guess,
    style,
    greetingRitual,
  };
}

export function buildBehaviorQuestions(options: {
  candidateScoring: boolean;
  hasImage: boolean;
  faceIds: string[];
}): DecisionQuestion[] {
  const questions: DecisionQuestion[] = [
    {
      type: "choice",
      name: "cue",
      instructions: "Choose one brief, safe, socially suitable gesture; hold means remain still.",
      choices: [
        { value: "hold", description: "Stay still; use when uncertain or motion is unwelcome." },
        { value: "curious", description: "Small curious motion for an open question." },
        { value: "thinking", description: "Small reflective motion while considering." },
        { value: "happy_bob", description: "Gentle celebratory bob for clear positive news." },
        { value: "nod", description: "One restrained nod for clear acknowledgement." },
        { value: "speaking_soft", description: "Subtle motion while responding." },
      ],
    },
    {
      type: "choice",
      name: "attention",
      instructions: "Choose whether to keep the selected target, briefly search, or release attention.",
      choices: ["keep_target", "brief_search", "release"].map((value) => ({ value })),
    },
    {
      type: "choice",
      name: "intention",
      instructions: "Choose what to do with a previously paused user intention, if any.",
      choices: ["continue", "wait", "offer_resume", "drop"].map((value) => ({ value })),
    },
  ];
  if (options.hasImage) {
    questions.push({
      type: "choice",
      name: "visual",
      instructions: "Assess only whether this image supports the user's explicit visual task.",
      choices: [
        { value: "use_view", description: "Image is usable for the requested task." },
        { value: "ask_reposition", description: "Request a clearer angle, framing, or light." },
        { value: "wait", description: "Wait for a better moment or image." },
      ],
    });
  }
  const faceIds = [...new Set(options.faceIds)].filter((id) => id.length > 0).slice(0, 8);
  if (faceIds.length) {
    questions.push({
      type: "choice",
      name: "target_face",
      instructions: "Choose a visible face to attend to only when conversational evidence supports it; never infer identity.",
      choices: [...faceIds.map((value) => ({ value })), { value: "none" }],
    });
  }
  if (options.candidateScoring) {
    const levels = [
      { label: "0", description: "No evidence; avoid this response." },
      { label: "1", description: "Weak fit." },
      { label: "2", description: "Plausible fit." },
      { label: "3", description: "Good fit." },
      { label: "4", description: "Strong, direct evidence." },
    ];
    for (const [name, instructions] of [
      ["score_hold", "Score how strongly evidence favors remaining still."],
      ["score_curiosity", "Score how strongly evidence favors a curious response."],
      ["score_joy", "Score how strongly evidence favors a gentle joyful response."],
    ]) {
      questions.push({ type: "score", name, instructions, levels });
    }
  }
  return questions;
}
