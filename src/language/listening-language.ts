import type { ResponseLanguage } from "./response-language";

export type ListeningLanguage = "ru" | "uk" | "en" | "de";

export const DEFAULT_LISTENING_LANGUAGE: ListeningLanguage = "ru";

export const LISTENING_LANGUAGE_OPTIONS: ReadonlyArray<{
  id: ListeningLanguage;
  shortLabel: string;
  label: string;
}> = [
  { id: "ru", shortLabel: "RU", label: "Русский" },
  { id: "uk", shortLabel: "UA", label: "Українська" },
  { id: "en", shortLabel: "EN", label: "English" },
  { id: "de", shortLabel: "DE", label: "Deutsch" },
];

export function normalizeListeningLanguage(value: unknown): ListeningLanguage {
  return value === "uk" || value === "en" || value === "ru" || value === "de"
    ? value
    : DEFAULT_LISTENING_LANGUAGE;
}

const LANGUAGE_TARGETS: Array<{ language: ListeningLanguage; pattern: RegExp }> = [
  { language: "ru", pattern: /(?:русск(?:ий|ом|ого)|російськ(?:у|ою)|russian|russisch(?:e|en)?)/u },
  { language: "uk", pattern: /(?:украинск(?:ий|ом|ого)|українськ(?:у|ою)|ukrainian|ukrainisch(?:e|en)?)/u },
  { language: "en", pattern: /(?:английск(?:ий|ом|ого)|англійськ(?:у|ою)|english|englisch(?:e|en)?)/u },
  { language: "de", pattern: /(?:deutsch(?:e|en|em|er)?|german|немецк(?:ий|ом|ого|ому)|по[-\s]?немецки|німецьк(?:у|ою|а)|німецькою)/u },
];

const RESPONSE_LANGUAGE_SCOPE_RE = /(?:\bresponse\s+language\b|\bantwortsprache\b|\bsprache\s+(?:der\s+antworten|für\s+antworten)\b|язык\s+ответов|мову\s+відповідей)/u;
const NEGATED_LANGUAGE_SWITCH_RE = /(?:^|\s)(?:not|never|don't|dont|do\s+not|cannot|can't|nicht|nie|niemals|kein(?:e|en|er|es)?|не|ни|никогда|нельзя|ні|ніколи)(?=$|\s)/u;

/**
 * Change the language LOOI expects from the user. This intentionally does not
 * change the language used for responses.
 */
export function detectListeningLanguageSwitchCommand(transcript: string): ListeningLanguage | null {
  const normalized = transcript
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  // The response-language parser runs after this one. Keep explicit response
  // settings out of the broader "change the language" listening command so a
  // phrase such as "Ändere die Sprache der Antworten auf Deutsch" cannot
  // change only the microphone language.
  if (RESPONSE_LANGUAGE_SCOPE_RE.test(normalized) || NEGATED_LANGUAGE_SWITCH_RE.test(normalized)) {
    return null;
  }

  const isListeningCommand =
    /^(?:(?:пожалуйста|будь\s+ласка|please|bitte)\s+)?(?:переключи|смени|поменяй|выбери|установи|зміни|перемкни|обери|change|switch|set|ändere|aendere|wechsel|wechsle|stell|stelle|setz|setze|wähl|waehl|wähle|waehle)\s+(?:(?:язык|мову|language)(?!\s+(?:ответов|відповідей|response))|(?:die\s+)?(?:sprache|eingabesprache|spracheingabe|erkennungssprache|hörsprache|hoersprache))(?:\s+(?:распознавания|ввода|слушания|розпізнавання|вводу|listening|input))?(?=$|\s)/u.test(normalized) ||
    /^(?:(?:пожалуйста|будь\s+ласка|please)\s+)?(?:перейди|перейти|switch)\s+(?:на|to)(?=$|\s)/u.test(normalized) ||
    /^(?:(?:пожалуйста|будь\s+ласка|please|bitte)\s+)?(?:слушай|слухай|понимай|розпізнавай|распознавай|listen|understand|hör(?:e)?(?:\s+mir)?|hoer(?:e)?(?:\s+mir)?|versteh(?:e)?(?:\s+mich)?|erkenne(?:\s+mich)?)(?=$|\s)/u.test(normalized) ||
    /^(?:(?:язык|мова|language)\s+(?:ввода|слушания|распознавания|вводу|розпізнавання|input|listening)(?=$|\s)|(?:die\s+)?(?:eingabesprache|spracheingabe|erkennungssprache|hörsprache|hoersprache)(?=$|\s))/u.test(normalized);

  if (!isListeningCommand) return null;
  return LANGUAGE_TARGETS.find(({ pattern }) => pattern.test(normalized))?.language ?? null;
}

export function getListeningLanguageSwitchAcknowledgement(
  listeningLanguage: ListeningLanguage,
  responseLanguage: ResponseLanguage
): string {
  const germanTargets: Record<ListeningLanguage, string> = {
    ru: "Russisch",
    uk: "Ukrainisch",
    en: "Englisch",
    de: "Deutsch",
  };
  if (responseLanguage === "de") return `Alles klar, ich höre ab jetzt ${germanTargets[listeningLanguage]}.`;
  const target = listeningLanguage === "uk"
    ? responseLanguage === "en" ? "Ukrainian" : responseLanguage === "uk" ? "українську" : "украинский"
    : listeningLanguage === "en"
      ? responseLanguage === "en" ? "English" : responseLanguage === "uk" ? "англійську" : "английский"
      : listeningLanguage === "de"
        ? responseLanguage === "en" ? "German" : responseLanguage === "uk" ? "німецьку" : "немецкий"
        : responseLanguage === "en" ? "Russian" : responseLanguage === "uk" ? "російську" : "русский";

  if (responseLanguage === "en") return `Okay, I'll listen for ${target}.`;
  if (responseLanguage === "uk") return `Добре, тепер слухаю ${target}.`;
  return `Хорошо, теперь слушаю ${target}.`;
}
