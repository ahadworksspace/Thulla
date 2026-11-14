// Bhabhi Thulla (aka Getaway) — PURE game engine.
// No DOM, no network, no randomness source of its own (rng can be injected).
// Works in the browser (window.ThullaEngine) and in Node (module.exports).
//
// Rules implemented (see README.md for the full text):
//  - Standard 52-card deck, no jokers, Ace high, no trumps, clockwise play.
//  - All 52 cards are dealt (3 players: 18/17/17; 4 players: 13 each).
//  - The Ace of Spades holder MUST lead the first trick with the A of Spades.
//    In the first trick a Thulla does NOT stop the trick; all cards go to waste
//    and the A of Spades holder leads the second trick.
//  - Later tricks: follow the led suit if you can; otherwise any card is a
//    Thulla and ends the trick immediately.
//  - Clean trick: cards discarded, highest card of the led suit leads next.
//  - Thulla trick: the player with the highest card of the LED suit picks up
//    every card played in the trick and leads next.
//  - A player who has no cards left after a trick resolves is out and safe,
//    EXCEPT the house rule: if the player who would lead next is out, the lead
//    passes to the next active player clockwise.
//  - The last player still holding cards is the Bhabhi. If every remaining
//    player empties their hand on the same trick, the leader of that trick
//    is the Bhabhi (tiebreak).
(function (root) {
  'use strict';

  var SUITS = ['S', 'H', 'D', 'C'];
  var SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
  var SUIT_NAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
  var RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

  function rankLabel(rank) { return RANK_LABEL[rank] || String(rank); }
  function cardId(rank, suit) { return rankLabel(rank) + suit; }
  function suitOf(card) { return card.slice(-1); }
  function rankOf(card) {
    var r = card.slice(0, -1);
    if (r === 'A') return 14;
    if (r === 'K') return 13;
    if (r === 'Q') return 12;
    if (r === 'J') return 11;
    return parseInt(r, 10);
  }
  function isRed(card) { var s = suitOf(card); return s === 'H' || s === 'D'; }
  function displayCard(card) { return rankLabel(rankOf(card)) + SUIT_SYMBOL[suitOf(card)]; }

  function makeDeck() {
    var deck = [];
    for (var s = 0; s < SUITS.length; s++) {
      for (var r = 2; r <= 14; r++) deck.push(cardId(r, SUITS[s]));
    }
    return deck;
  }

  function shuffle(deck, rng) {
    rng = rng || Math.random;
    var d = deck.slice();
    for (var i = d.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = d[i]; d[i] = d[j]; d[j] = t;
    }
    return d;
  }

  // Deal all 52 cards round-robin: 3 players -> 18/17/17, 4 players -> 13 each.
  function dealHands(numPlayers, rng) {
    if (numPlayers !== 3 && numPlayers !== 4) throw new Error('Players must be 3 or 4');
    var deck = shuffle(makeDeck(), rng);
    var hands = [];
    for (var p = 0; p < numPlayers; p++) hands.push([]);
    for (var i = 0; i < deck.length; i++) hands[i % numPlayers].push(deck[i]);
    return hands;
  }

  function findAceOfSpades(hands) {
    for (var p = 0; p < hands.length; p++) {
      if (hands[p].indexOf('AS') !== -1) return p;
    }
    return -1;
  }

  // Active (not out) player indices, clockwise starting from `start`.
  function clockwiseFrom(state, start) {
    var n = state.numPlayers, out = [];
    for (var k = 0; k < n; k++) {
      var idx = (start + k) % n;
      if (!state.players[idx].out) out.push(idx);
    }
    return out;
  }

  function createGame(numPlayers, opts) {
    opts = opts || {};
    if (numPlayers !== 3 && numPlayers !== 4) throw new Error('Players must be 3 or 4');
    var hands = opts.hands || dealHands(numPlayers, opts.rng);
    var names = opts.names || hands.map(function (_, i) { return 'Player ' + (i + 1); });
    var bots = opts.bots || [];
    var asHolder = findAceOfSpades(hands);
    var leader = (typeof opts.trickLeader === 'number') ? opts.trickLeader : asHolder;
    if (leader < 0) throw new Error('No Ace of Spades in any hand');

    var players = hands.map(function (hand, i) {
      return {
        name: names[i] || ('Player ' + (i + 1)),
        hand: hand.slice(),
        out: false,
        isBot: !!bots[i],
        disconnected: false
      };
    });

    var state = {
      numPlayers: numPlayers,
      players: players,
      trick: [],               // [{player, card}] in play order
      trickPlayers: [],        // active players expected to play this trick
      trickLeader: leader,
      turn: leader,
      phase: 'playing',        // 'playing' | 'over'
      isFirstTrick: (typeof opts.isFirstTrick === 'boolean') ? opts.isFirstTrick : true,
      waste: [],
      safeOrder: [],           // player indices in the order they got away
      bhabhi: null,            // player index, set when the round ends
      log: [],
      lastEvent: null,         // {type, player, card?, count?} for UI flashes
      lastResolution: null     // {type: 'first'|'clean'|'thulla', winner, pickedUp}
    };
    state.trickPlayers = clockwiseFrom(state, leader);
    state.log.push(players[leader].name + ' holds the Ace of Spades and leads the first trick.');
    return state;
  }

  // Legal cards for a player right now. Empty if it is not their turn, they
  // are out, or the game is over. This is what makes illegal play impossible
  // in the UI: only these cards are ever clickable.
  function legalMoves(state, playerIdx) {
    if (state.phase !== 'playing') return [];
    var p = state.players[playerIdx];
    if (!p || p.out || state.turn !== playerIdx) return [];
    if (state.trick.length === 0) {
      if (state.isFirstTrick) {
        return p.hand.indexOf('AS') !== -1 ? ['AS'] : [];
      }
      return p.hand.slice();
    }
    var ledSuit = suitOf(state.trick[0].card);
    var suited = p.hand.filter(function (c) { return suitOf(c) === ledSuit; });
    return suited.length > 0 ? suited : p.hand.slice();
  }

  // Play a card. Returns {ok, error?, trickOver, thulla}.
  function applyPlay(state, playerIdx, card) {
    if (state.phase !== 'playing') return { ok: false, error: 'Game is over' };
    if (state.turn !== playerIdx) return { ok: false, error: 'Not your turn' };
    var p = state.players[playerIdx];
    if (!p || p.out) return { ok: false, error: 'Player is out of the game' };
    if (legalMoves(state, playerIdx).indexOf(card) === -1) {
      return { ok: false, error: 'Illegal card: ' + card };
    }

    p.hand.splice(p.hand.indexOf(card), 1);

    var isThulla = state.trick.length > 0 &&
      suitOf(card) !== suitOf(state.trick[0].card) &&
      !state.isFirstTrick;
    state.trick.push({ player: playerIdx, card: card });

    var msg = p.name + ' played ' + displayCard(card);
    if (isThulla) msg += ' — Thulla!';
    state.log.push(msg);
    state.lastEvent = { type: isThulla ? 'thulla' : 'play', player: playerIdx, card: card };

    var trickOver;
    if (state.isFirstTrick) {
      // A Thulla does NOT stop the first trick: everyone plays.
      trickOver = state.trick.length >= state.trickPlayers.length;
    } else if (isThulla) {
      trickOver = true;
    } else {
      trickOver = state.trick.length >= state.trickPlayers.length;
    }

    if (!trickOver) {
      var pos = state.trickPlayers.indexOf(playerIdx);
      state.turn = state.trickPlayers[(pos + 1) % state.trickPlayers.length];
      return { ok: true, trickOver: false, thulla: isThulla };
    }

    resolveTrick(state);
    return { ok: true, trickOver: true, thulla: isThulla };
  }

  function resolveTrick(state) {
    var trick = state.trick;
    var leader = state.trickLeader;
    var ledSuit = suitOf(trick[0].card);
    var isFirst = state.isFirstTrick;
    var thulla = !isFirst && trick.some(function (t) { return suitOf(t.card) !== ledSuit; });

    // Highest card of the led suit wins the trick / picks up the pile.
    var best = trick[0];
    trick.forEach(function (t) {
      if (suitOf(t.card) === ledSuit && rankOf(t.card) > rankOf(best.card)) best = t;
    });
    var winner = best.player;
    var cards = trick.map(function (t) { return t.card; });
    var resolution;

    if (isFirst) {
      state.waste = state.waste.concat(cards);
      state.log.push('First trick: all ' + cards.length +
        ' cards go to the waste pile. ' + state.players[leader].name + ' leads again.');
      resolution = { type: 'first', winner: leader, pickedUp: 0 };
      state.lastEvent = { type: 'first-trick', player: leader, count: cards.length };
    } else if (thulla) {
      state.players[winner].hand = state.players[winner].hand.concat(cards);
      state.log.push(state.players[winner].name + ' had the highest ' +
        SUIT_NAME[ledSuit] + ' and picks up ' + cards.length + ' cards.');
      resolution = { type: 'thulla', winner: winner, pickedUp: cards.length };
      state.lastEvent = { type: 'thulla-pickup', player: winner, count: cards.length };
    } else {
      state.waste = state.waste.concat(cards);
      state.log.push(state.players[winner].name + ' won the trick with the highest ' +
        SUIT_NAME[ledSuit] + ' — cards discarded.');
      resolution = { type: 'clean', winner: winner, pickedUp: 0 };
      state.lastEvent = { type: 'clean-win', player: winner, count: cards.length };
    }
    state.lastResolution = resolution;

    // Anyone whose hand is now empty got away (clockwise from the leader,
    // so the safe order reads in play order).
    clockwiseFrom(state, leader).forEach(function (idx) {
      var pl = state.players[idx];
      if (!pl.out && pl.hand.length === 0) {
        pl.out = true;
        state.safeOrder.push(idx);
        state.log.push(pl.name + ' got away!');
      }
    });

    // Next leader: the trick winner, unless they are out (house rule) — then
    // the lead passes to the next active player clockwise.
    var nextLeader = resolution.winner;
    if (state.players[nextLeader].out) {
      for (var k = 1; k <= state.numPlayers; k++) {
        var cand = (nextLeader + k) % state.numPlayers;
        if (!state.players[cand].out) { nextLeader = cand; break; }
      }
    }

    var withCards = [];
    for (var i = 0; i < state.numPlayers; i++) {
      if (state.players[i].hand.length > 0) withCards.push(i);
    }

    state.trick = [];
    if (withCards.length === 0) {
      // Tiebreak: every remaining player emptied their hand on the same
      // trick — the player who LED that trick is the Bhabhi.
      var si = state.safeOrder.indexOf(leader);
      if (si !== -1) state.safeOrder.splice(si, 1);
      state.players[leader].out = false;
      state.bhabhi = leader;
      state.phase = 'over';
      state.log.push(state.players[leader].name +
        ' is the Bhabhi! (tiebreak: led the final trick)');
    } else if (withCards.length === 1) {
      state.bhabhi = withCards[0];
      state.phase = 'over';
      state.log.push(state.players[withCards[0]].name + ' is the Bhabhi!');
    } else {
      state.trickLeader = nextLeader;
      state.turn = nextLeader;
      state.trickPlayers = clockwiseFrom(state, nextLeader);
      state.isFirstTrick = false;
    }
  }

  var api = {
    SUITS: SUITS,
    SUIT_SYMBOL: SUIT_SYMBOL,
    SUIT_NAME: SUIT_NAME,
    cardId: cardId,
    suitOf: suitOf,
    rankOf: rankOf,
    isRed: isRed,
    displayCard: displayCard,
    makeDeck: makeDeck,
    shuffle: shuffle,
    dealHands: dealHands,
    findAceOfSpades: findAceOfSpades,
    createGame: createGame,
    legalMoves: legalMoves,
    applyPlay: applyPlay
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ThullaEngine = api;
  if (typeof global !== 'undefined') global.ThullaEngine = api;
})(typeof self !== 'undefined' ? self : this);
