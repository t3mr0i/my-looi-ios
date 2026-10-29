import { NativeModule, requireNativeModule } from "expo";

export type VoskCommandEvent = {
  text: string;
  partial: boolean;
  sequence: number;
  processingMs: number;
  sessionId: number;
  resetGeneration: number;
  samplesSinceReset: number;
  queuedChunks: number;
  droppedChunks: number;
  endpoint: boolean;
  rms16: number;
};

export type VoskEmergencyStopEvent = {
  text: string;
  partial: boolean;
  processingMs: number;
  sessionId: number;
  samplesSinceEmergencyReset: number;
  queuedChunks: number;
  rms16: number;
};

export type VoskEmergencyUnknownEvent = VoskEmergencyStopEvent;

export type VoskEmergencyHealthEvent = {
  armed: boolean;
  armGeneration: number;
  partialText: string;
  endpoint: boolean;
  processingMs: number;
  sessionId: number;
  samplesSinceEmergencyReset: number;
  queuedChunks: number;
  rms16: number;
};

export type VoskModelReadyEvent = {
  language: string;
  assetDir: string;
  loadMs: number;
  assetCopyMs: number;
  modelLoadMs: number;
  recognizerCreateMs: number;
  cached: boolean;
  sessionId: number;
  resetGeneration: number;
};

export type VoskErrorEvent = {
  stage: string;
  message: string;
};

export type VoskRecognizerStateEvent = {
  state: string;
  reason: string;
  sessionId: number;
  resetGeneration: number;
  resetCount: number;
  queuedChunks: number;
  droppedChunks: number;
  samplesSinceReset: number;
  emergencySamplesSinceReset: number;
  emergencyArmed: boolean;
  emergencyArmGeneration: number;
  emergencyReset: boolean;
  processingMs: number;
};

export type VoskAssistantRecognitionWord = {
  word: string;
  /** Response-relative time from final Vosk endpoint alignment. */
  startMs: number;
  endMs: number;
  confidence: number;
};

export type VoskAssistantRecognitionEvent = {
  responseId: string;
  /** Native output-recognizer generation fence returned by beginAssistantOutput. */
  generation: number;
  language: string;
  words: VoskAssistantRecognitionWord[];
  /** False marks bounded Vosk partial words; they may retire a prior mood but never set one. */
  endpoint: boolean;
  /** End of submitted 24 kHz response PCM; excludes native endpoint flush silence. */
  audioDurationMs: number;
};

export type VoskAssistantRecognitionErrorEvent = {
  responseId: string;
  generation: number;
  language: string;
  stage: string;
  message: string;
};

export type VoskAssistantOutputStart = {
  ready: boolean;
  generation: number;
};

type VoskCommandRecognizerEvents = {
  onCommandResult(event: VoskCommandEvent): void;
  onEmergencyStop(event: VoskEmergencyStopEvent): void;
  onEmergencyUnknown(event: VoskEmergencyUnknownEvent): void;
  onEmergencyHealth(event: VoskEmergencyHealthEvent): void;
  onModelReady(event: VoskModelReadyEvent): void;
  onRecognizerError(event: VoskErrorEvent): void;
  onRecognizerState(event: VoskRecognizerStateEvent): void;
  onAssistantRecognition(event: VoskAssistantRecognitionEvent): void;
  onAssistantRecognitionError(event: VoskAssistantRecognitionErrorEvent): void;
};

export type VoskCommandRecognizerStatus = {
  ready: boolean;
  language: string;
  queuedChunks: number;
  sessionId: number;
  resetGeneration: number;
  resetCount: number;
  droppedChunks: number;
  samplesSinceReset: number;
  emergencySamplesSinceReset: number;
  emergencyArmed: boolean;
  emergencyArmGeneration: number;
};

declare class VoskCommandRecognizerModule extends NativeModule<VoskCommandRecognizerEvents> {
  prepare(language: string, assetDir: string, grammarJson: string, emergencyGrammarJson: string): Promise<void>;
  beginAssistantOutput(language: string, responseId: string): Promise<VoskAssistantOutputStart>;
  /** Returns false if the response is stale or the bounded native queue is full. */
  feedAssistantPcm24(responseId: string, pcm24Base64: string): boolean;
  endAssistantOutput(responseId: string): void;
  cancelAssistantOutput(responseId: string): void;
  setGrammar(grammarJson: string): Promise<void>;
  feedSamples(samples: number[]): void;
  armEmergency(reason: string): Promise<boolean>;
  disarmEmergency(reason: string): Promise<void>;
  reset(reason: string, resetEmergency: boolean): number;
  unload(): void;
  getStatus(): VoskCommandRecognizerStatus;
}

export default requireNativeModule<VoskCommandRecognizerModule>("VoskCommandRecognizer");
