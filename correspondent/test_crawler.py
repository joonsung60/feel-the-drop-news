import json
import tempfile
import unittest
from pathlib import Path

from crawler import (
    EntityEntry,
    extract_json_array,
    find_surface_in_text,
    load_config,
    match_entities,
    normalize_url,
    source_texts_for_items,
    RenderedPage,
    select_index_links,
    select_index_harvest_item,
    trim_markdown,
    date_supported_by_source,
    stable_text_hash,
)


class CrawlerTests(unittest.TestCase):
    def test_normalize_url_removes_only_denylist(self) -> None:
        denylist = ["utm_*", "fbclid", "ref"]
        url = "https://example.com/A?keep=1&utm_source=x&Ref=y&empty=#section"
        self.assertEqual(normalize_url(url, denylist), "https://example.com/A?keep=1&empty=#section")

    def test_ascii_word_boundary_matches_typescript_semantics(self) -> None:
        self.assertTrue(find_surface_in_text("new skrillex release", "skrillex"))
        self.assertTrue(find_surface_in_text("(skrillex)", "skrillex"))
        self.assertFalse(find_surface_in_text("skrillexx", "skrillex"))
        self.assertFalse(find_surface_in_text("xskrillex", "skrillex"))
        self.assertTrue(find_surface_in_text("東京skrillex公演", "skrillex"))

    def test_match_entities_uses_aliases_and_500_content_chars(self) -> None:
        entities = [EntityEntry("Tiësto", ("tiësto", "tiesto"))]
        self.assertEqual(match_entities("Tiesto returns", "", entities), ["Tiësto"])
        self.assertEqual(match_entities("No match", "x" * 501 + " Tiesto", entities), [])

    def test_extract_json_array_handles_fences_and_rejects_object(self) -> None:
        self.assertEqual(extract_json_array("```json\n[]\n```"), [])
        with self.assertRaises(ValueError):
            extract_json_array('{"headline_en":"not an array"}')

    def test_page_source_hashes_are_deterministic_and_distinct(self) -> None:
        markdown = "# Event One\nSkrillex plays Seoul.\n# Event Two\nTiesto plays Tokyo."
        items = [
            {"headline_en": "Skrillex in Seoul", "entities_en": ["Skrillex"]},
            {"headline_en": "Tiesto in Tokyo", "entities_en": ["Tiesto"]},
        ]
        sources = source_texts_for_items(markdown, items)
        self.assertNotEqual(stable_text_hash(sources[0]), stable_text_hash(sources[1]))
        self.assertEqual(sources, source_texts_for_items(markdown, items))

    def test_repeated_source_blocks_still_get_source_derived_unique_hashes(self) -> None:
        markdown = "# Notice\nSame text\n# Notice\nSame text\n# Other\nDifferent text"
        items = [
            {"headline_en": "First", "entities_en": []},
            {"headline_en": "Second", "entities_en": []},
        ]
        hashes = [stable_text_hash(value) for value in source_texts_for_items(markdown, items)]
        self.assertEqual(len(set(hashes)), 2)

    def test_date_must_have_full_source_evidence(self) -> None:
        self.assertTrue(date_supported_by_source("2026-07-03", "July 3rd, 2026 at the club"))
        self.assertTrue(date_supported_by_source("2026-07-03", "開催日 2026年7月3日"))
        self.assertFalse(date_supported_by_source("2026-01-01", "World DJ Festival 2026"))

    def test_index_links_exclude_listing_and_month_archives(self) -> None:
        page = RenderedPage(
            "https://example.com/event/",
            "https://example.com/event/",
            "events",
            (
                {"href": "https://example.com/event", "text": "Events"},
                {"href": "https://example.com/event/2026/07", "text": "July"},
                {"href": "https://example.com/event/artist-0722/?utm_source=x", "text": "Artist Night"},
            ),
        )
        self.assertEqual(
            select_index_links(page, 20, ["utm_*"]),
            ["https://example.com/event/artist-0722/"],
        )

    def test_index_links_stay_in_collection_and_skip_navigation_routes(self) -> None:
        page = RenderedPage(
            "https://ra.co/events/kr/seoul",
            "https://ra.co/events/kr/seoul",
            "events",
            (
                {"href": "/events/kr/cookiepolicy", "text": "Cookie policy details"},
                {"href": "/pro/event/create", "text": "Create an event"},
                {"href": "/news/85570", "text": "Unrelated news story"},
                {"href": "/events/2204523", "text": "Seoul club event title"},
            ),
        )
        self.assertEqual(select_index_links(page, 20, []), ["https://ra.co/events/2204523"])

    def test_index_harvest_keeps_item_matching_url_slug(self) -> None:
        items = [
            {"headline_en": "Unrelated Popular Story"},
            {"headline_en": "Skrillex Announces Seoul Show"},
        ]
        self.assertEqual(
            select_index_harvest_item(items, "https://example.com/news/skrillex-announces-seoul-show"),
            [items[1]],
        )

    def test_trim_markdown_uses_first_stop_marker(self) -> None:
        self.assertEqual(trim_markdown("article\nMost Popular\nrelated", ["\nMost Popular\n"], 100), "article")

    def test_config_requires_every_key(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps({}), encoding="utf-8")
            with self.assertRaises(ValueError):
                load_config(path)


if __name__ == "__main__":
    unittest.main()
