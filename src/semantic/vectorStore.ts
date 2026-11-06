// Week 6: a small on-disk vector store for listing embeddings.
//
// data/embeddings/
//   meta.json      provider, model, dims, count, updatedAt
//   ids.json       listing ids, same order as the vectors
//   hashes.json    hash of the text each vector came from (skip unchanged listings on re-index)
//   vectors.f32    all vectors back to back as 32-bit floats
//
// 55K listings x 768 dims x 4 bytes = ~170 MB, loads in about a second and a full
// brute-force scan takes ~30-60 ms in Node. No vector database needed at this size.
// (pgvector / MySQL 9 VECTOR / a FAISS index are the upgrade path if it grows a lot.)
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export interface StoreMeta { provider: string; model: string; dims: number; count: number; updatedAt: string }
export interface Hit { id: string; score: number }

export class VectorStore {
  meta: StoreMeta;
  private ids: string[] = [];
  private hashes: string[] = [];
  private data: Float32Array;
  private index = new Map<string, number>();

  constructor(public dir: string, provider: string, model: string, dims: number) {
    this.meta = { provider, model, dims, count: 0, updatedAt: new Date().toISOString() };
    this.data = new Float32Array(0);
  }

  static defaultDir() { return path.resolve(process.env.EMBEDDINGS_DIR || "data/embeddings"); }

  static exists(dir = VectorStore.defaultDir()) {
    return existsSync(path.join(dir, "meta.json")) && existsSync(path.join(dir, "vectors.f32"));
  }

  static async load(dir = VectorStore.defaultDir()): Promise<VectorStore> {
    const meta = JSON.parse(await readFile(path.join(dir, "meta.json"), "utf8")) as StoreMeta;
    const s = new VectorStore(dir, meta.provider, meta.model, meta.dims);
    s.ids = JSON.parse(await readFile(path.join(dir, "ids.json"), "utf8"));
    s.hashes = existsSync(path.join(dir, "hashes.json"))
      ? JSON.parse(await readFile(path.join(dir, "hashes.json"), "utf8")) : s.ids.map(() => "");
    const buf = await readFile(path.join(dir, "vectors.f32"));
    s.data = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice();
    if (s.data.length !== s.ids.length * meta.dims) throw new Error("Embedding files don't match, re-run the indexer with --rebuild");
    s.ids.forEach((id, i) => s.index.set(id, i));
    s.meta = { ...meta, count: s.ids.length };
    return s;
  }

  get size() { return this.ids.length; }
  has(id: string) { return this.index.has(id); }
  hashOf(id: string) { const i = this.index.get(id); return i == null ? null : this.hashes[i]; }

  // Add or replace vectors
  upsert(items: { id: string; vector: Float32Array; hash: string }[]) {
    const dims = this.meta.dims;
    const fresh = items.filter((it) => !this.index.has(it.id));
    if (fresh.length) {
      const grown = new Float32Array(this.data.length + fresh.length * dims);
      grown.set(this.data);
      this.data = grown;
    }
    let next = this.ids.length;
    for (const it of items) {
      if (it.vector.length !== dims) throw new Error(`vector has ${it.vector.length} dims, store expects ${dims}`);
      let i = this.index.get(it.id);
      if (i == null) { i = next++; this.ids[i] = it.id; this.index.set(it.id, i); }
      this.hashes[i] = it.hash;
      this.data.set(it.vector, i * dims);
    }
    this.meta.count = this.ids.length;
  }

  // Top-k by cosine similarity (vectors are normalized, so dot product).
  // `only` limits the scan to listings that passed the SQL filters.
  search(query: Float32Array, k = 10, only?: Set<string>): Hit[] {
    const dims = this.meta.dims;
    if (query.length !== dims) throw new Error(`query has ${query.length} dims, index has ${dims}. Same provider/model/dims as the index?`);
    const top: Hit[] = [];
    const consider = (i: number) => {
      let dot = 0;
      const off = i * dims;
      for (let d = 0; d < dims; d++) dot += query[d] * this.data[off + d];
      if (top.length < k) { top.push({ id: this.ids[i], score: dot }); top.sort((a, b) => b.score - a.score); }
      else if (dot > top[k - 1].score) { top[k - 1] = { id: this.ids[i], score: dot }; top.sort((a, b) => b.score - a.score); }
    };
    if (only) { for (const id of only) { const i = this.index.get(id); if (i != null) consider(i); } }
    else for (let i = 0; i < this.ids.length; i++) consider(i);
    return top;
  }

  // How many of `only` are in the index (to tell the user when coverage is partial)
  countIndexed(only: Iterable<string>) { let n = 0; for (const id of only) if (this.index.has(id)) n++; return n; }

  // Write to temp files then rename, so a crash mid-save never leaves a broken index
  async save() {
    await mkdir(this.dir, { recursive: true });
    this.meta.updatedAt = new Date().toISOString();
    const files: [string, string | Uint8Array][] = [
      ["ids.json", JSON.stringify(this.ids)],
      ["hashes.json", JSON.stringify(this.hashes)],
      ["vectors.f32", new Uint8Array(this.data.buffer, this.data.byteOffset, this.data.byteLength)],
      ["meta.json", JSON.stringify(this.meta, null, 2)],
    ];
    for (const [name, content] of files) {
      const tmp = path.join(this.dir, `${name}.tmp`);
      await writeFile(tmp, content);
      await rename(tmp, path.join(this.dir, name));
    }
  }
}
