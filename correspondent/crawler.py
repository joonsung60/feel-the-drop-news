#!/usr/bin/env python3
"""FEEL THE DROP correspondent crawler.

This is deliberately independent from the Next.js runtime. It reads active
beats through Supabase's REST API, renders pages with Crawl4AI, harvests EDM
news through local Ollama, gates results with the v2 entity dictionary, and
only then inserts new raw_articles rows.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import os
import re
import sys
import time
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable, Iterable
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv
from pipeline_observer import PipelineObserver

# Keep Crawl4AI's database/cache inside the standalone process directory. This
# also avoids assuming that the WSL home directory is writable.
os.environ.setdefault("CRAWL4_AI_BASE_DIRECTORY", str(Path(__file__).resolve().parent))
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(Path(__file__).resolve().parent / ".playwright"))

try:
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig
except ImportError:  # Give a focused setup error instead of a traceback at import time.
    AsyncWebCrawler = BrowserConfig = CacheMode = CrawlerRunConfig = None  # type: ignore[assignment]


HARVEST_PROMPT = """You are a wire-service correspondent for an EDM news outlet covering the Asian
music market. You are given the rendered text of ONE web page. The page may be
written in Korean, Japanese, or English. Your job: find every genuine EDM news
item on the page and report it, normalizing everything into English.

Output a JSON array. Each element is ONE distinct news item. Fields per item:
  headline_en   Concise English headline.
  summary_en    2 to 4 sentence English summary of what the news is.
  entities_en   Array of names actually mentioned on the page (artists,
                festivals, labels, venues, clubs), in standard English form.
  news_type     One of: festival_lineup, club_event, release, tour, award, other
  event_date    The date the news refers to, as YYYY-MM-DD, or null.
  image_urls    Array of image URLs on the page belonging to this item. [] if none.
  source_lang   Language of the original page content: ko, ja, en, or other.
  confidence    0.0 to 1.0 — how confident you understood the page.

Rules:
- headline_en, summary_en, entities_en MUST be in English. Translate or
  transliterate names into their commonly-used English forms.
- Do NOT invent. If the page carries no real EDM news, return: []
- Report only what the text states. Missing detail = null or empty array.
  Never guess a date, entity, or fact not on the page.
- entities_en contains only names that actually appear on the page.
- One array element per distinct news event. A single lineup announcement is
  one item even if it names many artists.

Output ONLY the JSON array. No explanation, no markdown code fences, no text
before or after."""

NEWS_TYPES = {"festival_lineup", "club_event", "release", "tour", "award", "other"}
SOURCE_LANGS = {"ko", "ja", "en", "other"}
ASCII_ALNUM = re.compile(r"[a-z0-9]")
WORD = re.compile(r"[a-z0-9]{2,}")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MONTH_NAMES = (
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
)
MONTH_NUMBER = {
    name: number
    for number, name in enumerate(MONTH_NAMES, start=1)
}
MONTH_NUMBER.update({name[:3]: number for number, name in enumerate(MONTH_NAMES, start=1)})
THINK_BLOCK = re.compile(r"<think\b[^>]*>.*?</think\s*>", re.IGNORECASE | re.DOTALL)
DATE_PATTERNS = (
    re.compile(r"(?<!\d)(?P<year>20\d{2})\s*[/.-]\s*(?P<month>\d{1,2})\s*[/.-]\s*(?P<day>\d{1,2})(?!\d)"),
    re.compile(r"(?<!\d)(?P<year>20\d{2})\s*年\s*(?P<month>\d{1,2})\s*月\s*(?P<day>\d{1,2})\s*日?"),
    re.compile(r"(?<!\d)(?P<month>\d{1,2})\s*月\s*(?P<day>\d{1,2})\s*日"),
    re.compile(r"(?<!\d)(?P<month>\d{1,2})\s*[/.-]\s*(?P<day>\d{1,2})(?!\s*[/.-]\s*\d)"),
    re.compile(r"(?<!\d)(?P<day>\d{1,2})(?:st|nd|rd|th)?\s+(?P<month_name>[A-Za-z]{3,9})(?:\s+(?P<year>20\d{2}))?", re.IGNORECASE),
    re.compile(r"(?P<month_name>[A-Za-z]{3,9})\.?\s+(?P<day>\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(?P<year>20\d{2}))?", re.IGNORECASE),
)
ITEM_PATH_HINT = re.compile(
    r"/(?:news|article|articles|event|events|party|schedule|lineup|posts?|topics?)/|"
    r"/\d{4}/(?:\d{1,2}/)?|/\d{4}-\d{1,2}-\d{1,2}(?:/|$)",
    re.IGNORECASE,
)
WORLDWIDE_NEWS_ITEM_PATH = re.compile(r"/worldwide/[^/]+/?$", re.IGNORECASE)
SKIP_PATH = re.compile(
    r"\.(?:avif|css|gif|ico|jpe?g|js|json|mp3|mp4|pdf|png|svg|webp|xml)(?:$|\?)",
    re.IGNORECASE,
)
SKIP_LINK_TEXT = re.compile(
    r"^(?:home|about|contact|privacy|terms|login|sign in|sign up|search|menu|next|previous|"
    r"facebook|instagram|twitter|x|youtube|tiktok|more)$",
    re.IGNORECASE,
)
SKIP_ROUTE_SEGMENTS = {
    "about", "contact", "cookiepolicy", "create", "login", "privacy",
    "register", "search", "signup", "terms",
}
COLLECTION_SEGMENTS = {"article", "articles", "event", "events", "news", "post", "posts", "schedule"}


@dataclass(frozen=True)
class Beat:
    name: str
    url: str
    crawl_mode: str


@dataclass
class BeatSummary:
    fetch_mode: str | None = None
    fetched: int = 0
    harvested: int = 0
    gated_out: int = 0
    inserted: int = 0
    dup: int = 0
    errors: int = 0
    average_seconds_per_page: float = 0.0


@dataclass(frozen=True)
class EntityEntry:
    canonical: str
    surfaces: tuple[str, ...]


@dataclass(frozen=True)
class RenderedPage:
    requested_url: str
    final_url: str
    markdown: str
    links: tuple[dict[str, Any], ...]
    fetch_mode: str


class PlainHtmlExtractor(HTMLParser):
    """Small dependency-free HTML-to-text/link extractor for the plain path."""

    BLOCK_TAGS = {"article", "br", "div", "h1", "h2", "h3", "h4", "li", "main", "p", "section"}
    IGNORED_TAGS = {"noscript", "script", "style", "svg", "template"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.links: list[dict[str, Any]] = []
        self.ignored_depth = 0
        self.anchor: dict[str, Any] | None = None
        self.json_ld_depth = 0
        self.json_ld_parts: list[str] = []
        self.json_ld_documents: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        values = dict(attrs)
        if tag == "script" and str(values.get("type") or "").lower() == "application/ld+json":
            self.json_ld_depth = 1
            self.json_ld_parts = []
            return
        if tag in self.IGNORED_TAGS:
            self.ignored_depth += 1
            return
        if self.ignored_depth:
            return
        if tag in self.BLOCK_TAGS:
            self.parts.append("\n")
        if tag == "a":
            self.anchor = {"href": values.get("href"), "title": values.get("title"), "parts": []}

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "script" and self.json_ld_depth:
            self.json_ld_documents.append("".join(self.json_ld_parts))
            self.json_ld_depth = 0
            self.json_ld_parts = []
            return
        if tag in self.IGNORED_TAGS and self.ignored_depth:
            self.ignored_depth -= 1
            return
        if self.ignored_depth:
            return
        if tag == "a" and self.anchor is not None:
            text = " ".join(self.anchor.pop("parts")).strip()
            context_before = " ".join("".join(self.parts).split()[-20:])
            self.links.append({**self.anchor, "text": text, "context_before": context_before})
            self.anchor = None
        if tag in self.BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self.json_ld_depth:
            self.json_ld_parts.append(data)
            return
        if self.ignored_depth or not data.strip():
            return
        self.parts.append(data)
        if self.anchor is not None:
            self.anchor["parts"].append(data)

    def result(self) -> tuple[str, tuple[dict[str, Any], ...]]:
        text = re.sub(r"[ \t]+", " ", "".join(self.parts))
        text = re.sub(r"\n\s*\n+", "\n\n", text).strip()
        structured_dates: dict[str, str] = {}

        def collect(value: Any) -> None:
            if isinstance(value, list):
                for child in value:
                    collect(child)
            elif isinstance(value, dict):
                item_url = value.get("url")
                start_date = value.get("startDate") or value.get("datePublished")
                if isinstance(item_url, str) and isinstance(start_date, str):
                    structured_dates[item_url.rstrip("/")] = start_date
                for child in value.values():
                    if isinstance(child, (dict, list)):
                        collect(child)

        for document in self.json_ld_documents:
            try:
                collect(json.loads(document))
            except json.JSONDecodeError:
                continue
        for link in self.links:
            href = link.get("href")
            if isinstance(href, str):
                structured_date = structured_dates.get(href.rstrip("/"))
                if structured_date:
                    link["structured_date"] = structured_date
        return text, tuple(self.links)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_config(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        config = json.load(handle)
    required = {
        "tracking_query_denylist", "item_url_exclude_patterns",
        "news_beats", "news_max_age_days", "max_index_items", "crawl_timeout_ms",
        "plain_http_timeout_seconds", "plain_text_min_chars", "plain_http_user_agent",
        "ollama_timeout_seconds", "markdown_max_chars", "content_stop_markers",
    }
    missing = sorted(required - config.keys())
    if missing:
        raise ValueError(f"Missing config keys: {', '.join(missing)}")
    for entry in config["item_url_exclude_patterns"]:
        if not isinstance(entry, dict) or not isinstance(entry.get("reason"), str):
            raise ValueError("item_url_exclude_patterns entries require a string reason")
        if not isinstance(entry.get("pattern"), str):
            raise ValueError("item_url_exclude_patterns entries require a string pattern")
        re.compile(entry["pattern"])
    if not isinstance(config["news_beats"], list) or not all(
        isinstance(name, str) for name in config["news_beats"]
    ):
        raise ValueError("news_beats must be a list of strings")
    if not isinstance(config["news_max_age_days"], int) or config["news_max_age_days"] < 0:
        raise ValueError("news_max_age_days must be a non-negative integer")
    return config


def is_denied_query_key(key: str, denylist: Iterable[str]) -> bool:
    lowered = key.lower()
    for pattern in denylist:
        candidate = pattern.lower()
        if candidate.endswith("*") and lowered.startswith(candidate[:-1]):
            return True
        if lowered == candidate:
            return True
    return False


def normalize_url(url: str, denylist: Iterable[str]) -> str:
    """Remove only configured tracking keys; preserve all other URL components."""
    parts = urlsplit(url)
    kept = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if not is_denied_query_key(key, denylist)
    ]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(kept, doseq=True), parts.fragment))


def host_key(url: str) -> str:
    host = (urlsplit(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def stable_text_hash(text: str) -> str:
    normalized = re.sub(r"\s+", " ", text).strip()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]


def load_entities(path: Path) -> list[EntityEntry]:
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    entries: list[EntityEntry] = []
    for raw in data.get("entities", []):
        name = raw.get("en")
        if not isinstance(name, str) or not name:
            continue
        raw_surfaces = [name, *(raw.get("aliases_en") or [])]
        surfaces = tuple(
            value.lower()
            for value in raw_surfaces
            if isinstance(value, str) and len(value) >= 2
        )
        if surfaces:
            entries.append(EntityEntry(canonical=name, surfaces=surfaces))
    return entries


def find_surface_in_text(text: str, surface: str) -> bool:
    """Exact port of lib/suggest/entity-index.ts findSurfaceInText semantics."""
    if not surface or len(surface) < 2:
        return False
    start = 0
    while True:
        index = text.find(surface, start)
        if index < 0:
            return False
        before = " " if index == 0 else text[index - 1]
        end = index + len(surface)
        after = " " if end >= len(text) else text[end]
        if not ASCII_ALNUM.search(before) and not ASCII_ALNUM.search(after):
            return True
        start = index + 1


def match_entities(headline: str, summary: str, entities: Iterable[EntityEntry]) -> list[str]:
    # The TS matcher limits raw article content to 500 characters.
    haystack = f"{headline}\n{summary[:500]}".lower()
    matches: list[str] = []
    for entry in entities:
        if any(find_surface_in_text(haystack, surface) for surface in entry.surfaces):
            matches.append(entry.canonical)
    return matches


def extract_json_array(raw: str) -> list[Any]:
    # qwen3-family models may wrap analysis in one or more <think> blocks.
    # Remove only those tagged blocks before applying the strict array parser.
    text = THINK_BLOCK.sub("", raw).strip()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return parsed
    except json.JSONDecodeError:
        pass

    # Covers code fences and prose wrappers without accepting an object or making up content.
    decoder = json.JSONDecoder()
    for index, char in enumerate(text):
        if char != "[":
            continue
        try:
            parsed, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, list):
            return parsed
    raise ValueError("Ollama response did not contain a JSON array")


def validate_harvest_item(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("harvest item is not an object")
    headline = raw.get("headline_en")
    summary = raw.get("summary_en")
    if not isinstance(headline, str) or not headline.strip():
        raise ValueError("headline_en is empty")
    if not isinstance(summary, str) or not summary.strip():
        raise ValueError("summary_en is empty")
    entities = raw.get("entities_en")
    images = raw.get("image_urls")
    if not isinstance(entities, list) or not all(isinstance(value, str) for value in entities):
        raise ValueError("entities_en must be a string array")
    if not isinstance(images, list) or not all(isinstance(value, str) for value in images):
        raise ValueError("image_urls must be a string array")
    event_date = raw.get("event_date")
    if event_date is not None and (not isinstance(event_date, str) or not DATE.fullmatch(event_date)):
        raise ValueError("event_date must be YYYY-MM-DD or null")
    news_type = raw.get("news_type")
    source_lang = raw.get("source_lang")
    confidence = raw.get("confidence")
    if news_type not in NEWS_TYPES:
        raise ValueError("invalid news_type")
    if source_lang not in SOURCE_LANGS:
        raise ValueError("invalid source_lang")
    if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
        raise ValueError("confidence must be numeric")
    return {
        "headline_en": headline.strip(),
        "summary_en": summary.strip(),
        "entities_en": entities,
        "news_type": news_type,
        "event_date": event_date,
        "image_urls": images,
        "source_lang": source_lang,
        "confidence": float(confidence),
    }


def markdown_blocks(markdown: str) -> list[str]:
    blocks = [block.strip() for block in re.split(r"(?m)(?=^#{1,4}\s+)", markdown) if block.strip()]
    return blocks or [markdown]


def source_texts_for_items(markdown: str, items: list[dict[str, Any]]) -> list[str]:
    """Assign each page-mode result deterministic source text for anchor hashing."""
    blocks = markdown_blocks(markdown)
    available = set(range(len(blocks)))
    assigned: list[str] = []
    used_hashes: set[str] = set()
    for ordinal, item in enumerate(items):
        needles = set(WORD.findall(
            " ".join([item["headline_en"], *item["entities_en"]]).lower()
        ))
        ranked = sorted(
            available,
            key=lambda index: len(needles & set(WORD.findall(blocks[index].lower()))),
            reverse=True,
        )
        if ranked:
            chosen = ranked[0]
            available.remove(chosen)
            source_text = blocks[chosen]
        else:
            # More results than headings: use a stable, non-overlapping source-page slice.
            width = max(1, len(markdown) // len(items))
            source_text = markdown[ordinal * width:(ordinal + 1) * width]
        source_hash = stable_text_hash(source_text)
        if source_hash in used_hashes:
            # Repeated cards/headings occur on some rendered pages. Add deterministic
            # neighboring page text, never LLM output, to keep source-derived URLs unique.
            width = max(1, len(markdown) // len(items))
            start = ordinal * width
            source_text = f"{source_text}\n{markdown[start:(ordinal + 1) * width]}"
            source_hash = stable_text_hash(source_text)
        assigned.append(source_text)
        used_hashes.add(source_hash)
    return assigned


def date_supported_by_source(event_date: str, markdown: str) -> bool:
    """Reject synthesized dates unless the full date is evidenced in source text."""
    if not DATE.fullmatch(event_date):
        return False
    try:
        date.fromisoformat(event_date)
    except ValueError:
        return False
    year, month_text, day_text = event_date.split("-")
    month = int(month_text)
    day = int(day_text)
    escaped_year = re.escape(year)
    numeric_patterns = (
        rf"{escaped_year}\s*[-/.]\s*0?{month}\s*[-/.]\s*0?{day}(?!\d)",
        rf"{escaped_year}\s*年\s*0?{month}\s*月\s*0?{day}\s*日",
        rf"(?<!\d)0?{month}\s*[-/.]\s*0?{day}\s*[-/.]\s*{escaped_year}",
    )
    lowered = markdown.lower()
    if any(re.search(pattern, lowered) for pattern in numeric_patterns):
        return True
    month_name = MONTH_NAMES[month - 1]
    short_name = month_name[:3]
    named_patterns = (
        rf"(?:{month_name}|{short_name})\.?\s+{day}(?:st|nd|rd|th)?(?:,)?\s+{escaped_year}",
        rf"{day}(?:st|nd|rd|th)?\s+(?:{month_name}|{short_name})\.?\s+{escaped_year}",
        rf"(?:{month_name}|{short_name})\.?\s+{day}(?:st|nd|rd|th)?\b[^\n]{{0,80}}\b{escaped_year}",
    )
    return any(re.search(pattern, lowered) for pattern in named_patterns)


def select_index_harvest_item(items: list[dict[str, Any]], final_url: str) -> list[dict[str, Any]]:
    """An index detail URL represents one item, even if boilerplate leaked into markdown."""
    if len(items) <= 1:
        return items
    slug_words = set(WORD.findall(urlsplit(final_url).path.lower()))
    ranked = sorted(
        enumerate(items),
        key=lambda pair: (
            len(slug_words & set(WORD.findall(pair[1]["headline_en"].lower()))),
            -pair[0],
        ),
        reverse=True,
    )
    return [ranked[0][1]]


def trim_markdown(markdown: str, stop_markers: Iterable[str], max_chars: int) -> str:
    end = len(markdown)
    for marker in stop_markers:
        index = markdown.find(marker)
        if index >= 0:
            end = min(end, index)
    return markdown[:end][:max_chars]


def infer_partial_date(month: int, day: int, today: date) -> date | None:
    """Resolve a month/day near today, allowing listings that cross New Year."""
    candidates: list[date] = []
    for year in (today.year - 1, today.year, today.year + 1):
        try:
            candidates.append(date(year, month, day))
        except ValueError:
            continue
    if not candidates:
        return None
    return min(candidates, key=lambda value: abs((value - today).days))


def parse_listing_date(text: str, today: date) -> date | None:
    normalized = re.sub(r"\s+", " ", text)
    for pattern in DATE_PATTERNS:
        match = pattern.search(normalized)
        if not match:
            continue
        groups = match.groupdict()
        month_name = (groups.get("month_name") or "").lower().rstrip(".")
        month = MONTH_NUMBER.get(month_name) if month_name else int(groups["month"])
        if month is None:
            continue
        day = int(groups["day"])
        year_text = groups.get("year")
        if year_text:
            try:
                return date(int(year_text), month, day)
            except ValueError:
                continue
        inferred = infer_partial_date(month, day, today)
        if inferred is not None:
            return inferred
    return None


def is_news_collection(url: str) -> bool:
    segments = {segment.lower() for segment in urlsplit(url).path.split("/") if segment}
    return bool(segments & {"news", "article", "articles", "post", "posts", "topics"})


def is_bare_collection_path(path: str) -> bool:
    segments = [segment.lower() for segment in path.split("/") if segment]
    return bool(segments) and segments[-1] in COLLECTION_SEGMENTS


def select_collection_links(page: RenderedPage, denylist: Iterable[str]) -> list[str]:
    base_host = host_key(page.final_url)
    found: list[str] = []
    for link in page.links:
        href = link.get("href")
        if not isinstance(href, str):
            continue
        absolute = normalize_url(urljoin(page.final_url, href), denylist)
        parts = urlsplit(absolute)
        if parts.scheme not in {"http", "https"} or host_key(absolute) != base_host:
            continue
        if is_bare_collection_path(parts.path):
            without_fragment = urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))
            if without_fragment not in found:
                found.append(without_fragment)
    return found


def excluded_item_url_reason(
    url: str,
    exclude_patterns: Iterable[dict[str, str]],
) -> str | None:
    for entry in exclude_patterns:
        if re.search(entry["pattern"], url, re.IGNORECASE):
            return entry["reason"]
    return None


def is_stale_news_event(
    event_date: str | None,
    today: date,
    max_age_days: int,
) -> bool:
    if event_date is None:
        return False
    try:
        parsed = date.fromisoformat(event_date)
    except ValueError:
        return False
    return parsed < today - timedelta(days=max_age_days)


def select_index_links(
    page: RenderedPage,
    max_items: int,
    denylist: Iterable[str],
    today: date | None = None,
    selection_observer: Callable[[str, date | None, str, str], None] | None = None,
    exclude_patterns: Iterable[dict[str, str]] = (),
) -> list[str]:
    today = today or datetime.now(ZoneInfo("Asia/Seoul")).date()
    base_host = host_key(page.final_url)
    base_normalized = normalize_url(page.final_url, denylist)
    base_parts = urlsplit(base_normalized)
    base_segments = [segment for segment in base_parts.path.lower().split("/") if segment]
    collection_prefix = ""
    for marker in ("news", "article", "articles", "event", "events"):
        if marker in base_segments:
            marker_index = base_segments.index(marker)
            collection_prefix = "/" + "/".join(base_segments[:marker_index + 1])
            break
    candidates: list[tuple[int, int, str, date | None]] = []
    seen: set[str] = set()
    for position, link in enumerate(page.links):
        href = link.get("href")
        if not isinstance(href, str) or not href.strip():
            continue
        absolute = normalize_url(urljoin(page.final_url, href), denylist)
        parts = urlsplit(absolute)
        if parts.scheme not in {"http", "https"} or host_key(absolute) != base_host:
            continue
        without_fragment = urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))
        exclusion_reason = excluded_item_url_reason(without_fragment, exclude_patterns)
        if exclusion_reason:
            if selection_observer:
                selection_observer(without_fragment, None, "excluded", exclusion_reason)
            continue
        path_segments = [segment.lower() for segment in parts.path.split("/") if segment]
        if (
            parts.path.rstrip("/") == base_parts.path.rstrip("/")
            or is_bare_collection_path(parts.path)
            or any(segment in SKIP_ROUTE_SEGMENTS for segment in path_segments)
            or (
                collection_prefix
                and not parts.path.lower().startswith(collection_prefix + "/")
                and not WORLDWIDE_NEWS_ITEM_PATH.search(parts.path)
            )
        ):
            continue
        if without_fragment in seen or SKIP_PATH.search(without_fragment):
            continue
        text = str(link.get("text") or link.get("title") or "").strip()
        if SKIP_LINK_TEXT.fullmatch(text):
            continue
        seen.add(without_fragment)
        score = 0
        if ITEM_PATH_HINT.search(parts.path + "/") or WORLDWIDE_NEWS_ITEM_PATH.search(parts.path):
            score += 5
        if len(text) >= 12:
            score += 2
        if len([part for part in parts.path.split("/") if part]) >= 2:
            score += 1
        if score >= 2:
            date_text = " ".join(
                str(link.get(key) or "")
                for key in ("structured_date", "href", "context_before", "text", "title")
            )
            candidates.append((-score, position, without_fragment, parse_listing_date(date_text, today)))

    dated_count = sum(item_date is not None for _, _, _, item_date in candidates)
    if dated_count == 0:
        candidates.sort(key=lambda item: (item[0], item[1]))
        logging.info("index date selection: no dates detected; preserving existing order")
        selected_urls = [url for _, _, url, _ in candidates[:max_items]]
        if selection_observer:
            selected_set = set(selected_urls)
            for _, _, url, item_date in candidates:
                selection_observer(
                    url, item_date, "unknown", "selected" if url in selected_set else "cap_exceeded",
                )
        return selected_urls

    news_collection = is_news_collection(page.final_url)
    future = sorted(
        (item for item in candidates if item[3] is not None and item[3] >= today),
        key=lambda item: (item[3], item[1]),
    )
    unknown = sorted((item for item in candidates if item[3] is None), key=lambda item: (item[0], item[1]))
    past = sorted(
        (item for item in candidates if item[3] is not None and item[3] < today),
        key=lambda item: (-(item[3] - date.min).days, item[1]),
    )
    selected = [*future, *unknown, *(past if news_collection else [])][:max_items]
    logging.info(
        "index date selection: future=%d unknown=%d past=%d news_collection=%s selected=%d",
        len(future), len(unknown), len(past), news_collection, len(selected),
    )
    selected_urls = [url for _, _, url, _ in selected]
    if selection_observer:
        selected_set = set(selected_urls)
        for _, _, url, item_date in candidates:
            classification = "unknown"
            if item_date is not None:
                classification = "future" if item_date >= today else "past"
            if url in selected_set:
                reason = "selected"
            elif classification == "past" and not news_collection:
                reason = "past_excluded"
            else:
                reason = "cap_exceeded"
            selection_observer(url, item_date, classification, reason)
    return selected_urls


class SupabaseRest:
    def __init__(self, base_url: str, service_key: str) -> None:
        self.base_url = base_url.rstrip("/") + "/rest/v1"
        self.session = requests.Session()
        self.session.headers.update({
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        })

    def active_beats(self) -> list[Beat]:
        response = self.session.get(
            f"{self.base_url}/beat_sources",
            params={
                "select": "name,url,crawl_mode,is_active,last_crawled_at",
                "is_active": "eq.true",
                "order": "name.asc",
            },
            timeout=30,
        )
        response.raise_for_status()
        beats: list[Beat] = []
        for row in response.json():
            mode = row.get("crawl_mode")
            if mode not in {"index", "page"}:
                raise ValueError(f"Unsupported crawl_mode for {row.get('name')}: {mode}")
            beats.append(Beat(name=row["name"], url=row["url"], crawl_mode=mode))
        return beats

    def insert_raw_article(self, payload: dict[str, Any]) -> bool:
        response = self.session.post(
            f"{self.base_url}/raw_articles",
            params={"on_conflict": "url"},
            headers={"Prefer": "resolution=ignore-duplicates,return=representation"},
            json=payload,
            timeout=30,
        )
        response.raise_for_status()
        return bool(response.json())

    def raw_article_exists(self, url: str) -> bool:
        response = self.session.get(
            f"{self.base_url}/raw_articles",
            params={"select": "id", "url": f"eq.{url}", "limit": "1"},
            timeout=30,
        )
        response.raise_for_status()
        return bool(response.json())

    def mark_beat_crawled(self, beat: Beat) -> None:
        response = self.session.patch(
            f"{self.base_url}/beat_sources",
            params={"name": f"eq.{beat.name}", "url": f"eq.{beat.url}"},
            headers={"Prefer": "return=minimal"},
            json={"last_crawled_at": utc_now()},
            timeout=30,
        )
        response.raise_for_status()


class OllamaClient:
    def __init__(
        self,
        base_url: str,
        model: str,
        timeout_seconds: int,
        observer: PipelineObserver,
    ) -> None:
        self.url = base_url.rstrip("/") + "/api/generate"
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.observer = observer
        self.last_raw_path: str | None = None

    def harvest(self, markdown: str) -> list[dict[str, Any]]:
        response = requests.post(
            self.url,
            json={
                "model": self.model,
                "system": HARVEST_PROMPT,
                "prompt": markdown,
                "stream": False,
                "options": {"num_ctx": 32768},
            },
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        raw = str(response.json().get("response") or "")
        self.last_raw_path = self.observer.save_raw(raw)
        try:
            parsed = extract_json_array(raw)
            return [validate_harvest_item(item) for item in parsed]
        except (ValueError, json.JSONDecodeError):
            raise


class Crawl4AIRenderer:
    def __init__(self, timeout_ms: int) -> None:
        if AsyncWebCrawler is None:
            raise RuntimeError(
                "Crawl4AI is not installed. Run: python3 -m venv correspondent/.venv && "
                "correspondent/.venv/bin/pip install -r correspondent/requirements.txt && "
                "correspondent/.venv/bin/crawl4ai-setup"
            )
        self.timeout_ms = timeout_ms
        self.crawler: Any = None

    async def __aenter__(self) -> "Crawl4AIRenderer":
        browser = BrowserConfig(headless=True, browser_type="chromium", verbose=False)
        self.crawler = AsyncWebCrawler(config=browser)
        await self.crawler.start()
        return self

    async def __aexit__(self, *_: Any) -> None:
        if self.crawler is not None:
            await self.crawler.close()

    async def render(self, url: str, content_only: bool = False) -> RenderedPage:
        config_kwargs = dict(
            cache_mode=CacheMode.BYPASS,
            page_timeout=self.timeout_ms,
            delay_before_return_html=2.0,
            scan_full_page=True,
            wait_until="domcontentloaded",
        )
        config = CrawlerRunConfig(**config_kwargs, css_selector="main" if content_only else None)
        result = await self.crawler.arun(url=url, config=config)
        first_markdown = getattr(getattr(result, "markdown", None), "raw_markdown", "")
        if content_only and (not result.success or not str(first_markdown).strip()):
            logging.warning("main selector unavailable for %s; retrying full rendered page", url)
            result = await self.crawler.arun(url=url, config=CrawlerRunConfig(**config_kwargs))
        if not result.success:
            raise RuntimeError(result.error_message or "Crawl4AI returned success=false")
        markdown_value = result.markdown
        markdown = (
            markdown_value.raw_markdown
            if hasattr(markdown_value, "raw_markdown")
            else str(markdown_value or "")
        )
        if not markdown.strip():
            raise RuntimeError("Crawl4AI returned empty markdown")
        final_url = str(getattr(result, "redirected_url", None) or result.url or url)
        raw_links = getattr(result, "links", {}) or {}
        if isinstance(raw_links, dict):
            links = tuple([*(raw_links.get("internal") or []), *(raw_links.get("external") or [])])
        else:
            links = tuple(raw_links)
        return RenderedPage(url, final_url, markdown, links, "browser")


class HybridFetcher:
    def __init__(self, renderer: Crawl4AIRenderer, config: dict[str, Any]) -> None:
        self.renderer = renderer
        self.timeout_seconds = int(config["plain_http_timeout_seconds"])
        self.minimum_text_chars = int(config["plain_text_min_chars"])
        self.user_agent = str(config["plain_http_user_agent"])

    @staticmethod
    def looks_js_dependent(html: str, text: str) -> bool:
        lowered = html.lower()
        signals = (
            "enable javascript", "javascript is required", "please turn javascript on",
            "__next_data__", "id=\"__nuxt\"", "data-reactroot",
        )
        return any(signal in lowered for signal in signals) and len(text) < 4000

    def fetch_plain(self, url: str) -> RenderedPage:
        response = requests.get(
            url,
            headers={
                "User-Agent": self.user_agent,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.8,ko;q=0.6,ja;q=0.5",
            },
            timeout=self.timeout_seconds,
            allow_redirects=True,
        )
        response.raise_for_status()
        content_type = response.headers.get("content-type", "").lower()
        if "html" not in content_type:
            raise ValueError(f"plain response is not HTML: {content_type or 'unknown content-type'}")
        extractor = PlainHtmlExtractor()
        extractor.feed(response.text)
        text, links = extractor.result()
        if len(text) < self.minimum_text_chars:
            raise ValueError(f"plain extracted text too short: {len(text)} < {self.minimum_text_chars}")
        if self.looks_js_dependent(response.text, text):
            raise ValueError("plain HTML appears to require JavaScript rendering")
        return RenderedPage(url, response.url, text, links, "plain")

    async def fetch(self, url: str, content_only: bool = False) -> RenderedPage:
        try:
            page = await asyncio.to_thread(self.fetch_plain, url)
            logging.info("fetch mode=plain url=%s final_url=%s chars=%d", url, page.final_url, len(page.markdown))
            return page
        except Exception as error:
            logging.info("plain fetch insufficient url=%s reason=%s; falling back to browser", url, error)
        page = await self.renderer.render(url, content_only=content_only)
        logging.info("fetch mode=browser url=%s final_url=%s chars=%d", url, page.final_url, len(page.markdown))
        return page


class CorrespondentCrawler:
    def __init__(
        self,
        database: SupabaseRest,
        ollama: OllamaClient,
        fetcher: HybridFetcher,
        entities: list[EntityEntry],
        config: dict[str, Any],
        dry_run: bool,
        observer: PipelineObserver,
    ) -> None:
        self.database = database
        self.ollama = ollama
        self.fetcher = fetcher
        self.entities = entities
        self.config = config
        self.dry_run = dry_run
        self.observer = observer
        self.denylist = config["tracking_query_denylist"]
        self.item_url_exclude_patterns = config["item_url_exclude_patterns"]
        self.news_beats = set(config["news_beats"])
        self.news_max_age_days = int(config["news_max_age_days"])
        self.seen_article_urls: set[str] = set()

    @staticmethod
    def record_fetch(summary: BeatSummary, page: RenderedPage) -> None:
        if summary.fetch_mode is None:
            summary.fetch_mode = page.fetch_mode
        elif summary.fetch_mode != page.fetch_mode:
            summary.fetch_mode = "mixed"

    async def mark_beat_finished(self, beat: Beat, summary: BeatSummary) -> None:
        if self.dry_run:
            return
        try:
            await asyncio.to_thread(self.database.mark_beat_crawled, beat)
        except Exception as error:
            summary.errors += 1
            logging.error("[%s] last_crawled_at update failed: %s", beat.name, error)

    async def harvest_page(self, beat: Beat, page: RenderedPage, summary: BeatSummary) -> None:
        rendered_raw_path = self.observer.save_raw(page.markdown)
        markdown = trim_markdown(
            page.markdown,
            self.config["content_stop_markers"],
            int(self.config["markdown_max_chars"]),
        )
        try:
            items = await asyncio.to_thread(self.ollama.harvest, markdown)
        except Exception as error:
            summary.errors += 1
            logging.error("[%s] harvest failed for %s: %s", beat.name, page.final_url, error)
            self.observer.event(
                "error", reason="harvest_error", source=beat.name, item_url=page.final_url,
                detail={"error": str(error), "rendered_raw_path": rendered_raw_path},
            )
            return
        if beat.crawl_mode == "index":
            items = select_index_harvest_item(items, page.final_url)
        normalized_items: list[dict[str, Any]] = []
        for item in items:
            event_date = item["event_date"]
            if event_date and not date_supported_by_source(event_date, markdown):
                logging.warning(
                    "[%s] discarded unsupported event_date %s: %s",
                    beat.name,
                    event_date,
                    item["headline_en"],
                )
                item = {**item, "event_date": None}
            normalized_items.append(item)
        items = normalized_items
        if not items:
            summary.gated_out += 1
            self.observer.event(
                "gated_out", reason="not_news", source=beat.name, item_url=page.final_url,
                detail={
                    "entities_mentioned": [],
                    "rendered_raw_path": rendered_raw_path,
                    "llm_raw_path": self.ollama.last_raw_path,
                },
            )
            return
        if beat.name in self.news_beats:
            today = datetime.now(ZoneInfo("Asia/Seoul")).date()
            cutoff = today - timedelta(days=self.news_max_age_days)
            retained_items: list[dict[str, Any]] = []
            for item in items:
                event_date = item["event_date"]
                if is_stale_news_event(event_date, today, self.news_max_age_days):
                    summary.gated_out += 1
                    logging.info(
                        "[%s] gated out stale news (%s < %s): %s",
                        beat.name, event_date, cutoff, item["headline_en"],
                    )
                    self.observer.event(
                        "gated_out", reason="stale_news", source=beat.name,
                        item_url=page.final_url, title=item["headline_en"],
                        detail={
                            "event_date": event_date,
                            "cutoff_date": cutoff.isoformat(),
                            "max_age_days": self.news_max_age_days,
                            "entities_mentioned": item["entities_en"],
                            "rendered_raw_path": rendered_raw_path,
                            "llm_raw_path": self.ollama.last_raw_path,
                        },
                    )
                    continue
                retained_items.append(item)
            items = retained_items
            if not items:
                return
        summary.harvested += len(items)
        source_texts = source_texts_for_items(markdown, items) if len(items) > 1 else [markdown]
        base_url = normalize_url(page.final_url, self.denylist)
        for index, item in enumerate(items):
            self.observer.event(
                "harvested", reason="ok", source=beat.name, item_url=page.final_url,
                title=item["headline_en"],
                detail={
                    "headline_en": item["headline_en"],
                    "lang": item["source_lang"],
                    "confidence": item["confidence"],
                    "event_date": item["event_date"],
                    "entities_mentioned": item["entities_en"],
                    "rendered_raw_path": rendered_raw_path,
                    "llm_raw_path": self.ollama.last_raw_path,
                },
            )
            matches = match_entities(item["headline_en"], item["summary_en"], self.entities)
            if not matches:
                summary.gated_out += 1
                logging.info("[%s] gated out (zero entities): %s", beat.name, item["headline_en"])
                self.observer.event(
                    "gated_out", reason="no_entity_match", source=beat.name,
                    item_url=page.final_url, title=item["headline_en"],
                    detail={"entities_mentioned": item["entities_en"]},
                )
                continue
            article_url = base_url
            if beat.crawl_mode == "page" and len(items) > 1:
                article_url = f"{base_url}#ftd-{stable_text_hash(source_texts[index])}"
            if article_url in self.seen_article_urls:
                summary.dup += 1
                logging.info("[%s] skipped duplicate URL within run: %s", beat.name, article_url)
                self.observer.event(
                    "dup", reason="url_seen_in_run", source=beat.name, item_url=article_url,
                    title=item["headline_en"], detail={"entities_mentioned": item["entities_en"]},
                )
                continue
            self.seen_article_urls.add(article_url)
            payload = {
                "title": item["headline_en"],
                "content": item["summary_en"],
                "url": article_url,
                "image_url": urljoin(page.final_url, item["image_urls"][0]) if item["image_urls"] else None,
                "published_at": item["event_date"] or utc_now(),
                "source_id": None,
                "suggestion_state": "new",
            }
            if self.dry_run:
                try:
                    exists = await asyncio.to_thread(self.database.raw_article_exists, article_url)
                except Exception as error:
                    summary.errors += 1
                    logging.error("[%s] dedup check failed for %s: %s", beat.name, article_url, error)
                    self.observer.event(
                        "error", reason="dedup_check_error", source=beat.name,
                        item_url=article_url, title=item["headline_en"], detail={"error": str(error)},
                    )
                    continue
                if exists:
                    summary.dup += 1
                    logging.info("[%s] would skip duplicate: %s", beat.name, article_url)
                    self.observer.event(
                        "dup", reason="url_exists", source=beat.name, item_url=article_url,
                        title=item["headline_en"], detail={"dry_run": True},
                    )
                    continue
                print(json.dumps({
                    "beat": beat.name,
                    "action": "would_insert",
                    "matched_entities": matches,
                    "harvest": item,
                    "row": payload,
                }, ensure_ascii=False))
                self.observer.event(
                    "inserted", reason="dry_run_would_insert", source=beat.name,
                    item_url=article_url, title=item["headline_en"],
                    detail={"dry_run": True, "matched_entities": matches},
                )
                continue
            try:
                inserted = await asyncio.to_thread(self.database.insert_raw_article, payload)
            except Exception as error:
                summary.errors += 1
                logging.error("[%s] insert failed for %s: %s", beat.name, article_url, error)
                self.observer.event(
                    "error", reason="insert_error", source=beat.name, item_url=article_url,
                    title=item["headline_en"], detail={"error": str(error)},
                )
                continue
            if inserted:
                summary.inserted += 1
                self.observer.event(
                    "inserted", reason="ok", source=beat.name, item_url=article_url,
                    title=item["headline_en"], detail={"matched_entities": matches},
                )
            else:
                summary.dup += 1
                self.observer.event(
                    "dup", reason="url_unique_conflict", source=beat.name, item_url=article_url,
                    title=item["headline_en"], detail={},
                )

    async def run_beat(self, beat: Beat) -> BeatSummary:
        summary = BeatSummary()
        elapsed_total = 0.0
        timed_pages = 0
        logging.info("[%s] start mode=%s url=%s", beat.name, beat.crawl_mode, beat.url)
        started = time.perf_counter()
        try:
            landing = await self.fetcher.fetch(beat.url, content_only=beat.crawl_mode == "page")
        except Exception as error:
            summary.fetch_mode = "browser"
            summary.errors += 1
            logging.error("[%s] landing crawl failed: %s", beat.name, error)
            self.observer.event(
                "beat_start", reason="fetch_error", source=beat.name, item_url=beat.url,
                detail={"url": beat.url, "crawl_mode": beat.crawl_mode, "fetch_mode": "browser", "error": str(error)},
            )
            await self.mark_beat_finished(beat, summary)
            return summary
        summary.fetched += 1
        self.record_fetch(summary, landing)
        self.observer.event(
            "beat_start", reason="ok", source=beat.name, item_url=beat.url,
            detail={"url": beat.url, "crawl_mode": beat.crawl_mode, "fetch_mode": landing.fetch_mode},
        )

        if beat.crawl_mode == "page":
            self.observer.event(
                "item_selected", reason="page_mode", source=beat.name, item_url=landing.final_url,
                detail={"parsed_date": None, "date_class": "unknown", "selected": True},
            )
            await self.harvest_page(beat, landing, summary)
            elapsed_total += time.perf_counter() - started
            timed_pages += 1
        else:
            item_urls = select_index_links(
                landing,
                int(self.config["max_index_items"]),
                self.denylist,
                selection_observer=lambda url, parsed_date, date_class, reason: self.observer.event(
                    "item_selected", reason=reason, source=beat.name, item_url=url,
                    detail={
                        "parsed_date": parsed_date.isoformat() if parsed_date else None,
                        "date_class": date_class,
                        "selected": reason == "selected",
                    },
                ),
                exclude_patterns=self.item_url_exclude_patterns,
            )
            if not item_urls:
                collection_links = select_collection_links(landing, self.denylist)
                if collection_links:
                    collection_url = collection_links[0]
                    logging.info("[%s] expanding collection link %s", beat.name, collection_url)
                    try:
                        landing = await self.fetcher.fetch(collection_url)
                    except Exception as error:
                        summary.errors += 1
                        logging.error("[%s] collection fetch failed for %s: %s", beat.name, collection_url, error)
                    else:
                        summary.fetched += 1
                        self.record_fetch(summary, landing)
                        item_urls = select_index_links(
                            landing,
                            int(self.config["max_index_items"]),
                            self.denylist,
                            selection_observer=lambda url, parsed_date, date_class, reason: self.observer.event(
                                "item_selected", reason=reason, source=beat.name, item_url=url,
                                detail={
                                    "parsed_date": parsed_date.isoformat() if parsed_date else None,
                                    "date_class": date_class,
                                    "selected": reason == "selected",
                                },
                            ),
                            exclude_patterns=self.item_url_exclude_patterns,
                        )
            logging.info("[%s] selected %d item links", beat.name, len(item_urls))
            if not item_urls:
                summary.errors += 1
                logging.error("[%s] index produced no qualifying item links", beat.name)
            for item_url in item_urls:
                started = time.perf_counter()
                try:
                    page = await self.fetcher.fetch(item_url, content_only=True)
                except Exception as error:
                    summary.errors += 1
                    logging.error("[%s] item crawl failed for %s: %s", beat.name, item_url, error)
                    self.observer.event(
                        "error", reason="item_fetch_error", source=beat.name,
                        item_url=item_url, detail={"error": str(error)},
                    )
                    continue
                summary.fetched += 1
                self.record_fetch(summary, page)
                await self.harvest_page(beat, page, summary)
                elapsed_total += time.perf_counter() - started
                timed_pages += 1

        summary.average_seconds_per_page = round(elapsed_total / timed_pages, 2) if timed_pages else 0.0
        logging.info(
            "[%s] fetch_mode=%s average_seconds_per_page=%.2f fetched=%d",
            beat.name, summary.fetch_mode, summary.average_seconds_per_page, summary.fetched,
        )
        await self.mark_beat_finished(beat, summary)
        return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="FEEL THE DROP correspondent crawler")
    parser.add_argument("--dry-run", action="store_true", help="print candidates and perform zero writes")
    parser.add_argument("--execute", action="store_true", help="allow inserts and last_crawled_at updates")
    parser.add_argument("--beat", action="append", help="run only an exact beat name (repeatable)")
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("config.json"))
    parser.add_argument("--model", help="override OLLAMA_CRAWLER_MODEL")
    parser.add_argument("--max-index-items", type=int)
    args = parser.parse_args()
    if args.dry_run == args.execute:
        parser.error("choose exactly one of --dry-run or --execute")
    return args


async def async_main(args: argparse.Namespace) -> int:
    root = Path(__file__).resolve().parents[1]
    load_dotenv(root / ".env.local")
    required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")

    config = load_config(args.config)
    model = args.model or os.getenv("OLLAMA_CRAWLER_MODEL") or "gemma3:27b"
    if args.max_index_items is not None:
        if args.max_index_items < 1:
            raise ValueError("--max-index-items must be positive")
        config["max_index_items"] = args.max_index_items
    entities = load_entities(root / "lib" / "edm-entities-v2.json")
    database = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )
    beats = await asyncio.to_thread(database.active_beats)
    if args.beat:
        requested = set(args.beat)
        beats = [beat for beat in beats if beat.name in requested]
        missing_beats = requested - {beat.name for beat in beats}
        if missing_beats:
            raise ValueError(f"Active beat not found: {', '.join(sorted(missing_beats))}")
    if not beats:
        raise RuntimeError("No active beats found")

    observer = PipelineObserver("correspondent", root / "logs")
    observer.event(
        "run_start",
        detail={
            "params": {
                "dry_run": args.dry_run,
                "execute": args.execute,
                "beat": args.beat,
                "max_index_items": args.max_index_items,
            },
            "model": model,
            "targets": [asdict(beat) for beat in beats],
        },
    )

    log_dir = Path(__file__).with_name("logs")
    run_stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    handlers: list[logging.Handler] = [logging.StreamHandler()]
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        handlers.append(logging.FileHandler(log_dir / f"run-{run_stamp}.log"))
    except Exception as error:
        print(f"[correspondent] human-readable file logging unavailable: {error}", file=sys.stderr)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=handlers,
    )
    logging.info("crawler model=%s", model)
    ollama = OllamaClient(
        os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
        model,
        int(config["ollama_timeout_seconds"]),
        observer,
    )
    summaries: dict[str, BeatSummary] = {}
    try:
        async with Crawl4AIRenderer(int(config["crawl_timeout_ms"])) as renderer:
            fetcher = HybridFetcher(renderer, config)
            crawler = CorrespondentCrawler(
                database, ollama, fetcher, entities, config, args.dry_run, observer,
            )
            for beat in beats:
                try:
                    summaries[beat.name] = await crawler.run_beat(beat)
                except Exception as error:
                    logging.exception("[%s] unexpected beat failure: %s", beat.name, error)
                    observer.event(
                        "error", reason="beat_error", source=beat.name,
                        item_url=beat.url, detail={"error": str(error)},
                    )
                    summaries[beat.name] = BeatSummary(errors=1)
    finally:
        observer.event(
            "run_end",
            reason=(
                "ok"
                if len(summaries) == len(beats)
                and all(summary.errors == 0 for summary in summaries.values())
                else "error"
            ),
            detail={"dry_run": args.dry_run, "beats": {name: asdict(value) for name, value in summaries.items()}},
        )

    result = {name: asdict(summary) for name, summary in summaries.items()}
    print(json.dumps({"dry_run": args.dry_run, "model": model, "beats": result}, ensure_ascii=False, indent=2))
    return 0


def main() -> int:
    args = parse_args()
    try:
        return asyncio.run(async_main(args))
    except KeyboardInterrupt:
        return 130
    except Exception as error:
        print(f"fatal: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
