---
name: mls-integration
description: Search MLS data and reply with formatted property cards. Finds active listings in rets_property and recent sold comps in california_sold from a free-text real estate request (city, price, beds, baths, square feet, type, pool, view, HOA). Use for any request to find, list, or compare properties or recent sales.
metadata: { "openclaw": { "requires": { "bins": ["node"] } } }
---

# MLS Integration

Turns a user's property request into a safe database search and returns WhatsApp-ready property cards. It uses the `property-query-parser` skill to read the request, so both skills must be installed side by side in the same `skills` folder.

## When to use

- Finding homes for sale: "2 bed condos in Mission Viejo under 700k", "houses in Fullerton with a pool"
- Recent sales or comps: "what have 3 bedroom homes sold for in Tustin?", "recent sales in Orange"
- Both at once: "show me listings and recent sales for townhomes in Lake Forest"

## How to run

Pass the user's message, exactly as written:

```bash
node --experimental-strip-types {baseDir}/scripts/search.ts --query "<user's request>"
```

Options:

| Option | Use |
|---|---|
| `--source active` | Homes for sale (default) |
| `--source sold` | Recent sales from `california_sold`. Used automatically when the request mentions sold, sales, comps, or closed. |
| `--source both` | Listings and sales together |
| `--page N` | Page of results, starting at 1 |
| `--limit N` | Results per page, 1-25 (default 10) |
| `--months N` | How far back to look for sales, 1-60 (default 12) |
| `--filters '<JSON>'` | Use filters directly instead of `--query`, for example the `filters` object from `property-query-parser`. Can be combined with `--query`; JSON values win. |

## Output

The script prints JSON:

- `ok`: `true`, or `false` with an `error` message.
- `message`: the finished WhatsApp reply with a summary line and numbered property cards. Send it to the user as is.
- `filters` and `summary`: the filters that were applied.
- `active` and/or `sold`: `total`, `page`, `totalPages`, `hasMore`, and `results`, a list of clean objects (price, beds, baths, address, and so on) for any follow-up work.

## Rules

- Send `message` to the user without rewriting the property details. Never invent listings, prices, or addresses.
- If `ok` is `false`, tell the user the `error` in plain words. If it asks for a city or budget, ask the user for it.
- When the user replies "more", "next", or similar, run the same command again with `--page` increased by 1.
- When the user changes the search (a new city, price, or feature), run a new search starting from page 1.
- Never build SQL yourself or pass user text anywhere except `--query`. The script handles all database access with parameterized queries.