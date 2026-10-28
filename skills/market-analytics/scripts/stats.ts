// CLI entry point for the market-analytics skill.
//
// Examples:
//   node --experimental-strip-types stats.ts --query "Is now a good time to buy in San Diego?"
//   node --experimental-strip-types stats.ts --query "average price per sq ft in Pasadena"
//   node --experimental-strip-types stats.ts --query "Irvine vs Tustin condo market"
//   node --experimental-strip-types stats.ts --query "what are the busiest markets?"
//   node --experimental-strip-types stats.ts --city Irvine --type Condominium
//   node --experimental-strip-types stats.ts --zip 92618
//   node --experimental-strip-types stats.ts --top 10
import { parseArgs } from "node:util";
import { closePool } from "../../mls-integration/scripts/db.ts";
import { compareMessage, reportMessage, topCitiesMessage } from "./format.ts";
import { canonicalCity, getTopCities, knownCities, SUBTYPES, type MarketFilters } from "./market.ts";
import { findCities, readQuestion } from "./question.ts";
import { buildReport, getWindows } from "./report.ts";

const MAX_CITIES = 3;
const COMPARE_WORDS = /\b(vs\.?|versus|compare[ds]?|comparison|and|or|between)\b/i;

function out(data: Record<string, unknown>): void {
  console.log(JSON.stringify(data, null, 2));
}

function fail(message: string): never {
  out({ ok: false, error: message });
  process.exitCode = 1;
  throw new Exit();
}
class Exit extends Error {}

function friendlyDbError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  switch (e.code) {
    case "ECONNREFUSED":
      return "Couldn't connect to MySQL. Make sure it's running (brew services start mysql).";
    case "ER_ACCESS_DENIED_ERROR":
      return "MySQL rejected the login. Check mls-integration/.env.";
    case "ER_NO_SUCH_TABLE":
      return `A table is missing: ${e.message}`;
    case "ER_BAD_FIELD_ERROR":
      return /PostalCode/.test(e.message ?? "")
        ? "california_sold has no PostalCode column, so ZIP code stats aren't available. Ask about a city instead."
        : `A column name doesn't match your table: ${e.message}`;
    case "ER_PARSE_ERROR":
    case "ER_NOT_SUPPORTED_YET":
      return "This MySQL version doesn't support window functions. Market stats need MySQL 8 or newer.";
    default:
      return e.message ?? String(err);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      query: { type: "string" },
      city: { type: "string" },
      zip: { type: "string" },
      type: { type: "string" },
      top: { type: "string" },
    },
  });

  const text = values.query?.trim() ?? "";
  if (!text && !values.city && !values.zip && !values.top) {
    fail('Pass --query "<user question>", --city <name>, --zip <code>, or --top <N>.');
  }

  const q = text ? await readQuestion(text) : null;
  if (q?.typeError) fail(q.typeError);

  const type = values.type ?? q?.type ?? null;
  if (type && !(SUBTYPES as readonly string[]).includes(type)) {
    fail(`--type must be one of: ${SUBTYPES.join(", ")}.`);
  }
  const zip = values.zip ?? q?.zip ?? null;
  if (zip && !/^\d{5}$/.test(zip)) fail("--zip must be a 5-digit ZIP code.");

  // Which cities? Explicit --city wins. Otherwise check the parser's guess against the
  // data, and look for known city names when it's missing, wrong, or there may be several.
  let cities: string[] = [];
  if (values.city) {
    for (const name of values.city.split(",").map((s) => s.trim()).filter(Boolean)) {
      const found = await canonicalCity(name);
      if (!found) fail(`There are no residential sales for "${name}" in california_sold. Check the spelling or try a nearby city.`);
      cities.push(found);
    }
  } else if (q) {
    const guess = q.cityGuess ? await canonicalCity(q.cityGuess) : null;
    if (guess && !COMPARE_WORDS.test(text)) cities = [guess];
    else {
      cities = findCities(text, await knownCities());
      if (cities.length === 0 && guess) cities = [guess];
      if (cities.length === 0 && q.cityGuess && !zip && !q.wantsTop) {
        fail(`There are no residential sales for "${q.cityGuess}" in california_sold. Check the spelling or try a nearby city.`);
      }
    }
  }

  // Same months for every city in this answer, based on what the data fully covers.
  const win = await getWindows();

  // Ranking of cities: --top, or a question like "what are the hottest markets?"
  if (values.top || (q?.wantsTop && cities.length === 0 && !zip)) {
    const { current } = win;
    const limit = Number(values.top ?? 10);
    const rows = await getTopCities(current.from, current.to, limit, type);
    out({ ok: true, mode: "top", window: current, type, results: rows, message: topCitiesMessage(rows, current, type) });
    return;
  }

  if (cities.length === 0 && !zip) {
    fail("Which city or ZIP code? Market stats need a California city, for example \"San Diego\" or \"92618\".");
  }

  if (cities.length > 1) {
    const picked = cities.slice(0, MAX_CITIES);
    const reports = [];
    for (const city of picked) reports.push(await buildReport({ city, zip: null, type }, win));
    out({
      ok: true,
      mode: "compare",
      cities: picked,
      skipped: cities.slice(MAX_CITIES),
      reports,
      message: compareMessage(reports),
    });
    return;
  }

  const filters: MarketFilters = { city: cities[0] ?? null, zip, type };
  const report = await buildReport(filters, win);
  out({ ok: true, mode: "report", filters, ...report, message: reportMessage(report) });
}

try {
  await main();
} catch (err) {
  if (!(err instanceof Exit)) {
    out({ ok: false, error: friendlyDbError(err) });
    process.exitCode = 1;
  }
} finally {
  await closePool();
}
