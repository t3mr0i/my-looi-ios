import { AgentError, isRecord } from "./agent-protocol";

export type AgentCapabilities = {
  protocol: 1;
  service: "looi-hermes";
  publicResearch: boolean;
  personalAccounts: false;
  externalActions: false;
};

/** Unknown server additions never become permission to expose personal data or actions. */
export function parseAgentCapabilities(value: unknown): AgentCapabilities {
  if (
    !isRecord(value) ||
    value.protocol !== 1 ||
    value.service !== "looi-hermes" ||
    !Array.isArray(value.capabilities) ||
    value.capabilities.length > 32 ||
    !["tasks", "cancel", "delete"].every((name) =>
      (value.capabilities as unknown[]).includes(name),
    )
  ) {
    throw new AgentError("response");
  }
  if (
    value.features !== undefined &&
    (!Array.isArray(value.features) || value.features.length > 32)
  )
    throw new AgentError("response");
  const features = Array.isArray(value.features) ? value.features : [];
  return {
    protocol: 1,
    service: "looi-hermes",
    // Older protocol-1 servers have the same bounded research contract.
    publicResearch:
      value.features === undefined ||
      features.some(
        (feature) =>
          isRecord(feature) &&
          feature.id === "public-research" &&
          feature.revision === 1 &&
          feature.availability === "available",
      ),
    personalAccounts: false,
    externalActions: false,
  };
}
