---
name: property-query-parser
description: Turn a free-text real estate request (city, price, beds, baths, square feet, property type, pool, view, HOA) into structured filters for the rets_property MLS table. Use before any property search.
metadata: {"openclaw" : {"requires" : {"bins" : ["node"]}}}
---

# Property Query Parser

Converts a user's plain-English property request into a structured filter object that maps to columns in the `rets_property` table.

## When to use

Use this skill whenever a user asks to find, list, or count properties, for example:

- "Any 2 bedroom townhouses in Mission Viejo below 800k?"
- "Condos near Aliso Viejo with a view and HOA max $300"
- "Show me 4-bed homes in Lake Forest over 2,500 sq ft under 1.8 million"

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
- `dbFilters` lists only the filters that were found, already mapped to `rets_property` columns and comparison operators. Pass these to the database query layer.

## Filter reference

| Filter | Column | Operator | Example value |
|---|---|---|---|
| `city` | `L_City` | `=` | `"Fullerton"` |
| `maxPrice` | `L_SystemPrice` | `<=` | `1400000` |
| `beds` | `L_Keyword2` | `>=` | `2` |
| `baths` | `LM_Dec_3` | `>=` | `2.5` |
| `sqft` | `LM_Int2_3` | `>=` | `2500` |
| `type` | `L_Type_` | `=` | `"Condominium"`, `"Townhouse"`, `"SingleFamilyResidence"`, `"UnimprovedLand"` |
| `pool` | `PoolPrivateYN` | `=` | `"True"`, or `"False"` for "no pool" |
| `hasView` | `ViewYN` | `=` | `"True"`, or `"False"` for "no view" |
| `maxHOA` | `AssociationFee` | `<=` | `300`, or `0` for "no HOA" |

## Rules

- Only use filters the script returns. Never add filters the user didn't ask for.
- If `matchedAny` is `false`, ask the user what they're looking for (city, budget, bedrooms) instead of searching the whole table.
- Use values exactly as returned. Never put the user's raw text into SQL. The query layer must use parameterized queries.
- After searching, briefly tell the user which filters you applied, so they can correct a misread (for example, "Searching condos in Irvine, 3+ beds, under $1.5M, with a pool").