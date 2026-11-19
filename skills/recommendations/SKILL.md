---
name: recommendations
description: Recommend active listings similar to one specific home the user points to by MLS number or address, with a price check for each against recent sales in california_sold. Use when the user names a particular listing, for example "show me homes like 350 S Fairway Dr", "more like MLS# 1118353294", "anything comparable to 412 Pine Ln?", or "more like the second one" right after property results. Returns the top 5 similar active listings from rets_property, each with a similarity score and whether its price is in line with, above, or below comparable sales. Not for homes described by style or feel without a specific listing (use semantic-search), searches by city, budget, or bedrooms (use mls-integration), or market statistics (use market-analytics).k
metadata: { "openclaw": { "requires": { "bins": ["node"] } } }
---

# Recommendations

Finds active listings similar to a home the user already likes, and checks each one's price against recent sales.

Each candidate gets a similarity score out of 100: up to 60 points for matching price, bedrooms, city, and size, and up to 40 for how alike the listing descriptions are. The description part reuses the embeddings built by `semantic-search`. For the top 5, it compares the list price with the average price per square foot of similar recent sales in `california_sold`.

It uses `mls-integration`'s database connection and property cards, `market-analytics`' date logic, and `semantic-search`'s embeddings, so all of those folders must be installed next to this one in the same `skills` folder.

## When to use

The user points at **one specific listing** and wants others like it:

- "Show me homes like 350 S Fairway Dr"
- "More like MLS# 1118353294"
- "Anything comparable to 412 Pine Ln in Lake Arrowhead?"
- "More like #2", "similar to the second one" (right after property results)

## When not to use

- Homes described by style or feel, with no specific listing: "something like a cozy beach cottage" → `semantic-search`.
- Searches by city, budget, bedrooms, or type, and follow-up answers in a home search: "3 bed condos in Irvine under $1M" → `mls-integration` (`chat.ts`).
- Sold homes or comps for a city → `mls-integration` (`search.ts --source sold`).
- Market questions such as median prices, trends, or "is it a good time to buy?" → `market-analytics`.

## How to run

Pass only the MLS number or the address, not the whole sentence:

```bash
node --experimental-strip-types {baseDir}/scripts/recommend.ts --listing "<MLS number or address>"
```

| The user says | Run with |
|---|---|
| "Show me homes like 350 S Fairway Dr" | `--listing "350 S Fairway Dr"` |
| "More like MLS# 1118353294" | `--listing "1118353294"` |
| "More like #2" after results | `--listing "<the MLS# shown on card 2>"` |

Every property card shows `🔖 MLS# ...`. For "#2" or "the second one", use the MLS number from that card in the most recent results. Never pass "#2" itself.

## Output

The script prints JSON:

- `ok`: `true`, or `false` with an `error` message.
- `message`: the finished WhatsApp reply. Send it to the user as is. It's one of:
  - up to 5 numbered property cards, each with a `🎯 Similarity` score out of 100 and a `💲` price check
  - "Which one did you mean?" with a numbered list, when the address matches several listings
  - "I couldn't find a listing matching ...", when nothing matches
- `target`: the listing the recommendations are based on.
- `results`: the recommended listings, each with its `score` and price `assessment`, for follow-up questions.

The similarity score compares each listing with the target; higher means closer. The price check is an estimate from the average price per square foot of similar recent sales, not an appraisal.

## Rules

- Run `recommend.ts` **once** per request, with only the MLS number or address as `--listing`.
- Reply with **only** `message`. Don't announce the search, name this skill or the command, or add an intro. Don't rewrite or reorder the property details.
- If `message` asks "Which one did you mean?", wait for the user's answer, then run the command again with the MLS number they choose.
- Don't add your own opinions about price, such as "a great deal" or "overpriced". Only repeat what the price check says.
- If `ok` is `false`, explain the `error` in plain words. If it mentions the Python environment, tell the user this skill isn't set up yet.
- If the user then wants homes by description, with no specific listing, use `semantic-search`. If they want to narrow by city, budget, or bedrooms, use `mls-integration` (`chat.ts`).
- Never build SQL yourself or pass user text anywhere except `--listing`.

## Setup (once, from the terminal)

```bash
cd {baseDir}
python3 -m venv venv
venv/bin/pip install -r requirements.txt
npm install
```

- The database login comes from `mls-integration/.env`. This skill needs no settings of its own.
- Similarity uses `semantic-search/embeddings/listings.json`. Run `semantic-search`'s `build.py` first. Listings without an embedding are still scored, on price, bedrooms, city, and size only.
