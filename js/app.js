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
    const order = { "Fall": 0, "J-Term": 1, "Spring": 2 };
    return parseInt(year, 10) * 10 + order[name];
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
      document.querySelector(".wrap").insertAdjacentHTML(
        "afterbegin",
        `<p class="empty-state">Couldn't load game data (${err.message}). If you're viewing this from a local file, serve it over http:// instead (e.g. <code>python -m http.server</code>).</p>`
      );
    });

  function init(games) {
    const { playerStats, partnerStats, opponentStats, seasonCounts } = computeStats(games);

    renderOverview(games, playerStats, seasonCounts);
    renderLeaderboard(playerStats);
    renderTeammates(partnerStats);
    renderProfile(playerStats, partnerStats, opponentStats, games);
    renderGameLog(games);
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
        p.history.push({ date: g.dateObj, diff: diff1, win: win1 });
      }
      for (const name of g.pair2) {
        const p = ensurePlayer(name);
        p.games++; p.wins += win1 ? 0 : 1; p.losses += win1 ? 1 : 0;
        p.pointsFor += g.score2; p.pointsAgainst += g.score1; p.diffSum += -diff1;
        p.history.push({ date: g.dateObj, diff: -diff1, win: !win1 });
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
    const marginL = 34, marginR = 12, marginT = 16, marginB = 34;
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
    const marginL = 90, marginR = 46, marginT = 8, marginB = 8;
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
    const marginL = 36, marginR = 14, marginT = 16, marginB = 24;
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
        document.getElementById("profile-select").value = r.name;
        document.getElementById("profile-select").dispatchEvent(new Event("change"));
        document.getElementById("profile").scrollIntoView({ behavior: "smooth", block: "start" });
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

  // ---------- Player profile ----------
  function renderProfile(playerStats, partnerStats, opponentStats, games) {
    const select = document.getElementById("profile-select");
    const content = document.getElementById("profile-content");

    const names = [...playerStats.values()].sort((a, b) => b.games - a.games).map((p) => p.name);
    select.innerHTML = names.map((n) => `<option value="${n}">${n}</option>`).join("");

    function render(name) {
      const p = playerStats.get(name);
      if (!p) { content.innerHTML = `<p class="empty-state">No data for this player.</p>`; return; }

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

      // recent games
      const playerGames = games.filter((g) => g.pair1.includes(name) || g.pair2.includes(name))
        .sort((a, b) => b.dateObj - a.dateObj)
        .slice(0, 8)
        .map((g) => {
          const onPair1 = g.pair1.includes(name);
          const partner = (onPair1 ? g.pair1 : g.pair2).find((n) => n !== name);
          const opp = onPair1 ? g.pair2 : g.pair1;
          const my = onPair1 ? g.score1 : g.score2;
          const their = onPair1 ? g.score2 : g.score1;
          return { date: g.dateObj, partner, opp, my, their, win: my > their };
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
        <div class="card" style="margin-bottom:16px">
          <h3 style="margin:0 0 10px;font-size:0.85rem;color:var(--text-secondary)">Cumulative point differential over time</h3>
          <div class="chart-wrap"><svg id="profile-line-chart" class="chart"></svg></div>
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
            ${playerGames.length ? `<ul class="mini-list">${playerGames.map((g) => `<li><span class="mi-name">${g.win ? "W" : "L"} vs ${g.opp.join(" & ")}</span><span class="mi-meta ${g.win ? "win-good" : ""}">${g.my}-${g.their}</span></li>`).join("")}</ul>` : ""}
          </div>
        </div>
      `;

      drawLineChart(document.getElementById("profile-line-chart"), points);
    }

    select.addEventListener("change", () => render(select.value));
    window.addEventListener("resize", debounce(() => render(select.value), 150));
    if (names.length) render(names[0]);
  }

  // ---------- Game log ----------
  function renderGameLog(games) {
    const table = document.getElementById("games-table");
    const searchInput = document.getElementById("gl-search");
    const seasonSel = document.getElementById("gl-season");
    const countPill = document.getElementById("gl-count");
    const moreBtn = document.getElementById("gl-more");
    let pageSize = 25, shown = 25;

    const seasons = [...new Set(games.map((g) => g.season))].sort((a, b) => seasonSortKey(a) - seasonSortKey(b));
    seasonSel.innerHTML += seasons.map((s) => `<option value="${s}">${s}</option>`).join("");

    function toRow(g) {
      const winner = g.score1 > g.score2 ? g.pair1 : g.pair2;
      return { ...g, winnerLabel: winner.join(" & ") };
    }

    function getRows() {
      const q = searchInput.value.trim().toLowerCase();
      const season = seasonSel.value;
      return games
        .filter((g) => (!season || g.season === season))
        .filter((g) => q === "" || [...g.pair1, ...g.pair2].some((n) => n.toLowerCase().includes(q)))
        .map(toRow);
    }

    const columns = [
      { key: "date", sort: (r) => r.dateObj },
      { key: "season", sort: (r) => seasonSortKey(r.season) },
      { key: "score1", sort: (r) => r.score1 },
      { key: "score2", sort: (r) => r.score2 },
    ];

    function renderRow(r) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${fmtDate(r.dateObj)}</td>
        <td><span class="pill">${r.season}</span></td>
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
        td.colSpan = 7; td.className = "empty-state"; td.textContent = "No matching games.";
        tr.appendChild(td); tbody.appendChild(tr);
      } else {
        slice.forEach((r) => tbody.appendChild(renderRow(r)));
      }
      countPill.textContent = `${rows.length} game${rows.length === 1 ? "" : "s"}`;
      moreBtn.style.display = rows.length > shown ? "" : "none";
    }

    searchInput.addEventListener("input", () => { shown = pageSize; refresh(); });
    seasonSel.addEventListener("change", () => { shown = pageSize; refresh(); });
    moreBtn.addEventListener("click", () => { shown += pageSize; refresh(); });

    refresh();
  }
})();
