/** Offline examples have their own state and IDs. They can never be submitted as AgentTask. */
export type AgentExample = "day" | "mail" | "appointment";
export type AgentExampleState = {
  example: AgentExample;
  stage: "ready" | "result" | "review" | "approved" | "uncertain";
  selectedMail: "workshop" | "materials" | null;
  draft: string;
};

export function createAgentExample(
  example: AgentExample = "day",
): AgentExampleState {
  return { example, stage: "ready", selectedMail: null, draft: "" };
}

export type AgentExampleEvent =
  | { type: "choose"; example: AgentExample }
  | { type: "run" }
  | { type: "open-mail"; id: "workshop" | "materials" }
  | { type: "close-mail" }
  | { type: "edit-draft"; text: string }
  | { type: "review" }
  | { type: "approve" }
  | { type: "simulate-uncertain" }
  | { type: "reset" };

export function reduceAgentExample(
  state: AgentExampleState,
  event: AgentExampleEvent,
): AgentExampleState {
  switch (event.type) {
    case "choose":
      return createAgentExample(event.example);
    case "reset":
      return createAgentExample(state.example);
    case "run":
      return state.stage === "ready" ? { ...state, stage: "result" } : state;
    case "open-mail":
      return state.example === "mail" && state.stage !== "ready"
        ? { ...state, selectedMail: event.id }
        : state;
    case "close-mail":
      return { ...state, selectedMail: null, draft: "" };
    case "edit-draft":
      return state.selectedMail
        ? { ...state, draft: event.text.slice(0, 4000) }
        : state;
    case "review":
      return state.example === "appointment" && state.stage === "result"
        ? { ...state, stage: "review" }
        : state;
    case "approve":
      return state.stage === "review" ? { ...state, stage: "approved" } : state;
    case "simulate-uncertain":
      return state.stage === "review"
        ? { ...state, stage: "uncertain" }
        : state;
  }
}
