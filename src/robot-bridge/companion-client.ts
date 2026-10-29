import { loadRobotBridgeConfiguration } from "./runtime";

export type CompanionRequestOptions = {
  method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal;
};

/** Pin an operation to its original companion, including its eventual STOP. */
export async function requestConfiguredCompanion<T>(config: { url: string; token: string }, path: string, options: CompanionRequestOptions = {}): Promise<T> {
  let pathname: string;
  try { pathname = decodeURIComponent(path.split("?", 1)[0]!); }
  catch { throw new Error("Invalid companion API path"); }
  if (!/^\/api\/(?:apps|bridge)(?:\/|$)/.test(pathname) || /[%\x00-\x20\\?#]/.test(pathname)
    || /[\x00-\x20\\#]/.test(path) || pathname.split("/").some(part => part === "." || part === "..")) throw new Error("Invalid companion API path");
  if (!config?.url) throw new Error("Connect the robot companion first");
  const base = config.url.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/device$/, "");
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 15_000);
  try {
    const response = await fetch(`${base}${path}`, {
      method: options.method ?? "GET", signal: controller.signal,
      headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json", ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const raw = await response.text();
    if (raw.length > 2_000_000) throw new Error("Companion response is too large");
    let body: any; try { body = JSON.parse(raw); } catch { throw new Error("Companion returned an invalid response"); }
    if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error.slice(0, 300) : `Companion request failed (${response.status})`);
    return body as T;
  } finally { clearTimeout(timeout); options.signal?.removeEventListener("abort", abort); }
}

/** Authenticated management API; phone credentials never appear in URLs. */
export async function requestCompanion<T>(path: string, options: CompanionRequestOptions = {}): Promise<T> {
  const config = await loadRobotBridgeConfiguration();
  if (!config?.url) throw new Error("Connect the robot companion first");
  return requestConfiguredCompanion<T>(config, path, options);
}
