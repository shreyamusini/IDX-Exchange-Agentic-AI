// Session memory tests. No database needed.
// Run with: node --experimental-strip-types --test tests/session.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(path.join(tmpdir(), "mls-sessions-"));
process.env.MLS_SESSION_DIR = dir;

const { clearSession, getSession, resetMemoryForTests, safeUserId, updateSession } = await import("../scripts/session.ts");

test("handbook API: a new user starts at step 0", () => {
  assert.deepEqual(getSession("new-user"), { conversationStep: 0 });
});

test("updateSession merges and keeps earlier values", () => {
  updateSession("u1", { city: "Irvine", conversationStep: 2 });
  updateSession("u1", { maxPrice: 1_200_000 });
  const s = getSession("u1");
  assert.equal(s.city, "Irvine");
  assert.equal(s.maxPrice, 1_200_000);
  assert.equal(s.conversationStep, 2);
});

test("a session survives a restart, like the next WhatsApp message", () => {
  updateSession("u2", { city: "Tustin", conversationStep: 3 });
  resetMemoryForTests(); // the in-memory Map is gone, as in a new process
  assert.equal(getSession("u2").city, "Tustin");
  assert.equal(getSession("u2").conversationStep, 3);
});

test("clearSession removes it from memory and disk", () => {
  updateSession("u3", { city: "Irvine", conversationStep: 1 });
  clearSession("u3");
  resetMemoryForTests();
  assert.deepEqual(getSession("u3"), { conversationStep: 0 });
  assert.ok(!existsSync(path.join(dir, "u3.json")));
});

test("user IDs can't write outside the sessions folder", () => {
  assert.equal(safeUserId("../../etc/passwd"), "______etc_passwd");
  assert.equal(safeUserId("+1 (555) 123-4567"), "_1__555__123-4567");
  assert.equal(safeUserId(""), "anonymous");
  updateSession("../../evil", { city: "X", conversationStep: 1 });
  assert.ok(readdirSync(dir).includes("______evil.json"));
});

test("the CLI remembers between separate runs", () => {
  const chat = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/chat.ts");
  const run = (...args: string[]) =>
    JSON.parse(
      execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", chat, ...args], {
        env: { ...process.env, MLS_SESSION_DIR: dir },
        encoding: "utf8",
      }),
    );
  const first = run("--user", "cli-user", "--message", "Find homes in Irvine");
  assert.equal(first.step, 2);
  const second = run("--user", "cli-user", "--message", "Under $1.2M");
  assert.equal(second.step, 3);
  assert.equal(second.filters.city, "Irvine"); // remembered from the first run
  const shown = run("--user", "cli-user", "--show-session");
  assert.equal(shown.session.maxPrice, 1_200_000);
});
