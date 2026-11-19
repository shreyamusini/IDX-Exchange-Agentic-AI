from dotenv import load_dotenv
from pathlib import Path
from pypdf import PdfReader
import json
from datetime import datetime, timezone
import sys
from openai import OpenAI
import re


SKILL_DIR = Path(__file__).resolve().parent.parent
DOCS_DIR = SKILL_DIR / "docs"
INDEX_FILE = SKILL_DIR / "index" / "index.json"
EMBED_MODEL = "text-embedding-3-small"
CHUNK_SIZE = 600
OVERLAP = 100
DOC_TYPES = [".pdf", ".txt", ".md"]


def read_document(path: Path) -> str:
    path = Path(path)
    if path.suffix.lower() == ".pdf":
        reader = PdfReader(path)
        text = "\n\n".join(page.extract_text() or "" for page in reader.pages)
    else:
        text = path.read_text(encoding="utf-8")
    return re.sub(f"[ \t]+", " ", text)

def load_documents(folder: Path) -> list[dict]:
    docs = []
    folder = Path(folder)
    for file in sorted(folder.rglob("*")):
        if not file.is_file() or file.suffix.lower() not in DOC_TYPES:
            continue
        title = file.stem.replace("_", " ").title()
        content = read_document(file)
        if not content.strip():
            continue
        docs.append({"title" : title, "content" : content})
    return docs

def chunk_text(text: str, chunk_size = 600, overlap = 100) -> list[str]:
    chunks, start = [], 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        piece = text[start:end]
        if piece.strip():
            chunks.append(piece)
        start += chunk_size - overlap
    return chunks

def build_chunks(docs: list[dict]) -> list[dict]:
    chunks = []
    for doc in docs: 
        for chunk in chunk_text(doc['content']):
            chunks.append({"source": doc["title"], "text" : chunk})
    return chunks

def embed_texts(client, texts: list[str], model: str = EMBED_MODEL, batch_size: int = 100) -> tuple[list[list[float]], int]:
    tokens = 0
    embeddings: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        embed = client.embeddings.create(model=model, input = batch)
        embeddings.extend(item.embedding for item in sorted(embed.data, key = lambda d: d.index))
        tokens += embed.usage.total_tokens
        print(f"Embedded {min(i + batch_size, len(texts))} / {len(texts)}", file=sys.stderr)
    return embeddings, tokens

def save_index(chunks: list[dict], path:Path):
    chunks = [{"source": c['source'], "text": c["text"], "embedding": c["embedding"]} for c in chunks]
    path.parent.mkdir(parents = True, exist_ok = True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({
        "model":EMBED_MODEL,
        "built_at": datetime.now(timezone.utc).isoformat(),
        "chunks": chunks
    }))
    tmp.replace(path)

def main() -> int:
    load_dotenv(SKILL_DIR/".env")
    docs = load_documents(DOCS_DIR)
    if not docs:
        print("No documents in docs/")
        return 1
    chunks = build_chunks(docs)
    vectors, tokens = embed_texts(OpenAI(), [c['text'] for c in chunks])
    for chunk, vec in zip(chunks, vectors):
        chunk['embedding'] = vec
    save_index(chunks, INDEX_FILE)
    print(f"Summary: docs: {len(docs)}, chunks: {len(chunks)}, tokens used: {tokens}")
    return 0

if __name__ == "__main__":
    sys.exit(main())