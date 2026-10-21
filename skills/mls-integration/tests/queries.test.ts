// SQL construction tests. These don't need a database.
// Run with: node --experimental-strip-types --test tests/queries.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildActiveSearch,
  buildSoldComps,
  normalizeMonths,
  normalizePaging,
  sanitizeFilters,
  unsupportedSoldFilters,
  type PropertyFilters,
} from "../scripts/queries.ts";

const NONE: PropertyFilters = {
  city: null, maxPrice: null, beds: null, baths: null, sqft: null,
  type: null, pool: null, hasView: null, maxHOA: null,
};

const placeholders = (sql: string) => (sql.match(/\?/g) ?? []).length;

test("no filters: only active listings, no extra conditions", () => {
  const q = buildActiveSearch(NONE);
  assert.match(q.sql, /WHERE L_Status = \?\nORDER BY/);
  assert.deepEqual(q.params, ["Active"]);
});

test("every filter becomes a placeholder with a matching param", () => {
  const f: PropertyFilters = {
    city: "Irvine", maxPrice: 1_500_000, beds: 3, baths: 2.5, sqft: 1800,
    type: "Condominium", pool: "True", hasView: "False", maxHOA: 400,
  };
  const q = buildActiveSearch(f);
  assert.equal(placeholders(q.sql), q.params.length);
  assert.equal(placeholders(q.countSql), q.countParams.length);
  assert.deepEqual(q.params, ["Active", "Irvine", 1_500_000, 3, 2.5, 1800, "Condominium", 1, 0, 400]);
    for (const clause of [
    "L_City = ?", "L_SystemPrice <= ?", "L_Keyword2 >= ?", "LM_Dec_3 >= ?", "LM_Int2_3 >= ?",
    "L_Type_ = ?", "PoolPrivateYN = ?", "ViewYN = ?", "(AssociationFee IS NULL OR AssociationFee <= ?)",
  ]) {
    assert.ok(q.sql.includes(clause), `missing ${clause}`);
  }
});

test("user text never appears in the SQL, even an injection attempt", () => {
  const evil = "Irvine'; DROP TABLE rets_property; --";
  const q = buildActiveSearch({ ...NONE, city: evil });
  assert.ok(!q.sql.includes("DROP"));
  assert.ok(!q.countSql.includes("DROP"));
  assert.equal(q.params[1], evil);
});

test("a filter value of 0 is still applied (no HOA)", () => {
  // The handbook's `if (filters.x)` check would skip 0.
  const q = buildActiveSearch({ ...NONE, maxHOA: 0 });
  assert.ok(q.sql.includes("AssociationFee <= ?"));
  assert.deepEqual(q.params, ["Active", 0]);
});

test("pagination: offset, stable ordering, and page size", () => {
  const q = buildActiveSearch(NONE, 3, 10);
  assert.match(q.sql, /ORDER BY L_SystemPrice ASC, L_ListingID ASC\nLIMIT 10 OFFSET 20$/);
  assert.ok(!q.countSql.includes("LIMIT"));
});

test("pagination input is cleaned up", () => {
  assert.deepEqual(normalizePaging(0, 10), { page: 1, limit: 10, offset: 0 });
  assert.deepEqual(normalizePaging(-4, 5), { page: 1, limit: 5, offset: 0 });
  assert.deepEqual(normalizePaging(2, 500), { page: 2, limit: 25, offset: 25 });
  assert.deepEqual(normalizePaging("abc", "1; DROP"), { page: 1, limit: 10, offset: 0 });
  assert.deepEqual(normalizePaging(2.9, 7.5), { page: 2, limit: 7, offset: 7 });
});

test("sanitizeFilters keeps valid values and drops bad ones", () => {
  assert.deepEqual(
    sanitizeFilters({
      city: "  Newport Beach ", maxPrice: "900000", beds: -2, baths: "lots",
      type: "Castle", pool: "yes", hasView: "True", maxHOA: 0, extra: "ignored",
    }),
    { ...NONE, city: "Newport Beach", maxPrice: 900000, hasView: "True", maxHOA: 0 },
  );
  assert.deepEqual(sanitizeFilters(null), NONE);
  assert.equal(sanitizeFilters({ city: "x".repeat(500) }).city?.length, 60);
});

test("sold comps: city, time window, residential only, newest first", () => {
  const q = buildSoldComps({ ...NONE, city: "Tustin" }, { months: 6 });
  assert.ok(q.sql.includes("City = ?"));
  assert.ok(q.sql.includes("CloseDate >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)"));
  assert.ok(q.sql.includes("PropertyType = ?"));
  assert.match(q.sql, /ORDER BY CloseDate DESC, ListingKey ASC\nLIMIT 10 OFFSET 0$/);
  assert.deepEqual(q.params, ["Tustin", 6, "Residential"]);
  assert.equal(placeholders(q.sql), q.params.length);
});

test("sold comps map Week 2 filters to california_sold columns", () => {
  const q = buildSoldComps(
    { ...NONE, city: "Irvine", maxPrice: 1_000_000, beds: 3, baths: 2.5, sqft: 1500, type: "Townhouse" },
    { page: 2, limit: 5 },
  );
  assert.deepEqual(q.params, ["Irvine", 12, "Residential", 1_000_000, 3, 2, 1500, "Townhouse"]);
  for (const clause of ["ClosePrice <= ?", "BedroomsTotal >= ?", "BathroomsTotalInteger >= ?", "LivingArea >= ?", "PropertySubType = ?"]) {
    assert.ok(q.sql.includes(clause), `missing ${clause}`);
  }
  assert.match(q.sql, /LIMIT 5 OFFSET 5$/);
});

test("sold comps need a city", () => {
  assert.throws(() => buildSoldComps({ ...NONE, beds: 3 }), /need a city/);
});

test("sold comps report filters they can't apply", () => {
  assert.deepEqual(unsupportedSoldFilters({ ...NONE, pool: "True", maxHOA: 0 }), ["pool", "HOA"]);
  assert.deepEqual(unsupportedSoldFilters({ ...NONE, city: "Irvine" }), []);
});

test("months are clamped to 1-60", () => {
  assert.equal(normalizeMonths(undefined), 12);
  assert.equal(normalizeMonths(0), 12);
  assert.equal(normalizeMonths(200), 60);
  assert.equal(normalizeMonths("3"), 3);
});