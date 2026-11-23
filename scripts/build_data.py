"""
Builds data/games.json for the GitHub Pages site. All stats (win %, point diff,
teammate synergy, etc.) are computed client-side in JS from this file.

    python scripts/build_data.py

Reads every sheet in data/Euchre_Book.xlsx except "The Book" (the old master
log, which is no longer maintained). Each sheet is one season or tournament.
Columns are located by header name, so spacer columns and column order don't
matter. Expected headers:

    Date, Location, Partner Pair 1 Person 1, Partner Pair 1 Person 2,
    Partner Pair 2 Person 1, Partner Pair 2 Person 2,
    Final Score Pair 1, Final Score Pair 2, [Round]

A sheet with a "Round" column is treated as a tournament: its games get
"tournament" (the sheet name) and "round" fields. games.json is fully
regenerated each run, so fix data in the spreadsheet, not in the JSON.
"""
import json
import sys
from datetime import datetime, date as date_type
import openpyxl

SRC = "data/Euchre_Book.xlsx"
OUT = "data/games.json"
SKIP_SHEETS = {"The Book"}

COLS = {
    "date": "Date",
    "location": "Location",
    "p1a": "Partner Pair 1 Person 1",
    "p1b": "Partner Pair 1 Person 2",
    "p2a": "Partner Pair 2 Person 1",
    "p2b": "Partner Pair 2 Person 2",
    "s1": "Final Score Pair 1",
    "s2": "Final Score Pair 2",
}

# Unambiguous cleanup: obvious typos confirmed against the roster
# (no other similarly-named player exists).
NAME_FIXES = {
    "Done": "Don",
    "Jayleee": "Jaylee",
    "Niclole": "Nicole",
}

# Normalize spelling variants of named tournament rounds.
ROUND_FIXES = {
    "semi-final": "Semi-Final",
    "semi-finals": "Semi-Final",
    "semifinal": "Semi-Final",
    "semifinals": "Semi-Final",
    "final": "Final",
    "finals": "Final",
}

def clean_str(raw):
    if raw is None:
        return None
    s = str(raw).strip()
    return None if s == "" or s.upper() == "NULL" else s

def clean_name(raw):
    name = clean_str(raw)
    return NAME_FIXES.get(name, name) if name else None

def clean_round(raw):
    if isinstance(raw, float) and raw.is_integer():
        raw = int(raw)
    if isinstance(raw, int):
        return raw
    s = clean_str(raw)
    if s is None:
        return None
    if s.isdigit():
        return int(s)
    return ROUND_FIXES.get(s.lower(), s)

def fmt_date(d):
    return d.strftime("%Y-%m-%d") if isinstance(d, (datetime, date_type)) else str(d)

def find_header(ws):
    """Return (header_row_number, {header_text: column_index})."""
    for i, row in enumerate(ws.iter_rows(max_row=10, values_only=True), start=1):
        cells = {str(v).strip(): j for j, v in enumerate(row) if v is not None}
        if "Date" in cells:
            return i, cells
    return None, None

def load_sheet(ws):
    header_row, idx = find_header(ws)
    if header_row is None:
        print(f"  ! {ws.title}: no 'Date' header found, sheet skipped")
        return [], 0
    missing = [h for h in COLS.values() if h not in idx]
    if missing:
        sys.exit(f"Sheet '{ws.title}' is missing column(s): {', '.join(missing)}")
    col = {k: idx[h] for k, h in COLS.items()}
    round_col = idx.get("Round")

    games, skipped = [], 0
    for row in ws.iter_rows(min_row=header_row + 1, values_only=True):
        get = lambda k: row[col[k]] if col[k] < len(row) else None
        date = get("date")
        if date is None:
            continue
        players = [clean_name(get(k)) for k in ("p1a", "p1b", "p2a", "p2b")]
        try:
            s1, s2 = int(get("s1")), int(get("s2"))
        except (TypeError, ValueError):
            skipped += 1
            continue
        if None in players:
            skipped += 1
            continue
        game = {
            "date": fmt_date(date),
            "location": clean_str(get("location")),
            "pair1": players[:2],
            "pair2": players[2:],
            "score1": s1,
            "score2": s2,
        }
        if round_col is not None:
            game["tournament"] = ws.title
            game["round"] = clean_round(row[round_col] if round_col < len(row) else None)
        games.append(game)
    return games, skipped

def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    games, total_skipped = [], 0
    for ws in wb.worksheets:
        if ws.title in SKIP_SHEETS:
            continue
        sheet_games, skipped = load_sheet(ws)
        total_skipped += skipped
        print(f"  {ws.title}: {len(sheet_games)} games"
              + (f" ({skipped} incomplete rows skipped)" if skipped else ""))
        games.extend(sheet_games)

    games.sort(key=lambda g: g["date"])  # stable: keeps within-day sheet order
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(games, f, indent=1)
    print(f"Wrote {len(games)} games to {OUT} ({total_skipped} rows skipped)")

if __name__ == "__main__":
    main()
