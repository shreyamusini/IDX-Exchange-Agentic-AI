# IDX Exchange · Agentic MLS Assistant

A WhatsApp real estate assistant built on [OpenClaw](https://github.com/openclaw/openclaw). Users message it in plain English, and one coordinator agent picks the right skill for each message:

- **Find homes** through a conversation that asks follow-up questions and remembers the answers
- **Search by description**: "charming craftsman with mountain views" finds listings by meaning, not keywords
- **Recommend similar homes** to one the user likes, with a price check against recent sales
- **Answer market questions** like "Is now a good time to buy in San Diego?" with numbers from closed sales
- **Explain terms and data fields** like "What does DOM mean?" from source documents, with citations

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

User:  What is a list-to-close ratio?
Agent: A *list-to-close ratio* is the ClosePrice divided by the ListPrice. It's also called the
       *sale-to-list ratio*: above 1.0 means the property sold above asking, while below 1.0 means
       it sold below asking. (Sources: Real Estate Data Analyst Primer)
```

---

## How it works

```
WhatsApp ──▶ OpenClaw gateway ──▶ Coordinator agent (gpt-6-luna)
                                        │  picks a skill by its SKILL.md description
     ┌──────────────┬─────────────────┼──────────────────┬──────────────────┐
     ▼              ▼                 ▼                  ▼                  ▼
mls-integration  semantic-search  recommendations  market-analytics   rag-assistant
 find homes,      search by         homes like one    market numbers    what terms and
 sold comps       description       listing + price   for a city        fields mean
                                    check
     │              │                 │                  │                  │
     └──────────────┴────────┬────────┴──────────────────┘                  │
                             ▼                                              ▼
              MySQL: rets_property · california_sold             indexed documents
```

| The user asks… | Skill |
|---|---|
| "3 bed condos in Irvine under $1M", "more", "start over" | `mls-integration` |
| "Something like a cozy beach cottage" | `semantic-search` |
| "Homes like 350 S Fairway Dr", "more like MLS# 1118353294" | `recommendations` |
| "What's the list-to-close ratio in Pasadena?" | `market-analytics` |
| "What *is* a list-to-close ratio?" | `rag-assistant` |

Each skill's `SKILL.md` description says what it's for and which skill handles the neighboring cases, so the skills don't compete for the same messages.

### mls-integration (Weeks 3–4)

```
         chat.ts (homes for sale)                 search.ts (sold comps)
                 │                                             │
   session.ts: load this user's answers                        │
   conversation.ts: read the message ◀── property_search parser (shared code)
   ask for what's missing, or search                           │
                 │                                             │
                 └──────────▶ queries.ts (parameterized SQL) ◀─┘
                                        │
                              format.ts: WhatsApp property cards
```

### market-analytics (Week 5)

```
stats.ts ─▶ question.ts: city, ZIP, type (uses the parser)
         ─▶ market.ts: medians, year-over-year, monthly trend, inventory (SQL)
         ─▶ analyze.ts: % changes, months of supply, buyer's/seller's market read
         ─▶ format.ts: WhatsApp market report
```

### semantic-search (Week 6)

```
build.py (once):  active listings ─▶ text per listing ─▶ OpenAI embeddings (batched) ─▶ embeddings/listings.json

search.ts ─▶ similar.py: embed the description, cosine similarity against every listing ─▶ top matches
          ─▶ db.ts: keep the ones still Active ─▶ format.ts: top 5 property cards with match scores
```

### recommendations (Week 7)

```
recommend.ts ─▶ queries.ts: find the target listing (MLS number or address), then active candidates
             ─▶ score.py: hybrid score = structured (price, beds, city, sqft: 60 pts) + embedding (40 pts)
             ─▶ queries.ts: comps from california_sold for each of the top 5
             ─▶ assess.ts: comp price and % above/below ─▶ format.ts: cards + price check
```

### rag-assistant (Week 8)

```
build_index.py (once):  docs/ ─▶ text ─▶ 600-character chunks ─▶ OpenAI embeddings ─▶ index/index.json

ask.py ─▶ embed the question ─▶ 4 most similar chunks
       ─▶ chat model: "answer only from these passages, and cite them" ─▶ answer with sources
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the original Week 1 workflow diagram.

---

## Skills

| Skill (`name:`) | Folder | Job |
|---|---|---|
| `property-query-parser` | `skills/property_search/` | Translates a free-text request into structured filters (city, price, beds, baths, sqft, type, pool, view, HOA). Doesn't search. |
| `mls-integration` | `skills/mls-integration/` | Searches the MLS database and replies with property cards. `chat.ts` runs the multi-turn conversation for homes for sale; `search.ts` returns sold comps. |
| `market-analytics` | `skills/market-analytics/` | Market numbers for a city or ZIP: median and average price, $/sqft, days on market, list-to-close ratio, year-over-year changes, a monthly trend, inventory, and a buyer's or seller's market read. |
| `semantic-search` | `skills/semantic-search/` | Finds the 5 active listings whose descriptions are most similar in meaning to what the user describes. |
| `recommendations` | `skills/recommendations/` | Given a listing the user likes, finds the 5 most similar active listings and checks each price against recent comparable sales. |
| `rag-assistant` | `skills/rag-assistant/` | Answers what real estate terms, MLS fields, and table columns mean, from indexed source documents, with citations. |

**Shared code.** Several skills reuse each other's code instead of copying it, so all six folders must sit side by side in `skills/`:

| Skill | Uses |
|---|---|
| `mls-integration` | the parser from `property_search` |
| `market-analytics` | the parser, and `mls-integration`'s database connection (`db.ts` and its `.env`) |
| `semantic-search` | `mls-integration`'s database connection, column list, and property cards |
| `recommendations` | `mls-integration`'s connection and cards, `market-analytics`' date windows, and `semantic-search`'s saved embeddings |

---

## Repository structure

```
.
├── README.md
├── docs/
│   └── ARCHITECTURE.md                  Week 1 workflow diagram
└── skills/
    ├── property_search/                 Week 2: natural-language parser
    │   ├── SKILL.md
    │   ├── scripts/
    │   │   ├── parser.ts                parsePropertyQuery(), toDbFilters()
    │   │   └── parse.ts                 Command-line entry point
    │   └── tests/                       17 tests
    ├── mls-integration/                 Weeks 3–4: database search and conversation
    │   ├── SKILL.md
    │   ├── scripts/
    │   │   ├── db.ts                    MySQL connection pool, prepared statements
    │   │   ├── queries.ts               Safe SQL for rets_property and california_sold
    │   │   ├── format.ts                Clean result objects and WhatsApp cards
    │   │   ├── search.ts                One-off search and sold comps
    │   │   ├── session.ts               Per-user session memory, saved to disk
    │   │   ├── conversation.ts          Follow-up questions and refinement
    │   │   └── chat.ts                  Conversation entry point
    │   └── tests/                       61 tests
    ├── market-analytics/                Week 5: market stats
    │   ├── SKILL.md
    │   ├── scripts/
    │   │   ├── market.ts                SQL: stats with medians, inventory, top cities
    │   │   ├── analyze.ts               Date windows, % changes, trend, months of supply, market read
    │   │   ├── question.ts              Finds cities, ZIP, and property type in a question
    │   │   ├── report.ts                Runs the queries and builds one report
    │   │   ├── format.ts                WhatsApp messages
    │   │   └── stats.ts                 Command-line entry point
    │   └── tests/                       31 tests
    ├── semantic-search/                 Week 6: embedding similarity search
    │   ├── SKILL.md
    │   ├── requirements.txt
    │   ├── scripts/
    │   │   ├── build.py                 Python: embeds every active listing (skips unchanged ones)
    │   │   ├── similar.py               Python: cosine similarity, returns the top matches as JSON
    │   │   └── search.ts                Entry point: runs similar.py, then db.ts and format.ts
    │   └── tests/                       38 tests (29 Python, 9 TypeScript)
    ├── recommendations/                 Week 7: hybrid recommendations with comp validation
    │   ├── SKILL.md
    │   ├── requirements.txt
    │   ├── scripts/
    │   │   ├── score.py                 Python: hybrid similarity score and ranking
    │   │   ├── queries.ts               Target listing, candidates, and comps (SQL)
    │   │   ├── assess.ts                Comp price, % above/below, confidence
    │   │   ├── format.ts                Cards with similarity and price-check lines
    │   │   └── recommend.ts             Entry point: connects the steps
    │   └── tests/                       60 tests (24 Python, 36 TypeScript)
    └── rag-assistant/                   Week 8: document-grounded Q&A
        ├── SKILL.md
        ├── requirements.txt
        ├── docs/                        Source documents (Primer, Trestle, schema reference, market summary)
        ├── scripts/
        │   ├── build_index.py           Reads docs, chunks, embeds, saves the index
        │   └── ask.py                   Retrieves the best chunks and writes a grounded answer
        └── tests/                       33 tests
```

Not committed: `.env` files, `node_modules/`, `venv/`, `__pycache__/`, `skills/mls-integration/sessions/` (saved conversations), `skills/semantic-search/embeddings/`, and `skills/rag-assistant/index/`. The last two are rebuilt by `build.py` and `build_index.py`.

---

## Tech stack

| Component | Tool |
|---|---|
| Agent framework | OpenClaw 2026.9.5, built from source with pnpm |
| Agent model | OpenAI `gpt-6-luna` |
| Channel | WhatsApp (linked device via QR code) |
| Database | MySQL `idx_exchange` with `rets_property` (active listings) and `california_sold` (sold homes) |
| Database and formatting skills | TypeScript run directly with Node 22+ (`--experimental-strip-types`) and `mysql2` |
| Embeddings and similarity | Python 3 with `openai`, `numpy`, `python-dotenv`; embeddings from `text-embedding-3-small` |
| RAG answers | OpenAI chat model (`CHAT_MODEL` in `rag-assistant/.env`, default `gpt-6-luna`); `pypdf` for reading PDFs |

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

### 3. Settings files

The gateway doesn't see your terminal's environment variables, so each skill reads its own `.env` file. None of them are committed.

| File | Contents | Used by |
|---|---|---|
| `mls-integration/.env` | `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` | every skill that reads the database |
| `semantic-search/.env` | `OPENAI_API_KEY` | `build.py`, `similar.py` |
| `rag-assistant/.env` | `OPENAI_API_KEY`, optional `CHAT_MODEL` | `build_index.py`, `ask.py` |

```
MYSQL_HOST=localhost
MYSQL_USER=idx_user
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=idx_exchange
```

### 4. Install the skills

Copy the skill folders into the agent's workspace, keeping the folder names. Leave out `venv` and `node_modules`: a Python venv only works in the folder where it was created, so each one is made fresh in the new location.

```bash
cd skills
rsync -a --exclude venv --exclude node_modules --exclude __pycache__ \
  property_search mls-integration market-analytics semantic-search recommendations rag-assistant \
  ~/.openclaw/workspace/coordinator/skills/
cd ~/.openclaw/workspace/coordinator/skills
```

Then install each skill's packages:

```bash
(cd mls-integration && npm install)

# Python skills: one venv each
for s in semantic-search recommendations rag-assistant; do
  (cd $s && python3 -m venv venv && venv/bin/pip install -r requirements.txt)
done
(cd semantic-search && npm install)
(cd recommendations && npm install)
```

Build the two indexes. Each is a one-time run, repeated when the data or documents change:

```bash
(cd semantic-search && venv/bin/python3 scripts/build.py)        # embeds active listings; later runs only embed changes
(cd rag-assistant && venv/bin/python3 scripts/build_index.py)    # embeds the documents in docs/
```

Restart and confirm the skills are ready:

```bash
cd ~/openclaw
pnpm openclaw gateway restart
pnpm openclaw skills check --agent coordinator
```

All six should be listed under "Ready and visible to model". Then send `/new` on WhatsApp to start a session that knows about them.

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
| "Is now a good time to buy in San Diego?" | Market report: median price, $/sqft, days on market, list-to-close %, inventory, monthly trend, and market read |
| "Irvine vs Tustin condos" | Side-by-side market comparison (up to 3 cities) |
| "what are the busiest markets?" | Cities ranked by sales (the handbook's City Market Summary) |
| "charming craftsman with mountain views and character" | Top 5 listings by meaning, with match scores |
| "Show me homes like 350 S Fairway Dr" | Top 5 similar active listings, each with a similarity score and a price check |
| "More like Fiorino Street" | Several matches, so it asks which one, then recommends for the chosen MLS number |
| "What does DOM mean?", "What columns are in california_sold?" | An answer from the source documents, with the source named |
| "Who won the World Series?" | "My documents don't cover that" |

Send `/new` to start a fresh agent session (requires `commands.ownerAllowFrom` to include your WhatsApp number). You can also chat in the browser with `pnpm openclaw dashboard`.

### From the terminal

```bash
# mls-integration: conversation (each run is one message)
node --experimental-strip-types scripts/chat.ts --user test --message "Find homes in Irvine"
node --experimental-strip-types scripts/search.ts --source sold --query "recent sales in Irvine"

# market-analytics
node --experimental-strip-types scripts/stats.ts --query "Is now a good time to buy in San Diego?"
node --experimental-strip-types scripts/stats.ts --top 10

# semantic-search
venv/bin/python3 scripts/similar.py --query "charming craftsman with mountain views" --top 5
node --experimental-strip-types scripts/search.ts --query "charming craftsman with mountain views"

# recommendations
node --experimental-strip-types scripts/recommend.ts --listing "1118353294"
node --experimental-strip-types scripts/recommend.ts --listing "350 S Fairway Dr"

# rag-assistant
venv/bin/python3 scripts/ask.py --question "What is a list-to-close ratio?"

# Parser only (from skills/mls-integration)
node --experimental-strip-types ../property_search/scripts/parse.ts "3 bed condos in Irvine under 1.5M with a pool"
```

Run each from its own skill folder.

---

## Tests

```bash
cd skills/property_search  && node --experimental-strip-types --test tests/parser.test.ts
cd skills/mls-integration  && node --experimental-strip-types --test tests/*.test.ts
cd skills/market-analytics && node --experimental-strip-types --test tests/*.test.ts
cd skills/semantic-search  && venv/bin/python3 -m unittest discover -s tests && node --experimental-strip-types --test tests/search.test.ts
cd skills/recommendations  && venv/bin/python3 -m unittest discover -s tests && node --experimental-strip-types --test tests/*.test.ts
cd skills/rag-assistant    && venv/bin/python3 -m unittest discover -s tests
```

No test calls OpenAI: fake clients stand in for the API, so the tests cost nothing to run. Tests that need MySQL are skipped without `mls-integration/.env`, and tests that need a Python venv are skipped without one.

| Skill | Tests cover |
|---|---|
| `property_search` | 15 real-estate queries, including the handbook example, plus column mapping |
| `mls-integration` | Every filter becomes a `?` placeholder, injection attempts never reach the SQL; property cards; live MySQL results match filters and pages never repeat; the handbook conversation, refining, "start over", duplicate calls; session memory and expiry; routing between commands |
| `market-analytics` | Date windows, % changes, gap-free trend, months of supply, market read; safe SQL and LIMIT; reading cities, ZIP, and type; messages; live MySQL: the SQL median equals one computed in code |
| `semantic-search` | Listing text with missing fields; reusing unchanged embeddings; batching and order; cosine ranking; the JSON `similar.py` prints for every error; the user's text reaching Python as one safe argument; live MySQL: similarity order kept and sold listings dropped |
| `recommendations` | Every price and sqft scoring tier; missing values; the target never recommended; comp price, above/below/in line, the ±5% edge, low confidence, no divide-by-zero; message wording; live MySQL: finding by MLS number and address, candidates active and in range, comp counts matching direct SQL, the full command end to end |
| `rag-assistant` | Reading PDFs and text, chunk size and overlap, chunks labeled with their source, batching; cosine retrieval and `top_k`; the grounding rules in the prompt; the numbered, sourced context; an unrelated question skipping the chat model; every error path |

---

## Design notes

**Safe SQL.** Every user value is passed as a `?` placeholder through prepared statements. Column names and sort order are fixed in code. `sanitizeFilters()` drops unknown or invalid values before they reach the query builder. `LIMIT`/`OFFSET` are validated integers, since passing them as placeholders breaks on some MySQL 8 versions. The user's text reaches Python scripts as a single program argument (`execFile`, no shell) or as JSON on stdin, so it can't become a command.

**Pagination.** Results sort by price, then by listing ID, so listings with the same price can't repeat or disappear between pages. A matching `COUNT(*)` gives "page 2 of 5".

**Data quirks.** The handbook assumed `PoolPrivateYN` holds `"True"`/`"False"`, but the real table stores `1` for yes and `NULL` for no. The query layer maps the parser's values to `1`, and "no pool" to `IS NULL OR = 0`. Without this, every pool search returned zero results.

**Session memory is saved to files.** OpenClaw starts the skill as a new process for every WhatsApp message, so the handbook's in-memory `Map` would be empty each time. `session.ts` keeps the handbook's `getSession`/`updateSession`/`clearSession` API and also saves each session to `sessions/<user>.json`. Sessions expire after 30 minutes. User IDs are sanitized so they can't write outside that folder.

**Not depending on the agent's choices.** The model sometimes ran two commands for one message, or used an older command out of habit. The skills handle both in code: `search.ts` sends home-for-sale requests into the same conversation as `chat.ts`, and an identical message from the same person within 2 minutes is ignored as a duplicate.

**Medians in SQL.** MySQL has no `MEDIAN()`, so `market.ts` numbers each group's rows with `ROW_NUMBER()` and averages the middle one or two. Reports lead with the median because a few luxury sales can pull an average far from the typical price.

**Complete months only.** "The last 12 months from today" includes the current, unfinished month and makes it look like sales dropped. Market stats and comp checks use the months the data fully covers, based on the first and last `CloseDate` in `california_sold`, so a data export that starts or stops mid-month doesn't create fake dips. Year-over-year changes only appear when there's a full year of data before that.

**Embeddings are built once, not per search.** The handbook embeds listings at search time, one API call each. `build.py` embeds every active listing in batches of 100 and saves them, and stores a fingerprint of each listing's text so later runs only re-embed new or changed listings. A search then needs one API call, for the user's description.

**Cosine similarity with numpy.** OpenAI's embeddings are compared by scaling each vector to length 1 and taking dot products, all listings at once in one matrix multiplication, instead of calling scikit-learn once per listing. That avoids a large extra dependency for a few lines of math.

**Python for the AI math, TypeScript for the database and messages.** The handbook's embedding and scoring examples are Python, so those parts stay in Python. The database queries and WhatsApp cards already existed in TypeScript, so those are reused rather than rewritten. The TypeScript entry point runs the Python script and exchanges JSON with it.

**Hybrid recommendations.** `score.py` keeps the handbook's weights: up to 60 points for matching price, bedrooms, city, and size, and up to 40 for description similarity. A missing value scores 0 for that part instead of crashing, and two missing values don't count as a match. SQL first narrows the pool to active listings of the same type within half to 1.5× the price (at most 200), so the scoring stays fast.

**Comp-validated prices.** Comps are sales in the same city and property type, within ±20% of the listing's size, in the last 6 complete months of data. The comp price is their average $/sqft times the listing's size. Within ±5% counts as in line; fewer than 3 comps is flagged as low confidence; no comps says so instead of dividing by zero.

**Grounded RAG answers.** Each passage sent to the chat model is numbered and labeled with its source, and the system prompt says to answer only from those passages, cite them, and say when they don't cover the question. If even the best passage scores below 0.25 similarity, the chat model isn't called at all. In testing, real questions scored 0.55–0.71 and an unrelated one 0.17.

**Same idea, different names.** The handbook asks about the "list-to-close ratio", but the Primer calls it the "sale-to-list ratio". Embeddings matched them by meaning, and the system prompt tells the model the two names mean the same thing, so the answer uses the Primer's definition and mentions both names.

**The schema reference as a fourth RAG source.** `california_sold` uses RESO-standard names covered by the Trestle documentation, but `rets_property`'s core fields (`L_SystemPrice`, `L_Keyword2`, `LM_Int2_3`, ...) use IDX's own names. The handbook's schema table is indexed as `docs/schema_reference.md`, with each column on one line prefixed by its table name, so a chunk cut from the middle of the table still says which table it's from.

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
| 6 | Semantic property search with OpenAI embeddings and cosine similarity | ✅ |
| 7 | Hybrid recommendation engine with comp-validated price assessments | ✅ |
| 8 | Document-aware RAG assistant for real estate terms and MLS fields | ✅ |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| A skill doesn't appear in `skills check` | `SKILL.md` must start with the `---` header containing `name:` and `description:` (spelled exactly) |
| Part of a `SKILL.md` description is ignored or grayed out | In the header, a space followed by `#` starts a YAML comment. Reword it (for example "the second one" instead of "#2") |
| `Cannot find module .../property_search/scripts/parser.ts` | Keep all skill folders side by side in the same `skills` folder |
| The agent answers from memory instead of running a skill | Send `/new`, or say "start over" |
| The wrong skill answers | Check the skill is in `skills check`, then send `/new` so the agent rereads the descriptions |
| `Couldn't connect to MySQL` | `brew services start mysql`, then check `mls-integration/.env` |
| `ModuleNotFoundError` in a Python script | You ran plain `python3` (for example conda's). Use the skill's own `venv/bin/python3` |
| `venv/bin/python3: no such file` | Create the venv in that skill folder: `python3 -m venv venv && venv/bin/pip install -r requirements.txt`. Don't copy a venv from another folder |
| "Run build.py first" or "Run build_index.py first" | The embeddings or document index haven't been built in that copy of the skill yet |
| Chat model error about `temperature` | Some models only accept the default temperature; don't pass one |
| `Ignoring wrong pointing object` when building the RAG index | A harmless `pypdf` warning about a slightly malformed PDF; the text is still read |
| Gateway restart fails with "Cannot verify a live serving Gateway owner" | The gateway is stopped. Use `pnpm openclaw gateway start` |
| `Repository dependencies are missing` from OpenClaw | Run `pnpm install --frozen-lockfile` and `pnpm build` in `~/openclaw` |
| `Market stats need MySQL 8 or newer` | Window functions are needed for medians. Check with `SELECT VERSION();` |
| No results for pool or view searches | Check the stored values with `SELECT DISTINCT PoolPrivateYN FROM rets_property;` and update `YES` in `queries.ts` if needed |
