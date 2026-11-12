---
name: semantic-search
description: Find active homes for sale that match a free-text description by meaning, not keywords or filters. Use when the user describes the style, feel, setting, or character they want, for example "charming craftsman with mountain views and character", "bright modern home with an open kitchen", "cozy cottage that feels like the beach", or "Spanish-style home with a courtyard". Returns the 5 most similar active listings from rets_property as property cards. Not for searches made of filters like city, budget, or bedrooms (use mls-integration), and not for market statistics (use market-analytics).
metadata: { "openclaw": { "requires": { "bins": ["node"] } } }
---

# Semantic Search

Finds listings whose descriptions mean something similar to what the user wrote, even when they share no words. "Charming craftsman with character" can match a listing that says "1920s bungalow with original woodwork".

It compares an OpenAI embedding of the user's text with saved embeddings of every active listing (built by `build.py`), takes the closest matches, checks they're still active in `rets_property`, and replies with the same property cards as `mls-integration`. It uses `mls-integration`'s database connection and card formatting, so that folder must be installed next to this one in the same `skills` folder.

## When to use

The user describes **what kind of home** they want, in their own words:

- "Charming craftsman with mountain views and character"
- "Something modern and bright with an open kitchen for entertaining"
- "A quiet home with a big backyard for kids and a dog"
- "Show me homes like a cozy beach cottage"

## When not to use

- Requests made of filters, or any message in a home search conversation: "3 bed condos in Irvine under $1M", "Under $1.2M", "condo", "more", "start over" → `mls-integration` (`chat.ts`).
- Sold homes or comps → `mls-integration` (`search.ts --source sold`).
- Market questions such as prices, trends, or "is it a good time to buy?" → `market-analytics`.

If a request mixes a description with filters ("craftsman with character in Pasadena under $1.5M"), use this skill when the description is the main point. This skill ranks by meaning only. It doesn't filter by city, price, or bedrooms, so say so in one short line after the results and offer to search with those filters using `mls-integration`.

## How to run

Pass the user's description, exactly as written:

```bash
node --experimental-strip-types {baseDir}/scripts/search.ts --query "<user's description>"
```

## Output

The script prints JSON:

- `ok`: `true`, or `false` with an `error` message.
- `message`: the finished WhatsApp reply with up to 5 numbered property cards, each with a match score. Send it to the user as is.
- `results`: the listings shown, each with its `score`, for follow-up questions about them.
- `builtAt`: when the listing embeddings were last built.

Match scores compare listings with each other. Higher is more similar; good matches are often between 0.4 and 0.7, not near 1.0. Don't describe a score as a percentage.

## Rules

- Run `search.ts` **once** per request with the user's exact words. Never answer from memory or invent listings, prices, or addresses.
- Send `message` exactly as returned. Don't rewrite or reorder the property details.
- Reply with **only** `message`. Don't announce the search, name this skill or the command, or add an intro like "I'm using semantic search to...". Run the command silently and send the results as your whole reply.
- If `ok` is `false`, tell the user the `error` in plain words. If it says to run `build.py` or that the Python environment is missing, tell the user this search isn't set up yet.
- If the user then wants to narrow results by city, budget, or bedrooms, use `mls-integration` (`chat.ts`) with their message.
- Never build SQL yourself or pass user text anywhere except `--query`.

## Setup (once, from the terminal)

```bash
cd {baseDir}
python3 -m venv venv
venv/bin/pip install -r requirements.txt
venv/bin/python3 scripts/build.py
```

- `.env` in this folder holds `OPENAI_API_KEY`. The database login comes from `mls-integration/.env`.
- Run `build.py` again whenever listings change. It only embeds new or changed listings, so later runs are quick and cheap.
