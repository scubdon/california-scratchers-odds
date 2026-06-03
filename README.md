# The Real Odds — California Scratchers

A small, self-updating website that shows the **actual odds of winning each prize** on
California Lottery Scratchers — the number the lottery doesn't put on the ticket. It's
calculated live from the prizes still unclaimed and the tickets still unsold.

The lottery only advertises the *overall* odds of winning **anything** (usually a free
ticket or a few dollars back). This site works out, per game and per prize level, how
unlikely you are to win a prize actually worth more than the ticket — and how those odds
drift as the game sells down.

## Why California is easier than Maine

California already publishes, on every game's page, a table of each prize level with its
**printed odds** ("1 in N") and how many of that prize are **still unclaimed** out of how
many were printed. We don't have to reconstruct the prize counts — we just have to turn
them into live, per-ticket odds.

## How it works

```
┌─ scraper/scrape.py ─┐        ┌─ site/ (static) ─┐
│  calottery.com      │ ──────▶│  index.html      │
│  → site/data.json   │  JSON  │  app.js + chart  │
└─────────────────────┘        └──────────────────┘
        ▲ run daily in CI            ▲ served by GitHub Pages
```

Two sources are joined on the game number:

| Source | Provides |
| --- | --- |
| [Scratchers list API](https://www.calottery.com/api/Sitecore/ScratchersFilteredList/GetScratchers) | the current roster: name, number, price, image, overall odds, on-sale date, page link |
| Each game's product page | the per-prize table: printed odds and prizes still unclaimed |

From a game's own prize table we derive:

```
tickets_printed   = median over prize levels of (printed_odds × total_at_that_level)
percent_unsold    = 100 × (sum of prizes unclaimed) ÷ (sum of prizes printed)
tickets_remaining = tickets_printed × percent_unsold ÷ 100
live odds (level) = tickets_remaining ÷ that prize still unclaimed
```

The site shows both the **live odds** and the original **printed odds**, so you can see how
much longer the odds on the big prizes have already become.

## Project layout

```
scraper/
  scrape.py          # the whole pipeline → writes site/data.json
  requirements.txt
site/                # the deployable static site (no build step)
  index.html
  styles.css
  app.js
  data.json          # generated; committed so the site works before the first CI run
.github/workflows/
  update.yml         # daily scrape + deploy to GitHub Pages
```

## Run it locally

```bash
python3 -m venv .venv
./.venv/bin/pip install -r scraper/requirements.txt

# refresh the data
./.venv/bin/python scraper/scrape.py

# preview the site
./.venv/bin/python -m http.server -d site 8765
# open http://localhost:8765
```

## Deploying (free + low-maintenance)

The site is **plain static files** — no framework, no build step — so it can be hosted
anywhere. The included workflow uses **GitHub Pages**:

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. The `Refresh data & deploy` workflow runs on push, daily at 11:17 UTC, and on demand
   (Actions tab → *Run workflow*). Each run re-scrapes and redeploys, so the published
   odds stay current with zero ongoing effort or cost.

To host elsewhere (Cloudflare Pages, Netlify, S3, …) just serve the `site/` directory and
run `scraper/scrape.py` on a schedule to refresh `site/data.json`.

## Caveats

These are estimates. They assume the unsold tickets are spread through the pool the same
way the printed pool is (the lottery doesn't guarantee that), and "unclaimed" prizes may
already be sitting in a winner's drawer. Not affiliated with or endorsed by the California
State Lottery.
