// Week 7: score and explain recommendations. Pure functions, fully unit tested.
//
// Score out of 100:
//   Fit        40  how well it matches what they asked for (budget, beds, size, pool, view, HOA)
//                  ("homes like #2" uses similarity to that home instead)
//   Value      35  its $/sqft vs. the median $/sqft of recent sales of the same type nearby (california_sold)
//   Freshness  10  newer listings first
//   Taste      15  closer to homes they said they like, further from ones they passed on
import type { PropertyFilters } from "../search/parsePropertyQuery.ts";
import type { ListingRow } from "../db/listings.ts";
import { prettyType } from "../db/format.ts";

export interface Benchmark {
  level: "zip_type" | "city_type";
  zip: string | null;
  subtype: string | null;
  n: number;
  medianPpsf: number | null;
}

export interface Taste { liked: ListingRow[]; disliked: ListingRow[] }

export interface Scored {
  listing: ListingRow;
  score: number;                   // 0-100
  parts: { fit: number; value: number; fresh: number; taste: number };
  reasons: string[];               // best first, shown to the user
  discountPct: number | null;      // +12 = 12% below the area median $/sqft
}

const yes = (v: string | null | undefined) => v === "True";
const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function ppsf(l: Pick<ListingRow, "price" | "sqft">): number | null {
  const p = Number(l.price), s = Number(l.sqft);
  if (!(p > 0) || !(s >= 200 && s <= 50_000)) return null;
  return p / s;
}

// Pick the most specific benchmark with enough sales behind it.
// Always the same property type: comparing a condo to house prices would be misleading.
export function benchmarkFor(l: ListingRow, rows: Benchmark[]): (Benchmark & { label: string }) | null {
  const type = l.type ?? null;
  const typeWord = type ? plural(prettyType(type).toLowerCase()) : "homes";
  const tries: [(b: Benchmark) => boolean, number, () => string][] = [
    [(b) => b.level === "zip_type" && b.zip === l.L_Zip && b.subtype === type, 3, () => `${l.L_Zip} ${typeWord}`],
    [(b) => b.level === "city_type" && b.subtype === type, 5, () => `${l.L_City} ${typeWord}`],
  ];
  for (const [match, minN, label] of tries) {
    const b = rows.find((r) => match(r) && Number(r.n) >= minN && r.medianPpsf);
    if (b) return { ...b, n: Number(b.n), medianPpsf: Number(b.medianPpsf), label: label() };
  }
  return null;
}

function plural(w: string) {
  if (w === "single family residence") return "single family homes";
  if (w === "condominium") return "condos";
  return w.endsWith("s") ? w : `${w}s`;
}

// ---------- the four parts ----------

export function fitScore(l: ListingRow, f: Partial<PropertyFilters>) {
  const reasons: string[] = [];
  let pts = 40;
  const price = Number(l.price);

  if (f.maxPrice != null && price > 0) {
    if (price <= f.maxPrice) {
      const under = (f.maxPrice - price) / f.maxPrice;
      if (under >= 0.05) reasons.push(`${money(f.maxPrice - price)} under your budget`);
      else reasons.push("Within budget");
    } else {
      const over = (price - f.maxPrice) / f.maxPrice;           // up to 10% from the relaxed pool
      pts -= Math.min(14, over * 140);
      reasons.push(`⚠️ ${Math.round(over * 100)}% over budget`);
    }
  }
  if (f.beds != null && l.beds != null) {
    if (Number(l.beds) < f.beds) { pts -= 8; reasons.push(`⚠️ ${l.beds} beds (you asked for ${f.beds}+)`); }
    else if (Number(l.beds) > f.beds) reasons.push(`Extra bedroom (${l.beds} bd)`);
  }
  if (f.baths != null && l.baths != null && Number(l.baths) < f.baths) pts -= 4;
  if (f.sqft != null && l.sqft != null && Number(l.sqft) < f.sqft) pts -= 5;
  if (f.pool === "True") {
    if (yes(l.PoolPrivateYN)) reasons.push("Has the pool you wanted"); else { pts -= 8; reasons.push("⚠️ No pool"); }
  }
  if (f.hasView === "True") {
    if (yes(l.ViewYN)) reasons.push("Has a view"); else { pts -= 6; reasons.push("⚠️ No view listed"); }
  }
  if (f.maxHoa != null) {
    const hoa = Number(l.AssociationFee || 0);
    if (hoa > f.maxHoa) pts -= 5;
    else if (f.maxHoa === 0 || hoa === 0) reasons.push("No HOA");
  }
  return { pts: clamp(pts, 0, 40), reasons };
}

// How close a home is to another one (0-1). Used for "homes like #2" and for taste.
export function similarity(a: ListingRow, b: ListingRow): number {
  let s = 0, w = 0;
  const add = (weight: number, v: number) => { s += weight * v; w += weight; };
  add(2, a.L_Zip && a.L_Zip === b.L_Zip ? 1 : a.L_City === b.L_City ? 0.4 : 0);
  add(2, a.type === b.type ? 1 : 0);
  const pa = Number(a.price), pb = Number(b.price);
  add(3, pa > 0 && pb > 0 ? clamp(1 - Math.abs(pa - pb) / Math.max(pa, pb) / 0.3, 0, 1) : 0);
  const ba = Number(a.beds), bb = Number(b.beds);
  add(1.5, Number.isFinite(ba) && Number.isFinite(bb) ? clamp(1 - Math.abs(ba - bb) / 2, 0, 1) : 0);
  const sa = Number(a.sqft), sb = Number(b.sqft);
  add(1.5, sa > 0 && sb > 0 ? clamp(1 - Math.abs(sa - sb) / Math.max(sa, sb) / 0.35, 0, 1) : 0);
  add(0.5, yes(a.PoolPrivateYN) === yes(b.PoolPrivateYN) ? 1 : 0);
  const ya = Number(a.YearBuilt), yb = Number(b.YearBuilt);
  add(0.5, ya > 0 && yb > 0 ? clamp(1 - Math.abs(ya - yb) / 30, 0, 1) : 0.5);
  return w ? s / w : 0;
}

export function valueScore(l: ListingRow, rows: Benchmark[]) {
  const mine = ppsf(l);
  const b = benchmarkFor(l, rows);
  if (mine == null || !b || !b.medianPpsf) {
    return { pts: 17.5, discountPct: null as number | null, reason: null as string | null };
  }
  const d = (b.medianPpsf - mine) / b.medianPpsf;              // +0.10 = 10% cheaper per sqft
  const pts = clamp(17.5 + d * 175, 0, 35);                    // 10% below -> full marks
  const pct = Math.round(Math.abs(d) * 100);
  let reason: string | null = null;
  if (d >= 0.03) reason = `💲 ${pct}% below ${b.label} ($${Math.round(mine)} vs $${Math.round(b.medianPpsf)}/sqft, ${b.n} recent sales)`;
  else if (d <= -0.15) reason = `⚠️ ${pct}% above ${b.label} $/sqft`;
  else if (Math.abs(d) < 0.03) reason = `Priced right at the ${b.label} median ($${Math.round(b.medianPpsf)}/sqft)`;
  return { pts, discountPct: round1(d * 100), reason };
}

export function freshScore(l: ListingRow) {
  const dom = Number(l.DaysOnMarket);
  if (!Number.isFinite(dom)) return { pts: 5, reason: null as string | null };
  if (dom <= 7) return { pts: 10, reason: `🆕 New, ${dom} ${dom === 1 ? "day" : "days"} on market` };
  if (dom <= 30) return { pts: 7, reason: null };
  if (dom <= 90) return { pts: 4, reason: null };
  return { pts: 2, reason: `⏳ ${dom} days on market, may be room to negotiate` };
}

export function tasteScore(l: ListingRow, t: Taste) {
  if (!t.liked.length && !t.disliked.length) return { pts: 7.5, reason: null as string | null };
  const id = String(l.L_ListingID);
  if (t.liked.some((x) => String(x.L_ListingID) === id)) return { pts: 15, reason: "❤️ On your liked list" };
  t = { liked: t.liked.filter((x) => String(x.L_ListingID) !== id), disliked: t.disliked };
  const bestLike = t.liked.length ? Math.max(...t.liked.map((x) => similarity(l, x))) : 0;
  const bestDislike = t.disliked.length ? Math.max(...t.disliked.map((x) => similarity(l, x))) : 0;
  const pts = clamp(7.5 + bestLike * 10 - bestDislike * 6, 0, 15);
  let reason: string | null = null;
  if (t.liked.length && bestLike >= 0.75) {
    const twin = t.liked.find((x) => similarity(l, x) === bestLike)!;
    reason = `👍 Similar to ${twin.L_Address ?? "a home"} you liked`;
  }
  return { pts, reason };
}

// ---------- put it together ----------

export interface ScoreInput {
  filters: Partial<PropertyFilters>;
  benchmarks: Benchmark[];
  taste: Taste;
  anchor?: ListingRow | null;      // set for "homes like #2"
}

export function scoreListing(l: ListingRow, inp: ScoreInput): Scored {
  let fit: { pts: number; reasons: string[] };
  if (inp.anchor) {
    const sim = similarity(l, inp.anchor);
    fit = { pts: sim * 40, reasons: sim >= 0.7 ? [`Close match to ${inp.anchor.L_Address ?? "that home"}`] : [] };
  } else {
    fit = fitScore(l, inp.filters);
  }
  const value = valueScore(l, inp.benchmarks);
  const fresh = freshScore(l);
  const taste = tasteScore(l, inp.taste);

  // Most useful reasons first: value, taste, warnings, fit, freshness
  const warnings = fit.reasons.filter((r) => r.startsWith("⚠️"));
  const goods = fit.reasons.filter((r) => !r.startsWith("⚠️"));
  const reasons = [value.reason, taste.reason, ...warnings, ...goods, fresh.reason].filter((r): r is string => Boolean(r));

  const parts = { fit: round1(fit.pts), value: round1(value.pts), fresh: fresh.pts, taste: round1(taste.pts) };
  const score = Math.round(parts.fit + parts.value + parts.fresh + parts.taste);
  return { listing: l, score: clamp(score, 0, 100), parts, reasons, discountPct: value.discountPct };
}

// Rank, drop disliked homes, and don't let one ZIP take over the top 5.
export function rank(scored: Scored[], opts: { excludeIds?: Set<string>; max?: number; perZipInTop5?: number } = {}): Scored[] {
  const max = opts.max ?? 50;
  const perZip = opts.perZipInTop5 ?? 3;
  const sorted = scored
    .filter((s) => !opts.excludeIds?.has(String(s.listing.L_ListingID)))
    .sort((a, b) => b.score - a.score || Number(a.listing.price) - Number(b.listing.price));

  const top: Scored[] = [];
  const held: Scored[] = [];
  const zipCount = new Map<string, number>();
  for (const s of sorted) {
    if (top.length >= 5) { held.push(s); continue; }
    const z = s.listing.L_Zip ?? "?";
    if ((zipCount.get(z) ?? 0) >= perZip) { held.push(s); continue; }
    zipCount.set(z, (zipCount.get(z) ?? 0) + 1);
    top.push(s);
  }
  // if diversity left the top 5 short, fill from what was held back (order kept)
  while (top.length < 5 && held.length) top.push(held.shift()!);
  return [...top, ...held].slice(0, max);
}
