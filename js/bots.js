// Bot strategy for Bhabhi Thulla (Mode A and disconnected seats in Mode B).
// A trained-style brain: heuristics plus in-game memory of which suits each
// opponent has shown void in. The bot only ever picks from
// engine.legalMoves(), so illegal play is impossible by construction.
//
// The old bot was exactly backwards on Thulla: it shed its LOWEST card and
// kept dangerous high cards, which then won tricks and forced it to pick up
// piles — Thulla upon Thulla. The smart bot does the opposite:
//   - Leading: lowest card of the longest suit; with 2 or fewer cards left,
//     lead the HIGHEST card (dump a dangerous card; winning the lead with
//     your last card is safe under the power house rule). A singleton Ace
//     is led to dump it. Suits an active opponent is known void in are
//     avoided when another suit is available.
//   - Following suit: duck when possible — lowest card of the led suit that
//     stays BELOW the current highest card of the led suit, so it sheds
//     without becoming the pickup target if someone Thullas later. When it
//     must win, it plays the cheapest card that wins (never wastes an Ace
//     when a lower card wins).
//   - Forced to Thulla (void in the led suit): play the HIGHEST card
//     overall — the Thulla card goes into the pile someone else picks up,
//     so this dumps a dangerous high card for free. Tie-break: prefer the
//     highest card of the suit it holds fewest of, to work toward voiding
//     a suit.
//   - Memory: every off-suit play reveals the player has no card of the led
//     suit (a Thulla in later tricks; the same void in the first trick,
//     where off-suit play is allowed). The bot re-derives this from the
//     game's log on every move, so a fresh game (fresh log) resets the
//     memory automatically. resetBotMemory() is also exported for an
//     explicit reset (e.g. when a new game starts).
(function (root) {
  'use strict';

  var SUIT_ORDER = { S: 0, H: 1, D: 2, C: 3 };
  var SYMBOL_TO_SUIT = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' };

  // Module-level memory: playerIdx -> { suitLetter: true } for suits that
  // player has shown void in. Rebuilt from the game log on every move.
  var voidMemory = {};

  function resetBotMemory() { voidMemory = {}; }

  function byRank(engine, a, b) { return engine.rankOf(a) - engine.rankOf(b); }

  function groupBySuit(engine, cards) {
    var bySuit = {};
    cards.forEach(function (c) {
      var s = engine.suitOf(c);
      (bySuit[s] = bySuit[s] || []).push(c);
    });
    return bySuit;
  }

  // Rebuild void memory from the game's log. A play line looks like
  // "Name played 5♥" or "Name played 2♣ — Thulla!". The first play after a
  // trick resolution starts a new trick and sets the led suit; any later
  // play of a different suit in that trick reveals the player is void in
  // the led suit.
  function refreshVoidMemory(state) {
    voidMemory = {};
    if (!state || !state.log || !state.players) return;
    var nameToIdx = {};
    state.players.forEach(function (p, i) {
      (nameToIdx[p.name] = nameToIdx[p.name] || []).push(i);
    });
    var ledSuit = null;
    state.log.forEach(function (line) {
      if (/picks up \d+ cards\.|won the trick with the highest|^First trick:/.test(line)) {
        ledSuit = null; // trick resolved — the next play starts a new trick
        return;
      }
      var m = line.match(/^(.+) played (A|K|Q|J|10|[2-9])([♠♥♦♣])( — Thulla!)?$/);
      if (!m) return;
      var suit = SYMBOL_TO_SUIT[m[3]];
      if (!ledSuit) { ledSuit = suit; return; } // the lead sets the led suit
      if (suit !== ledSuit) {
        (nameToIdx[m[1]] || []).forEach(function (idx) {
          voidMemory[idx] = voidMemory[idx] || {};
          voidMemory[idx][ledSuit] = true;
        });
      }
    });
  }

  // Suits at least one still-active opponent is known void in.
  function knownVoidSuits(state, playerIdx) {
    var voids = {};
    state.players.forEach(function (p, i) {
      if (i === playerIdx || p.out) return;
      var known = voidMemory[i];
      if (!known) return;
      Object.keys(known).forEach(function (s) { voids[s] = true; });
    });
    return voids;
  }

  // Leading: pick a card from `legal` (the bot's whole hand when leading).
  function chooseLead(engine, state, playerIdx, legal) {
    var hand = state.players[playerIdx].hand;

    // 2 or fewer cards left: dump the most dangerous card.
    if (hand.length <= 2) {
      return legal.slice().sort(function (a, b) { return byRank(engine, b, a); })[0];
    }

    var bySuit = groupBySuit(engine, legal);
    var voidSuits = knownVoidSuits(state, playerIdx);

    // Singleton Ace in a suit nobody is known void in: dump it.
    var aces = [];
    Object.keys(bySuit).forEach(function (s) {
      if (bySuit[s].length === 1 && engine.rankOf(bySuit[s][0]) === 14 && !voidSuits[s]) {
        aces.push(bySuit[s][0]);
      }
    });
    if (aces.length) {
      aces.sort(function (a, b) {
        return SUIT_ORDER[engine.suitOf(a)] - SUIT_ORDER[engine.suitOf(b)];
      });
      return aces[0];
    }

    // Longest suit nobody is known void in; fall back to the longest suit.
    // Ties: lowest low card, then suit order (deterministic).
    function pickSuit(suits) {
      var best = null;
      suits.forEach(function (s) {
        var cards = bySuit[s].slice().sort(function (a, b) { return byRank(engine, a, b); });
        var cand = { suit: s, len: cards.length, low: cards[0], lowRank: engine.rankOf(cards[0]) };
        if (!best || cand.len > best.len ||
          (cand.len === best.len && cand.lowRank < best.lowRank) ||
          (cand.len === best.len && cand.lowRank === best.lowRank &&
            SUIT_ORDER[s] < SUIT_ORDER[best.suit])) {
          best = cand;
        }
      });
      return best;
    }
    var suits = Object.keys(bySuit);
    var safe = suits.filter(function (s) { return !voidSuits[s]; });
    return pickSuit(safe.length ? safe : suits).low;
  }

  // Following suit, or forced to Thulla.
  function chooseFollow(engine, state, playerIdx, legal) {
    var ledSuit = engine.suitOf(state.trick[0].card);
    var suited = legal.filter(function (c) { return engine.suitOf(c) === ledSuit; });
    if (suited.length) {
      var currentHigh = 0;
      state.trick.forEach(function (t) {
        if (engine.suitOf(t.card) === ledSuit) {
          currentHigh = Math.max(currentHigh, engine.rankOf(t.card));
        }
      });
      // Duck: lowest card that stays below the current highest. If every
      // card would win, the lowest of them is the cheapest winner.
      var ducks = suited.filter(function (c) { return engine.rankOf(c) < currentHigh; });
      var pool = ducks.length ? ducks : suited;
      pool.sort(function (a, b) { return byRank(engine, a, b); });
      return pool[0];
    }
    return chooseThulla(engine, state, playerIdx, legal);
  }

  // Void in the led suit: Thulla with the HIGHEST card overall — it goes
  // into the pile someone else picks up, so a dangerous high card is shed
  // for free. Tie-break: the suit held fewest of, then suit order.
  function chooseThulla(engine, state, playerIdx, legal) {
    var hand = state.players[playerIdx].hand;
    var counts = {};
    hand.forEach(function (c) {
      var s = engine.suitOf(c);
      counts[s] = (counts[s] || 0) + 1;
    });
    var sorted = legal.slice().sort(function (a, b) {
      var rd = engine.rankOf(b) - engine.rankOf(a);
      if (rd !== 0) return rd;
      var cd = counts[engine.suitOf(a)] - counts[engine.suitOf(b)];
      if (cd !== 0) return cd;
      return SUIT_ORDER[engine.suitOf(a)] - SUIT_ORDER[engine.suitOf(b)];
    });
    return sorted[0];
  }

  function chooseBotMove(engine, state, playerIdx) {
    refreshVoidMemory(state);
    var legal = engine.legalMoves(state, playerIdx);
    if (!legal.length) return null;
    if (legal.length === 1) return legal[0];
    if (state.trick.length === 0) return chooseLead(engine, state, playerIdx, legal);
    return chooseFollow(engine, state, playerIdx, legal);
  }

  var api = { chooseBotMove: chooseBotMove, resetBotMemory: resetBotMemory };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ThullaBots = api;
  if (typeof root !== 'undefined') root.ThullaBots = api;
})(typeof self !== 'undefined' ? self : this);
