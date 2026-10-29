import { CHARACTER_SCENE_ROWS } from "./character-scene-data";
import type { InterfaceLanguage } from "../i18n/ui-language";
import type { CharacterMood } from "./character-reaction";

export const CHARACTER_SCENE_CATEGORIES = {
  food: { de: "Essen & Trinken", en: "Food & drink", uk: "Їжа й напої", ru: "Еда и напитки" },
  feelings: { de: "Gefühle", en: "Feelings", uk: "Почуття", ru: "Чувства" },
  conversation: { de: "Gespräche", en: "Conversation", uk: "Розмова", ru: "Разговор" },
  learning: { de: "Lernen & Arbeit", en: "Learning & work", uk: "Навчання й робота", ru: "Учёба и работа" },
  play: { de: "Freizeit & Kreativität", en: "Play & creativity", uk: "Дозвілля й творчість", ru: "Досуг и творчество" },
  travel: { de: "Bewegung & Unterwegs", en: "Movement & travel", uk: "Рух і подорожі", ru: "Движение и поездки" },
  nature: { de: "Natur & Wetter", en: "Nature & weather", uk: "Природа й погода", ru: "Природа и погода" },
  home: { de: "Zuhause & Fürsorge", en: "Home & care", uk: "Дім і турбота", ru: "Дом и забота" },
  occasions: { de: "Feste & Begegnungen", en: "Occasions & people", uk: "Свята й зустрічі", ru: "Праздники и встречи" },
  technology: { de: "Technik & System", en: "Technology & system", uk: "Техніка й система", ru: "Техника и система" },
} as const;

export type CharacterSceneId = typeof CHARACTER_SCENE_ROWS[number][0];
export type CharacterSceneCategory = keyof typeof CHARACTER_SCENE_CATEGORIES;
export type CharacterSceneMotion = "sip" | "coffee" | "bite" | "read" | "hold" | "offer" | "inspect" | "cheer" | "rest";
export type CharacterSceneMood = CharacterMood | "concerned";
export type CharacterScene = {
  id: CharacterSceneId;
  category: CharacterSceneCategory;
  icon: string;
  label: Record<InterfaceLanguage, string>;
  mood: CharacterSceneMood;
  motion: CharacterSceneMotion;
  /** Deliberately specific human phrases. Empty means manual selection only. */
  context: readonly string[];
};

export const CHARACTER_SCENES: readonly CharacterScene[] = CHARACTER_SCENE_ROWS.map(row => ({
  id: row[0], category: row[1], icon: row[2],
  label: { de: row[3], en: row[4], uk: row[5], ru: row[6] },
  mood: row[7], motion: row[8], context: row[9],
}));
const BY_ID = new Map(CHARACTER_SCENES.map(scene => [scene.id, scene]));
export function isCharacterScene(value: unknown): value is CharacterSceneId {
  return typeof value === "string" && BY_ID.has(value as CharacterSceneId);
}
export function getCharacterScene(id: CharacterSceneId): CharacterScene { return BY_ID.get(id)!; }
export function characterSceneLabel(id: CharacterSceneId, language: InterfaceLanguage = "en"): string {
  return getCharacterScene(id).label[language];
}
export function normalizeSceneText(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase().replace(/[’‘]/gu, "'").replace(/\s+/gu, " ").trim();
}
const SEARCH = CHARACTER_SCENES.map(scene => ({ scene, text: normalizeSceneText([
  ...Object.values(scene.label), ...Object.values(CHARACTER_SCENE_CATEGORIES[scene.category]), ...scene.context,
].join(" ")) }));
export function findCharacterScenes(query: string, category?: CharacterSceneCategory): readonly CharacterScene[] {
  const words = normalizeSceneText(query).split(" ").filter(Boolean);
  return SEARCH.filter(({ scene, text }) => (!category || scene.category === category)
    && words.every(word => text.includes(word))).map(({ scene }) => scene);
}
