"use strict";
/* Fill My Bracket - per-bracket share link codec (SPEC-FMB-ADV1108-02,
   Nov 8, 2026). A finished mock bracket gets a short link a recipient
   can open to SEE the creator's bracket on the site:
     https://fillmybracket.com/b#<18-char code>   (46 chars total;
     Santa's server-stored /s/ link is 40 - the 6 extra chars are the
     price of carrying the bracket itself instead of a server key)

   Adaptation of the Santa /g/<code> pattern to what this site's code
   actually supports: Fill My Bracket is a static site with no link
   store (no KV, no links API - the only worker is the Ask worker), so
   the code cannot be a server key. Instead the code IS the bracket,
   compressed: the fleet's older Santa pattern carried a payload in
   the fragment (/#p=..., 405 chars); this codec packs the same job
   into 18 chars. The fragment is never sent to a server, never stored,
   and never rendered as text on any screen.

   Bit layout (104 bits = 13 bytes, base64url, MSB first):
     version 4 (=1) | chaos 2 | tiebreak 2 | little-guys 1 | ride 3 |
     champion-pick 7 (0 = none, else team index + 1) |
     opening-round winners 12 (1 bit per play-in game) |
     bracket winners 63 (1 bit per game: 0 = team a, 1 = team b) |
     field tag 4 (hash of the field id - a link from an older
     projected field fails safe instead of naming wrong teams) |
     checksum 6 (over the preceding 98 bits)
   Team and game order are the field's own iteration order and the
   engine's game order (buildBracket / gameFeeders), so encode and
   decode always agree as long as both sides read the same field. */
(function (root) {
  var CHAOS = ["chalk", "some", "lots", "chaos"];
  var TIEBREAK = ["mascot", "colors", "familiar"];
  var RIDES = ["", "SEC", "Big Ten", "Big 12", "ACC", "Big East"];
  var R64_ORDER = [[1, 16], [8, 9], [5, 12], [4, 13], [6, 11], [3, 14], [7, 10], [2, 15]];
  var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  var CODE_LEN = 18;

  function fieldIndex(field) {
    var teams = [];      // every team, field iteration order
    var playSlots = [];  // play-in slots, field iteration order
    field.regions.forEach(function (r) {
      r.slots.forEach(function (sl) {
        sl.teams.forEach(function (t) {
          teams.push({ id: t.id, name: t.name, seed: sl.seed, region: r.name });
        });
        if (sl.playIn) playSlots.push({ region: r.name, seed: sl.seed, teams: sl.teams });
      });
    });
    return { teams: teams, playSlots: playSlots };
  }
  function fieldTag(field) {
    var h = 2166136261, s = String(field && field.id || "");
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h) % 16;
  }
  function checksum(bits) {
    var h = 5381;
    for (var i = 0; i < bits.length; i++) h = ((h * 33) ^ bits[i]) >>> 0;
    return h % 64;
  }
  function packBits(bits) {
    var bytes = [];
    for (var i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var k = 0; k < 8; k++) b = (b << 1) | (bits[i + k] || 0);
      bytes.push(b);
    }
    var out = "";
    for (var j = 0; j < bytes.length; j += 3) {
      var n = (bytes[j] << 16) | ((bytes[j + 1] || 0) << 8) | (bytes[j + 2] || 0);
      out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] +
             ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
    }
    return out.slice(0, CODE_LEN);
  }
  function unpackBits(code) {
    if (typeof code !== "string" || code.length !== CODE_LEN) return null;
    var vals = [];
    for (var i = 0; i < code.length; i++) {
      var v = ALPHABET.indexOf(code.charAt(i));
      if (v < 0) return null;
      vals.push(v);
    }
    if (vals[CODE_LEN - 1] % 4 !== 0) return null; // pad bits must be zero
    var bits = [];
    vals.forEach(function (v) {
      for (var k = 5; k >= 0; k--) bits.push((v >> k) & 1);
    });
    return bits.slice(0, 104);
  }
  function pushBits(bits, value, width) {
    for (var k = width - 1; k >= 0; k--) bits.push((value >> k) & 1);
  }
  function readBits(bits, pos, width) {
    var v = 0;
    for (var k = 0; k < width; k++) v = (v << 1) | bits[pos + k];
    return v;
  }

  /* Encode the creator's finished mock state.
     field: FMB_SEASON.field; answers: the mock page's answers object;
     openingWinners: { "Region|seed": teamId }; bracket: engine bracket. */
  function encodeBracket(field, answers, openingWinners, bracket) {
    var idx = fieldIndex(field);
    if (idx.playSlots.length !== 12) throw new Error("field must have 12 opening games");
    if (!bracket || !Array.isArray(bracket.games) || bracket.games.length !== 63) {
      throw new Error("bracket must have 63 games");
    }
    var chaos = CHAOS.indexOf(answers.chaos);
    var tie = TIEBREAK.indexOf(answers.tiebreak);
    var ride = RIDES.indexOf(answers.ride || "");
    if (chaos < 0 || tie < 0 || ride < 0) throw new Error("unknown answer value");
    var champ = 0;
    if (answers.championPick) {
      var ci = -1;
      idx.teams.forEach(function (t, i) { if (t.id === answers.championPick) ci = i; });
      if (ci < 0) throw new Error("champion pick not in field");
      champ = ci + 1;
    }
    var bits = [];
    pushBits(bits, 1, 4);
    pushBits(bits, chaos, 2);
    pushBits(bits, tie, 2);
    pushBits(bits, answers.littleGuys ? 1 : 0, 1);
    pushBits(bits, ride, 3);
    pushBits(bits, champ, 7);
    idx.playSlots.forEach(function (sl) {
      var w = openingWinners[sl.region + "|" + sl.seed];
      if (w !== sl.teams[0].id && w !== sl.teams[1].id) throw new Error("opening winner missing");
      pushBits(bits, w === sl.teams[1].id ? 1 : 0, 1);
    });
    bracket.games.forEach(function (g) {
      if (g.winner.id !== g.a.id && g.winner.id !== g.b.id) throw new Error("game winner invalid");
      pushBits(bits, g.winner.id === g.b.id ? 1 : 0, 1);
    });
    pushBits(bits, fieldTag(field), 4);
    pushBits(bits, checksum(bits), 6);
    return packBits(bits);
  }

  /* Decode a code back into a display-ready bracket. Returns null for
     anything malformed, tampered, or from a different field - the
     caller shows one friendly error card, never the code itself. */
  function decodeBracket(field, code) {
    var bits = unpackBits(code);
    if (!bits) return null;
    var pos = 0;
    function take(w) { var v = readBits(bits, pos, w); pos += w; return v; }
    if (take(4) !== 1) return null;
    var chaos = take(2), tie = take(2);
    var little = take(1) === 1;
    var ride = take(3);
    var champ = take(7);
    if (tie >= TIEBREAK.length || ride >= RIDES.length) return null;
    var idx = fieldIndex(field);
    if (idx.playSlots.length !== 12 || champ > idx.teams.length) return null;
    var openingBits = [];
    for (var i = 0; i < 12; i++) openingBits.push(take(1));
    var gameBits = [];
    for (var j = 0; j < 63; j++) gameBits.push(take(1));
    if (take(4) !== fieldTag(field)) return null;
    if (take(6) !== checksum(bits.slice(0, 98))) return null;

    var answers = {
      chaos: CHAOS[chaos], tiebreak: TIEBREAK[tie],
      littleGuys: little, ride: RIDES[ride],
      championPick: champ ? idx.teams[champ - 1].id : null
    };
    var opening = idx.playSlots.map(function (sl, k) {
      var w = sl.teams[openingBits[k]];
      var l = sl.teams[1 - openingBits[k]];
      return {
        region: sl.region, seed: sl.seed,
        winner: { id: w.id, name: w.name, seed: sl.seed },
        loser: { id: l.id, name: l.name, seed: sl.seed }
      };
    });
    var openWin = {};
    opening.forEach(function (o) { openWin[o.region + "|" + o.seed] = o.winner.id; });
    var teamById = {};
    idx.teams.forEach(function (t) { teamById[t.id] = t; });
    // Resolved 64: play-in slots take their decoded winner.
    var resolved = field.regions.map(function (r) {
      var bySeed = {};
      r.slots.forEach(function (sl) {
        var t = sl.playIn
          ? sl.teams.filter(function (x) { return x.id === openWin[r.name + "|" + sl.seed]; })[0]
          : sl.teams[0];
        bySeed[sl.seed] = { id: t.id, name: t.name, seed: sl.seed, region: r.name };
      });
      return { name: r.name, bySeed: bySeed };
    });
    var games = [];
    var gi = 0;
    function play(a, b, round, region) {
      var bit = gameBits[gi];
      var winner = bit ? b : a;
      var loser = bit ? a : b;
      games.push({ index: gi, round: round, region: region, a: a, b: b, winner: winner, loser: loser });
      gi++;
      return winner;
    }
    var regionalChamps = [];
    resolved.forEach(function (r) {
      var winners = R64_ORDER.map(function (pair) {
        return play(r.bySeed[pair[0]], r.bySeed[pair[1]], "Round of 64", r.name);
      });
      var roundNames = ["Round of 32", "Sweet 16", "Elite Eight"];
      for (var k = 0; k < 3; k++) {
        var next = [];
        for (var m = 0; m < winners.length; m += 2) next.push(play(winners[m], winners[m + 1], roundNames[k], r.name));
        winners = next;
      }
      regionalChamps.push(winners[0]);
    });
    var f1 = play(regionalChamps[0], regionalChamps[1], "Final Four", "");
    var f2 = play(regionalChamps[2], regionalChamps[3], "Final Four", "");
    var champion = play(f1, f2, "Championship", "");
    return {
      answers: answers, opening: opening, games: games,
      finalFour: regionalChamps, champion: champion,
      championTeam: teamById[champion.id] || champion
    };
  }

  var api = { encodeBracket: encodeBracket, decodeBracket: decodeBracket, CODE_LEN: CODE_LEN };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FMBLink = api;
})(typeof window !== "undefined" ? window : globalThis);
