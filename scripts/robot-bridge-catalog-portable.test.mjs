import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const load = createTypeScriptTreeLoader();
const { createAppCatalog } = load(fileURLToPath(new URL("../src/robot-bridge/app-catalog.ts", import.meta.url)));

function jsonResponse(value) {
  const body = JSON.stringify(value);
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => body,
  };
}

const catalog = createAppCatalog({
  fetchImpl: async (urlValue) => jsonResponse(new URL(urlValue).searchParams.get("filter") === "reachy_mini_python_app" ? [{
    id: "pollen-robotics/native-listing",
    sha: "a".repeat(40),
    author: "pollen-robotics",
    sdk: "gradio",
    tags: ["reachy_mini_python_app"],
    private: false,
    cardData: { title: "Native discovery", short_description: "No companion required for browsing." },
  }] : []),
});

const result = await catalog.list({ robotFamily: "reachy" });
assert.equal(result.source, "huggingface-spaces");
assert.equal(result.total, 1);
assert.equal(result.items[0].title, "Native discovery");
assert.equal(result.items[0].launch.mode, "install");
assert.equal(result.items[0].installable, true);

// Exercise the non-streaming fetch fallback and ensure limits use UTF-8 bytes,
// including multibyte characters, without requiring Node's Buffer API.
const oversizedCatalog = createAppCatalog({
  maxResponseBytes: 400,
  fetchImpl: async (urlValue) => jsonResponse(new URL(urlValue).searchParams.get("filter") === "reachy_mini_python_app" ? [{
    id: "pollen-robotics/large-title",
    sha: "b".repeat(40),
    tags: ["reachy_mini_python_app"],
    cardData: { title: "🦆".repeat(100) },
  }] : []),
});
const bounded = await oversizedCatalog.list();
assert.equal(bounded.items.length, 0);
assert.ok(bounded.warnings.some((warning) => warning.includes("exceeded the size limit")));

// Follow the actual Hub Link-header protocol, including entries past the first
// page. New publications become searchable after the one-minute cache expires.
{
  let clock = 1_000, generation = 1;
  const requested = [];
  const paginated = createAppCatalog({ now: () => clock, maxPerTag: 1, fetchImpl: async value => {
    const url = new URL(value); requested.push(url);
    if (url.searchParams.get("filter") !== "reachy_mini_python_app") return jsonResponse([]);
    const cursor = url.searchParams.get("cursor");
    const response = jsonResponse([{ id: `pollen-robotics/${cursor ? `new-${generation}` : "old"}`, sha: "c".repeat(40), tags: ["reachy_mini_python_app"] }]);
    if (!cursor) {
      const next = new URL(url); next.searchParams.set("cursor", "second");
      response.headers.get = name => name.toLowerCase() === "link" ? `<${next}>; rel="next"` : null;
    }
    return response;
  } });
  assert.equal((await paginated.list()).total, 2);
  generation = 2;
  assert.equal((await paginated.list({ query: "new-2" })).total, 0, "cache retains its coherent fetched generation");
  clock += 60_001;
  assert.equal((await paginated.list({ query: "new-2" })).items[0].spaceId, "pollen-robotics/new-2");
  assert.equal(requested.filter(url => url.searchParams.has("cursor")).length, 2);
}
{
  const calls = [];
  const large = createAppCatalog({ fetchImpl: async value => {
    calls.push(value);
    return jsonResponse(new URL(value).searchParams.get("filter") === "reachy_mini_python_app"
      ? Array.from({ length: 205 }, (_, index) => ({ id: `pollen/app-${index}`, sha: "a".repeat(40), tags: ["reachy_mini_python_app"] })) : []);
  } });
  assert.equal((await large.list({ limit: 200 })).total, 205);
  const tail = await large.list({ limit: 60, offset: 200 });
  assert.equal(tail.items.length, 5, "the UI can load every catalog page without truncating the shared index");
  assert.equal(tail.items[0].spaceId, "pollen/app-200");
  assert.equal(tail.total, 205);
  await assert.rejects(large.list({ offset: -1 }), /offset/);
  assert.equal((await large.get("pollen/app-204")).spaceId, "pollen/app-204");
  assert.equal(calls.length, 3, "detail lookups use the whole cached catalog, including beyond the UI's first 200 results");
}
{
  const calls = [];
  const malicious = createAppCatalog({ fetchImpl: async value => {
    calls.push(value);
    const response = jsonResponse([]);
    response.headers.get = () => '<https://other.invalid/api/spaces?filter=microduck>; rel="next"';
    return response;
  } });
  const result = await malicious.list();
  assert.equal(calls.length, 3, "external continuation links are never fetched");
  assert.equal(result.warnings.length, 3);
}

console.log("robot bridge portable catalog tests passed");
