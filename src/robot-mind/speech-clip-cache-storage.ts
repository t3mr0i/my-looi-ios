import * as FileSystem from "expo-file-system/legacy";
import { createSpeechClipCache, type SpeechClipCache, type SpeechClipStorage } from "./speech-clip-cache";

const DIRECTORY = `${FileSystem.cacheDirectory ?? ""}looi-speech-clips/`;
const INDEX = `${DIRECTORY}index.json`;
let ready: Promise<void> | null = null;

function ensureDirectory(): Promise<void> {
  ready ??= FileSystem.makeDirectoryAsync(DIRECTORY, { intermediates: true }).catch(() => undefined);
  return ready;
}

async function readIfPresent(uri: string, encoding?: FileSystem.EncodingType): Promise<string | null> {
  await ensureDirectory();
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) return null;
  return FileSystem.readAsStringAsync(uri, encoding ? { encoding } : undefined);
}

/** The OS may clear the cache directory; a missing clip is simply synthesized again. */
const storage: SpeechClipStorage = {
  readBase64: (name) => readIfPresent(`${DIRECTORY}${name}.wav`, FileSystem.EncodingType.Base64),
  async writeBase64(name, base64) {
    await ensureDirectory();
    await FileSystem.writeAsStringAsync(`${DIRECTORY}${name}.wav`, base64, { encoding: FileSystem.EncodingType.Base64 });
  },
  remove: (name) => FileSystem.deleteAsync(`${DIRECTORY}${name}.wav`, { idempotent: true }),
  readIndex: () => readIfPresent(INDEX),
  async writeIndex(json) {
    await ensureDirectory();
    await FileSystem.writeAsStringAsync(INDEX, json);
  },
};

export const speechClipCache: SpeechClipCache = createSpeechClipCache(storage);
