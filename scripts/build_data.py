"""
Reads the Euchre_Book.xlsx master log ("The Book" sheet) and produces a cleaned
data/games.json for the GitHub Pages site. All stats (win %, point diff,
teammate synergy, etc.) are computed client-side in JS from this file.
"""
import json
import sys
from datetime import datetime
import openpyxl

SRC = r"C:\Users\primo\Downloads\Euchre_Book.xlsx"
OUT = "data/games.json"

# Unambiguous cleanup: trailing/leading whitespace + a couple of obvious typos
# confirmed against the roster (no other similarly-named player exists).
NAME_FIXES = {
    "Done": "Don",
    "Jayleee": "Jaylee",
}

def clean_name(raw):
    if raw is None:
        return None
    name = str(raw).strip()
    return NAME_FIXES.get(name, name)

def main():
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
            "date": date.strftime("%Y-%m-%d") if isinstance(date, datetime) else str(date),
            "pair1": [p1a, p1b],
            "pair2": [p2a, p2b],
            "score1": s1,
            "score2": s2,
        })

    games.sort(key=lambda g: g["date"])

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(games, f, indent=1)

    print(f"Wrote {len(games)} games to {OUT} ({skipped} rows skipped as incomplete)")

if __name__ == "__main__":
    main()
