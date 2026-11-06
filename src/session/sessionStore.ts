// Week 4: per-user session memory.
// Remembers each user's last search (filters, page, sort, which listings were shown)
// so follow-ups like "more", "only ones with a pool" or "tell me about #2" work.
//
// Sessions live in data/sessions/ as small JSON files (data/ is gitignored).
// File names are a hash of the user id, so phone numbers never show up on disk as names.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import type { PropertyFilters } from "../search/parsePropertyQuery.ts";
import type { SortKey } from "../db/queries.ts";

export interface ShownStats {
  minPrice: number | null;
  maxPrice: number | null;
  medianSqft: number | null;
}

export interface SessionState {
  userId: string;
  // Last search
  mode: "structured" | "semantic";   // semantic = Week 6 description search
  semanticText: string | null;       // the descriptive part of a semantic search
  filters: Partial<PropertyFilters>;
  sort: SortKey;
  page: number;
  limit: number;
  lastResultIds: string[];           // listing IDs shown on the current page, in order
  lastResultStart: number;           // card number of lastResultIds[0] (1 on page 1, 6 on page 2...)
  totalPages: number;
  shown: ShownStats;
  // Week 5: last market question, so "what about Tustin" can compare markets too
  lastMarket: { cities: string[]; months: number; type: string | null; beds: number | null } | null;
  lastIntent: string | null;
  history: { at: string; text: string; intent: string }[]; // last 10 messages, for debugging
  updatedAt: number;
}

export function newSession(userId: string): SessionState {
  return {
    userId, mode: "structured", semanticText: null, filters: {}, sort: "price_asc",
    page: 1, limit: 5, lastResultIds: [], lastResultStart: 1, totalPages: 0,
    shown: { minPrice: null, maxPrice: null, medianSqft: null },
    lastMarket: null, lastIntent: null, history: [], updatedAt: Date.now(),
  };
}

export function hasSearch(s: SessionState): boolean {
  return s.lastIntent != null && (Object.keys(s.filters).length > 0 || Boolean(s.semanticText) || s.totalPages > 0);
}

export interface SessionStore {
  get(userId: string): Promise<SessionState>;
  save(s: SessionState): Promise<void>;
  clear(userId: string): Promise<void>;
}

const DEFAULT_TTL_MIN = Number(process.env.SESSION_TTL_MINUTES || 120);

function expired(s: SessionState, ttlMin: number): boolean {
  return Date.now() - s.updatedAt > ttlMin * 60_000;
}

function cleanId(userId: string): string {
  return String(userId || "me").trim() || "me";
}

// In-memory store, used by tests
export class MemorySessionStore implements SessionStore {
  private map = new Map<string, SessionState>();
  constructor(private ttlMin = DEFAULT_TTL_MIN) {}
  async get(userId: string) {
    const id = cleanId(userId);
    const s = this.map.get(id);
    return s && !expired(s, this.ttlMin) ? structuredClone(s) : newSession(id);
  }
  async save(s: SessionState) { this.map.set(s.userId, structuredClone({ ...s, updatedAt: Date.now() })); }
  async clear(userId: string) { this.map.delete(cleanId(userId)); }
}

// File store, used by the CLI / WhatsApp
export class FileSessionStore implements SessionStore {
  constructor(
    private dir = path.resolve(process.env.SESSION_DIR || "data/sessions"),
    private ttlMin = DEFAULT_TTL_MIN,
  ) {}

  private file(userId: string) {
    const h = createHash("sha256").update(cleanId(userId)).digest("hex").slice(0, 20);
    return path.join(this.dir, `${h}.json`);
  }

  async get(userId: string): Promise<SessionState> {
    const id = cleanId(userId);
    try {
      const s = JSON.parse(await readFile(this.file(id), "utf8")) as SessionState;
      if (expired(s, this.ttlMin)) return newSession(id);
      return { ...newSession(id), ...s, userId: id }; // fill in fields added later
    } catch {
      return newSession(id); // no file yet, or unreadable: start fresh
    }
  }

  async save(s: SessionState): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const out = { ...s, history: s.history.slice(-10), updatedAt: Date.now() };
    await writeFile(this.file(s.userId), JSON.stringify(out, null, 2));
  }

  async clear(userId: string): Promise<void> {
    await rm(this.file(userId), { force: true });
  }
}
