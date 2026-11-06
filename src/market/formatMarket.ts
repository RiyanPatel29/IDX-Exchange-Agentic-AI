// Week 5: market reports as WhatsApp text.
import type { MarketReport, MonthRow } from "./marketStats.ts";
import { prettyType } from "../db/format.ts";

const money = (n: number | null | undefined) =>
  n == null ? "N/A" : `$${Math.round(n).toLocaleString("en-US")}`;

// $1,180,000 -> "$1.18M", $845,000 -> "$845K"
export function shortMoney(n: number | null | undefined): string {
  if (n == null) return "N/A";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, "")}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

const BARS = "▁▂▃▄▅▆▇█";

// [1, 3, 2, 8] -> "▁▃▂█"
export function sparkline(values: (number | null)[]): string {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length < 2) return "";
  const lo = Math.min(...v), hi = Math.max(...v);
  return values.map((x) => {
    if (x == null) return " ";
    if (hi === lo) return BARS[3];
    return BARS[Math.round(((x - lo) / (hi - lo)) * (BARS.length - 1))];
  }).join("");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
const dateNice = (d: string | null) =>
  d ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}` : "?";

const TEMP_LABEL = { seller: "Seller's market 🔥", balanced: "Balanced market ⚖️", buyer: "Buyer's market 🧊" };

export function marketTitle(r: Pick<MarketReport, "place" | "type" | "beds">): string {
  const what = [r.beds != null ? `${r.beds}+ bed` : null, r.type ? prettyType(r.type).toLowerCase() : "home"]
    .filter(Boolean).join(" ");
  return `${r.place} ${what} market`;
}

function trendLine(trend: MonthRow[], r: MarketReport): string | null {
  const spark = sparkline(trend.map((m) => m.medianPrice));
  if (!spark) return null;
  const change = r.trendChangePct == null ? "" :
    `  ${r.trendChangePct > 0 ? "+" : ""}${r.trendChangePct}% (${monthName(r.trendFrom!)} to ${monthName(r.trendTo!)})`;
  return `📈 Median price by month: ${spark}${change}`;
}

export function formatMarketReport(r: MarketReport, opts: { monthly?: boolean; zips?: boolean } = {}): string {
  const s = r.summary;
  if (!s.soldCount) {
    return `No closed ${r.type ? prettyType(r.type).toLowerCase() : "residential"} sales found in ${r.place} in the last ${r.months} months. Check the city spelling or try a nearby city.`;
  }
  const lines = [
    `📊 *${marketTitle(r)}, last ${r.months} months*`,
    `${s.soldCount.toLocaleString("en-US")} closed ${s.soldCount === 1 ? "sale" : "sales"} (${dateNice(s.firstClose)} to ${dateNice(s.lastClose)})`,
    "",
    `💰 Median sale ${money(s.medianPrice)} (avg ${money(s.avgPrice)})`,
    `📏 Median ${money(s.medianPpsf)}/sqft`,
    `⏱ Median ${s.medianDom ?? "?"} days on market`,
    `🏷 Sold at ${s.saleToListPct ?? "?"}% of list price on average${s.pctOverAsking != null ? ` · ${s.pctOverAsking}% went over asking` : ""}`,
  ];

  const inv = r.inventory;
  if (inv.activeCount) {
    const mos = r.monthsOfSupply != null ? ` · ${r.monthsOfSupply} months of supply` : "";
    lines.push(`🏘 ${inv.activeCount.toLocaleString("en-US")} active listings now, median list ${money(inv.medianListPrice)}${mos}`);
    if (r.temperature) lines.push(`➡️ ${TEMP_LABEL[r.temperature]}`);
  } else {
    lines.push("🏘 No active listings right now");
  }

  const tl = trendLine(r.trend, r);
  if (tl) lines.push(tl);

  if (opts.monthly !== false && r.trend.length > 1) {
    lines.push("", "*By month*");
    for (const m of r.trend.slice(-6)) {
      lines.push(`${monthName(m.ym)}: ${m.sold} sold · ${shortMoney(m.medianPrice)} median · ${money(m.avgPpsf)}/sqft · ${m.avgDom ?? "?"} DOM`);
    }
  }

  if (opts.zips !== false && r.zips.length > 1) {
    lines.push("", "*Busiest ZIPs*");
    for (const z of r.zips) lines.push(`${z.zip}: ${z.sold} sold · avg ${shortMoney(z.avgPrice)} · ${money(z.avgPpsf)}/sqft`);
  }

  if (r.monthsCovered < r.months) {
    lines.push("", `_Note: the sales data starts ${dateNice(s.dataStart ?? s.firstClose)}, so this covers about ${r.monthsCovered} months, not ${r.months}._`);
  }
  return lines.join("\n");
}

export function formatComparison(reports: MarketReport[]): string {
  const ok = reports.filter((r) => r.summary.soldCount > 0);
  const first = reports[0];
  const what = first?.type ? prettyType(first.type).toLowerCase() : "home";
  const lines = [`📊 *${what[0].toUpperCase() + what.slice(1)} market comparison, last ${first?.months ?? 12} months*`, ""];

  for (const r of reports) {
    const s = r.summary;
    if (!s.soldCount) { lines.push(`*${r.place}*: no closed sales found`, ""); continue; }
    const temp = r.temperature ? ` · ${TEMP_LABEL[r.temperature]}` : "";
    lines.push(
      `*${r.place}* (${s.soldCount.toLocaleString("en-US")} sales)`,
      `${shortMoney(s.medianPrice)} median · ${money(s.medianPpsf)}/sqft · ${s.medianDom ?? "?"} days · ${s.saleToListPct ?? "?"}% of list`,
      `${r.inventory.activeCount} active · ${r.monthsOfSupply ?? "?"} mo supply${temp}`,
      "",
    );
  }

  if (ok.length >= 2) {
    const by = (f: (r: MarketReport) => number | null, dir: 1 | -1) =>
      ok.filter((r) => f(r) != null).sort((a, b) => dir * (f(a)! - f(b)!))[0];
    const cheapest = by((r) => r.summary.medianPpsf, 1);
    const fastest = by((r) => r.summary.medianDom, 1);
    const hottest = by((r) => r.summary.saleToListPct, -1);
    if (cheapest) lines.push(`💡 Best value per sqft: ${cheapest.place} (${money(cheapest.summary.medianPpsf)})`);
    if (fastest) lines.push(`⚡ Fastest selling: ${fastest.place} (${fastest.summary.medianDom} days)`);
    if (hottest) lines.push(`🔥 Strongest offers: ${hottest.place} (${hottest.summary.saleToListPct}% of list)`);
  }
  return lines.join("\n").trimEnd();
}
