/**
 * A small on-device store for spoken lines that repeat, so a fixed sentence is
 * synthesized once and afterwards plays without a network call. Storage is
 * injected; the production store lives in speech-clip-cache-storage.ts.
 */
export interface SpeechClipStorage {
  readBase64(name: string): Promise<string | null>;
  writeBase64(name: string, base64: string): Promise<void>;
  remove(name: string): Promise<void>;
  readIndex(): Promise<string | null>;
  writeIndex(json: string): Promise<void>;
}

export interface SpeechClipCache {
  /** The clip for exactly this request, or null. Never throws. */
  read(requestKey: string): Promise<Uint8Array | null>;
  /** Stores a clip; failures are swallowed because the line was already spoken. */
  write(requestKey: string, audio: Uint8Array): Promise<void>;
}

export const SPEECH_CLIP_CACHE_MAX_CLIPS = 160;
export const SPEECH_CLIP_CACHE_MAX_BYTES = 24 * 1024 * 1024;
/** Longer audio is not a short repeated remark and is not kept. */
export const SPEECH_CLIP_MAX_BYTES = 600 * 1024;

type IndexEntry = { bytes: number; usedAt: number };

/** Two independent 32-bit FNV-1a passes; enough to name a few hundred clips. */
export function speechClipName(requestKey: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ requestKey.length;
  for (let i = 0; i < requestKey.length; i += 1) {
    const code = requestKey.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ ((code << 5) | (code >>> 11)), 0x85ebca6b);
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  return btoa(chunks.join(""));
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function createSpeechClipCache(storage: SpeechClipStorage, now: () => number = Date.now): SpeechClipCache {
  let index: Map<string, IndexEntry> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  /** One operation at a time keeps the index consistent with the files. */
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };
  const loadIndex = async (): Promise<Map<string, IndexEntry>> => {
    if (index) return index;
    const loaded = new Map<string, IndexEntry>();
    try {
      const parsed: unknown = JSON.parse((await storage.readIndex()) ?? "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [name, entry] of Object.entries(parsed as Record<string, unknown>)) {
          const value = entry as Partial<IndexEntry> | null;
          if (/^[0-9a-f]{16}$/u.test(name) && value && Number.isFinite(value.bytes) && Number.isFinite(value.usedAt)) {
            loaded.set(name, { bytes: Number(value.bytes), usedAt: Number(value.usedAt) });
          }
        }
      }
    } catch { /* A damaged index only means the clips are synthesized again. */ }
    index = loaded;
    return loaded;
  };
  const saveIndex = (entries: Map<string, IndexEntry>) => storage.writeIndex(JSON.stringify(Object.fromEntries(entries)));

  return {
    read(requestKey) {
      return serialized(async () => {
        try {
          const name = speechClipName(requestKey);
          const entries = await loadIndex();
          const entry = entries.get(name);
          if (!entry) return null;
          const base64 = await storage.readBase64(name);
          if (!base64) {
            entries.delete(name);
            await saveIndex(entries).catch(() => undefined);
            return null;
          }
          entry.usedAt = now();
          void saveIndex(entries).catch(() => undefined);
          return base64ToBytes(base64);
        } catch { return null; }
      });
    },
    write(requestKey, audio) {
      return serialized(async () => {
        try {
          if (audio.length === 0 || audio.length > SPEECH_CLIP_MAX_BYTES) return;
          const name = speechClipName(requestKey);
          const entries = await loadIndex();
          await storage.writeBase64(name, bytesToBase64(audio));
          entries.set(name, { bytes: audio.length, usedAt: now() });
          const byAge = [...entries.entries()].sort((left, right) => left[1].usedAt - right[1].usedAt);
          let total = byAge.reduce((sum, [, entry]) => sum + entry.bytes, 0);
          while (byAge.length > 1 && (byAge.length > SPEECH_CLIP_CACHE_MAX_CLIPS || total > SPEECH_CLIP_CACHE_MAX_BYTES)) {
            const [oldest, entry] = byAge.shift()!;
            if (oldest === name) { byAge.push([oldest, entry]); break; }
            entries.delete(oldest);
            total -= entry.bytes;
            await storage.remove(oldest).catch(() => undefined);
          }
          await saveIndex(entries);
        } catch { /* The line was spoken; a failed save only costs one later synthesis. */ }
      });
    },
  };
}
