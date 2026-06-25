"""Load California Scratchers data into pandas for analysis.

Two entry points:

* ``load_current()`` — the latest snapshot from ``site/data.json``, returned as
  two tidy DataFrames: one row per game, one row per prize tier.
* ``load_history()`` — every recorded daily snapshot from ``data/history/``,
  one row per game x prize-tier x day, for time-series analysis.

Paths default to this repository regardless of the working directory, so the
functions work the same from a notebook anywhere in the tree.

    from analysis.load import load_current, load_history

    games, prizes = load_current()
    hist = load_history()

Requires pandas and pyarrow (see ``analysis/requirements.txt``).
"""

from __future__ import annotations

import json
import os

import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JSON = os.path.join(ROOT, "site", "data.json")
HISTORY_DIR = os.path.join(ROOT, "data", "history")

# Game-level fields lifted onto each prize-tier row in the long table.
_GAME_META = ["game_number", "name", "price", "game_type", "overall_odds",
              "top_prize", "tickets_printed", "tickets_remaining",
              "percent_unsold", "total_unclaimed"]


def load_current(path: str = DATA_JSON) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Return (games, prizes) DataFrames from the current ``data.json``.

    ``games`` has one row per game; ``prizes`` has one row per prize tier with
    the parent game's number, name and price attached for easy joining/grouping.
    """
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)

    games = pd.json_normalize(raw["games"]).drop(columns=["prizes"], errors="ignore")
    prizes = pd.json_normalize(
        raw["games"], record_path="prizes",
        meta=["game_number", "name", "price"],
    )
    return games, prizes


def load_history(path: str = HISTORY_DIR) -> pd.DataFrame:
    """Return the full daily history as one long DataFrame.

    One row per game x prize-tier x snapshot day. ``snapshot_date`` is parsed to
    a datetime and the frame is sorted by (game, prize, date) so per-game/per-tier
    trends are contiguous. Raises ``FileNotFoundError`` if no snapshots exist yet.
    """
    if not os.path.isdir(path) or not any(f.endswith(".parquet") for f in os.listdir(path)):
        raise FileNotFoundError(
            f"No snapshots found in {path!r}. Run scraper/record_snapshot.py "
            "(or wait for the daily GitHub Action) to populate the history."
        )

    df = pd.read_parquet(path)
    df["snapshot_date"] = pd.to_datetime(df["snapshot_date"])
    return df.sort_values(["game_number", "prize", "snapshot_date"]).reset_index(drop=True)


if __name__ == "__main__":
    games, prizes = load_current()
    print(f"current: {len(games)} games, {len(prizes)} prize tiers")
    try:
        hist = load_history()
        days = hist["snapshot_date"].nunique()
        print(f"history: {len(hist)} rows across {days} day(s)")
    except FileNotFoundError as e:
        print(e)
