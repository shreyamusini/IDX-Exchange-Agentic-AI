// CLI entry point for the skill
// Usage: node --experimental-strip-types parse.ts "query"

import { parsePropertyQuery, toDbFilters } from "./parser.ts";

const query = process.argv.slice(2).join(" ").trim();

if (!query) {
    console.error('Usage: parse.ts "<real estate query>"');
    process.exit(1)
}

const filters = await parsePropertyQuery(query);
const dbFilters = toDbFilters(filters);

console.log(
  JSON.stringify(
    {
      query,
      filters,
      dbFilters,
      matchedAny: dbFilters.length > 0,
    },
    null,
    2,
  ),
);