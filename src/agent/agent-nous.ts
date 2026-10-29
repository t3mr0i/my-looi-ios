import { AgentError, isRecord } from "./agent-protocol";

export type NousProvider = "gmail" | "googlecalendar";
export type NousSnapshot =
  | { status: "server_login_required" }
  | {
      status: "ready";
      subject: string;
      label: string;
      providers: NousProvider[];
      accounts: Array<{
        id: string;
        provider: NousProvider;
        label: string;
        connected: boolean;
      }>;
    };
export type NousConnectLink = {
  provider: NousProvider;
  subject: string;
  url: string;
};
const providers = new Set<unknown>(["gmail", "googlecalendar"]);
const text = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= 256 &&
  !/[\u0000-\u001f]/u.test(value);

export function parseNousSnapshot(value: unknown): NousSnapshot {
  if (!isRecord(value)) throw new AgentError("response");
  if (value.status === "server_login_required")
    return { status: "server_login_required" };
  if (
    value.status !== "ready" ||
    !text(value.subject) ||
    !text(value.label) ||
    !Array.isArray(value.providers) ||
    value.providers.length > 2 ||
    !value.providers.every((id) => providers.has(id)) ||
    !Array.isArray(value.accounts) ||
    value.accounts.length > 50
  )
    throw new AgentError("response");
  const accounts = value.accounts.map((account) => {
    if (
      !isRecord(account) ||
      !text(account.id) ||
      !text(account.label) ||
      !providers.has(account.provider) ||
      typeof account.connected !== "boolean"
    )
      throw new AgentError("response");
    return {
      id: account.id,
      label: account.label,
      provider: account.provider as NousProvider,
      connected: account.connected,
    };
  });
  if (
    new Set(accounts.map((account) => account.id)).size !== accounts.length ||
    new Set(value.providers).size !== value.providers.length
  )
    throw new AgentError("response");
  return {
    status: "ready",
    subject: value.subject,
    label: value.label,
    providers: value.providers as NousProvider[],
    accounts,
  };
}

export function parseNousConnectLink(
  value: unknown,
  provider: NousProvider,
  subject: string,
): NousConnectLink {
  if (
    !isRecord(value) ||
    value.provider !== provider ||
    value.subject !== subject ||
    typeof value.url !== "string" ||
    value.url.length > 4096 ||
    /[\u0000-\u0020]/u.test(value.url)
  )
    throw new AgentError("response");
  try {
    const url = new URL(value.url);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password
    )
      throw new Error();
    return { provider, subject, url: url.href };
  } catch {
    throw new AgentError("response");
  }
}
