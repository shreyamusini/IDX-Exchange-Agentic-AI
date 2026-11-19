"""Tests for ask.py: retrieval, the prompt, and the answer. No OpenAI calls.

Run from skills/rag-assistant:
    venv/bin/python3 -m unittest discover -s tests -v
"""
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import ask  # noqa: E402

CHUNKS = [
    {"source": "Primer", "text": "Days on Market (DOM) is how long a listing is active.", "embedding": [1.0, 0.0, 0.0]},
    {"source": "Primer", "text": "The sale-to-list ratio is ClosePrice divided by ListPrice.", "embedding": [0.0, 1.0, 0.0]},
    {"source": "Schema Reference", "text": "california_sold has ListingKey, ClosePrice, CloseDate.", "embedding": [0.0, 0.0, 1.0]},
    {"source": "Primer", "text": "CDOM adds up days across listing periods.", "embedding": [0.9, 0.1, 0.0]},
    {"source": "City Market Summary", "text": "Irvine sold 479 homes.", "embedding": [0.5, 0.5, 0.5]},
]


def index_file(folder, chunks=CHUNKS, model=ask.EMBED_MODEL):
    path = Path(folder) / "index.json"
    path.write_text(json.dumps({"model": model, "built_at": "2026-11-18T00:00:00+00:00", "chunks": chunks}))
    return path


def fake_chat(content):
    """A stand-in OpenAI client whose chat answer is `content`. Records the messages it was sent."""
    client = mock.Mock()
    message = type("Msg", (), {"content": content})()
    client.chat.completions.create.return_value = type("Resp", (), {"choices": [type("Choice", (), {"message": message})()]})()
    return client


class LoadIndexTests(unittest.TestCase):
    def test_loads_chunks_and_a_matrix(self):
        with tempfile.TemporaryDirectory() as d:
            chunks, matrix = ask.load_index(index_file(d))
        self.assertEqual(len(chunks), 5)
        self.assertEqual(matrix.shape, (5, 3))
        self.assertEqual(matrix.dtype, np.float32)

    def test_missing_index_says_to_build_it(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(FileNotFoundError) as e:
                ask.load_index(Path(d) / "missing.json")
        self.assertIn("build_index.py", str(e.exception))

    def test_index_from_another_model_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                ask.load_index(index_file(d, model="text-embedding-ada-002"))


class RetrieveTests(unittest.TestCase):
    def setUp(self):
        self.chunks = CHUNKS
        self.matrix = np.array([c["embedding"] for c in CHUNKS], dtype=np.float32)

    def test_most_similar_chunks_first(self):
        got = ask.retrieve(np.array([1.0, 0.05, 0.0], dtype=np.float32), self.chunks, self.matrix, 3)
        self.assertEqual([g["text"][:4] for g in got], ["Days", "CDOM", "Irvi"])
        self.assertEqual(got, sorted(got, key=lambda g: -g["score"]))

    def test_scores_are_cosine_similarity(self):
        got = ask.retrieve(np.array([0.0, 0.0, 5.0], dtype=np.float32), self.chunks, self.matrix, 5)
        self.assertAlmostEqual(got[0]["score"], 1.0, places=5)              # same direction, any length
        self.assertEqual(got[0]["source"], "Schema Reference")
        self.assertAlmostEqual(got[1]["score"], 1 / np.sqrt(3), places=5)

    def test_returns_top_k_with_source_text_and_a_plain_float_score(self):
        got = ask.retrieve(np.array([1.0, 1.0, 1.0], dtype=np.float32), self.chunks, self.matrix, 4)
        self.assertEqual(len(got), 4)
        self.assertEqual(set(got[0]), {"source", "text", "score"})
        json.dumps(got)                                                      # no numpy numbers left in it

    def test_top_k_defaults_to_4(self):
        self.assertEqual(len(ask.retrieve(np.array([1.0, 1.0, 1.0], dtype=np.float32), self.chunks, self.matrix)), 4)


class PromptTests(unittest.TestCase):
    def test_system_prompt_grounds_the_answer(self):
        p = ask.SYSTEM_PROMPT
        self.assertIn("ONLY", p)
        self.assertIn("don't cover it", p)
        self.assertIn("sale-to-list", p)
        self.assertIn("Sources:", p)

    def test_messages_have_rules_then_numbered_sourced_context_then_the_question(self):
        retrieved = [{"source": "Primer", "text": "DOM is days on market.", "score": 0.6},
                     {"source": "Schema Reference", "text": "ClosePrice is the sale price.", "score": 0.5}]
        system, user = ask.build_messages("What does DOM mean?", retrieved)
        self.assertEqual(system, {"role": "system", "content": ask.SYSTEM_PROMPT})
        self.assertEqual(user["role"], "user")
        self.assertEqual(
            user["content"],
            "Context:\n\n[1] Source: Primer\nDOM is days on market.\n\n"
            "[2] Source: Schema Reference\nClosePrice is the sale price.\n\nQuestion: What does DOM mean?",
        )


class GenerateTests(unittest.TestCase):
    def test_returns_the_answer_text(self):
        client = fake_chat("  DOM means Days on Market. (Sources: Primer)  ")
        self.assertEqual(ask.generate(client, [{"role": "user", "content": "x"}]), "DOM means Days on Market. (Sources: Primer)")
        self.assertEqual(client.chat.completions.create.call_args.kwargs["model"], ask.CHAT_MODEL)

    def test_empty_answer_becomes_an_empty_string(self):
        self.assertEqual(ask.generate(fake_chat(None), []), "")


class MainTests(unittest.TestCase):
    """Runs main() as if from the command line and checks the JSON it prints."""

    def run_main(self, question, folder, query_vec=(1.0, 0.0, 0.0), answer="DOM means Days on Market. (Sources: Primer)",
                 api_key="sk-test", index=None):
        client = fake_chat(answer)
        env = {"OPENAI_API_KEY": api_key} if api_key else {}
        with mock.patch.object(sys, "argv", ["ask.py", "--question", question]), \
             mock.patch.dict(os.environ, env, clear=True), \
             mock.patch.object(ask, "INDEX_FILE", index or index_file(folder)), \
             mock.patch.object(ask, "OpenAI", return_value=client), \
             mock.patch.object(ask, "embed_texts", return_value=([list(query_vec)], 3)), \
             contextlib.redirect_stdout(io.StringIO()) as out:
            code = ask.main()
        return code, json.loads(out.getvalue()), client

    def test_answers_from_the_retrieved_chunks(self):
        with tempfile.TemporaryDirectory() as d:
            code, data, client = self.run_main("  What does\nDOM mean? ", d)
        self.assertEqual(code, 0)
        self.assertTrue(data["ok"])
        self.assertEqual(data["question"], "What does DOM mean?")
        self.assertEqual(data["message"], "DOM means Days on Market. (Sources: Primer)")
        self.assertEqual(data["sources"], ["Primer", "City Market Summary"])   # no repeats, retrieval order
        self.assertEqual(len(data["chunks"]), ask.TOP_K)
        sent = client.chat.completions.create.call_args.kwargs["messages"]
        self.assertIn("Days on Market (DOM)", sent[1]["content"])            # the best chunk reached the prompt

    def test_unrelated_question_skips_the_chat_model(self):
        far = [{"source": "Primer", "text": "DOM...", "embedding": [1.0, 0.0, 0.0]}]
        with tempfile.TemporaryDirectory() as d:
            code, data, client = self.run_main("Who won the World Series?", d, query_vec=(-1.0, 0.1, 0.0),
                                               index=index_file(d, chunks=far))
        self.assertEqual(code, 0)
        self.assertIn("don't cover that", data["message"])
        self.assertEqual(data["sources"], [])
        client.chat.completions.create.assert_not_called()

    def test_blank_question(self):
        with tempfile.TemporaryDirectory() as d:
            code, data, _ = self.run_main("   ", d)
        self.assertEqual(code, 1)
        self.assertFalse(data["ok"])

    def test_missing_api_key(self):
        with tempfile.TemporaryDirectory() as d:
            code, data, _ = self.run_main("What does DOM mean?", d, api_key=None)
        self.assertEqual(code, 1)
        self.assertIn("OPENAI_API_KEY", data["error"])

    def test_missing_index(self):
        with tempfile.TemporaryDirectory() as d:
            code, data, _ = self.run_main("What does DOM mean?", d, index=Path(d) / "missing.json")
        self.assertEqual(code, 1)
        self.assertIn("build_index.py", data["error"])

    def test_empty_model_answer_is_an_error(self):
        with tempfile.TemporaryDirectory() as d:
            code, data, _ = self.run_main("What does DOM mean?", d, answer="")
        self.assertEqual(code, 1)
        self.assertFalse(data["ok"])


if __name__ == "__main__":
    unittest.main()
