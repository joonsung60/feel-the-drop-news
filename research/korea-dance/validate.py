#!/usr/bin/env python3
"""Strict, dependency-free validation for the Korea dance research snapshots."""

from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
EVIDENCE_KEYS = {
    "dance_centrality", "program_independence", "public_access", "schedule",
    "venue_or_space", "production_or_atmosphere", "incidental_dj",
    "private_or_restricted",
}
SOURCE_FIELDS = {
    "source_name", "operator", "operator_type", "region", "officiality",
    "listing_url", "sample_detail_urls", "discovery_method",
    "feed_or_endpoint_url", "current_status", "last_observed_update",
    "update_frequency", "requires_javascript", "requires_login",
    "anti_bot_or_access_issue", "robots_or_terms_note", "available_fields",
    "dance_signal_quality", "non_dance_noise", "recommended_role",
    "recommended_crawl_mode", "priority", "reason",
}
GOLD_FIELDS = {
    "event_name", "region", "date", "venue", "source_name", "discovery_url",
    "official_verification_urls", "decision", "approval_path", "evidence",
    "missing_evidence", "reason",
}
AVAILABLE_FIELDS = {
    "title", "date", "time", "venue", "region", "lineup", "program_schedule",
    "ticket_or_access", "official_detail_link", "image",
}
ENUMS = {
    "operator_type": {"aggregator", "community", "government", "other", "promoter", "ticketing", "tourism"},
    "officiality": {"community", "first_party", "official", "secondary_with_source_links"},
    "discovery_method": {"api", "html"},
    "current_status": {"active", "uncertain"},
    "dance_signal_quality": {"high", "medium", "low"},
    "non_dance_noise": {"high", "medium", "low"},
    "recommended_role": {"discovery_source", "primary_source", "verification_source"},
    "recommended_crawl_mode": {"browser", "feed", "index_detail", "manual_only", "page"},
    "priority": {"P0", "P1", "P2"},
    "decision": {"accepted", "needs_verification", "rejected"},
    "approval_path": {"entity", "dance_experience", "none"},
}


class ValidationError(Exception):
    pass


def fail(path: str, message: str) -> None:
    raise ValidationError(f"{path}: {message}")


def load_json(path: Path) -> Any:
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError) as error:
        raise ValidationError(f"{path}: cannot load JSON: {error}") from error


def require_object(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(path, f"expected object, got {type(value).__name__}")
    return value


def require_fields(record: dict[str, Any], expected: set[str], path: str) -> None:
    missing = sorted(expected - record.keys())
    extra = sorted(record.keys() - expected)
    if missing:
        fail(path, f"missing required field(s): {', '.join(missing)}")
    if extra:
        fail(path, f"unexpected field(s): {', '.join(extra)}")


def require_text(value: Any, path: str, *, nullable: bool = False) -> None:
    if nullable and value is None:
        return
    if not isinstance(value, str):
        fail(path, f"expected string, got {type(value).__name__}")
    if not value.strip():
        fail(path, "blank strings cannot represent an unknown value; use null")


def require_string_list(value: Any, path: str, *, nonempty: bool = False) -> None:
    if not isinstance(value, list):
        fail(path, f"expected array, got {type(value).__name__}")
    if nonempty and not value:
        fail(path, "expected at least one item")
    for index, entry in enumerate(value):
        require_text(entry, f"{path}[{index}]")


def require_url(value: Any, path: str, *, nullable: bool = False) -> None:
    if nullable and value is None:
        return
    require_text(value, path)
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        fail(path, "expected an absolute HTTP(S) URL")


def reject_blank_strings(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            reject_blank_strings(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            reject_blank_strings(child, f"{path}[{index}]")
    elif isinstance(value, str) and not value.strip():
        fail(path, "blank strings cannot represent an unknown value")


def validate_sources(records: Any) -> None:
    if not isinstance(records, list):
        fail("source_candidates", "expected top-level array")
    seen: set[str] = set()
    for index, raw in enumerate(records):
        path = f"source_candidates[{index}]"
        record = require_object(raw, path)
        require_fields(record, SOURCE_FIELDS, path)
        reject_blank_strings(record, path)
        for field in SOURCE_FIELDS - {"region", "sample_detail_urls", "feed_or_endpoint_url",
                                      "anti_bot_or_access_issue", "available_fields",
                                      "requires_javascript", "requires_login"}:
            require_text(record[field], f"{path}.{field}")
        require_string_list(record["region"], f"{path}.region", nonempty=True)
        require_string_list(record["sample_detail_urls"], f"{path}.sample_detail_urls")
        require_url(record["listing_url"], f"{path}.listing_url")
        require_url(record["feed_or_endpoint_url"], f"{path}.feed_or_endpoint_url", nullable=True)
        require_text(record["anti_bot_or_access_issue"], f"{path}.anti_bot_or_access_issue", nullable=True)
        for field in ("requires_javascript", "requires_login"):
            if type(record[field]) is not bool:
                fail(f"{path}.{field}", "expected boolean")
        available = require_object(record["available_fields"], f"{path}.available_fields")
        require_fields(available, AVAILABLE_FIELDS, f"{path}.available_fields")
        for field, value in available.items():
            if type(value) is not bool:
                fail(f"{path}.available_fields.{field}", "expected boolean")
        for field in ENUMS.keys() & record.keys():
            if record[field] not in ENUMS[field]:
                fail(f"{path}.{field}", f"invalid enum value {record[field]!r}")
        for field, url in enumerate(record["sample_detail_urls"]):
            require_url(url, f"{path}.sample_detail_urls[{field}]")
        identity = record["source_name"].casefold()
        if identity in seen:
            fail(path, f"duplicate source_name {record['source_name']!r}")
        seen.add(identity)


def validate_gold(records: Any, expected_counts: dict[str, Any]) -> None:
    if not isinstance(records, list):
        fail("event_gold_set", "expected top-level array")
    seen: set[tuple[str, str, str]] = set()
    for index, raw in enumerate(records):
        path = f"event_gold_set[{index}]"
        record = require_object(raw, path)
        require_fields(record, GOLD_FIELDS, path)
        reject_blank_strings(record, path)
        for field in {"event_name", "region", "date", "source_name", "reason"}:
            require_text(record[field], f"{path}.{field}")
        require_text(record["venue"], f"{path}.venue", nullable=True)
        require_url(record["discovery_url"], f"{path}.discovery_url")
        require_string_list(record["official_verification_urls"], f"{path}.official_verification_urls")
        for position, url in enumerate(record["official_verification_urls"]):
            require_url(url, f"{path}.official_verification_urls[{position}]")
        require_string_list(record["missing_evidence"], f"{path}.missing_evidence")
        for field in ("decision", "approval_path"):
            if record[field] not in ENUMS[field]:
                fail(f"{path}.{field}", f"invalid enum value {record[field]!r}")
        expected_path = "none" if record["decision"] == "rejected" else record["approval_path"]
        if record["decision"] == "rejected" and expected_path != record["approval_path"]:
            fail(f"{path}.approval_path", "rejected records must use 'none'")
        evidence = require_object(record["evidence"], f"{path}.evidence")
        require_fields(evidence, EVIDENCE_KEYS, f"{path}.evidence")
        for key, values in evidence.items():
            require_string_list(values, f"{path}.evidence.{key}")
        identity = (record["event_name"].casefold(), record["date"], str(record["venue"]).casefold())
        if identity in seen:
            fail(path, f"duplicate event identity {identity!r}")
        seen.add(identity)
    actual = Counter(record["decision"] for record in records)
    if dict(actual) != expected_counts:
        fail("event_gold_set", f"decision counts {dict(actual)!r}, expected {expected_counts!r}")


def main() -> int:
    try:
        manifest = require_object(load_json(ROOT / "manifest.json"), "manifest")
        datasets = manifest.get("datasets")
        if not isinstance(datasets, list):
            fail("manifest.datasets", "expected array")
        loaded: dict[str, Any] = {}
        for index, raw in enumerate(datasets):
            path = f"manifest.datasets[{index}]"
            entry = require_object(raw, path)
            require_fields(entry, {"name", "path", "sha256", "record_count", "use"}, path)
            if entry["use"] != "reference_only":
                fail(f"{path}.use", "research snapshots must remain reference_only")
            data_path = ROOT / entry["path"]
            digest = hashlib.sha256(data_path.read_bytes()).hexdigest()
            if digest != entry["sha256"]:
                fail(f"{path}.sha256", f"{digest}, expected {entry['sha256']}")
            records = load_json(data_path)
            if not isinstance(records, list):
                fail(entry["name"], "expected top-level array")
            if len(records) != entry["record_count"]:
                fail(f"{path}.record_count", f"{entry['record_count']} declared, {len(records)} actual")
            loaded[entry["name"]] = records
        validate_sources(loaded.get("source_candidates"))
        expected = require_object(manifest.get("expected_gold_decisions"), "manifest.expected_gold_decisions")
        validate_gold(loaded.get("event_gold_set"), expected)
    except (OSError, ValidationError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    counts = Counter(record["decision"] for record in loaded["event_gold_set"])
    print(
        "OK: source_candidates=31, event_gold_set=36, "
        f"accepted={counts['accepted']}, needs_verification={counts['needs_verification']}, "
        f"rejected={counts['rejected']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
