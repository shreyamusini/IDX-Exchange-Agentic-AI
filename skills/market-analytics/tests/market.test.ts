// Tests for the SQL builders and question reading. No database needed.
// Run with: node --experimental-strip-types --test tests/market.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInventoryQuery, buildStatsQuery, buildTopCitiesQuery, soldWhere } from "../scripts/market.ts";
import { findCities, readQuestion } from "../scripts/question.ts";

const ALL = { city: null, zip: null, type: null };

function placeholders(sql: string): number {
  return (sql.match(/\?/g) ?? []).length;
}

test("every filter is a placeholder, and the param count matches", () => {
  const w = soldWhere({ city: "Irvine", zip: "92618", type: "Condominium" }, "2025-10-01", "2026-10-01");
  assert.deepEqual(w.params, ["Residential", "2025-10-01", "2026-10-01", "Irvine", "92618", "Condominium"]);
  assert.equal(placeholders(w.sql), w.params.length);
  for (const group of [{ kind: "month" as const }, { kind: "period" as const, currentFrom: "2025-10-01" }]) {
    const q = buildStatsQuery({ city: "Irvine", zip: null, type: null }, "2024-10-01", "2026-10-01", group);
    assert.equal(placeholders(q.sql), q.params.length);
  }
  const inv = buildInventoryQuery({ city: "Irvine", zip: "92618", type: "Townhouse" });
  assert.equal(placeholders(inv.sql), inv.params.length);
  assert.equal(inv.params[0], "Active");
});

test("the period grouping's date comes before the WHERE params", () => {
  const q = buildStatsQuery({ city: "Irvine", zip: null, type: null }, "2024-10-01", "2026-10-01", {
    kind: "period", currentFrom: "2025-10-01",
  });
  assert.deepEqual(q.params, ["2025-10-01", "Residential", "2024-10-01", "2026-10-01", "Irvine"]);
});

test("user text never reaches the SQL", () => {
  const evil = "Irvine'; DROP TABLE california_sold; --";
  const q = buildStatsQuery({ city: evil, zip: null, type: evil }, "2024-10-01", "2026-10-01", { kind: "month" });
  assert.ok(!q.sql.includes("DROP"));
  assert.ok(q.params.includes(evil));
  assert.ok(!buildInventoryQuery({ city: evil, zip: null, type: null }).sql.includes("DROP"));
});

test("stats use the handbook's filters plus medians", () => {
  const { sql } = buildStatsQuery(ALL, "2024-10-01", "2026-10-01", { kind: "month" });
  assert.match(sql, /PropertyType = \?/);
  assert.match(sql, /LivingArea > 0/);
  assert.match(sql, /ROW_NUMBER\(\) OVER \(PARTITION BY bucket ORDER BY price\)/);
  assert.match(sql, /DATE_FORMAT\(CloseDate, '%Y-%m'\)/);
});

test("top cities LIMIT is always a safe integer from 1 to 25", () => {
  assert.match(buildTopCitiesQuery("a", "b", 10).sql, /LIMIT 10$/);
  assert.match(buildTopCitiesQuery("a", "b", 500).sql, /LIMIT 25$/);
  assert.match(buildTopCitiesQuery("a", "b", -3).sql, /LIMIT 1$/);
  assert.match(buildTopCitiesQuery("a", "b", "5; DROP TABLE x" as unknown as number).sql, /LIMIT 10$/);
});

test("reads the handbook questions", async () => {
  const a = await readQuestion("Is now a good time to buy in San Diego?");
  assert.equal(a.cityGuess, "San Diego");
  assert.equal(a.wantsTop, false);
  const b = await readQuestion("What is the average price per sq ft in Pasadena?");
  assert.equal(b.cityGuess, "Pasadena");
  assert.equal(b.type, null);
});

test("reads ZIP codes, property types, and ranking questions", async () => {
  const z = await readQuestion("median condo price in 92618");
  assert.equal(z.zip, "92618");
  assert.equal(z.cityGuess, null);
  assert.equal(z.type, "Condominium");
  assert.equal((await readQuestion("which cities are the hottest markets?")).wantsTop, true);
  assert.ok((await readQuestion("land prices in Irvine")).typeError);
});

test("finds known cities anywhere, longest name first, in question order", () => {
  const cities = ["Irvine", "San Diego", "Diego", "Tustin", "Los Angeles", "East Los Angeles", "Orange"];
  assert.deepEqual(findCities("how's the San Diego market right now", cities), ["San Diego"]);
  assert.deepEqual(findCities("Tustin vs. Irvine condos", cities), ["Tustin", "Irvine"]);
  assert.deepEqual(findCities("prices in East Los Angeles", cities), ["East Los Angeles"]);
  assert.deepEqual(findCities("Irvine's market and Irvine again", cities), ["Irvine"]);
  assert.deepEqual(findCities("orangeville", cities), []);
  assert.deepEqual(findCities("is it a good time to buy?", cities), []);
});
