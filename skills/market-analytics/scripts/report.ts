// Builds a full market report for one area: runs the queries in market.ts and
// combines them with the calculations in analyze.ts.
import {
  buildTrend,
  compare,
  dataWindows,
  marketSignals,
  monthList,
  monthsOfSupply,
  type DataWindows,
} from "./analyze.ts";
import { getDataRange, getInventory, getStats, type MarketFilters } from "./market.ts";
import type { MarketReport } from "./format.ts";

// The date windows every report uses, based on which months the data fully covers.
// Computed once per command, so compared cities and rankings use the same months.
export async function getWindows(today = new Date()): Promise<DataWindows> {
  return dataWindows(today, await getDataRange());
}

export async function buildReport(f: MarketFilters, win: DataWindows): Promise<MarketReport> {
  const { current: window, prior: priorWindow } = win;

  // Three queries: this year vs. last year, 24 months by month, and active listings.
  const [periods, monthly, inventory] = await Promise.all([
    getStats(f, priorWindow.from, window.to, { kind: "period", currentFrom: window.from }),
    getStats(f, priorWindow.from, window.to, { kind: "month" }),
    getInventory(f),
  ]);

  const current = periods.find((p) => p.bucket === "current") ?? null;
  const prior = periods.find((p) => p.bucket === "prior") ?? null;
  const change = compare(current, prior);
  // 24 months are loaded so each shown month can be compared with the same month a
  // year earlier. Only months inside the current window are shown.
  const trend = buildTrend(monthly, monthList(priorWindow.from, window.to), 12)
    .filter((p) => p.month >= window.from.slice(0, 7));
  const supply = inventory.covered ? monthsOfSupply(inventory.active, trend) : null;

  const area = [f.city, f.zip && (f.city ? f.zip : `ZIP ${f.zip}`)].filter(Boolean).join(" ");
  return {
    area,
    type: f.type,
    current,
    prior,
    window,
    priorWindow,
    months: win.months,
    lastSale: win.lastSale,
    change,
    trend,
    inventory,
    supply,
    read: marketSignals(current, change, supply),
  };
}
