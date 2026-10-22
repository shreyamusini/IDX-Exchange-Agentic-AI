// Routing tests: whichever command the agent runs, homes for sale go through the
// conversation and sold comps don't. No database needed.
// Run with: node --experimental-strip-types --test tests/routing.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts");
const dir = mkdtempSync(path.join(tmpdir(), "mls-routing-"));

function run(script: string, ...args: string[]) {
  try {
    const out = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", path.join(scripts, script), ...args], {
      env: { ...process.env, MLS_SESSION_DIR: dir },
      encoding: "utf8",
    });
    return JSON.parse(out);
  } catch (err) {
    // Scripts exit with code 1 on errors but still print JSON.
    return JSON.parse((err as { stdout: string }).stdout);
  }
}

test("search.ts hands a home-for-sale request to the conversation", () => {
  const r = run("search.ts", "--query", "Find homes in Irvine");
  assert.equal(r.ok, true);
  assert.equal(r.source, "conversation");
  assert.equal(r.step, 2);
  assert.match(r.message, /budget/i);
});

test("chat.ts and search.ts share one session when no --user is given", () => {
  const r = run("chat.ts", "--message", "Under $1.2M");
  assert.equal(r.step, 3);
  assert.equal(r.filters.city, "Irvine"); // remembered from the search.ts call
  assert.equal(r.filters.maxPrice, 1_200_000);
});

test('search.ts --page 2 means "more" in the conversation', () => {
  const r = run("search.ts", "--query", "Find homes in Irvine", "--page", "2");
  assert.equal(r.source, "conversation");
  assert.match(r.message, /There aren't any results yet/);
});

test("sold comps skip the conversation", () => {
  const r = run("search.ts", "--query", "recent sales of 3 bed homes", "--source", "sold");
  assert.equal(r.ok, false);
  assert.match(r.error, /Sold comps need a city/);
});

test("--one-shot keeps the Week 3 single search", () => {
  const r = run("search.ts", "--query", "hello", "--one-shot");
  assert.equal(r.ok, false);
  assert.match(r.error, /No search filters were found/);
});
