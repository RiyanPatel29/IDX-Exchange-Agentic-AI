// Week 6: turn text into vectors (embeddings) so "quiet street with a big backyard"
// can match listings whose description says the same thing in other words.
//
// Providers:
//   gemini (default): gemini-embedding-2 via GEMINI_API_KEY (the key OpenClaw already uses)
//   openai          : text-embedding-3-small via OPENAI_API_KEY (the handbook's choice)
//   fake            : offline word-hashing, for tests only
// Pick with EMBEDDING_PROVIDER=gemini|openai. All vectors are normalized to length 1,
// so cosine similarity is just a dot product.
import "dotenv/config";
import { createHash } from "node:crypto";

export interface EmbeddingProvider {
  name: string;
  model: string;
  dims: number;
  embedDocuments(texts: string[]): Promise<Float32Array[]>;
  embedQuery(text: string): Promise<Float32Array>;
}

export const DEFAULT_DIMS = Number(process.env.EMBEDDING_DIMS || 768);

export function normalize(v: ArrayLike<number>): Float32Array {
  const out = new Float32Array(v.length);
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const len = Math.sqrt(sum) || 1;
  for (let i = 0; i < v.length; i++) out[i] = v[i] / len;
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// POST with retries on rate limits (429) and server errors (5xx)
async function postJson(url: string, headers: Record<string, string>, body: unknown, tries = 5): Promise<any> {
  let wait = 2000;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    if (res.ok) return res.json();
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < tries) {
      await sleep(wait);
      wait *= 2;
      continue;
    }
    // Never echo the key; the error body from these APIs doesn't contain it
    throw new Error(`Embedding API ${res.status}: ${text.slice(0, 300)}`);
  }
}

// ---------- Gemini ----------
// gemini-embedding-2 takes the task as a text prefix instead of a taskType field.
export class GeminiProvider implements EmbeddingProvider {
  name = "gemini";
  constructor(
    private apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
    public model = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2",
    public dims = DEFAULT_DIMS,
  ) {
    if (!this.apiKey) throw new Error("GEMINI_API_KEY is not set (add it to the project .env)");
  }
  private url(method: string) {
    return `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:${method}`;
  }
  private request(text: string) {
    return { model: `models/${this.model}`, content: { parts: [{ text }] }, output_dimensionality: this.dims };
  }
  async embedDocuments(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 100) { // API limit: 100 per batch call
      const chunk = texts.slice(i, i + 100).map((t) => this.request(`title: none | text: ${t}`));
      const json = await postJson(this.url("batchEmbedContents"), { "x-goog-api-key": this.apiKey }, { requests: chunk });
      for (const e of json.embeddings ?? []) out.push(normalize(e.values));
    }
    if (out.length !== texts.length) throw new Error(`Gemini returned ${out.length} embeddings for ${texts.length} texts`);
    return out;
  }
  async embedQuery(text: string): Promise<Float32Array> {
    const json = await postJson(this.url("embedContent"), { "x-goog-api-key": this.apiKey },
      this.request(`task: search result | query: ${text}`));
    const values = json.embedding?.values ?? json.embeddings?.[0]?.values;
    if (!values) throw new Error("Gemini returned no embedding");
    return normalize(values);
  }
}

// ---------- OpenAI ----------
export class OpenAIProvider implements EmbeddingProvider {
  name = "openai";
  constructor(
    private apiKey = process.env.OPENAI_API_KEY || "",
    public model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
    public dims = DEFAULT_DIMS,
  ) {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is not set (add it to the project .env)");
  }
  private async embed(input: string[]): Promise<Float32Array[]> {
    const json = await postJson("https://api.openai.com/v1/embeddings",
      { Authorization: `Bearer ${this.apiKey}` }, { model: this.model, input, dimensions: this.dims });
    return (json.data as { index: number; embedding: number[] }[])
      .sort((a, b) => a.index - b.index).map((d) => normalize(d.embedding));
  }
  async embedDocuments(texts: string[]) {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 100) out.push(...(await this.embed(texts.slice(i, i + 100))));
    return out;
  }
  async embedQuery(text: string) { return (await this.embed([text]))[0]; }
}

// ---------- Fake (tests) ----------
// Each word is hashed into a slot, so texts sharing words get similar vectors.
// Good enough to test the plumbing, not a real model.
const STEM = (w: string) => w.replace(/(ing|ed|es|s)$/, "");
export class FakeProvider implements EmbeddingProvider {
  name = "fake";
  model = "fake-bow";
  constructor(public dims = 256) {}
  private vec(text: string) {
    const v = new Float32Array(this.dims);
    for (const w of text.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
      const h = createHash("md5").update(STEM(w)).digest();
      v[h.readUInt32LE(0) % this.dims] += 1;
    }
    return normalize(v);
  }
  async embedDocuments(texts: string[]) { return texts.map((t) => this.vec(t)); }
  async embedQuery(text: string) { return this.vec(text); }
}

export function getProvider(name = process.env.EMBEDDING_PROVIDER): EmbeddingProvider {
  const pick = (name || (process.env.GEMINI_API_KEY ? "gemini" : process.env.OPENAI_API_KEY ? "openai" : "gemini")).toLowerCase();
  if (pick === "openai") return new OpenAIProvider();
  if (pick === "fake") return new FakeProvider();
  return new GeminiProvider();
}
