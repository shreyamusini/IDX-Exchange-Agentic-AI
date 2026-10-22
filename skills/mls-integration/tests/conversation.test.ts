// Conversation tests. These use a fake search instead of MySQL, so they run anywhere.
// Run with: node --experimental-strip-types --test tests/conversation.test.ts
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.MLS_SESSION_DIR = mkdtempSync(path.join(tmpdir(), "mls-sessions-"));

const { handleMessage, bareBudget, STEP } = await import("../scripts/conversation.ts");
const { getSession, resetMemoryForTests, safeUserId, SESSION_TTL_MS } = await import("../scripts/session.ts");
import type { ListingRow, PagedResult, PropertyFilters } from "../scripts/queries.ts";

type Call = { filters: PropertyFilters; page: number; limit: number };
let calls: Call[] = [];
let totalListings = 7;

function row(i: number): ListingRow {
  return {
    L_ListingID: `L${i}`, L_DisplayId: `OC${i}`, L_Address: `${i} Canyon View`, L_City: "Irvine", L_Zip: "92620",
    price: 800_000 + i * 10_000, beds: 3, baths: 2.5, sqft: 1800, type: "SingleFamilyResidence", status: "Active",
    lat: null, lng: null, YearBuilt: 1999, AssociationFee: null, DaysOnMarket: 5,
    PoolPrivateYN: 1, ViewYN: null, FireplaceYN: null, PhotoCount: 20 + i,
    LA1_UserFirstName: "Ana", LA1_UserLastName: "Lee", LO1_OrganizationName: "Coast Homes",
  };
}

async function fakeSearch(filters: PropertyFilters, page: number, limit: number): Promise<PagedResult<ListingRow>> {
  calls.push({ filters, page, limit });
  const offset = (page - 1) * limit;
  const count = Math.max(0, Math.min(limit, totalListings - offset));
  return {
    page, limit, offset, total: totalListings,
    totalPages: Math.max(1, Math.ceil(totalListings / limit)),
    rows: Array.from({ length: count }, (_, i) => row(offset + i + 1)),
  };
}

let n = 0;
let user = "";
const say = (msg: string, who = user) => handleMessage(who, msg, fakeSearch);

beforeEach(() => {
  calls = [];
  totalListings = 7;
  user = `+1555000${++n}`;
});

test("handbook example: asks budget, then type, then searches", async () => {
  let r = await say("Find homes in Irvine");
  assert.equal(r.step, STEP.ASK_BUDGET);
  assert.match(r.reply, /budget/i);
  assert.equal(calls.length, 0);

  r = await say("Under $1.2M");
  assert.equal(r.step, STEP.ASK_TYPE);
  assert.match(r.reply, /condo, townhome, or single family/);
  assert.equal(calls.length, 0);

  r = await say("Single family with at least 3 beds");
  assert.equal(r.step, STEP.RESULTS);
  assert.equal(r.searched, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].page, 1);
  assert.equal(calls[0].filters.city, "Irvine");
  assert.equal(calls[0].filters.maxPrice, 1_200_000);
  assert.equal(calls[0].filters.type, "SingleFamilyResidence");
  assert.equal(calls[0].filters.beds, 3);
});

test("results show address, price, beds/baths, and photo count", async () => {
  const r = await say("3 bed single family homes in Irvine under 1.2M");
  assert.equal(r.searched, true);
  assert.match(r.reply, /\*1\. 1 Canyon View, Irvine 92620\*/);
  assert.match(r.reply, /💰 \$810,000 · 3 bd · 2\.5 ba/);
  assert.match(r.reply, /📸 21 photos/);
  assert.equal(r.results?.length, 5);
});

test("everything in one message searches right away", async () => {
  const r = await say("condos in Tustin under 900k");
  assert.equal(r.searched, true);
  assert.deepEqual(
    [calls[0].filters.city, calls[0].filters.type, calls[0].filters.maxPrice],
    ["Tustin", "Condominium", 900_000],
  );
});

test("short answers: a bare city, a bare amount, a bare type", async () => {
  let r = await say("hi");
  assert.equal(r.step, STEP.ASK_CITY);
  r = await say("newport beach");
  assert.equal(r.step, STEP.ASK_BUDGET);
  r = await say("1.5M");
  assert.equal(r.step, STEP.ASK_TYPE);
  r = await say("condo");
  assert.equal(r.searched, true);
  assert.deepEqual(
    [calls[0].filters.city, calls[0].filters.maxPrice, calls[0].filters.type],
    ["Newport Beach", 1_500_000, "Condominium"],
  );
});

test('"any" skips the budget and type questions', async () => {
  await say("homes in Irvine");
  let r = await say("no budget");
  assert.equal(r.step, STEP.ASK_TYPE);
  r = await say("any");
  assert.equal(r.searched, true);
  assert.equal(calls[0].filters.maxPrice, null);
  assert.equal(calls[0].filters.type, null);
});

test('"more" shows the next page with the same filters', async () => {
  await say("condos in Irvine under 1M");
  const r = await say("more");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].page, 2);
  assert.deepEqual(calls[1].filters, calls[0].filters);
  assert.match(r.reply, /\*6\. 6 Canyon View/);
  assert.match(r.reply, /Showing 6–7 \(page 2 of 2\)/);
});

test('"more" before any results asks the next question instead', async () => {
  await say("homes in Irvine");
  const r = await say("more");
  assert.equal(calls.length, 0);
  assert.match(r.reply, /budget/i);
});

test("refining after results keeps earlier filters and starts at page 1", async () => {
  await say("single family homes in Irvine under 1.2M");
  await say("more");
  await say("only ones with a pool and at least 2 baths");
  const last = calls.at(-1)!;
  assert.equal(last.page, 1);
  assert.deepEqual(
    [last.filters.city, last.filters.maxPrice, last.filters.type, last.filters.pool, last.filters.baths],
    ["Irvine", 1_200_000, "SingleFamilyResidence", "True", 2],
  );
});

test('"what about Tustin" changes only the city', async () => {
  await say("condos in Irvine under 900k");
  await say("what about Tustin?");
  const last = calls.at(-1)!;
  assert.deepEqual([last.filters.city, last.filters.type, last.filters.maxPrice], ["Tustin", "Condominium", 900_000]);
});

test('"what about condos" changes the type, not the city', async () => {
  await say("homes in Irvine under 900k");
  await say("any");
  await say("what about condos");
  const last = calls.at(-1)!;
  assert.deepEqual([last.filters.city, last.filters.type], ["Irvine", "Condominium"]);
});

test('"any type" removes a type chosen earlier', async () => {
  await say("condos in Irvine under 900k");
  await say("any type");
  assert.equal(calls.at(-1)!.filters.type, null);
  assert.equal(calls.at(-1)!.filters.city, "Irvine");
});

test('"start over" forgets everything', async () => {
  await say("condos in Irvine under 900k");
  const r = await say("start over");
  assert.equal(r.step, STEP.ASK_CITY);
  assert.equal(r.filters.city, null);
  assert.equal(r.filters.type, null);
});

test('"start over" with a new request begins the new search', async () => {
  await say("condos in Irvine under 900k");
  const r = await say("start over, townhomes in Tustin");
  assert.equal(r.step, STEP.ASK_BUDGET);
  assert.equal(r.filters.city, "Tustin");
  assert.equal(r.filters.type, "Townhouse");
  assert.equal(r.filters.maxPrice, null);
});

test("each user has their own session", async () => {
  await say("condos in Irvine", "+1555111");
  await say("homes in Tustin", "+1555222");
  assert.equal(getSession("+1555111").city, "Irvine");
  assert.equal(getSession("+1555222").city, "Tustin");
});

test('"3 beds" while being asked for a budget is not read as $3M', async () => {
  await say("homes in Irvine");
  const r = await say("3 beds");
  assert.equal(r.filters.beds, 3);
  assert.equal(r.filters.maxPrice, null);
  assert.equal(r.step, STEP.ASK_BUDGET);
});

test('"find homes" is not mistaken for a city', async () => {
  const r = await say("find homes");
  assert.equal(r.filters.city, null);
  assert.equal(r.step, STEP.ASK_CITY);
});

test("an unclear message after results explains how to refine", async () => {
  await say("condos in Irvine under 900k");
  const r = await say("hmm ok");
  assert.equal(calls.length, 1);
  assert.match(r.reply, /narrow these down/);
});

test("no matches suggests how to widen the search", async () => {
  totalListings = 0;
  const r = await say("condos in Irvine under 100k");
  assert.match(r.reply, /No homes match/);
  assert.equal(r.step, STEP.RESULTS);
});

test("a session older than 30 minutes is forgotten", async () => {
  await say("condos in Irvine under 900k");
  const file = path.join(process.env.MLS_SESSION_DIR!, `${safeUserId(user)}.json`);
  writeFileSync(file, JSON.stringify({ ...getSession(user), updatedAt: Date.now() - SESSION_TTL_MS - 1000 }));
  resetMemoryForTests();
  assert.equal(getSession(user).city, undefined);
});

test("the same message twice in a row only counts once", async () => {
  await say("Find homes in Irvine");
  const first = await say("Under $1.2M");
  const second = await say("Under $1.2M"); // e.g. the agent ran two commands for one message
  assert.equal(first.step, STEP.ASK_TYPE);
  assert.equal(second.step, STEP.ASK_TYPE);
  assert.equal(second.duplicate, true);
  assert.equal(second.reply, first.reply);
  assert.equal(calls.length, 0); // no search yet: still waiting for a property type
});

test("repeating a saved budget while being asked for a type doesn't skip the type", async () => {
  await say("Find homes in Irvine");
  await say("Under $1.2M");
  const r = await say("under 1.2 million"); // different words, same budget
  assert.equal(r.step, STEP.ASK_TYPE);
  assert.equal(calls.length, 0);
});

test("the same message again after the duplicate window is handled normally", async () => {
  await say("condos in Irvine under 900k");
  const s = getSession(user);
  const { updateSession } = await import("../scripts/session.ts");
  updateSession(user, { lastMessageAt: (s.lastMessageAt ?? 0) - 3 * 60 * 1000 });
  await say("condos in Irvine under 900k");
  assert.equal(calls.length, 2);
});

test("bare budget amounts", () => {
  assert.equal(bareBudget("1.2M"), 1_200_000);
  assert.equal(bareBudget("$900k"), 900_000);
  assert.equal(bareBudget("around 1.5 million"), 1_500_000);
  assert.equal(bareBudget("2"), 2_000_000);
  assert.equal(bareBudget("850"), 850_000);
  assert.equal(bareBudget("$750,000"), 750_000);
  assert.equal(bareBudget("no budget"), null);
});
