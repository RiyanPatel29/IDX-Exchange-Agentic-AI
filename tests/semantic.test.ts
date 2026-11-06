// Week 6: semantic search (no database, no API key: fake provider + fake DB).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalize, FakeProvider, GeminiProvider, OpenAIProvider } from "../src/semantic/embeddings.ts";
import { VectorStore } from "../src/semantic/vectorStore.ts";
import {
  descriptiveTerms, bestSnippet, listingDocText, textHash, semanticSearch, type SemanticDeps,
} from "../src/semantic/semanticSearch.ts";
import { formatSemanticResult } from "../src/semantic/formatSemantic.ts";
import { handleMessage, type Deps } from "../src/agent/handleMessage.ts";
import { MemorySessionStore } from "../src/session/sessionStore.ts";
import type { ListingRow } from "../src/db/listings.ts";

// ---------- fake listings ----------
type Row = ListingRow & { remarks: string };
function row(id: string, city: string, price: number, remarks: string, extra: Partial<ListingRow> = {}): Row {
  return {
    L_ListingID: id, L_DisplayId: `MLS${id}`, L_Address: `${id} Main St`, L_City: city, L_Zip: "92618",
    price, beds: 3, baths: 2, sqft: 1500, type: "SingleFamilyResidence", status: "Active", lat: null, lng: null,
    YearBuilt: 2000, AssociationFee: 0, DaysOnMarket: 5, PoolPrivateYN: "False", ViewYN: "False", FireplaceYN: "False",
    PhotoCount: 10, LA1_UserFirstName: null, LA1_UserLastName: null, LO1_OrganizationName: null, remarks, ...extra,
  };
}
const ROWS: Row[] = [
  row("a", "Irvine", 1_200_000, "Quiet cul-de-sac location. Huge backyard with fruit trees and a garden."),
  row("b", "Irvine", 1_500_000, "Modern remodeled kitchen with quartz counters. Walk to the park.", { PoolPrivateYN: "True" }),
  row("c", "Irvine", 900_000, "Ocean view penthouse with rooftop deck and city lights."),
  row("d", "Tustin", 800_000, "Quiet street, big backyard, perfect for dogs and kids."),
  row("e", "Irvine", 1_000_000, "Busy main road but great price. Needs work, fixer upper."),
  row("f", "Irvine", 1_100_000, "No description indexed for this one."), // left out of the index on purpose
];

async function buildStore(provider = new FakeProvider()) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "idx-vec-"));
  const store = new VectorStore(dir, provider.name, provider.model, provider.dims);
  const indexed = ROWS.filter((r) => r.L_ListingID !== "f");
  const texts = indexed.map((r) => listingDocText({ ...r }));
  const vecs = await provider.embedDocuments(texts);
  store.upsert(indexed.map((r, i) => ({ id: r.L_ListingID, vector: vecs[i], hash: textHash(texts[i]) })));
  return { store, dir, provider };
}

function fakeDeps(store: VectorStore, provider = new FakeProvider()): SemanticDeps {
  return {
    provider, store,
    candidateIds: async (f) => ROWS.filter((r) =>
      (!f.city || r.L_City === f.city) && (f.maxPrice == null || r.price! <= f.maxPrice) && (!f.pool || r.PoolPrivateYN === f.pool),
    ).map((r) => r.L_ListingID),
    fetchByIds: async (ids) => ROWS.filter((r) => ids.includes(r.L_ListingID)),
  };
}

const dirs: string[] = [];
afterEach(async () => { while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true }); });

// ---------- vectors ----------

test("normalize makes unit vectors", () => {
  const v = normalize([3, 4]);
  assert.ok(Math.abs(v[0] - 0.6) < 1e-6 && Math.abs(v[1] - 0.8) < 1e-6);
  assert.deepEqual(Array.from(normalize([0, 0])), [0, 0]);
});

test("vector store: top-k, filter to candidates, save + load", async () => {
  const { store, dir } = await buildStore();
  dirs.push(dir);
  const p = new FakeProvider();
  const q = await p.embedQuery("quiet backyard");
  const top = store.search(q, 2);
  assert.equal(top.length, 2);
  assert.ok(top[0].score >= top[1].score, "sorted by score");
  assert.ok(["a", "d"].includes(top[0].id));

  const onlyIrvine = store.search(q, 5, new Set(["a", "b", "c", "e", "f"]));
  assert.ok(onlyIrvine.every((h) => h.id !== "d"), "Tustin excluded");
  assert.equal(onlyIrvine[0].id, "a");

  await store.save();
  const back = await VectorStore.load(dir);
  assert.equal(back.size, 5);
  assert.deepEqual(back.search(q, 1), store.search(q, 1));
  assert.equal(back.hashOf("a"), store.hashOf("a"));
});

test("vector store: upsert replaces, dims are checked", async () => {
  const { store, dir } = await buildStore();
  dirs.push(dir);
  const p = new FakeProvider();
  store.upsert([{ id: "a", vector: await p.embedQuery("ocean view penthouse"), hash: "x" }]);
  assert.equal(store.size, 5, "replaced, not added");
  assert.equal(store.hashOf("a"), "x");
  assert.throws(() => store.search(new Float32Array(3)), /dims/);
});

// ---------- text helpers ----------

test("descriptive terms ignore filters, cities, numbers and filler", () => {
  assert.deepEqual(descriptiveTerms("3 bed condos in Irvine under 1.5M with a pool"), []);
  assert.deepEqual(descriptiveTerms("show me homes in San Diego"), []);
  assert.deepEqual(descriptiveTerms("sort by cheapest first"), []);
  assert.deepEqual(descriptiveTerms("quiet cul-de-sac home in Irvine with a big backyard under 2M"), ["quiet", "cul-de-sac", "big", "backyard"]);
  assert.deepEqual(descriptiveTerms("condos in Yorba Linda", "Yorba Linda"), []);
});

test("listing text and snippet", () => {
  assert.equal(listingDocText({ type: "Condominium", L_City: "Irvine", beds: 2, baths: 2, sqft: 1100, remarks: "  Nice   unit. " }),
    "Condominium in Irvine. 2 bed 2 bath 1100 sqft. Nice unit.");
  assert.equal(bestSnippet(ROWS[0].remarks, "big backyard"), "Huge backyard with fruit trees and a garden.");
  assert.equal(bestSnippet(null, "x"), null);
  assert.ok(bestSnippet("x".repeat(500), "x")!.endsWith("..."));
});

// ---------- hybrid search ----------

test("semantic search: hard filters in SQL, ranking by meaning, snippets", async () => {
  const { store, dir } = await buildStore();
  dirs.push(dir);
  const r = await semanticSearch("quiet street with a big backyard", { city: "Irvine" }, { limit: 2 }, fakeDeps(store));
  assert.equal(r.listings[0].L_ListingID, "a", "best Irvine match first");
  assert.ok(r.listings.every((l) => l.L_City === "Irvine"));
  assert.equal(r.candidates, 5);
  assert.equal(r.indexed, 4, "listing f isn't indexed");
  assert.match(r.matches.a.snippet!, /backyard/);
  assert.equal(r.totalPages, 2);

  const p2 = await semanticSearch("quiet street with a big backyard", { city: "Irvine" }, { limit: 2, page: 2 }, fakeDeps(store));
  assert.ok(!p2.listings.some((l) => r.listings.some((x) => x.L_ListingID === l.L_ListingID)), "page 2 is new listings");

  const pool = await semanticSearch("modern kitchen", { city: "Irvine", pool: "True" }, { limit: 5 }, fakeDeps(store));
  assert.deepEqual(pool.listings.map((l) => l.L_ListingID), ["b"]);
});

test("semantic search refuses an index built with a different model", async () => {
  const { store, dir } = await buildStore();
  dirs.push(dir);
  await assert.rejects(
    semanticSearch("x", {}, {}, fakeDeps(store, new FakeProvider(128))),
    /Re-run npm run embed:index -- --rebuild/,
  );
});

test("formatted results show the why and the coverage note", async () => {
  const { store, dir } = await buildStore();
  dirs.push(dir);
  const text = "quiet street with a big backyard";
  const r = await semanticSearch(text, { city: "Irvine" }, { limit: 2 }, fakeDeps(store));
  const out = formatSemanticResult(r, { city: "Irvine" }, text);
  assert.match(out, /Best matches for "quiet, street, big, backyard" \(in Irvine\)/);
  assert.match(out, /✨ "Quiet cul-de-sac location. Huge backyard/);
  assert.match(out, /Reply "more"/);
  assert.match(out, /Ranked 4 of 5 matching listings/);
});

// ---------- conversation ----------

test("conversation: description search, refine, more, sort back to filters", async () => {
  const { store, dir } = await buildStore();
  dirs.push(dir);
  const sem = fakeDeps(store);
  const structuredCalls: any[] = [];
  const deps: Deps = {
    store: new MemorySessionStore(),
    async search(f, opts) {
      structuredCalls.push({ f, opts });
      const rows = ROWS.filter((r) => !f.city || r.L_City === f.city);
      return { listings: rows.slice(0, 5), total: rows.length, page: 1, limit: 5, totalPages: 1 };
    },
    async getListing(id) { return ROWS.find((r) => r.L_ListingID === id) ?? null; },
    semantic: (text, f, opts) => semanticSearch(text, f, opts, sem),
  };

  // plain search stays plain
  let r = await handleMessage("u", "homes in Irvine", deps);
  assert.match(r.text!, /^Found/);

  // descriptive words switch to semantic
  r = await handleMessage("u", "homes in Irvine on a quiet street with a big backyard", deps);
  assert.match(r.text!, /^Best matches/);
  assert.match(r.text!, /1\. 🏠 \*a Main St/);

  // follow-up description adds to it
  r = await handleMessage("u", "only ones with fruit trees", deps);
  assert.equal(r.intent, "semantic");
  assert.match(r.text!, /Best matches/);
  const s = await deps.store.get("u");
  assert.match(s.semanticText!, /backyard.*fruit trees/);

  // details work on semantic results too
  r = await handleMessage("u", "tell me about #1", deps);
  assert.match(r.text!, /Huge backyard/);

  // asking for a sort goes back to filter order
  const before = structuredCalls.length;
  r = await handleMessage("u", "sort by most expensive first", deps);
  assert.equal(structuredCalls.length, before + 1);
  assert.equal((await deps.store.get("u")).mode, "structured");

  // unrelated chit-chat is still not a property request
  r = await handleMessage("u", "what's the weather like?", deps);
  assert.equal(r.text, null);
});

test("without an index, descriptive requests just use filters", async () => {
  const deps: Deps = {
    store: new MemorySessionStore(),
    async search() { return { listings: [], total: 0, page: 1, limit: 5, totalPages: 1 }; },
    async getListing() { return null; },
  };
  const r = await handleMessage("u", "homes in Irvine with a big backyard", deps);
  assert.match(r.text!, /No active listings found/);
});

// ---------- providers (fetch is stubbed, no network) ----------

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test("Gemini provider: request shape, batching, retry on 429, normalized output", async () => {
  const calls: { url: string; body: any; headers: any }[] = [];
  let first = true;
  globalThis.fetch = (async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    if (first) { first = false; return new Response("rate limited", { status: 429 }); }
    const body = JSON.parse(init.body);
    if (url.endsWith(":batchEmbedContents")) {
      return Response.json({ embeddings: body.requests.map(() => ({ values: [3, 4, 0] })) });
    }
    return Response.json({ embedding: { values: [0, 0, 2] } });
  }) as any;

  const g = new GeminiProvider("test-key", "gemini-embedding-2", 3);
  const docs = await g.embedDocuments(["a", "b"]);
  assert.equal(docs.length, 2);
  assert.ok(Math.abs(docs[0][0] - 0.6) < 1e-6, "normalized");
  const batch = calls.at(-1)!;
  assert.match(batch.url, /models\/gemini-embedding-2:batchEmbedContents$/);
  assert.equal(batch.headers["x-goog-api-key"], "test-key");
  assert.equal(batch.body.requests[0].output_dimensionality, 3);
  assert.match(batch.body.requests[0].content.parts[0].text, /^title: none \| text: a/);
  assert.equal(calls.length, 2, "retried once after 429");

  const q = await g.embedQuery("quiet");
  assert.deepEqual(Array.from(q), [0, 0, 1]);
  assert.match(calls.at(-1)!.body.content.parts[0].text, /^task: search result \| query: quiet/);
});

test("OpenAI provider: request shape and order by index", async () => {
  let seen: any;
  globalThis.fetch = (async (_url: string, init: any) => {
    seen = { headers: init.headers, body: JSON.parse(init.body) };
    return Response.json({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] });
  }) as any;
  const o = new OpenAIProvider("sk-test", "text-embedding-3-small", 2);
  const v = await o.embedDocuments(["x", "y"]);
  assert.deepEqual(Array.from(v[0]), [1, 0]);
  assert.equal(seen.headers.Authorization, "Bearer sk-test");
  assert.deepEqual(seen.body, { model: "text-embedding-3-small", input: ["x", "y"], dimensions: 2 });
});

test("a 400 error is not retried and doesn't leak the key", async () => {
  let n = 0;
  globalThis.fetch = (async () => { n++; return new Response("bad request", { status: 400 }); }) as any;
  const g = new GeminiProvider("secret-key-123", "gemini-embedding-2", 3);
  await assert.rejects(g.embedQuery("x"), (e: Error) => /400/.test(e.message) && !e.message.includes("secret-key-123"));
  assert.equal(n, 1);
});
