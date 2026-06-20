#!/usr/bin/env python3
"""
Cache-bust the site's CSS/JS by stamping a content hash onto their URLs.

GitHub Pages (and browsers) cache `app.js` / `styles.css` aggressively. When we
ship a code change but the filename stays the same, visitors can keep running the
old file against the new HTML — which is exactly how the deleted #landscape element
once threw "Cannot set properties of null (setting 'hidden')".

Fix: rewrite the `?v=...` query on each asset reference in index.html to a short
hash of that asset's current contents. The query changes only when the file's
bytes change, so unchanged assets keep their cached copy and changed ones are
re-fetched automatically. Run as part of the build, after generating data.json.

Idempotent: running it twice with no asset changes leaves index.html untouched.
"""

import hashlib
import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
INDEX = SITE / "index.html"
ASSETS = ["app.js", "styles.css"]


def short_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:10]


def main() -> int:
    html = INDEX.read_text(encoding="utf-8")
    original = html

    for asset in ASSETS:
        path = SITE / asset
        if not path.exists():
            print(f"stamp_assets: {asset} not found, skipping", file=sys.stderr)
            continue
        digest = short_hash(path)
        # Match the asset in an href/src, with or without an existing ?v=... query.
        pattern = re.compile(re.escape(asset) + r"(?:\?v=[^\"']*)?")
        html, n = pattern.subn(f"{asset}?v={digest}", html)
        if n == 0:
            print(f"stamp_assets: no reference to {asset} in index.html", file=sys.stderr)

    if html != original:
        INDEX.write_text(html, encoding="utf-8")
        print("stamp_assets: index.html updated with content hashes")
    else:
        print("stamp_assets: no changes (hashes already current)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
