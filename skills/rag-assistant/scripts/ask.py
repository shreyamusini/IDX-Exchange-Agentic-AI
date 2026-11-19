from build_index import SKILL_DIR, INDEX_FILE, EMBED_MODEL, embed_texts
from dotenv import load_dotenv
import os, json, sys
import argparse
from pathlib import Path
import numpy as np
from openai import OpenAI

CHAT_MODEL = os.environ.get("CHAT_MODEL", "gpt-6-luna")
TOP_K = 4
MIN_SCORE = 0.25

SYSTEM_PROMPT = (
    "You answer questions about real estate terms, MLS data fields, and market data "
    "for an IDX Exchange assistant. Use ONLY the numbered context passages provided. "
    "The documents may use a different name for the same idea (for example, "
    "\"list-to-close ratio\" and \"sale-to-list ratio\" both mean close price divided by "
    "list price); if a passage clearly describes what was asked, use it and mention the "
    "other name. If the answer isn't in the context, say the documents don't cover it; "
    "don't use outside knowledge or guess. Keep answers short and plain (2-5 sentences, "
    "or a short list for columns). End with the source names you used, like: "
    "(Sources: Real Estate Data Analyst Primer)"
    "Write plain text for WhatsApp: use *single asterisks* for bold, and no headings or tables."
)


load_dotenv(SKILL_DIR / ".env")


def fail(message: str) -> int:
    print(json.dumps({"ok": False, "error": message}))
    return 1

def parse_args():
    p = argparse.ArgumentParser(description="Answer real-estate related questions")
    p.add_argument("--question", required = True, help = "the user's question")
    return p.parse_args()

def load_index(path):
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError("Index file does not exist. Run build_index.py first")
    indexed = json.loads(path.read_text())
    if indexed['model'] != EMBED_MODEL:
        raise ValueError(f"Embeddings were build with {indexed['model']}, not {EMBED_MODEL}.")
    chunks = indexed['chunks']
    matrix = np.array([c['embedding'] for c in chunks], dtype = np.float32)
    return chunks, matrix


def retrieve(question_vec, chunks, matrix, top_k: int = 4) -> list[dict]:
    matrix = matrix / np.linalg.norm(matrix, axis = 1, keepdims=True)
    question_vec = question_vec / np.linalg.norm(question_vec)
    scores = matrix @ question_vec
    best = np.argsort(-scores)[:top_k]
    return [{"source": chunks[i]["source"], "text": chunks[i]["text"], "score" : float(scores[i])} for i in best]

def build_messages(question, retrieved) -> list[dict]:
    passages = []
    for i, chunk in enumerate(retrieved, start = 1):
        passages.append(f"[{i}] Source: {chunk['source']}\n{chunk['text']}")
    context = "\n\n".join(passages)
    user_message = "Context:\n\n" + context + "\n\nQuestion: " + question
    return [{"role": "system", "content": SYSTEM_PROMPT},
            {"role" : "user", "content" : user_message}]

def generate(client, messages) -> str:
    resp = client.chat.completions.create(
        model = CHAT_MODEL, 
        messages = messages
    )
    return (resp.choices[0].message.content or "").strip()

def main() -> int:
    args = parse_args()
    question = " ".join(args.question.split())[:1000]
    if not question:
        return fail("The question is empty")
    if not os.environ.get("OPENAI_API_KEY"): 
        return fail("OPENAI_API_KEY is missing from rag-assistant/.env")

    try: 
        client = OpenAI()
        chunks, matrix = load_index(INDEX_FILE)
        vectors, _ = embed_texts(client, [question])
        retrieved = retrieve(np.array(vectors[0], dtype = np.float32), 
                             chunks, matrix, TOP_K)
        if not retrieved or retrieved[0]['score'] < MIN_SCORE:
            answer = "My documents don't cover that. I can answer " \
            "questions about real estate terms, MLS data fields, and the market summaries."
            sources = []
        else:
            answer = generate(client, build_messages(question, retrieved))
            if not answer: 
                return fail("The model returned no answer. Try again.")
            sources = list(dict.fromkeys(c['source'] for c in retrieved))

    except Exception as e:
        return fail(f"Couldn't answer: {e}")

    message = answer

    print(json.dumps({
        "ok": True,
        "question": question,
        "answer": answer,
        "sources": sources,
        "message": message,
        "chunks": [{"source": c["source"], "score": round(c["score"], 3)} for c in retrieved],
    }))
    return 0
    
 
if __name__ == "__main__":
    sys.exit(main())