"""Import the source-verified annotated map images and build the public manifest.

Run from any directory with Python and Pillow installed. Existing valid WebP files
are reused; downloads are limited to six concurrent requests. Map availability and
the CDN URL pattern were verified against each source detail page before import.
"""

from __future__ import annotations

import io
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image


PROJECT = Path(__file__).resolve().parents[1]
SOURCE = PROJECT / "source" / "maps-source.json"
DIST = PROJECT / "dist"
MAPS = DIST / "maps"
MANIFEST = DIST / "maps.json"
WORKERS = 6
RETRIES = 3


def dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise ValueError("Response is not a WebP file")
    with Image.open(io.BytesIO(data)) as image:
        if image.format != "WEBP":
            raise ValueError(f"Unexpected image format: {image.format}")
        image.load()
        width, height = image.size
        if width < 1 or height < 1:
            raise ValueError("Image has invalid dimensions")
        return width, height


def record_for(row: list[str]) -> dict:
    map_id, name, mode = row[:3]
    return {
        "id": map_id,
        "name": name,
        "mode": mode,
        "gameMode": row[3] if len(row) == 4 else mode,
        "src": None,
        "width": None,
        "height": None,
        "sourceUrl": f"https://marvelrivals.gg/maps/{map_id}/",
        "available": False,
    }


def import_map(row: list[str]) -> tuple[dict, str, int]:
    record = record_for(row)
    map_id = record["id"]
    asset_url = (
        f"https://static.dotgg.gg/rivals/maps/{map_id}-layout-annotated.webp"
    )
    record["assetSourceUrl"] = asset_url
    target = MAPS / f"{map_id}.webp"
    reused = False
    try:
        data = target.read_bytes()
        width, height = dimensions(data)
        reused = True
    except (OSError, ValueError):
        error = None
        for attempt in range(RETRIES):
            try:
                request = Request(
                    asset_url,
                    headers={"User-Agent": "MarvelRivalsMapRoom/1.0"},
                )
                with urlopen(request, timeout=30) as response:
                    content_type = response.headers.get_content_type()
                    if content_type != "image/webp":
                        raise ValueError(f"Unexpected content type: {content_type}")
                    data = response.read()
                width, height = dimensions(data)
                temporary = target.with_suffix(".webp.part")
                temporary.write_bytes(data)
                os.replace(temporary, target)
                error = None
                break
            except (OSError, ValueError) as exc:
                error = exc
                if attempt + 1 < RETRIES:
                    time.sleep(attempt + 1)
        if error is not None:
            record["unavailableReason"] = "The map layout could not be downloaded."
            return record, f"failed: {error}", 0

    record.update(
        available=True,
        src=f"maps/{map_id}.webp",
        width=width,
        height=height,
    )
    return record, "reused" if reused else "downloaded", len(data)


def main() -> int:
    rows = json.loads(SOURCE.read_text(encoding="utf-8-sig"))
    if not isinstance(rows, list) or any(
        not isinstance(row, list)
        or len(row) not in (3, 4)
        or not all(isinstance(value, str) and value for value in row)
        for row in rows
    ):
        raise ValueError("Expected [id, name, category] entries with an optional game mode")
    ids = [row[0] for row in rows]
    if len(ids) != len(set(ids)) or any(
        not map_id.replace("-", "").isalnum() for map_id in ids
    ):
        raise ValueError("Map IDs must be unique URL-safe names")

    MAPS.mkdir(parents=True, exist_ok=True)
    records = {}
    counts = {"downloaded": 0, "reused": 0, "unavailable": 0, "failed": 0}
    total_bytes = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        jobs = {pool.submit(import_map, row): row[0] for row in rows}
        for job in as_completed(jobs):
            record, status, size = job.result()
            records[record["id"]] = record
            counts[status.split(":", 1)[0]] += 1
            total_bytes += size
            print(f"{record['id']}: {status}", flush=True)

    manifest = [records[map_id] for map_id in ids]
    temporary_manifest = MANIFEST.with_suffix(".json.part")
    temporary_manifest.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    os.replace(temporary_manifest, MANIFEST)
    print(
        json.dumps(
            {
                "entries": len(manifest),
                "available": counts["downloaded"] + counts["reused"],
                **counts,
                "bytes": total_bytes,
                "manifest": str(MANIFEST),
            }
        ),
        flush=True,
    )
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
