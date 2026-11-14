// Bot strategy for Bhabhi Thulla (Mode A and disconnected seats in Mode B).
// Simple but always legal — the bot only ever picks from engine.legalMoves().
//   - Leading: play the lowest card of its longest suit.
//   - Following suit: play its lowest card of the led suit.
//   - Forced to Thulla (void in the led suit): play its lowest card overall.
//   - First trick: the only legal move is the Ace of Spades, so it plays it.
(function (root) {
  'use strict';

  function byRank(engine, a, b) { return engine.rankOf(a) - engine.rankOf(b); }

  function chooseBotMove(engine, state, playerIdx) {
    var legal = engine.legalMoves(state, playerIdx);
    if (!legal.length) return null;
    if (legal.length === 1) return legal[0];

    if (state.trick.length === 0) {
      // Leading: lowest card of the longest suit (among legal cards).
      var bySuit = {};
      legal.forEach(function (c) {
        var s = engine.suitOf(c);
        (bySuit[s] = bySuit[s] || []).push(c);
      });
      var bestSuit = null, bestLen = -1;
      Object.keys(bySuit).forEach(function (s) {
        if (bySuit[s].length > bestLen) { bestLen = bySuit[s].length; bestSuit = s; }
      });
      bySuit[bestSuit].sort(function (a, b) { return byRank(engine, a, b); });
      return bySuit[bestSuit][0];
    }

    var ledSuit = engine.suitOf(state.trick[0].card);
    var suited = legal.filter(function (c) { return engine.suitOf(c) === ledSuit; });
    if (suited.length) {
      suited.sort(function (a, b) { return byRank(engine, a, b); });
      return suited[0];
    }

    // Void in the led suit: Thulla with the lowest card overall.
    var all = legal.slice().sort(function (a, b) { return byRank(engine, a, b); });
    return all[0];
  }

  var api = { chooseBotMove: chooseBotMove };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ThullaBots = api;
  if (typeof root !== 'undefined') root.ThullaBots = api;
})(typeof self !== 'undefined' ? self : this);
