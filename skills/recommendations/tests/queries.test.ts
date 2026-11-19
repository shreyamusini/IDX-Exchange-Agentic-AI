// Live database tests for queries.ts. They use mls-integration/.env and are skipped without it.
// They check rules that hold for any data, so they work on your MLS tables as-is.
// Run from skills/recommendations:
//   node --experimental-strip-types --test tests/*.test.ts
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { closePool, query } from "../../mls-integration/scripts/db.ts";
import { ACTIVE_COLUMNS, type ListingRow } from "../../mls-integration/scripts/queries.ts";
import { findTarget, getCandidates, getComps } from "../scripts/queries.ts";

const skip = process.env.MYSQL_HOST ? false : "no database settings in mls-integration/.env";
after(closePool);

// An active listing with everything the queries need, to test with.
async function sampleListing(): Promise<ListingRow> {
  const [row] = await query<ListingRow>(
    `SELECT ${ACTIVE_COLUMNS} FROM rets_property
     WHERE L_Status = ? AND L_Address IS NOT NULL AND L_City IS NOT NULL
       AND L_SystemPrice > 0 AND LM_Int2_3 > 0 AND L_Type_ IS NOT NULL
     ORDER BY L_ListingID LIMIT 1`,
    ["Active"],
  );
  assert.ok(row, "rets_property has no complete active listing to test with");
  return row;
}

// --- findTarget ------------------------------------------------------------------

test("findTarget by MLS number finds that listing", { skip }, async () => {
  const s = await sampleListing();
  const rows = await findTarget(String(s.L_ListingID));
  assert.ok(rows.length >= 1);
  assert.equal(String(rows[0].L_ListingID), String(s.L_ListingID));
});

test("findTarget by part of an address, ignoring periods, case, and extra spaces", { skip }, async () => {
  const s = await sampleListing();
  const words = String(s.L_Address).replaceAll(".", "").split(/\s+/).slice(0, 2).join("   ");   // e.g. "350   S"
  const rows = await findTarget(`  ${words.toLowerCase()}  `);
  assert.ok(rows.some((r) => String(r.L_ListingID) === String(s.L_ListingID)), `searched for "${words}"`);
});

test("findTarget returns at most 5, with active listings first", { skip }, async () => {
  const rows = await findTarget("a");      // matches lots of addresses
  assert.ok(rows.length <= 5);
  const firstInactive = rows.findIndex((r) => r.status !== "Active");
  if (firstInactive >= 0) assert.ok(rows.slice(firstInactive).every((r) => r.status !== "Active"));
});

test("findTarget with blank input returns nothing", { skip }, async () => {
  assert.deepEqual(await findTarget("   "), []);
});

test("findTarget treats SQL in the input as plain text", { skip }, async () => {
  assert.deepEqual(await findTarget("x' OR '1'='1"), []);
  const [{ n }] = await query<{ n: number }>("SELECT COUNT(*) AS n FROM rets_property");
  assert.ok(Number(n) > 0);   // the table is still there
});

test("findTarget with an unknown MLS number returns nothing", { skip }, async () => {
  assert.deepEqual(await findTarget("999999999999"), []);
});

// --- getCandidates ------------------------------------------------------------------

test("candidates are active, same type, within the price range, and never the target", { skip }, async () => {
  const target = await sampleListing();
  const rows = await getCandidates(target);
  assert.ok(rows.length <= 200);
  for (const r of rows) {
    assert.equal(r.status, "Active");
    assert.equal(r.type, target.type);
    assert.notEqual(String(r.L_ListingID), String(target.L_ListingID));
    assert.ok(Number(r.price) >= target.price! * 0.5 - 1 && Number(r.price) <= target.price! * 1.5 + 1, `${r.price}`);
  }
});

test("candidates in the target's city come first", { skip }, async () => {
  const target = await sampleListing();
  const rows = await getCandidates(target);
  const firstOther = rows.findIndex((r) => r.L_City !== target.L_City);
  if (firstOther >= 0) assert.ok(rows.slice(firstOther).every((r) => r.L_City !== target.L_City));
});

test("candidates still work when the target has no price or type", { skip }, async () => {
  const target = { ...(await sampleListing()), price: null, type: null } as unknown as ListingRow;
  const rows = await getCandidates(target);
  assert.ok(rows.every((r) => r.status === "Active"));
});

// --- getComps ---------------------------------------------------------------------

test("comps return a count, and an average $/sqft only when there are comps", { skip }, async () => {
  const s = await sampleListing();
  const comps = await getComps(s, "2000-01-01", "2100-01-01");
  assert.ok(comps);
  assert.equal(typeof comps!.compCount, "number");
  if (comps!.compCount > 0) assert.ok(comps!.avgPpsf! > 0);
  else assert.equal(comps!.avgPpsf, null);
});

test("comps match a count done directly in SQL", { skip }, async () => {
  const s = await sampleListing();
  const [direct] = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM california_sold
     WHERE City = ? AND PropertyType = 'Residential' AND PropertySubType = ?
       AND LivingArea BETWEEN ? AND ? AND ClosePrice > 0 AND CloseDate >= ? AND CloseDate < ?`,
    [s.L_City!, s.type!, Math.round(s.sqft! * 0.8), Math.round(s.sqft! * 1.2), "2000-01-01", "2100-01-01"],
  );
  const comps = await getComps(s, "2000-01-01", "2100-01-01");
  assert.equal(comps!.compCount, Number(direct.n));
});

test("an empty date window has no comps", { skip }, async () => {
  const comps = await getComps(await sampleListing(), "2026-01-01", "2026-01-01");
  assert.deepEqual(comps, { avgPpsf: null, compCount: 0 });
});

test("comps can't be checked without a city or size", { skip }, async () => {
  const s = await sampleListing();
  assert.equal(await getComps({ ...s, sqft: null } as unknown as ListingRow, "2000-01-01", "2100-01-01"), null);
  assert.equal(await getComps({ ...s, L_City: null } as unknown as ListingRow, "2000-01-01", "2100-01-01"), null);
});
