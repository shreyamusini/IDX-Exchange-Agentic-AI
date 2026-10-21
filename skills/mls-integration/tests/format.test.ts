import { test } from "node:test";
import assert from "node:assert/strict"
import {
    activeMessage,
    describeFilters,
    formatDate,
    listingCard,
    money,
    soldCard,
    soldMessage,
    toListing,
    toSoldComp,
    yesNo,
} from "../scripts/format.ts";
import type { ListingRow, PropertyFilters, SoldRow} from "../scripts/queries.ts";

const NONE: PropertyFilters = {
    city: null, maxPrice: null, beds: null, baths: null, sqft: null, type: null, pool: null, hasView: null, maxHOA: null,
};

const fullRow: ListingRow = {
    L_ListingID: "L1", L_DisplayId: "OC26012345", L_Address: "12 Harbor St", L_City: "Irvine", L_Zip: "92618",
  price: 1250000, beds: 3, baths: 2.5, sqft: 1850, type: "Condominium", status: "Active",
  lat: 33.68, lng: -117.79, YearBuilt: 2005, AssociationFee: 350, DaysOnMarket: 12,
  PoolPrivateYN: "True", ViewYN: "Y", FireplaceYN: 0, PhotoCount: 25,
  LA1_UserFirstName: "Jane", LA1_UserLastName: "Doe", LO1_OrganizationName: "Coastal Realty",
}

const sparseRow: ListingRow = {
  ...fullRow,
  L_ListingID: "L2", L_DisplayId: null, L_Address: null, L_Zip: null, baths: null, sqft: null,
  YearBuilt: null, AssociationFee: null, DaysOnMarket: null, PoolPrivateYN: null, ViewYN: "False",
  FireplaceYN: null, LA1_UserFirstName: null, LA1_UserLastName: null, LO1_OrganizationName: null,
};
 
const soldRow: SoldRow = {
  ListingKey: "S1", UnparsedAddress: "45 Oak Ln, Irvine, CA", City: "Irvine", CloseDate: "2026-03-03",
  ClosePrice: 1180000, OriginalListPrice: 1250000, ListPrice: 1200000, DaysOnMarket: 21,
  BedroomsTotal: 3, BathroomsTotalInteger: 2, LivingArea: 1650, PropertyType: "Residential",
  PropertySubType: "Condominium", YearBuilt: 2004, ListAgentFullName: "Sam Lee",
  ListOfficeName: "Sold Realty", BuyerOfficeName: "Buyer Brokers",
};
 
test("yes/no values in any common format", () => {
  for (const v of ["True", "true", "Y", "yes", 1, "1"]) assert.equal(yesNo(v), true);
  for (const v of ["False", "N", "no", 0, "0"]) assert.equal(yesNo(v), false);
  for (const v of [null, undefined, "", "maybe"]) assert.equal(yesNo(v), null);
});
 
test("money and dates", () => {
  assert.equal(money(1250000), "$1,250,000");
  assert.equal(money(999.6), "$1,000");
  assert.equal(money(null), null);
  assert.equal(formatDate("2026-03-03"), "Mar 3, 2026");
  assert.equal(formatDate(null), null);
});
 
test("database row becomes a clean listing object", () => {
  const l = toListing(fullRow);
  assert.equal(l.price, 1250000);
  assert.equal(l.pool, true);
  assert.equal(l.view, true);
  assert.equal(l.fireplace, false);
  assert.equal(l.agent, "Jane Doe");
  assert.equal(l.mlsNumber, "OC26012345");
});
 
test("full listing card", () => {
  assert.equal(
    listingCard(toListing(fullRow), 1),
    [
      "*1. 12 Harbor St, Irvine 92618*",
      "💰 $1,250,000 · 3 bd · 2.5 ba · 1,850 sqft",
      "🏠 Condo · Built 2005 · 12 days on market",
      "✨ Pool · View · HOA $350/mo",
      "🔖 MLS# OC26012345 · Jane Doe, Coastal Realty",
    ].join("\n"),
  );
});
 
test("missing fields are left out, never shown as null", () => {
  const card = listingCard(toListing(sparseRow), 4);
  assert.ok(!card.includes("null"));
  assert.ok(!card.includes("undefined"));
  assert.equal(card, ["*4. Irvine*", "💰 $1,250,000 · 3 bd", "🏠 Condo"].join("\n"));
});
 
test("sold comp card shows sale-to-list ratio", () => {
  const comp = toSoldComp(soldRow);
  assert.equal(comp.saleToListPct, 98.3);
  assert.equal(
    soldCard(comp, 1),
    [
      "*1. 45 Oak Ln, Irvine, CA*",
      "✅ Sold $1,180,000 on Mar 3, 2026 (98.3% of list)",
      "🏠 Condo · 3 bd · 2 ba · 1,650 sqft · Built 2004",
      "⏱️ 21 days on market · Listed by Sam Lee, Sold Realty",
    ].join("\n"),
  );
});
 
test("filter summary", () => {
  assert.equal(
    describeFilters({ ...NONE, city: "Irvine", type: "Condominium", beds: 3, maxPrice: 1_500_000, pool: "True" }),
    "Irvine · Condo · 3+ bd · under $1.5M · pool",
  );
  assert.equal(describeFilters({ ...NONE, maxHOA: 0, maxPrice: 850_000 }), "under $850K · no HOA");
});
 
test("active message: header, numbering continues across pages, 'more' prompt", () => {
  const msg = activeMessage(
    { ...NONE, city: "Irvine" },
    { page: 2, limit: 10, offset: 10, total: 23, totalPages: 3 },
    [toListing(fullRow)],
  );
  assert.ok(msg.startsWith("🔎 *23 active listings* · Irvine"));
  assert.ok(msg.includes("Showing 11–11 of 23 (page 2 of 3)"));
  assert.ok(msg.includes("*11. 12 Harbor St"));
  assert.ok(msg.endsWith("Reply *more* to see the next 10."));
});
 
test("active message: no results and past the last page", () => {
  const empty = { page: 1, limit: 10, offset: 0, total: 0, totalPages: 1 };
  assert.match(activeMessage({ ...NONE, city: "Irvine" }, empty, []), /No active listings found for Irvine/);
  const past = { page: 5, limit: 10, offset: 40, total: 12, totalPages: 2 };
  assert.match(activeMessage(NONE, past, []), /end of the results/);
});
 
test("sold message mentions skipped filters and the time window", () => {
  const msg = soldMessage(
    { ...NONE, city: "Irvine", pool: "True" },
    { page: 1, limit: 10, offset: 0, total: 1, totalPages: 1, months: 6 },
    [toSoldComp(soldRow)],
    ["pool"],
  );
  assert.ok(msg.startsWith("📉 *1 sold comp* · Irvine · last 6 months"));
  assert.ok(msg.includes("don't include pool"));
  assert.ok(!msg.includes("Reply *more*"));
});
 