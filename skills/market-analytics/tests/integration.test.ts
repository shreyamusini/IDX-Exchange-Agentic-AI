// Live database tests. They use mls-integration/.env and are skipped without it.
// They check rules that hold for any data, so they work on your MLS tables as-is.
// Run with: node --experimental-strip-types --test tests/integration.test.ts
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { closePool, query } from "../../mls-integration/scripts/db.ts";
import { dataWindows } from "../scripts/analyze.ts";
import { canonicalCity, getStats, getTopCities, soldWhere } from "../scripts/market.ts";
import { buildReport, getWindows } from "../scripts/report.ts";

const skip = process.env.MYSQL_HOST ? false : "no database settings in mls-integration/.env";
after(closePool);

// Same windows the skill uses: complete months the data covers.
const win = skip ? dataWindows(new Date(), { first: null, last: null }) : await getWindows();
const { current, prior } = win;

async function busiestCity(): Promise<string> {
  const [top] = await getTopCities(current.from, current.to, 1);
  assert.ok(top, "california_sold has no residential sales in the last 12 months");
  return top.City;
}

test("the SQL median matches a median computed in code", { skip }, async () => {
  const city = await busiestCity();
  const f = { city, zip: null, type: null };
  const w = soldWhere(f, current.from, current.to);
  const prices = (await query<{ p: number }>(`SELECT ClosePrice AS p FROM california_sold WHERE ${w.sql} ORDER BY ClosePrice`, w.params))
    .map((r) => Number(r.p));
  const mid = prices.length / 2;
  const expected = Math.round(prices.length % 2 ? prices[Math.floor(mid)] : (prices[mid - 1] + prices[mid]) / 2);
  const [stats] = await getStats(f, current.from, current.to, { kind: "period", currentFrom: current.from });
  assert.equal(stats.sales, prices.length);
  assert.ok(Math.abs(Number(stats.median_price) - expected) <= 1, `${stats.median_price} vs ${expected}`);
});

test("monthly sales add up to the total", { skip }, async () => {
  const city = await busiestCity();
  const r = await buildReport({ city, zip: null, type: null }, win);
  assert.equal(r.trend.length, win.months);
  assert.equal(r.trend.reduce((s, p) => s + p.sales, 0), r.current!.sales);
  assert.ok(r.current!.median_price! > 0);
  assert.ok(r.current!.list_to_close_pct! > 50 && r.current!.list_to_close_pct! < 150);
});

test("the year-over-year windows don't overlap", { skip }, async () => {
  const city = await busiestCity();
  const f = { city, zip: null, type: null };
  const both = await getStats(f, prior.from, current.to, { kind: "period", currentFrom: current.from });
  const cur = await getStats(f, current.from, current.to, { kind: "period", currentFrom: current.from });
  const pri = await getStats(f, prior.from, prior.to, { kind: "period", currentFrom: current.from });
  const total = both.reduce((s, r) => s + r.sales, 0);
  assert.equal(total, (cur[0]?.sales ?? 0) + (pri[0]?.sales ?? 0));
});

test("city names are matched to the stored spelling", { skip }, async () => {
  const city = await busiestCity();
  assert.equal(await canonicalCity(city.toLowerCase()), city);
  assert.equal(await canonicalCity("Not A Real City 12345"), null);
});
