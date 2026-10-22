---
name: property-query-parser
description: Translate a free-text real estate request into structured filters (city, price, beds, baths, square feet, property type, pool, view, HOA) without searching. Use when you need to know or explain what a request means, for example "what filters would you use for this?" or when another tool needs the filters as JSON. Does not search or return listings; for finding homes use mls-integration.
metadata: { "openclaw": { "requires": { "bins": ["node"] } } }
---

# Property Query Parser

Converts a user's plain-English property request into a structured filter object that maps to columns in the `rets_property` table. It only translates the request. It doesn't search the database or reply with listings.

`mls-integration` uses this parser's code internally for every search, so it keeps working whether or not this skill is called directly.

## When to use

Use this skill when the goal is to **understand** a request, not to search:

- The user asks how a request will be read: "What filters would you use for 2 bedroom townhouses in Mission Viejo below 800k?"
- Checking or explaining what was understood: "Did you get that I want a view and HOA under $300?"
- Another tool or agent needs the filters as JSON, for example "Show me 4-bed homes in Lake Forest over 2,500 sq ft under 1.8 million" turned into filters for a report

## When not to use

- Finding, listing, or showing homes for sale, or any message in a home search conversation: use `mls-integration` (`chat.ts`).
- Sold homes or comps: use `mls-integration` (`search.ts`).

## How to run

Pass the user's message, exactly as written, as one quoted argument:

```bash
node --experimental-strip-types {baseDir}/scripts/parse.ts "<user's query>"
```

## Output

The script prints JSON:

```json
{
  "query": "Find me a house in Fullerton with a pool, 3 baths, under $1.4M",
  "filters": {
    "city": "Fullerton",
    "maxPrice": 1400000,
    "beds": null,
    "baths": 3,
    "sqft": null,
    "type": "SingleFamilyResidence",
    "pool": "True",
    "hasView": null,
    "maxHOA": null
  },
  "dbFilters": [
    { "column": "L_City", "op": "=", "value": "Fullerton" },
    { "column": "L_SystemPrice", "op": "<=", "value": 1400000 },
    { "column": "LM_Dec_3", "op": ">=", "value": 3 },
    { "column": "L_Type_", "op": "=", "value": "SingleFamilyResidence" },
    { "column": "PoolPrivateYN", "op": "=", "value": "True" }
  ],
  "matchedAny": true
}
```

- `filters` holds every supported filter. `null` means the user didn't mention it.
- `dbFilters` lists only the filters that were found, mapped to `rets_property` columns and comparison operators. It's for reference, to show which column each filter applies to. `mls-integration` does its own mapping, including turning pool and view into the table's 1 / NULL values, so don't run queries with `dbFilters` directly.

## Filter reference

| Filter | Column | Operator | Example value |
|---|---|---|---|
| `city` | `L_City` | `=` | `"Irvine"` |
| `maxPrice` | `L_SystemPrice` | `<=` | `1500000` |
| `beds` | `L_Keyword2` | `>=` | `3` |
| `baths` | `LM_Dec_3` | `>=` | `2.5` |
| `sqft` | `LM_Int2_3` | `>=` | `1800` |
| `type` | `L_Type_` | `=` | `"Condominium"`, `"Townhouse"`, `"SingleFamilyResidence"`, `"UnimprovedLand"` |
| `pool` | `PoolPrivateYN` | `=` | `"True"`, or `"False"` for "no pool" (the search turns these into the table's 1 / NULL) |
| `hasView` | `ViewYN` | `=` | `"True"`, or `"False"` for "no view" (the search turns these into the table's 1 / NULL) |
| `maxHOA` | `AssociationFee` | `<=` | `500`, or `0` for "no HOA" |

## Rules

- Only use filters the script returns. Never add filters the user didn't ask for.
- If `matchedAny` is `false`, say no filters were found and ask the user to rephrase, for example with a city, budget, or number of bedrooms.
- Use values exactly as returned. Never put the user's raw text into SQL.
- Don't search with these filters yourself. To find homes, use `mls-integration`.
