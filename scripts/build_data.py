"""
Builds data/games.json for the GitHub Pages site. All stats (win %, point diff,
teammate synergy, etc.) are computed client-side in JS from this file.

Two modes:
  python scripts/build_data.py            # default: merge the Fall 2026 sheet
                                          #   into the existing games.json
  python scripts/build_data.py --legacy   # rebuild from the old Euchre_Book.xlsx
                                          #   ("The Book" sheet); overwrites
                                          #   games.json, including manual edits

Merge mode keeps every existing game dated before the first date in the new
sheet (so hand-fixes in games.json are preserved), drops any existing games on
or after that date, and appends the new rows -- so it is safe to re-run as the
season sheet grows.

Note: Euchre_Book_Fall_2026.csv is actually an .xlsx workbook despite the
extension, so it is opened as a binary stream.
"""
import json
import sys
from datetime import datetime, date as date_type
import openpyxl

SRC = r"C:\Users\primo\Downloads\Euchre_Book.xlsx"   # legacy master log
NEW_SRC = "data/Euchre_Book_Fall_2026.csv"           # Fall 2026 workbook
NEW_SHEET = "Euchre_Book_Fall_2026"
OUT = "data/games.json"

# Unambiguous cleanup: trailing/leading whitespace + a few obvious typos
# confirmed against the roster (no other similarly-named player exists).
NAME_FIXES = {
    "Done": "Don",
    "Jayleee": "Jaylee",
    "Niclole": "Nicole",
}

def clean_name(raw):
    if raw is None:
        return None
    name = str(raw).strip()
    return NAME_FIXES.get(name, name)

def fmt_date(d):
    return d.strftime("%Y-%m-%d") if isinstance(d, (datetime, date_type)) else str(d)

def load_fall_2026():
    """Parse the Fall 2026 sheet: Date, Location, P1a, P1b, P2a, P2b, S1, S2."""
    with open(NEW_SRC, "rb") as f:
        wb = openpyxl.load_workbook(f, data_only=True)
    ws = wb[NEW_SHEET]
    games, skipped = [], 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        date, _loc, p1a, p1b, p2a, p2b, s1, s2 = row[:8]
        if date is None:
            continue
        players = [clean_name(x) for x in (p1a, p1b, p2a, p2b)]
        try:
            s1, s2 = int(s1), int(s2)
        except (TypeError, ValueError):
            skipped += 1
            continue
        if None in players:
            skipped += 1
            continue
        games.append({
            "date": fmt_date(date),
            "pair1": players[:2],
            "pair2": players[2:],
            "score1": s1,
            "score2": s2,
        })
    return games, skipped

def merge_fall_2026():
    new, skipped = load_fall_2026()
    if not new:
        sys.exit("No games found in the Fall 2026 sheet; nothing changed.")
    start = min(g["date"] for g in new)
    with open(OUT, encoding="utf-8") as f:
        existing = json.load(f)
    kept = [g for g in existing if g["date"] < start]
    replaced = len(existing) - len(kept)
    games = kept + new  # stable sort keeps within-day order from the sheet
    games.sort(key=lambda g: g["date"])
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(games, f, indent=1)
    print(f"Kept {len(kept)} games before {start}, replaced {replaced}, "
          f"added {len(new)} ({skipped} rows skipped). Total: {len(games)} -> {OUT}")

def main_legacy():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    ws = wb["The Book"]

    games = []
    skipped = 0
    for row in ws.iter_rows(min_row=3, values_only=True):
        date, _, p1a, p1b, _, p2a, p2b, _, s1, s2, _winner_col = row
        if date is None:
            continue
        p1a, p1b, p2a, p2b = (clean_name(x) for x in (p1a, p1b, p2a, p2b))
        if None in (p1a, p1b, p2a, p2b) or s1 is None or s2 is None:
            skipped += 1
            continue
        try:
            s1, s2 = int(s1), int(s2)
        except (TypeError, ValueError):
            skipped += 1
            continue

        games.append({
            "date": fmt_date(date),
            "pair1": [p1a, p1b],
            "pair2": [p2a, p2b],
            "score1": s1,
            "score2": s2,
        })

    games.sort(key=lambda g: g["date"])

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(games, f, indent=1)

    print(f"Wrote {len(games)} games to {OUT} ({skipped} rows skipped as incomplete)")

def main():
    if "--legacy" in sys.argv:
        main_legacy()
    else:
        merge_fall_2026()

if __name__ == "__main__":
    main()
