'''
Hybrid scoring model that combines embedding level similarity scoring with structured similarity scoring to produce
comparable active listings based on a user's preferred lisiting. Cross referenced with california_sold pricing data
in recommend.ts
'''
import numpy as np
from pathlib import Path
import json
import sys


SKILL_DIR = Path(__file__).resolve().parent.parent
EMBEDDINGS = SKILL_DIR.parent / "semantic-search" / "embeddings" / "listings.json"
MODEL = 'text-embedding-3-small'

def fail(message: str) -> int:
    print(json.dumps({"ok": False, "error": message}))
    return 1


def load_embeddings(ids: set[str], path: Path = EMBEDDINGS) -> dict[str, list[float]]:
    if not path.exists():
        return {}
    listings = json.loads(path.read_text())
    if listings.get("model") != MODEL:
        return {}
    embeddings = {item['id']: item['embedding'] for item in listings['listings'] if item['id'] in ids}
    return embeddings

def cosine_similarity_score(a, b) -> float:
    a, b = np.array(a, dtype = np.float32), np.array(b, dtype = np.float32)
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    if denom == 0:
        return 0.0
    return float(a @ b / denom)

def calculate_similarity_score(
        target: dict,
        candidate: dict,
        target_emb: list[float] | None,
        candidate_emb: list[float] | None
) -> float:
    score = 0.0

    #Structured similarity 
    if target["L_SystemPrice"] is not None and candidate["L_SystemPrice"] is not None:
        price_diff = abs(target['L_SystemPrice'] - candidate['L_SystemPrice'])
        if price_diff < 50_000:
            score += 20
        elif price_diff < 150_000:
            score += 12
        elif price_diff < 300_000:
            score += 5

    if target['L_Keyword2'] is not None and target["L_Keyword2"] == candidate['L_Keyword2']:
        score += 15
    if target['L_City'] is not None and target['L_City'] == candidate['L_City']:
        score += 15

    if target["LM_Int2_3"] is not None and candidate["LM_Int2_3"] is not None:
        sqft_diff = abs(target['LM_Int2_3'] - candidate['LM_Int2_3'])
        if sqft_diff < 300:
            score += 10
        elif sqft_diff < 700:
            score += 5

    # Semantic similarity
    if target_emb is not None and candidate_emb is not None:
        sem_sim = cosine_similarity_score(
            target_emb,
            candidate_emb
        )
        score += sem_sim * 40

    return round(score, 2)

def rank_candidates(target: dict, candidates: list[dict], k: int = 5) -> tuple[list[dict], bool]:
    target_id = str(target['L_ListingID'])
    ids = {target_id} | {str(c['L_ListingID']) for c in candidates}
    embeddings = load_embeddings(ids)
    target_emb = embeddings.get(target_id)


    results = []
    for cand in candidates: 
        candidate_id = str(cand['L_ListingID'])
        if candidate_id == target_id:
            continue
        sim_score = calculate_similarity_score(target, cand, target_emb,
                                               embeddings.get(candidate_id))
        results.append({"id" : candidate_id, "score" : sim_score})

    sorted_results = sorted(results, key = lambda r : (-r['score'], r['id']))
    return sorted_results[:k], target_emb is not None

def main() -> int:
    try:
        data = json.loads(sys.stdin.read())
        results, used_embeddings = rank_candidates(data['target'], data['candidates'], data.get("k", 5))
    except json.JSONDecodeError:
        return fail("score.py expected JSON on stdin")
    except Exception as e:
        return fail(f"Scoring failed: {e}")
    print(json.dumps({"ok": True, "results": results, "usedEmbeddings": used_embeddings}))
    return 0



if __name__ == "__main__":
    sys.exit(main())