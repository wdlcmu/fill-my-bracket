"use strict";
/* Fill My Bracket — tournament history explorer (2026-11-05).
   Data: window.FMB_HISTORY from /history-data.js — every game 1985-2026
   (2,583 games) from the site's verified dataset. Game row:
   [round_of, winner, winnerSeed, winnerScore, loser, loserSeed, loserScore].
   Everything rendered here is derived from those rows: champions, Final
   Fours, team stories, records. Nothing is hand-typed, nothing invented. */
(function () {
  var DATA = window.FMB_HISTORY || {};
  var YEARS = Object.keys(DATA).map(Number).sort(function (a, b) { return b - a; });
  var ROUND_NAMES = { 64: "First round", 32: "Second round", 16: "Sweet 16", 8: "Elite Eight", 4: "Final Four", 2: "Championship" };
  var ROUND_ORDER = [64, 32, 16, 8, 4, 2];
  var DEPTH = { 64: "First round", 32: "Second round", 16: "Sweet 16", 8: "Elite Eight", 4: "Final Four", 2: "Championship game" };
  var DEPTH_RANK = { 64: 1, 32: 2, 16: 3, 8: 4, 4: 5, 2: 6 };

  var strip = document.getElementById("yrStrip");
  var banner = document.getElementById("champBanner");
  var jumps = document.getElementById("roundJumps");
  var view = document.getElementById("yearView");
  var panel = document.getElementById("teamPanel");
  var toggle = document.getElementById("pathToggle");

  var curYear = YEARS[0];
  var curTeam = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function championOf(year) {
    var final = DATA[year].filter(function (g) { return g[0] === 2; })[0];
    return final ? { name: final[1], seed: final[2], score: final[3], runnerUp: final[4], ruSeed: final[5], ruScore: final[6] } : null;
  }
  function finalFourOf(year) {
    var teams = [];
    DATA[year].filter(function (g) { return g[0] === 4; }).forEach(function (g) {
      teams.push({ name: g[1], seed: g[2] }, { name: g[4], seed: g[5] });
    });
    return teams;
  }

  /* ---- team story, computed from the game rows ---- */
  function teamStory(name) {
    var years = {}, titles = [], ffs = [], wins = 0, losses = 0, best = null;
    YEARS.forEach(function (y) {
      DATA[y].forEach(function (g) {
        var mine = null, won = false;
        if (g[1] === name) { mine = g; won = true; }
        else if (g[4] === name) { mine = g; won = false; }
        if (!mine) return;
        years[y] = true;
        if (won) wins++; else losses++;
        if (g[0] === 4) ffs.push(y);
        if (g[0] === 2 && won) titles.push(y);
        var label = g[0] === 2 ? (won ? "Champion" : "Runner-up") : DEPTH[g[0]] === "Final Four" ? "Final Four" : DEPTH[g[0]];
        var rank = DEPTH_RANK[g[0]] + (g[0] === 2 && won ? 1 : 0);
        if (!best || rank > best.rank || (rank === best.rank && y > best.year)) {
          best = { rank: rank, label: label, year: y };
        }
      });
    });
    return {
      years: Object.keys(years).map(Number).sort(function (a, b) { return b - a; }),
      titles: titles.sort(function (a, b) { return b - a; }),
      ffs: ffs.sort(function (a, b) { return b - a; }),
      wins: wins, losses: losses, best: best
    };
  }
  function teamGamesInYear(name, year) {
    return DATA[year].filter(function (g) { return g[1] === name || g[4] === name; });
  }

  /* ---- year strip ---- */
  YEARS.forEach(function (y) {
    var b = el("button", "yr-chip" + (y === curYear ? " on" : ""), String(y));
    b.type = "button";
    b.setAttribute("data-year", y);
    b.setAttribute("aria-pressed", y === curYear ? "true" : "false");
    b.addEventListener("click", function () { selectYear(y, true); });
    strip.appendChild(b);
  });

  function selectYear(y, scrollChip) {
    curYear = y;
    strip.querySelectorAll(".yr-chip").forEach(function (c) {
      var on = Number(c.getAttribute("data-year")) === y;
      c.classList.toggle("on", on);
      c.setAttribute("aria-pressed", on ? "true" : "false");
      if (on && scrollChip) c.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    });
    try { history.replaceState(null, "", "#" + y); } catch (e) {}
    renderYear();
    if (curTeam) renderTeamPanel(curTeam, false);
  }

  function teamButton(name, seed, score, won, isChamp) {
    var b = el("button", "trow " + (won ? "win" : "lose"));
    b.type = "button";
    b.appendChild(el("span", "seed", String(seed)));
    var nm = el("span", "tname", name);
    if (isChamp) { nm.appendChild(document.createTextNode(" ")); var st = el("span", "star", "★"); st.title = "Champion"; nm.appendChild(st); }
    b.appendChild(nm);
    b.appendChild(el("span", "tscore", String(score)));
    b.addEventListener("click", function () { openTeam(name); });
    return b;
  }

  function renderYear() {
    var champ = championOf(curYear);
    banner.innerHTML = "";
    banner.appendChild(el("p", "c-label", curYear + " champion"));
    var line = el("p", "c-line");
    var cb = el("button", null, champ.name);
    cb.type = "button";
    cb.addEventListener("click", function () { openTeam(champ.name); });
    line.appendChild(cb);
    line.appendChild(document.createTextNode(" beat "));
    var rb = el("button", null, champ.runnerUp);
    rb.type = "button";
    rb.addEventListener("click", function () { openTeam(champ.runnerUp); });
    line.appendChild(rb);
    line.appendChild(document.createTextNode(", " + champ.score + "–" + champ.ruScore + "."));
    banner.appendChild(line);
    var ff = el("p", "ff-row");
    ff.appendChild(el("b", null, "Final Four: "));
    finalFourOf(curYear).forEach(function (t, i) {
      if (i) ff.appendChild(document.createTextNode(" · "));
      var tb = el("button", null, t.name + " (" + t.seed + ")");
      tb.type = "button";
      tb.addEventListener("click", function () { openTeam(t.name); });
      ff.appendChild(tb);
    });
    banner.appendChild(ff);

    jumps.innerHTML = "";
    ROUND_ORDER.forEach(function (r) {
      var j = el("button", "jump", ROUND_NAMES[r]);
      j.type = "button";
      j.addEventListener("click", function () {
        var s = document.getElementById("round-" + r);
        if (s) s.scrollIntoView({ block: "start", behavior: "smooth" });
      });
      jumps.appendChild(j);
    });

    view.innerHTML = "";
    ROUND_ORDER.forEach(function (r) {
      var games = DATA[curYear].filter(function (g) { return g[0] === r; });
      if (!games.length) return;
      var sec = el("section", "round");
      sec.id = "round-" + r;
      var h = el("h2", null, ROUND_NAMES[r]);
      h.appendChild(el("span", "r-count", games.length + (games.length === 1 ? " game" : " games")));
      sec.appendChild(h);
      games.forEach(function (g) {
        var upset = g[2] > g[5];
        var box = el("div", "game" + (upset ? " has-upset" : "") +
          ((g[1] === champ.name || g[4] === champ.name) ? " champgame" : ""));
        var forfeit = g[3] === 1 && g[6] === 0;
        box.appendChild(teamButton(g[1], g[2], forfeit ? "—" : g[3], true, g[1] === champ.name));
        box.appendChild(teamButton(g[4], g[5], forfeit ? "—" : g[6], false, g[4] === champ.name));
        if (forfeit) box.appendChild(el("span", "upset-tag", "No contest"));
        else if (upset) box.appendChild(el("span", "upset-tag", "Upset"));
        sec.appendChild(box);
      });
      view.appendChild(sec);
    });
  }

  /* ---- team panel ---- */
  function openTeam(name) {
    curTeam = name;
    renderTeamPanel(name, true);
  }
  function renderTeamPanel(name, scroll) {
    var s = teamStory(name);
    panel.innerHTML = "";
    panel.hidden = false;
    var head = el("div", "tp-head");
    head.appendChild(el("h2", null, name));
    var close = el("button", "tp-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close team panel");
    close.addEventListener("click", function () { panel.hidden = true; curTeam = null; });
    head.appendChild(close);
    panel.appendChild(head);

    var stats = el("div", "tp-stats");
    function stat(label, val) {
      var d = el("span", "tp-stat");
      d.appendChild(el("b", null, String(val)));
      d.appendChild(document.createTextNode(" " + label));
      return d;
    }
    stats.appendChild(stat(s.years.length === 1 ? "tournament" : "tournaments", s.years.length));
    stats.appendChild(stat(s.titles.length === 1 ? "title" : "titles", s.titles.length));
    stats.appendChild(stat(s.ffs.length === 1 ? "Final Four" : "Final Fours", s.ffs.length));
    stats.appendChild(stat("wins", s.wins));
    stats.appendChild(stat("losses", s.losses));
    panel.appendChild(stats);

    var body = el("div", "tp-body");
    if (s.titles.length) body.appendChild(el("p", null, "Champion in " + s.titles.join(", ") + "."));
    if (s.ffs.length) body.appendChild(el("p", null, "Final Four years: " + s.ffs.join(", ") + "."));
    if (s.best) body.appendChild(el("p", null, "Deepest run: " + s.best.label + ", " + s.best.year + "."));
    body.appendChild(el("p", null, "All numbers counted from tournament games, 1985 to 2026."));

    var games = teamGamesInYear(name, curYear);
    body.appendChild(el("p", null, games.length ? ("In " + curYear + ":") : (name + " did not make the field in " + curYear + ".")));
    if (games.length) {
      var ul = el("ul", "tp-games");
      games.slice().sort(function (a, b) { return b[0] - a[0]; }).forEach(function (g) {
        var won = g[1] === name;
        var opp = won ? g[4] : g[1];
        var txt = (g[3] === 1 && g[6] === 0)
          ? ROUND_NAMES[g[0]] + ": " + (won ? "advanced past " : "was ruled out against ") + opp + " — the game was a COVID no-contest."
          : ROUND_NAMES[g[0]] + ": " + (won ? "beat " : "lost to ") + opp + ", " +
            (won ? g[3] + "–" + g[6] : g[6] + "–" + g[3]) + ".";
        ul.appendChild(el("li", null, txt));
      });
      body.appendChild(ul);
    }
    var yrs = el("div", "tp-years");
    s.years.forEach(function (y) {
      var chip = el("button", "tp-year" + (y === curYear ? " on" : ""), String(y));
      chip.type = "button";
      chip.addEventListener("click", function () { selectYear(y, true); });
      yrs.appendChild(chip);
    });
    body.appendChild(el("p", null, "See " + name + " in another year:"));
    body.appendChild(yrs);
    panel.appendChild(body);
    if (scroll) panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  toggle.addEventListener("change", function () {
    document.body.classList.toggle("path-on", toggle.checked);
  });

  var start = parseInt((location.hash || "").replace("#", ""), 10);
  if (YEARS.indexOf(start) >= 0) curYear = start;
  strip.querySelectorAll(".yr-chip").forEach(function (c) {
    var on = Number(c.getAttribute("data-year")) === curYear;
    c.classList.toggle("on", on);
    c.setAttribute("aria-pressed", on ? "true" : "false");
    if (on) c.scrollIntoView({ block: "nearest", inline: "center" });
  });
  renderYear();
})();
