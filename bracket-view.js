"use strict";
/* Fill My Bracket - shared bracket view (SPEC-FMB-ADV1108-02, Nov 8, 2026).
   The recipient side of the per-bracket link: /b#<code> lands here in a
   clean context (the code rides in the fragment, so no creator state,
   cookie, or stored run is involved) and renders the CREATOR'S mock
   bracket read-only, with one primary next step: fill your own.
   The code itself is never written to the page, an event, or storage.
   Reasons: where the creator's pick is the one their own answers call
   for, the line carries the engine's reason verbatim (recomputed with
   the same plumbing the mock page uses); a hand-flipped pick is
   labeled "Their pick" - the recipient voice of the creator's
   "your edit". */
(function () {
  var S = window.FMB_SEASON;
  var Link = window.FMBLink;
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

  var code = "";
  try { code = (window.location.hash || "").replace(/^#/, ""); } catch (e) {}
  var view = null;
  try { if (S && S.field && Link) view = Link.decodeBracket(S.field, code); } catch (e) { view = null; }

  if (!view) {
    $("errSec").hidden = false;
    track("share_arrival", { tool: "fill-my-bracket", via: "bracket-link", result: "invalid" });
    $("errBtn").addEventListener("click", function () {
      track("gen2_start", { surface: "recipient-error", via: "bracket-link" });
    });
    return;
  }

  var F = S.field;
  track("share_arrival", { tool: "fill-my-bracket", via: "bracket-link", result: "view" });
  ["gen2Btn", "gen2Btn2"].forEach(function (id) {
    $(id).addEventListener("click", function () {
      track("gen2_start", { surface: "recipient", via: "bracket-link" });
    });
  });

  /* ---- natural reasons, recomputed with the mock page's plumbing ---- */
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
  var teamInfo = {};
  F.regions.forEach(function (r) {
    r.slots.forEach(function (sl) {
      sl.teams.forEach(function (t) { teamInfo[t.id] = { info: t, seed: sl.seed, region: r.name }; });
    });
  });
  var naturalReasons = {};  // game index -> reason (only where pick + matchup match)
  var naturalOpen = {};     // "Region|seed" -> reason
  try {
    var a = view.answers;
    function boostFor(team, seed) {
      if (a.ride && team.conf === a.ride) return "your " + a.ride + " ride";
      if (a.littleGuys && seed >= 10) return "little-guy boost";
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
    var ea = {
      loyalty: (a.ride || a.littleGuys) ? "home" : "none",
      chaos: a.chaos, tiebreak: a.tiebreak,
      championPick: a.championPick, tournament: "men"
    };
    var openWinId = {};
    view.opening.forEach(function (o) { openWinId[o.region + "|" + o.seed] = o.winner.id; });
    F.regions.forEach(function (r) {
      r.slots.forEach(function (sl) {
        if (!sl.playIn) return;
        var g = decideGame(engineTeam(sl.teams[0], sl.seed), engineTeam(sl.teams[1], sl.seed), ea,
          F.id + "|OPEN-" + r.name + "-" + sl.seed, "Opening round");
        if (g.winner.id === openWinId[r.name + "|" + sl.seed]) {
          naturalOpen[r.name + "|" + sl.seed] = g.reason;
        }
      });
    });
    var resolved = {
      id: F.id, label: F.label, tournament: "men",
      regions: F.regions.map(function (r) {
        return {
          name: r.name,
          teams: r.slots.map(function (sl) {
            var t = sl.playIn
              ? sl.teams.filter(function (x) { return x.id === openWinId[r.name + "|" + sl.seed]; })[0]
              : sl.teams[0];
            return engineTeam(t, sl.seed);
          })
        };
      })
    };
    var natural = buildBracket(resolved, ea);
    natural.games.forEach(function (g, i) {
      var d = view.games[i];
      if (g.a.id === d.a.id && g.b.id === d.b.id && g.winner.id === d.winner.id) {
        naturalReasons[i] = g.reason;
      }
    });
  } catch (e) { naturalReasons = {}; naturalOpen = {}; }

  /* ---- render (read-only; textContent only, no link or code shown) ---- */
  var champ = view.champion;
  var ci = teamInfo[champ.id];
  $("vChamp").textContent = champ.name;
  $("vChampSub").textContent = "The " + champ.seed + " seed out of the " + (ci ? ci.region : "") +
    " - on a projected field. " + (view.answers.championPick === champ.id ? "Their pick to win it all." : "Called by their answers.");
  $("vFF").innerHTML = "";
  var ffStrong = el("strong", null, "Final Four: ");
  $("vFF").appendChild(ffStrong);
  $("vFF").appendChild(document.createTextNode(view.finalFour.map(function (t) {
    return t.name + " (" + t.seed + ")";
  }).join(", ") + "."));

  var card = $("vCard");
  card.innerHTML = "";
  card.appendChild(el("p", "pc-kicker", "Fill My Bracket - Mock Bracket"));
  card.appendChild(el("p", "pc-champ", champ.name));
  card.appendChild(el("p", "pc-sub", "Mock champion - " + champ.seed + " seed. " +
    "Field projected Nov 8, 2026 (CBS Sports bracketology). The real field is set March 14, 2027."));
  function loserOf(g) { return g.winner.id === g.a.id ? g.b : g.a; }
  function lineFor(winner, loser, reason) {
    return winner.name + " (" + winner.seed + ") over " + loser.name + " - " + reason;
  }
  var rounds = ["Opening round", "Round of 64", "Round of 32", "Sweet 16", "Elite Eight", "Final Four", "Championship"];
  rounds.forEach(function (rn) {
    var lines = [];
    if (rn === "Opening round") {
      view.opening.forEach(function (o) {
        var reason = naturalOpen[o.region + "|" + o.seed] || "Their pick";
        lines.push(lineFor(o.winner, o.loser, reason));
      });
    } else {
      view.games.forEach(function (g) {
        if (g.round !== rn) return;
        var reason = naturalReasons[g.index] || "Their pick";
        lines.push(lineFor(g.winner, loserOf(g), reason));
      });
    }
    if (!lines.length) return;
    card.appendChild(el("h3", null, rn));
    var ul = el("ul");
    lines.forEach(function (line) { ul.appendChild(el("li", null, line)); });
    card.appendChild(ul);
  });
  card.appendChild(el("p", "pc-foot", "A mock bracket - practice on a projection, not the real field. Filled with Fill My Bracket."));
  $("viewSec").hidden = false;
})();
