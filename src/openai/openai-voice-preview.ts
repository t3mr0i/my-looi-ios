import { getTtsPreviewText, isSupportedRealtimeVoiceId, DEFAULT_TTS_SPEED, DEFAULT_TTS_STYLE_ID, type TtsStyleId } from "../voice/tts-voices";
import type { ResponseLanguage } from "../language/response-language";
import { speakOpenAiText } from "./openai-speech";

/** Keep the established Settings API while sharing the cloud speech player. */
export async function playOpenAiRealtimeVoicePreview(
  voiceId: string,
  language: ResponseLanguage,
  styleId: TtsStyleId = DEFAULT_TTS_STYLE_ID,
  speed = DEFAULT_TTS_SPEED,
  signal?: AbortSignal,
): Promise<void> {
  if (!isSupportedRealtimeVoiceId(voiceId)) {
    throw new Error(`Unsupported Realtime voice: ${voiceId}`);
  }
  await speakOpenAiText(getTtsPreviewText(language), { voiceId, styleId, speed, signal });
}
