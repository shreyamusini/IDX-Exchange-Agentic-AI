# IDX Exchange · Agentic MLS Assistant

A WhatsApp real estate assistant built on [OpenClaw](https://github.com/openclaw/openclaw). Users message it in plain English, it asks follow-up questions, remembers their answers, searches local MLS data for matching homes and recent sales, and answers market questions like "Is now a good time to buy in San Diego?" with numbers from closed sales.

```
User:  Find homes in Irvine
Agent: Got it: Irvine. What's your budget? For example, "under $1.2M".
User:  Under $1.2M
Agent: Got it: Irvine · under $1.2M. Any preferences — condo, townhome, or single family?
User:  Single family with at least 3 beds
Agent: 🔎 *4 homes* · Irvine · Single Family · 3+ bd · under $1.2M
       Showing 1–4 (page 1 of 1)

       *1. 7 Wilking Dr., Irvine 92620*
       💰 $1,128,888 · 3 bd · 3 ba · 1,672 sqft
       🏠 Single Family · Built 1979 · 46 days on market
       ✨ Fireplace · HOA $562/mo
       🔖 MLS# 1178201812 · Shelby Wu, Coldwell Banker Realty
       📸 28 photos
       ...
```

---

## How it works

```
WhatsApp ──▶ OpenClaw gateway ──▶ Coordinator agent (gpt-6-luna)
                                        │  picks a skill by its SKILL.md description
                                        ▼
                               mls-integration
                 ┌──────────────────────┴──────────────────────┐
         chat.ts (homes for sale)                 search.ts (sold comps)
                 │                                             │
   session.ts: load this user's answers                        │
   conversation.ts: read the message ◀── property_search parser (shared code)
   ask for what's missing, or search                           │
                 │                                             │
                 └──────────▶ queries.ts (parameterized SQL) ◀─┘
                                        │
                              MySQL: rets_property · california_sold
                                        │
                              format.ts: WhatsApp property cards
```

Market questions go to the second skill:

```
Coordinator agent ──▶ market-analytics: stats.ts
                              │
          question.ts: city, ZIP, and type (uses the property_search parser)
                              │
          market.ts: medians, year-over-year, monthly trend, inventory (parameterized SQL)
                              │
          analyze.ts: % changes, months of supply, buyer's/seller's market read
                              │
          format.ts: WhatsApp market report
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full workflow diagram and planned skills.

---

## Skills

| Skill (`name:`) | Folder | Job |
|---|---|---|
| `property-query-parser` | `skills/property_search/` | Translates a free-text request into structured filters (city, price, beds, baths, sqft, type, pool, view, HOA). Doesn't search. |
| `mls-integration` | `skills/mls-integration/` | Searches the MLS database and replies with property cards. `chat.ts` runs the multi-turn conversation for homes for sale; `search.ts` returns sold comps. |
| `market-analytics` | `skills/market-analytics/` | Answers market questions with numbers: median and average price, $/sqft, days on market, list-to-close ratio, year-over-year changes, a 12-month trend, inventory, and a buyer's or seller's market read. Doesn't list homes. |

Each skill owns one job, and its `SKILL.md` description says so. That's how the agent picks the right one without the skills competing for the same messages.

`mls-integration` imports the parser's code directly, and `market-analytics` uses both the parser and `mls-integration`'s database connection, so all three folders must sit side by side.

---

## Repository structure

```
.
├── README.md
├── docs/
│   └── ARCHITECTURE.md              Workflow diagram and planned skills
└── skills/
    ├── property_search/             Week 2: natural-language parser
    │   ├── SKILL.md
    │   ├── scripts/
    │   │   ├── parser.ts            parsePropertyQuery(), toDbFilters()
    │   │   └── parse.ts             Command-line entry point
    │   └── tests/parser.test.ts     17 tests
    └── mls-integration/             Weeks 3–4: database search and conversation
        ├── SKILL.md
        ├── scripts/
        │   ├── db.ts                MySQL connection pool, prepared statements
        │   ├── queries.ts           Safe SQL for rets_property and california_sold
        │   ├── format.ts            Clean result objects and WhatsApp cards
        │   ├── search.ts            One-off search and sold comps
        │   ├── session.ts           Per-user session memory, saved to disk
        │   ├── conversation.ts      Follow-up questions and refinement
        │   └── chat.ts              Conversation entry point
        └── tests/                   61 tests
    └── market-analytics/            Week 5: market stats
        ├── SKILL.md
        ├── scripts/
        │   ├── market.ts            SQL: stats with medians, inventory, top cities
        │   ├── analyze.ts           Date windows, % changes, trend, months of supply, market read
        │   ├── question.ts          Finds cities, ZIP, and property type in a question
        │   ├── report.ts            Runs the queries and builds one report
        │   ├── format.ts            WhatsApp messages
        │   └── stats.ts             Command-line entry point
        └── tests/                   31 tests
```

Not committed: `.env` files, `node_modules/`, and `skills/mls-integration/sessions/` (saved conversations).

---

## Tech stack

| Component | Tool |
|---|---|
| Agent framework | OpenClaw 2026.9.5, built from source with pnpm |
| Model | OpenAI `gpt-6-luna` |
| Channel | WhatsApp (linked device via QR code) |
| Database | MySQL `idx_exchange` with `rets_property` (active listings) and `california_sold` (sold homes) |
| Skills | TypeScript run directly with Node 22+ (`--experimental-strip-types`) and `mysql2` |

---

## Setup

### 1. OpenClaw

OpenClaw is a pnpm monorepo, so use pnpm, not npm:

```bash
git clone https://github.com/openclaw/openclaw.git
cd openclaw
pnpm install && pnpm ui:build && pnpm build
pnpm openclaw onboard
pnpm openclaw gateway install
```

Link WhatsApp with `pnpm openclaw channels login --channel whatsapp` and scan the QR code under **WhatsApp → Settings → Linked Devices**.

### 2. MySQL

Import both MLS datasets into a database named `idx_exchange`, then check:

```sql
USE idx_exchange;
SELECT COUNT(*) FROM rets_property;
SELECT COUNT(*) FROM california_sold;
```

### 3. Install the skills

Copy both skill folders into the agent's workspace, keeping the folder names:

```bash
cp -R skills/property_search skills/mls-integration skills/market-analytics ~/.openclaw/workspace/coordinator/skills/
cd ~/.openclaw/workspace/coordinator/skills/mls-integration
npm install
```

Create `mls-integration/.env` with your database login. The gateway doesn't see your terminal's environment variables, so the skill reads this file itself:

```
MYSQL_HOST=localhost
MYSQL_USER=idx_user
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=idx_exchange
```

Restart and confirm both skills are ready:

```bash
cd ~/openclaw
pnpm openclaw gateway restart
pnpm openclaw skills check --agent coordinator
```

`mls-integration`, `market-analytics`, and `property-query-parser` should be listed under "Ready and visible to model". `market-analytics` uses `mls-integration/.env`, so it needs no settings of its own.

---

## Usage

### On WhatsApp

| Say | What happens |
|---|---|
| "Find homes in Irvine" | Remembers the city, asks for a budget |
| "Under $1.2M", "900k", "no budget" | Remembers or skips the budget, asks for a property type |
| "condo", "single family with 3 beds", "any" | Remembers or skips the type, then searches |
| "3 bed condos in Tustin under 900k" | Has everything, so searches right away |
| "more" | Next page of results |
| "under $900k instead", "with a pool" | Changes or adds a filter and searches again |
| "what about Tustin?" | Changes only the city |
| "any type", "no budget" | Removes that filter |
| "start over" | Clears the search |
| "recent sales in Irvine" | Sold comps from `california_sold` |
| "Is now a good time to buy in San Diego?" | Market report: median price, $/sqft, days on market, list-to-close %, inventory, 12-month trend, and market read |
| "average price per sq ft in Pasadena" | Same report, for Pasadena |
| "Irvine vs Tustin condos" | Side-by-side comparison (up to 3 cities) |
| "condo market in 92618" | Report for a ZIP code |
| "what are the busiest markets?" | Cities ranked by sales (the handbook's City Market Summary) |

Send `/new` to start a fresh agent session (requires `commands.ownerAllowFrom` to include your WhatsApp number).

### From the terminal

Run these from `skills/mls-integration`:

```bash
# Conversation (each run is one message)
node --experimental-strip-types scripts/chat.ts --user test --message "Find homes in Irvine"
node --experimental-strip-types scripts/chat.ts --user test --message "Under \$1.2M"
node --experimental-strip-types scripts/chat.ts --user test --show-session

# Sold comps
node --experimental-strip-types scripts/search.ts --source sold --query "recent sales in Irvine"

# Week 3 single search, skipping the conversation
node --experimental-strip-types scripts/search.ts --one-shot --query "3 bed condos in Irvine under 1.5M with a pool"

# Market analytics (run from skills/market-analytics)
node --experimental-strip-types scripts/stats.ts --query "Is now a good time to buy in San Diego?"
node --experimental-strip-types scripts/stats.ts --city Irvine --type Condominium
node --experimental-strip-types scripts/stats.ts --top 10

# Parser only
node --experimental-strip-types ../property_search/scripts/parse.ts "3 bed condos in Irvine under 1.5M with a pool"
```

---

## Tests

```bash
cd skills/property_search && node --experimental-strip-types --test tests/parser.test.ts
cd skills/mls-integration && node --experimental-strip-types --test tests/*.test.ts
cd skills/market-analytics && node --experimental-strip-types --test tests/*.test.ts
```

| File | Covers |
|---|---|
| `property_search/tests/parser.test.ts` | 15 real-estate queries, including the handbook example, plus column mapping |
| `queries.test.ts` | Every filter becomes a `?` placeholder, injection attempts never reach the SQL text, pagination math |
| `format.test.ts` | Property cards, prices, dates, missing fields left out |
| `integration.test.ts` | Live MySQL: results match filters, totals match `COUNT(*)`, pages never repeat, sold comps stay in their time window. Skipped without `.env` |
| `conversation.test.ts` | The handbook conversation, short answers, skipping, "more", refining, "start over", duplicate calls |
| `session.test.ts` | Memory survives between separate runs, expiry, safe user IDs |
| `routing.test.ts` | Homes for sale always reach the conversation; sold comps don't |
| `market-analytics/tests/analyze.test.ts` | Date windows, % changes, gap-free trend, months of supply, market read |
| `market-analytics/tests/market.test.ts` | Placeholders match params, injection never reaches SQL, safe LIMIT, reading cities/ZIP/type from questions |
| `market-analytics/tests/format.test.ts` | Report, comparison, and ranking messages |
| `market-analytics/tests/integration.test.ts` | Live MySQL: SQL median equals a median computed in code, months add up to the year, windows don't overlap |

---

## Design notes

**Safe SQL.** Every user value is passed as a `?` placeholder through prepared statements. Column names and sort order are fixed in code. `sanitizeFilters()` drops unknown or invalid values before they reach the query builder. `LIMIT`/`OFFSET` are validated integers, since passing them as placeholders breaks on some MySQL 8 versions.

**Pagination.** Results sort by price, then by listing ID, so listings with the same price can't repeat or disappear between pages. A matching `COUNT(*)` gives "page 2 of 5".

**Data quirks.** The handbook assumed `PoolPrivateYN` holds `"True"`/`"False"`, but the real table stores `1` for yes and `NULL` for no. The query layer maps the parser's values to `1`, and "no pool" to `IS NULL OR = 0`. Without this, every pool search returned zero results.

**Session memory is saved to files.** The handbook keeps sessions in a `Map`, but OpenClaw starts the skill as a new process for every WhatsApp message, so a `Map` would be empty each time. `session.ts` keeps the handbook's `getSession`/`updateSession`/`clearSession` API and also saves each session to `sessions/<user>.json`. Sessions expire after 30 minutes. User IDs are sanitized so they can't write outside that folder.

**Not depending on the agent's choices.** The model sometimes ran two commands for one message, or used the Week 3 command out of habit. The skill handles both in code: `search.ts` sends home-for-sale requests into the same conversation as `chat.ts`, and an identical message from the same person within 2 minutes is ignored as a duplicate.

**Medians in SQL.** MySQL has no `MEDIAN()`, so `market.ts` numbers each group's rows with `ROW_NUMBER()` and averages the middle one or two. This needs MySQL 8 or newer. Reports lead with the median because a few luxury sales can pull an average far from the typical price.

**Complete months only.** The handbook query uses the last 12 months from today, which includes the current, unfinished month and makes it look like sales dropped. Stats use the last 12 months the data fully covers, based on the first and last `CloseDate` in `california_sold`, so a data export that starts or stops mid-month doesn't create fake dips. Year-over-year changes only appear when there's a full year of data before that.

**TypeScript instead of the handbook's Python.** The handbook's trend example uses pandas. The rest of the project is TypeScript run by Node, so `analyze.ts` does the same math (`pct_change()` becomes `momPct`) without adding a Python environment to the skill.

**Inventory coverage.** `rets_property` only covers some areas. When it has no rows at all for a city, the report says the listings data doesn't cover it, instead of reporting 0 homes for sale.

---

## Progress

| Week | Goal | Status |
|---|---|---|
| 1 | Install OpenClaw, import MLS data, link WhatsApp, architecture doc | ✅ |
| 2 | Parse free-text queries into structured filters (validated on 15 queries) | ✅ |
| 3 | Parameterized query layer for both MLS tables with pagination and property cards | ✅ |
| 4 | Multi-turn WhatsApp conversation with session memory and refinement | ✅ |
| 5 | Market analytics from `california_sold`: medians, DOM, list-to-close, trends, inventory | ✅ |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| A skill doesn't appear in `skills check` | `SKILL.md` must start with the `---` header containing `name:` and `description:` (spelled exactly) |
| `Cannot find module .../property_search/scripts/parser.ts` | Keep the `property_search` folder next to `mls-integration` |
| The agent answers from memory instead of searching | Send `/new`, or say "start over" |
| `Couldn't connect to MySQL` | `brew services start mysql`, then check `mls-integration/.env` |
| Market answers come from `mls-integration` | Check that `market-analytics` is in `skills check`, then send `/new` |
| `Market stats need MySQL 8 or newer` | Window functions are needed for medians. Check with `SELECT VERSION();` |
| No results for pool or view searches | Check the stored values with `SELECT DISTINCT PoolPrivateYN FROM rets_property;` and update `YES` in `queries.ts` if needed |
