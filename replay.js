"use strict";
/* Fill My Bracket — Replay March 2026 (2026-11-05).
   Replaces the abstract seed-vs-seed calls unit. Eight REAL first-round
   games from the 2026 tournament: one per seed pair, upsets where they
   happened, the closest game where the favorite held. Every score is from
   the site's verified dataset (upset-data-2026-11-01/gen2026), and every
   history line uses the counted seed-line table (1985-2026, 164 games
   per line: 12v5 58, 9v8 87, 11v6 64, 10v7 63, 13v4 33, 14v3 23,
   15v2 11, 16v1 2). Analytics keep the old picker's taxonomy with
   surface "picker". MEASURE-1 (Nov 5, 2026): this file is the one
   owner of the picker funnel — a per-run gate fires tool_start on a
   run's first pick and tool_complete at most once per run at its end
   card, so a complete can never exceed its start per cohort (before
   this, the end card fired completes with zero starts: the FA
   block's ".pick-btn" start selector matched no element here).
   Metadata only. */
(function () {
  var mount = document.getElementById("replayGame");
  var RM = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function track(name, props) {
    try { if (window.FA && FA.track) FA.track(name, props); } catch (e) {}
  }
  function countUp(el, target, prefix, suffix, dur) {
    prefix = prefix || ""; suffix = suffix || "";
    if (RM || !window.requestAnimationFrame) { el.textContent = prefix + target + suffix; return; }
    var t0 = null;
    function frame(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      el.textContent = prefix + Math.round(target * (1 - Math.pow(1 - p, 3))) + suffix;
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  /* Fact cards keep their scroll-in count-up (was in the retired block). */
  var counters = document.querySelectorAll(".countup");
  if (window.IntersectionObserver && counters.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        countUp(en.target, parseInt(en.target.getAttribute("data-target"), 10) || 0,
          en.target.getAttribute("data-prefix") || "", en.target.getAttribute("data-suffix") || "", 800);
      });
    }, { threshold: 0.4 });
    counters.forEach(function (el) { io.observe(el); });
  }

  if (!mount) return;

  /* a = the higher seed (favorite), b = the lower seed. winner: "a"|"b". */
  var GAMES = [
    { a: { name: "Wisconsin", seed: 5 }, b: { name: "High Point", seed: 12 },
      winner: "b", wScore: 83, lScore: 82,
      line: "The 12 seed has won 58 of 164 of these since 1985. This was one of them — by a single point." },
    { a: { name: "Clemson", seed: 8 }, b: { name: "Iowa", seed: 9 },
      winner: "b", wScore: 67, lScore: 61,
      line: "The 9 seed has won 87 of 164 of these since 1985 — the upset that isn't. In 2026 the 9s swept all four, and Iowa rode this win to the Elite Eight." },
    { a: { name: "North Carolina", seed: 6 }, b: { name: "VCU", seed: 11 },
      winner: "b", wScore: 82, lScore: 78,
      line: "The 11 seed has won 64 of 164 of these since 1985. This one took down North Carolina." },
    { a: { name: "Saint Mary's", seed: 7 }, b: { name: "Texas A&M", seed: 10 },
      winner: "b", wScore: 63, lScore: 50,
      line: "The 10 seed has won 63 of 164 of these since 1985. Texas A&M held Saint Mary's to 50 points." },
    { a: { name: "Kansas", seed: 4 }, b: { name: "California Baptist", seed: 13 },
      winner: "a", wScore: 68, lScore: 60,
      line: "The 13 seed has won 33 of 164 of these since 1985. California Baptist got within 8 — but Kansas held on." },
    { a: { name: "Gonzaga", seed: 3 }, b: { name: "Kennesaw State", seed: 14 },
      winner: "a", wScore: 73, lScore: 64,
      line: "The 14 seed has won 23 of 164 of these since 1985. Kennesaw State kept it to single digits." },
    { a: { name: "UConn", seed: 2 }, b: { name: "Furman", seed: 15 },
      winner: "a", wScore: 82, lScore: 71,
      line: "The 15 seed has won just 11 of 164 of these since 1985. UConn survived this one — and did not stop until the title game." },
    { a: { name: "Duke", seed: 1 }, b: { name: "Siena", seed: 16 },
      winner: "a", wScore: 71, lScore: 65,
      line: "A 16 seed has won only 2 of 164 of these, ever. Siena came within 6 — the closest scare of the whole first round." }
  ];
  var PAR = 4; /* favorites won 4 of these 8; underdogs won the other 4 */

  var idx = 0, score = 0, picks = [], locked = false;
  var runStarted = false, runCompleted = false; /* MEASURE-1 run gate */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function teamName(g, side) { return g[side].name; }
  function winnerOf(g) { return g[g.winner]; }
  function loserOf(g) { return g[g.winner === "a" ? "b" : "a"]; }

  function renderBug() {
    var bug = el("div", "rg-bug");
    bug.appendChild(el("span", "rg-brand", "Replay · March 2026"));
    var st = el("span", "rg-status");
    if (idx >= GAMES.length) {
      st.appendChild(document.createTextNode("Final card"));
      var s1 = el("small", null, "All 8 games called");
      st.appendChild(s1);
    } else {
      st.appendChild(document.createTextNode("Your card: " + score + " of " + (idx + (locked ? 1 : 0))));
      var s2 = el("small", null, "Game " + (idx + 1) + " of " + GAMES.length);
      st.appendChild(s2);
    }
    bug.appendChild(st);
    return bug;
  }
  function renderDots() {
    var d = el("div", "rg-dots");
    d.setAttribute("aria-hidden", "true");
    for (var i = 0; i < GAMES.length; i++) {
      var dot = el("i", i < idx ? "done" : (i === idx ? "now" : ""));
      d.appendChild(dot);
    }
    return d;
  }

  function renderGame() {
    locked = false;
    var g = GAMES[idx];
    mount.innerHTML = "";
    mount.appendChild(renderBug());
    mount.appendChild(renderDots());
    var card = el("div", "rg-card");
    card.appendChild(el("p", "rg-round", "First round · " + g.a.seed + " seed vs " + g.b.seed + " seed"));
    card.appendChild(el("p", "rg-q", "Who are you taking?"));
    var teams = el("div", "rg-teams");
    ["a", "b"].forEach(function (side) {
      var t = g[side];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rg-team";
      btn.setAttribute("data-side", side);
      var seed = el("span", "rg-seed", String(t.seed));
      var name = el("span", "rg-name", t.name);
      var take = el("span", "rg-take", "Take them");
      btn.appendChild(seed); btn.appendChild(name); btn.appendChild(take);
      btn.addEventListener("click", function () { pick(side, btn); });
      teams.appendChild(btn);
    });
    card.appendChild(teams);
    var reveal = el("div", "rg-reveal");
    reveal.setAttribute("aria-live", "polite");
    card.appendChild(reveal);
    mount.appendChild(card);
  }

  function pick(side, btn) {
    if (locked) return;
    locked = true;
    var g = GAMES[idx];
    var right = side === g.winner;
    if (right) score++;
    picks.push(side);
    if (!runStarted) { runStarted = true; track("tool_start", { surface: "picker" }); }
    track("tool_step", { surface: "picker", step: idx + 1 });
    /* POSTREPLAY-01: update the scorebug on the reveal itself, not only on advance. */
    var stEl = mount.querySelector(".rg-status");
    if (stEl && stEl.firstChild) stEl.firstChild.textContent = "Your card: " + score + " of " + (idx + (locked ? 1 : 0));

    var card = btn.closest(".rg-card");
    card.querySelectorAll(".rg-team").forEach(function (b) {
      var s = b.getAttribute("data-side");
      b.disabled = true;
      b.classList.toggle("picked", b === btn);
      b.classList.toggle("winner", s === g.winner);
      b.classList.toggle("loser", s !== g.winner);
      var take = b.querySelector(".rg-take");
      if (take) take.remove();
      var sc = el("span", "rg-final", String(s === g.winner ? g.wScore : g.lScore));
      b.appendChild(sc);
    });

    var reveal = card.querySelector(".rg-reveal");
    var verdict = el("p", "rg-verdict");
    var w = winnerOf(g), l = loserOf(g);
    verdict.innerHTML = "";
    var span = el("span", right ? "good" : "", right ? "You called it. " : "History says otherwise. ");
    verdict.appendChild(span);
    verdict.appendChild(document.createTextNode(w.name + " won, " + g.wScore + "–" + g.lScore + "."));
    reveal.appendChild(verdict);
    reveal.appendChild(el("p", "rg-line", g.line));
    var next = el("button", "rg-next", idx === GAMES.length - 1 ? "See your final card" : "Next game");
    next.type = "button";
    next.addEventListener("click", function () {
      idx++;
      if (idx >= GAMES.length) renderEnd(); else renderGame();
      mount.scrollIntoView({ block: "nearest", behavior: RM ? "auto" : "smooth" });
    });
    reveal.appendChild(next);
    next.focus({ preventScroll: true });
  }

  function verdictLine(s) {
    if (s === 8) return "A perfect card. Every call right — you read March 2026 like you were there.";
    if (s >= 6) return "Sharp card. You beat the chalk line and the underdog line both.";
    if (s === 5) return "A winning card — one better than either lazy strategy.";
    if (s === 4) return "You matched the chalk line exactly. The favorites and the underdogs split these 8, 4 and 4.";
    return "Tough card. March 2026 was built to fool people — the favorites and the dogs split these 8 right down the middle.";
  }

  function renderEnd() {
    if (runStarted && !runCompleted) { runCompleted = true; track("tool_complete", { surface: "picker" }); }
    mount.innerHTML = "";
    mount.appendChild(renderBug());
    mount.appendChild(renderDots());
    var card = el("div", "rg-card rg-end");
    card.appendChild(el("p", "rg-round", "Your final card · March 2026 replay"));
    var fs = el("p", "rg-final-score");
    fs.appendChild(document.createTextNode(score + " "));
    var of = el("span", null, "of 8");
    fs.appendChild(of);
    card.appendChild(fs);
    card.appendChild(el("p", "rg-verdict-line", verdictLine(score)));
    card.appendChild(el("p", "rg-par",
      "The par lines: taking every favorite scored " + PAR + " of 8. Taking every underdog also scored " + (GAMES.length - PAR) + " of 8. The calls below are the card that would have won."));
    var recap = el("ul", "rg-recap");
    GAMES.forEach(function (g, i) {
      var li = el("li");
      var hit = picks[i] === g.winner;
      li.appendChild(el("span", "mark " + (hit ? "hit" : "miss"), hit ? "✓" : "✗"));
      var txt = el("span", null, winnerOf(g).name + " (" + winnerOf(g).seed + ") beat " + loserOf(g).name + " (" + loserOf(g).seed + ")");
      li.appendChild(txt);
      li.appendChild(el("span", "sc", g.wScore + "–" + g.lScore));
      recap.appendChild(li);
    });
    card.appendChild(recap);
    var actions = el("div", "rg-actions");
    var again = el("button", "rg-again", "Play again");
    again.type = "button";
    again.addEventListener("click", function () {
      idx = 0; score = 0; picks = [];
      runStarted = false; runCompleted = false; /* a fresh run may start and complete again */
      renderGame();
      mount.scrollIntoView({ block: "nearest", behavior: RM ? "auto" : "smooth" });
    });
    actions.appendChild(again);
    var explore = el("a", "rg-linkbtn", "Explore the 2026 tournament");
    explore.href = "/tournament-history#2026";
    actions.appendChild(explore);
    var every = el("a", "rg-linkbtn", "See every matchup");
    every.href = "/which-first-round-upsets-happen-most";
    actions.appendChild(every);
    card.appendChild(actions);
    mount.appendChild(card);
  }

  renderGame();
})();
