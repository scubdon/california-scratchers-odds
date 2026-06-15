#!/usr/bin/env python3
"""
California Lottery scratch-ticket odds scraper.

California makes this easier than Maine: every game's page already publishes a full
prize table with, for each prize level, the printed odds ("1 in N") and how many of
that prize remain ("X of Y"). We pull those and turn them into the number people
actually care about — the odds of winning each prize *on a ticket bought today*.

Two sources, joined by game number:

  1. The Scratchers list API -> the current roster: name, number, price, image,
     overall odds, on-sale date, link to each game's page.
       https://www.calottery.com/api/Sitecore/ScratchersFilteredList/GetScratchers
  2. Each game's product page -> the per-prize table (printed odds + prizes remaining).
       e.g. https://www.calottery.com/scratchers/$5/red-white--blue-7s-1730

What we derive for each game, purely from its own published table:

    tickets_printed   = median over prize levels of (printed_odds * total_at_that_level)
    percent_unsold    = 100 * (sum of prizes remaining) / (sum of prizes total)
    tickets_remaining = tickets_printed * percent_unsold / 100
    odds_now (level)  = tickets_remaining / prizes_of_that_level_remaining

"odds_now" is the live odds: as the top prizes get claimed it lengthens, and as the
print run sells down it can shorten. "odds_printed" is what the lottery advertises for
the full, untouched print run.

Output: site/data.json  (consumed by the static front-end)

Stdlib + requests + beautifulsoup4 only, so it runs cheaply in CI.
"""

from __future__ import annotations

import concurrent.futures
import datetime as dt
import json
import os
import re
import sys
from statistics import median
from urllib.parse import quote, urljoin

import requests
from bs4 import BeautifulSoup

BASE = "https://www.calottery.com"
SCRATCHERS_URL = f"{BASE}/en/scratchers"
LIST_API = f"{BASE}/api/Sitecore/ScratchersFilteredList/GetScratchers"
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "site", "data.json")

HEADERS = {
    "User-Agent": (
        "california-scratcher-odds/1.0 (public-data aggregator; "
        "contact via GitHub repo issues)"
    )
}

session = requests.Session()
session.headers.update(HEADERS)


def get(url: str, retries: int = 3) -> str:
    last = None
    for _ in range(retries):
        try:
            r = session.get(url, timeout=30)
            r.raise_for_status()
            return r.text
        except Exception as exc:  # noqa: BLE001
            last = exc
    raise RuntimeError(f"failed to fetch {url}: {last}")


def money_to_int(text: str | None) -> int | None:
    """'$250,000' / '$5' -> int dollars."""
    if not text:
        return None
    m = re.search(r"\$?\s*([\d,]+)", text)
    return int(m.group(1).replace(",", "")) if m else None


def clean(text: str | None) -> str | None:
    """Decode the stray HTML entities the list API leaves in titles."""
    if text is None:
        return None
    return (
        text.replace("&amp;", "&")
        .replace("&trade;", "™")
        .replace("&reg;", "®")
        .replace("&#39;", "'")
        .replace("&quot;", '"')
        .strip()
    )


# --------------------------------------------------------------------------- #
# 1. The roster, from the list API
# --------------------------------------------------------------------------- #
def find_model_id() -> str:
    """The list API is keyed by a Sitecore model GUID embedded in the page JS."""
    html = get(SCRATCHERS_URL)
    m = re.search(r"modelId\s*=\s*'([0-9a-fA-F-]{36})'", html)
    if not m:
        raise RuntimeError("could not find Scratchers list modelId on the page")
    return m.group(1)


def parse_on_sale(goto_market: str | None) -> str | None:
    """'/Date(1779087600000)/' -> 'May 4, 2026'."""
    if not goto_market:
        return None
    m = re.search(r"(\d{10,13})", goto_market)
    if not m:
        return None
    ms = int(m.group(1))
    try:
        d = dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc)
        return d.strftime("%B %-d, %Y")
    except (ValueError, OSError):
        return None


def fetch_roster() -> list[dict]:
    """Returns one dict per current game with everything except the prize table."""
    model_id = find_model_id()
    params = {
        "modelId": model_id,
        "sortBy": "",
        "page": 1,
        "size": 500,
        "show": "",
        "gametype": "",
        "price": "",
        "nameOrNumber": "",
    }
    r = session.get(LIST_API, params=params, timeout=30)
    r.raise_for_status()
    payload = r.json()

    games = []
    for c in payload.get("SerializedScratcherCardList", []):
        page = c.get("GameProductPage")
        games.append(
            {
                "game_number": c.get("GameNumber"),
                "name": clean(c.get("GameName")),
                "price": money_to_int(c.get("GamePrice")),
                "game_type": clean(c.get("GameType")),
                "overall_odds": (
                    float(c["OverallOdds"]) if c.get("OverallOdds") else None
                ),
                "top_prize": money_to_int(c.get("TopPrizeDollarAmt")),
                "on_sale": parse_on_sale(c.get("GotoMarketDate")),
                "image_url": c.get("ScratchersImage"),
                "article_url": urljoin(BASE, encode_path(page)) if page else None,
            }
        )
    return games


def encode_path(path: str) -> str:
    """'/scratchers/$5/red-white--blue-7s-1730' -> percent-encoded, keeping slashes."""
    return quote(path, safe="/-")


# --------------------------------------------------------------------------- #
# 2. The per-prize table on each game's page
# --------------------------------------------------------------------------- #
# The list API only gives a wide banner crop ("…-thumbnail.jpg", 615x260). Each
# game page also embeds the full portrait ticket as "…-cv.png" (~800x1800), which
# is what we actually want to show.
CV_IMAGE_RE = re.compile(
    r"https://static\.www\.calottery\.com/-/media/project/calottery/pws/"
    r"scratchers/[A-Za-z0-9%_-]+-cv\.png\?rev=[0-9a-fA-F]+",
)


def parse_ticket_image(html: str) -> str | None:
    """The full portrait ticket image embedded on a game page, or None."""
    m = CV_IMAGE_RE.search(html)
    return m.group(0) if m else None


def parse_prize_table(html: str) -> list[dict]:
    """
    Find the 'Odds and Available Prizes' table and return
    [{prize, odds_printed, remaining, total}, ...] (one row per prize level).
    """
    soup = BeautifulSoup(html, "html.parser")
    best: list[dict] = []

    for table in soup.find_all("table"):
        rows: list[dict] = []
        for tr in table.find_all("tr"):
            cells = [
                td.get_text(" ", strip=True).replace("\xa0", " ")
                for td in tr.find_all(["td", "th"])
            ]
            cells = [c for c in cells if c]
            if len(cells) < 3:
                continue
            prize = money_to_int(cells[0])
            odds = money_to_int(cells[1])  # "1 in N" cell is just the number N
            rem = re.match(r"([\d,]+)\s+of\s+([\d,]+)", cells[2])
            if prize is None or odds is None or not rem:
                continue
            rows.append(
                {
                    "prize": prize,
                    "odds_printed": odds,
                    "remaining": int(rem.group(1).replace(",", "")),
                    "total": int(rem.group(2).replace(",", "")),
                }
            )
        if len(rows) > len(best):
            best = rows
    return best


# --------------------------------------------------------------------------- #
# 3. Join + compute live odds
# --------------------------------------------------------------------------- #
def enrich(game: dict) -> dict | None:
    if not game.get("article_url"):
        return None
    try:
        html = get(game["article_url"])
    except Exception as exc:  # noqa: BLE001
        print(f"  ! page fetch failed {game['article_url']}: {exc}", file=sys.stderr)
        return None

    table = parse_prize_table(html)
    if not table:
        return None

    # Prefer the full ticket scan from the game page; fall back to the banner thumb.
    full_image = parse_ticket_image(html)

    # tickets printed: each level implies odds*total tickets; take the median to
    # shrug off the rounding the lottery applies to the printed odds.
    estimates = [r["odds_printed"] * r["total"] for r in table if r["total"]]
    if not estimates:
        return None
    tickets_printed = round(median(estimates))

    total_prizes = sum(r["total"] for r in table)
    remaining_prizes = sum(r["remaining"] for r in table)
    percent_unsold = (
        round(100 * remaining_prizes / total_prizes, 1) if total_prizes else None
    )
    tickets_remaining = (
        round(tickets_printed * percent_unsold / 100) if percent_unsold is not None else None
    )

    prizes = []
    for r in table:
        odds_now = (
            round(tickets_remaining / r["remaining"])
            if tickets_remaining and r["remaining"]
            else None
        )
        prizes.append(
            {
                "prize": r["prize"],
                "remaining": r["remaining"],
                "total": r["total"],
                "odds_printed": r["odds_printed"],
                "odds_one_in": odds_now,  # live odds; key name matches the front-end
            }
        )
    prizes.sort(key=lambda p: p["prize"], reverse=True)

    total_unclaimed = sum(p["prize"] * p["remaining"] for p in prizes)

    return {
        **game,
        "image_url": full_image or game.get("image_url"),
        "tickets_printed": tickets_printed,
        "tickets_remaining": tickets_remaining,
        "percent_unsold": percent_unsold,
        "total_unclaimed": total_unclaimed,
        "prizes": prizes,
    }


def build() -> dict:
    print("Fetching Scratchers roster…", file=sys.stderr)
    roster = fetch_roster()
    print(f"  {len(roster)} current games", file=sys.stderr)

    print("Fetching individual game prize tables…", file=sys.stderr)
    games: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for res in pool.map(enrich, roster):
            if res:
                games.append(res)
    print(f"  {len(games)} games with a usable prize table", file=sys.stderr)

    games.sort(key=lambda g: (-(g["price"] or 0), -(g["game_number"] or 0)))

    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "source": {
            "scratchers": SCRATCHERS_URL,
            "list_api": LIST_API,
        },
        "counts": {
            "in_roster": len(roster),
            "with_prize_table": len(games),
        },
        "games": games,
    }


def main() -> None:
    data = build()
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
    print(
        f"Wrote {os.path.relpath(OUT_PATH)} — {len(data['games'])} games "
        f"({data['counts']['in_roster']} in roster)",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
