import {execFile} from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { closePool, query } from "../../mls-integration/scripts/db.ts";
import { ACTIVE_COLUMNS, type ListingRow } from "../../mls-integration/scripts/queries.ts";
import { listingCard, toListing, type Listing } from "../../mls-integration/scripts/format.ts";

const run = promisify(execFile)

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = path.join(SKILL_DIR, "venv", "bin", "python3");
const SIMILAR = path.join(SKILL_DIR, "scripts", "similar.py");

const SHOW = 5;
const CANDIDATES = 15;

type Match = { id: string; score : number};
type SimilarOutput = {ok: true; results: Match[]; built_at?: string} | {ok: false; error: string };

function out(data: Record<string, unknown>): void {
    console.log(JSON.stringify(data, null, 2));
}

// `python` and `script` can be swapped in tests, so they don't need the real venv or OpenAI.
export async function runSimilar(
  text: string,
  top = CANDIDATES,
  python = PYTHON,
  script = SIMILAR,
): Promise<SimilarOutput> {
    let stdout: string;
    try {
    ({ stdout } = await run(python, [script, "--query", text, "--top", String(top)], {
      timeout: 30_000,           
      maxBuffer: 1024 * 1024,
    }));
  }
  catch (err) {
    const e = err as { code?: string; stdout?: string; killed?: boolean };
    if (e.code === "ENOENT") {
      return { ok: false, error: "The Python environment is missing. Run: python3 -m venv venv && venv/bin/pip install -r requirements.txt" };
    }
    if (e.killed) return { ok: false, error: "The similarity search timed out. Try again in a moment." };
    stdout = e.stdout ?? "";     
  }
  try {
    return JSON.parse(stdout) as SimilarOutput;
  } catch {
    return { ok: false, error: "similar.py didn't return JSON. Run it by hand to see what it printed." };
  }
}

export async function fetchActive(ids: string[]): Promise<ListingRow[]> {
    if (ids.length === 0) return [];
  const marks = ids.map(() => "?").join(", ");
  const rows = await query<ListingRow>(
    `SELECT ${ACTIVE_COLUMNS} FROM rets_property WHERE L_Status = ? AND L_ListingID IN (${marks})`,
    ["Active", ...ids],
  );
  const byId = new Map(rows.map((r) => [String(r.L_ListingID), r]));
  return ids.map((id) => byId.get(id)).filter((r): r is ListingRow => r !== undefined);
}

export function semanticMessage(text: string, listings: Listing[], scores: Map<string, number>): string {
  if (listings.length === 0) {
    return `I couldn't find active listings matching "${text}". Try describing it differently, for example the style, setting, or features you want.`;
  }
  const cards = listings.map((l, i) => {
    const score = scores.get(l.id);
    return `${listingCard(l, i + 1)}${score != null ? `\n🎯 Match score ${score.toFixed(2)}` : ""}`;
  });
  return [`🔎 *Top ${listings.length} matches* for "${text}"`, "", cards.join("\n\n")].join("\n");
}

async function main() {
  const { values } = parseArgs({ options: { query: { type: "string" } } });
  const text = values.query?.trim();
  if (!text) {
    out({ ok: false, error: 'Pass --query "<what the user is looking for>".' });
    process.exitCode = 1;
    return;
  }

  const similar = await runSimilar(text);
  if (!similar.ok) {
    out({ ok: false, error: similar.error });
    process.exitCode = 1;
    return;
  }

  const scores = new Map(similar.results.map((m) => [m.id, m.score]));
  const rows = await fetchActive(similar.results.map((m) => m.id));
  const listings = rows.slice(0, SHOW).map(toListing);

  out({
    ok: true,
    query: text,
    builtAt: similar.built_at ?? null,
    results: listings.map((l) => ({ ...l, score: scores.get(l.id) ?? null })),
    message: semanticMessage(text, listings, scores),
  });
}

// Only run when started as a command, not when a test imports this file.
const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await main();
  } catch (err) {
    out({ ok: false, error: (err as Error).message ?? String(err) });
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}