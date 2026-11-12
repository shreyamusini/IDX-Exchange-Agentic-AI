// Tests for search.ts. Fake "similar" scripts stand in for similar.py, so no OpenAI calls.
// The database test uses mls-integration/.env and is skipped without it.
// Run from skills/semantic-search:
//   node --experimental-strip-types --test tests/search.test.ts
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closePool, query } from "../../mls-integration/scripts/db.ts";
import type { Listing } from "../../mls-integration/scripts/format.ts";
import { fetchActive, runSimilar, semanticMessage } from "../scripts/search.ts";

after(closePool);

// --- runSimilar ----------------------------------------------------------------

// Writes a small Node script that behaves like similar.py in a given way. Node itself
// (process.execPath) plays the part of the venv's Python, so these tests need no Python.
const dir = mkdtempSync(path.join(tmpdir(), "semantic-search-test-"));
function fakeSimilar(name: string, body: string): string {
  const file = path.join(dir, `${name}.mjs`);
  writeFileSync(file, body);
  return file;
}

test("runSimilar passes the user's text as one argument and reads the JSON", async () => {
  const script = fakeSimilar("echo", `
    const args = process.argv.slice(2);
    console.log(JSON.stringify({ ok: true, results: [{ id: "1", score: 0.9 }], args }));
  `);
  const text = 'craftsman "with views"; rm -rf ~';   // stays plain text, never a shell command
  const res = (await runSimilar(text, 7, process.execPath, script)) as unknown as { ok: boolean; args: string[] };
  assert.equal(res.ok, true);
  assert.deepEqual(res.args, ["--query", text, "--top", "7"]);
});

test("runSimilar returns similar.py's error when it exits with 1", async () => {
  const script = fakeSimilar("fail", `
    console.log(JSON.stringify({ ok: false, error: "No embeddings yet. Run build.py first." }));
    process.exit(1);
  `);
  assert.deepEqual(await runSimilar("x", 5, process.execPath, script), {
    ok: false,
    error: "No embeddings yet. Run build.py first.",
  });
});

test("runSimilar explains output that isn't JSON", async () => {
  const script = fakeSimilar("garbage", `console.log("Embedded 1/1"); console.log("{not json");`);
  const res = await runSimilar("x", 5, process.execPath, script);
  assert.equal(res.ok, false);
  assert.match((res as { error: string }).error, /didn't return JSON/);
});

test("runSimilar explains a missing Python environment", async () => {
  const res = await runSimilar("x", 5, path.join(dir, "no-venv", "python3"), "similar.py");
  assert.equal(res.ok, false);
  assert.match((res as { error: string }).error, /Python environment is missing/);
});

// --- semanticMessage -------------------------------------------------------------

function listing(id: string, over: Partial<Listing> = {}): Listing {
  return {
    id, mlsNumber: `MLS${id}`, address: `${id} Oak St`, city: "Pasadena", zip: "91104",
    price: 1_450_000, beds: 3, baths: 2, sqft: 1850, type: "SingleFamilyResidence", status: "Active",
    yearBuilt: 1924, hoaFee: null, daysOnMarket: 12, pool: null, view: true, fireplace: true,
    photoCount: 20, agent: "Jane Doe", office: "Example Realty", lat: null, lng: null, ...over,
  } as Listing;
}

test("message numbers the cards in similarity order with their scores", () => {
  const msg = semanticMessage(
    "charming craftsman",
    [listing("1"), listing("2", { address: "2 Elm St" })],
    new Map([["1", 0.6123], ["2", 0.5871]]),
  );
  assert.match(msg, /^🔎 \*Top 2 matches\* for "charming craftsman"/);
  assert.ok(msg.indexOf("*1. 1 Oak St") < msg.indexOf("*2. 2 Elm St"));
  assert.match(msg, /🎯 Match score 0\.61/);
  assert.match(msg, /🎯 Match score 0\.59/);
  assert.match(msg, /\$1,450,000/);                 // the same cards as mls-integration
});

test("message without a score leaves the score line out", () => {
  const msg = semanticMessage("x", [listing("1")], new Map());
  assert.doesNotMatch(msg, /Match score/);
});

test("message when nothing matches", () => {
  assert.match(semanticMessage("igloo", [], new Map()), /couldn't find active listings matching "igloo"/);
});

// --- fetchActive (live database) ---------------------------------------------------

const skip = process.env.MYSQL_HOST ? false : "no database settings in mls-integration/.env";

test("fetchActive keeps the similarity order and drops listings that aren't active", { skip }, async () => {
  const active = await query<{ id: string }>(
    "SELECT L_ListingID AS id FROM rets_property WHERE L_Status = ? ORDER BY L_ListingID LIMIT 3",
    ["Active"],
  );
  assert.ok(active.length >= 2, "need at least 2 active listings to test with");
  const ids = active.map((r) => String(r.id)).reverse();           // an order MySQL wouldn't return on its own
  const rows = await fetchActive([ids[0], "not-a-real-listing-id", ...ids.slice(1)]);
  assert.deepEqual(rows.map((r) => String(r.L_ListingID)), ids);
  assert.ok(rows.every((r) => (r as { status?: string }).status === "Active"));
});

test("fetchActive with no IDs doesn't query", { skip }, async () => {
  assert.deepEqual(await fetchActive([]), []);
});
