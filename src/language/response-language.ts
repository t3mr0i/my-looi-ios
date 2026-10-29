export type ResponseLanguage = "ru" | "uk" | "en" | "de";

export const DEFAULT_RESPONSE_LANGUAGE: ResponseLanguage = "ru";

export const RESPONSE_LANGUAGE_OPTIONS: ReadonlyArray<{
  id: ResponseLanguage;
  shortLabel: string;
  label: string;
}> = [
  { id: "ru", shortLabel: "RU", label: "Русский" },
  { id: "uk", shortLabel: "UA", label: "Українська" },
  { id: "en", shortLabel: "EN", label: "English" },
  { id: "de", shortLabel: "DE", label: "Deutsch" },
];

const DIRECT_SWITCH_COMMAND_RE = /^(?:говори|разговаривай|отвечай|ответь|розмовляй|спілкуйся|відповідай|speak|talk|reply|respond|sprich|rede|antworte|kommuniziere|lass\s+uns(?:\s+(?:sprechen|reden))?)(?=$|\s)/u;

const POLITE_SWITCH_COMMAND_RE = /^(?:(?:можешь|можеш|чи\s+можеш|can\s+you|could\s+you|kannst\s+du|könntest\s+du|koenntest\s+du|würdest\s+du|wuerdest\s+du)(?:\s+(?:пожалуйста|будь\s+ласка|please|bitte|теперь|відтепер|now|ab\s+jetzt|ab\s+sofort))*\s+)(?:говорить|разговаривать|отвечать|говорити|спілкуватися|відповідати|speak|talk|reply|respond|sprechen|reden|antworten)(?=$|\s)/u;

const RESPONSE_SETTING_COMMAND_RE = /^(?:переключи|смени|поменяй|выбери|зміни|перемкни|обери|switch|change|set|ändere|aendere|wechsel|wechsle|stell|stelle|setz|setze|wähl|waehl|wähle|waehle)\s+(?:(?:die\s+)?(?:sprache\s+der\s+antworten|sprache\s+für\s+antworten|antwortsprache)|язык\s+ответов|мову\s+відповідей|response\s+language)(?=$|\s)/u;

const COMMAND_LEADING_MODIFIER_RE = /^(?:пожалуйста|будь\s+ласка|please|bitte|теперь|отныне|відтепер|надалі|now|from\s+now\s+on|ab\s+jetzt|ab\s+sofort|von\s+jetzt\s+an|künftig|kuenftig|ab\s+heute)(?=$|\s)/u;

const TARGET_MODIFIER_RE = /^(?:пожалуйста|будь\s+ласка|please|bitte|теперь|отныне|відтепер|надалі|now|from\s+now\s+on|ab\s+jetzt|ab\s+sofort|von\s+jetzt\s+an|со\s+мной|зі\s+мною|with\s+me|mit\s+mir|für\s+mich|fuer\s+mich|mir|uns)(?=$|\s)/u;

const LANGUAGE_TARGETS: Array<{
  language: ResponseLanguage;
  pattern: RegExp;
}> = [
  {
    language: "ru",
    pattern: /^(?:(?:(?:язык(?:\s+ответов)?|мову(?:\s+відповідей)?|(?:response\s+)?language|(?:die\s+)?(?:antwortsprache|sprache\s+der\s+antworten|sprache\s+für\s+antworten))\s+(?:на|to|auf|in)\s+)?(?:русский(?:\s+язык)?|російську(?:\s+мову)?|russian)|по[-\s]?русски|на\s+русском(?:\s+языке)?|на\s+русский(?:\s+язык)?|російською|на\s+російську(?:\s+мову)?|російська(?:\s+мова)?|in\s+russian|to\s+russian|auf\s+russisch|ins\s+russische|russisch)(?:\s+(?:sprechen|reden|antworten|пожалуйста|будь\s+ласка|please|bitte|mit\s+mir|with\s+me))?$/u,
  },
  {
    language: "uk",
    pattern: /^(?:(?:(?:язык(?:\s+ответов)?|мову(?:\s+відповідей)?|(?:response\s+)?language|(?:die\s+)?(?:antwortsprache|sprache\s+der\s+antworten|sprache\s+für\s+antworten))\s+(?:на|to|auf|in)\s+)?(?:украинский(?:\s+язык)?|українську(?:\s+мову)?|ukrainian)|по[-\s]?украински|на\s+украинском(?:\s+языке)?|на\s+украинский(?:\s+язык)?|українською|на\s+українську(?:\s+мову)?|українська(?:\s+мова)?|in\s+ukrainian|to\s+ukrainian|auf\s+ukrainisch|ins\s+ukrainische|ukrainisch)(?:\s+(?:sprechen|reden|antworten|пожалуйста|будь\s+ласка|please|bitte|mit\s+mir|with\s+me))?$/u,
  },
  {
    language: "en",
    pattern: /^(?:(?:(?:язык(?:\s+ответов)?|мову(?:\s+відповідей)?|(?:response\s+)?language|(?:die\s+)?(?:antwortsprache|sprache\s+der\s+antworten|sprache\s+für\s+antworten))\s+(?:на|to|auf|in)\s+)?(?:английский(?:\s+язык)?|англійську(?:\s+мову)?|english)|по[-\s]?английски|на\s+английском(?:\s+языке)?|на\s+английский(?:\s+язык)?|англійською|на\s+англійську(?:\s+мову)?|англійська(?:\s+мова)?|in\s+english|to\s+english|auf\s+englisch|ins\s+englische|englisch)(?:\s+(?:sprechen|reden|antworten|пожалуйста|будь\s+ласка|please|bitte|mit\s+mir|with\s+me))?$/u,
  },
  {
    language: "de",
    pattern: /^(?:(?:(?:язык(?:\s+ответов)?|мову(?:\s+відповідей)?|(?:response\s+)?language|(?:die\s+)?(?:antwortsprache|sprache\s+der\s+antworten|sprache\s+für\s+antworten))\s+(?:на|to|auf|in)\s+)?deutsch|german|auf\s+deutsch|ins\s+deutsche|in\s+german|to\s+german|немецк(?:ий|ом|ого|ому)|по[-\s]?немецки|на\s+немецком(?:\s+языке)?|німецьк(?:у|ою|а|ою)|німецькою|на\s+німецьку(?:\s+мову)?)(?:\s+(?:sprechen|reden|antworten|пожалуйста|будь\s+ласка|please|bitte|mit\s+mir|with\s+me))?$/u,
  },
];

export function normalizeResponseLanguage(value: unknown): ResponseLanguage {
  return value === "uk" || value === "en" || value === "ru" || value === "de"
    ? value
    : DEFAULT_RESPONSE_LANGUAGE;
}

/**
 * Recognize only an explicit request to change LOOI's persistent answer
 * language. Ordinary translation questions intentionally do not match.
 */
export function detectLanguageSwitchCommand(transcript: string): ResponseLanguage | null {
  const normalized = transcript
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  let commandText = normalized;
  while (COMMAND_LEADING_MODIFIER_RE.test(commandText)) {
    commandText = commandText.replace(COMMAND_LEADING_MODIFIER_RE, "").trim();
  }

  const command = RESPONSE_SETTING_COMMAND_RE.exec(commandText)
    ?? POLITE_SWITCH_COMMAND_RE.exec(commandText)
    ?? DIRECT_SWITCH_COMMAND_RE.exec(commandText);
  if (!command) {
    return null;
  }

  let target = commandText.slice(command[0].length).trim();
  while (TARGET_MODIFIER_RE.test(target)) {
    target = target.replace(TARGET_MODIFIER_RE, "").trim();
  }
  return LANGUAGE_TARGETS.find(({ pattern }) => pattern.test(target))?.language ?? null;
}

export function getLanguageSwitchAcknowledgement(language: ResponseLanguage): string {
  if (language === "uk") return "Добре, говоритиму українською.";
  if (language === "en") return "Okay, I'll speak English.";
  if (language === "de") return "Alles klar, ich spreche ab jetzt Deutsch.";
  return "Хорошо, буду говорить по-русски.";
}

export function getResponseLanguageName(language: ResponseLanguage): string {
  if (language === "uk") return "Ukrainian";
  if (language === "en") return "English";
  if (language === "de") return "German";
  return "Russian";
}
