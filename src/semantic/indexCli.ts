// Week 6: build / update the embedding index for listing descriptions (L_Remarks).
//
//   npm run embed:index -- --dry-run                 count listings + rough cost, no API calls
//   npm run embed:index -- --city Irvine             just one city (good first test)
//   npm run embed:index -- --limit 2000              stop after 2000 new/changed listings
//   npm run embed:index                              everything (resumable: Ctrl+C and re-run)
//   npm run embed:index -- --rebuild                 throw away the old index and start over
//   npm run embed:index -- --provider openai         use OpenAI instead of Gemini
//
// Only active listings with a description are embedded. Unchanged descriptions are skipped,
// so re-running after a data refresh only pays for what changed.
import { rm } from "node:fs/promises";
import { getProvider } from "./embeddings.ts";
import { VectorStore } from "./vectorStore.ts";
import { listingDocText, textHash } from "./semanticSearch.ts";
import { getRemarksPage } from "../db/listings.ts";
import { closePool } from "../db/pool.ts";

function parseArgs(argv: string[]) {
  const o = { city: null as string | null, limit: Infinity, batch: 100, dryRun: false, rebuild: false, provider: undefined as string | undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--city") o.city = argv[++i];
    else if (a === "--limit") o.limit = Number(argv[++i]);
    else if (a === "--batch") o.batch = Math.min(100, Math.max(1, Number(argv[++i])));
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--rebuild") o.rebuild = true;
    else if (a === "--provider") o.provider = argv[++i];
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const dir = VectorStore.defaultDir();

  if (o.dryRun) {
    let n = 0, chars = 0, after: string | undefined;
    for (;;) {
      const rows = await getRemarksPage({ city: o.city, afterId: after, batch: 1000 });
      if (!rows.length) break;
      for (const r of rows) { n++; chars += listingDocText(r).length; }
      after = String(rows[rows.length - 1].L_ListingID);
    }
    const tokens = Math.round(chars / 4);
    console.log(`${n.toLocaleString("en-US")} active listings with descriptions${o.city ? ` in ${o.city}` : ""}`);
    console.log(`~${tokens.toLocaleString("en-US")} tokens to embed (~${Math.ceil(n / 100)} API calls of 100)`);
    console.log("Check current embedding prices before a full run. Start with --city or --limit to test.");
    return;
  }

  const provider = getProvider(o.provider);
  if (o.rebuild) await rm(dir, { recursive: true, force: true });

  let store: VectorStore;
  if (VectorStore.exists(dir)) {
    store = await VectorStore.load(dir);
    if (store.meta.model !== provider.model || store.meta.dims !== provider.dims) {
      throw new Error(`Existing index uses ${store.meta.model} (${store.meta.dims} dims). Use --rebuild to switch to ${provider.model}.`);
    }
  } else {
    store = new VectorStore(dir, provider.name, provider.model, provider.dims);
  }
  console.log(`Embedding with ${provider.name}/${provider.model} (${provider.dims} dims). Index has ${store.size.toLocaleString("en-US")} listings.`);

  let after: string | undefined, embedded = 0, skipped = 0;
  const t0 = Date.now();
  outer: for (;;) {
    const rows = await getRemarksPage({ city: o.city, afterId: after, batch: 500 });
    if (!rows.length) break;
    after = String(rows[rows.length - 1].L_ListingID);

    // only new or changed descriptions
    const todo = rows
      .map((r) => { const text = listingDocText(r); return { id: String(r.L_ListingID), text, hash: textHash(text) }; })
      .filter((r) => { if (store.hashOf(r.id) === r.hash) { skipped++; return false; } return true; });

    for (let i = 0; i < todo.length; i += o.batch) {
      if (embedded >= o.limit) break outer;
      const chunk = todo.slice(i, Math.min(i + o.batch, i + (o.limit - embedded)));
      const vectors = await provider.embedDocuments(chunk.map((c) => c.text));
      store.upsert(chunk.map((c, j) => ({ id: c.id, vector: vectors[j], hash: c.hash })));
      embedded += chunk.length;
      await store.save(); // save as we go, so Ctrl+C loses at most one batch
      const rate = embedded / ((Date.now() - t0) / 1000);
      process.stdout.write(`\r  embedded ${embedded.toLocaleString("en-US")} · skipped ${skipped.toLocaleString("en-US")} unchanged · ${rate.toFixed(1)}/s   `);
    }
  }
  await store.save();
  console.log(`\nDone. Index now has ${store.size.toLocaleString("en-US")} listings (${embedded} embedded, ${skipped} unchanged) in ${dir}`);
}

main()
  .catch((err) => {
    console.error("\nIndexing failed:", String(err?.message || err));
    console.error("Progress so far is saved. Fix the issue and run the same command again to resume.");
    process.exitCode = 1;
  })
  .finally(closePool);
