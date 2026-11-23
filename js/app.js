/* The Euchre Book — club stats dashboard. All computation runs client-side
   against data/games.json (produced by scripts/build_data.py). */

(function () {
  "use strict";

  const SVGNS = "http://www.w3.org/2000/svg";

  // ---------- theme ----------
  const themeBtn = document.getElementById("theme-toggle");
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
  }
  applyTheme(localStorage.getItem("euchre-theme"));
  themeBtn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : (current === "light" ? null : "dark");
    applyTheme(next);
    if (next) localStorage.setItem("euchre-theme", next);
    else localStorage.removeItem("euchre-theme");
  });

  // ---------- helpers ----------
  const fmtPct = (x) => (x * 100).toFixed(1) + "%";
  const fmtSigned = (n) => (n > 0 ? "+" : "") + n.toFixed(1);
  const fmtSignedInt = (n) => (n > 0 ? "+" : "") + n;
  const fmtDate = (d) => d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  function seasonOf(date) {
    const m = date.getMonth() + 1; // 1-12
    const y = date.getFullYear();
    if (m === 1) return `J-Term ${y}`;
    if (m >= 2 && m <= 7) return `Spring ${y}`;
    return `Fall ${y}`; // Aug-Dec
  }

  function seasonSortKey(season) {
    const [name, year] = season.split(" ");
    // calendar order within a year: J-Term (Jan), Spring (Feb-Jul), Fall (Aug-Dec)
    const order = { "J-Term": 0, "Spring": 1, "Fall": 2 };
    return parseInt(year, 10) * 10 + order[name];
  }

  // tournament round: numbers become "Round N", names ("Semi-Final", "Final") pass through
  function fmtRound(round) {
    return typeof round === "number" ? `Round ${round}` : String(round);
  }

  // [[location, gameCount], ...] for games with a known location, most-played first
  function locationCounts(games) {
    const m = new Map();
    for (const g of games) if (g.location) m.set(g.location, (m.get(g.location) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  function pairKey(a, b) {
    return [a, b].sort((x, y) => x.localeCompare(y));
  }

  // ---------- load & derive ----------
  fetch("data/games.json")
    .then((r) => r.json())
    .then((raw) => {
      const games = raw.map((g) => {
        const date = new Date(g.date + "T00:00:00");
        return { ...g, dateObj: date, season: seasonOf(date) };
      });
      init(games);
    })
    .catch((err) => {
      document.querySelector("main").insertAdjacentHTML(
        "afterbegin",
        `<p class="empty-state">Couldn't load game data (${err.message}). If you're viewing this from a local file, serve it over http:// instead (e.g. <code>python -m http.server</code>).</p>`
      );
    });

  function init(games) {
    const { playerStats, partnerStats, opponentStats, seasonCounts } = computeStats(games);

    const footerCount = document.getElementById("footer-count");
    if (footerCount) footerCount.textContent = games.length;

    // each page only renders the sections it contains
    const page = document.body.dataset.page;
    if (page === "overview") {
      renderOverview(games, playerStats, seasonCounts);
      renderLeaderboard(playerStats);
    } else if (page === "teammates") {
      renderTeammates(partnerStats);
    } else if (page === "profile") {
      renderProfile(playerStats, partnerStats, opponentStats, games);
    } else if (page === "games") {
      renderGameLog(games);
    }
  }

  // ---------- stats computation ----------
  function computeStats(games) {
    const playerStats = new Map(); // name -> {games,wins,losses,pointsFor,pointsAgainst,diffSum,history:[{date,diff,win}]}
    const partnerStats = new Map(); // "A|B" -> {players:[a,b],games,wins,losses,diffSum}
    const opponentStats = new Map(); // name -> Map(opponentName -> {games,wins,diffSum})
    const seasonCounts = new Map();

    function ensurePlayer(name) {
      if (!playerStats.has(name)) {
        playerStats.set(name, { name, games: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, diffSum: 0, history: [] });
      }
      return playerStats.get(name);
    }
    function ensureOpp(a, b) {
      if (!opponentStats.has(a)) opponentStats.set(a, new Map());
      const m = opponentStats.get(a);
      if (!m.has(b)) m.set(b, { games: 0, wins: 0, diffSum: 0 });
      return m.get(b);
    }

    for (const g of games) {
      seasonCounts.set(g.season, (seasonCounts.get(g.season) || 0) + 1);

      const diff1 = g.score1 - g.score2;
      const win1 = g.score1 > g.score2;

      // players
      for (const name of g.pair1) {
        const p = ensurePlayer(name);
        p.games++; p.wins += win1 ? 1 : 0; p.losses += win1 ? 0 : 1;
        p.pointsFor += g.score1; p.pointsAgainst += g.score2; p.diffSum += diff1;
        p.history.push({ date: g.dateObj, diff: diff1, win: win1, season: g.season });
      }
      for (const name of g.pair2) {
        const p = ensurePlayer(name);
        p.games++; p.wins += win1 ? 0 : 1; p.losses += win1 ? 1 : 0;
        p.pointsFor += g.score2; p.pointsAgainst += g.score1; p.diffSum += -diff1;
        p.history.push({ date: g.dateObj, diff: -diff1, win: !win1, season: g.season });
      }

      // partnerships
      for (const [pair, diff, win] of [[g.pair1, diff1, win1], [g.pair2, -diff1, !win1]]) {
        const key = pairKey(pair[0], pair[1]).join("|");
        if (!partnerStats.has(key)) {
          partnerStats.set(key, { players: pairKey(pair[0], pair[1]), games: 0, wins: 0, losses: 0, diffSum: 0 });
        }
        const ps = partnerStats.get(key);
        ps.games++; ps.wins += win ? 1 : 0; ps.losses += win ? 0 : 1; ps.diffSum += diff;
      }

      // opponents (cross product)
      for (const a of g.pair1) for (const b of g.pair2) {
        const oa = ensureOpp(a, b); oa.games++; oa.wins += win1 ? 1 : 0; oa.diffSum += diff1;
        const ob = ensureOpp(b, a); ob.games++; ob.wins += win1 ? 0 : 1; ob.diffSum += -diff1;
      }
    }

    for (const p of playerStats.values()) {
      p.history.sort((a, b) => a.date - b.date);
    }

    return { playerStats, partnerStats, opponentStats, seasonCounts };
  }

  // ---------- SVG chart helpers ----------
  function el(tag, attrs) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  const tooltip = document.getElementById("chart-tooltip");
  function showTooltip(evt, html) {
    tooltip.innerHTML = html;
    tooltip.classList.add("visible");
    moveTooltip(evt);
  }
  function moveTooltip(evt) {
    const pad = 14;
    tooltip.style.left = (evt.pageX + pad) + "px";
    tooltip.style.top = (evt.pageY - 10) + "px";
  }
  function hideTooltip() { tooltip.classList.remove("visible"); }

  function roundedTopBarPath(x, w, baseY, topY, r) {
    const h = baseY - topY;
    r = Math.min(r, w / 2, Math.max(h, 0));
    if (h <= 0) return `M ${x},${baseY} L ${x + w},${baseY} Z`;
    return `M ${x},${baseY}
            L ${x},${topY + r}
            Q ${x},${topY} ${x + r},${topY}
            L ${x + w - r},${topY}
            Q ${x + w},${topY} ${x + w},${topY + r}
            L ${x + w},${baseY} Z`;
  }
  function roundedRightBarPath(baseX, y, h, rightX, r) {
    const w = rightX - baseX;
    r = Math.min(r, h / 2, Math.max(w, 0));
    if (w <= 0) return `M ${baseX},${y} L ${baseX},${y + h} Z`;
    return `M ${baseX},${y}
            L ${rightX - r},${y}
            Q ${rightX},${y} ${rightX},${y + r}
            L ${rightX},${y + h - r}
            Q ${rightX},${y + h} ${rightX - r},${y + h}
            L ${baseX},${y + h} Z`;
  }

  // vertical bar chart, categories on x
  function drawVerticalBarChart(svg, data, opts) {
    opts = opts || {};
    const valueFmt = opts.valueFmt || ((v) => String(v));
    const W = svg.parentElement.clientWidth || 600;
    const H = opts.height || 220;
    const marginL = 40, marginR = 12, marginT = 16, marginB = 34;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", H);
    svg.innerHTML = "";

    const plotW = W - marginL - marginR;
    const plotH = H - marginT - marginB;
    const maxV = Math.max(1, ...data.map((d) => d.value));
    const baseY = marginT + plotH;
    const n = data.length;
    const slot = plotW / n;
    const barW = Math.min(28, slot * 0.6);

    // gridlines (0 and max)
    [0, 0.5, 1].forEach((frac) => {
      const y = baseY - plotH * frac;
      svg.appendChild(el("line", { x1: marginL, x2: W - marginR, y1: y, y2: y, class: "gridline" }));
      const label = el("text", { x: marginL - 8, y: y + 3, class: "tick-label", "text-anchor": "end" });
      label.textContent = Math.round(maxV * frac);
      svg.appendChild(label);
    });
    svg.appendChild(el("line", { x1: marginL, x2: marginL, y1: marginT, y2: baseY, class: "axis-line" }));

    data.forEach((d, i) => {
      const cx = marginL + slot * i + slot / 2;
      const h = (d.value / maxV) * plotH;
      const topY = baseY - h;
      const path = el("path", { d: roundedTopBarPath(cx - barW / 2, barW, baseY, topY, 4), class: "bar" });
      const hit = el("rect", { x: cx - slot / 2 + 1, y: marginT, width: slot - 2, height: plotH, class: "chart-hover-target" });
      svg.appendChild(path);

      const valLabel = el("text", { x: cx, y: topY - 6, class: "bar-label", "text-anchor": "middle" });
      valLabel.textContent = valueFmt(d.value);
      svg.appendChild(valLabel);

      const catLabel = el("text", { x: cx, y: H - marginB + 16, class: "cat-label", "text-anchor": "middle" });
      catLabel.textContent = d.label;
      svg.appendChild(catLabel);

      hit.addEventListener("mousemove", (evt) => { showTooltip(evt, `<strong>${d.label}</strong><br>${valueFmt(d.value)}`); moveTooltip(evt); });
      hit.addEventListener("mouseleave", hideTooltip);
      svg.appendChild(hit);
    });
  }

  // horizontal bar chart, categories on y (top N)
  function drawHorizontalBarChart(svg, data, opts) {
    opts = opts || {};
    const valueFmt = opts.valueFmt || ((v) => String(v));
    const W = svg.parentElement.clientWidth || 600;
    const rowH = 26;
    const marginL = 100, marginR = 54, marginT = 8, marginB = 8;
    const H = data.length * rowH + marginT + marginB;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", H);
    svg.innerHTML = "";

    const plotW = W - marginL - marginR;
    const maxV = Math.max(0.0001, ...data.map((d) => d.value));

    data.forEach((d, i) => {
      const y = marginT + i * rowH;
      const barH = Math.min(20, rowH * 0.65);
      const barY = y + (rowH - barH) / 2;
      const w = (d.value / maxV) * plotW;
      const path = el("path", { d: roundedRightBarPath(marginL, barY, barH, marginL + w, 4), class: "bar" });
      const hit = el("rect", { x: 0, y: y, width: W, height: rowH, class: "chart-hover-target" });

      const catLabel = el("text", { x: marginL - 8, y: y + rowH / 2 + 4, class: "cat-label", "text-anchor": "end" });
      catLabel.textContent = d.label;

      const valLabel = el("text", { x: marginL + w + 6, y: y + rowH / 2 + 4, class: "bar-label" });
      valLabel.textContent = valueFmt(d.value);

      svg.appendChild(catLabel);
      svg.appendChild(path);
      svg.appendChild(valLabel);
      hit.addEventListener("mousemove", (evt) => { showTooltip(evt, `<strong>${d.label}</strong><br>${valueFmt(d.value)}${d.sub ? "<br><span style='color:var(--text-muted)'>" + d.sub + "</span>" : ""}`); moveTooltip(evt); });
      hit.addEventListener("mouseleave", hideTooltip);
      svg.appendChild(hit);
    });

    if (data.length === 0) {
      svg.setAttribute("height", 40);
    }
  }

  // line chart with zero baseline + area wash, for cumulative point diff over time
  function drawLineChart(svg, points, opts) {
    opts = opts || {};
    const W = svg.parentElement.clientWidth || 600;
    const H = opts.height || 180;
    const marginL = 44, marginR = 14, marginT = 16, marginB = 28;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", H);
    svg.innerHTML = "";

    if (points.length === 0) {
      svg.setAttribute("height", 40);
      return;
    }

    const plotW = W - marginL - marginR;
    const plotH = H - marginT - marginB;
    const ys = points.map((p) => p.y);
    let maxV = Math.max(0, ...ys), minV = Math.min(0, ...ys);
    if (maxV === minV) { maxV += 1; minV -= 1; }
    const yScale = (v) => marginT + plotH - ((v - minV) / (maxV - minV)) * plotH;
    const xScale = (i) => points.length === 1 ? marginL + plotW / 2 : marginL + (i / (points.length - 1)) * plotW;

    const zeroY = yScale(0);
    svg.appendChild(el("line", { x1: marginL, x2: W - marginR, y1: zeroY, y2: zeroY, class: "zero-line" }));
    [maxV, minV].forEach((v) => {
      const y = yScale(v);
      const label = el("text", { x: marginL - 8, y: y + 3, class: "tick-label", "text-anchor": "end" });
      label.textContent = fmtSignedInt(Math.round(v));
      svg.appendChild(label);
    });

    let linePath = "", areaPath = "";
    points.forEach((p, i) => {
      const x = xScale(i), y = yScale(p.y);
      linePath += (i === 0 ? "M" : "L") + x + "," + y + " ";
    });
    areaPath = "M" + xScale(0) + "," + zeroY + " " + linePath.slice(1) + `L${xScale(points.length - 1)},${zeroY} Z`;

    svg.appendChild(el("path", { d: areaPath, class: "area-path" }));
    svg.appendChild(el("path", { d: linePath, class: "line-path" }));

    points.forEach((p, i) => {
      const x = xScale(i), y = yScale(p.y);
      const hit = el("circle", { cx: x, cy: y, r: 9, class: "chart-hover-target" });
      hit.addEventListener("mousemove", (evt) => { showTooltip(evt, `<strong>${fmtDate(p.date)}</strong><br>Cumulative diff: ${fmtSignedInt(p.y)}<br>Game diff: ${fmtSignedInt(p.gameDiff)}`); moveTooltip(evt); });
      hit.addEventListener("mouseleave", hideTooltip);
      svg.appendChild(hit);
    });

    const last = points[points.length - 1];
    svg.appendChild(el("circle", { cx: xScale(points.length - 1), cy: yScale(last.y), r: 4, class: "end-dot" }));
    const lastLabel = el("text", { x: xScale(points.length - 1), y: yScale(last.y) - 10, class: "bar-label", "text-anchor": "end" });
    lastLabel.textContent = fmtSignedInt(last.y);
    svg.appendChild(lastLabel);
  }

  // ---------- progress (improvement over time) ----------
  const MIN_GAMES_FOR_PROGRESS = 10;   // below this, trend charts are mostly noise
  const MIN_GAMES_FOR_SEASON = 8;      // seasons with fewer games are dimmed
  const MIN_GAMES_FOR_LOCATION = 3;    // location rows with fewer games are dimmed
  const ROLLING_WINDOWS = [10, 15, 25];
  const DEFAULT_ROLLING_WINDOW = 15;

  // 95% Wilson score interval for a win rate
  function wilson(wins, n) {
    const z = 1.96, p = wins / n;
    const denom = 1 + (z * z) / n;
    const center = (p + (z * z) / (2 * n)) / denom;
    const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
    return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
  }

  // rolling win % over the last `win` games; x-axis is the player's game number
  function computeRolling(history, win) {
    const startAt = Math.min(5, win); // first point once there are a few games
    const pts = [];
    for (let i = startAt - 1; i < history.length; i++) {
      const slice = history.slice(Math.max(0, i - win + 1), i + 1);
      const wins = slice.filter((h) => h.win).length;
      const ci = wilson(wins, slice.length);
      pts.push({ idx: i, game: i + 1, date: history[i].date, season: history[i].season,
                 n: slice.length, wins, pct: wins / slice.length, lo: ci.lo, hi: ci.hi });
    }
    return pts;
  }

  function drawRollingChart(svg, history, win) {
    const pts = computeRolling(history, win);
    const W = svg.parentElement.clientWidth || 600;
    const H = 220;
    const marginL = 46, marginR = 14, marginT = 18, marginB = 26;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", H);
    svg.innerHTML = "";

    const plotW = W - marginL - marginR;
    const plotH = H - marginT - marginB;
    const total = history.length;
    const xScale = (idx) => marginL + (total === 1 ? plotW / 2 : (idx / (total - 1)) * plotW);
    const yScale = (v) => marginT + plotH - v * plotH;

    // gridlines + 50% reference
    [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
      const y = yScale(v);
      svg.appendChild(el("line", { x1: marginL, x2: W - marginR, y1: y, y2: y, class: v === 0.5 ? "ref-line" : "gridline" }));
      const t = el("text", { x: marginL - 8, y: y + 3, class: "tick-label", "text-anchor": "end" });
      t.textContent = Math.round(v * 100) + "%";
      svg.appendChild(t);
    });

    // season boundaries
    let lastLabelX = -Infinity;
    for (let i = 1; i < total; i++) {
      if (history[i].season !== history[i - 1].season) {
        const x = (xScale(i - 1) + xScale(i)) / 2;
        svg.appendChild(el("line", { x1: x, x2: x, y1: marginT, y2: marginT + plotH, class: "season-line" }));
        if (x - lastLabelX > 56) {
          const t = el("text", { x: x + 3, y: marginT + 9, class: "tick-label" });
          t.textContent = history[i].season;
          svg.appendChild(t);
          lastLabelX = x;
        }
      }
    }

    // x-axis ticks: first and last game
    [[0, "start"], [total - 1, "end"]].forEach(([idx, anchor]) => {
      const t = el("text", { x: xScale(idx), y: H - 8, class: "tick-label", "text-anchor": anchor });
      t.textContent = "Game " + (idx + 1);
      svg.appendChild(t);
    });

    // confidence band
    const upper = pts.map((p) => `${xScale(p.idx)},${yScale(p.hi)}`);
    const lower = pts.map((p) => `${xScale(p.idx)},${yScale(p.lo)}`).reverse();
    svg.appendChild(el("path", { d: "M" + upper.concat(lower).join(" L") + " Z", class: "band-path" }));

    // line
    const line = pts.map((p, i) => (i === 0 ? "M" : "L") + xScale(p.idx) + "," + yScale(p.pct)).join(" ");
    svg.appendChild(el("path", { d: line, class: "line-path" }));

    // hover: one vertical slice per point
    const slot = total > 1 ? plotW / (total - 1) : plotW;
    pts.forEach((p) => {
      const x = xScale(p.idx);
      const hit = el("rect", { x: x - slot / 2, y: marginT, width: slot, height: plotH, class: "chart-hover-target" });
      hit.addEventListener("mousemove", (evt) => {
        showTooltip(evt, `<strong>Game ${p.game}</strong> · ${fmtDate(p.date)}<br>Last ${p.n}: ${p.wins}-${p.n - p.wins} (${fmtPct(p.pct)})<br><span style='color:var(--text-muted)'>95% range ${fmtPct(p.lo)}–${fmtPct(p.hi)}</span>`);
        moveTooltip(evt);
      });
      hit.addEventListener("mouseleave", hideTooltip);
      svg.appendChild(hit);
    });

    const last = pts[pts.length - 1];
    svg.appendChild(el("circle", { cx: xScale(last.idx), cy: yScale(last.pct), r: 4, class: "end-dot" }));
    const lbl = el("text", { x: xScale(last.idx), y: yScale(last.pct) - 10, class: "bar-label", "text-anchor": "end" });
    lbl.textContent = fmtPct(last.pct);
    svg.appendChild(lbl);
  }

  // per-season win % bars (50% reference line), thin seasons dimmed
  function drawSeasonProgress(svg, history) {
    const bySeason = new Map();
    for (const h of history) {
      if (!bySeason.has(h.season)) bySeason.set(h.season, { season: h.season, games: 0, wins: 0, diffSum: 0 });
      const s = bySeason.get(h.season);
      s.games++; s.wins += h.win ? 1 : 0; s.diffSum += h.diff;
    }
    const data = [...bySeason.values()].sort((a, b) => seasonSortKey(a.season) - seasonSortKey(b.season));

    const W = svg.parentElement.clientWidth || 600;
    const H = 230;
    const marginL = 46, marginR = 12, marginT = 18, marginB = 58;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", H);
    svg.innerHTML = "";

    const plotW = W - marginL - marginR;
    const plotH = H - marginT - marginB;
    const baseY = marginT + plotH;
    const yScale = (v) => baseY - v * plotH;

    [0, 0.5, 1].forEach((v) => {
      const y = yScale(v);
      svg.appendChild(el("line", { x1: marginL, x2: W - marginR, y1: y, y2: y, class: v === 0.5 ? "ref-line" : "gridline" }));
      const t = el("text", { x: marginL - 8, y: y + 3, class: "tick-label", "text-anchor": "end" });
      t.textContent = Math.round(v * 100) + "%";
      svg.appendChild(t);
    });

    const slot = plotW / data.length;
    const barW = Math.min(44, slot * 0.6);
    data.forEach((s, i) => {
      const cx = marginL + slot * i + slot / 2;
      const pct = s.wins / s.games;
      const thin = s.games < MIN_GAMES_FOR_SEASON;
      const path = el("path", { d: roundedTopBarPath(cx - barW / 2, barW, baseY, yScale(pct), 4), class: "bar" + (thin ? " bar-dim" : "") });
      svg.appendChild(path);

      const v = el("text", { x: cx, y: yScale(pct) - 6, class: "bar-label", "text-anchor": "middle" });
      v.textContent = fmtPct(pct);
      svg.appendChild(v);

      const [nm, yr] = s.season.split(" ");
      [[nm, "cat-label", baseY + 15], [yr, "cat-label", baseY + 28],
       [`${s.games} g · ${fmtSigned(s.diffSum / s.games)} avg`, "tick-label", baseY + 43]].forEach(([txt, cls, y]) => {
        const t = el("text", { x: cx, y, class: cls, "text-anchor": "middle" });
        t.textContent = txt;
        svg.appendChild(t);
      });

      const hit = el("rect", { x: cx - slot / 2 + 1, y: marginT, width: slot - 2, height: plotH + marginB - 4, class: "chart-hover-target" });
      hit.addEventListener("mousemove", (evt) => {
        showTooltip(evt, `<strong>${s.season}</strong><br>${s.wins}-${s.games - s.wins} (${fmtPct(pct)})<br>Avg point diff: ${fmtSigned(s.diffSum / s.games)}${thin ? "<br><span style='color:var(--text-muted)'>Small sample (&lt;" + MIN_GAMES_FOR_SEASON + " games)</span>" : ""}`);
        moveTooltip(evt);
      });
      hit.addEventListener("mouseleave", hideTooltip);
      svg.appendChild(hit);
    });
  }

  // ---------- generic sortable table ----------
  function wireSortableTable(table, getRows, columns, renderRow) {
    const thead = table.querySelector("thead");
    let sortKey = thead.querySelector("th.sorted")?.dataset.key || columns[0].key;
    let sortDir = -1; // descending default

    function apply() {
      const rows = getRows();
      const col = columns.find((c) => c.key === sortKey);
      rows.sort((a, b) => {
        const av = col.sort(a), bv = col.sort(b);
        if (av < bv) return -1 * sortDir;
        if (av > bv) return 1 * sortDir;
        return 0;
      });
      const tbody = table.querySelector("tbody");
      tbody.innerHTML = "";
      if (rows.length === 0) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = columns.length;
        td.className = "empty-state";
        td.textContent = "No matching results.";
        tr.appendChild(td);
        tbody.appendChild(tr);
      } else {
        rows.forEach((r) => tbody.appendChild(renderRow(r)));
      }
      thead.querySelectorAll("th").forEach((th) => {
        th.classList.remove("sorted", "sorted-asc");
        if (th.dataset.key === sortKey) th.classList.add(sortDir === 1 ? "sorted-asc" : "sorted");
      });
      return rows.length;
    }

    thead.querySelectorAll("th[data-key]").forEach((th) => {
      th.addEventListener("click", () => {
        if (sortKey === th.dataset.key) sortDir *= -1;
        else { sortKey = th.dataset.key; sortDir = -1; }
        apply();
      });
    });

    return apply;
  }

  // ---------- Overview ----------
  function renderOverview(games, playerStats, seasonCounts) {
    const tiles = document.getElementById("overview-tiles");
    const totalGames = games.length;
    const totalPlayers = playerStats.size;
    const avgMargin = games.reduce((s, g) => s + Math.abs(g.score1 - g.score2), 0) / totalGames;
    const dates = games.map((g) => g.dateObj);
    const minDate = new Date(Math.min(...dates)), maxDate = new Date(Math.max(...dates));
    const seasons = seasonCounts.size;

    const tileData = [
      { label: "Total games", value: totalGames.toLocaleString() },
      { label: "Players tracked", value: totalPlayers.toLocaleString() },
      { label: "Avg. margin of victory", value: avgMargin.toFixed(1) + " pts" },
      { label: "Seasons on record", value: String(seasons) },
      { label: "Locations played", value: String(locationCounts(games).length) },
      { label: "Date range", value: fmtDate(minDate) + " – " + fmtDate(maxDate), small: true },
    ];
    tiles.innerHTML = tileData.map((t) =>
      `<div class="tile"><div class="tile-label">${t.label}</div><div class="tile-value" style="${t.small ? "font-size:1.05rem" : ""}">${t.value}</div></div>`
    ).join("");

    const seasonData = [...seasonCounts.entries()]
      .sort((a, b) => seasonSortKey(a[0]) - seasonSortKey(b[0]))
      .map(([label, value]) => ({ label, value }));
    drawVerticalBarChart(document.getElementById("season-chart"), seasonData);
    window.addEventListener("resize", debounce(() => drawVerticalBarChart(document.getElementById("season-chart"), seasonData), 150));

    // games by location
    const locData = locationCounts(games).map(([label, value]) => ({ label, value, sub: `${fmtPct(value / totalGames)} of all games` }));
    const unknown = games.filter((g) => !g.location).length;
    const note = document.getElementById("location-chart-note");
    if (note && unknown) note.textContent = `(${unknown} games with no location recorded aren't shown)`;
    const locSvg = document.getElementById("location-chart");
    drawHorizontalBarChart(locSvg, locData, { valueFmt: (v) => `${v} games` });
    window.addEventListener("resize", debounce(() => drawHorizontalBarChart(locSvg, locData, { valueFmt: (v) => `${v} games` }), 150));
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ---------- Leaderboard ----------
  function renderLeaderboard(playerStats) {
    const table = document.getElementById("leaderboard-table");
    const searchInput = document.getElementById("lb-search");
    const minGamesSel = document.getElementById("lb-mingames");
    const countPill = document.getElementById("lb-count");
    const chartSvg = document.getElementById("winpct-chart");

    function toRow(p) {
      return {
        name: p.name, games: p.games, wins: p.wins, losses: p.losses,
        winPct: p.games ? p.wins / p.games : 0,
        avgDiff: p.games ? p.diffSum / p.games : 0,
        totalDiff: p.diffSum,
      };
    }

    function getRows() {
      const minGames = parseInt(minGamesSel.value, 10);
      const q = searchInput.value.trim().toLowerCase();
      return [...playerStats.values()]
        .filter((p) => p.games >= minGames && p.name.toLowerCase().includes(q))
        .map(toRow);
    }

    const columns = [
      { key: "name", sort: (r) => r.name.toLowerCase() },
      { key: "games", sort: (r) => r.games },
      { key: "wins", sort: (r) => r.wins },
      { key: "losses", sort: (r) => r.losses },
      { key: "winPct", sort: (r) => r.winPct },
      { key: "avgDiff", sort: (r) => r.avgDiff },
      { key: "totalDiff", sort: (r) => r.totalDiff },
    ];

    function renderRow(r) {
      const tr = document.createElement("tr");
      tr.className = "clickable";
      tr.innerHTML = `
        <td class="name-cell">${r.name}</td>
        <td>${r.games}</td>
        <td>${r.wins}</td>
        <td>${r.losses}</td>
        <td class="${r.winPct >= 0.5 ? "win-good" : ""}">${fmtPct(r.winPct)}</td>
        <td class="${r.avgDiff >= 0 ? "diff-pos" : "diff-neg"}">${fmtSigned(r.avgDiff)}</td>
        <td class="${r.totalDiff >= 0 ? "diff-pos" : "diff-neg"}">${fmtSignedInt(r.totalDiff)}</td>`;
      tr.addEventListener("click", () => {
        window.location.href = "profile.html?player=" + encodeURIComponent(r.name);
      });
      return tr;
    }

    const apply = wireSortableTable(table, getRows, columns, renderRow);

    function refresh() {
      const n = apply();
      countPill.textContent = `${n} player${n === 1 ? "" : "s"}`;
      const minGames = parseInt(minGamesSel.value, 10);
      const top = [...playerStats.values()]
        .filter((p) => p.games >= minGames)
        .map((p) => ({ label: p.name, value: p.games ? p.wins / p.games : 0, sub: `${p.wins}-${p.losses}` }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);
      drawHorizontalBarChart(chartSvg, top, { valueFmt: fmtPct });
    }

    searchInput.addEventListener("input", refresh);
    minGamesSel.addEventListener("change", refresh);
    window.addEventListener("resize", debounce(refresh, 150));
    refresh();
  }

  // ---------- Teammates ----------
  function renderTeammates(partnerStats) {
    const table = document.getElementById("teammates-table");
    const searchInput = document.getElementById("tm-search");
    const minGamesSel = document.getElementById("tm-mingames");
    const countPill = document.getElementById("tm-count");

    function toRow(ps) {
      return {
        pair: ps.players.join(" & "), players: ps.players, games: ps.games, wins: ps.wins, losses: ps.losses,
        winPct: ps.games ? ps.wins / ps.games : 0,
        avgDiff: ps.games ? ps.diffSum / ps.games : 0,
      };
    }

    function getRows() {
      const minGames = parseInt(minGamesSel.value, 10);
      const q = searchInput.value.trim().toLowerCase();
      return [...partnerStats.values()]
        .filter((ps) => ps.games >= minGames && (q === "" || ps.players.some((n) => n.toLowerCase().includes(q))))
        .map(toRow);
    }

    const columns = [
      { key: "pair", sort: (r) => r.pair.toLowerCase() },
      { key: "games", sort: (r) => r.games },
      { key: "wins", sort: (r) => r.wins },
      { key: "losses", sort: (r) => r.losses },
      { key: "winPct", sort: (r) => r.winPct },
      { key: "avgDiff", sort: (r) => r.avgDiff },
    ];

    function renderRow(r) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="name-cell">${r.pair}</td>
        <td>${r.games}</td>
        <td>${r.wins}</td>
        <td>${r.losses}</td>
        <td class="${r.winPct >= 0.5 ? "win-good" : ""}">${fmtPct(r.winPct)}</td>
        <td class="${r.avgDiff >= 0 ? "diff-pos" : "diff-neg"}">${fmtSigned(r.avgDiff)}</td>`;
      return tr;
    }

    const apply = wireSortableTable(table, getRows, columns, renderRow);
    function refresh() {
      const n = apply();
      countPill.textContent = `${n} pair${n === 1 ? "" : "s"}`;
    }
    searchInput.addEventListener("input", refresh);
    minGamesSel.addEventListener("change", refresh);
    refresh();
  }

  // second line under a recent game: date · location (· tournament round)
  function recentSub(g) {
    const bits = [fmtDate(g.date)];
    if (g.location) bits.push(g.location);
    if (g.tournament) bits.push(g.round != null ? fmtRound(g.round) : g.tournament);
    return `<span class="mi-sub">${bits.join(" · ")}</span>`;
  }

  // ---------- Player profile ----------
  function renderProfile(playerStats, partnerStats, opponentStats, games) {
    const select = document.getElementById("profile-select");
    const content = document.getElementById("profile-content");

    const names = [...playerStats.values()].sort((a, b) => b.games - a.games).map((p) => p.name);
    select.innerHTML = names.map((n) => `<option value="${n}">${n}</option>`).join("");

    let rollWindow = DEFAULT_ROLLING_WINDOW;

    // record-by-location table; sort state lives here so it survives re-renders
    let locSortKey = "games", locSortDir = -1;
    function renderLocationTable(table, rows) {
      function draw() {
        const sorted = [...rows].sort((a, b) => {
          const av = locSortKey === "loc" ? a.loc.toLowerCase() : a[locSortKey];
          const bv = locSortKey === "loc" ? b.loc.toLowerCase() : b[locSortKey];
          if (av < bv) return -locSortDir;
          if (av > bv) return locSortDir;
          return b.games - a.games;
        });
        table.querySelector("tbody").innerHTML = sorted.map((r) => `
          <tr class="${r.games < MIN_GAMES_FOR_LOCATION ? "row-dim" : ""}">
            <td class="name-cell">${r.loc}</td>
            <td>${r.games}</td>
            <td>${r.wins}</td>
            <td>${r.losses}</td>
            <td class="${r.winPct >= 0.5 ? "win-good" : ""}">${fmtPct(r.winPct)}</td>
            <td class="${r.avgDiff >= 0 ? "diff-pos" : "diff-neg"}">${fmtSigned(r.avgDiff)}</td>
            <td class="${r.diffSum >= 0 ? "diff-pos" : "diff-neg"}">${fmtSignedInt(r.diffSum)}</td>
          </tr>`).join("");
        table.querySelectorAll("th[data-key]").forEach((th) => {
          th.classList.remove("sorted", "sorted-asc");
          if (th.dataset.key === locSortKey) th.classList.add(locSortDir === 1 ? "sorted-asc" : "sorted");
        });
      }
      table.querySelectorAll("th[data-key]").forEach((th) => {
        th.addEventListener("click", () => {
          if (locSortKey === th.dataset.key) locSortDir *= -1;
          else { locSortKey = th.dataset.key; locSortDir = th.dataset.key === "loc" ? 1 : -1; }
          draw();
        });
      });
      draw();
    }

    function render(name) {
      const p = playerStats.get(name);
      if (!p) { content.innerHTML = `<p class="empty-state">No data for this player.</p>`; return; }

      const enoughForProgress = p.games >= MIN_GAMES_FOR_PROGRESS;
      const winPct = p.games ? p.wins / p.games : 0;
      const avgDiff = p.games ? p.diffSum / p.games : 0;

      // best teammates
      const teammates = [...partnerStats.values()]
        .filter((ps) => ps.players.includes(name) && ps.games >= 2)
        .map((ps) => ({ partner: ps.players.find((n) => n !== name), games: ps.games, wins: ps.wins, losses: ps.losses, winPct: ps.wins / ps.games }))
        .sort((a, b) => b.winPct - a.winPct || b.games - a.games)
        .slice(0, 6);

      // toughest opponents
      const oppMap = opponentStats.get(name) || new Map();
      const opponents = [...oppMap.entries()]
        .filter(([, s]) => s.games >= 2)
        .map(([opp, s]) => ({ opp, games: s.games, wins: s.wins, winPct: s.wins / s.games }))
        .sort((a, b) => a.winPct - b.winPct || b.games - a.games)
        .slice(0, 6);

      const allPlayerGames = games.filter((g) => g.pair1.includes(name) || g.pair2.includes(name));

      // historical record by location (every location with at least one game)
      const locMap = new Map();
      let noLocation = 0;
      for (const g of allPlayerGames) {
        if (!g.location) { noLocation++; continue; }
        const onPair1 = g.pair1.includes(name);
        const diff = onPair1 ? g.score1 - g.score2 : g.score2 - g.score1;
        const s = locMap.get(g.location) || { loc: g.location, games: 0, wins: 0, diffSum: 0 };
        s.games++; s.wins += diff > 0 ? 1 : 0; s.diffSum += diff;
        locMap.set(g.location, s);
      }
      const locations = [...locMap.values()].map((s) => ({
        ...s, losses: s.games - s.wins, winPct: s.wins / s.games, avgDiff: s.diffSum / s.games,
      }));

      // tournament games
      const tourneyGames = allPlayerGames.filter((g) => g.tournament);

      // recent games
      const playerGames = [...allPlayerGames]
        .sort((a, b) => b.dateObj - a.dateObj)
        .slice(0, 8)
        .map((g) => {
          const onPair1 = g.pair1.includes(name);
          const partner = (onPair1 ? g.pair1 : g.pair2).find((n) => n !== name);
          const opp = onPair1 ? g.pair2 : g.pair1;
          const my = onPair1 ? g.score1 : g.score2;
          const their = onPair1 ? g.score2 : g.score1;
          return { date: g.dateObj, partner, opp, my, their, win: my > their, location: g.location, tournament: g.tournament, round: g.round };
        });

      // cumulative diff chart
      let cum = 0;
      const points = p.history.map((h) => { cum += h.diff; return { date: h.date, y: cum, gameDiff: h.diff }; });

      content.innerHTML = `
        <div class="tiles">
          <div class="tile"><div class="tile-label">Record</div><div class="tile-value">${p.wins}-${p.losses}</div><div class="tile-sub">${p.games} games</div></div>
          <div class="tile"><div class="tile-label">Win %</div><div class="tile-value">${fmtPct(winPct)}</div></div>
          <div class="tile"><div class="tile-label">Avg point diff</div><div class="tile-value">${fmtSigned(avgDiff)}</div></div>
          <div class="tile"><div class="tile-label">Total point diff</div><div class="tile-value">${fmtSignedInt(p.diffSum)}</div></div>
        </div>
        ${enoughForProgress ? `
        <div class="card" style="margin-bottom:16px">
          <div class="card-head">
            <h3 style="margin:0;font-size:0.85rem;color:var(--text-secondary)">Rolling win % <span class="muted" style="font-weight:400">(last ${rollWindow} games · shaded = 95% range)</span></h3>
            <div class="seg" role="group" aria-label="Rolling window size">
              ${ROLLING_WINDOWS.map((w) => `<button type="button" class="seg-btn${w === rollWindow ? " active" : ""}" data-win="${w}">${w}</button>`).join("")}
            </div>
          </div>
          <div class="chart-wrap"><svg id="profile-rolling-chart" class="chart"></svg></div>
        </div>
        <div class="card" style="margin-bottom:16px">
          <h3 style="margin:0 0 10px;font-size:0.85rem;color:var(--text-secondary)">Season by season <span class="muted" style="font-weight:400">(faded = under ${MIN_GAMES_FOR_SEASON} games)</span></h3>
          <div class="chart-wrap"><svg id="profile-season-chart" class="chart"></svg></div>
        </div>` : `
        <div class="card" style="margin-bottom:16px">
          <h3 style="margin:0 0 6px;font-size:0.85rem;color:var(--text-secondary)">Progress over time</h3>
          <p class="empty-state">Trend charts unlock at ${MIN_GAMES_FOR_PROGRESS} games (${p.games} so far) — fewer than that is mostly noise.</p>
        </div>`}
        <div class="card" style="margin-bottom:16px">
          <h3 style="margin:0 0 10px;font-size:0.85rem;color:var(--text-secondary)">Cumulative point differential over time</h3>
          <div class="chart-wrap"><svg id="profile-line-chart" class="chart"></svg></div>
        </div>
        <div class="card" style="margin-bottom:16px">
          <h3 style="margin:0 0 10px;font-size:0.85rem;color:var(--text-secondary)">Record by location <span class="muted" style="font-weight:400">(click a column to sort${noLocation ? ` · ${noLocation} game${noLocation === 1 ? "" : "s"} with no location not included` : ""}${locations.some((s) => s.games < MIN_GAMES_FOR_LOCATION) ? ` · faded = under ${MIN_GAMES_FOR_LOCATION} games` : ""})</span></h3>
          ${locations.length ? `
          <div class="table-scroll">
            <table id="profile-location-table">
              <thead>
                <tr>
                  <th class="name-cell" data-key="loc">Location</th>
                  <th data-key="games">Games</th>
                  <th data-key="wins">W</th>
                  <th data-key="losses">L</th>
                  <th data-key="winPct">Win %</th>
                  <th data-key="avgDiff">Avg Pt Diff</th>
                  <th data-key="diffSum">Total Pt Diff</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>` : `<p class="empty-state">No games with a recorded location yet.</p>`}
        </div>
        <div class="profile-grid">
          <div class="card">
            <h3>Best teammates <span class="muted" style="font-weight:400">(min. 2 games)</span></h3>
            ${teammates.length ? `<ul class="mini-list">${teammates.map((t) => `<li><span class="mi-name">${t.partner}</span><span class="mi-meta">${t.wins}-${t.losses} · ${fmtPct(t.winPct)}</span></li>`).join("")}</ul>` : `<p class="empty-state">Not enough shared games yet.</p>`}
          </div>
          <div class="card">
            <h3>Toughest opponents <span class="muted" style="font-weight:400">(min. 2 games)</span></h3>
            ${opponents.length ? `<ul class="mini-list">${opponents.map((o) => `<li><span class="mi-name">${o.opp}</span><span class="mi-meta">${o.wins}-${o.games - o.wins} · ${fmtPct(o.winPct)}</span></li>`).join("")}</ul>` : `<p class="empty-state">Not enough shared games yet.</p>`}
          </div>
          <div class="card">
            <h3>Recent games</h3>
            ${playerGames.length ? `<ul class="mini-list">${playerGames.map((g) => `<li><span class="mi-name">${g.win ? "W" : "L"} vs ${g.opp.join(" & ")}${recentSub(g)}</span><span class="mi-meta ${g.win ? "win-good" : ""}">${g.my}-${g.their}</span></li>`).join("")}</ul>` : ""}
          </div>
          ${tourneyGames.length ? `
          <div class="card">
            <h3>Tournament games</h3>
            <ul class="mini-list">${tourneyGames.map((g) => {
              const onPair1 = g.pair1.includes(name);
              const my = onPair1 ? g.score1 : g.score2, their = onPair1 ? g.score2 : g.score1;
              const opp = onPair1 ? g.pair2 : g.pair1;
              return `<li><span class="mi-name">${my > their ? "W" : "L"} vs ${opp.join(" & ")}<span class="mi-sub">${g.tournament}${g.round != null ? " · " + fmtRound(g.round) : ""}</span></span><span class="mi-meta ${my > their ? "win-good" : ""}">${my}-${their}</span></li>`;
            }).join("")}</ul>
          </div>` : ""}
        </div>
      `;

      drawLineChart(document.getElementById("profile-line-chart"), points);
      if (locations.length) renderLocationTable(document.getElementById("profile-location-table"), locations);

      if (enoughForProgress) {
        drawRollingChart(document.getElementById("profile-rolling-chart"), p.history, rollWindow);
        drawSeasonProgress(document.getElementById("profile-season-chart"), p.history);
        content.querySelectorAll(".seg-btn").forEach((btn) =>
          btn.addEventListener("click", () => { rollWindow = parseInt(btn.dataset.win, 10); render(name); }));
      }
    }

    select.addEventListener("change", () => {
      render(select.value);
      const url = new URL(window.location);
      url.searchParams.set("player", select.value);
      history.replaceState(null, "", url);
    });
    window.addEventListener("resize", debounce(() => render(select.value), 150));
    // deep link: profile.html?player=Name (used by leaderboard row clicks)
    const wanted = new URLSearchParams(window.location.search).get("player");
    const initial = names.includes(wanted) ? wanted : names[0];
    if (initial) { select.value = initial; render(initial); }
  }

  // ---------- Game log ----------
  function renderGameLog(games) {
    const table = document.getElementById("games-table");
    const searchInput = document.getElementById("gl-search");
    const seasonSel = document.getElementById("gl-season");
    const eventSel = document.getElementById("gl-event");
    const locationSel = document.getElementById("gl-location");
    const countPill = document.getElementById("gl-count");
    const moreBtn = document.getElementById("gl-more");
    let pageSize = 25, shown = 25;

    const seasons = [...new Set(games.map((g) => g.season))].sort((a, b) => seasonSortKey(a) - seasonSortKey(b));
    seasonSel.innerHTML += seasons.map((s) => `<option value="${s}">${s}</option>`).join("");

    // tournaments, in date order
    const tournaments = [...new Set(games.filter((g) => g.tournament).map((g) => g.tournament))];
    eventSel.innerHTML += tournaments.map((t) => `<option value="${t}">${t}</option>`).join("");

    // locations, most-played first
    const locCounts = locationCounts(games);
    locationSel.innerHTML += locCounts.map(([loc, n]) => `<option value="${loc}">${loc} (${n})</option>`).join("")
      + (games.some((g) => !g.location) ? `<option value="__unknown">Unknown</option>` : "");

    function toRow(g) {
      const winner = g.score1 > g.score2 ? g.pair1 : g.pair2;
      return { ...g, winnerLabel: winner.join(" & ") };
    }

    function matchesEvent(g, ev) {
      if (!ev) return true;
      if (ev === "__regular") return !g.tournament;
      if (ev === "__tournament") return !!g.tournament;
      return g.tournament === ev;
    }

    function matchesLocation(g, loc) {
      if (!loc) return true;
      if (loc === "__unknown") return !g.location;
      return g.location === loc;
    }

    function getRows() {
      const q = searchInput.value.trim().toLowerCase();
      const season = seasonSel.value, ev = eventSel.value, loc = locationSel.value;
      return games
        .filter((g) => (!season || g.season === season))
        .filter((g) => matchesEvent(g, ev))
        .filter((g) => matchesLocation(g, loc))
        .filter((g) => q === "" || [...g.pair1, ...g.pair2, g.location || ""].some((n) => n.toLowerCase().includes(q)))
        .map(toRow);
    }

    const columns = [
      { key: "date", sort: (r) => r.dateObj },
      { key: "season", sort: (r) => seasonSortKey(r.season) },
      // unknown locations sort after every named one when descending
      { key: "location", sort: (r) => (r.location || "").toLowerCase() },
      { key: "score1", sort: (r) => r.score1 },
      { key: "score2", sort: (r) => r.score2 },
    ];

    function renderRow(r) {
      const tr = document.createElement("tr");
      const eventCell = r.tournament
        ? `<span class="pill pill-tourney" title="${r.tournament}">${r.tournament}</span>${r.round != null ? `<div class="round-label">${fmtRound(r.round)}</div>` : ""}`
        : `<span class="pill">${r.season}</span>`;
      tr.innerHTML = `
        <td>${fmtDate(r.dateObj)}</td>
        <td>${eventCell}</td>
        <td>${r.location ? r.location : `<span class="muted">—</span>`}</td>
        <td class="name-cell">${r.pair1.join(" & ")}</td>
        <td class="${r.score1 > r.score2 ? "win-good" : ""}">${r.score1}</td>
        <td class="name-cell">${r.pair2.join(" & ")}</td>
        <td class="${r.score2 > r.score1 ? "win-good" : ""}">${r.score2}</td>
        <td class="name-cell">${r.winnerLabel}</td>`;
      return tr;
    }

    // custom sort override (date desc default, but allow header clicks)
    let sortKey = "date", sortDir = -1;
    table.querySelectorAll("thead th[data-key]").forEach((th) => {
      th.addEventListener("click", () => {
        if (sortKey === th.dataset.key) sortDir *= -1;
        else { sortKey = th.dataset.key; sortDir = -1; }
        table.querySelectorAll("th").forEach((t) => t.classList.remove("sorted", "sorted-asc"));
        th.classList.add(sortDir === 1 ? "sorted-asc" : "sorted");
        refresh();
      });
    });

    function refresh() {
      const rows = getRows();
      const col = columns.find((c) => c.key === sortKey);
      rows.sort((a, b) => {
        const av = col.sort(a), bv = col.sort(b);
        if (av < bv) return -1 * sortDir;
        if (av > bv) return 1 * sortDir;
        return 0;
      });
      const tbody = table.querySelector("tbody");
      tbody.innerHTML = "";
      const slice = rows.slice(0, shown);
      if (slice.length === 0) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 8; td.className = "empty-state"; td.textContent = "No matching games.";
        tr.appendChild(td); tbody.appendChild(tr);
      } else {
        slice.forEach((r) => tbody.appendChild(renderRow(r)));
      }
      countPill.textContent = `${rows.length} game${rows.length === 1 ? "" : "s"}`;
      moreBtn.style.display = rows.length > shown ? "" : "none";
    }

    searchInput.addEventListener("input", () => { shown = pageSize; refresh(); });
    for (const sel of [seasonSel, eventSel, locationSel]) {
      sel.addEventListener("change", () => { shown = pageSize; refresh(); });
    }
    moreBtn.addEventListener("click", () => { shown += pageSize; refresh(); });

    refresh();
  }
})();
