/**
 * Reconciles the provider's assistant transcript with words recognized from
 * the PCM that is actually sent to the speaker. A section is exposed only
 * after its final ASR word timestamp is behind the native playback head.
 */
export type AssistantSpeechWord = {
  word: string;
  startMs: number;
  endMs: number;
  confidence: number;
};

export type AssistantSpeechRecognition = {
  responseId: string;
  sessionId?: string;
  generation: number;
  language: string;
  words: AssistantSpeechWord[];
  endpoint: boolean;
  audioDurationMs: number;
};

export type SpeechExpressionTrackerOptions = {
  responseId: string;
  sessionId: string;
  generation: number;
  language: string;
  onHeard: (text: string | null) => void;
  onInvalidated?: (reason: string) => void;
};

type TranscriptSection = { text: string; tokens: string[] };
type TimedToken = AssistantSpeechWord & { token: string };

const MAX_TRANSCRIPT_CHARACTERS = 8_192;
const MAX_RESPONSE_DURATION_MS = 180_000;
const MAX_WORDS = 2_048;
const MIN_WORD_CONFIDENCE = 0.42;
const MIN_MEAN_CONFIDENCE = 0.7;
const MIN_SINGLE_WORD_CONFIDENCE = 0.88;
const MAX_SEMANTIC_UPDATES = 2;

function tokenize(value: string): string[] {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

function splitTranscriptSections(text: string): TranscriptSection[] {
  const bounded = text.slice(0, MAX_TRANSCRIPT_CHARACTERS);
  // Retain sentence punctuation for the face's existing speech-mood rules.
  // Newlines also end a section; unfinished trailing text is never released.
  const matches = bounded.match(/[^.!?…\n]+(?:\.(?=\d)[^.!?…\n]+)*(?:[.!?…]+|(?=\n|$))/gu) ?? [];
  return matches
    .map((section) => section.trim())
    .filter(Boolean)
    .map((section) => ({ text: section, tokens: tokenize(section) }))
    .filter((section) => section.tokens.length > 0);
}

/**
 * Budget TTS has no exposed PCM tap for local ASR. Keep its spoken sections
 * bounded by requesting at most three sentence clips. The requested text is
 * an exact clip contract, so the first two may appear when their own native
 * playback starts and are cleared when that clip ends.
 */
export function splitBudgetSpeechSections(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  // Numeric separators belong to the spoken value, not a new speech clip.
  const sentences = (trimmed.match(/[^.!?…\n]+(?:\.(?=\d)[^.!?…\n]+)*(?:[.!?…]+|(?=\n|$))/gu) ?? [trimmed])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length <= 3) return sentences;
  return [sentences[0], sentences[1], sentences.slice(2).join(" ")];
}

function wordKey(word: TimedToken): string {
  return `${word.token}\u0000${word.startMs}\u0000${word.endMs}`;
}

/**
 * Bounded response-local speech gate. It deliberately gives up when local
 * recognition cannot exactly confirm the current transcript.
 */
export class SpeechExpressionTracker {
  private active = true;
  private transcript = "";
  private sections: TranscriptSection[] = [];
  private words: TimedToken[] = [];
  private wordKeys = new Set<string>();
  private nativeGeneration: number | null = null;
  private lastAudioDurationMs = 0;
  private lastPlaybackMs = 0;
  private lastSectionIndex = -1;
  private semanticUpdates = 0;
  private heardText: string | null = null;
  private partialEvent: AssistantSpeechRecognition | null = null;

  constructor(private readonly options: SpeechExpressionTrackerOptions) {}

  setNativeGeneration(generation: number): void {
    if (Number.isSafeInteger(generation) && generation >= 0) this.nativeGeneration = generation;
  }

  setTranscript(transcript: string): void {
    if (!this.active || typeof transcript !== "string") return;
    this.transcript = transcript.slice(0, MAX_TRANSCRIPT_CHARACTERS);
    this.sections = splitTranscriptSections(this.transcript);
    this.reconcile();
    if (this.active && this.partialEvent) this.reconcilePartial(this.partialEvent);
  }

  acceptRecognition(event: AssistantSpeechRecognition): void {
    if (!this.active || !event || typeof event.endpoint !== "boolean") return;
    if (event.responseId !== this.options.responseId || event.language !== this.options.language) return;
    if (event.sessionId !== undefined && event.sessionId !== this.options.sessionId) return;
    if (!Number.isSafeInteger(event.generation) || event.generation < 0) return;
    if (this.nativeGeneration !== null && event.generation !== this.nativeGeneration) return;
    if (!Number.isFinite(event.audioDurationMs) || event.audioDurationMs < this.lastAudioDurationMs
      || event.audioDurationMs > MAX_RESPONSE_DURATION_MS) {
      this.retire("invalid-audio-duration");
      return;
    }
    if (!Array.isArray(event.words)) {
      this.retire("invalid-recognition-words");
      return;
    }
    const incoming = this.parseWords(event, event.endpoint ? MAX_WORDS : 128);
    if (incoming === null) {
      this.retire("invalid-recognition-timing");
      return;
    }
    this.lastAudioDurationMs = event.audioDurationMs;
    if (!event.endpoint) {
      if (incoming.length === 0) return;
      this.partialEvent = event;
      this.reconcilePartial(event);
      return;
    }
    this.partialEvent = null;
    if (incoming.length === 0) {
      this.retire("empty-recognition-endpoint");
      return;
    }
    if (this.words.length + incoming.length > MAX_WORDS) {
      this.retire("response-word-limit");
      return;
    }
    for (const word of incoming) {
      const key = wordKey(word);
      if (this.wordKeys.has(key)) continue;
      this.wordKeys.add(key);
      this.words.push(word);
    }
    this.words.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
    this.reconcile();
  }

  private parseWords(event: AssistantSpeechRecognition, maximumWords: number): TimedToken[] | null {
    if (event.words.length > maximumWords) return null;
    const incoming: TimedToken[] = [];
    let previousEnd = -1;
    for (const word of event.words) {
      if (!word || typeof word.word !== "string" || word.word.length > 128
        || !Number.isFinite(word.startMs) || !Number.isFinite(word.endMs)
        || !Number.isFinite(word.confidence) || word.confidence < 0 || word.confidence > 1
        || word.startMs < 0 || word.endMs <= word.startMs
        || word.endMs > event.audioDurationMs + 25 || word.startMs < previousEnd - 50) return null;
      previousEnd = word.endMs;
      const tokens = tokenize(word.word);
      if (tokens.length === 0 || tokens.length > 4) return null;
      for (const token of tokens) incoming.push({ ...word, token });
    }
    return incoming;
  }

  advancePlayback(playedDurationMs: number): void {
    if (!this.active || !Number.isFinite(playedDurationMs) || playedDurationMs < this.lastPlaybackMs
      || playedDurationMs > MAX_RESPONSE_DURATION_MS) return;
    this.lastPlaybackMs = playedDurationMs;
    this.reconcile();
    if (this.active && this.partialEvent) this.reconcilePartial(this.partialEvent);
  }

  invalidate(): void {
    this.retire(null);
  }

  private retire(reason: string | null): void {
    if (!this.active) return;
    this.active = false;
    this.words = [];
    this.wordKeys.clear();
    this.partialEvent = null;
    this.sections = [];
    this.transcript = "";
    if (this.heardText !== null) {
      this.heardText = null;
      this.options.onHeard(null);
    }
    if (reason) this.options.onInvalidated?.(reason);
  }

  private reconcile(): void {
    if (!this.active || !this.sections.length || !this.words.length) return;
    const asrTokens = this.words.map((word) => word.token);
    const expectedTokens = this.sections.flatMap((section) => section.tokens);
    if (asrTokens.length > expectedTokens.length) {
      this.retire("recognition-longer-than-transcript");
      return;
    }
    for (let index = 0; index < asrTokens.length; index += 1) {
      if (asrTokens[index] !== expectedTokens[index]) {
        this.retire("transcript-recognition-mismatch");
        return;
      }
    }

    let offset = 0;
    let latestEligible: { index: number; section: TranscriptSection; words: TimedToken[] } | null = null;
    let nextStartedIndex: number | null = null;
    for (let index = 0; index < this.sections.length; index += 1) {
      const section = this.sections[index];
      const end = offset + section.tokens.length;
      if (end > asrTokens.length) break;
      const matchedWords = this.words.slice(offset, end);
      offset = end;
      if (index > this.lastSectionIndex && nextStartedIndex === null
        && matchedWords[0].startMs <= this.lastPlaybackMs) nextStartedIndex = index;
      if (matchedWords.some((word) => word.confidence < MIN_WORD_CONFIDENCE)) continue;
      const meanConfidence = matchedWords.reduce((sum, word) => sum + word.confidence, 0) / matchedWords.length;
      if (meanConfidence < MIN_MEAN_CONFIDENCE
        || (matchedWords.length === 1 && meanConfidence < MIN_SINGLE_WORD_CONFIDENCE)) continue;
      if (matchedWords[matchedWords.length - 1].endMs <= this.lastPlaybackMs) {
        latestEligible = { index, section, words: matchedWords };
      }
    }

    // Once reliable timestamps show that the next section has started, retire
    // the previous mood while this new passage is still being heard.
    if (this.heardText !== null && nextStartedIndex !== null
      && (!latestEligible || latestEligible.index < nextStartedIndex)) {
      this.heardText = null;
      this.options.onHeard(null);
    }

    if (!latestEligible || latestEligible.index <= this.lastSectionIndex
      || this.semanticUpdates >= MAX_SEMANTIC_UPDATES) return;

    this.lastSectionIndex = latestEligible.index;
    if (this.heardText === latestEligible.section.text) return;
    this.semanticUpdates += 1;
    this.heardText = latestEligible.section.text;
    this.options.onHeard(this.heardText);
  }

  private reconcilePartial(event: AssistantSpeechRecognition): void {
    if (!this.active || !this.sections.length || !this.heardText || this.lastSectionIndex < 0) return;
    const expectedTokens = this.sections.flatMap((section) => section.tokens);
    const finalTokens = this.words.map((word) => word.token);
    for (let index = 0; index < finalTokens.length; index += 1) {
      if (finalTokens[index] !== expectedTokens[index]) {
        this.retire("transcript-recognition-mismatch");
        return;
      }
    }

    let boundaryOffset = 0;
    for (let index = 0; index <= this.lastSectionIndex; index += 1) {
      boundaryOffset += this.sections[index]?.tokens.length ?? 0;
    }
    const partialWords = this.parseWords(event, 128);
    if (!partialWords?.length) return;
    for (let index = 0; index < partialWords.length; index += 1) {
      const expectedIndex = finalTokens.length + index;
      if (expectedIndex >= expectedTokens.length || partialWords[index].token !== expectedTokens[expectedIndex]) {
        // A tentative word cannot authorize a new expression, but its valid
        // audio timestamp still tells us the old passage has ended. Keep the
        // partial event until the playhead reaches this uncertain continuation.
        if (expectedIndex >= boundaryOffset && partialWords[index].startMs <= this.lastPlaybackMs) {
          this.heardText = null;
          this.options.onHeard(null);
        }
        return;
      }
      if (expectedIndex === boundaryOffset && partialWords[index].startMs <= this.lastPlaybackMs) {
        // Partial ASR can only retire an old mood at the next passage boundary.
        // It never releases a positive phrase or consumes a response update.
        this.heardText = null;
        this.options.onHeard(null);
        return;
      }
    }
  }
}

export function createSpeechExpressionTracker(options: SpeechExpressionTrackerOptions): SpeechExpressionTracker {
  return new SpeechExpressionTracker(options);
}
