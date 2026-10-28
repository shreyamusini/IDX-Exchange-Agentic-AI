---
name: market-analytics
description: Answer California housing market questions with numbers from california_sold, the sold homes table. Gives median and average sale price, price per square foot, days on market, list-to-close ratio, sales volume, year-over-year changes, a 12-month trend, active inventory, and a buyer's or seller's market read for a city or ZIP code. Use for questions like "Is now a good time to buy in San Diego?", "What's the average price per sq ft in Pasadena?", "How is the Irvine condo market?", "Irvine vs Tustin", or "What are the busiest markets?". Does not list individual homes; for homes for sale or individual sold comps use mls-integration.
metadata: { "openclaw": { "requires": { "bins": ["node"] } } }
---

# Market Analytics

Turns a market question into data-backed numbers from `california_sold` (closed sales) and `rets_property` (active listings). It uses the database connection and `.env` from `mls-integration`, and the parser from `property_search`, so both folders must be installed next to this one in the same `skills` folder.

## When to use

Questions about a **market as a whole**, not about specific homes:

- "Is now a good time to buy in San Diego?"
- "What is the average price per sq ft in Pasadena?"
- "What's the median home price in Irvine?" / "How fast are homes selling in Tustin?"
- "How is the condo market in 92618?"
- "Irvine vs Pasadena" (up to 3 cities)
- "What are the hottest markets right now?" (ranking of cities)

## When not to use

- Finding homes for sale, or any message in a home search conversation: use `mls-integration` (`chat.ts`).
- A list of individual sold homes or comps ("show me what 3 bed homes sold for in Tustin"): use `mls-integration` (`search.ts --source sold`).

## How to run

Pass the user's question, exactly as written:

```bash
node --experimental-strip-types {baseDir}/scripts/stats.ts --query "<user's question>"
```

The script finds the city (or several), ZIP code, and property type in the question. Optional flags, only when you need to set them directly:

| Option | Use |
|---|---|
| `--city <name>` | A city, or up to 3 separated by commas, instead of reading them from `--query` |
| `--zip <code>` | A 5-digit ZIP code |
| `--type <type>` | `SingleFamilyResidence`, `Condominium`, or `Townhouse` |
| `--top <N>` | Rank the N busiest cities (1-25) |

## Output

The script prints JSON:

- `ok`: `true`, or `false` with an `error` message.
- `message`: the finished WhatsApp reply. Send it to the user as is.
- `mode`: `report` (one area), `compare` (several cities), or `top` (ranking).
- For `report`: `current` and `prior` (the last 12 complete months and the 12 before), `change` (year-over-year), `trend` (12 months, each with `momPct` and `yoyPct`), `inventory`, `supply` (months of supply), and `read` (`lean` and the `signals` behind it). Use these only to answer a follow-up question about the same numbers.

## What the numbers mean

- **Median price**: half of homes sold for more, half for less. Better than the average for "typical" prices, because a few luxury sales pull the average up.
- **List-to-close %**: sale price as a percent of the final list price. Under 98% means buyers are negotiating; over 100% means homes sell over asking.
- **Days on market**: median days from listing to contract.
- **Months of supply**: active listings divided by the average monthly sales of the last 3 months. Under 3 is a seller's market, over 6 a buyer's market.
- Stats use **complete months only**: up to the last 12 that the data fully covers. Partial months at the start or end of the data are left out, and the message says which months it covers. Year-over-year changes appear only when the data has a full year before that.

## Rules

- Run `stats.ts` **once** per question with the user's exact words. Never answer market questions from memory or estimate numbers yourself.
- Send `message` exactly as returned. Don't change numbers or add statistics that aren't in the output.
- The market read describes market conditions. If the user asks whether they personally should buy, share the read and its reasons, and say it isn't financial advice and depends on their situation.
- If `ok` is `false`, tell the user the `error` in plain words. If it asks which city, ask the user.
- If the user then wants to see actual homes for sale in that city, use `mls-integration` (`chat.ts`) with their message.
- Never build SQL yourself. The script uses parameterized queries.
