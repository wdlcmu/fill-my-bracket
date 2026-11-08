"use strict";
/* Fill My Bracket - Mock Bracket (Nov 8, 2026).
   Test runs on the projected 2027 field (season-data.js). Five answers
   fill all 75 picks: the engine (mock-engine.js) calls the 12
   opening-round games, then builds the 63-game bracket. Every pick
   stays tappable: opening-round flips rebuild the bracket and re-apply
   the visitor's hand edits that still fit; bracket flips go through
   the engine's own pick editing, which repairs later rounds and says
   what moved. Analytics keep the fleet taxonomy: tool_start on a
   run's first fill, tool_complete once per run when its poster opens
   (MEASURE-1 gate pattern, same as replay.js). Metadata only. */
(function () {
  var S = window.FMB_SEASON;
  if (!S || !S.field) return;
  var F = S.field;
  var RM = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function $(id) { return document.getElementById(id); }
  function track(name, props) {
    try { if (window.FA && FA.track) FA.track(name, props); } catch (e) {}
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function hashN(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h);
  }
  function detScore(id, salt) { return hashN(id + "|" + salt) % 11; }
  function familiarScore(seed, ap) {
    var f = 11 - Math.round((seed - 1) * 0.65);
    if (ap) f += 2;
    return Math.max(0, Math.min(11, f));
  }

  /* ---- field lookups ---- */
  var teamInfo = {};   // id -> {info, seed, region}
  var slots = [];      // {region, host, seed, playIn, teams}
  F.regions.forEach(function (r) {
    r.slots.forEach(function (sl) {
      slots.push({ region: r.name, host: r.host, seed: sl.seed, playIn: sl.playIn, teams: sl.teams });
      sl.teams.forEach(function (t) { teamInfo[t.id] = { info: t, seed: sl.seed, region: r.name }; });
    });
  });
  function slotKey(region, seed) { return region + "|" + seed; }

  /* ---- answers ---- */
  var answers = { chaos: "some", tiebreak: "mascot", championPick: null, littleGuys: false, ride: "" };
  document.querySelectorAll(".q").forEach(function (q) {
    var key = q.getAttribute("data-q");
    q.querySelectorAll(".pill").forEach(function (pill) {
      pill.addEventListener("click", function () {
        q.querySelectorAll(".pill").forEach(function (p) { p.classList.remove("on"); });
        pill.classList.add("on");
        var v = pill.getAttribute("data-v");
        if (key === "chaos") answers.chaos = v;
        else if (key === "tiebreak") answers.tiebreak = v;
        else if (key === "littleGuys") answers.littleGuys = v === "yes";
        else if (key === "ride") answers.ride = v;
      });
    });
  });
  var champSel = $("champSel");
  var noneOpt = document.createElement("option");
  noneOpt.value = ""; noneOpt.textContent = "No pick - surprise me";
  champSel.appendChild(noneOpt);
  F.regions.forEach(function (r) {
    var og = document.createElement("optgroup");
    og.label = r.name + " region";
    var sorted = r.slots.slice().sort(function (a, b) { return a.seed - b.seed; });
    sorted.forEach(function (sl) {
      sl.teams.forEach(function (t) {
        var o = document.createElement("option");
        o.value = t.id;
        o.textContent = sl.seed + " - " + t.name + (sl.playIn ? " (opening round)" : "");
        og.appendChild(o);
      });
    });
    champSel.appendChild(og);
  });
  champSel.addEventListener("change", function () {
    answers.championPick = champSel.value || null;
  });

  /* ---- engine plumbing ---- */
  function boostFor(team, seed) {
    if (answers.ride && team.conf === answers.ride) return "your " + answers.ride + " ride";
    if (answers.littleGuys && seed >= 10) return "little-guy boost";
    return null;
  }
  function engineTeam(t, seed) {
    var b = boostFor(t, seed);
    return {
      id: t.id, name: t.name, seed: seed, mascot: t.mascot, colors: t.colors,
      mascotScore: detScore(t.id, "m"), colorScore: detScore(t.id, "c"),
      familiarScore: familiarScore(seed, t.ap),
      isHome: !!b, boostLabel: b
    };
  }
  function engineAnswers() {
    return {
      loyalty: (answers.ride || answers.littleGuys) ? "home" : "none",
      chaos: answers.chaos, tiebreak: answers.tiebreak,
      championPick: answers.championPick, tournament: "men"
    };
  }
  var openingWinners = {};   // slotKey -> teamId
  var openingReasons = {};   // slotKey -> reason
  function decideOpening() {
    openingWinners = {}; openingReasons = {};
    var ea = engineAnswers();
    slots.forEach(function (sl) {
      if (!sl.playIn) return;
      var a = engineTeam(sl.teams[0], sl.seed);
      var b = engineTeam(sl.teams[1], sl.seed);
      var g = decideGame(a, b, ea, F.id + "|OPEN-" + sl.region + "-" + sl.seed, "Opening round");
      openingWinners[slotKey(sl.region, sl.seed)] = g.winner.id;
      openingReasons[slotKey(sl.region, sl.seed)] = g.reason;
    });
  }
  function resolvedField() {
    return {
      id: F.id, label: F.label, tournament: "men",
      regions: F.regions.map(function (r) {
        return {
          name: r.name,
          teams: r.slots.map(function (sl) {
            var t = sl.playIn
              ? sl.teams.filter(function (x) { return x.id === openingWinners[slotKey(r.name, sl.seed)]; })[0]
              : sl.teams[0];
            return engineTeam(t, sl.seed);
          })
        };
      })
    };
  }

  /* ---- state ---- */
  var bracket = null;
  var runStarted = false, runCompleted = false;
  var runCount = 0;
  try { runCount = parseInt(localStorage.getItem("fmb_mock_runs") || "0", 10) || 0; } catch (e) {}

  function announce(msg) { $("mkMsg").textContent = msg; }

  function fill(keepMsg) {
    decideOpening();
    bracket = buildBracket(resolvedField(), engineAnswers());
    if (!runStarted) { runStarted = true; track("tool_start", { surface: "mock" }); }
    $("bracketSec").hidden = false;
    $("posterSec").hidden = true;
    renderBracket();
    if (!keepMsg) announce("Your mock is filled: 75 picks. Tap any team to change a pick.");
    $("bracketSec").scrollIntoView({ block: "start", behavior: RM ? "auto" : "smooth" });
  }

  function flipBracketGame(gameIndex, teamId) {
    var g = bracket.games[gameIndex];
    if (!g || g.winner.id === teamId) return;
    var before = bracket.manualEdits ? bracket.manualEdits.length : 0;
    bracket = applyPickEdit(bracket, gameIndex, teamId);
    var moved = bracket.lastEdit ? bracket.lastEdit.repairedGames.length : 0;
    var kept = bracket.lastEdit ? bracket.lastEdit.keptGames.length : 0;
    renderBracket();
    if (moved > 0) announce("Saved. That change moved " + moved + " later pick" + (moved === 1 ? "" : "s") + " - the teams in those games changed.");
    else if (kept > 0 || (bracket.manualEdits || []).length !== before) announce("Saved. Your other picks still fit, so nothing else moved.");
    else announce("Saved.");
  }

  function flipOpening(region, seed, teamId) {
    var key = slotKey(region, seed);
    if (openingWinners[key] === teamId) return;
    openingWinners[key] = teamId;
    openingReasons[key] = "your edit";
    var edits = bracket && bracket.manualEdits ? bracket.manualEdits.slice() : [];
    bracket = buildBracket(resolvedField(), engineAnswers());
    var kept = 0, dropped = 0;
    edits.forEach(function (e) {
      try { bracket = applyPickEdit(bracket, e.gameIndex, e.winnerId); kept++; }
      catch (err) { dropped++; }
    });
    renderBracket();
    if (dropped > 0) announce("Saved. " + dropped + " of your hand picks no longer fit and were re-called by your answers.");
    else if (kept > 0) announce("Saved. All " + kept + " of your hand picks still fit.");
    else announce("Saved.");
  }

  /* ---- rendering ---- */
  function teamBtn(team, isWinner, tag, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "mk-team" + (isWinner ? " win" : "");
    var s = el("span", "mk-seed", String(team.seed));
    var n = el("span", "mk-name", team.name);
    b.appendChild(s); b.appendChild(n);
    if (tag) b.appendChild(el("span", "mk-tag", tag));
    b.addEventListener("click", onClick);
    return b;
  }
  function gameCard(g, gameIndex) {
    var card = el("div", "mk-game");
    var teams = el("div", "mk-teams");
    [g.a, g.b].forEach(function (t) {
      var isW = g.winner.id === t.id;
      teams.appendChild(teamBtn(t, isW, isW ? "Your pick" : "Take them", function () {
        flipBracketGame(gameIndex, t.id);
      }));
    });
    card.appendChild(teams);
    card.appendChild(el("p", "mk-reason", "Why: " + g.reason + "."));
    return card;
  }
  function renderBracket() {
    var champ = bracket.champion;
    var ci = teamInfo[champ.id];
    $("champName").textContent = champ.name;
    $("champSub").textContent = "The " + champ.seed + " seed out of the " + (ci ? ci.region : "") +
      " - on a projected field. " + (bracket.championPickApplied ? "Your pick to win it all." : "Called by your answers.");
    $("runNo").textContent = String(runCount + 1);

    var og = $("openGames");
    og.innerHTML = "";
    slots.forEach(function (sl) {
      if (!sl.playIn) return;
      var key = slotKey(sl.region, sl.seed);
      var card = el("div", "mk-game");
      var head = el("p", "mk-reason", sl.region + " - " + sl.seed + " seed spot");
      head.style.margin = "0 0.2rem 0.5rem";
      card.appendChild(head);
      var teams = el("div", "mk-teams");
      sl.teams.forEach(function (t) {
        var isW = openingWinners[key] === t.id;
        var et = engineTeam(t, sl.seed);
        teams.appendChild(teamBtn(et, isW, isW ? "Your pick" : "Take them", function () {
          flipOpening(sl.region, sl.seed, t.id);
        }));
      });
      card.appendChild(teams);
      card.appendChild(el("p", "mk-reason", "Why: " + (openingReasons[key] || "") + "."));
      og.appendChild(card);
    });

    var rb = $("regionBlocks");
    rb.innerHTML = "";
    var roundNames = ["Round of 64", "Round of 32", "Sweet 16", "Elite Eight"];
    F.regions.forEach(function (r, ri) {
      rb.appendChild(el("h3", "round-h", r.name + " region (" + r.host + ")"));
      roundNames.forEach(function (rn, k) {
        rb.appendChild(el("p", "mk-reason", rn));
        var start = ri * 15 + [0, 8, 12, 14][k];
        var count = [8, 4, 2, 1][k];
        for (var i = 0; i < count; i++) {
          rb.appendChild(gameCard(bracket.games[start + i], start + i));
        }
      });
    });

    var fb = $("finalBlock");
    fb.innerHTML = "";
    fb.appendChild(el("p", "mk-reason", "Final Four"));
    fb.appendChild(gameCard(bracket.games[60], 60));
    fb.appendChild(gameCard(bracket.games[61], 61));
    fb.appendChild(el("p", "mk-reason", "Championship"));
    fb.appendChild(gameCard(bracket.games[62], 62));
  }

  /* ---- poster ---- */
  function loserOf(g) { return g.winner.id === g.a.id ? g.b : g.a; }
  function renderPoster() {
    var card = $("posterCard");
    card.innerHTML = "";
    card.appendChild(el("p", "pc-kicker", "Fill My Bracket - Mock Bracket"));
    card.appendChild(el("p", "pc-champ", bracket.champion.name));
    card.appendChild(el("p", "pc-sub", "Mock champion - " + bracket.champion.seed + " seed. " +
      "Field projected Nov 8, 2026 (CBS Sports bracketology). The real field is set March 14, 2027."));
    var ff = el("p", null, "Final Four: " + bracket.finalFour.map(function (t) {
      return t.name + " (" + t.seed + ")";
    }).join(", ") + ".");
    card.appendChild(ff);
    var rounds = ["Opening round", "Round of 64", "Round of 32", "Sweet 16", "Elite Eight", "Final Four", "Championship"];
    rounds.forEach(function (rn) {
      var lines = [];
      if (rn === "Opening round") {
        slots.forEach(function (sl) {
          if (!sl.playIn) return;
          var key = slotKey(sl.region, sl.seed);
          var w = sl.teams.filter(function (x) { return x.id === openingWinners[key]; })[0];
          var l = sl.teams.filter(function (x) { return x.id !== openingWinners[key]; })[0];
          lines.push(w.name + " (" + sl.seed + ") over " + l.name + " - " + (openingReasons[key] || ""));
        });
      } else {
        bracket.games.forEach(function (g) {
          if (g.round !== rn) return;
          lines.push(g.winner.name + " (" + g.winner.seed + ") over " + loserOf(g).name + " - " + g.reason);
        });
      }
      if (!lines.length) return;
      card.appendChild(el("h3", null, rn));
      var ul = el("ul");
      lines.forEach(function (line) { ul.appendChild(el("li", null, line)); });
      card.appendChild(ul);
    });
    card.appendChild(el("p", "pc-foot", "A mock bracket - practice on a projection, not the real field. Filled with Fill My Bracket: fillmybracket.com/mock-bracket"));
  }

  /* ---- actions ---- */
  $("fillBtn").addEventListener("click", function () { fill(false); });
  $("chalkBtn").addEventListener("click", function () {
    answers.chaos = "chalk"; answers.tiebreak = "familiar";
    answers.championPick = null; champSel.value = "";
    answers.littleGuys = false; answers.ride = "";
    document.querySelectorAll(".q").forEach(function (q) {
      var key = q.getAttribute("data-q");
      q.querySelectorAll(".pill").forEach(function (p) {
        var v = p.getAttribute("data-v");
        var on = (key === "chaos" && v === "chalk") || (key === "tiebreak" && v === "familiar") ||
                 (key === "littleGuys" && v === "no") || (key === "ride" && v === "");
        p.classList.toggle("on", !!on);
      });
    });
    fill(false);
  });
  $("posterBtn").addEventListener("click", function () {
    renderPoster();
    $("posterSec").hidden = false;
    if (runStarted && !runCompleted) {
      runCompleted = true;
      track("tool_complete", { surface: "mock" });
      runCount++;
      try { localStorage.setItem("fmb_mock_runs", String(runCount)); } catch (e) {}
      $("runNo").textContent = String(runCount);
    }
    $("posterSec").scrollIntoView({ block: "start", behavior: RM ? "auto" : "smooth" });
  });
  $("printBtn").addEventListener("click", function () { window.print(); });
  $("shareBtn").addEventListener("click", function () {
    var summary = buildShareSummary(bracket);
    var msg = $("shareMsg");
    track("share_intent", { surface: "share", via: "mock" });
    if (navigator.share) {
      navigator.share({ title: "My mock bracket: " + bracket.champion.name + " wins it all", text: summary, url: "https://fillmybracket.com/mock-bracket?via=share" }).catch(function () {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(summary).then(function () {
        msg.textContent = "Copied. Paste it anywhere - a pool chat, a note, a fridge door.";
      }, function () { msg.textContent = "Sharing did not work on this device - the poster above has every pick."; });
    } else {
      msg.textContent = "Sharing did not work on this device - the poster above has every pick.";
    }
  });
  $("backBtn").addEventListener("click", function () {
    $("posterSec").hidden = true;
    $("bracketSec").scrollIntoView({ block: "start", behavior: RM ? "auto" : "smooth" });
  });
  $("againBtn").addEventListener("click", function () {
    bracket = null; runStarted = false; runCompleted = false;
    $("bracketSec").hidden = true;
    $("posterSec").hidden = true;
    $("askSec").scrollIntoView({ block: "start", behavior: RM ? "auto" : "smooth" });
    announce("");
  });
})();
