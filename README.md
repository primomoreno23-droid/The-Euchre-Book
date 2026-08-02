# The Euchre Book

A digital collection of Euchre match data from the QC Euchre Club — and a static
stats dashboard built on top of it.

## Site

The dashboard (`index.html`) is a plain HTML/CSS/JS static site — no build step,
no server required. It reads `data/games.json` and computes, in the browser:

- Club-wide totals (games played, players tracked, average margin of victory, games per season)
- A sortable leaderboard (wins, losses, win %, point differential) with a min-games filter
- Teammate synergy: every partnership ranked by win rate as a pair
- A per-player profile: record, best teammates, toughest opponents, and a
  cumulative point-differential chart over time
- A searchable, filterable full game log

### Running locally

Open `index.html` directly with `file://` and the browser will block the
`fetch()` for `data/games.json` (CORS). Serve the folder instead:

```bash
python -m http.server 8123
```

then visit `http://localhost:8123`.

### Publishing to GitHub Pages

1. Push this repo to GitHub (if not already).
2. In the repo on GitHub: **Settings → Pages → Build and deployment → Source:
   Deploy from a branch**, branch `main`, folder `/ (root)`.
3. The site will be live at `https://<username>.github.io/The-Euchre-Book/`.

### Updating the data

Match results live in `Euchre_Book.xlsx`, on the **"The Book"** sheet (the
master log all season tabs roll up into). To regenerate `data/games.json`
after new games are added:

```bash
pip install openpyxl
python scripts/build_data.py
```

Edit the `SRC` path at the top of `scripts/build_data.py` to point at your
copy of the spreadsheet. The script trims stray whitespace from names and
fixes two confirmed one-off typos ("Done" → "Don", "Jayleee" → "Jaylee"); it
does not attempt to merge other similarly-spelled names (e.g. "Lucas" vs
"Lukas") since those may be different people.
