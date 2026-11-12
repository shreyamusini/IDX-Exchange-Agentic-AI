import argparse
import json
import os 
import sys

import numpy as np
from dotenv import load_dotenv
from openai import OpenAI
from build import MODEL, OUT, SKILL_DIR, embed_texts

def fail(message: str) -> int:
    print(json.dumps({"ok": False, "error": message}))
    return 1

def parse_args():
    p = argparse.ArgumentParser(description="Find listings similar to a description.")
    p.add_argument("--query", required = True, help = "the user's description")
    p.add_argument("--top", type = int, default = 15, help = "how many matches to return")
    return p.parse_args()

def load_embeddings(path):
    saved = json.loads(path.read_text())
    if saved["model"] != MODEL:
        raise ValueError(f"Embeddings were build with {saved['model']}, not {MODEL}.")
    ids = [l["id"] for l in saved["listings"]]
    matrix = np.array([l["embedding"] for l in saved["listings"]], dtype=np.float32)
    return ids, matrix, saved.get("built_at")

def top_matches(query_vec, ids, matrix, k):
    matrix = matrix / np.linalg.norm(matrix, axis = 1, keepdims = True)
    query_vec = query_vec / np.linalg.norm(query_vec)
    scores = matrix @ query_vec
    best = np.argsort(-scores)[:k]
    return [{"id": ids[i], "score":round(float(scores[i]), 4)} for i in best]

def main() -> int:
    args = parse_args()
    query = " ".join(args.query.split())[:2000]
    if not query:
        return fail("The description is empty. ASk the user what kind of home they want.")
    k = max(1, min(args.top, 50))

    load_dotenv(SKILL_DIR / ".env")
    if not os.environ.get("OPENAI_API_KEY"):
        return fail("OPENAI_API_KEY is missing from semantic-search/.env")
    if not OUT.exists():
        return fail("No embeddings yet. Run build.py first.")

    try:
        ids, matrix, build_at = load_embeddings(OUT)
        if len(ids) == 0:
            return fail("The embeddings file is empty. Check that rets_property has active listings, then run build.py.")
        vectors, _ = embed_texts(OpenAI(), [query])
        results = top_matches(np.array(vectors[0], dtype = np.float32), ids, matrix, k)
    except Exception as e:
        return fail(f"Search failed: {e}")
    print(json.dumps({"ok": True, "query" : query, "model" : MODEL, "built_at" : build_at, "results" : results}))
    return 0

if __name__ == "__main__":
    sys.exit(main())