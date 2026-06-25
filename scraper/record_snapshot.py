#!/usr/bin/env python3
"""Append a daily snapshot of the Scratchers data to the Parquet history.

Reads the freshly-scraped ``site/data.json`` and writes one tidy row per
game x prize-tier into ``data/history/<YYYY-MM-DD>.parquet`` — a flat directory
of per-day Parquet files. Each calendar day gets its own file; re-running on the
same day overwrites that day's file, so there is exactly one snapshot per day.

The dataset is therefore append-only across days and git-friendly: a run only
ever adds (or replaces) a single small file, never rewriting earlier days. Read
the whole history back with ``pandas.read_parquet("data/history")`` or via
``analysis/load.py``.

Writes with pyarrow only (no pandas) to keep the CI dependency footprint small.
"""

import datetime as dt
import json
import os
import sys

import pyarrow as pa
import pyarrow.parquet as pq

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JSON = os.path.join(ROOT, "site", "data.json")
HISTORY_DIR = os.path.join(ROOT, "data", "history")

# Game-level fields carried onto every prize-tier row. URLs, images and the
# free-text on-sale date are dropped — they bloat the history and aren't useful
# for time-series analysis.
GAME_COLS = [
    "game_number", "name", "price", "game_type", "overall_odds", "top_prize",
    "tickets_printed", "tickets_remaining", "percent_unsold", "total_unclaimed",
]


def build_rows(data: dict) -> tuple[str, list[dict]]:
    """Return (snapshot_date, rows) flattened to one row per prize tier."""
    generated_at = data["generated_at"]
    snapshot_date = generated_at[:10]  # YYYY-MM-DD from the ISO timestamp
    rows: list[dict] = []
    for g in data["games"]:
        base = {c: g.get(c) for c in GAME_COLS}
        for p in g.get("prizes", []):
            rows.append({
                "snapshot_date": snapshot_date,
                "generated_at": generated_at,
                **base,
                "prize": p.get("prize"),
                "prize_remaining": p.get("remaining"),
                "prize_total": p.get("total"),
                "odds_printed": p.get("odds_printed"),
                "odds_one_in": p.get("odds_one_in"),
            })
    return snapshot_date, rows


def main() -> None:
    with open(DATA_JSON, encoding="utf-8") as fh:
        data = json.load(fh)

    snapshot_date, rows = build_rows(data)
    if not rows:
        print("record_snapshot: no prize rows in data.json, nothing to record",
              file=sys.stderr)
        return

    os.makedirs(HISTORY_DIR, exist_ok=True)
    out_path = os.path.join(HISTORY_DIR, f"{snapshot_date}.parquet")
    action = "Updated" if os.path.exists(out_path) else "Wrote"
    table = pa.Table.from_pylist(rows)
    pq.write_table(table, out_path, compression="zstd")

    print(
        f"{action} {os.path.relpath(out_path, ROOT)} — "
        f"{len(rows)} prize rows across {len(data['games'])} games "
        f"(snapshot {snapshot_date})",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
