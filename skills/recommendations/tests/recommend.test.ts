// Tests for recommend.ts: the bridge to score.py, and the whole command end to end.
// runScore uses the real score.py, so it needs the venv (skipped without it).
// The end-to-end tests also use the database (skipped without mls-integration/.env).
// Run from skills/recommendations:
//   node --experimental-strip-types --test tests/*.test.ts
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { closePool, query } from "../../mls-integration/scripts/db.ts";
import type { ListingRow } from "../../mls-integration/scripts/queries.ts";
import { runScore } from "../scripts/recommend.ts";

after(closePool);

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECOMMEND = path.join(SKILL_DIR, "scripts", "recommend.ts");
const noVenv = existsSync(path.join(SKILL_DIR, "venv", "bin", "python3")) ? false : "no venv in skills/recommendations";
const noDb = process.env.MYSQL_HOST ? false : "no database settings in mls-integration/.env";

// Rows shaped like ACTIVE_COLUMNS returns them (price, beds, sqft renamed).
function row(id: string, over: Partial<Record<string, unknown>> = {}): ListingRow {
  return { L_ListingID: id, price: 1_000_000, beds: 3, L_City: "Irvine", sqft: 1800, type: "SingleFamilyResidence", ...over } as unknown as ListingRow;
}

// --- runScore (real score.py) --------------------------------------------------------

test("runScore sends listings to score.py and gets back ranked IDs", { skip: noVenv }, async () => {
  const res = await runScore(row("T"), [row("far", { price: 1_400_000, beds: 5, sqft: 3000 }), row("close"), row("T")]);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.results.map((r) => r.id), ["close", "far"]);    // most similar first, target left out
  assert.equal(res.results[0].score, 60);                               // all structured points; these IDs have no embeddings
  assert.equal(res.usedEmbeddings, false);
});

test("runScore renames columns for score.py, so price, beds, and sqft are used", { skip: noVenv }, async () => {
  const res = await runScore(row("T"), [row("A", { price: 1_200_000 })]);
  assert.ok(res.ok);
  if (res.ok) assert.equal(res.results[0].score, 45);   // 5 (price within $300K) + 15 + 15 + 10
});

test("runScore handles missing values and an empty candidate list", { skip: noVenv }, async () => {
  const missing = await runScore(row("T"), [row("A", { price: null, beds: null, L_City: null, sqft: null })]);
  assert.ok(missing.ok);
  if (missing.ok) assert.equal(missing.results[0].score, 0);
  const none = await runScore(row("T"), []);
  assert.ok(none.ok);
  if (none.ok) assert.deepEqual(none.results, []);
});

test("runScore returns at most k results", { skip: noVenv }, async () => {
  const many = Array.from({ length: 12 }, (_, i) => row(`C${i}`));
  const res = await runScore(row("T"), many, 3);
  assert.ok(res.ok);
  if (res.ok) assert.equal(res.results.length, 3);
});

// --- The whole command ---------------------------------------------------------------

const run = promisify(execFile);

async function recommend(...args: string[]): Promise<{ code: number; data: Record<string, unknown> }> {
  try {
    const { stdout } = await run(process.execPath, ["--experimental-strip-types", RECOMMEND, ...args], { timeout: 60_000 });
    return { code: 0, data: JSON.parse(stdout) };
  } catch (err) {
    const e = err as { code?: number; stdout?: string };
    return { code: typeof e.code === "number" ? e.code : 1, data: JSON.parse(e.stdout ?? "{}") };
  }
}

test("no --listing is an error", async () => {
  const { code, data } = await recommend();
  assert.equal(code, 1);
  assert.equal(data.ok, false);
  assert.match(String(data.error), /--listing/);
});

test("an unknown listing gets a friendly not-found message", { skip: noDb }, async () => {
  const { code, data } = await recommend("--listing", "999999999999");
  assert.equal(code, 0);
  assert.equal(data.ok, true);
  assert.match(String(data.message), /couldn't find a listing matching/);
});

test("an MLS number gets up to 5 recommendations with price checks", { skip: noDb || noVenv }, async () => {
  const [s] = await query<{ id: string }>(
    `SELECT L_ListingID AS id FROM rets_property
     WHERE L_Status = ? AND L_SystemPrice > 0 AND LM_Int2_3 > 0 AND L_Type_ IS NOT NULL AND L_City IS NOT NULL
     ORDER BY L_ListingID LIMIT 1`,
    ["Active"],
  );
  const { code, data } = await recommend("--listing", String(s.id));
  assert.equal(code, 0, JSON.stringify(data));
  assert.equal(data.ok, true);
  const results = data.results as { listing: { id: string; status: string }; score: number; assessment: { status: string } }[];
  assert.ok(results.length <= 5);
  assert.ok(results.every((r) => r.listing.id !== String(s.id) && r.listing.status === "Active"));
  assert.deepEqual(results.map((r) => r.score), [...results.map((r) => r.score)].sort((a, b) => b - a));
  assert.ok(results.every((r) => ["assessed", "no-data"].includes(r.assessment.status)));
  const msg = String(data.message);
  assert.match(msg, /^🏡 \*Homes like /);
  assert.equal((msg.match(/🎯 Similarity/g) ?? []).length, results.length);
  assert.equal((msg.match(/💲 /g) ?? []).length, results.length);
});
