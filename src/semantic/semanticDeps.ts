// Week 6: wire semantic search to the real DB, provider and on-disk index.
// Returns null when there's no index yet or no API key, so the assistant
// just falls back to normal filter search.
import { getProvider } from "./embeddings.ts";
import { VectorStore } from "./vectorStore.ts";
import { semanticSearch, type SemanticResult } from "./semanticSearch.ts";
import { getCandidateIds, getListingsByIds } from "../db/listings.ts";
import type { PropertyFilters } from "../search/parsePropertyQuery.ts";

export function liveSemantic():
  ((text: string, f: Partial<PropertyFilters>, opts: { page: number; limit: number }) => Promise<SemanticResult>) | undefined {
  if (!VectorStore.exists()) return undefined;
  let provider;
  try { provider = getProvider(); } catch { return undefined; }
  let store: Promise<VectorStore> | null = null; // load the ~170 MB index only when first needed
  return async (text, f, opts) => {
    store ??= VectorStore.load();
    return semanticSearch(text, f, opts, {
      provider: provider!, store: await store,
      candidateIds: getCandidateIds, fetchByIds: getListingsByIds,
    });
  };
}
