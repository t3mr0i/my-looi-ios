export const DEFAULT_TTS_VOICE_ID = "shimmer";
export const DEFAULT_TTS_SPEED = 1;
export const DEFAULT_TTS_STYLE_ID = "playful-robot";

export const CUTE_ROBOT_VOICE_PREFERENCES = {
  ttsVoiceId: DEFAULT_TTS_VOICE_ID,
  ttsStyleId: DEFAULT_TTS_STYLE_ID,
  ttsSpeed: DEFAULT_TTS_SPEED,
} as const;

export type TtsVoiceOption = {
  id: string;
  name: string;
  description: string;
};

export type TtsStyleId = "natural" | "playful-robot" | "bright";

export type TtsStyleOption = {
  id: TtsStyleId;
  name: string;
  description: string;
};

export const TTS_VOICE_OPTIONS: readonly TtsVoiceOption[] = [
  { id: "cedar", name: "Cedar", description: "Чёткий голос — хороший базовый вариант" },
  { id: "marin", name: "Marin", description: "Мягкий современный голос" },
  { id: "fable", name: "Fable", description: "Стоит попробовать для более сказочного персонажа" },
  { id: "shimmer", name: "Shimmer", description: "Стоит попробовать для лёгкого живого характера" },
  { id: "verse", name: "Verse", description: "Выразительный вариант для разговорного LOOI" },
  { id: "coral", name: "Coral", description: "Голос OpenAI — сравни через «Послушать»" },
  { id: "nova", name: "Nova", description: "Голос OpenAI — сравни через «Послушать»" },
  { id: "alloy", name: "Alloy", description: "Голос OpenAI — сравни через «Послушать»" },
  { id: "ash", name: "Ash", description: "Голос OpenAI — сравни через «Послушать»" },
  { id: "ballad", name: "Ballad", description: "Голос OpenAI — сравни через «Послушать»" },
  { id: "echo", name: "Echo", description: "Голос OpenAI — сравни через «Послушать»" },
  { id: "onyx", name: "Onyx", description: "Голос OpenAI — сравни через «Послушать»" },
  { id: "sage", name: "Sage", description: "Голос OpenAI — сравни через «Послушать»" },
] as const;

export const REALTIME_VOICE_IDS = [
  "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar",
] as const;

export const REALTIME_VOICE_OPTIONS: readonly TtsVoiceOption[] = REALTIME_VOICE_IDS
  .map((id) => TTS_VOICE_OPTIONS.find((voice) => voice.id === id))
  .filter((voice): voice is TtsVoiceOption => Boolean(voice));

export const TTS_STYLE_OPTIONS: readonly TtsStyleOption[] = [
  {
    id: "playful-robot",
    name: "Игровой робот",
    description: "Живой, любопытный, слегка роботизированный персонаж",
  },
  {
    id: "bright",
    name: "Весёлый",
    description: "Более энергичный и эмоциональный голос без сильного робот-эффекта",
  },
  {
    id: "natural",
    name: "Обычный",
    description: "Тёплый и естественный разговорный голос",
  },
] as const;

export const TTS_SPEED_OPTIONS = [0.85, 1, 1.15] as const;

/** Shared delivery direction for Realtime conversations and the Settings preview. */
export function getTtsStyleInstructions(styleId: unknown = DEFAULT_TTS_STYLE_ID): string {
  if (styleId === "natural") {
    return "Speak in a warm, natural conversational voice, with relaxed pacing and clear pronunciation.";
  }
  if (styleId === "bright") {
    return "Speak in a bright, cheerful, energetic voice with expressive intonation and clear pronunciation. Keep the pacing comfortable, and soften the energy for serious or sensitive moments.";
  }
  return [
    "Sound like a cute, small, friendly robot companion: use a sweet, light voice in a slightly higher register, a gentle smile, and playful curiosity.",
    "Use a subtle synthetic cadence with tidy articulation, small melodic rises, and soft sentence endings. Keep the volume gentle and the pacing relaxed.",
    "Let timing and intonation follow the actual moment: a little lift for a playful idea, a thoughtful pause when useful, and a quieter steady tone for serious news. Vary these naturally rather than using the same singsong pattern every time.",
    "Preserve clear pronunciation and natural word stress in the requested language, especially German. Let the robot character come from vocal delivery, not from added words.",
    "Do not add spoken beeps, sound-effect words, baby talk, exaggerated squeaking, or laughter to every reply. For serious or sensitive topics, keep the same gentle voice with calm, restrained delivery.",
  ].join(" ");
}

const TTS_PREVIEW_TEXT = {
  ru: "Привет! Вот так теперь звучит мой голос.",
  uk: "Привіт! Ось так тепер звучить мій голос.",
  en: "Hi! This is how my voice sounds now.",
  de: "Hallo! So klingt meine Stimme jetzt.",
} as const;

export function getTtsPreviewText(language: keyof typeof TTS_PREVIEW_TEXT): string {
  return TTS_PREVIEW_TEXT[language];
}

const TTS_VOICE_IDS = new Set(TTS_VOICE_OPTIONS.map((voice) => voice.id));
const REALTIME_VOICE_ID_SET = new Set<string>(REALTIME_VOICE_IDS);
const TTS_STYLE_IDS = new Set<TtsStyleId>(TTS_STYLE_OPTIONS.map((style) => style.id));

export function isSupportedTtsVoiceId(value: string): boolean {
  return TTS_VOICE_IDS.has(value);
}

export function isSupportedRealtimeVoiceId(value: string): boolean {
  return REALTIME_VOICE_ID_SET.has(value);
}

export function isSupportedTtsStyleId(value: string): value is TtsStyleId {
  return TTS_STYLE_IDS.has(value as TtsStyleId);
}

export function normalizeTtsSpeed(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TTS_SPEED;
  return Math.min(1.5, Math.max(0.5, Math.round(value * 100) / 100));
}
