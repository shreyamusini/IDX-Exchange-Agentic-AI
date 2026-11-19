import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

import { closePool } from "../../mls-integration/scripts/db.ts";
import { toListing } from "../../mls-integration/scripts/format.ts";
import type { ListingRow } from "../../mls-integration/scripts/queries.ts"
import { dataWindows } from "../../market-analytics/scripts/analyze.ts";
import { getDataRange } from "../../market-analytics/scripts/market.ts";

import { findTarget, getCandidates, getComps } from "./queries.ts";
import { assessPrice } from "./assess.ts";
import { notFoundMessage, recommedationsMessage, whichOneMessage, type Recommendation } from "./format.ts";

const run = promisify(execFile)
const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = path.join(SKILL_DIR, "venv", "bin", "python3");
const SCORE = path.join(SKILL_DIR, "scripts", "score.py")

function out(data: Record<string, unknown>): void {
    console.log(JSON.stringify(data, null, 2));
}

type ScoreOutput = 
| {ok: true; results: {id: string; score: number}[]; usedEmbeddings: boolean}
| {ok: false; error: string};

function toScoreInput(r: ListingRow) {
    return {
        L_ListingID: String(r.L_ListingID),
        L_SystemPrice: r.price ?? null,
        L_Keyword2: r.beds ?? null,
        L_City: r.L_City ?? null, 
        LM_Int2_3: r.sqft ?? null,
    };
}

export async function runScore(target: ListingRow, candidates: ListingRow[], k = 5): Promise<ScoreOutput> {
    const input = JSON.stringify({target: toScoreInput(target), candidates: candidates.map(toScoreInput), k});
    const job = run(PYTHON, [SCORE], {timeout: 30_000, maxBuffer: 1024 * 1024});
    job.child.stdin?.end(input);
    let stdout: string;
    try {
        ({stdout} = await job);
    } catch (err) {
        const e = err as {code? : string; stdout?:string};
        if (e.code === "ENOENT") return {ok: false, error: "The Python environment is missing. Run: python3 -m venv venv && venv/bin/pip install -r requirements.txt"};
        stdout = e.stdout ?? "";
    }
    try {
        return JSON.parse(stdout) as ScoreOutput;
    } catch {
        return {ok : false, error: "score.py didn't return JSON. Run it by hand to see what it printed."}
    }
}


async function main() {
    const { values } = parseArgs({ options: { listing: {type: "string"}}})
    const text = values.listing?.trim()
    if (!text) {
        out({ok: false, error: 'Pass --listing "<MLS number or address>".'})
        process.exitCode = 1;
        return;
    }

    const matches = await findTarget(text);
    if (matches.length === 0) {
        out({ok: true, message: notFoundMessage(text)})
        return;
    }

    if (matches.length > 1) {
        out({ok: true, message: whichOneMessage(matches.map(toListing))})
        return;
    }

    const target = matches[0];
    const candidates = await getCandidates(target);
    
    const scored = await runScore(target, candidates);
    if (!scored.ok) {
        out({ok: false, error: scored.error});
        process.exitCode = 1;
        return;
    }

    const byId = new Map(candidates.map((c) => [String(c.L_ListingID), c]));
    const win = dataWindows(new Date(), await getDataRange(), 6)

    const recs: Recommendation[] = [];    
    for (const result of scored.results) {
        const row = byId.get(result.id);
        if (!row) continue;

        const rowComp = await getComps(row, win.current.from, win.current.to)
        const rowAssess = assessPrice(row.price, row.sqft, rowComp);
        recs.push({listing: toListing(row), score: result.score, assessment: rowAssess});
    }

    out({ok: true, target: toListing(target), results: recs, message: recommedationsMessage(toListing(target), recs, win.current.label, scored.usedEmbeddings)});
}


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