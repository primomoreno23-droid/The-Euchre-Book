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

Match results live in `data/Euchre_Book.xlsx`, one sheet per season or
tournament. The old **"The Book"** sheet is ignored. To regenerate
`data/games.json` after new games are added:

```bash
pip install openpyxl
python scripts/build_data.py
```

The script reads every sheet and finds columns by header name. Each game gets
`date`, `location` (or `null` when the cell says `NULL`), `pair1`, `pair2`,
`score1` and `score2`. Sheets with a **Round** column are tournaments: their
games also get `tournament` (the sheet name) and `round` (a number, or
"Semi-Final" / "Final"). `games.json` is fully regenerated each run, so make
corrections in the spreadsheet, not in the JSON.

### Updating the photo banner

The rotating banner at the top of the Overview & Leaderboard page shows the
photos listed in `js/banner.js`. To add one:

1. Put the photo in `visuals/`.
2. Run `python scripts/build_photos.py`. It writes a resized copy to
   `visuals/web/` with all metadata (including phone GPS location) removed.
3. Add `{ file: "<name>.jpg", caption: "..." }` to the `PHOTOS` list in
   `js/banner.js`.

### Name cleanup

The data script trims stray whitespace from names and fixes a few confirmed one-off
typos ("Done" → "Don", "Jayleee" → "Jaylee", "Niclole" → "Nicole"); it does not
attempt to merge other similarly-spelled names (e.g. "Lucas" vs "Lukas") since
those may be different people.
