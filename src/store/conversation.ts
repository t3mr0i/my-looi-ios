import { create } from "zustand";
import { ChatMessage, SessionSummary } from "../core/context-service";
import { mirrorSessionMessage } from "../memory/memory-service";
import { INPUT_ATTENTION_DURATION_MS, type InputAttentionCue } from "../voice/input-attention";

export type { ChatMessage, SessionSummary };

export type NewChatMessage = Omit<ChatMessage, "id" | "timestamp"> & {
  id?: string;
  timestamp?: string;
};

export type RealtimeReadiness = "idle" | "preparing-microphone" | "connecting" | "ready" | "microphone-error" | "error";
export type RealtimeIssue = "no_credits" | "invalid_key" | "network_error" | "service_error" | null;

interface ConversationState {
  activeSessionId: string | null;
  messages: ChatMessage[];
  isProcessing: boolean;
  isListening: boolean;
  /** True only while server VAD says the human is actively speaking. */
  isUserSpeaking: boolean;
  isSpeaking: boolean;
  realtimeReadiness: RealtimeReadiness;
  realtimeIssue: RealtimeIssue;
  currentTranscript: string;
  streamingText: string;
  /** Assistant words confirmed by output ASR and the actual playback head. */
  heardSpeechText: string | null;
  overlayVisible: boolean;
  imageOverlayUri: string | null;
  /** Presentation only. Incoming sound does not establish recognized human speech. */
  inputAttention: InputAttentionCue | null;
  lastInputAttentionAtMs: number | null;

  // Actions
  setActiveSession: (sessionId: string, messages?: ChatMessage[]) => void;
  addMessage: (message: NewChatMessage) => ChatMessage;
  appendMessage: (message: NewChatMessage) => Promise<ChatMessage>;
  setProcessing: (processing: boolean) => void;
  setListening: (listening: boolean) => void;
  setUserSpeaking: (speaking: boolean) => void;
  setSpeaking: (speaking: boolean) => void;
  setRealtimeReadiness: (readiness: RealtimeReadiness) => void;
  setRealtimeIssue: (issue: RealtimeIssue) => void;
  setCurrentTranscript: (transcript: string) => void;
  setStreamingText: (text: string) => void;
  setHeardSpeechText: (text: string | null) => void;
  appendStreamingText: (text: string) => void;
  setOverlayVisible: (visible: boolean) => void;
  showImageOverlay: (uri: string | null) => void;
  hideImageOverlay: () => void;
  clearMessages: () => void;
  clearSession: () => void;
  requestInputAttention: (sessionId: string, receivedAtMs: number) => string | null;
  clearInputAttention: (expectedId?: string) => void;
}

function createLocalMessage(message: NewChatMessage): ChatMessage {
  return {
    ...message,
    id: message.id ?? `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: message.timestamp ?? new Date().toISOString(),
  };
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  activeSessionId: null,
  messages: [],
  isProcessing: false,
  isListening: false,
  isUserSpeaking: false,
  isSpeaking: false,
  realtimeReadiness: "idle",
  realtimeIssue: null,
  currentTranscript: "",
  streamingText: "",
  heardSpeechText: null,
  overlayVisible: false,
  imageOverlayUri: null,
  inputAttention: null,
  lastInputAttentionAtMs: null,

  requestInputAttention: (sessionId, receivedAtMs) => {
    const state = get();
    const now = performance.now();
    if (state.activeSessionId !== sessionId || !state.isListening || state.isSpeaking || state.isProcessing
      || state.realtimeReadiness !== "ready" || !Number.isFinite(receivedAtMs) || receivedAtMs > now || now - receivedAtMs > 100
      || (state.lastInputAttentionAtMs !== null && now - state.lastInputAttentionAtMs < 1000)) return null;
    const id = `${sessionId}:input:${now}`;
    set({ inputAttention: { id, sessionId, receivedAtMs, requestedAtMs: now, expiresAtMs: now + INPUT_ATTENTION_DURATION_MS }, lastInputAttentionAtMs: now });
    return id;
  },
  clearInputAttention: (expectedId) => {
    if (get().inputAttention && (!expectedId || get().inputAttention?.id === expectedId)) set({ inputAttention: null });
  },

  setActiveSession: (activeSessionId, messages) =>
    set(messages ? { activeSessionId, messages, heardSpeechText: null, inputAttention: null } : { activeSessionId, heardSpeechText: null, inputAttention: null }),

  addMessage: (message) => {
    const localMessage = createLocalMessage(message);
    set((state) => ({
      messages: [...state.messages, localMessage],
      imageOverlayUri: localMessage.evidenceUri ?? state.imageOverlayUri,
      overlayVisible: true,
    }));
    return localMessage;
  },

  appendMessage: async (message) => {
    const localMessage = createLocalMessage(message);
    set((state) => ({
      messages: [...state.messages, localMessage],
      imageOverlayUri: localMessage.evidenceUri ?? state.imageOverlayUri,
      overlayVisible: true,
    }));

    const sessionId = useConversationStore.getState().activeSessionId;
    if (sessionId) {
      mirrorSessionMessage(sessionId, {
        role: localMessage.role,
        content: localMessage.content,
        evidenceUri: localMessage.evidenceUri,
      });
    }

    return localMessage;
  },

  setProcessing: (isProcessing) => set((state) => ({ isProcessing, inputAttention: isProcessing ? null : state.inputAttention })),
  setListening: (isListening) =>
    set((state) => ({
      isListening,
      inputAttention: isListening ? state.inputAttention : null,
      overlayVisible: isListening ? true : state.overlayVisible,
    })),
  setUserSpeaking: (isUserSpeaking) => set({ isUserSpeaking }),
  setSpeaking: (isSpeaking) =>
    set((state) => ({
      isSpeaking,
      inputAttention: isSpeaking ? null : state.inputAttention,
      overlayVisible: isSpeaking ? true : state.overlayVisible,
    })),
  setRealtimeReadiness: (realtimeReadiness) => set((state) => ({ realtimeReadiness, inputAttention: realtimeReadiness === "ready" ? state.inputAttention : null })),
  setRealtimeIssue: (realtimeIssue) => set((state) => ({ realtimeIssue, overlayVisible: realtimeIssue ? true : state.overlayVisible })),
  setCurrentTranscript: (currentTranscript) =>
    set((state) => ({
      currentTranscript,
      overlayVisible: currentTranscript ? true : state.overlayVisible,
    })),
  setStreamingText: (streamingText) =>
    set((state) => ({
      streamingText,
      overlayVisible: streamingText ? true : state.overlayVisible,
    })),
  setHeardSpeechText: (heardSpeechText) => set({ heardSpeechText }),
  appendStreamingText: (text) =>
    set((state) => ({
      streamingText: `${state.streamingText}${text}`,
      overlayVisible: true,
    })),
  setOverlayVisible: (overlayVisible) => set({ overlayVisible }),
  showImageOverlay: (imageOverlayUri) => set({ imageOverlayUri }),
  hideImageOverlay: () => set({ imageOverlayUri: null }),
  clearMessages: () => set({ messages: [] }),
  clearSession: () =>
    set({
      activeSessionId: null,
      inputAttention: null,
      lastInputAttentionAtMs: null,
      messages: [],
      currentTranscript: "",
      streamingText: "",
      heardSpeechText: null,
      realtimeReadiness: "idle",
      realtimeIssue: null,
      isProcessing: false,
      isListening: false,
      isUserSpeaking: false,
      isSpeaking: false,
      overlayVisible: false,
      imageOverlayUri: null,
    }),
}));
