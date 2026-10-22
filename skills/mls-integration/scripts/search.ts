// CLI entry point for the mls-integration skill.
//
// Homes for sale are handed to the Week 4 conversation (conversation.ts), so the
// user always gets follow-up questions and session memory, whichever command the
// agent runs. Sold comps, --filters, and --one-shot return results directly.
//
// Examples:
//   node --experimental-strip-types search.ts --query "Find homes in Irvine"                (conversation)
//   node --experimental-strip-types search.ts --query "recent sales in Tustin" --source sold --months 6
//   node --experimental-strip-types search.ts --query "3 bed condos in Irvine" --one-shot   (Week 3 single search)
//   node --experimental-strip-types search.ts --filters '{"city":"Irvine","beds":3}' --page 2
import { parseArgs } from "node:util";
import { parsePropertyQuery } from "../../property_search/scripts/parser.ts";
import { closePool } from "./db.ts";
import {
  getSoldComps,
  sanitizeFilters,
  searchActiveListings,
  unsupportedSoldFilters,
  type PropertyFilters,
} from "./queries.ts";
import { activeMessage, describeFilters, soldMessage, toListing, toSoldComp } from "./format.ts";
import { handleMessage } from "./conversation.ts";
import { safeUserId } from "./session.ts";

// Same default as chat.ts, so both commands share one session when no sender ID is known.
const DEFAULT_USER = "whatsapp-default";

type Source = "active" | "sold" | "both";

const SOLD_WORDS = /\b(sold|comps?|comparables?|closed|recent(?:ly)? (?:sales|sold)|sale prices?)\b/i;

function fail(message: string): never {
  console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}

function friendlyDbError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  switch (e.code) {
    case "ECONNREFUSED":
      return "Couldn't connect to MySQL. Make sure it's running (brew services start mysql).";
    case "ER_ACCESS_DENIED_ERROR":
      return "MySQL rejected the login. Check MYSQL_USER and MYSQL_PASSWORD in mls-integration/.env.";
    case "ER_BAD_DB_ERROR":
      return "That database doesn't exist. Check MYSQL_DATABASE in mls-integration/.env.";
    case "ER_NO_SUCH_TABLE":
      return `A table is missing: ${e.message}`;
    case "ER_BAD_FIELD_ERROR":
      return `A column name doesn't match your table: ${e.message}`;
    default:
      return e.message ?? String(err);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      query: { type: "string" },
      filters: { type: "string" },
      source: { type: "string" },
      page: { type: "string" },
      limit: { type: "string" },
      months: { type: "string" },
      user: { type: "string" },
      "one-shot": { type: "boolean" },
    },
  });

  const queryText = values.query?.trim() ?? null;
  if (!queryText && !values.filters) fail('Pass --query "<user request>" or --filters \'<JSON>\'.');

  // 1. Get filters: from the Week 2 parser, from JSON, or both (JSON wins).
  let rawFilters: Record<string, unknown> = queryText ? { ...(await parsePropertyQuery(queryText)) } : {};
  if (values.filters) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(values.filters);
    } catch {
      fail("--filters must be valid JSON.");
    }
    // Accept either the parser's whole output ({ filters: {...} }) or just the filters.
    const obj = (parsed as { filters?: unknown })?.filters ?? parsed;
    rawFilters = { ...rawFilters, ...(obj as Record<string, unknown>) };
  }
  const filters: PropertyFilters = sanitizeFilters(rawFilters);

  // 2. Decide which table(s) to search.
  const requested = values.source?.toLowerCase();
  if (requested && !["active", "sold", "both"].includes(requested)) {
    fail('--source must be "active", "sold", or "both".');
  }
  const source: Source =
    (requested as Source | undefined) ?? (queryText && SOLD_WORDS.test(queryText) ? "sold" : "active");

  // Homes for sale go through the conversation, so follow-up questions and memory
  // work even if the agent runs search.ts instead of chat.ts.
  if (source === "active" && queryText && !values.filters && !values["one-shot"]) {
    const user = values.user?.trim() || DEFAULT_USER;
    // "--page 2" from the Week 3 habit means "show more".
    const message = Number(values.page ?? 1) > 1 ? "more" : queryText;
    try {
      const result = await handleMessage(user, message);
      console.log(
        JSON.stringify({ ok: true, source: "conversation", user: safeUserId(user), message: result.reply, ...result }, null, 2),
      );
    } catch (err) {
      fail(friendlyDbError(err));
    } finally {
      await closePool();
    }
    return;
  }

  const hasAnyFilter = Object.values(filters).some((v) => v !== null);
  if (!hasAnyFilter) {
    fail("No search filters were found. Ask the user for a city, budget, or number of bedrooms.");
  }
  if (source !== "active" && !filters.city) {
    fail("Sold comps need a city. Ask the user which city they want sales for.");
  }

  // 3. Run the queries.
  const output: Record<string, unknown> = {
    ok: true,
    source,
    query: queryText,
    filters,
    summary: describeFilters(filters),
  };
  const messages: string[] = [];

  try {
    if (source === "active" || source === "both") {
      const res = await searchActiveListings(filters, Number(values.page ?? 1), Number(values.limit ?? 10));
      const listings = res.rows.map(toListing);
      output.active = {
        page: res.page,
        limit: res.limit,
        total: res.total,
        totalPages: res.totalPages,
        hasMore: res.page < res.totalPages,
        results: listings,
      };
      messages.push(activeMessage(filters, res, listings));
    }

    if (source === "sold" || source === "both") {
      const ignored = unsupportedSoldFilters(filters);
      const res = await getSoldComps(filters, {
        months: values.months ?? 12,
        page: values.page ?? 1,
        limit: values.limit ?? 10,
      });
      const comps = res.rows.map(toSoldComp);
      output.sold = {
        months: res.months,
        page: res.page,
        limit: res.limit,
        total: res.total,
        totalPages: res.totalPages,
        hasMore: res.page < res.totalPages,
        ignoredFilters: ignored,
        results: comps,
      };
      messages.push(soldMessage(filters, res, comps, ignored));
    }
  } catch (err) {
    fail(friendlyDbError(err));
  } finally {
    await closePool();
  }

  output.message = messages.join("\n\n———\n\n");
  console.log(JSON.stringify(output, null, 2));
}

await main();
