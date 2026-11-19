// Tests for format.ts, the WhatsApp messages. No database needed.
// Run from skills/recommendations:
//   node --experimental-strip-types --test tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Listing } from "../../mls-integration/scripts/format.ts";
import { assessPrice } from "../scripts/assess.ts";
import {
  assessmentLine,
  notFoundMessage,
  recommedationsMessage as recommendationsMessage,
  whichOneMessage,
  type Recommendation,
} from "../scripts/format.ts";

function listing(id: string, over: Partial<Listing> = {}): Listing {
  return {
    id, mlsNumber: id, address: `${id} Pine Ln`, city: "Lake Arrowhead", zip: "92352",
    price: 575_000, beds: 4, baths: 2, sqft: 1680, type: "SingleFamilyResidence", status: "Active",
    yearBuilt: 1978, hoaFee: 0, daysOnMarket: 21, pool: null, view: true, fireplace: true,
    photoCount: 20, agent: "Jane Doe", office: "Example Realty", lat: null, lng: null, ...over,
  } as Listing;
}

const rec = (id: string, score: number, price = 575_000): Recommendation => ({
  listing: listing(id, { price }),
  score,
  assessment: assessPrice(price, 1680, { avgPpsf: 335, compCount: 9 }),
});

// --- assessmentLine -----------------------------------------------------------------

test("price check lines for in line, above, below, and few sales", () => {
  assert.equal(
    assessmentLine(assessPrice(1_050_000, 2000, { avgPpsf: 500, compCount: 9 })),
    "💲 In line with comps (+5%) · comps suggest $1,000,000 at $500/sqft · 9 sales",
  );
  assert.equal(
    assessmentLine(assessPrice(1_200_000, 2000, { avgPpsf: 500, compCount: 9 })),
    "💲 Priced 20% above comps · comps suggest $1,000,000 at $500/sqft · 9 sales",
  );
  assert.equal(
    assessmentLine(assessPrice(900_000, 2000, { avgPpsf: 500, compCount: 2 })),
    "💲 Priced 10% below comps · comps suggest $1,000,000 at $500/sqft · only 2 sales",
  );
  assert.match(assessmentLine(assessPrice(1_000_000, 2000, { avgPpsf: 500, compCount: 1 })), /only 1 sale$/);
});

test("in line shows the sign, including negative", () => {
  assert.match(assessmentLine(assessPrice(980_000, 2000, { avgPpsf: 500, compCount: 9 })), /\(-2%\)/);
});

test("price check line when there isn't enough data", () => {
  assert.equal(
    assessmentLine(assessPrice(1_000_000, 2000, { avgPpsf: null, compCount: 0 })),
    "💲 Price check: not enough data (no similar recent sales)",
  );
});

// --- recommendationsMessage ---------------------------------------------------------------

test("recommendations: header, numbered cards, similarity and price check on each", () => {
  const target = listing("1118353294", { address: "350 S. Fairway Dr" });
  const msg = recommendationsMessage(target, [rec("A", 86.4), rec("B", 71.2, 640_000)], "Apr 2026–Aug 2026", true);
  assert.match(msg, /^🏡 \*Homes like 350 S\. Fairway Dr, Lake Arrowhead\*/);
  assert.match(msg, /Price checks use sales from Apr 2026–Aug 2026/);
  assert.ok(msg.indexOf("*1. A Pine Ln") < msg.indexOf("*2. B Pine Ln"));
  assert.match(msg, /🎯 Similarity 86\/100/);
  assert.match(msg, /🎯 Similarity 71\/100/);
  assert.equal((msg.match(/💲 /g) ?? []).length, 2);
  assert.match(msg, /not an appraisal/);
  assert.doesNotMatch(msg, /description wasn't available/);
});

test("recommendations note when embeddings weren't used", () => {
  const msg = recommendationsMessage(listing("1"), [rec("A", 60)], "Apr 2026–Aug 2026", false);
  assert.match(msg, /Matched on price, beds, city, and size only/);
});

test("recommendations when nothing similar was found", () => {
  const msg = recommendationsMessage(listing("1", { address: "350 S. Fairway Dr" }), [], "Apr 2026–Aug 2026", true);
  assert.match(msg, /couldn't find active listings similar to 350 S\. Fairway Dr, Lake Arrowhead/);
});

test("a listing without an address falls back to its MLS number", () => {
  const msg = recommendationsMessage(listing("777", { address: null, city: null }), [], "x", true);
  assert.match(msg, /MLS# 777/);
});

// --- whichOneMessage and notFoundMessage ------------------------------------------------------

test("which one: lists every match with its MLS number", () => {
  const msg = whichOneMessage([
    listing("1118353294", { address: "350 S. Fairway Dr" }),
    listing("1118402277", { address: "1210 Fairway Dr", city: "Big Bear Lake", price: 789_000, status: "Sold" }),
  ]);
  assert.match(msg, /Which one did you mean\?/);
  assert.match(msg, /1\. 350 S\. Fairway Dr, Lake Arrowhead · \$575,000 · Active · MLS# 1118353294/);
  assert.match(msg, /2\. 1210 Fairway Dr, Big Bear Lake · \$789,000 · Sold · MLS# 1118402277/);
});

test("which one: a missing price says so", () => {
  assert.match(whichOneMessage([listing("1", { price: null }), listing("2")]), /price n\/a/);
});

test("not found repeats what they typed", () => {
  assert.match(notFoundMessage("123 Nowhere Rd"), /couldn't find a listing matching "123 Nowhere Rd"/);
});
