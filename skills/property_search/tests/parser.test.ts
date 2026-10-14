import { test } from "node:test";
import assert from "node:assert/strict"
import { parsePropertyQuery, toDbFilters, type PropertyFilters} from "../scripts/parser.ts";

const EMPTY: PropertyFilters = {
    city: null, maxPrice: null, beds: null, baths: null, sqft: null,
    type: null, pool: null, hasView: null, maxHOA: null,
};

const cases: { query: string; expected: Partial<PropertyFilters>}[] = [
    {
    query: "Show me 3-bedroom condos in Irvine under $1.5M with a pool.",
    expected: { city: "Irvine", maxPrice: 1_500_000, beds: 3, type: "Condominium", pool: "True" },
  },
  {
    query: "Single family homes in Newport Beach with an ocean view under $3,500,000",
    expected: { city: "Newport Beach", maxPrice: 3_500_000, type: "SingleFamilyResidence", hasView: "True" },
  },
  {
    query: "4 bed 2.5 bath house in Tustin at least 2,200 sq ft",
    expected: { city: "Tustin", beds: 4, baths: 2.5, sqft: 2200, type: "SingleFamilyResidence" },
  },
  {
    query: "townhomes in costa mesa under 900k with HOA under $400",
    expected: { city: "Costa Mesa", maxPrice: 900_000, type: "Townhouse", maxHOA: 400 },
  },
  {
    query: "2br 2ba condo in Anaheim below $650,000, no pool",
    expected: { city: "Anaheim", maxPrice: 650_000, beds: 2, baths: 2, type: "Condominium", pool: "False" },
  },
  {
    query: "land in Temecula under $500k",
    expected: { city: "Temecula", maxPrice: 500_000, type: "UnimprovedLand" },
  },
  {
    query: "Looking for a three bedroom home in Huntington Beach with a view and a pool",
    expected: { city: "Huntington Beach", beds: 3, pool: "True", hasView: "True" },
  },
  {
    query: "condos under 1.2 million in Laguna Niguel with HOA fees below $350/month",
    expected: { city: "Laguna Niguel", maxPrice: 1_200_000, type: "Condominium", maxHOA: 350 },
  },
  {
    query: "5 bedroom 4 bathroom house over 3000 sqft in Yorba Linda",
    expected: { city: "Yorba Linda", beds: 5, baths: 4, sqft: 3000, type: "SingleFamilyResidence" },
  },
  {
    query: "anything in San Juan Capistrano with no HOA",
    expected: { city: "San Juan Capistrano", maxHOA: 0 },
  },
  {
    query: "3+ beds, 2 baths, 1800 square feet, max $1.1M",
    expected: { beds: 3, baths: 2, sqft: 1800, maxPrice: 1_100_000 },
  },
  {
    query: "Can you review the market for me?",
    expected: {}, // "review" must not trigger the view filter
  },
  {
    query: "2 bedroom condo in a quiet area under $700k",
    expected: { beds: 2, maxPrice: 700_000, type: "Condominium" }, // "in a quiet area" is not a city
  },
  {
    query: "townhouse in Irvine",
    expected: { city: "Irvine", type: "Townhouse" },
  },
  {
    query: "homes near Dana Point under $2m with 2k sqft",
    expected: { city: "Dana Point", maxPrice: 2_000_000, sqft: 2000 },
  },
];
 
for (const { query, expected } of cases) {
  test(query, async () => {
    assert.deepEqual(await parsePropertyQuery(query), { ...EMPTY, ...expected });
  });
}
 
test("toDbFilters maps filters to rets_property columns", async () => {
  const filters = await parsePropertyQuery(
    "Show me 3-bedroom condos in Irvine under $1.5M with a pool and HOA under $500",
  );
  assert.deepEqual(toDbFilters(filters), [
    { column: "L_City", op: "=", value: "Irvine" },
    { column: "L_SystemPrice", op: "<=", value: 1_500_000 },
    { column: "L_Keyword2", op: ">=", value: 3 },
    { column: "L_Type_", op: "=", value: "Condominium" },
    { column: "PoolPrivateYN", op: "=", value: "True" },
    { column: "AssociationFee", op: "<=", value: 500 },
  ]);
});
 
test("toDbFilters returns nothing when no filters are found", async () => {
  assert.deepEqual(toDbFilters(await parsePropertyQuery("hello there")), []);
});
 