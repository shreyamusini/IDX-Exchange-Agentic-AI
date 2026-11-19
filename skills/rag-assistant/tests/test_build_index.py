"""Tests for build_index.py. No OpenAI calls: a fake client stands in for the API.

Run from skills/rag-assistant:
    venv/bin/python3 -m unittest discover -s tests -v
"""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build_index  # noqa: E402


class FakeEmbeddings:
    """Pretends to be client.embeddings. Returns results in reverse order to prove they get sorted."""

    def __init__(self):
        self.calls = []

    def create(self, model, input):
        self.calls.append(list(input))
        data = [type("Item", (), {"index": i, "embedding": [float(len(t)), float(i)]})() for i, t in enumerate(input)]
        usage = type("Usage", (), {"total_tokens": 7 * len(input)})()
        return type("Resp", (), {"data": list(reversed(data)), "usage": usage})()


class FakeClient:
    def __init__(self):
        self.embeddings = FakeEmbeddings()


def quiet():
    """Hide progress lines while a test runs."""
    return contextlib.redirect_stderr(io.StringIO())


class ReadDocumentTests(unittest.TestCase):
    def test_text_and_markdown_files(self):
        with tempfile.TemporaryDirectory() as d:
            md = Path(d) / "notes.md"
            md.write_text("# Title\n\nDays\ton  Market 📊", encoding="utf-8")
            self.assertEqual(build_index.read_document(md), "# Title\n\nDays on Market 📊")

    def test_tabs_and_repeated_spaces_become_one_space_but_line_breaks_stay(self):
        with tempfile.TemporaryDirectory() as d:
            txt = Path(d) / "a.txt"
            txt.write_text("a\t\tb   c\n\nd", encoding="utf-8")
            self.assertEqual(build_index.read_document(txt), "a b c\n\nd")

    def test_pdf_pages_are_joined_and_empty_pages_are_skipped(self):
        pages = [mock.Mock(extract_text=lambda: "Page\tone"), mock.Mock(extract_text=lambda: None),
                 mock.Mock(extract_text=lambda: "Page two")]
        with mock.patch.object(build_index, "PdfReader", return_value=mock.Mock(pages=pages)):
            self.assertEqual(build_index.read_document(Path("primer.pdf")), "Page one\n\n\n\nPage two")

    def test_works_with_a_string_path(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "a.txt").write_text("hello", encoding="utf-8")
            self.assertEqual(build_index.read_document(str(Path(d) / "a.txt")), "hello")


class LoadDocumentsTests(unittest.TestCase):
    def test_reads_supported_files_including_subfolders(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "market").mkdir()
            (root / "real_estate_primer.md").write_text("DOM means days on market.", encoding="utf-8")
            (root / "market" / "Pasadena_market.txt").write_text("Pasadena report", encoding="utf-8")
            (root / "photo.png").write_bytes(b"not a document")
            (root / "empty.txt").write_text("   \n", encoding="utf-8")
            docs = build_index.load_documents(root)
        self.assertEqual([d["title"] for d in docs], ["Pasadena Market", "Real Estate Primer"])
        self.assertEqual(docs[1]["content"], "DOM means days on market.")

    def test_empty_folder(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(build_index.load_documents(Path(d)), [])


class ChunkTextTests(unittest.TestCase):
    text = "".join(f"{i:04d} " for i in range(400))       # 2,000 characters

    def test_chunks_are_at_most_600_characters(self):
        self.assertTrue(all(len(c) <= 600 for c in build_index.chunk_text(self.text)))

    def test_neighbouring_chunks_overlap_by_100_characters(self):
        chunks = build_index.chunk_text(self.text)
        for a, b in zip(chunks, chunks[1:]):
            self.assertEqual(a[-100:], b[:100])

    def test_every_part_of_the_text_is_in_some_chunk(self):
        chunks = build_index.chunk_text(self.text)
        self.assertTrue(self.text.startswith(chunks[0]))
        self.assertTrue(self.text.endswith(chunks[-1]))
        self.assertEqual(len(chunks), 4)                  # starts at 0, 500, 1000, 1500

    def test_short_text_is_one_chunk(self):
        self.assertEqual(build_index.chunk_text("DOM means days on market."), ["DOM means days on market."])

    def test_empty_and_blank_text_make_no_chunks(self):
        self.assertEqual(build_index.chunk_text(""), [])
        self.assertEqual(build_index.chunk_text(" " * 1500), [])


class BuildChunksTests(unittest.TestCase):
    def test_each_chunk_is_labeled_with_its_document_title(self):
        docs = [{"title": "Primer", "content": "a" * 700}, {"title": "Schema Reference", "content": "b"}]
        chunks = build_index.build_chunks(docs)
        self.assertEqual([c["source"] for c in chunks], ["Primer", "Primer", "Schema Reference"])
        self.assertTrue(all(isinstance(c["source"], str) for c in chunks))   # the title, not the whole document
        self.assertEqual(set(chunks[0]), {"source", "text"})


class EmbedTextsTests(unittest.TestCase):
    def test_batches_keep_order_and_count_tokens(self):
        client = FakeClient()
        texts = [f"chunk {i}" + "x" * i for i in range(257)]
        with contextlib.redirect_stdout(io.StringIO()) as stdout, quiet():
            vectors, tokens = build_index.embed_texts(client, texts)
        self.assertEqual([len(c) for c in client.embeddings.calls], [100, 100, 57])
        self.assertEqual([v[0] for v in vectors], [float(len(t)) for t in texts])
        self.assertEqual(tokens, 7 * 257)
        self.assertEqual(stdout.getvalue(), "")           # progress goes to stderr, so ask.py's output stays pure JSON


class SaveIndexTests(unittest.TestCase):
    def test_saves_model_date_and_chunks(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "index" / "index.json"
            build_index.save_index([{"source": "Primer", "text": "DOM...", "embedding": [0.1, 0.2], "extra": 1}], path)
            saved = json.loads(path.read_text())
            self.assertEqual(saved["model"], build_index.EMBED_MODEL)
            self.assertIn("built_at", saved)
            self.assertEqual(saved["chunks"], [{"source": "Primer", "text": "DOM...", "embedding": [0.1, 0.2]}])
            self.assertFalse(path.with_suffix(".tmp").exists())


class MainTests(unittest.TestCase):
    def test_builds_the_index_from_the_docs_folder(self):
        with tempfile.TemporaryDirectory() as d:
            docs, out = Path(d) / "docs", Path(d) / "index" / "index.json"
            docs.mkdir()
            (docs / "primer.md").write_text("DOM means days on market. " * 40, encoding="utf-8")
            (docs / "schema.md").write_text("california_sold has ClosePrice.", encoding="utf-8")
            with mock.patch.object(build_index, "DOCS_DIR", docs), mock.patch.object(build_index, "INDEX_FILE", out), \
                 mock.patch.object(build_index, "OpenAI", FakeClient), mock.patch.object(build_index, "load_dotenv"), \
                 contextlib.redirect_stdout(io.StringIO()) as stdout, quiet():
                code = build_index.main()
            saved = json.loads(out.read_text())
        self.assertEqual(code, 0)
        self.assertEqual({c["source"] for c in saved["chunks"]}, {"Primer", "Schema"})
        self.assertTrue(all(len(c["embedding"]) == 2 for c in saved["chunks"]))
        self.assertIn("docs: 2", stdout.getvalue())

    def test_no_documents_is_an_error(self):
        with tempfile.TemporaryDirectory() as d:
            with mock.patch.object(build_index, "DOCS_DIR", Path(d)), mock.patch.object(build_index, "load_dotenv"), \
                 contextlib.redirect_stdout(io.StringIO()), quiet():
                self.assertEqual(build_index.main(), 1)


if __name__ == "__main__":
    unittest.main()
