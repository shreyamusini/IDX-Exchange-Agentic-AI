from openai import OpenAI
import mysql.connector
import hashlib, json

from pathlib import Path
from dotenv import load_dotenv
from datetime import datetime, timezone

import sys, os

SKILL_DIR = Path(__file__).resolve().parent.parent
OUT = SKILL_DIR / "embeddings" / "listings.json"
MODEL = "text-embedding-3-small"

TYPE_LABELS = {
    "SingleFamilyResidence": "Single family home", 
    "Condominium" : "Condo",
    "Townhouse" : "Townhome",
    "UnimprovedLand" : "Land"
}

def load_settings():
    load_dotenv(SKILL_DIR.parent / "mls-integration" / ".env")
    load_dotenv(SKILL_DIR / ".env")

def fetch_active_listings():
    conn = mysql.connector.connect(
        host = os.environ["MYSQL_HOST"], 
        user = os.environ["MYSQL_USER"],
        password = os.environ["MYSQL_PASSWORD"],
        database = os.environ["MYSQL_DATABASE"]
    )
    try:
        cur = conn.cursor(dictionary = True)

        cur.execute("""
        SELECT L_ListingID, L_Type_, L_City, L_Keyword2, LM_Dec_3, LM_Int2_3,
            YearBuilt, L_SystemPrice, L_Remarks
        FROM rets_property
        WHERE L_Status = %s
        """, ("Active",))
        return cur.fetchall()
    finally:
        conn.close()


def listing_text(row: dict) -> str:
    parts = []
    kind = TYPE_LABELS.get(row["L_Type_"], row["L_Type_"] or "Home")
    parts.append(f"{kind} in {row['L_City']}, CA." if row["L_City"] else f"{kind}.")
    if row["L_Keyword2"]: parts.append(f"{row['L_Keyword2']} beds.")
    if row["LM_Dec_3"]:   parts.append(f"{float(row['LM_Dec_3']):g} baths.")
    if row["LM_Int2_3"]:  parts.append(f"{int(row['LM_Int2_3']):,} sq ft.")
    if row["YearBuilt"]:  parts.append(f"Built {row['YearBuilt']}.")
    if row["L_SystemPrice"]: parts.append(f"Price: ${int(row['L_SystemPrice']):,}.")
    if row["L_Remarks"]:  parts.append(row["L_Remarks"])
    return " ".join(" ".join(parts).split())[:8000]


def load_previous(path: Path) -> dict:
    if not path.exists():
        return {}
    saved = json.loads(path.read_text())
    if saved["model"] != MODEL:
        return {}
    return {l["id"]: l for l in saved['listings']}


def split_changed(rows, old_em):
    todo, keep = [], []
    for row in rows:
        text = listing_text(row)
        h = hashlib.sha256(text.encode()).hexdigest()
        prev = old_em.get(str(row["L_ListingID"]))
        if prev and prev["hash"] == h:
            keep.append(prev)
        else:
            todo.append({"id": str(row["L_ListingID"]), "hash" : h, "text" : text})
    return keep, todo

def embed_texts(client, texts: list[str], model: str = MODEL, batch_size: int = 100) -> tuple[list[list[float]], int]:
    tokens = 0
    embeddings: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        embed = client.embeddings.create(model=model, input = batch)
        embeddings.extend(item.embedding for item in sorted(embed.data, key = lambda d: d.index))
        tokens += embed.usage.total_tokens
        print(f"Embedded {min(i + batch_size, len(texts))} / {len(texts)}", file=sys.stderr)
    return embeddings, tokens

def save(listings: list[dict], path:Path):
    listings = [{"id": t["id"], "hash": t["hash"], "embedding": t["embedding"]} for t in listings]
    path.parent.mkdir(parents = True, exist_ok = True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({
        "model":MODEL,
        "built_at": datetime.now(timezone.utc).isoformat(),
        "listings": listings
    }))
    tmp.replace(path)

def main():
    load_settings()
    rows = fetch_active_listings()
    old_emb = load_previous(OUT)
    keep, todo = split_changed(rows, old_emb)

    vectors, tokens = embed_texts(OpenAI(), [t["text"] for t in todo])
    for t, vec in zip(todo, vectors):
        t["embedding"] = vec

    save(keep + todo, OUT)
    print(f"Done: {len(todo)} embedded, {len(keep)} reused, "
      f"{len(old_emb) - len(keep)} removed, {tokens:,} tokens used")

if __name__ == "__main__":
    main()