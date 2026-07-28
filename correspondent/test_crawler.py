import json
import tempfile
import unittest
from pathlib import Path

from crawler import (
    EntityEntry,
    decide_entity_gate,
    entity_gate_detail,
    PlainHtmlExtractor,
    excluded_item_url_reason,
    extract_json_array,
    extract_explicit_event_dates,
    extract_event_json_ld_dates,
    find_surface_in_text,
    is_stale_news_event,
    load_config,
    load_entities,
    match_entities,
    match_entity_details,
    normalize_url,
    parse_listing_date,
    source_texts_for_items,
    RenderedPage,
    select_index_links,
    select_index_harvest_item,
    trim_markdown,
    date_supported_by_source,
    resolve_event_date,
    stable_text_hash,
    extract_page_image,
    extract_page_published_at,
    normalize_doc_type,
    normalize_facts,
    validate_harvest_item,
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

    def test_permalink_supplies_the_year_only_when_text_shows_month_and_day(self) -> None:
        url = "https://www.womb.co.jp/event/2026/07/25/watermelon/"
        self.assertTrue(date_supported_by_source("2026-07-25", "07/25 SAT WATERMELON", url))
        self.assertTrue(date_supported_by_source("2026-07-25", "7月25日 開催", url))
        # The permalink alone must never validate a date the page never prints.
        self.assertFalse(date_supported_by_source("2026-07-25", "WATERMELON at WOMB", url))
        # A different day in the permalink is not evidence either.
        self.assertFalse(date_supported_by_source("2026-07-26", "07/26 SUN", url))
        self.assertFalse(date_supported_by_source("2026-07-25", "07/25 SAT", ""))

    def test_multilingual_explicit_event_date_formats(self) -> None:
        cases = {
            "2026년 8월 29일": ["2026-08-29"],
            "2026年8月29日": ["2026-08-29"],
            "水29 7月 2026": ["2026-07-29"],
            "29 7月 2026": ["2026-07-29"],
            "29 July 2026": ["2026-07-29"],
            "July 29, 2026": ["2026-07-29"],
            "2026/08/29": ["2026-08-29"],
            "2026.08.29": ["2026-08-29"],
            "2026-08-29": ["2026-08-29"],
            "２０２６年８月２９日": ["2026-08-29"],
        }
        for source, expected in cases.items():
            with self.subTest(source=source):
                self.assertEqual(extract_explicit_event_dates(source), expected)

    def test_date_range_uses_first_day(self) -> None:
        self.assertEqual(
            extract_explicit_event_dates(
                "Friday, May 3 – Saturday, May 4, 2024 at M2 Miami",
            ),
            ["2024-05-03"],
        )

    def test_url_date_corrects_llm_year_only_with_body_month_day(self) -> None:
        url = "https://www.womb.co.jp/event/2026/07/29/show/"
        corrected = resolve_event_date("2023-07-29", "07/29 WED at WOMB", url)
        self.assertEqual(corrected.event_date, "2026-07-29")
        self.assertEqual(corrected.reason, "llm_date_corrected")
        self.assertEqual(corrected.evidence, "url_date_with_body_month_day")
        corrected_with_publication_date = resolve_event_date(
            "2023-07-29",
            "Published July 27, 2026. Event date: 07/29 WED at WOMB",
            url,
        )
        self.assertEqual(corrected_with_publication_date.event_date, "2026-07-29")
        self.assertEqual(corrected_with_publication_date.reason, "llm_date_corrected")
        rejected = resolve_event_date("2026-07-29", "WOMB announces a show", url)
        self.assertIsNone(rejected.event_date)
        self.assertEqual(rejected.reason, "url_date_without_body_month_day")

    def test_ambiguous_body_dates_require_exact_llm_choice(self) -> None:
        markdown = "Event A: July 29, 2026. Event B: August 1, 2026."
        ambiguous = resolve_event_date(None, markdown)
        self.assertIsNone(ambiguous.event_date)
        self.assertEqual(ambiguous.reason, "ambiguous_source_dates")
        selected = resolve_event_date("2026-08-01", markdown)
        self.assertEqual(selected.event_date, "2026-08-01")
        self.assertEqual(selected.reason, "llm_date_supported")

    def test_body_full_date_only_validates_matching_llm_date(self) -> None:
        missing = resolve_event_date(None, "Published July 27, 2026")
        self.assertIsNone(missing.event_date)
        self.assertEqual(missing.reason, "body_date_unconfirmed")
        self.assertEqual(missing.candidates, ("2026-07-27",))

        mismatched = resolve_event_date("2026-07-26", "Published July 27, 2026")
        self.assertIsNone(mismatched.event_date)
        self.assertEqual(mismatched.reason, "body_date_unconfirmed")
        self.assertEqual(mismatched.candidates, ("2026-07-27",))

    def test_json_ld_uses_only_event_start_date(self) -> None:
        html = (
            '<script type="application/ld+json">'
            '[{"@type":"NewsArticle","datePublished":"2026-07-20"},'
            '{"@type":"Event","startDate":"2026-08-29T20:00:00+09:00"}]'
            "</script>"
        )
        self.assertEqual(extract_event_json_ld_dates(html), ["2026-08-29"])
        decision = resolve_event_date(None, "No printed date", html=html)
        self.assertEqual(decision.event_date, "2026-08-29")
        preferred = resolve_event_date(None, "Article updated July 20, 2026", html=html)
        self.assertEqual(preferred.event_date, "2026-08-29")
        self.assertEqual(preferred.evidence, "json_ld_event_start_date")
        news_only = (
            '<script type="application/ld+json">'
            '{"@type":"NewsArticle","datePublished":"2026-07-20"}'
            "</script>"
        )
        self.assertEqual(extract_event_json_ld_dates(news_only), [])
        self.assertIsNone(resolve_event_date(None, "No event date", html=news_only).event_date)

    def test_azikazin_and_enter_shibuya_dates_are_preserved(self) -> None:
        self.assertEqual(
            resolve_event_date("2026-08-29", "開催日は2026년 8월 29일입니다").event_date,
            "2026-08-29",
        )
        self.assertEqual(
            resolve_event_date("2026-07-29", "ENTER SHIBUYA 水29 7月 2026").event_date,
            "2026-07-29",
        )

    def test_contextual_entity_policy_blocks_plain_verb_and_allows_music_context(self) -> None:
        root = Path(__file__).resolve().parents[1]
        entities = load_entities(root / "lib" / "edm-entities-v2.json")
        self.assertEqual(
            match_entities("The festival has revealed its lineup", "", entities),
            [],
        )
        self.assertEqual(
            match_entities("They revealed a new schedule", "", entities),
            [],
        )
        for headline in (
            "The label has revealed its lineup",
            "The record label revealed the festival schedule",
            "The label revealed dates yesterday",
            "Dates were revealed by the label",
        ):
            with self.subTest(headline=headline):
                self.assertNotIn(
                    "Revealed Recordings",
                    match_entities(headline, "", entities),
                )
        for headline in (
            "Released on Revealed",
            "Released via the Revealed label",
            "Signed to the Revealed label",
            "Revealed label announces a release",
            "Revealed Records announces a release",
            "Revealed Recordings announces a release",
        ):
            with self.subTest(headline=headline):
                self.assertIn(
                    "Revealed Recordings",
                    match_entities(headline, "", entities),
                )
        self.assertIn(
            "Revealed Recordings",
            match_entities("Released on Revealed Recordings", "", entities),
        )
        self.assertIn(
            "Revealed Recordings",
            match_entities("Signed to the Revealed label", "", entities),
        )
        self.assertIn(
            "Revealed Recordings",
            match_entities("Revealed Records announces a new release", "", entities),
        )
        self.assertIn("Skrillex", match_entities("Skrillex announces a show", "", entities))

    def test_entity_roles_gate_supporting_only_and_allow_qualifying(self) -> None:
        root = Path(__file__).resolve().parents[1]
        entities = load_entities(root / "lib" / "edm-entities-v2.json")

        home_matches = match_entity_details(
            "HOUSE ARCHIVE: Home Digging Fair",
            "Lifestyle brands exhibit at COEX THE PLATZ.",
            entities,
        )
        home_gate = decide_entity_gate(home_matches)
        self.assertFalse(home_gate.allowed)
        self.assertEqual(home_gate.reason, "supporting_entity_only")
        self.assertEqual([match.canonical for match in home_gate.qualifying], [])
        self.assertEqual(
            [match.canonical for match in home_gate.supporting],
            ["COEX THE PLATZ"],
        )

        mixed_gate = decide_entity_gate(match_entity_details(
            "Carl Cox performs at COEX THE PLATZ",
            "The DJ will headline an electronic music event.",
            entities,
        ))
        self.assertTrue(mixed_gate.allowed)
        self.assertIn("Carl Cox", [match.canonical for match in mixed_gate.qualifying])
        self.assertIn("COEX THE PLATZ", [match.canonical for match in mixed_gate.supporting])

        womb_gate = decide_entity_gate(match_entity_details(
            "WOMB announces its next club night",
            "",
            entities,
        ))
        self.assertTrue(womb_gate.allowed)
        self.assertIn("WOMB", [match.canonical for match in womb_gate.qualifying])

    def test_supporting_only_gate_detail_is_observable(self) -> None:
        matches = [
            EntityEntry("COEX THE PLATZ", ("coex the platz",), role="supporting"),
        ]
        gate = decide_entity_gate(match_entity_details(
            "Home Digging Fair at COEX THE PLATZ",
            "A lifestyle exhibition.",
            matches,
        ))
        detail = entity_gate_detail(
            gate,
            ["COEX THE PLATZ"],
            "logs/raw/rendered.txt",
            "logs/raw/llm.txt",
        )
        self.assertEqual(gate.reason, "supporting_entity_only")
        self.assertEqual(detail["qualifying_entities"], [])
        self.assertEqual(detail["supporting_entities"], ["COEX THE PLATZ"])
        self.assertEqual(detail["matched_surfaces"][0]["surface"], "coex the platz")
        self.assertEqual(detail["entities_en"], ["COEX THE PLATZ"])
        self.assertEqual(detail["rendered_raw_path"], "logs/raw/rendered.txt")
        self.assertEqual(detail["llm_raw_path"], "logs/raw/llm.txt")

    def test_invalid_entity_role_policy_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dictionary_path = root / "entities.json"
            policy_path = root / "entity-surface-policy.json"
            dictionary_path.write_text(json.dumps({
                "entities": [{"en": "WOMB", "aliases_en": []}],
            }), encoding="utf-8")
            policy_path.write_text(json.dumps({
                "version": 2,
                "entities": {"WOMB": {"role": "strong"}},
            }), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "invalid entity role"):
                load_entities(dictionary_path, policy_path)

    def test_entity_loader_validation_fails_closed(self) -> None:
        dictionary = {
            "entities": [
                {"en": "COEX THE PLATZ", "aliases_en": ["THE PLATZ"]},
                {"en": "Pioneer DJ", "aliases_en": ["Pioneer"]},
                {"en": "Disclosure", "aliases_en": []},
            ],
        }
        policy = {
            "version": 2,
            "entities": {
                "COEX THE PLATZ": {"role": "supporting"},
                "Disclosure": {
                    "contextual_surfaces": {
                        "Disclosure": {"after": ["release"], "max_gap_chars": 8},
                    },
                },
            },
        }
        cases = (
            ("missing entities", {}, policy, "entities must be an array"),
            (
                "contextual surfaces list",
                dictionary,
                {"version": 2, "entities": {
                    "Disclosure": {"contextual_surfaces": []},
                }},
                "contextual_surfaces.*must be an object",
            ),
            (
                "before string",
                dictionary,
                {"version": 2, "entities": {
                    "Disclosure": {
                        "contextual_surfaces": {
                            "Disclosure": {"before": "DJ duo"},
                        },
                    },
                }},
                "before must be an array",
            ),
            (
                "negative max gap",
                dictionary,
                {"version": 2, "entities": {
                    "Disclosure": {
                        "contextual_surfaces": {
                            "Disclosure": {"after": ["release"], "max_gap_chars": -1},
                        },
                    },
                }},
                "max_gap_chars must be a non-negative integer",
            ),
            (
                "missing canonical",
                dictionary,
                {"version": 2, "entities": {
                    "COEX THE PLAZ": {"role": "supporting"},
                }},
                "policy canonical not found",
            ),
            (
                "missing contextual surface",
                dictionary,
                {"version": 2, "entities": {
                    "Pioneer DJ": {
                        "contextual_surfaces": {
                            "Pioner": {"after": ["DJ"]},
                        },
                    },
                }},
                "policy contextual surface not found",
            ),
        )
        for name, entity_dictionary, surface_policy, expected in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                dictionary_path = root / "edm-entities-v2.json"
                policy_path = root / "entity-surface-policy.json"
                dictionary_path.write_text(
                    json.dumps(entity_dictionary),
                    encoding="utf-8",
                )
                policy_path.write_text(json.dumps(surface_policy), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, expected):
                    load_entities(dictionary_path, policy_path)

    def test_ambiguous_surfaces_require_specific_context(self) -> None:
        root = Path(__file__).resolve().parents[1]
        entities = load_entities(root / "lib" / "edm-entities-v2.json")
        cases = (
            ("Detroit techno pioneer John Collins", "Pioneer DJ", False),
            ("Rusko is a dubstep pioneer", "Pioneer DJ", False),
            ("Pioneer DJ launches a controller", "Pioneer DJ", True),
            ("Pioneer CDJ-3000 announced", "Pioneer DJ", True),
            ("a broad spectrum of dance music", "Spectrum Dance Music Festival", False),
            ("Spectrum Dance Music Festival announces dates", "Spectrum Dance Music Festival", True),
            ("a party on the beach", "THE BEACH", False),
            ("at the beach", "THE BEACH", False),
            ("THE BEACH Festival announces its lineup", "THE BEACH", True),
            ("disclosure of the lineup", "Disclosure", False),
            ("Disclosure release a new single", "Disclosure", True),
            ("DJ duo Disclosure announces a tour", "Disclosure", True),
        )
        for headline, canonical, expected in cases:
            with self.subTest(headline=headline):
                self.assertEqual(
                    canonical in match_entities(headline, "", entities),
                    expected,
                )

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

    def test_json_ld_news_publication_date_is_not_attached_as_event_date(self) -> None:
        parser = PlainHtmlExtractor()
        parser.feed('''<script type="application/ld+json">{"@type":"NewsArticle","url":"https://example.com/news/show/","datePublished":"2026-08-01"}</script><a href="https://example.com/news/show/">Show</a>''')
        _, links = parser.result()
        self.assertNotIn("structured_date", links[0])

    def test_og_image_wins_and_relative_paths_become_absolute(self) -> None:
        html = '<meta property="og:image" content="/media/hero.jpg">' \
               '<meta name="twitter:image" content="https://cdn.example/tw.jpg">' \
               '<img src="/media/body.jpg" width="900" height="600">'
        self.assertEqual(
            extract_page_image(html, "https://club.example/events/show/"),
            "https://club.example/media/hero.jpg",
        )

    def test_decorative_and_tiny_images_are_skipped_for_largest_body_image(self) -> None:
        html = (
            '<img src="/assets/site-logo.png" width="1200" height="1200">'
            '<img src="/assets/photo-small.jpg" width="80" height="80">'
            '<img src="/assets/flyer.jpg" width="640" height="960">'
            '<img src="/assets/wide.jpg" width="400" height="300">'
            '<img src="/assets/hero.svg" width="2000" height="2000">'
        )
        self.assertEqual(
            extract_page_image(html, "https://club.example/e/1"),
            "https://club.example/assets/flyer.jpg",
        )

    def test_twitter_image_used_when_og_absent(self) -> None:
        html = '<meta name="twitter:image" content="https://cdn.example/tw.jpg">'
        self.assertEqual(extract_page_image(html, "https://x.example/"), "https://cdn.example/tw.jpg")

    def test_page_published_at_prefers_structured_data_and_returns_none_when_absent(self) -> None:
        self.assertEqual(
            extract_page_published_at(
                '<script type="application/ld+json">'
                '{"@type":"NewsArticle","datePublished":"2026-07-20T09:30:00+09:00"}</script>'
            ),
            "2026-07-20T09:30:00+09:00",
        )
        self.assertEqual(
            extract_page_published_at('<meta property="article:published_time" content="2026-07-18">'),
            "2026-07-18T00:00:00+00:00",
        )
        self.assertIsNone(extract_page_published_at("<html><body>no dates here</body></html>"))
        # A bare <time> on an event page carries the event date, not a byline date.
        self.assertIsNone(extract_page_published_at('<time datetime="2026-07-27T00:00:00.000Z"></time>'))
        self.assertEqual(
            extract_page_published_at('<time class="entry-date published" datetime="2026-07-05"></time>'),
            "2026-07-05T00:00:00+00:00",
        )
        self.assertEqual(
            extract_page_published_at('<time itemprop="datePublished" datetime="2026-07-06"></time>'),
            "2026-07-06T00:00:00+00:00",
        )

    def test_doc_type_normalizes_and_rejects_unknown_values(self) -> None:
        self.assertEqual(normalize_doc_type("Preview"), "preview")
        self.assertEqual(normalize_doc_type("recap"), "recap")
        self.assertIsNone(normalize_doc_type("announcement"))
        self.assertIsNone(normalize_doc_type(None))

    def test_facts_drop_blank_placeholder_and_unknown_keys(self) -> None:
        self.assertEqual(
            normalize_facts(
                {
                    "lineup": ["Skrillex", " Tiesto ", "", "TBA", "Skrillex"],
                    "venue": "WOMB",
                    "city": "",
                    "open_time": "22:00",
                    "close_time": "N/A",
                    "ticket_price": 3500,
                    "ticket_url": "/tickets/1",
                    "promoter": "ignored",
                },
                "https://www.womb.co.jp/event/1",
            ),
            {
                "lineup": ["Skrillex", "Tiesto"],
                "venue": "WOMB",
                "open_time": "22:00",
                "ticket_price": "3500",
                "ticket_url": "https://www.womb.co.jp/tickets/1",
            },
        )
        self.assertIsNone(normalize_facts({"venue": "  "}))
        self.assertIsNone(normalize_facts("not an object"))

    def test_missing_or_malformed_new_fields_do_not_discard_the_item(self) -> None:
        item = validate_harvest_item({"headline_en": "Show announced", "summary_en": "Details."})
        self.assertIsNone(item["doc_type"])
        self.assertIsNone(item["facts"])
        self.assertIsNone(item["event_date"])
        self.assertEqual(item["entities_en"], [])
        self.assertEqual(item["image_urls"], [])
        broken = validate_harvest_item({
            "headline_en": "Show announced",
            "summary_en": "Details.",
            "doc_type": 7,
            "facts": ["not", "an", "object"],
            "event_date": "next friday",
            "entities_en": "Skrillex",
            "confidence": "high",
        })
        self.assertIsNone(broken["doc_type"])
        self.assertIsNone(broken["facts"])
        self.assertIsNone(broken["event_date"])
        self.assertEqual(broken["entities_en"], ["Skrillex"])
        self.assertEqual(broken["confidence"], 0.0)

    def test_config_requires_every_key(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps({}), encoding="utf-8")
            with self.assertRaises(ValueError):
                load_config(path)


if __name__ == "__main__":
    unittest.main()
