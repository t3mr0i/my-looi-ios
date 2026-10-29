import { CHARACTER_SCENES, normalizeSceneText, type CharacterScene, type CharacterSceneId } from "./character-scene-catalog";
import { parseCharacterActionRequest } from "./character-action";

export type CharacterSceneSelection = { kind: CharacterSceneId; source: "voice" | "context" };
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const MATCHES = CHARACTER_SCENES.flatMap(scene => scene.context.map(phrase => ({
  scene, phrase: normalizeSceneText(phrase),
  regex: new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escape(normalizeSceneText(phrase))}(?=$|[^\\p{L}\\p{N}_])`, "u"),
})));
const LABELS = new Map(CHARACTER_SCENES.flatMap(scene => Object.values(scene.label).map(label => [normalizeSceneText(label), scene.id] as const)));

function addressedText(text: string, name: string): string {
  const names = [name, "looi", "louis", "louie", "луи", "луї"].filter(Boolean).map(value => escape(normalizeSceneText(value)));
  return normalizeSceneText(text).replace(new RegExp(`^(?:hey[, ]+)?(?:${names.join("|")})[,!: ]+`, "u"), "")
    .replace(/^(?:bitte|please)[, ]+/u, "").replace(/[.!?]+$/u, "").trim();
}

/** No generation, sensor inference or free-form model commands. Uncertain turns stay neutral. */
export function selectCharacterScene(text: string, robotName = "LOOI"): CharacterSceneSelection | null {
  if (typeof text !== "string" || !text.trim() || text.length > 600 || /["“”„«»]|(?:^|[^\p{L}])['‘‚][^\n]+['’](?=$|[^\p{L}])/u.test(text)) return null;
  const normalized = addressedText(text, robotName);
  if (/(?:^|[^\p{L}])(?:nicht|kein\p{L}*|not|never|don't|dont|не|ні)(?=$|[^\p{L}])/u.test(normalized)) return null;
  const quick = parseCharacterActionRequest(text, robotName);
  if (quick) return { kind: quick, source: "voice" };
  const explicit = normalized.replace(/^(?:zeig(?:e)? (?:mir )?(?:(?:das )?bild |(?:die )?szene )?|show (?:me )?(?:the )?(?:picture |scene )?|покажи (?:(?:мені|мне) )?(?:(?:картинку|сцену) )?)/u, "");
  if (explicit !== normalized) {
    const id = LABELS.get(explicit);
    return id ? { kind: id, source: "voice" } : null;
  }
  // Definitions, hypotheticals and reported examples do not describe this moment.
  if (/^(?:was bedeutet|was heißt|what does|what is|wenn |if |якщо |если |що означає|что значит|sag(?:e)? |say |repeat |wiederhole |скажи |повтори |erzähl\p{L}* |schreib\p{L}* |tell |write |розкажи |напиши |расскажи )/u.test(normalized)
    || /^(?:kannst|könntest|can|could|would|wie übersetzt|how do you say)\s/u.test(normalized)
    || /(?:^|[^\p{L}])(?:wenn|if|якщо|если|angenommen|stell dir vor|im beispiel|in der geschichte|in einer geschichte|in the story|in a story|for example|what if|suppose|imagine|уяви|припустимо|представь|допустим)(?=$|[^\p{L}])/u.test(normalized)
    || /(?:^|[^\p{L}])(?:sagt|sagte|says|said|каже|казав|сказав|сказала|сказал)(?=$|[^\p{L}])/u.test(normalized)) return null;
  if (/^(?:übersetz\p{L}*|(?:please )?translate|переклади|переведи)\s/u.test(normalized)) return { kind: "translation", source: "context" };
  const matched = new Map<CharacterSceneId, { scene: CharacterScene; length: number }>();
  for (const entry of MATCHES) {
    if (entry.regex.test(normalized) && entry.phrase.length > (matched.get(entry.scene.id)?.length ?? 0)) {
      matched.set(entry.scene.id, { scene: entry.scene, length: entry.phrase.length });
    }
  }
  const rank = (scene: CharacterScene) => scene.id === "sympathy" ? 100
    : ["concerned", "angry", "annoyed"].includes(scene.mood) ? 80 : scene.category === "feelings" ? 60 : 0;
  const choices = [...matched.values()].sort((a, b) => rank(b.scene) - rank(a.scene) || b.length - a.length);
  if (!choices.length) return null;
  const [best, second] = choices;
  // Pet or hobby mentions inside an unclassified distress report stay neutral.
  if (rank(best.scene) < 80 && /(?:^|[^\p{L}])(?:sick|ill|hurt|died|missing|afraid|krank|verletzt|gestorben|vermisst|angst|болен|больна|заболел|умер|умерла|хворий|хвора|помер|померла)(?=$|[^\p{L}])/u.test(normalized)) return null;
  if (second && rank(best.scene) === 0 && rank(second.scene) === 0 && best.scene.category !== second.scene.category) return null;
  return { kind: best.scene.id, source: "context" };
}
