---
name: mls-integration
description: Search MLS data and reply with formatted property cards. Holds a multi-turn WhatsApp conversation that asks follow-up questions (city, budget, property type), remembers each person's answers, and returns active listings from rets_property with address, price, beds/baths, and photo count. Also finds recent sold comps in california_sold. Use for any request to find or list homes for sale or individual recent sales, including short follow-up answers like "Under $1.2M", "condo", "more", or "start over". Not for market statistics such as median prices, price per square foot, trends, or "is it a good time to buy"; use market-analytics for those.
metadata: { "openclaw": { "requires": { "bins": ["node"] } } }
---

# MLS Integration

Turns a user's property request into a safe database search and returns WhatsApp-ready property cards. It reads requests with the parser code from the `property_search` folder, so that folder must be installed next to this one in the same `skills` folder.

It has two commands:

| Command | Week | Use for |
|---|---|---|
| `chat.ts` | 4 | **All** home-for-sale messages: asks follow-up questions, remembers answers, refines results |
| `search.ts` | 3 | Sold homes and comps. Home-for-sale requests sent here are passed to the same conversation as `chat.ts` |

**Which command to use:**

- The user asks about homes **for sale**, or replies to a question `chat.ts` asked → **always `chat.ts`**. This includes the first message, even one that looks complete like "Find homes in Irvine" or "3 bed condos in Tustin under 900k". `chat.ts` searches right away when it has enough, and asks follow-up questions when it doesn't.
- The user asks what homes **sold** for, recent sales, or comps → `search.ts --source sold`.
- The user asks about the **market** (median or average prices, price per sq ft, trends, "is it a good time to buy?") → not this skill; use `market-analytics`.
- Prefer `chat.ts` for homes for sale. If `search.ts` receives a home-for-sale request, it passes it to the same conversation, so the user still gets follow-up questions. Never call the `property-query-parser` skill directly. Both commands already use the parser.

**How `chat.ts` works:** each message goes through the same steps. It loads what the person said before, reads the new message with the parser, asks for anything still missing (city, then budget, then property type), and runs the MLS search once it has enough. You don't need to call `property-query-parser` first.

---

## Conversation (`chat.ts`)

### When to use

Use `chat.ts` for **every** message in a WhatsApp home search, from the first request to the last follow-up:

- Starting a search: "Find homes in Irvine", "I'm looking for a condo"
- Answering a question the skill asked: "Under $1.2M", "Irvine", "single family with 3 beds", "any"
- Refining results: "only ones with a pool", "under $900k instead", "what about Tustin?", "any type"
- Paging and resetting: "more", "start over"

Short replies like "condo" or "1.2M" only make sense together with earlier messages. Always send them to `chat.ts` rather than answering yourself.

### How to run

```bash
node --experimental-strip-types {baseDir}/scripts/chat.ts --user "<sender ID>" --message "<the user's message>"
```

- `--user`: the sender's WhatsApp number or chat ID, for example `+14085551234`. Use **the same value for every message from the same person**, and for both commands, because that's how the skill finds their saved answers. If you don't know the sender's ID, leave it out; both commands then use `whatsapp-default`.
- `--message`: the user's message, exactly as they wrote it.

To see what's saved for someone: `--user "<sender ID>" --show-session`.

### Output

The script prints JSON:

- `ok`: `true`, or `false` with an `error` message.
- `reply`: the message to send back. This is either the next question or the search results.
- `step`: 1 = asking for a city, 2 = asking for a budget, 3 = asking for a property type, 4 = showing results.
- `filters`: everything remembered so far.
- `results`, `total`, `page`, and `totalPages`: included when a search ran.

---

## Sold comps (`search.ts`)

### When to use

Only for questions about homes that already sold:

- "what have 3 bedroom homes sold for in Tustin?"
- "recent sales in Orange"
- "show me comps for condos in Irvine"

### How to run

Pass the user's message, exactly as written, and always include `--source sold`:

```bash
node --experimental-strip-types {baseDir}/scripts/search.ts --source sold --query "<user's request>"
```

Sold comps need a city. If the user didn't give one, ask which city before running the command.

Options:

| Option | Use |
|---|---|
| `--source sold` | Recent sales from `california_sold`. Always include it for sold questions. |
| `--user <id>` | Same as for `chat.ts`. Used when a home-for-sale request is passed to the conversation. |
| `--one-shot` | Skip the conversation and return a single list of homes for sale (the Week 3 behavior). For scripts and testing, not WhatsApp. |
| `--page N` | Page of results, starting at 1 |
| `--limit N` | Results per page, 1-25 (default 10) |
| `--months N` | How far back to look for sales, 1-60 (default 12) |
| `--filters '<JSON>'` | Use filters directly instead of `--query`, for example the `filters` object from `property-query-parser`. Can be combined with `--query`; JSON values win. |

### Output

The script prints JSON:

- `ok`: `true`, or `false` with an `error` message.
- `message`: the finished WhatsApp reply with a summary line and numbered property cards. Send it to the user as is.
- `filters` and `summary`: the filters that were applied.
- `sold`: `total`, `page`, `totalPages`, `hasMore`, and `results`, a list of clean objects (sale price, sale date, beds, baths, address, and so on) for any follow-up work.

### Paging

- When the user replies "more", "next", or similar right after **sold** results, run the same `search.ts` command again with `--page` increased by 1.
- When the user changes the sold search (a new city or feature), run it again starting from page 1.
- "more" after homes-for-sale results goes to `chat.ts`, like every other conversation message. Send "more" to whichever command showed the last results.

---

## Rules

- Run `chat.ts` for **every** home-search message, even if earlier messages in this chat already showed listings, or you think you already know the answer. Never answer a home search from memory or from earlier results in the chat. The skill keeps track of what has been shown.
- Run **one** command, **once**, for each message the user sends, using their exact words. Don't run both `chat.ts` and `search.ts` for the same message, and never send the skill words the user didn't write, such as "any" to skip a question. Wait for the user's reply.
- Send `reply` (from `chat.ts`) or `message` (from `search.ts`) to the user exactly as returned. Don't rewrite property details, and never invent listings, prices, or addresses.
- Don't ask the conversation's follow-up questions yourself, and don't search for homes for sale any other way. `chat.ts` asks the questions and tracks the answers.
- If `ok` is `false`, tell the user the `error` in plain words. If `search.ts` says it needs a city, ask the user which city.
- Never build SQL yourself or pass user text anywhere except `--message` or `--query`. The scripts handle all database access with parameterized queries.
- Conversations are forgotten after 30 minutes without messages, or when the user says "start over".
