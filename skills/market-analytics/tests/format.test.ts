// Tests for the WhatsApp messages. No database needed.
// Run with: node --experimental-strip-types --test tests/format.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTrend, compare, marketSignals, monthList, windows, type StatsRow } from "../scripts/analyze.ts";
import { arrowPct, compareMessage, reportMessage, shortMoney, topCitiesMessage, type MarketReport } from "../scripts/format.ts";

const today = new Date(2026, 9, 28);
const { current: window, prior: priorWindow } = windows(today);

function row(bucket: string, over: Partial<StatsRow> = {}): StatsRow {
  return {
    bucket, sales: 40, avg_price: 1_250_000, median_price: 1_200_000, avg_ppsf: 640, median_ppsf: 635,
    avg_dom: 25.4, median_dom: 24, list_to_close_pct: 100.5, ...over,
  };
}

function report(over: Partial<MarketReport> = {}): MarketReport {
  const months = monthList(priorWindow.from, window.to);
  const current = row("current", { sales: 480 });
  const prior = row("prior", { sales: 470, median_price: 1_150_000 });
  const change = compare(current, prior);
  return {
    area: "Irvine", type: null, current, prior, window, priorWindow, months: 12, lastSale: "2026-10-27", change,
    trend: buildTrend(months.map((m) => row(m)), months),
    inventory: { active: 18, covered: true }, supply: 0.5,
    read: marketSignals(current, change, 0.5), ...over,
  };
}

test("report shows the deliverable's metrics: median price, DOM, list-to-close, 12-month trend", () => {
  const msg = reportMessage(report());
  assert.match(msg, /Irvine market/);
  assert.match(msg, /Oct 2025–Sep 2026/);
  assert.match(msg, /Median price \*\$1,200,000\* \(▲ 4.3% vs. last year\)/);
  assert.match(msg, /\*24 days\* on market/);
  assert.match(msg, /\*100.5%\* of list price/);
  assert.match(msg, /\$635\/sqft/);
  assert.match(msg, /Average \$640\/sqft/);
  assert.match(msg, /Data runs through Oct 27, 2026/);
  assert.match(msg, /18\* active listings now · 0.5 months of supply/);
  assert.match(msg, /12-month trend/);
  assert.equal((msg.match(/^\w{3} '\d\d · /gm) ?? []).length, 12);
  assert.match(msg, /Market read/);
  assert.match(msg, /not financial advice/);
});

test("report says when listings data doesn't cover the area", () => {
  const msg = reportMessage(report({ inventory: { active: 0, covered: false }, supply: null }));
  assert.match(msg, /not in the current listings data/);
  assert.doesNotMatch(msg, /months of supply/);
});

test("report warns about small samples and handles no sales", () => {
  assert.match(reportMessage(report({ current: row("current", { sales: 4 }) })), /Only 4 sales/);
  assert.match(reportMessage(report({ current: null })), /No sales found/);
});

test("comparison and top-cities messages", () => {
  const msg = compareMessage([report(), report({ area: "Tustin" })]);
  assert.match(msg, /Market comparison/);
  assert.match(msg, /\*Irvine\* · 480 sold/);
  assert.match(msg, /\*Tustin\*/);
  const top = topCitiesMessage(
    [{ City: "Irvine", sold_count: 479, avg_close_price: 1_274_181, avg_price_per_sqft: 639, avg_dom: 24.3, list_to_close_pct: 100.5 }],
    window,
    "Condominium",
  );
  assert.match(top, /Busiest markets\* · condos/);
  assert.match(top, /\*1. Irvine\* · 479 sold/);
  assert.match(top, /Avg \$1.27M/);
});

test("arrows and short money", () => {
  assert.equal(arrowPct(3.2), "▲ 3.2%");
  assert.equal(arrowPct(-1.5), "▼ 1.5%");
  assert.equal(arrowPct(0), "→ 0%");
  assert.equal(arrowPct(null), "");
  assert.equal(shortMoney(1_234_567), "$1.23M");
  assert.equal(shortMoney(905_000), "$905K");
});

test("report with a few months of data and no year-ago sales", () => {
  const msg = reportMessage(report({
    window: { from: "2026-04-01", to: "2026-09-01", label: "Apr 2026–Aug 2026" },
    months: 5, prior: null, change: compare(row("current"), null),
    trend: buildTrend([], monthList("2026-04-01", "2026-09-01"), 12),
  }));
  assert.match(msg, /Apr 2026–Aug 2026 \(5 complete months of data\)/);
  assert.match(msg, /no year-over-year changes yet/);
  assert.match(msg, /Monthly trend \(5 months\)/);
  assert.doesNotMatch(msg, /vs\. last year/);
});
