"""Tests for similar.py. No OpenAI calls: embed_texts and OpenAI are replaced with fakes.

Run from skills/semantic-search:
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
import similar  # noqa: E402


def embeddings_file(folder, listings, model=similar.MODEL):
    path = Path(folder) / "listings.json"
    path.write_text(json.dumps({"model": model, "built_at": "2026-11-11T00:00:00+00:00", "listings": listings}))
    return path


class TopMatchesTests(unittest.TestCase):
    ids = ["north", "east", "northeast", "south"]
    matrix = np.array([[0, 1], [1, 0], [1, 1], [0, -1]], dtype=np.float32)

    def test_most_similar_first(self):
        results = similar.top_matches(np.array([0.1, 1.0], dtype=np.float32), self.ids, self.matrix, 4)
        self.assertEqual([r["id"] for r in results], ["north", "northeast", "east", "south"])
        self.assertEqual(results, sorted(results, key=lambda r: -r["score"]))

    def test_scores_are_cosine_similarity(self):
        results = {r["id"]: r["score"] for r in similar.top_matches(np.array([0, 1], dtype=np.float32), self.ids, self.matrix, 4)}
        self.assertAlmostEqual(results["north"], 1.0, places=3)      # same direction
        self.assertAlmostEqual(results["east"], 0.0, places=3)       # unrelated
        self.assertAlmostEqual(results["south"], -1.0, places=3)     # opposite
        self.assertAlmostEqual(results["northeast"], 0.7071, places=3)

    def test_length_doesnt_matter_only_direction(self):
        long = np.array([[0, 100], [1, 0]], dtype=np.float32)
        results = similar.top_matches(np.array([0, 1], dtype=np.float32), ["far", "east"], long, 2)
        self.assertAlmostEqual(results[0]["score"], 1.0, places=3)

    def test_returns_at_most_k(self):
        self.assertEqual(len(similar.top_matches(np.array([1, 1], dtype=np.float32), self.ids, self.matrix, 2)), 2)
        self.assertEqual(len(similar.top_matches(np.array([1, 1], dtype=np.float32), self.ids, self.matrix, 10)), 4)


class LoadEmbeddingsTests(unittest.TestCase):
    def test_loads_ids_and_matrix(self):
        with tempfile.TemporaryDirectory() as d:
            path = embeddings_file(d, [{"id": "1", "hash": "h", "embedding": [0.1, 0.2]}, {"id": "2", "hash": "h", "embedding": [0.3, 0.4]}])
            ids, matrix, built_at = similar.load_embeddings(path)
            self.assertEqual(ids, ["1", "2"])
            self.assertEqual(matrix.shape, (2, 2))
            self.assertEqual(built_at, "2026-11-11T00:00:00+00:00")

    def test_different_model_is_an_error(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                similar.load_embeddings(embeddings_file(d, [], model="text-embedding-ada-002"))


class MainTests(unittest.TestCase):
    """Runs main() as if from the command line and checks the JSON it prints."""

    def run_main(self, args, out_path, api_key="sk-test", fake_vector=(0.0, 1.0)):
        env = {"OPENAI_API_KEY": api_key} if api_key else {}
        fake_embed = mock.Mock(return_value=([list(fake_vector)], 5))
        with mock.patch.object(sys, "argv", ["similar.py", *args]), \
             mock.patch.dict(os.environ, env, clear=True), \
             mock.patch.object(similar, "load_dotenv"), \
             mock.patch.object(similar, "OUT", out_path), \
             mock.patch.object(similar, "OpenAI"), \
             mock.patch.object(similar, "embed_texts", fake_embed), \
             contextlib.redirect_stdout(io.StringIO()) as stdout:
            code = similar.main()
        return code, json.loads(stdout.getvalue()), fake_embed

    def test_success_prints_ranked_ids_as_json(self):
        with tempfile.TemporaryDirectory() as d:
            path = embeddings_file(d, [
                {"id": "east", "hash": "h", "embedding": [1.0, 0.0]},
                {"id": "north", "hash": "h", "embedding": [0.0, 1.0]},
            ])
            code, data, fake_embed = self.run_main(["--query", "  charming\ncraftsman  ", "--top", "1"], path)
        self.assertEqual(code, 0)
        self.assertTrue(data["ok"])
        self.assertEqual(data["query"], "charming craftsman")        # cleaned up before embedding
        self.assertEqual(data["results"], [{"id": "north", "score": 1.0}])
        self.assertEqual(fake_embed.call_args.args[1], ["charming craftsman"])

    def test_top_is_kept_between_1_and_50(self):
        with tempfile.TemporaryDirectory() as d:
            path = embeddings_file(d, [{"id": str(i), "hash": "h", "embedding": [1.0, float(i)]} for i in range(60)])
            _, many, _ = self.run_main(["--query", "x", "--top", "500"], path)
            _, few, _ = self.run_main(["--query", "x", "--top", "0"], path)
        self.assertEqual(len(many["results"]), 50)
        self.assertEqual(len(few["results"]), 1)

    def test_missing_api_key(self):
        with tempfile.TemporaryDirectory() as d:
            code, data, _ = self.run_main(["--query", "x"], embeddings_file(d, []), api_key=None)
        self.assertEqual(code, 1)
        self.assertIn("OPENAI_API_KEY", data["error"])

    def test_no_embeddings_file(self):
        with tempfile.TemporaryDirectory() as d:
            code, data, _ = self.run_main(["--query", "x"], Path(d) / "missing.json")
        self.assertEqual(code, 1)
        self.assertIn("build.py", data["error"])

    def test_empty_embeddings_file(self):
        with tempfile.TemporaryDirectory() as d:
            code, data, _ = self.run_main(["--query", "x"], embeddings_file(d, []))
        self.assertEqual(code, 1)
        self.assertIn("empty", data["error"])

    def test_blank_query(self):
        with tempfile.TemporaryDirectory() as d:
            code, data, _ = self.run_main(["--query", "   "], embeddings_file(d, []))
        self.assertEqual(code, 1)
        self.assertFalse(data["ok"])

    def test_api_errors_come_back_as_json(self):
        with tempfile.TemporaryDirectory() as d:
            path = embeddings_file(d, [{"id": "1", "hash": "h", "embedding": [1.0, 0.0]}])
            with mock.patch.object(sys, "argv", ["similar.py", "--query", "x"]), \
                 mock.patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test"}, clear=True), \
                 mock.patch.object(similar, "load_dotenv"), \
                 mock.patch.object(similar, "OUT", path), \
                 mock.patch.object(similar, "OpenAI"), \
                 mock.patch.object(similar, "embed_texts", side_effect=RuntimeError("rate limited")), \
                 contextlib.redirect_stdout(io.StringIO()) as stdout:
                code = similar.main()
        self.assertEqual(code, 1)
        self.assertIn("rate limited", json.loads(stdout.getvalue())["error"])


if __name__ == "__main__":
    unittest.main()
