// Tests for assess.ts, the price check. No database needed.
// Run from skills/recommendations:
//   node --experimental-strip-types --test tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { assessPrice, IN_LINE_PCT, MIN_CONFIDENT_COMPS } from "../scripts/assess.ts";

const comps = (avgPpsf: number | null, compCount = 9) => ({ avgPpsf, compCount });

test("comp price is avg $/sqft times the listing's size", () => {
  const a = assessPrice(1_000_000, 2000, comps(500));
  assert.equal(a.status, "assessed");
  if (a.status !== "assessed") return;
  assert.equal(a.compPrice, 1_000_000);
  assert.equal(a.deltaPct, 0);
  assert.equal(a.verdict, "in line");
  assert.equal(a.listPrice, 1_000_000);
});

test("above and below comps", () => {
  const above = assessPrice(1_200_000, 2000, comps(500));
  const below = assessPrice(900_000, 2000, comps(500));
  assert.ok(above.status === "assessed" && below.status === "assessed");
  if (above.status !== "assessed" || below.status !== "assessed") return;
  assert.equal(above.deltaPct, 20);
  assert.equal(above.verdict, "above");
  assert.equal(below.deltaPct, -10);
  assert.equal(below.verdict, "below");
});

test(`exactly ±${IN_LINE_PCT}% still counts as in line`, () => {
  for (const price of [1_050_000, 950_000]) {
    const a = assessPrice(price, 2000, comps(500));
    assert.ok(a.status === "assessed" && a.verdict === "in line", `${price}`);
  }
  const justOver = assessPrice(1_051_000, 2000, comps(500));
  assert.ok(justOver.status === "assessed" && justOver.verdict === "above");
});

test("delta is rounded to one decimal, comp price and $/sqft to whole numbers", () => {
  const a = assessPrice(1_234_567, 1999, comps(512.3456));
  assert.ok(a.status === "assessed");
  if (a.status !== "assessed") return;
  assert.equal(a.compPrice, Math.round(512.3456 * 1999));
  assert.equal(a.avgPpsf, 512);
  assert.equal(a.deltaPct, Math.round(((1_234_567 - a.compPrice) / a.compPrice) * 1000) / 10);
  assert.ok((String(a.deltaPct).split(".")[1]?.length ?? 0) <= 1);
});

test(`fewer than ${MIN_CONFIDENT_COMPS} comps is low confidence`, () => {
  const few = assessPrice(1_000_000, 2000, comps(500, MIN_CONFIDENT_COMPS - 1));
  const enough = assessPrice(1_000_000, 2000, comps(500, MIN_CONFIDENT_COMPS));
  assert.ok(few.status === "assessed" && few.lowConfidence);
  assert.ok(enough.status === "assessed" && !enough.lowConfidence);
});

test("not enough data, instead of dividing by zero", () => {
  const cases: [ReturnType<typeof assessPrice>, RegExp][] = [
    [assessPrice(null, 2000, comps(500)), /no list price/],
    [assessPrice(0, 2000, comps(500)), /no list price/],
    [assessPrice(1_000_000, null, comps(500)), /square footage/],
    [assessPrice(1_000_000, 2000, null), /square footage/],
    [assessPrice(1_000_000, 2000, comps(null, 0)), /no similar recent sales/],
    [assessPrice(1_000_000, 2000, comps(500, 0)), /no similar recent sales/],
  ];
  for (const [a, reason] of cases) {
    assert.equal(a.status, "no-data");
    if (a.status === "no-data") assert.match(a.reason, reason);
  }
});
