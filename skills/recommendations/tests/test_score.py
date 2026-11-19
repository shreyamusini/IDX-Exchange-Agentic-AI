"""Tests for score.py, the similarity model. No database or OpenAI needed.

Run from skills/recommendations:
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
import score  # noqa: E402


def listing(id_=1, price=1_000_000, beds=3, city="Irvine", sqft=1800):
    return {"L_ListingID": id_, "L_SystemPrice": price, "L_Keyword2": beds, "L_City": city, "LM_Int2_3": sqft}


EMPTY = {"L_ListingID": 9, "L_SystemPrice": None, "L_Keyword2": None, "L_City": None, "LM_Int2_3": None}


class CosineTests(unittest.TestCase):
    def test_direction(self):
        self.assertAlmostEqual(score.cosine_similarity_score([1, 0], [1, 0]), 1.0, places=5)
        self.assertAlmostEqual(score.cosine_similarity_score([1, 0], [0, 1]), 0.0, places=5)
        self.assertAlmostEqual(score.cosine_similarity_score([1, 0], [-1, 0]), -1.0, places=5)

    def test_length_doesnt_matter(self):
        self.assertAlmostEqual(score.cosine_similarity_score([1, 1], [5, 5]), 1.0, places=5)

    def test_zero_vector_is_zero_not_a_crash(self):
        self.assertEqual(score.cosine_similarity_score([0, 0], [1, 0]), 0.0)


class SimilarityScoreTests(unittest.TestCase):
    def test_perfect_match_is_100(self):
        self.assertEqual(score.calculate_similarity_score(listing(), listing(), [1, 0], [1, 0]), 100.0)

    def test_price_tiers(self):
        # Only the price differs, and there are no embeddings: beds 15 + city 15 + sqft 10 = 40 plus price points.
        def with_price(p):
            return score.calculate_similarity_score(listing(), listing(price=p), None, None) - 40
        self.assertEqual(with_price(1_049_999), 20)
        self.assertEqual(with_price(1_100_000), 12)
        self.assertEqual(with_price(1_250_000), 5)
        self.assertEqual(with_price(1_400_000), 0)
        self.assertEqual(with_price(950_001), 20)      # cheaper counts the same as pricier

    def test_sqft_tiers(self):
        def with_sqft(s):
            return score.calculate_similarity_score(listing(), listing(sqft=s), None, None) - 50   # price 20 + beds 15 + city 15
        self.assertEqual(with_sqft(2099), 10)
        self.assertEqual(with_sqft(2400), 5)
        self.assertEqual(with_sqft(2600), 0)

    def test_beds_and_city_must_match_exactly(self):
        base = score.calculate_similarity_score(listing(), listing(), None, None)
        self.assertEqual(score.calculate_similarity_score(listing(), listing(beds=4), None, None), base - 15)
        self.assertEqual(score.calculate_similarity_score(listing(), listing(city="Tustin"), None, None), base - 15)

    def test_semantic_part_is_cosine_times_40(self):
        structured = score.calculate_similarity_score(listing(), listing(), None, None)
        self.assertEqual(score.calculate_similarity_score(listing(), listing(), [1, 0], [1, 1]), round(structured + 40 * 0.70710678, 2))

    def test_missing_values_score_zero_without_crashing(self):
        self.assertEqual(score.calculate_similarity_score(listing(), EMPTY, None, None), 0.0)
        self.assertEqual(score.calculate_similarity_score(EMPTY, listing(), None, None), 0.0)

    def test_two_missing_values_are_not_a_match(self):
        self.assertEqual(score.calculate_similarity_score(EMPTY, EMPTY, None, None), 0.0)

    def test_one_missing_embedding_skips_only_the_semantic_part(self):
        self.assertEqual(score.calculate_similarity_score(listing(), listing(), [1, 0], None), 60.0)


class LoadEmbeddingsTests(unittest.TestCase):
    def write(self, folder, model=score.MODEL):
        path = Path(folder) / "listings.json"
        path.write_text(json.dumps({"model": model, "listings": [
            {"id": "1", "hash": "h", "embedding": [1.0, 0.0]},
            {"id": "2", "hash": "h", "embedding": [0.0, 1.0]},
            {"id": "3", "hash": "h", "embedding": [1.0, 1.0]},
        ]}))
        return path

    def test_only_requested_ids(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(score.load_embeddings({"1", "3", "99"}, self.write(d)), {"1": [1.0, 0.0], "3": [1.0, 1.0]})

    def test_missing_file_means_no_embeddings(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(score.load_embeddings({"1"}, Path(d) / "missing.json"), {})

    def test_other_model_is_ignored(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(score.load_embeddings({"1"}, self.write(d, model="text-embedding-ada-002")), {})


class RankCandidatesTests(unittest.TestCase):
    def rank(self, target, candidates, embeddings=None, k=5):
        with mock.patch.object(score, "load_embeddings", return_value=embeddings or {}):
            return score.rank_candidates(target, candidates, k)

    def test_highest_score_first_and_target_left_out(self):
        results, _ = self.rank(listing(1), [listing(2, beds=4), listing(1), listing(3), EMPTY])
        self.assertEqual([r["id"] for r in results], ["3", "2", "9"])
        self.assertEqual([r["score"] for r in results], [60.0, 45.0, 0.0])

    def test_ties_are_broken_by_id(self):
        results, _ = self.rank(listing(1), [listing(30), listing(4), listing(12)])
        self.assertEqual([r["id"] for r in results], ["12", "30", "4"])   # string order, the same every run

    def test_returns_at_most_k(self):
        results, _ = self.rank(listing(1), [listing(i) for i in range(2, 20)], k=5)
        self.assertEqual(len(results), 5)

    def test_embeddings_change_the_order(self):
        embeddings = {"1": [1.0, 0.0], "2": [0.0, 1.0], "3": [1.0, 0.0]}
        results, used = self.rank(listing(1), [listing(2), listing(3)], embeddings)
        self.assertEqual(results[0]["id"], "3")      # same direction as the target
        self.assertTrue(used)

    def test_reports_when_the_target_has_no_embedding(self):
        _, used = self.rank(listing(1), [listing(2)], {"2": [1.0, 0.0]})
        self.assertFalse(used)

    def test_ids_match_even_when_the_database_gives_numbers(self):
        results, used = self.rank(listing(1), [listing(2)], {"1": [1.0, 0.0], "2": [1.0, 0.0]})
        self.assertTrue(used)
        self.assertEqual(results[0]["score"], 100.0)


class MainTests(unittest.TestCase):
    def run_main(self, stdin_text):
        with mock.patch.object(sys, "stdin", io.StringIO(stdin_text)), \
             mock.patch.object(score, "load_embeddings", return_value={}), \
             contextlib.redirect_stdout(io.StringIO()) as out:
            code = score.main()
        return code, json.loads(out.getvalue())

    def test_success(self):
        code, data = self.run_main(json.dumps({"target": listing(1), "candidates": [listing(2)], "k": 5}))
        self.assertEqual(code, 0)
        self.assertEqual(data, {"ok": True, "results": [{"id": "2", "score": 60.0}], "usedEmbeddings": False})

    def test_k_defaults_to_5(self):
        _, data = self.run_main(json.dumps({"target": listing(1), "candidates": [listing(i) for i in range(2, 12)]}))
        self.assertEqual(len(data["results"]), 5)

    def test_input_that_isnt_json(self):
        code, data = self.run_main("not json")
        self.assertEqual(code, 1)
        self.assertFalse(data["ok"])
        self.assertIn("JSON", data["error"])

    def test_missing_fields(self):
        code, data = self.run_main(json.dumps({"candidates": []}))
        self.assertEqual(code, 1)
        self.assertFalse(data["ok"])


if __name__ == "__main__":
    unittest.main()
