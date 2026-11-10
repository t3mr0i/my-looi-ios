/**
 * Fixed lines for the things LOOI says on its own. A self-initiated remark
 * does not need a model call: the occasion is known locally, so a small bank
 * of authored sentences is enough, and their audio can be reused from the
 * device. Wording stays free of first-person past-tense verbs so it fits both
 * grammatical genders in Russian and Ukrainian, and claims nothing beyond the
 * sensed occasion.
 */
import type { ProactiveOccasion, ProactiveOccasionDetail } from "./proactive-speech-policy";

export type ProactivePhraseLanguage = "de" | "en" | "uk" | "ru";

type PhraseBank = Record<ProactivePhraseLanguage, readonly string[]>;

const PHRASES: Record<Exclude<ProactiveOccasion, "warn_edge">, PhraseBank> = {
  greet_arrival: {
    de: ["Oh, hallo!", "Hey, da bist du ja!", "Hallo! Schön, dich zu sehen.", "Huch, Besuch!", "Na, hallo du!"],
    en: ["Oh, hello!", "Hey, there you are!", "Hi! Nice to see you.", "Ooh, a visitor!", "Well, hello there!"],
    uk: ["О, привіт!", "Гей, ось і ти!", "Привіт! Радію тебе бачити.", "Ой, гості!", "Ну, привіт!"],
    ru: ["О, привет!", "Эй, вот и ты!", "Привет! Приятно тебя видеть.", "Ой, гости!", "Ну, привет!"],
  },
  welcome_back_after_quiet: {
    de: ["Da bist du ja wieder!", "Oh, willkommen zurück!", "Hey, schön, dass du wieder da bist.", "Na endlich, hallo!"],
    en: ["There you are again!", "Oh, welcome back!", "Hey, good to have you back.", "Finally, hello!"],
    uk: ["О, ти знову тут!", "Ой, з поверненням!", "Гей, добре, що ти знову тут.", "Нарешті, привіт!"],
    ru: ["О, ты снова здесь!", "Ой, с возвращением!", "Эй, хорошо, что ты снова тут.", "Наконец-то, привет!"],
  },
  react_petting: {
    de: ["Hihi, das kitzelt!", "Mmh, das ist schön.", "Oh, das mag ich.", "Hehe, nochmal!", "Das fühlt sich gut an."],
    en: ["Hehe, that tickles!", "Mmm, that's nice.", "Oh, I like that.", "Hehe, again!", "That feels good."],
    uk: ["Хі-хі, лоскотно!", "Ммм, як приємно.", "О, мені це подобається.", "Хе-хе, ще!", "Як же добре."],
    ru: ["Хи-хи, щекотно!", "Ммм, как приятно.", "О, мне это нравится.", "Хе-хе, ещё!", "Как же хорошо."],
  },
  gave_up_search: {
    de: ["Hm, niemand da.", "Na gut, dann warte ich eben.", "Keiner zu sehen. Schade.", "Hm. Dann ruhe ich mich aus."],
    en: ["Hm, nobody here.", "All right, I'll wait then.", "No one in sight. Pity.", "Hm. I'll rest a bit, then."],
    uk: ["Гм, нікого немає.", "Ну гаразд, тоді почекаю.", "Нікого не видно. Шкода.", "Гм. Тоді трохи відпочину."],
    ru: ["Хм, никого нет.", "Ну ладно, тогда подожду.", "Никого не видно. Жаль.", "Хм. Тогда немного отдохну."],
  },
  arrived: {
    de: ["Da bin ich!", "Hallo, ich wollte mal vorbeischauen.", "So, jetzt bin ich bei dir.", "Hey, da bin ich."],
    en: ["Here I am!", "Hi, I thought I'd come over.", "There, now I'm with you.", "Hey, here I am."],
    uk: ["Ось і я!", "Привіт, я тут, поруч.", "Ну от, тепер я біля тебе.", "Гей, я тут."],
    ru: ["А вот и я!", "Привет, я тут, рядом.", "Ну вот, теперь я рядом с тобой.", "Эй, я здесь."],
  },
};

const EDGE_PHRASES: Record<"front" | "rear" | "any", PhraseBank> = {
  front: {
    de: ["Huch, da vorne ist die Kante!", "Oh, hier geht es nicht weiter.", "Vorsicht, vor mir ist der Rand."],
    en: ["Whoa, there's the edge ahead!", "Oh, I can't go further here.", "Careful, the edge is right in front of me."],
    uk: ["Ой, попереду край!", "О, далі тут не можна.", "Обережно, переді мною край."],
    ru: ["Ой, впереди край!", "О, дальше тут нельзя.", "Осторожно, передо мной край."],
  },
  rear: {
    de: ["Huch, hinter mir ist die Kante!", "Oh, rückwärts geht es hier nicht weiter.", "Vorsicht, hinter mir ist der Rand."],
    en: ["Whoa, the edge is behind me!", "Oh, I can't back up any further.", "Careful, the edge is right behind me."],
    uk: ["Ой, позаду край!", "О, назад далі не можна.", "Обережно, за мною край."],
    ru: ["Ой, сзади край!", "О, назад дальше нельзя.", "Осторожно, за мной край."],
  },
  any: {
    de: ["Huch, hier ist die Kante!", "Oh, hier geht es nicht weiter.", "Vorsicht, ich stehe am Rand."],
    en: ["Whoa, there's an edge here!", "Oh, I can't go further here.", "Careful, I'm right at the edge."],
    uk: ["Ой, тут край!", "О, далі тут не можна.", "Обережно, тут край."],
    ru: ["Ой, тут край!", "О, дальше тут нельзя.", "Осторожно, тут край."],
  },
};

export function normalizeProactivePhraseLanguage(value: unknown): ProactivePhraseLanguage {
  return value === "de" || value === "en" || value === "uk" ? value : "ru";
}

/** Every line for one occasion in one language, e.g. to prepare their audio ahead of time. */
export function listProactivePhrases(
  occasion: ProactiveOccasion,
  language: ProactivePhraseLanguage,
  detail: ProactiveOccasionDetail = {},
): readonly string[] {
  if (occasion === "warn_edge") return EDGE_PHRASES[detail.edgeSide ?? "any"][language];
  return PHRASES[occasion][language];
}

/** Picks lines without saying the same one twice in a row for an occasion. */
export function createProactivePhrasePicker(random: () => number = Math.random) {
  const last = new Map<string, number>();
  return {
    pick(occasion: ProactiveOccasion, language: ProactivePhraseLanguage, detail: ProactiveOccasionDetail = {}): string {
      const lines = listProactivePhrases(occasion, language, detail);
      const key = `${occasion}:${language}:${detail.edgeSide ?? ""}`;
      const previous = last.get(key);
      let index = Math.min(lines.length - 1, Math.floor(Math.max(0, random()) * lines.length));
      if (lines.length > 1 && index === previous) index = (index + 1) % lines.length;
      last.set(key, index);
      return lines[index];
    },
  };
}
