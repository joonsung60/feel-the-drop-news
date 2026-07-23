import json
import tempfile
import unittest
from pathlib import Path

from crawler import (
    EntityEntry,
    PlainHtmlExtractor,
    excluded_item_url_reason,
    extract_json_array,
    find_surface_in_text,
    is_stale_news_event,
    load_config,
    match_entities,
    normalize_url,
    parse_listing_date,
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
        self.assertTrue(
            date_supported_by_source(
                "2024-05-03",
                "Friday, May 3 – Saturday, May 4, 2024 at M2 Miami",
            ),
        )
        self.assertFalse(date_supported_by_source("2026-01-01", "World DJ Festival 2026"))
        self.assertFalse(date_supported_by_source("2026-13-40", "2026-13-40"))

    def test_index_links_exclude_listing_and_month_archives(self) -> None:
        page = RenderedPage(
            "https://example.com/event/",
            "https://example.com/event/",
            "events",
            (
                {"href": "https://example.com/event", "text": "Events"},
                {"href": "https://example.com/event/2026/07", "text": "July"},
                {"href": "https://example.com/event/2026/07/22", "text": "July 22"},
                {"href": "https://example.com/event/artist-0722/?utm_source=x", "text": "Artist Night"},
            ),
            "plain",
        )
        self.assertEqual(
            select_index_links(
                page,
                20,
                ["utm_*"],
                exclude_patterns=[
                    {
                        "reason": "archive_excluded",
                        "pattern": r"/(?:19|20)\d{2}[-/](?:0?[1-9]|1[0-2])(?:/(?:0?[1-9]|[12]\d|3[01]))?/?$",
                    },
                ],
            ),
            ["https://example.com/event/artist-0722/"],
        )

    def test_index_links_log_and_exclude_pagination_and_archives(self) -> None:
        page = RenderedPage(
            "https://example.com/news/",
            "https://example.com/news/",
            "news",
            (
                {"href": "/news/page/3/", "text": "Older posts"},
                {"href": "/news?paged=4", "text": "More news"},
                {"href": "/news/p/5", "text": "Page five"},
                {"href": "/news?topic=all&page=6", "text": "Page six"},
                {"href": "/news/category/releases/", "text": "Release archive"},
                {"href": "/news/2026/06/", "text": "June archive"},
                {"href": "/news/2026/06/23/", "text": "Daily archive"},
                {"href": "/news/fresh-story", "text": "Fresh story headline"},
            ),
            "plain",
        )
        patterns = [
            {
                "reason": "pagination_excluded",
                "pattern": r"(?:/page/\d+/?$|/p/\d+/?$|[?&](?:paged|page)=\d+(?:&|$))",
            },
            {
                "reason": "archive_excluded",
                "pattern": r"/(?:category|categories|tag|tags|archive|archives)(?:/|$)",
            },
            {
                "reason": "archive_excluded",
                "pattern": r"/(?:19|20)\d{2}[-/](?:0?[1-9]|1[0-2])(?:/(?:0?[1-9]|[12]\d|3[01]))?/?$",
            },
        ]
        observed = []
        selected = select_index_links(
            page,
            20,
            [],
            selection_observer=lambda url, parsed_date, date_class, reason: observed.append(
                (url, date_class, reason),
            ),
            exclude_patterns=patterns,
        )
        self.assertEqual(selected, ["https://example.com/news/fresh-story"])
        self.assertEqual(
            [reason for _, _, reason in observed if reason != "selected"],
            [
                "pagination_excluded",
                "pagination_excluded",
                "pagination_excluded",
                "pagination_excluded",
                "archive_excluded",
                "archive_excluded",
                "archive_excluded",
            ],
        )
        self.assertTrue(all(date_class == "excluded" for _, date_class, reason in observed if reason != "selected"))

    def test_excluded_item_url_reason_returns_configured_reason(self) -> None:
        self.assertEqual(
            excluded_item_url_reason(
                "https://example.com/news/page/25/",
                [{"reason": "pagination_excluded", "pattern": r"/page/\d+/?$"}],
            ),
            "pagination_excluded",
        )

    def test_stale_news_filter_allows_null_and_includes_cutoff_day(self) -> None:
        today = __import__("datetime").date(2026, 7, 23)
        self.assertFalse(is_stale_news_event(None, today, 30))
        self.assertFalse(is_stale_news_event("2026-06-23", today, 30))
        self.assertTrue(is_stale_news_event("2026-06-22", today, 30))
        self.assertFalse(is_stale_news_event("2026-07-24", today, 30))
        self.assertFalse(is_stale_news_event("2026-13-40", today, 30))

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
            "plain",
        )
        self.assertEqual(select_index_links(page, 20, []), ["https://ra.co/events/2204523"])

    def test_ultra_news_selects_worldwide_articles_not_pagination(self) -> None:
        page = RenderedPage(
            "https://ultrakorea.com/ko/news/",
            "https://ultrakorea.com/ko/news/",
            "news",
            (
                {"href": "/ko/lineup/", "text": "Current lineup information"},
                {
                    "href": "/ko/worldwide/fresh-ultra-story/",
                    "text": "Fresh Ultra worldwide story headline",
                },
                {"href": "/ko/news/page/3/", "text": "3"},
                {"href": "/ko/news/page/25/", "text": "25"},
            ),
            "plain",
        )
        observed = []
        self.assertEqual(
            select_index_links(
                page,
                2,
                [],
                selection_observer=lambda url, parsed_date, date_class, reason: observed.append(
                    (url, reason),
                ),
                exclude_patterns=[
                    {"reason": "pagination_excluded", "pattern": r"/page/\d+/?$"},
                ],
            ),
            ["https://ultrakorea.com/ko/worldwide/fresh-ultra-story/"],
        )
        self.assertEqual(
            [url for url, reason in observed if reason == "pagination_excluded"],
            [
                "https://ultrakorea.com/ko/news/page/3/",
                "https://ultrakorea.com/ko/news/page/25/",
            ],
        )

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

    def test_parse_listing_date_supports_generic_formats(self) -> None:
        today = __import__("datetime").date(2026, 7, 22)
        self.assertEqual(str(parse_listing_date("2026/07/24", today)), "2026-07-24")
        self.assertEqual(str(parse_listing_date("07.24", today)), "2026-07-24")
        self.assertEqual(str(parse_listing_date("24 Jul", today)), "2026-07-24")
        self.assertEqual(str(parse_listing_date("7月24日", today)), "2026-07-24")

    def test_index_links_prioritize_future_and_drop_past_events(self) -> None:
        today = __import__("datetime").date(2026, 7, 22)
        page = RenderedPage(
            "https://club.example/events",
            "https://club.example/events",
            "events",
            (
                {"href": "/events/past", "text": "07.04 Past Night"},
                {"href": "/events/unknown", "text": "Mystery Night"},
                {"href": "/events/later", "text": "2026/08/08 Later Night"},
                {"href": "/events/near", "text": "24 Jul Near Night"},
            ),
            "plain",
        )
        self.assertEqual(
            select_index_links(page, 4, [], today),
            [
                "https://club.example/events/near",
                "https://club.example/events/later",
                "https://club.example/events/unknown",
            ],
        )

    def test_qwen_think_block_is_removed_before_json_parse(self) -> None:
        self.assertEqual(extract_json_array('<think>reasoning [not json]</think>\n[{"ok": true}]'), [{"ok": True}])

    def test_json_ld_event_date_is_attached_to_matching_link(self) -> None:
        parser = PlainHtmlExtractor()
        parser.feed('''<script type="application/ld+json">{"@type":"Event","url":"https://example.com/events/show/","startDate":"2026-08-01T20:00:00+09:00"}</script><a href="https://example.com/events/show/">Show</a>''')
        _, links = parser.result()
        self.assertEqual(links[0]["structured_date"], "2026-08-01T20:00:00+09:00")

    def test_config_requires_every_key(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps({}), encoding="utf-8")
            with self.assertRaises(ValueError):
                load_config(path)


if __name__ == "__main__":
    unittest.main()
