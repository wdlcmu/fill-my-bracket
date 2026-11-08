"use strict";
/* Fill My Bracket - MOCK engine (Nov 8, 2026). The site prototype
   engine (builds/fill-my-bracket/engine.js) with ONE adaptation: the
   loyalty reason line reads the winning team's boostLabel, because
   on the mock surface the +6 bonus is a chosen boost (little guys /
   conference ride), not a home team. All pick math, validation, and
   pick editing are the prototype's, unchanged. */
// Fill My Bracket - bracket engine (prototype, option 1 from the Oct 20 spec)
// Pure logic. No DOM, no network. Works in Node (QA harness) and the browser.
//
// Input:  one bracket data file (object, see data/*.json for the shape)
//         + five answers (see questions.js)
// Output: one full bracket: 63 games, each with a winner and a one-line
//         reason that only uses the answers given (spec honesty rule).
//
// Data shape:
// {
//   id, label, isTestData, source, tournament: "men"|"women",
//   regions: [ { name, teams: [ { id, name, seed, mascot, colors,
//                mascotScore, colorScore, familiarScore, isHome } x16 ] } x4 ]
// }
//
// Pick logic is preference logic, stated plainly as such (spec rule).
// No odds, no win probabilities, no betting advice.

// Standard Round-of-64 pairing order inside a region.
const R64_ORDER = [
  [1, 16], [8, 9], [5, 12], [4, 13],
  [6, 11], [3, 14], [7, 10], [2, 15],
];

// Base jitter: a small fixed nudge per team per game (range below),
// there so near-tied teams do not fall the same way in every game.
// It is rolled from the game slot and the team only - never from
// any answer - so it cannot smuggle one answer's effect into games
// that answer has no rule in (semantic-audit F2, Oct 29 2026).
const BASE_JITTER = 2;

// Chaos bonus, per level (semantic-audit F1/F2 fix, Oct 29 2026).
// The old engine re-rolled a per-team jitter from a hash that
// included the chaos, tiebreak, and loyalty answers, with a range
// (max 15) far below the 30-point seed gap between a 1 seed and a
// 16 seed. Two failures followed: each chaos level was a fresh
// roll, so more chaos could mean fewer upsets on the same other
// answers (8 of 36 level steps went backwards), and chaos could
// never reach the late rounds (worst champion seed 3, a 16-over-1
// win mathematically impossible).
//
// The fix: one level-independent roll per game slot, drawn once
// from the slot alone (see unitRoll). The underdog BY SEED gets a
// bonus of that roll cubed times the level's cap below. Cubing
// keeps most bonuses small (close games flip first) while a few
// slots draw a bonus big enough to beat a big seed gap. The bonus
// only ever grows with the level, on the same roll, for the same
// slot - so for any fixed pairing, more chaos flips a game toward
// the underdog at most once and never flips it back. Only the top
// cap (46) is wider than the biggest seed gap (30), which is what
// lets a deep chaos run - a 16 over a 1, a low-seed champion -
// happen at the top level and only there. Chalk's cap (2.5) stays
// tiny, so "keep it safe" still means favorites win.
const CHAOS_BONUS = { chalk: 2.5, some: 6, lots: 15, chaos: 46 };

// Printed label for each chaos level in an upset reason line.
// The chaos VALUES are ids, not words to print: the old template
// printed the id plus "chaos", which read "upset pick - chaos chaos"
// at the top level (cold-user walk Finding L1, Oct 24 2026). Map each
// level id to the full phrase to print instead. "chalk" never reaches
// the upset template (chalk upsets use the tiebreak label), but it is
// mapped here too so every level has exactly one printed label.
const CHAOS_UPSET_LABEL = {
  chalk: "playing it safe",
  some: "a little chaos",
  lots: "lots of chaos",
  chaos: "maximum chaos",
};

// Deterministic hash -> integer. Same inputs always give the same
// jitter, which is what makes "same answers -> same bracket" true.
function hashInt(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

// Deterministic roll in [0, 1) from a string key. The FNV hash
// above leaves similar keys (team ids that differ in one digit)
// with similar values, which kept paired teams' rolls nearly
// equal and quietly shrank every jitter difference; the integer
// finalizer below (murmur-style) mixes the hash so similar keys
// land far apart, and the roll is a true fraction of the range
// instead of a modulo re-roll. Same key always gives the same
// roll, which is what makes "same answers -> same bracket" true.
// Keys are built only from the data id, the game slot, and team
// ids - never from any answer (semantic-audit F2 fix).
function unitRoll(key) {
  let x = hashInt(key);
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function tiebreakScore(team, tiebreak) {
  if (tiebreak === "mascot") return team.mascotScore || 0;
  if (tiebreak === "colors") return team.colorScore || 0;
  if (tiebreak === "familiar") return team.familiarScore || 0;
  return 0;
}

// Inline-text guard (P3-N2 hardening, Oct 29 2026): a line break or
// other control character inside a name, label, mascot, or colors
// value must never reach a plain-text line, where it could forge a
// stand-alone line (for example a fake "Champion:" line) in the text
// or share output. Validation rejects such values in data files;
// this helper is the second layer for any value that reaches a
// renderer or a reason line by another path: control characters
// collapse to a single space.
function hasControlChars(s) {
  return /[\u0000-\u001F\u007F]/.test(s);
}
function sanitizeInlineText(value) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001F\u007F]+/g, " ");
}

function tiebreakLabel(team, tiebreak) {
  // P3-P4 (Oct 28 2026): a team file can carry mascot: null (or a
  // missing / non-string mascot or colors value). The old template
  // printed that raw, so reasons and share text read "mascot pick
  // (null)". Only name the mascot / colors when the value is a real
  // non-empty string; otherwise use the plain label with no
  // parenthetical, so "null" (or "[object Object]") can never render.
  // P3-N2 (Oct 29 2026): the named value is also passed through
  // sanitizeInlineText so a line break in it cannot forge a line.
  if (tiebreak === "mascot") {
    return typeof team.mascot === "string" && team.mascot.trim()
      ? `mascot pick (${sanitizeInlineText(team.mascot)})`
      : "mascot pick";
  }
  if (tiebreak === "colors") {
    return typeof team.colors === "string" && team.colors.trim()
      ? `colors pick (${sanitizeInlineText(team.colors)})`
      : "colors pick";
  }
  if (tiebreak === "familiar") return "school you have heard of";
  return "tiebreak pick";
}

// Base score for one team in one game: seed strength, the loyalty
// bonus, the tiebreak preference, and the small base jitter. The
// higher base score wins the game unless the seed underdog's chaos
// bonus beats the margin - that comparison is explainGame's job,
// so this base score never depends on the chaos level.
function scoreTeam(team, opponent, answers, gameKey) {
  // A champion pick always wins its games. Stated plainly in the reason.
  if (answers.championPick && team.id === answers.championPick) {
    return { score: 1000, forced: true };
  }
  if (answers.championPick && opponent.id === answers.championPick) {
    return { score: -1000, forced: false };
  }
  const seedStrength = 17 - team.seed; // seed 1 -> 16, seed 16 -> 1
  let score = seedStrength * 2;
  if (answers.loyalty === "home" && team.isHome) score += 6;
  // Tiebreak preference: small, so it breaks close games, not blowouts.
  score += tiebreakScore(team, answers.tiebreak) * 0.4;
  // Base jitter: one fixed roll per game + team, scaled by
  // BASE_JITTER at every chaos level. It never reads an answer,
  // so flipping loyalty or tiebreak cannot re-roll a game those
  // answers have no rule in (semantic-audit F2 fix, Oct 29 2026).
  // The chaos effect itself is NOT here: it is the underdog bonus
  // in explainGame, so this base score is the same at every level.
  score += unitRoll(`${gameKey}|${team.id}`) * BASE_JITTER;
  return { score, forced: false };
}

// Explain one game: the two base scores (seed + loyalty + tiebreak
// + base jitter, exactly as scoreTeam computes them), the margin
// between them, and the chaos bonus for this slot at the picked
// level. This is the game's whole math, exported for the QA
// harnesses so a changed winner can be attributed to the rule
// that changed it (the F2 flip test) instead of guessed at.
// The winner rule, stated plainly:
//   - a champion pick wins its games (forced, as before);
//   - otherwise the higher base score wins, UNLESS the underdog
//     by seed (the higher seed number; on equal seeds, the base
//     loser) draws a chaos bonus bigger than the margin, in
//     which case the underdog wins. The bonus is the slot's one
//     level-independent roll, cubed, times the level's cap -
//     the same roll at every level, only the cap grows, so a
//     game can flip toward the underdog as chaos rises but can
//     never flip back (semantic-audit F1 fix, Oct 29 2026).
function explainGame(a, b, answers, gameKey) {
  const sa = scoreTeam(a, b, answers, gameKey);
  const sb = scoreTeam(b, a, answers, gameKey);
  const slotRoll = unitRoll(gameKey);
  if (sa.forced || sb.forced) {
    return {
      baseA: sa.score, baseB: sb.score,
      margin: Math.abs(sa.score - sb.score),
      slotRoll, chaosBonus: 0, underdogId: null,
      winner: sa.forced ? a : b, forced: true,
    };
  }
  const baseWinner = sa.score >= sb.score ? a : b;
  const baseLoser = baseWinner === a ? b : a;
  const underdog = a.seed !== b.seed ? (a.seed > b.seed ? a : b) : baseLoser;
  const maxBonus = CHAOS_BONUS[answers.chaos] ?? CHAOS_BONUS.some;
  const chaosBonus = maxBonus * slotRoll * slotRoll * slotRoll;
  const margin = Math.abs(sa.score - sb.score);
  const winner = underdog === baseWinner || chaosBonus > margin ? underdog : baseWinner;
  return {
    baseA: sa.score, baseB: sb.score,
    margin, slotRoll, chaosBonus, underdogId: underdog.id,
    winner, forced: false,
  };
}

// --- Causal reason lines (SPEC-FMB-REASON-CAUSAL-1, Oct 31 2026) ---
// Replay one game's winner rule on given base scores and a given
// chaos bonus. This is exactly explainGame's winner rule, factored
// out so a reason can be tested counterfactually: remove one rule's
// term, replay, and the rule was decisive only if the winner changes.
function winnerWithScores(baseA, baseB, a, b, chaosBonus) {
  const baseWinner = baseA >= baseB ? a : b;
  const baseLoser = baseWinner === a ? b : a;
  const underdog = a.seed !== b.seed ? (a.seed > b.seed ? a : b) : baseLoser;
  const margin = Math.abs(baseA - baseB);
  return underdog === baseWinner || chaosBonus > margin ? underdog : baseWinner;
}

// Pick the reason for a game whose winner the engine math produced
// (ex is that game's explainGame result, for teams a vs b in game
// order). Champion pick first; then the first rule - loyalty, then
// chaos, then tiebreak - whose removal changes the winner. A rule
// that did not decide the game is never named: the old template
// order named a non-deciding rule in 552 of 1,066 loyalty / chaos /
// tiebreak labels (52%, semantic-fit audit #2, Oct 31 2026). If no
// named rule decided it, the line is a plain label that names no
// rule: "favorite holds" when the winner is the seed favorite, and
// "close game" otherwise (an underdog or equal-seed winner that no
// named rule flipped won on the base math - seed, scores, jitter).
function causalReason(winner, loser, answers, ex, a, b) {
  if (answers.championPick && winner.id === answers.championPick) {
    return "your pick to win it all";
  }
  // Loyalty: the +6 home bonus, only for a home winner over a
  // non-home loser (the only case the old template named it).
  if (answers.loyalty === "home" && winner.isHome && !loser.isHome) {
    // MOCK ADAPTATION (Nov 8, 2026): on the mock surface the +6
    // "isHome" bonus is a visitor-chosen boost (a double-digit-seed
    // boost or a conference ride), and the reason names that boost
    // via the winning team's boostLabel. Engine math is unchanged.
    const adjA = ex.baseA - (a.isHome ? 6 : 0);
    const adjB = ex.baseB - (b.isHome ? 6 : 0);
    if (winnerWithScores(adjA, adjB, a, b, ex.chaosBonus).id !== winner.id) {
      return winner.boostLabel || "home team loyalty";
    }
  }
  // Chaos: the underdog bonus. Named only on a true seed upset, so
  // an "upset pick" line never sits on an equal-seed or favorite win.
  if (winner.seed > loser.seed &&
      winnerWithScores(ex.baseA, ex.baseB, a, b, 0).id !== winner.id) {
    return `upset pick - ${CHAOS_UPSET_LABEL[answers.chaos] ?? CHAOS_UPSET_LABEL.some}`;
  }
  // Tiebreak: the picked preference score (mascot / colors /
  // familiar), worth 0.4 a point in the base score. Never named
  // when the winner's own named score is lower than the loser's -
  // that score pointed the other way.
  if (tiebreakScore(winner, answers.tiebreak) >= tiebreakScore(loser, answers.tiebreak)) {
    const adjA = ex.baseA - tiebreakScore(a, answers.tiebreak) * 0.4;
    const adjB = ex.baseB - tiebreakScore(b, answers.tiebreak) * 0.4;
    if (winnerWithScores(adjA, adjB, a, b, ex.chaosBonus).id !== winner.id) {
      return tiebreakLabel(winner, answers.tiebreak);
    }
  }
  return winner.seed < loser.seed ? "favorite holds" : "close game";
}

function decideGame(a, b, answers, gameKey, roundName) {
  const ex = explainGame(a, b, answers, gameKey);
  const winner = ex.winner;
  const loser = winner === a ? b : a;
  const reason = ex.forced
    ? "your pick to win it all"
    : causalReason(winner, loser, answers, ex, a, b);
  return { round: roundName, gameKey, a, b, winner, reason };
}

function playRound(games) {
  // games: array of decideGame results; pair winners in order.
  const next = [];
  for (let i = 0; i < games.length; i += 2) next.push([games[i].winner, games[i + 1].winner]);
  return next;
}

// Describe a value for an error message without ever printing
// "[object Object]": strings are quoted, numbers and booleans are
// shown with their type, and objects / arrays are named by kind
// only. Used for bad answer values (P3-P3) and bad seed values
// (P3-P2), both of which reach user-facing error text.
function describeValue(v) {
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "number" || typeof v === "boolean") return `${v} (${typeof v})`;
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  if (typeof v === "object") return "an object";
  return typeof v;
}

// Plain seed value for a seed error line: numbers print as-is,
// anything else goes through describeValue so an odd seed can
// never render as "[object Object]" either.
function formatSeedValue(s) {
  return typeof s === "number" ? String(s) : describeValue(s);
}

function bySeedOrder(a, b) {
  const an = typeof a === "number", bn = typeof b === "number";
  if (an && bn) return a - b;
  if (an) return -1;
  if (bn) return 1;
  return String(a).localeCompare(String(b));
}

// Answer validation (P3-P3, Oct 28 2026): the engine API can be
// called with values the form can never send. Unknown chaos,
// tiebreak, loyalty, or tournament values used to fall back
// silently and still return a 63-game bracket, and a champion
// pick of the wrong type (a number, an object) used to be carried
// into the not-applied note, printing "42" as if it were a team
// or "[object Object]". Now every bad answer is refused up front
// with a clear error that names the field, what was got (safely),
// and what is allowed. A missing (undefined) field is still
// allowed: the engine's existing fallbacks apply to absent
// answers, never to present-but-wrong ones.
function validateAnswers(answers) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    throw new Error(`Answers must be an object holding the five answers; got ${describeValue(answers)}.`);
  }
  const enumFields = [
    ["loyalty", ["home", "none"]],
    ["chaos", ["chalk", "some", "lots", "chaos"]],
    ["tiebreak", ["mascot", "colors", "familiar"]],
    ["tournament", ["men", "women", "both"]],
  ];
  for (const [field, allowed] of enumFields) {
    const v = answers[field];
    if (v === undefined) continue;
    if (!allowed.includes(v)) {
      throw new Error(`Invalid ${field} answer ${describeValue(v)}: expected one of ${allowed.join(", ")}.`);
    }
  }
  const checkPick = (v, label) => {
    if (v !== undefined && v !== null && typeof v !== "string") {
      throw new Error(`${label} must be a team id (a string) or no pick (null); got ${describeValue(v)}.`);
    }
  };
  checkPick(answers.championPick, "Champion pick");
  if (answers.championPicks !== undefined && answers.championPicks !== null) {
    if (typeof answers.championPicks !== "object" || Array.isArray(answers.championPicks)) {
      throw new Error(`Champion picks (championPicks) must be an object with one pick per tournament; got ${describeValue(answers.championPicks)}.`);
    }
    checkPick(answers.championPicks.men, "Champion pick for the men's bracket");
    checkPick(answers.championPicks.women, "Champion pick for the women's bracket");
  }
}

// Safe region name for an error line: the region's own name when it
// is a real non-empty string, otherwise its position, so a broken
// region can never render as "region undefined" or "[object Object]".
function regionLabel(region, index) {
  return region && typeof region.name === "string" && region.name.trim()
    ? sanitizeInlineText(region.name)
    : `region ${index + 1}`;
}

// Safe team identifier for an error line: its id when that is a real
// string, else its seed, else its position in the region.
function teamLabel(team, index) {
  if (team && typeof team.id === "string" && team.id.trim()) return team.id;
  if (team && Number.isInteger(team.seed)) return `seed ${team.seed}`;
  return `team at position ${index + 1}`;
}

function validateData(data) {
  // P3-N1 hardening (Oct 29 2026): this validator's contract is that
  // it ALWAYS returns an error list. It must never throw, whatever
  // shape it is handed - null data, a null region, a null team, or a
  // teams value that is an array-like object instead of an array all
  // become plain error entries below, never a raw TypeError.
  const errors = [];
  const dataIsObject = !!data && typeof data === "object" && !Array.isArray(data);
  // P2-N1 (Oct 29 2026): the data label prints in the bracket header,
  // the text render, and the share summary, so it must be a real
  // non-empty string with no line breaks - the same rule as a team
  // name (below). An object label used to print "[object Object]"
  // in all three places across a passing bracket.
  if (dataIsObject) {
    if (typeof data.label !== "string" || !data.label.trim()) {
      errors.push(`data label must be a non-empty string; got ${describeValue(data.label)}`);
    } else if (hasControlChars(data.label)) {
      errors.push("data label must not contain line breaks or control characters");
    }
  }
  if (!data || !Array.isArray(data.regions)) errors.push("data.regions missing");
  else {
    if (data.regions.length !== 4) errors.push(`expected 4 regions, got ${data.regions.length}`);
    data.regions.forEach((region, regionIndex) => {
      const rLabel = regionLabel(region, regionIndex);
      if (!region || typeof region !== "object" || Array.isArray(region)) {
        errors.push(`${rLabel}: region must be an object with a name and 16 teams; got ${describeValue(region)}`);
        return;
      }
      if (!Array.isArray(region.teams)) {
        errors.push(`region ${rLabel}: expected 16 teams as an array, got ${describeValue(region.teams)}`);
        return;
      }
      if (region.teams.length !== 16) {
        errors.push(`region ${rLabel}: expected 16 teams, got ${region.teams.length}`);
        return;
      }
      // Split out broken team entries first (P3-N1): a null, array,
      // or non-object team is a named error, and the checks below
      // run on the real team objects only, so nothing downstream
      // can throw reading .seed / .id / .name off a broken entry.
      const teams = [];
      region.teams.forEach((t, teamIndex) => {
        if (!t || typeof t !== "object" || Array.isArray(t)) {
          errors.push(`region ${rLabel}: team at position ${teamIndex + 1} must be an object; got ${describeValue(t)}`);
        } else teams.push(t);
      });
      // Per-team field checks (P2-N1 + P3-N2 + P3-N3, Oct 29 2026):
      // - name: a non-empty string with no line breaks or control
      //   characters. A null / missing / object name used to pass
      //   every check and then print "null" / "undefined" /
      //   "[object Object]" on every game line, and a name with a
      //   newline could forge a stand-alone line in text/share.
      // - id: a non-empty string. A numeric or object id used to
      //   build clean even though the page's dropdown values are
      //   strings, so a pick could never match it through the form.
      // - scores: mascotScore / colorScore / familiarScore, when
      //   present, must be finite numbers. Infinity, NaN, an object,
      //   or the string "999" (silently coerced by the score math)
      //   used to be able to crown a seed-16 team. A missing score
      //   is still allowed: the score math treats it as 0.
      for (const t of teams) {
        const tLabel = teamLabel(t, region.teams.indexOf(t));
        if (typeof t.name !== "string" || !t.name.trim()) {
          errors.push(`region ${rLabel}: team ${tLabel} name must be a non-empty string; got ${describeValue(t.name)}`);
        } else if (hasControlChars(t.name)) {
          errors.push(`region ${rLabel}: team ${tLabel} name must not contain line breaks or control characters`);
        }
        if (typeof t.id !== "string" || !t.id.trim()) {
          errors.push(`region ${rLabel}: team ${tLabel} id must be a non-empty string; got ${describeValue(t.id)}`);
        }
        for (const scoreField of ["mascotScore", "colorScore", "familiarScore"]) {
          const v = t[scoreField];
          if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v))) {
            errors.push(`region ${rLabel}: team ${tLabel} ${scoreField} must be a finite number when present; got ${describeValue(v)}`);
          }
        }
      }
      // Seed reporting (P3-P2, Oct 28 2026): name the real bad
      // seeds only. The old check walked the sorted list slot by
      // slot, so one bad seed (99 in place of seed 1) shifted every
      // later slot and reported all 16 seeds "missing or
      // duplicated". Now the report is set-based: which expected
      // seeds are missing, which are duplicated, and which values
      // fall outside the seed range - nothing else is named.
      const seedCounts = new Map();
      for (const t of teams) seedCounts.set(t.seed, (seedCounts.get(t.seed) || 0) + 1);
      const missingSeeds = [];
      for (let s = 1; s <= 16; s++) if (!seedCounts.has(s)) missingSeeds.push(s);
      const duplicatedSeeds = [...seedCounts.entries()].filter(([, c]) => c > 1).map(([s]) => s).sort(bySeedOrder);
      const unexpectedSeeds = [...seedCounts.keys()]
        .filter((s) => !Number.isInteger(s) || s < 1 || s > 16).sort(bySeedOrder);
      const seedWord = (list) => (list.length === 1 ? "seed" : "seeds");
      if (missingSeeds.length) {
        errors.push(`region ${rLabel}: ${seedWord(missingSeeds)} ${missingSeeds.join(", ")} missing`);
      }
      if (duplicatedSeeds.length) {
        errors.push(`region ${rLabel}: ${seedWord(duplicatedSeeds)} ${duplicatedSeeds.map(formatSeedValue).join(", ")} duplicated`);
      }
      if (unexpectedSeeds.length) {
        errors.push(`region ${rLabel}: ${seedWord(unexpectedSeeds)} ${unexpectedSeeds.map(formatSeedValue).join(", ")} unexpected (outside the seed range)`);
      }
      const ids = new Set(teams.map((t) => t.id));
      if (ids.size !== teams.length) errors.push(`region ${rLabel}: team ids not unique`);
    });
    // Field-wide check (P2-P2, Oct 28 2026): ids must also be unique
    // across all 64 teams, not just inside each region. A copy-pasted
    // id in another region otherwise passes every check and can put
    // the same team in the Final Four twice. Guarded the same way as
    // the per-region checks (P3-N1): only real arrays of real team
    // objects are walked, and a duplicated id is described safely so
    // an object id can never print "[object Object]" here either.
    const fieldIds = new Set();
    const dupIds = new Set();
    for (const region of data.regions || []) {
      if (!region || typeof region !== "object" || !Array.isArray(region.teams)) continue;
      for (const t of region.teams) {
        if (!t || typeof t !== "object" || Array.isArray(t)) continue;
        if (fieldIds.has(t.id)) dupIds.add(t.id);
        fieldIds.add(t.id);
      }
    }
    if (dupIds.size) {
      const shown = [...dupIds].map((id) => (typeof id === "string" ? sanitizeInlineText(id) : describeValue(id)));
      errors.push(`team ids not unique across the field: ${shown.join(", ")}`);
    }
  }
  return errors;
}

// Champion-pick scoping (fixed Oct 23, 2026; see
// champion-pick-fix-report-2026-10-23.md):
// A champion pick belongs to ONE field. Two ways to give one:
//   - answers.championPicks = { men: idOrNull, women: idOrNull }
//     (per-tournament picks; each bracket uses only its own), or
//   - answers.championPick = id (one unscoped pick, the original
//     shape; kept for single-tournament calls).
// A bracket applies the pick only when that exact team id is in
// ITS data file. When the pick is not in the field, the bracket
// is built with no champion pick and says so on the bracket
// (championPickNote, also printed by renderText) - the pick is
// never silently dropped, and it never fires for a different
// team that happens to share an id in the other field. Team ids
// in the data files are tournament-prefixed (generate-data.js)
// so an unscoped pick names exactly one team in exactly one
// field.
function teamIdSet(data) {
  // Guarded (P3-N1, Oct 29 2026): a missing or corrupt data file
  // yields an empty set here, never a raw TypeError - the clear
  // "No data file" / validation errors are raised by the callers.
  const ids = new Set();
  if (!data || typeof data !== "object" || !Array.isArray(data.regions)) return ids;
  for (const region of data.regions) {
    if (!region || typeof region !== "object" || !Array.isArray(region.teams)) continue;
    for (const t of region.teams) {
      if (t && typeof t === "object" && !Array.isArray(t)) ids.add(t.id);
    }
  }
  return ids;
}

function resolveChampionPick(data, answers) {
  let requested = null;
  if (answers.championPicks && typeof answers.championPicks === "object" &&
      Object.prototype.hasOwnProperty.call(answers.championPicks, data.tournament)) {
    requested = answers.championPicks[data.tournament] || null;
  } else if (answers.championPick) {
    requested = answers.championPick;
  }
  if (!requested) return { requested: null, effective: null, note: null };
  if (teamIdSet(data).has(requested)) {
    return { requested, effective: requested, note: null };
  }
  return {
    requested,
    effective: null,
    note: `Champion pick "${requested}" was not applied to the ${data.tournament}'s bracket: ` +
      `that team is not in this field, so this bracket was built with no champion pick.`,
  };
}

// Build one complete bracket for one tournament data file.
function buildBracket(data, answers) {
  validateAnswers(answers);
  const errors = validateData(data);
  if (errors.length) throw new Error("Invalid bracket data: " + errors.join("; "));

  const pick = resolveChampionPick(data, answers);
  const effectiveAnswers = { ...answers, championPick: pick.effective };

  const allGames = [];
  const regionalChamps = [];

  for (const region of data.regions) {
    const bySeed = new Map(region.teams.map((t) => [t.seed, t]));
    // Round of 64
    let pairs = R64_ORDER.map(([s1, s2]) => [bySeed.get(s1), bySeed.get(s2)]);
    const rounds = [
      ["Round of 64", pairs],
    ];
    let games = pairs.map((p, i) =>
      decideGame(p[0], p[1], effectiveAnswers, `${data.id}|${region.name}-R64-${i}`, "Round of 64"));
    allGames.push(...games);

    const roundNames = ["Round of 32", "Sweet 16", "Elite Eight"];
    for (const rn of roundNames) {
      pairs = playRound(games);
      games = pairs.map((p, i) =>
        decideGame(p[0], p[1], effectiveAnswers, `${data.id}|${region.name}-${rn}-${i}`, rn));
      allGames.push(...games);
    }
    regionalChamps.push(games[0].winner); // Elite Eight winner
  }

  // Final Four: region 0 vs region 1, region 2 vs region 3 (data file order).
  const ff1 = decideGame(regionalChamps[0], regionalChamps[1], effectiveAnswers, `${data.id}|FF-0`, "Final Four");
  const ff2 = decideGame(regionalChamps[2], regionalChamps[3], effectiveAnswers, `${data.id}|FF-1`, "Final Four");
  allGames.push(ff1, ff2);
  const final = decideGame(ff1.winner, ff2.winner, effectiveAnswers, `${data.id}|FINAL`, "Championship");
  allGames.push(final);

  return {
    dataId: data.id,
    dataLabel: data.label,
    isTestData: !!data.isTestData,
    tournament: data.tournament,
    // answers.championPick is the EFFECTIVE pick for this bracket
    // (null when the requested pick belongs to the other field).
    answers: effectiveAnswers,
    championPickRequested: pick.requested,
    championPickApplied: pick.effective,
    championPickNote: pick.note,
    games: allGames, // exactly 63
    champion: final.winner,
    finalFour: regionalChamps,
  };
}

// Build what the answers ask for: one bracket, or two when tournament="both".
// dataByTournament: { men: dataObj, women: dataObj }
// Champion picks are resolved per bracket inside buildBracket (see
// resolveChampionPick): a pick fires only in its own field, and the
// other bracket states that it was not applied. One case is refused
// outright instead of guessed: an UNSCOPED championPick whose id
// exists in BOTH fields cannot be assigned to either one honestly
// (per-tournament championPicks, or tournament-unique team ids,
// remove the ambiguity).
function buildFromAnswers(dataByTournament, answers) {
  validateAnswers(answers);
  // P3-N1 (Oct 29 2026): a missing data map - or, on the "both"
  // path, a map missing one field - must give the same clear,
  // intentional "No data file" Error the single-tournament path
  // gives, never a raw TypeError from reading a field off null.
  const map = dataByTournament && typeof dataByTournament === "object" ? dataByTournament : {};
  if (answers.tournament === "both") {
    if (!map.men) throw new Error(`No data file for tournament "men"`);
    if (!map.women) throw new Error(`No data file for tournament "women"`);
    const scoped = answers.championPicks && typeof answers.championPicks === "object" &&
      Object.prototype.hasOwnProperty.call(answers.championPicks, "men") &&
      Object.prototype.hasOwnProperty.call(answers.championPicks, "women");
    if (!scoped && answers.championPick &&
        teamIdSet(map.men).has(answers.championPick) &&
        teamIdSet(map.women).has(answers.championPick)) {
      throw new Error(
        `Champion pick "${answers.championPick}" matches a team in both the men's and women's fields, ` +
        `so which bracket it belongs to is unclear. Give one pick per tournament (championPicks) ` +
        `or use team ids that are unique across fields.`);
    }
    return [
      buildBracket(map.men, { ...answers, tournament: "men" }),
      buildBracket(map.women, { ...answers, tournament: "women" }),
    ];
  }
  const data = map[answers.tournament];
  if (!data) throw new Error(`No data file for tournament "${answers.tournament}"`);
  const bracket = buildBracket(data, answers);
  // Scoped-pick disclosure, single-tournament builds (semantic
  // audit Oct 30 2026; the honesty half of cold-walk Finding M1,
  // Oct 24 2026): the page always shows one champion dropdown per
  // field, so a visitor can set a pick for the OTHER field and
  // then ask for one bracket only. That pick used to vanish with
  // no word anywhere - 128 of 128 such paths were silent. The
  // question order and the dropdowns are unchanged (that shape is
  // Billy's D2/D4 call); what changes is only that the built
  // bracket now states, in its championPickNote (printed by the
  // page, the text render, the share summary, and the poster),
  // that the other field's pick was not applied and why. In a
  // "both" build each pick has its own bracket, so no note is
  // added there.
  if (answers.championPicks && typeof answers.championPicks === "object") {
    const other = answers.tournament === "men" ? "women" : "men";
    if (Object.prototype.hasOwnProperty.call(answers.championPicks, other)) {
      const otherPick = answers.championPicks[other];
      if (typeof otherPick === "string" && otherPick) {
        const possessive = (t) => (t === "men" ? "men's" : "women's");
        const note =
          `Champion pick "${otherPick}" was not applied: that pick is for the ${possessive(other)} field, ` +
          `and only the ${possessive(answers.tournament)} bracket was built.`;
        bracket.championPickNote = bracket.championPickNote
          ? `${bracket.championPickNote} ${note}`
          : note;
      }
    }
  }
  return [bracket];
}

// Build a short shareable summary of one completed bracket.
// Pure logic, same pattern as renderText below: no DOM, no network,
// no storage. The summary names only what the bracket object holds:
// the champion, the Final Four, and the final picks (the two Final
// Four games plus the Championship game), each with its reason.
// It is built only from a finished bracket, so it can only appear
// after a bracket is complete.
// Text/share rendering (P3-N2 hardening, Oct 29 2026): every value
// interpolated into a plain-text line passes through
// sanitizeInlineText, so a line break carried in a name, label,
// note, or reason can never split a line and forge a stand-alone
// line in the copied/shared output - even for a bracket object
// assembled outside buildBracket (which now rejects such data at
// validation anyway).
function buildShareSummary(bracket) {
  const lines = [];
  // SPEC-FMB-SHARE1108-01 (Nov 8, 2026): a result share leads with the
  // outcome in plain words - the champion first - never the site pitch.
  lines.push(`My mock bracket: ${sanitizeInlineText(bracket.champion.name)} wins it all.`);
  lines.push(`My bracket - ${sanitizeInlineText(bracket.dataLabel)}`);
  if (bracket.isTestData) lines.push("TEST DATA - not the real tournament field.");
  if (bracket.championPickNote) lines.push(sanitizeInlineText(bracket.championPickNote));
  lines.push(`Champion: ${sanitizeInlineText(bracket.champion.name)} (seed ${bracket.champion.seed})`);
  lines.push(`Final Four: ${bracket.finalFour.map((t) => `${sanitizeInlineText(t.name)} (seed ${t.seed})`).join(", ")}`);
  lines.push("", "Final picks:");
  for (const g of bracket.games) {
    if (g.round !== "Final Four" && g.round !== "Championship") continue;
    const loser = g.winner.id === g.a.id ? g.b : g.a;
    lines.push(`  ${g.round}: ${sanitizeInlineText(g.winner.name)} (seed ${g.winner.seed}) over ${sanitizeInlineText(loser.name)} - ${sanitizeInlineText(g.reason)}`);
  }
  lines.push("", "Make yours: https://fillmybracket.com/mock-bracket?via=share");
  return lines.join("\n");
}

// Render one bracket as plain text (copy-into-a-pool format from the spec).
function renderText(bracket) {
  const lines = [];
  lines.push(`Fill My Bracket - ${sanitizeInlineText(bracket.dataLabel)}`);
  if (bracket.isTestData) lines.push("TEST DATA - not the real tournament field.");
  if (bracket.championPickNote) lines.push(sanitizeInlineText(bracket.championPickNote));
  let lastRound = "";
  for (const g of bracket.games) {
    if (g.round !== lastRound) { lines.push("", g.round + ":"); lastRound = g.round; }
    lines.push(`  ${sanitizeInlineText(g.winner.name)} (seed ${g.winner.seed}) over ${sanitizeInlineText(g.winner.id === g.a.id ? g.b.name : g.a.name)} - ${sanitizeInlineText(g.reason)}`);
  }
  lines.push("", `Champion: ${sanitizeInlineText(bracket.champion.name)} (seed ${bracket.champion.seed})`);
  lines.push(`Final Four: ${bracket.finalFour.map((t) => `${sanitizeInlineText(t.name)} (seed ${t.seed})`).join(", ")}`);
  lines.push("", "Filled with Fill My Bracket: https://fillmybracket.com/?via=share");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Post-fill pick editing (added Oct 30, 2026; prototype only).
//
// After the engine fills a bracket, the user can change any single
// game's pick. The rules, stated plainly:
//   - An edit picks the OTHER team in that game. A team that is not
//     playing in a game can never be picked for it, so an edit can
//     never create an impossible matchup.
//   - Later games are then walked in order. A later game whose two
//     teams did not change is left exactly as it was - an edit never
//     silently overwrites a pick it did not have to touch.
//   - If a later game's teams did change: a winner that can still
//     win (it is still one of the two teams, including a winner set
//     by an earlier manual edit) is KEPT. Only a winner that is no
//     longer in the game - its team was knocked out by the edit -
//     is replaced, by re-running the engine's own game math on the
//     two teams now playing. Every such replacement is listed in
//     the returned bracket's lastEdit.repairedGames; nothing is
//     changed quietly.
//   - A manual edit beats the fill answers for that one game. If
//     the edit knocks out the champion pick, the pick stops being
//     champion and lastEdit.championPickOverridden says so.
//   - The input bracket is never mutated. A new bracket comes back.
// Game layout (the order buildBracket pushes games): each region
// takes 15 slots - Round of 64 x8, Round of 32 x4, Sweet 16 x2,
// Elite Eight x1 - then Final Four x2 (slots 60, 61) and the
// Championship (slot 62). A game's feeders always sit at lower
// slots than the game itself, so one forward walk repairs all.
function gameFeeders(index) {
  if (!Number.isInteger(index) || index < 0 || index > 62) return null;
  if (index < 60) {
    const base = Math.floor(index / 15) * 15;
    const within = index - base;
    if (within < 8) return null; // Round of 64: teams come from the data file.
    if (within < 12) { const i = within - 8; return [base + 2 * i, base + 2 * i + 1]; }
    if (within < 14) { const i = within - 12; return [base + 8 + 2 * i, base + 8 + 2 * i + 1]; }
    return [base + 12, base + 13]; // Elite Eight
  }
  if (index === 60) return [14, 29]; // Final Four: region 1 vs region 2 champs
  if (index === 61) return [44, 59]; // Final Four: region 3 vs region 4 champs
  return [60, 61]; // Championship
}

// The reason line for a game whose winner is already chosen.
// A game the user set by hand says so: "your edit". Otherwise the
// causal standard (SPEC-FMB-REASON-CAUSAL-1) decides, so a kept
// game never carries a reason that describes a different game:
// when this game's own math is available (gameKey + the two teams
// now playing, in game order) and it produces this same winner,
// causalReason names only a rule that counterfactually decided
// the game. A kept winner the math would not have produced (a
// hand pick kept through an edit) gets a plain label naming no
// rule, never a rule claim the game cannot back up.
function reasonForWinner(winner, loser, answers, manual, gameKey, teamA, teamB) {
  if (manual) return "your edit";
  if (answers.championPick && winner.id === answers.championPick) {
    return "your pick to win it all";
  }
  if (gameKey && teamA && teamB) {
    const ex = explainGame(teamA, teamB, answers, gameKey);
    if (!ex.forced && ex.winner.id === winner.id) {
      return causalReason(winner, loser, answers, ex, teamA, teamB);
    }
    if (ex.forced && winner.id === answers.championPick) {
      return "your pick to win it all";
    }
  }
  return winner.seed < loser.seed ? "favorite holds" : "close game";
}

// Coherence check for a finished bracket (filled or edited). Returns
// a list of problems; an empty list means the bracket is valid. It
// never throws, whatever shape it is handed - the same contract as
// validateData. Checks: exactly 63 games; every winner is one of
// the game's two teams; every game after the Round of 64 is played
// by the winners of its two feeder games (no impossible matchups);
// the Final Four list is the four Elite Eight winners; the champion
// is the Championship winner.
function validateBracket(bracket) {
  const errors = [];
  if (!bracket || typeof bracket !== "object" || !Array.isArray(bracket.games)) {
    return ["bracket must be an object with a games array"];
  }
  const games = bracket.games;
  if (games.length !== 63) errors.push(`expected 63 games, got ${games.length}`);
  const n = Math.min(games.length, 63);
  for (let i = 0; i < n; i++) {
    const g = games[i];
    if (!g || !g.a || !g.b || !g.winner || typeof g.a.id !== "string" ||
        typeof g.b.id !== "string" || typeof g.winner.id !== "string") {
      errors.push(`game ${i}: game, teams, or winner missing or malformed`);
      continue;
    }
    if (g.winner.id !== g.a.id && g.winner.id !== g.b.id) {
      errors.push(`game ${i} (${g.round}): winner ${g.winner.id} is not one of the two teams playing`);
    }
    const feeders = gameFeeders(i);
    if (feeders) {
      const [f1, f2] = feeders;
      if (games[f1] && games[f1].winner && games[f2] && games[f2].winner) {
        const want = [games[f1].winner.id, games[f2].winner.id].sort();
        const got = [g.a.id, g.b.id].sort();
        if (want[0] !== got[0] || want[1] !== got[1]) {
          errors.push(`game ${i} (${g.round}): teams ${got.join(", ")} did not win the games that feed this one (expected ${want.join(", ")})`);
        }
      }
    }
  }
  if (games.length === 63) {
    const ffWant = [14, 29, 44, 59].map((i) => games[i] && games[i].winner && games[i].winner.id);
    if (!Array.isArray(bracket.finalFour) || bracket.finalFour.length !== 4 ||
        bracket.finalFour.some((t, k) => !t || t.id !== ffWant[k])) {
      errors.push("finalFour must be the four Elite Eight winners, in region order");
    }
    if (!bracket.champion || !games[62].winner || bracket.champion.id !== games[62].winner.id) {
      errors.push("champion must be the Championship game winner");
    }
  }
  return errors;
}

// Change one game's pick in a finished bracket. Returns a NEW
// bracket; the input is left untouched. Throws a clear Error (and
// changes nothing) when the game slot is not a whole number from
// 0 to 62, when the new winner is not one of the game's two teams,
// or when the bracket handed in is already incoherent.
function applyPickEdit(bracket, gameIndex, winnerId) {
  if (!Number.isInteger(gameIndex) || gameIndex < 0 || gameIndex > 62) {
    throw new Error(`Cannot edit game ${describeValue(gameIndex)}: give a game number from 0 to 62.`);
  }
  if (typeof winnerId !== "string" || !winnerId) {
    throw new Error(`Cannot edit game ${gameIndex}: the new winner must be a team id (a string); got ${describeValue(winnerId)}.`);
  }
  const before = validateBracket(bracket);
  if (before.length) {
    throw new Error(`Cannot edit an invalid bracket: ${before[0]}${before.length > 1 ? ` (and ${before.length - 1} more)` : ""}`);
  }
  const target = bracket.games[gameIndex];
  if (winnerId !== target.a.id && winnerId !== target.b.id) {
    throw new Error(
      `Cannot make ${winnerId} the winner of game ${gameIndex} (${target.round}): ` +
      `that game is ${target.a.id} vs ${target.b.id}, and only one of those two teams can win it.`);
  }
  const answers = bracket.answers || {};
  const fromWinner = target.winner;
  const edits = [...(Array.isArray(bracket.manualEdits) ? bracket.manualEdits : [])];
  const priorEditAt = edits.findIndex((e) => e && e.gameIndex === gameIndex);
  if (winnerId === fromWinner.id) {
    // Picking the team that already won changes nothing. Say so
    // plainly instead of pretending an edit happened.
    const noopBracket = { ...bracket, games: bracket.games.map((g) => ({ ...g })) };
    noopBracket.lastEdit = {
      gameIndex, gameKey: target.gameKey, round: target.round,
      fromWinnerId: fromWinner.id, fromWinnerName: fromWinner.name,
      toWinnerId: winnerId, toWinnerName: fromWinner.name,
      noop: true, changedGames: [], repairedGames: [], keptGames: [],
      invalidatedEdits: [], championPickOverridden: false,
    };
    return noopBracket;
  }
  const toWinner = winnerId === target.a.id ? target.a : target.b;
  const toLoser = winnerId === target.a.id ? target.b : target.a;
  if (priorEditAt >= 0) edits.splice(priorEditAt, 1);
  edits.push({ gameIndex, gameKey: target.gameKey, winnerId });

  const games = bracket.games.map((g) => ({ ...g }));
  games[gameIndex] = {
    ...games[gameIndex], winner: toWinner,
    reason: reasonForWinner(toWinner, toLoser, answers, true),
  };
  const changedGames = [gameIndex];
  const repairedGames = [];
  const keptGames = [];
  const invalidatedEdits = [];

  for (let i = gameIndex + 1; i < 63; i++) {
    const feeders = gameFeeders(i);
    if (!feeders) continue;
    const newA = games[feeders[0]].winner;
    const newB = games[feeders[1]].winner;
    const g = games[i];
    if (g.a.id === newA.id && g.b.id === newB.id) continue; // teams unchanged: leave the game exactly as it was
    const oldWinner = g.winner;
    const manual = edits.find((e) => e && e.gameIndex === i);
    let winner;
    let manualKept = false;
    if (manual && (manual.winnerId === newA.id || manual.winnerId === newB.id)) {
      winner = manual.winnerId === newA.id ? newA : newB;
      manualKept = true;
    } else {
      if (manual) invalidatedEdits.push({ gameIndex: i, gameKey: g.gameKey, winnerId: manual.winnerId });
      winner = (oldWinner.id === newA.id || oldWinner.id === newB.id) ? oldWinner : null;
    }
    if (winner) {
      const loser = winner.id === newA.id ? newB : newA;
      games[i] = { ...g, a: newA, b: newB, winner,
        reason: reasonForWinner(winner, loser, answers, manualKept, g.gameKey, newA, newB) };
      keptGames.push(i);
    } else {
      const decided = decideGame(newA, newB, answers, g.gameKey, g.round);
      games[i] = decided;
      repairedGames.push(i);
    }
    changedGames.push(i);
  }
  // Drop manual edits that this edit knocked out, so the bracket
  // never claims a hand pick it no longer holds.
  const deadKeys = new Set(invalidatedEdits.map((e) => e.gameKey));
  const liveEdits = edits.filter((e) => !deadKeys.has(e.gameKey));
  const champion = games[62].winner;
  const out = {
    ...bracket,
    games,
    champion,
    finalFour: [14, 29, 44, 59].map((i) => games[i].winner),
    manualEdits: liveEdits,
  };
  out.lastEdit = {
    gameIndex, gameKey: target.gameKey, round: target.round,
    fromWinnerId: fromWinner.id, fromWinnerName: fromWinner.name,
    toWinnerId: toWinner.id, toWinnerName: toWinner.name,
    noop: false, changedGames, repairedGames, keptGames,
    invalidatedEdits,
    // True only when this edit took the crown off the champion
    // pick: before the edit the pick was champion, now it is not.
    championPickOverridden: !!(bracket.championPickApplied && bracket.champion &&
      bracket.champion.id === bracket.championPickApplied &&
      champion.id !== bracket.championPickApplied),
  };
  const after = validateBracket(out);
  if (after.length) throw new Error(`Edit produced an invalid bracket: ${after.join("; ")}`);
  return out;
}

// Apply several edits in order; each one sees the bracket the
// previous edit left. Same rules as applyPickEdit throughout.
function applyPickEdits(bracket, edits) {
  if (!Array.isArray(edits)) {
    throw new Error(`Edits must be an array of { gameIndex, winnerId }; got ${describeValue(edits)}.`);
  }
  let current = bracket;
  for (const e of edits) {
    if (!e || typeof e !== "object") {
      throw new Error(`Each edit must be an object with gameIndex and winnerId; got ${describeValue(e)}.`);
    }
    current = applyPickEdit(current, e.gameIndex, e.winnerId);
  }
  return current;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildBracket, buildFromAnswers, renderText, buildShareSummary, validateData, validateAnswers, explainGame, R64_ORDER, applyPickEdit, applyPickEdits, validateBracket, gameFeeders };
}
