import type { ResponseLanguage } from "../language/response-language";

export const HERMES_COMPLETION_QUESTIONS: Record<ResponseLanguage, string> = {
  de: "Deine Aufgabe ist fertig. Möchtest du das Ergebnis hören?",
  en: "Your task is ready. Would you like to hear the result?",
  ru: "Твоя задача готова. Хочешь услышать результат?",
  uk: "Твоє завдання готове. Хочеш почути результат?",
};
