// Unit tests for the calculations. No database needed.
// Run with: node --experimental-strip-types --test tests/analyze.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTrend,
  compare,
  dataAnchor,
  dataWindows,
  firstFullMonth,
  marketSignals,
  monthList,
  monthStart,
  monthsOfSupply,
  pctChange,
  windows,
  type StatsRow,
} from "../scripts/analyze.ts";

function row(bucket: string, over: Partial<StatsRow> = {}): StatsRow {
  return {
    bucket, sales: 20, avg_price: 1_000_000, median_price: 1_000_000, avg_ppsf: 600, median_ppsf: 600,
    avg_dom: 30, median_dom: 30, list_to_close_pct: 99, ...over,
  };
}

test("windows use complete months only and cover 12 + 12 months", () => {
  const w = windows(new Date(2026, 9, 28), 12); // Oct 28, 2026
  assert.deepEqual(w.current, { from: "2025-10-01", to: "2026-10-01", label: "Oct 2025–Sep 2026" });
  assert.deepEqual(w.prior, { from: "2024-10-01", to: "2025-10-01", label: "Oct 2024–Sep 2025" });
});

test("monthStart crosses year boundaries", () => {
  assert.equal(monthStart(new Date(2026, 0, 15), 1), "2025-12-01");
  assert.equal(monthStart(new Date(2026, 0, 31), 0), "2026-01-01");
  assert.equal(monthStart(new Date(2026, 2, 31), 1), "2026-02-01"); // Mar 31 doesn't skip February
});

test("monthList lists every month in the range", () => {
  assert.deepEqual(monthList("2025-11-01", "2026-03-01"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.equal(monthList("2024-10-01", "2026-10-01").length, 24);
});

test("pctChange rounds to 0.1 and handles missing values", () => {
  assert.equal(pctChange(110, 100), 10);
  assert.equal(pctChange(95, 100), -5);
  assert.equal(pctChange(1_023_456, 987_654), 3.6);
  assert.equal(pctChange(null, 100), null);
  assert.equal(pctChange(100, 0), null);
});

test("compare gives percent changes for prices and differences for days and ratio", () => {
  const c = compare(
    row("current", { median_price: 1_050_000, median_dom: 25, list_to_close_pct: 100.4, sales: 90 }),
    row("prior", { median_price: 1_000_000, median_dom: 30, list_to_close_pct: 99.1, sales: 100 }),
  );
  assert.equal(c.medianPricePct, 5);
  assert.equal(c.domDays, -5);
  assert.equal(c.listToClosePts, 1.3);
  assert.equal(c.salesPct, -10);
  assert.equal(compare(row("current"), null).medianPricePct, null);
});

test("trend fills months with no sales and adds month-over-month and year-over-year", () => {
  const months = monthList("2024-10-01", "2026-10-01");
  const rows = months
    .filter((m) => m !== "2026-02")
    .map((m, i) => row(m, { median_price: 1_000_000 + i * 10_000 }));
  const t = buildTrend(rows, months, 12);
  assert.equal(t.length, 12);
  assert.equal(t[0].month, "2025-10");
  assert.equal(t.at(-1)!.month, "2026-09");
  const feb = t.find((p) => p.month === "2026-02")!;
  assert.equal(feb.sales, 0);
  assert.equal(feb.median_price, null);
  assert.equal(t.find((p) => p.month === "2026-03")!.momPct, null); // nothing to compare with
  const last = t.at(-1)!;
  assert.equal(last.momPct, pctChange(last.median_price, t.at(-2)!.median_price));
  assert.notEqual(last.yoyPct, null);
});

test("months of supply uses the last 3 months of sales", () => {
  const t = buildTrend(
    [row("2026-07", { sales: 10 }), row("2026-08", { sales: 20 }), row("2026-09", { sales: 30 })],
    ["2026-07", "2026-08", "2026-09"],
  );
  assert.equal(monthsOfSupply(60, t), 3);
  assert.equal(monthsOfSupply(null, t), null);
  assert.equal(monthsOfSupply(5, buildTrend([], ["2026-09"])), null); // no sales, no pace
});

test("market read leans to buyers when homes sell below list, slower, and cheaper", () => {
  const cur = row("current", { list_to_close_pct: 96.5, median_dom: 54 });
  const r = marketSignals(cur, compare(cur, row("prior", { median_dom: 48, median_price: 1_060_000 })), 7.5);
  assert.equal(r.lean, "buyers");
  assert.equal(r.signals.length, 4);
});

test("market read leans to sellers when homes sell over list and inventory is tight", () => {
  const cur = row("current", { list_to_close_pct: 101.2, median_dom: 20 });
  const r = marketSignals(cur, compare(cur, row("prior", { median_dom: 26 })), 1.5);
  assert.equal(r.lean, "sellers");
});

test("market read is balanced with mixed or missing signals", () => {
  const cur = row("current", { list_to_close_pct: 99 });
  assert.equal(marketSignals(cur, compare(cur, cur), null).lean, "balanced");
  assert.equal(marketSignals(null, compare(null, null), null).signals.length, 0);
});

test("partial months at the end of the data are left out", () => {
  const today = new Date(2026, 9, 28);
  // Data stops Sep 12, so September is partial and August is the last complete month.
  assert.equal(dataAnchor(today, { first: "2024-01-01", last: "2026-09-12" }).getMonth(), 8);
  assert.equal(dataWindows(today, { first: "2024-01-01", last: "2026-09-12" }).current.to, "2026-09-01");
  // Data reaches Sep 29, so September counts.
  assert.equal(dataWindows(today, { first: "2024-01-01", last: "2026-09-29" }).current.to, "2026-10-01");
  // Data that runs to today still stops at the last complete month.
  assert.equal(dataWindows(today, { first: "2024-01-01", last: "2026-10-27" }).current.to, "2026-10-01");
});

test("a partial first month is left out, and year-over-year needs a full prior year", () => {
  assert.equal(firstFullMonth({ first: "2026-03-14", last: null }), "2026-04-01");
  assert.equal(firstFullMonth({ first: "2026-03-02", last: null }), "2026-03-01");
  const w = dataWindows(new Date(2026, 9, 28), { first: "2026-03-14", last: "2026-09-12" });
  assert.deepEqual(w.current, { from: "2026-04-01", to: "2026-09-01", label: "Apr 2026–Aug 2026" });
  assert.equal(w.months, 5);
  assert.equal(w.prior.from, w.prior.to); // empty: no year-over-year
  const full = dataWindows(new Date(2026, 9, 28), { first: "2024-08-01", last: "2026-10-27" });
  assert.equal(full.months, 12);
  assert.equal(full.prior.from, "2024-10-01");
});

test("fast sales count as a seller's signal even without a year of history", () => {
  // Like Pasadena in the real data: 102.9% of list, 18 days, no year-ago data.
  const cur = row("current", { list_to_close_pct: 102.9, median_dom: 18, sales: 400 });
  const r = marketSignals(cur, compare(cur, null), 3.1);
  assert.equal(r.lean, "sellers");
  assert.ok(r.signals.some((s) => /18 days/.test(s.text)));
});
