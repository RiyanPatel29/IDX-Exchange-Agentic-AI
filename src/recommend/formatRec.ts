// Week 7: WhatsApp text for recommendations.
import type { ListingRow } from "../db/listings.ts";
import type { PropertyFilters } from "../search/parsePropertyQuery.ts";
import { formatListingCard, describeFilters } from "../db/format.ts";
import type { SoldHistory } from "./recommend.ts";

export interface RecItem { id: string; score: number; reasons: string[] }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nice = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function recCard(l: ListingRow, item: RecItem, n: number, hist?: SoldHistory): string {
  const lines = [formatListingCard(l, n), `⭐ Match ${item.score}/100`];
  for (const r of item.reasons.slice(0, 3)) lines.push(`• ${r}`);
  if (hist) {
    const now = Number(l.price);
    const change = now > 0 ? ` (now ${now >= hist.ClosePrice ? "+" : ""}${Math.round(((now - hist.ClosePrice) / hist.ClosePrice) * 100)}%)` : "";
    lines.push(`• 📜 Last sold ${money(hist.ClosePrice)} in ${nice(hist.closeDate)}${change}`);
  }
  return lines.join("\n");
}

export interface RecPageInfo {
  rows: ListingRow[];             // listings for this page, in rank order
  items: RecItem[];               // same order
  start: number;                  // card number of the first one
  total: number;                  // how many ranked picks there are
  poolSize: number;
  filters: Partial<PropertyFilters>;
  anchorLabel?: string | null;    // "4 Test Ln" for "homes like #2"
  liked: number;
  history?: Record<string, SoldHistory>;
}

export function formatRecPage(p: RecPageInfo): string {
  if (!p.rows.length) {
    if (p.anchorLabel) return `I couldn't find active homes similar to ${p.anchorLabel} right now. Try "homes like" another one, or widen the search.`;
    return `No active listings to recommend for ${describeFilters(p.filters)}. Try a higher budget, fewer beds, or a nearby city.`;
  }
  const what = p.anchorLabel ? `homes like ${p.anchorLabel}` : describeFilters(p.filters).replace(/^in /, "");
  const tuned = p.liked ? `, tuned to the ${p.liked} ${p.liked === 1 ? "home" : "homes"} you liked` : "";
  const end = p.start + p.rows.length - 1;
  const head = p.start === 1
    ? `🎯 *Top picks: ${what}*\nRanked ${p.poolSize} active ${p.poolSize === 1 ? "listing" : "listings"} on fit, value vs. recent sales nearby, and freshness${tuned}. Showing ${p.start}-${end}:`
    : `🎯 More picks: ${what}. Showing ${p.start}-${end}:`;

  const cards = p.rows.map((l, i) => recCard(l, p.items[i], p.start + i, p.history?.[String(l.L_ListingID)]));
  const tips = end < p.total
    ? `Reply "more", "tell me about #${p.start}", "homes like #${p.start}", or "I like #${p.start}" / "not #${p.start}" to tune your picks.`
    : `That's all my picks. Say "I like #N" or "not #N" and ask again to tune them.`;
  return [head, ...cards, tips].join("\n\n");
}

export function formatFavorites(rows: ListingRow[]): string {
  if (!rows.length) return `You haven't liked any homes yet. Say "I like #2" on any result to save it.`;
  return [`❤️ *Your liked homes* (${rows.length})`, ...rows.map((l, i) => formatListingCard(l, i + 1))].join("\n\n") +
    `\n\nSay "recommend" for picks based on these, or "clear my likes" to start fresh.`;
}
