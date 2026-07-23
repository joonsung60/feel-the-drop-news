"""Failure-tolerant JSONL pipeline observation with the shared event schema."""

from __future__ import annotations

import hashlib
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class PipelineObserver:
    def __init__(self, pipeline: str, log_root: Path) -> None:
        started_at = datetime.now(timezone.utc).isoformat()
        self.pipeline = pipeline
        self.log_root = log_root
        self.run_id = f"{pipeline}-{started_at}-{uuid.uuid4().hex[:8]}"
        self.file_path = log_root / f"{started_at}_{pipeline}.jsonl"
        self._warned = False

    def event(
        self,
        stage: str,
        *,
        reason: str | None = None,
        source: str | None = None,
        item_url: str | None = None,
        title: str | None = None,
        detail: dict[str, Any] | None = None,
    ) -> None:
        payload = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "run_id": self.run_id,
            "pipeline": self.pipeline,
            "stage": stage,
            "reason": reason,
            "source": source,
            "item_url": item_url,
            "title": title,
            "detail": detail or {},
        }
        try:
            self.log_root.mkdir(parents=True, exist_ok=True)
            with self.file_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
        except Exception as error:  # Observation must never stop the crawler.
            self._warn_once(error)

    def save_raw(self, content: str) -> str | None:
        try:
            digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
            raw_dir = self.log_root / "raw" / self.run_id
            raw_path = raw_dir / f"{digest}.txt"
            raw_dir.mkdir(parents=True, exist_ok=True)
            if not raw_path.exists():
                raw_path.write_text(content, encoding="utf-8")
            try:
                return raw_path.relative_to(Path.cwd()).as_posix()
            except ValueError:
                return raw_path.as_posix()
        except Exception as error:  # raw_path=null is part of the contract.
            self._warn_once(error)
            return None

    def _warn_once(self, error: Exception) -> None:
        if self._warned:
            return
        self._warned = True
        print(
            f"[pipeline-observer:{self.pipeline}] logging disabled for this run: {error}",
            file=sys.stderr,
        )
