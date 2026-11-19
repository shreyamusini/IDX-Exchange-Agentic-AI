---
name: rag-assistant
description: Answer questions about what real estate terms, MLS data fields, and market metrics mean, using indexed source documents (the Real Estate Data Analyst Primer, Trestle RESO field definitions, the IDX handbook's schema reference, and Week 5 market summaries) instead of general knowledge. Use for definition and "what is" questions, for example "What does DOM mean?", "What is a list-to-close ratio?", "What columns are in california_sold?", "What does L_Keyword2 mean?", or "What is escrow?". Cites the document each answer comes from, and says when the documents don't cover a question. Not for live numbers for a city such as median prices or trends (use market-analytics), and not for finding homes (use mls-integration or semantic-search).
metadata: { "openclaw": { "requires": { "bins": ["python3"] } } }
---

# RAG Assistant

Answers real estate and MLS data questions from source documents, not from memory. It finds the 4 passages in its document index most similar to the question, sends only those to the chat model with instructions to answer from them alone, and returns a short answer with its sources.

Indexed documents (in `docs/`):

| Source | Covers |
|---|---|
| Real Estate Data Analyst Primer | Terms and metrics: DOM, CDOM, sale-to-list (list-to-close) ratio, escrow, comps, MLS statuses |
| Trestle Property Metadata | RESO-standard field definitions (ClosePrice, LivingArea, StandardStatus, ...) |
| Schema Reference | Every column in `california_sold` and `rets_property`, including IDX's own names like L_SystemPrice and LM_Int2_3 |
| City Market Summary | Week 5 market summary by city from `california_sold` |

## When to use

The user asks what something **means** or how the data is **structured**:

- "What does DOM mean?" / "What's CDOM?"
- "What is a list-to-close ratio?"
- "What columns are in california_sold?" / "What does L_Keyword2 mean?"
- "What's the difference between ListPrice and OriginalListPrice?"
- "What is escrow?" / "What are comps?"

## When not to use

- Numbers for a specific place right now: "What's the list-to-close ratio in Pasadena?", "median price in Irvine" → `market-analytics`. Rule of thumb: "what *is* X" comes here; "what *is X in a city*" goes to `market-analytics`.
- Finding homes for sale or sold comps → `mls-integration`.
- Homes described by style → `semantic-search`; homes like a specific listing → `recommendations`.

## How to run

Pass the user's question, exactly as written:

```bash
{baseDir}/venv/bin/python3 {baseDir}/scripts/ask.py --question "<user's question>"
```

## Output

The script prints JSON:

- `ok`: `true`, or `false` with an `error` message.
- `message`: the finished reply, ending with the sources it used, like "(Sources: Real Estate Data Analyst Primer)". Send it to the user as is.
- `sources`: the documents the retrieved passages came from.
- `chunks`: each retrieved passage's source and similarity score, for checking why an answer came out the way it did.

If no passage is similar enough, `message` says the documents don't cover the question. That's a correct answer, not an error.

## Rules

- Run `ask.py` **once** per question, with the user's exact words.
- Reply with **only** `message`. Don't add an intro, name this skill, or add facts that aren't in it. The point of this skill is that answers come from the documents.
- If `message` says the documents don't cover the question, don't answer it from your own knowledge. You can say what this skill does cover (real estate terms, MLS fields, the market summaries).
- If the user follows up with a number for a specific city ("and what is it in Pasadena?"), use `market-analytics`.
- If `ok` is `false`, explain the `error` in plain words. If it says to run `build_index.py`, tell the user the document index isn't set up yet.

## Setup (once, from the terminal)

```bash
cd {baseDir}
python3 -m venv venv
venv/bin/pip install -r requirements.txt
venv/bin/python3 scripts/build_index.py
```

- `.env` in this folder holds `OPENAI_API_KEY`, and optionally `CHAT_MODEL` (defaults to `gpt-6-luna`).
- Run `build_index.py` again after adding or changing anything in `docs/`. It rebuilds the whole index, which takes a few seconds.
