// Live database tests. These run against your real MySQL tables using the
// settings in mls-integration/.env, and are skipped when no settings are found.
// They check rules that should hold for any data, so they work on your MLS data as-is.
// Run with: node --experimental-strip-types --test tests/integration.test.ts
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { closePool, query } from "../scripts/db.ts";
import { getSoldComps, searchActiveListings, type ListingRow, type PropertyFilters } from "../scripts/queries.ts";

const NONE: PropertyFilters = {
  city: null, maxPrice: null, beds: null, baths: null, sqft: null,
  type: null, pool: null, hasView: null, maxHOA: null,
};

const skip = process.env.MYSQL_HOST ? false : "no database settings in mls-integration/.env";

after(closePool);

async function sampleActive(): Promise<ListingRow> {
  const rows = await query<ListingRow>(
    `SELECT L_City, L_SystemPrice AS price, L_Keyword2 AS beds FROM rets_property
     WHERE L_Status = ? AND L_City IS NOT NULL AND L_SystemPrice IS NOT NULL AND L_Keyword2 IS NOT NULL LIMIT 1`,
    ["Active"],
  );
  assert.ok(rows.length > 0, "rets_property has no active listings to test with");
  return rows[0];
}

test("results match the filters and are all active", { skip }, async () => {
  const s = await sampleActive();
  const filters = { ...NONE, city: s.L_City, beds: s.beds, maxPrice: s.price };
  const res = await searchActiveListings(filters, 1, 25);
  assert.ok(res.total >= 1);
  for (const r of res.rows) {
    assert.equal(r.status, "Active");
    assert.equal(String(r.L_City).toLowerCase(), String(s.L_City).toLowerCase());
    assert.ok(Number(r.beds) >= Number(s.beds));
    assert.ok(Number(r.price) <= Number(s.price));
  }
});

test("the total matches a direct COUNT", { skip }, async () => {
  const s = await sampleActive();
  const res = await searchActiveListings({ ...NONE, city: s.L_City }, 1, 5);
  const [direct] = await query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM rets_property WHERE L_Status = ? AND L_City = ?",
    ["Active", s.L_City as string],
  );
  assert.equal(res.total, Number(direct.n));
});

test("pages don't repeat or skip listings", { skip }, async () => {
  const s = await sampleActive();
  const filters = { ...NONE, city: s.L_City };
  const first = await searchActiveListings(filters, 1, 5);
  const seen = new Set<string>();
  const pages = Math.min(first.totalPages, 6);
  for (let page = 1; page <= pages; page++) {
    const res = await searchActiveListings(filters, page, 5);
    for (const r of res.rows) {
      assert.ok(!seen.has(r.L_ListingID), `listing ${r.L_ListingID} appeared on two pages`);
      seen.add(r.L_ListingID);
    }
  }
  assert.equal(seen.size, Math.min(first.total, pages * 5));
});

test("an injection attempt is treated as plain text", { skip }, async () => {
  const [before] = await query<{ n: number }>("SELECT COUNT(*) AS n FROM rets_property");
  const res = await searchActiveListings({ ...NONE, city: "Irvine' OR '1'='1" }, 1, 5);
  assert.equal(res.total, 0);
  const [afterCount] = await query<{ n: number }>("SELECT COUNT(*) AS n FROM rets_property");
  assert.equal(Number(afterCount.n), Number(before.n));
});

test("sold comps are residential, in the city, inside the time window, newest first", { skip }, async () => {
  const rows = await query<{ City: string }>(
    "SELECT City FROM california_sold WHERE PropertyType = ? AND City IS NOT NULL ORDER BY CloseDate DESC LIMIT 1",
    ["Residential"],
  );
  assert.ok(rows.length > 0, "california_sold has no residential sales to test with");
  const city = rows[0].City;
  const res = await getSoldComps({ ...NONE, city }, { months: 60, limit: 25 });
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 60);
  let previous = "9999-12-31";
  for (const r of res.rows) {
    assert.equal(r.PropertyType, "Residential");
    assert.equal(String(r.City).toLowerCase(), city.toLowerCase());
    const date = String(r.CloseDate).slice(0, 10);
    assert.ok(date >= cutoff.toISOString().slice(0, 10), `sale on ${date} is outside the window`);
    assert.ok(date <= previous, "sales are not newest first");
    previous = date;
  }
});