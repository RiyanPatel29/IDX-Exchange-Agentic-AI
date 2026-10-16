// Week 3: turn rows into short "property cards" that read well on WhatsApp.
// WhatsApp uses *bold*, so cards use that instead of markdown headings.
import type { ListingRow, SoldRow, CompsSummary, SearchResult } from "./listings.ts";
import type { PropertyFilters } from "../search/parsePropertyQuery.ts";

const money = (n: number | null | undefined) =>
  n == null || Number.isNaN(Number(n)) ? "N/A" : `$${Math.round(Number(n)).toLocaleString("en-US")}`;
const num = (n: number | null | undefined) =>
  n == null ? "?" : Number(n).toLocaleString("en-US");
const yes = (v: string | null) => v === "True";

// "SingleFamilyResidence" -> "Single Family Residence"
export function prettyType(t: string | null): string {
  return t ? t.replace(/([a-z])([A-Z])/g, "$1 $2") : "Property";
}

function dateStr(d: Date | string | null): string {
  if (!d) return "?";
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

export function formatListingCard(l: ListingRow, index?: number): string {
  const head = index != null ? `${index}. ` : "";
  const addr = [l.L_Address, l.L_City].filter(Boolean).join(", ") + (l.L_Zip ? ` ${l.L_Zip}` : "");
  const extras = [
    yes(l.PoolPrivateYN) ? "Pool" : null,
    yes(l.ViewYN) ? "View" : null,
    yes(l.FireplaceYN) ? "Fireplace" : null,
  ].filter(Boolean);
  const details = [
    prettyType(l.type),
    l.YearBuilt ? `Built ${l.YearBuilt}` : null,
    l.AssociationFee ? `HOA ${money(l.AssociationFee)}/mo` : null,
  ].filter(Boolean).join(" · ");

  return [
    `${head}🏠 *${addr || "Address not listed"}*`,
    `💰 ${money(l.price)} | 🛏 ${num(l.beds)} bd / ${num(l.baths)} ba | 📐 ${num(l.sqft)} sqft`,
    `🏷 ${details}${extras.length ? ` · ${extras.join(", ")}` : ""}`,
    `📅 ${num(l.DaysOnMarket)} days on market · 📷 ${num(l.PhotoCount)} photos · MLS# ${l.L_DisplayId ?? l.L_ListingID}`,
  ].join("\n");
}

export function describeFilters(f: Partial<PropertyFilters>): string {
  const parts: string[] = [];
  if (f.type) parts.push(prettyType(f.type));
  if (f.city) parts.push(`in ${f.city}`);
  if (f.beds != null) parts.push(`${f.beds}+ bd`);
  if (f.baths != null) parts.push(`${f.baths}+ ba`);
  if (f.minPrice != null && f.maxPrice != null) parts.push(`${money(f.minPrice)} to ${money(f.maxPrice)}`);
  else if (f.maxPrice != null) parts.push(`under ${money(f.maxPrice)}`);
  else if (f.minPrice != null) parts.push(`over ${money(f.minPrice)}`);
  if (f.sqft != null) parts.push(`${num(f.sqft)}+ sqft`);
  if (f.pool === "True") parts.push("with pool");
  if (f.pool === "False") parts.push("no pool");
  if (f.hasView === "True") parts.push("with view");
  if (f.maxHoa === 0) parts.push("no HOA");
  else if (f.maxHoa != null) parts.push(`HOA under ${money(f.maxHoa)}`);
  return parts.join(", ") || "all active listings";
}

export function formatSearchResult(r: SearchResult, f: Partial<PropertyFilters>): string {
  if (r.total === 0) {
    return `No active listings found for: ${describeFilters(f)}.\nTry a higher budget, fewer beds, or a nearby city.`;
  }
  const start = (r.page - 1) * r.limit + 1;
  const end = start + r.listings.length - 1;
  const header = `Found ${r.total.toLocaleString("en-US")} active listings (${describeFilters(f)}). Showing ${start}-${end}:`;
  const cards = r.listings.map((l, i) => formatListingCard(l, start + i));
  const footer = r.page < r.totalPages ? `\nReply "more" for page ${r.page + 1} of ${r.totalPages}.` : "";
  return [header, ...cards].join("\n\n") + footer;
}

export function formatCompCard(s: SoldRow): string {
  const ratio = s.ListPrice ? ` (${((s.ClosePrice / s.ListPrice) * 100).toFixed(1)}% of list)` : "";
  return [
    `✅ *${s.UnparsedAddress ?? "Address not listed"}, ${s.City ?? ""}*`,
    `Sold ${money(s.ClosePrice)} on ${dateStr(s.closeDate)}${ratio}`,
    `🛏 ${num(s.BedroomsTotal)} bd / ${num(s.BathroomsTotalInteger)} ba | 📐 ${num(s.LivingArea)} sqft | ${num(s.DaysOnMarket)} DOM`,
  ].join("\n");
}

export function formatCompsSummary(city: string, s: CompsSummary): string {
  if (!s.soldCount) return `No residential sales found in ${city} in the last ${s.months} months.`;
  return [
    `📊 *${city}: last ${s.months} months*`,
    `${s.soldCount.toLocaleString("en-US")} ${s.soldCount === 1 ? "home" : "homes"} sold · avg ${money(s.avgClosePrice)}`,
    `avg ${money(s.avgPricePerSqft)}/sqft · ${s.avgDom ?? "?"} days on market · ${s.listToClosePct ?? "?"}% of list price`,
  ].join("\n");
}
