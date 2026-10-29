/**
 * Portable, read-only discovery client for the public Reachy Mini and MicroDuck
 * Hugging Face Space catalogs. This module is shared by React Native and the
 * Node companion; it deliberately has no Node or filesystem dependencies.
 */

export type AppFamily = "reachy" | "microduck";
export type AppKind = "python" | "web";

export type AppCompatibility = {
  level: "partial";
  requirements: string[];
  limitations: string[];
};

export type AppLaunchPlan =
  | { mode: "install"; spaceId: string; revision: string | null }
  | {
      mode: "hosted";
      spaceId: string;
      url: string;
      appHost: string | null;
      hubUrl: string;
      revision: string | null;
      handoff: "reachy-hosted-shell" | "microduck-space";
    };

export type AppCatalogItem = {
  id: string;
  spaceId: string;
  revision: string | null;
  family: AppFamily;
  kind: AppKind;
  title: string;
  description: string;
  author: string;
  sdk: string;
  tags: string[];
  likes: number;
  lastModified: string | null;
  url: string;
  private: boolean;
  compatibility: AppCompatibility;
  launch: AppLaunchPlan;
  installable: boolean;
};

export type AppCatalogResult = {
  source: "huggingface-spaces";
  fetchedAt: string;
  stale: boolean;
  warnings: string[];
  items: AppCatalogItem[];
  /** Number of matching entries before the requested limit is applied. */
  total: number;
};

export type AppCatalogListOptions = {
  query?: string;
  limit?: number;
  offset?: number;
  robotFamily?: AppFamily | null;
  forceRefresh?: boolean;
};

export type AppCatalogOptions = {
  fetchImpl?: CatalogFetch;
  timeoutMs?: number;
  cacheMs?: number;
  maxResponseBytes?: number;
  /** Page size per tag; discovery follows all continuation pages. */
  maxPerTag?: number;
  now?: () => number;
};

// Keep the fetch input a string: React Native's fetch polyfill does not
// consistently accept URL instances even though browser fetch does.
export type CatalogFetch = (url: string, init: CatalogRequestInit) => Promise<CatalogResponse>;

export type CatalogRequestInit = {
  method: "GET";
  headers: { accept: "application/json" };
  signal: AbortSignal;
  redirect: "error";
};

export type CatalogResponse = {
  ok: boolean;
  status: number;
  headers?: { get?(name: string): string | null };
  body?: { getReader?: () => CatalogReader } | null;
  text(): Promise<string>;
};

export type CatalogReader = {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<void> | void;
  releaseLock?(): void;
};

export type AppCatalog = {
  list(options?: AppCatalogListOptions): Promise<AppCatalogResult>;
  get(spaceId: string): Promise<AppCatalogItem>;
  resolve(spaceId: string, options?: { revision?: string }): Promise<AppCatalogItem>;
  refresh(): Promise<AppCatalogResult>;
};

export const HF_API = "https://huggingface.co/api/spaces";
export const SPACE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
export const COMMIT = /^[a-f0-9]{40}$/i;

const HF_ORIGIN = "https://huggingface.co";
// These are officially expandable Space fields. `sha` pins local installs;
// `subdomain` is the canonical host label for a direct Space app URL.
const EXPAND = ["author", "cardData", "createdAt", "lastModified", "likes", "private", "runtime", "sdk", "sha", "subdomain", "tags"];
const CATALOGS: { tag: string; family: AppFamily; kind: AppKind }[] = [
  { tag: "reachy_mini_python_app", family: "reachy", kind: "python" },
  { tag: "reachy_mini_js_app", family: "reachy", kind: "web" },
  { tag: "microduck", family: "microduck", kind: "web" },
];
const SPACE_SUBDOMAIN = /^(?=.{1,63}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function hostedAppHost(raw: Record<string, unknown>, subdomain: string | null): string | null {
  // SpaceInfo may include an authoritative host. Keep it only when it is an
  // HTTPS Hugging Face Space host; API metadata must not turn catalog entries
  // into arbitrary external links.
  if (typeof raw.host === "string" && raw.host.length <= 300) {
    const candidate = raw.host.trim();
    try {
      const parsed = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
      const host = parsed.hostname.toLowerCase();
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.port
        && (parsed.pathname === "" || parsed.pathname === "/") && !parsed.search && !parsed.hash
        && host !== "hf.space" && host.endsWith(".hf.space") && /^[a-z0-9.-]+$/.test(host) && !host.includes("..")) {
        return host;
      }
    } catch {
      // An absent or malformed host falls back to the documented Space
      // subdomain convention below.
    }
  }
  if (!subdomain) return null;
  // HF's static SDK is served from the separate static.hf.space domain.
  // Other SDKs use the standard <subdomain>.hf.space host.
  return `${subdomain}${typeof raw.sdk === "string" && raw.sdk.toLowerCase() === "static" ? ".static" : ""}.hf.space`;
}

function spaceIdFrom(value: string): string {
  if (typeof value !== "string" || !SPACE_ID.test(value)) throw new Error("Expected a Hugging Face Space ID in owner/name form");
  return value;
}

function text(value: unknown, max = 4000): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function tagsFor(raw: Record<string, unknown>): string[] {
  const tags = new Set(Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === "string") : []);
  const cardData = raw.cardData && typeof raw.cardData === "object" ? raw.cardData as Record<string, unknown> : {};
  if (Array.isArray(cardData.tags)) for (const tag of cardData.tags) if (typeof tag === "string") tags.add(tag);
  return [...tags].slice(0, 100);
}

function familiesFor(tags: string[]) {
  return CATALOGS.filter((entry) => tags.includes(entry.tag));
}

function compatibilityFor(raw: Record<string, unknown>, family: AppFamily, kind: AppKind): AppCompatibility {
  const requirements: string[] = [];
  const limitations: string[] = [];
  const level = "partial" as const;
  if (family === "reachy" && kind === "python") {
    requirements.push("Requires the Reachy Mini Python SDK and an app-compatible daemon API.");
    limitations.push("The LOOI bridge does not claim the full Reachy Mini Python daemon API; app movement and media calls may not work.");
  } else if (family === "reachy" && kind === "web") {
    requirements.push("Requires a Reachy Mini JavaScript Space using the official host shell and embedded SDK entry.");
    limitations.push("The official host shell supplies Hugging Face OAuth and a Central robot picker; OAuth and WebRTC inside the catalog's Hub-page iframe have not been verified.");
    limitations.push("The Space host shell does not redirect a hard-coded Central connection to LOOI.");
    limitations.push("LOOI connectivity still requires the robot to be discoverable through a supported Central setup or the Space to trust a compatible SIGNALING_URL.");
  } else {
    requirements.push("Requires the MicroDuck account/rendezvous protocol and the app-specific MicroDuck API.");
    limitations.push("A MicroDuck tag identifies the Space; it does not prove that its rendezvous, policy runtime, camera, or control calls work through LOOI.");
  }
  if (raw.private === true) limitations.push("Private Spaces are not installable from this public catalog.");
  return { level, requirements, limitations };
}

function normalize(rawValue: unknown, catalogEntry: { tag: string; family: AppFamily; kind: AppKind } | undefined): AppCatalogItem | null {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) return null;
  const raw = rawValue as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!SPACE_ID.test(id)) return null;
  const tags = tagsFor(raw);
  const matching = familiesFor(tags);
  if (!matching.length) return null;
  // Prefer the tag used by the query so a multi-tagged Space has a stable family/kind.
  const classification = matching.find((entry) => entry.tag === catalogEntry?.tag) ?? matching[0];
  const card = raw.cardData && typeof raw.cardData === "object" ? raw.cardData as Record<string, unknown> : {};
  const revision = typeof raw.sha === "string" && COMMIT.test(raw.sha) ? raw.sha.toLowerCase() : null;
  // SpaceInfo's host is authoritative when present. Otherwise account for the
  // separate hostname used by static Spaces.
  const subdomain = typeof raw.subdomain === "string" && SPACE_SUBDOMAIN.test(raw.subdomain) ? raw.subdomain : null;
  const appHost = hostedAppHost(raw, subdomain);
  const hubUrl = `${HF_ORIGIN}/spaces/${id}`;
  const kind = classification.kind;
  const launch: AppLaunchPlan = kind === "python"
    ? { mode: "install", spaceId: id, revision }
    : { mode: "hosted", spaceId: id, url: appHost ? `https://${appHost}/` : hubUrl, appHost, hubUrl, revision, handoff: classification.family === "reachy" ? "reachy-hosted-shell" : "microduck-space" };
  return {
    id: `hf:${id}`,
    spaceId: id,
    revision,
    family: classification.family,
    kind,
    title: text(card.title || raw.title || id.split("/").at(-1), 160),
    description: text(card.short_description || raw.description || "", 500),
    author: text(raw.author || id.split("/")[0], 120),
    sdk: text(raw.sdk, 40),
    tags,
    likes: typeof raw.likes === "number" && Number.isFinite(raw.likes) ? Math.max(0, raw.likes) : 0,
    lastModified: text(raw.lastModified || raw.last_modified, 80) || null,
    url: hubUrl,
    private: raw.private === true,
    compatibility: compatibilityFor(raw, classification.family, kind),
    launch,
    installable: kind === "python" && raw.private !== true && revision !== null,
  };
}

function makeEndpoint(tag: string, limit: number): URL {
  const url = new URL(HF_API);
  url.searchParams.set("filter", tag);
  url.searchParams.set("sort", "lastModified");
  url.searchParams.set("direction", "-1");
  url.searchParams.set("limit", String(limit));
  for (const field of EXPAND) url.searchParams.append("expand", field);
  return url;
}

function expandedSpaceUrl(spaceId: string): URL {
  const url = new URL(`${HF_API}/${spaceId.split("/").map(encodeURIComponent).join("/")}`);
  for (const field of EXPAND) url.searchParams.append("expand", field);
  return url;
}

/** UTF-8 byte length without requiring Buffer, TextEncoder, or a native module. */
function utf8ByteLength(value: string): number {
  let size = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) size += 1;
    else if (code <= 0x7ff) size += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        size += 4;
        index += 1;
      } else size += 3; // UTF-8 replacement character for an unpaired surrogate.
    } else size += 3;
  }
  return size;
}

type StreamingTextDecoder = {
  decode(value?: Uint8Array, options?: { stream?: boolean }): string;
};

function makeTextDecoder(): StreamingTextDecoder | null {
  const Decoder = (globalThis as typeof globalThis & { TextDecoder?: new () => StreamingTextDecoder }).TextDecoder;
  return Decoder ? new Decoder() : null;
}

async function readBoundedJson(response: CatalogResponse, maxBytes: number): Promise<unknown> {
  const length = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new Error("Hugging Face catalog response exceeded the size limit");
  const decoder = makeTextDecoder();
  if (decoder && response.body?.getReader) {
    const reader = response.body.getReader();
    const parts: string[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        size += value.byteLength;
        if (size > maxBytes) {
          try { await reader.cancel(); } catch { /* Best-effort cancellation after crossing the limit. */ }
          throw new Error("Hugging Face catalog response exceeded the size limit");
        }
        parts.push(decoder.decode(value, { stream: true }));
      }
      parts.push(decoder.decode());
    } finally {
      reader.releaseLock?.();
    }
    return JSON.parse(parts.join(""));
  }
  const value = await response.text();
  if (utf8ByteLength(value) > maxBytes) throw new Error("Hugging Face catalog response exceeded the size limit");
  return JSON.parse(value);
}

/**
 * Read the live Hugging Face Space catalog using the same public tags Reachy Mini publishes.
 * The MicroDuck catalog uses the public `microduck` tag; it is discovery only, not a claim of
 * protocol compatibility. Never returns arbitrary repo URLs as install targets.
 */
export function createAppCatalog({
  fetchImpl = globalThis.fetch as unknown as CatalogFetch,
  timeoutMs = 8_000,
  cacheMs = 60_000,
  maxResponseBytes = 2 * 1024 * 1024,
  maxPerTag = 100,
  now = () => Date.now(),
}: AppCatalogOptions = {}): AppCatalog {
  if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 250 || timeoutMs > 30_000) throw new Error("Invalid catalog timeout");
  if (!Number.isFinite(maxPerTag) || maxPerTag < 1 || maxPerTag > 500) throw new Error("Invalid catalog limit");
  let cached: { at: number; result: Omit<AppCatalogResult, "total"> } | null = null;
  let inflight: Promise<Omit<AppCatalogResult, "total">> | null = null;

  async function requestJson(url: URL, headers?: (link: string | null) => void): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url.toString(), { method: "GET", headers: { accept: "application/json" }, signal: controller.signal, redirect: "error" });
      if (!response.ok) throw new Error(`Hugging Face returned HTTP ${response.status}`);
      headers?.(response.headers?.get?.("link") ?? null);
      return await readBoundedJson(response, maxResponseBytes);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchCatalog(): Promise<Omit<AppCatalogResult, "total">> {
    const warnings: string[] = [];
    const results = await Promise.all(CATALOGS.map(async (entry) => {
      try {
        const items: AppCatalogItem[] = [];
        let page: URL | null = makeEndpoint(entry.tag, maxPerTag);
        const seen = new Set<string>();
        const deadline = Date.now() + 30_000;
        while (page) {
          if (seen.size >= 100 || seen.has(page.toString()) || Date.now() > deadline) throw new Error("Catalog pagination did not finish");
          seen.add(page.toString());
          let next: URL | null = null;
          const body = await requestJson(page, link => {
            const match = link?.match(/<([^>]+)>\s*;\s*rel=["']?next["']?/i);
            if (!match) return;
            const candidate = new URL(match[1]!);
            // Follow only the public catalog's own continuation, never an arbitrary URL.
            if (candidate.origin !== HF_ORIGIN || candidate.pathname !== "/api/spaces"
              || candidate.username || candidate.password || candidate.hash || candidate.toString().length > 16_384
              || candidate.searchParams.get("filter") !== entry.tag) throw new Error("Invalid catalog continuation");
            next = candidate;
          });
          if (!Array.isArray(body)) throw new Error("Invalid catalog response");
          items.push(...body.map(raw => normalize(raw, entry)).filter((item): item is AppCatalogItem => Boolean(item)));
          page = next;
        }
        return items;
      } catch (error) {
        const message = error instanceof Error ? error.message : "request failed";
        warnings.push(`${entry.tag}: ${text(message, 180) || "request failed"}`);
        return [] as AppCatalogItem[];
      }
    }));
    const byId = new Map<string, AppCatalogItem>();
    for (const items of results) for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);
    const fetchedAt = new Date(now()).toISOString();
    const result = { source: "huggingface-spaces" as const, fetchedAt, stale: false, warnings, items: [...byId.values()] };
    if (!warnings.length || !cached) cached = { at: now(), result };
    else if (cached) return { ...cached.result, stale: true, warnings };
    return result;
  }

  async function list({ query = "", limit = 100, offset = 0, robotFamily = null, forceRefresh = false }: AppCatalogListOptions = {}): Promise<AppCatalogResult> {
    if (typeof query !== "string" || query.length > 120) throw new Error("Search query is too long");
    if (robotFamily !== null && !["reachy", "microduck"].includes(robotFamily)) throw new Error("Unknown robot family");
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("Catalog limit must be between 1 and 200");
    if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) throw new Error("Invalid catalog offset");
    let result: Omit<AppCatalogResult, "total">;
    if (!forceRefresh && cached && now() - cached.at < cacheMs) result = cached.result;
    else {
      if (!inflight) inflight = fetchCatalog().finally(() => { inflight = null; });
      result = await inflight;
    }
    const needle = query.trim().toLocaleLowerCase();
    const matching = result.items.filter((item) => (!robotFamily || item.family === robotFamily)
      && (!needle || `${item.title}\n${item.description}\n${item.spaceId}\n${item.tags.join(" ")}`.toLocaleLowerCase().includes(needle)));
    return { ...result, items: matching.slice(offset, offset + limit), total: matching.length };
  }

  async function get(spaceId: string): Promise<AppCatalogItem> {
    const id = spaceIdFrom(spaceId);
    const existing = await list({ limit: 200 });
    const found = cached?.result.items.find((item) => item.spaceId === id)
      ?? existing.items.find((item) => item.spaceId === id);
    // Some HF list responses omit expandable fields. Refresh a catalog entry
    // with no pinned SHA before rejecting installation.
    if (found && !(found.kind === "python" && !found.revision)) return found;
    // Non-catalog Spaces are never surfaced or installable. Detail lookup
    // refreshes current metadata but does not bless missing catalog tags.
    const raw = await requestJson(expandedSpaceUrl(id));
    const tags = tagsFor(raw && typeof raw === "object" ? raw as Record<string, unknown> : {});
    const entry = CATALOGS.find((candidate) => tags.includes(candidate.tag));
    const item = entry && normalize(raw, entry);
    if (!item) throw new Error("This Space is not in a supported Reachy or MicroDuck catalog");
    return item;
  }

  async function resolve(spaceId: string, { revision }: { revision?: string } = {}): Promise<AppCatalogItem> {
    const item = await get(spaceId);
    if (item.private) throw new Error("Private Spaces are not supported by the public app catalog");
    if (item.kind !== "python" || !item.installable) throw new Error("Only public Reachy Python app Spaces can be installed on the companion");
    if (!item.revision) throw new Error("The catalog did not return a pinned commit revision");
    if (revision !== undefined && (typeof revision !== "string" || revision.toLowerCase() !== item.revision)) {
      throw new Error("The requested revision is not the current catalog revision; refresh the catalog before installing");
    }
    return item;
  }

  return Object.freeze({ list, get, resolve, refresh: () => list({ forceRefresh: true }) });
}
