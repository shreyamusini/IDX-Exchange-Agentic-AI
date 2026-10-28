// WhatsApp messages for market stats. Plain text with *bold*, short lines, and
// arrows for changes, so the numbers read well on a phone.
import {
  LOW_SAMPLE,
  monthLabel,
  type Comparison,
  type Lean,
  type Signal,
  type StatsRow,
  type TrendPoint,
  type Window,
} from "./analyze.ts";
import type { CityRow } from "./market.ts";

export type MarketReport = {
  area: string;
  type: string | null;
  current: StatsRow | null;
  prior: StatsRow | null;
  window: Window;
  priorWindow: Window;
  months: number; // complete months of data in `window`
  lastSale: string | null; // newest sale in the data
  change: Comparison;
  trend: TrendPoint[];
  inventory: { active: number; covered: boolean };
  supply: number | null;
  read: { lean: Lean; signals: Signal[] };
};

const TYPE_LABELS: Record<string, string> = {
  SingleFamilyResidence: "single family homes",
  Condominium: "condos",
  Townhouse: "townhomes",
};

export function typeLabel(type: string | null): string {
  return type ? (TYPE_LABELS[type] ?? type) : "homes";
}

// "Sep 12, 2026" from "2026-09-12".
export function longDate(d: string | null): string {
  if (!d) return "";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return `${monthLabel(`${y}-${String(m).padStart(2, "0")}`).split(" ")[0]} ${day}, ${y}`;
}

function windowLine(r: MarketReport): string {
  return r.months >= 12
    ? `${r.window.label} (last 12 complete months)`
    : `${r.window.label} (${r.months} complete month${r.months === 1 ? "" : "s"} of data)`;
}

function footer(r: MarketReport, sales: number): string {
  const through = r.lastSale ? ` Data runs through ${longDate(r.lastSale)}; partial months are left out.` : "";
  return `_Based on ${sales.toLocaleString("en-US")} closed sales in california_sold.${through} Market data, not financial advice._`;
}

export function money(n: number | null | undefined): string {
  if (n == null) return "n/a";
  return "$" + Math.round(n).toLocaleString("en-US");
}

export function shortMoney(n: number | null | undefined): string {
  if (n == null) return "n/a";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

// "▲ 3.2%", "▼ 1.5%", "→ 0%". Empty when there's nothing to compare against.
export function arrowPct(p: number | null): string {
  if (p == null) return "";
  if (p > 0) return `▲ ${p}%`;
  if (p < 0) return `▼ ${-p}%`;
  return "→ 0%";
}

function arrowDays(d: number | null): string {
  if (d == null) return "";
  if (d > 0) return `▲ ${d} day${d === 1 ? "" : "s"}`;
  if (d < 0) return `▼ ${-d} day${d === -1 ? "" : "s"}`;
  return "→ same";
}

function arrowPts(d: number | null): string {
  if (d == null) return "";
  if (d > 0) return `▲ ${d} pts`;
  if (d < 0) return `▼ ${-d} pts`;
  return "→ same";
}

function vsLastYear(change: string): string {
  return change ? ` (${change} vs. last year)` : "";
}

const LEAN_TEXT: Record<Lean, string> = {
  buyers: "Leans toward *buyers*: more room to negotiate",
  sellers: "Leans toward *sellers*: expect competition",
  balanced: "*Balanced*: neither side has a clear edge",
};

export function reportMessage(r: MarketReport): string {
  const c = r.current;
  const title = `📊 *${r.area} market* · ${typeLabel(r.type)}`;
  if (!c || c.sales === 0) {
    return `${title}\nNo sales found for ${r.window.label}. Try a nearby city or leave out the property type.`;
  }
  const hasYoY = (r.prior?.sales ?? 0) > 0;

  const lines = [
    title,
    windowLine(r),
    "",
    `🏠 *${c.sales.toLocaleString("en-US")}* homes sold${vsLastYear(arrowPct(r.change.salesPct))}`,
    `💰 Median price *${money(c.median_price)}*${vsLastYear(arrowPct(r.change.medianPricePct))}`,
    `     Average ${money(c.avg_price)}`,
    `📐 Median *${money(c.median_ppsf)}/sqft*${vsLastYear(arrowPct(r.change.ppsfPct))}`,
    `     Average ${money(c.avg_ppsf)}/sqft`,
    `⏱️ Median *${c.median_dom ?? "n/a"} days* on market${vsLastYear(arrowDays(r.change.domDays))}`,
    `🤝 Sold at *${c.list_to_close_pct ?? "n/a"}%* of list price${vsLastYear(arrowPts(r.change.listToClosePts))}`,
  ];

  if (r.inventory.covered) {
    const supply = r.supply != null ? ` · ${r.supply} months of supply` : "";
    lines.push(`📦 *${r.inventory.active}* active listings now${supply}`);
  } else {
    lines.push("📦 Active listings: not in the current listings data for this area");
  }

  if (!hasYoY) {
    lines.push("", "ℹ️ The data has no sales from a year earlier, so there are no year-over-year changes yet.");
  }
  if (c.sales < LOW_SAMPLE) {
    lines.push("", `⚠️ Only ${c.sales} sales, so a few homes can move these numbers a lot.`);
  }

  // 12-month trend, newest last.
  const trendTitle = r.trend.length >= 12 ? "12-month trend" : `Monthly trend (${r.trend.length} months)`;
  lines.push("", `📈 *${trendTitle}* (median price · $/sqft · sales · days)`);
  for (const p of r.trend) {
    lines.push(
      p.sales === 0
        ? `${monthLabel(p.month, true)} · no sales`
        : `${monthLabel(p.month, true)} · ${shortMoney(p.median_price)} · ${money(p.median_ppsf)} · ${p.sales} · ${p.median_dom ?? "–"}d`,
    );
  }

  const last = r.trend.at(-1);
  if (last && last.sales > 0) {
    const parts: string[] = [];
    if (last.momPct != null) parts.push(`${arrowPct(last.momPct)} vs. the month before`);
    if (last.yoyPct != null) parts.push(`${arrowPct(last.yoyPct)} vs. ${monthLabel(last.month).replace(/\d{4}$/, (y) => String(Number(y) - 1))}`);
    if (parts.length) {
      // One month of a small market is only a handful of sales, so flag the noise.
      const note = last.sales < 20 ? ` (only ${last.sales} sales, so single months swing a lot)` : "";
      lines.push(`${monthLabel(last.month)} median: ${parts.join(", ")}${note}`);
    }
  }

  // The market read, with the reasons behind it.
  lines.push("", `🧭 *Market read:* ${LEAN_TEXT[r.read.lean]}`);
  for (const s of r.read.signals) lines.push(`• ${s.text}`);

  lines.push("", footer(r, c.sales));
  return lines.join("\n");
}

// Shorter block per city when the question names more than one.
export function compareMessage(reports: MarketReport[]): string {
  const blocks = reports.map((r) => {
    const c = r.current;
    if (!c || c.sales === 0) return `*${r.area}*\nNo sales found for ${r.window.label}.`;
    return [
      `*${r.area}* · ${c.sales.toLocaleString("en-US")} sold`,
      `💰 Median ${money(c.median_price)} ${arrowPct(r.change.medianPricePct)}`.trimEnd(),
      `📐 ${money(c.median_ppsf)}/sqft · ⏱️ ${c.median_dom ?? "n/a"} days · 🤝 ${c.list_to_close_pct ?? "n/a"}% of list`,
      `🧭 ${LEAN_TEXT[r.read.lean].split(":")[0]}`,
    ].join("\n");
  });
  const head = reports[0];
  return [
    `📊 *Market comparison* · ${typeLabel(head.type)}`,
    `${windowLine(head)} · arrows are vs. the year before`,
    "",
    blocks.join("\n\n"),
    "",
    "_Ask about one city for its monthly trend._",
  ].join("\n");
}

// The handbook's City Market Summary, as a ranked list.
export function topCitiesMessage(rows: CityRow[], window: Window, type: string | null): string {
  if (rows.length === 0) return `No residential sales found for ${window.label}.`;
  const lines = [`🏆 *Busiest markets* · ${typeLabel(type)} · ${window.label}`, ""];
  rows.forEach((r, i) => {
    lines.push(
      `*${i + 1}. ${r.City}* · ${r.sold_count.toLocaleString("en-US")} sold`,
      `   Avg ${shortMoney(r.avg_close_price)} · ${money(r.avg_price_per_sqft)}/sqft · ${r.avg_dom ?? "n/a"} days · ${r.list_to_close_pct ?? "n/a"}% of list`,
    );
  });
  lines.push("", "_Ask about any city for medians and its 12-month trend._");
  return lines.join("\n");
}
