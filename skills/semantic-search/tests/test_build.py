"""Tests for build.py. No database or OpenAI calls: a fake client stands in for the API.

Run from skills/semantic-search:
    venv/bin/python3 -m unittest discover -s tests -v
"""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build  # noqa: E402


def row(**over):
    """A complete rets_property row. Override fields to test missing or odd values."""
    r = {
        "L_ListingID": 101, "L_Type_": "SingleFamilyResidence", "L_City": "Pasadena",
        "L_Keyword2": 3, "LM_Dec_3": Decimal("2.0"), "LM_Int2_3": 1850, "YearBuilt": 1924,
        "L_SystemPrice": Decimal("1450000"), "L_Remarks": "Charming craftsman with mountain views.",
    }
    r.update(over)
    return r


class FakeEmbeddings:
    """Pretends to be client.embeddings. Records each request and returns results in reverse
    order, so the test proves embed_texts sorts them by index."""

    def __init__(self):
        self.calls = []

    def create(self, model, input):
        self.calls.append(list(input))
        data = [type("Item", (), {"index": i, "embedding": [float(len(t)), float(i)]})() for i, t in enumerate(input)]
        usage = type("Usage", (), {"total_tokens": 10 * len(input)})()
        return type("Resp", (), {"data": list(reversed(data)), "usage": usage})()


class FakeClient:
    def __init__(self):
        self.embeddings = FakeEmbeddings()


class ListingTextTests(unittest.TestCase):
    def test_complete_listing(self):
        self.assertEqual(
            build.listing_text(row()),
            "Single family home in Pasadena, CA. 3 beds. 2 baths. 1,850 sq ft. Built 1924. "
            "Price: $1,450,000. Charming craftsman with mountain views.",
        )

    def test_missing_fields_are_left_out_not_written_as_none(self):
        text = build.listing_text(row(L_Keyword2=None, YearBuilt=None, L_SystemPrice=None, L_Remarks=None))
        self.assertNotIn("None", text)
        self.assertNotIn("beds", text)
        self.assertNotIn("Built", text)
        self.assertNotIn("Price", text)

    def test_missing_city_and_unknown_type(self):
        self.assertTrue(build.listing_text(row(L_City=None)).startswith("Single family home. "))
        self.assertTrue(build.listing_text(row(L_Type_=None)).startswith("Home in Pasadena"))
        self.assertTrue(build.listing_text(row(L_Type_="Duplex")).startswith("Duplex in Pasadena"))

    def test_half_baths_are_kept(self):
        self.assertIn("2.5 baths.", build.listing_text(row(LM_Dec_3=Decimal("2.5"))))

    def test_text_is_one_line_with_single_spaces(self):
        text = build.listing_text(row(L_Remarks="Big   yard.\n\nNew\tkitchen."))
        self.assertIn("Big yard. New kitchen.", text)
        self.assertNotIn("\n", text)

    def test_text_is_capped_at_8000_characters(self):
        text = build.listing_text(row(L_Remarks="word " * 5000))   # about 25,000 characters
        self.assertEqual(len(text), 8000)


class LoadPreviousTests(unittest.TestCase):
    def write(self, folder, model):
        path = Path(folder) / "listings.json"
        path.write_text(json.dumps({"model": model, "listings": [{"id": "1", "hash": "h", "embedding": [1.0]}]}))
        return path

    def test_no_file_means_nothing_to_reuse(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(build.load_previous(Path(d) / "missing.json"), {})

    def test_same_model_is_reused_by_id(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(list(build.load_previous(self.write(d, build.MODEL))), ["1"])

    def test_different_model_is_not_reused(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(build.load_previous(self.write(d, "some-other-model")), {})


class SplitChangedTests(unittest.TestCase):
    def test_unchanged_are_kept_and_new_or_changed_are_embedded(self):
        same, changed, new = row(L_ListingID=1), row(L_ListingID=2), row(L_ListingID=3)
        old = {
            "1": {"id": "1", "hash": build.hashlib.sha256(build.listing_text(same).encode()).hexdigest(), "embedding": [1.0]},
            "2": {"id": "2", "hash": "an old hash", "embedding": [2.0]},
            "9": {"id": "9", "hash": "x", "embedding": [9.0]},   # sold: not in rows anymore
        }
        keep, todo = build.split_changed([same, changed, new], old)
        self.assertEqual([k["id"] for k in keep], ["1"])
        self.assertEqual(keep[0]["embedding"], [1.0])          # reused, not re-embedded
        self.assertEqual([t["id"] for t in todo], ["2", "3"])
        self.assertTrue(all("text" in t and "hash" in t for t in todo))
        self.assertNotIn("9", [x["id"] for x in keep + todo])  # sold listings drop out

    def test_ids_are_strings(self):
        _, todo = build.split_changed([row(L_ListingID=123)], {})
        self.assertEqual(todo[0]["id"], "123")


class EmbedTextsTests(unittest.TestCase):
    def test_batches_keep_order_and_count_tokens(self):
        client = FakeClient()
        texts = [f"listing {i}" + "x" * i for i in range(250)]
        with contextlib.redirect_stdout(io.StringIO()) as stdout, contextlib.redirect_stderr(io.StringIO()):
            vectors, tokens = build.embed_texts(client, texts, batch_size=100)
        self.assertEqual([len(c) for c in client.embeddings.calls], [100, 100, 50])
        self.assertEqual(len(vectors), 250)
        self.assertEqual([v[0] for v in vectors], [float(len(t)) for t in texts])  # same order as texts
        self.assertEqual(tokens, 2500)
        # similar.py's output must be pure JSON, so progress goes to stderr, not stdout.
        self.assertEqual(stdout.getvalue(), "")

    def test_nothing_to_embed_makes_no_requests(self):
        client = FakeClient()
        self.assertEqual(build.embed_texts(client, []), ([], 0))
        self.assertEqual(client.embeddings.calls, [])


class SaveTests(unittest.TestCase):
    def test_saves_only_what_search_needs(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "embeddings" / "listings.json"   # folder doesn't exist yet
            build.save([{"id": "1", "hash": "h", "text": "long text", "embedding": [0.1, 0.2]}], path)
            saved = json.loads(path.read_text())
            self.assertEqual(saved["model"], build.MODEL)
            self.assertIn("built_at", saved)
            self.assertEqual(saved["listings"], [{"id": "1", "hash": "h", "embedding": [0.1, 0.2]}])
            self.assertFalse(path.with_suffix(".tmp").exists())   # temp file was swapped in

    def test_save_replaces_the_old_file(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "listings.json"
            build.save([{"id": "1", "hash": "a", "embedding": [1.0]}], path)
            build.save([{"id": "2", "hash": "b", "embedding": [2.0]}], path)
            self.assertEqual([l["id"] for l in json.loads(path.read_text())["listings"]], ["2"])


class SettingsTests(unittest.TestCase):
    def test_paths(self):
        self.assertEqual(build.SKILL_DIR.name, "semantic-search")
        self.assertEqual(build.OUT, build.SKILL_DIR / "embeddings" / "listings.json")


if __name__ == "__main__":
    unittest.main()
