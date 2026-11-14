// Bhabhi Thulla engine tests — run with plain:  node tests/engine.test.js
// No dependencies. Exit code 0 = all pass, 1 = any failure.
var E = require('../js/engine.js');
var Bots = require('../js/bots.js');

var passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('PASS  ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL  ' + name + ' — ' + e.message);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg) {
  if (a !== b) throw new Error((msg || 'not equal') + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
}
function assertArrEq(a, b, msg) {
  assertEq(JSON.stringify(a.slice().sort()), JSON.stringify(b.slice().sort()), msg);
}

// Deterministic RNG (mulberry32) so tests are repeatable.
function rng(seed) {
  var s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function playRandomGame(numPlayers, seed) {
  var g = E.createGame(numPlayers, { rng: rng(seed) });
  var moves = 0;
  while (g.phase === 'playing' && moves < 1000) {
    var legal = E.legalMoves(g, g.turn);
    assert(legal.length > 0, 'player ' + g.turn + ' has no legal move while game is playing');
    var card = legal[Math.floor(rng(seed + moves + 1)() * legal.length)];
    var res = E.applyPlay(g, g.turn, card);
    assert(res.ok, 'random legal move rejected: ' + (res.error || ''));
    moves++;
  }
  return g;
}

// (a) Deal: 52 cards total; 18/17/17 for 3 players, 13 each for 4.
test('(a) deal gives 52 cards, 18/17/17 for 3 players', function () {
  var g = E.createGame(3, { rng: rng(1) });
  var sizes = g.players.map(function (p) { return p.hand.length; });
  assertEq(sizes.join(','), '18,17,17', 'hand sizes');
  var all = g.players.reduce(function (acc, p) { return acc.concat(p.hand); }, []);
  assertEq(all.length, 52, 'total cards');
  assertEq(new Set(all).size, 52, 'all cards unique');
});
test('(a) deal gives 13 cards each for 4 players', function () {
  var g = E.createGame(4, { rng: rng(2) });
  var sizes = g.players.map(function (p) { return p.hand.length; });
  assertEq(sizes.join(','), '13,13,13,13', 'hand sizes');
});

// (b) First trick: A of Spades holder leads, and A of Spades is the forced lead.
test('(b) first trick is led by the Ace of Spades holder, forced to play AS', function () {
  var g = E.createGame(3, { rng: rng(3) });
  var holder = E.findAceOfSpades(g.players.map(function (p) { return p.hand; }));
  assertEq(g.trickLeader, holder, 'trick leader is the AS holder');
  assertEq(g.turn, holder, 'turn is the AS holder');
  assertArrEq(E.legalMoves(g, holder), ['AS'], 'only AS is legal for the leader');
  var other = g.players[holder].hand.filter(function (c) { return c !== 'AS'; })[0];
  var bad = E.applyPlay(g, holder, other);
  assert(!bad.ok, 'playing a non-AS card first must be rejected');
  var good = E.applyPlay(g, holder, 'AS');
  assert(good.ok, 'playing AS must be accepted');
  assertEq(g.trick.length, 1, 'trick has one card');
});

// First-trick special: a Thulla does NOT stop the first trick.
test('first trick: off-suit play does not stop the trick, all cards go to waste, AS holder leads again', function () {
  var g = E.createGame(4, {
    hands: [['AS', '2H'], ['3S', '4D'], ['5C', '6H'], ['7D', '8C']],
    names: ['A', 'B', 'C', 'D']
  });
  assert(E.applyPlay(g, 0, 'AS').ok, 'AS lead');
  assert(E.applyPlay(g, 1, '3S').ok, 'spade follows');
  var r = E.applyPlay(g, 2, '5C'); // off-suit in the first trick
  assert(r.ok, 'off-suit allowed in first trick');
  assert(!r.trickOver, 'first trick must NOT end on an off-suit play');
  assertEq(g.turn, 3, 'turn passes to the last player');
  var r2 = E.applyPlay(g, 3, '7D');
  assert(r2.ok && r2.trickOver, 'trick ends when everyone played');
  assertEq(g.waste.length, 4, 'all first-trick cards go to waste');
  assertEq(g.turn, 0, 'AS holder leads the second trick');
  assert(!g.isFirstTrick, 'no longer the first trick');
});

// (c) Follow-suit enforcement.
test('(c) a player holding the led suit may only play that suit', function () {
  var g = E.createGame(3, {
    hands: [['AS', '5H'], ['9H', '2C'], ['3H', '4D']],
    names: ['A', 'B', 'C'],
    isFirstTrick: false, trickLeader: 0
  });
  assert(E.applyPlay(g, 0, '5H').ok, 'lead 5H');
  assertArrEq(E.legalMoves(g, 1), ['9H'], 'player with hearts may only play hearts');
  var bad = E.applyPlay(g, 1, '2C');
  assert(!bad.ok, 'off-suit play while holding the led suit must be rejected');
  assert(E.applyPlay(g, 1, '9H').ok, '9H follows');
  assertArrEq(E.legalMoves(g, 2), ['3H'], 'next player with hearts may only play hearts');
});
test('(c) a player void in the led suit may play any card', function () {
  var g = E.createGame(3, {
    hands: [['AS', '5H'], ['2C', '7S'], ['9D', '3C']],
    names: ['A', 'B', 'C'],
    isFirstTrick: false, trickLeader: 0
  });
  assert(E.applyPlay(g, 0, '5H').ok, 'lead 5H');
  assertArrEq(E.legalMoves(g, 1), ['2C', '7S'], 'void player may play anything');
});

// (d) Thulla ends the trick and the highest led-suit card picks up the pile.
test('(d) Thulla ends the trick immediately; highest led-suit card picks up the pile', function () {
  var g = E.createGame(3, {
    hands: [['5H', '2D'], ['2C', '7S'], ['9D', '3C']],
    names: ['A', 'B', 'C'],
    isFirstTrick: false, trickLeader: 0
  });
  assert(E.applyPlay(g, 0, '5H').ok, 'lead 5H');
  var r = E.applyPlay(g, 1, '2C'); // Thulla
  assert(r.ok && r.trickOver, 'Thulla must end the trick at once');
  assertEq(g.trick.length, 0, 'trick cleared after resolution');
  assertEq(g.players[2].hand.length, 2, 'player after the Thulla player never plays');
  assertEq(g.players[0].hand.length, 3, 'highest led-suit card picks up the pile (2D + 5H + 2C)');
  assert(g.players[0].hand.indexOf('5H') !== -1, 'picked up cards include the led card');
  assertEq(g.turn, 0, 'pile picker leads the next trick');
  assertEq(g.lastResolution.type, 'thulla', 'resolution recorded as thulla');
});

// (e) Clean trick discards and the highest led-suit card leads next.
test('(e) clean trick discards to waste; highest led-suit card leads next', function () {
  var g = E.createGame(3, {
    hands: [['AS', '5H', '2D'], ['9H', '3C'], ['3H', '4D']],
    names: ['A', 'B', 'C'],
    isFirstTrick: false, trickLeader: 0
  });
  assert(E.applyPlay(g, 0, '5H').ok, 'lead 5H');
  assert(E.applyPlay(g, 1, '9H').ok, '9H follows');
  var r = E.applyPlay(g, 2, '3H');
  assert(r.ok && r.trickOver, 'trick ends');
  assertEq(g.waste.length, 3, 'clean trick cards go to waste');
  assertEq(g.turn, 1, 'highest led-suit card (9H) leads next');
  assertEq(g.lastResolution.type, 'clean', 'resolution recorded as clean');
});

// (f) A player emptying their hand is marked safe/out.
test('(f) playing your last card marks you safe/out', function () {
  var g = E.createGame(3, {
    hands: [['KH', '2D'], ['QH'], ['AH', '3C']],
    names: ['A', 'B', 'C'],
    isFirstTrick: false, trickLeader: 0
  });
  assert(E.applyPlay(g, 0, 'KH').ok, 'lead KH');
  assert(E.applyPlay(g, 1, 'QH').ok, 'B plays last card');
  var r = E.applyPlay(g, 2, 'AH');
  assert(r.ok && r.trickOver, 'trick ends');
  assert(g.players[1].out, 'B is out after playing last card');
  assert(g.safeOrder.indexOf(1) !== -1, 'B recorded in the safe order');
  assertEq(g.turn, 2, 'highest led-suit card (AH) leads next');
  assertEq(g.phase, 'playing', 'game continues with 2 players left');
});

// House rule: last card is the highest of a clean trick — player is still out,
// lead passes to the next active player.
test('house rule: last card wins a clean trick — player is safe, lead passes on', function () {
  var g = E.createGame(3, {
    hands: [['AH'], ['2H', '3C'], ['4H', '5D']],
    names: ['A', 'B', 'C'],
    isFirstTrick: false, trickLeader: 0
  });
  var r = E.applyPlay(g, 0, 'AH'); // A plays last card, highest of led suit
  assert(r.ok, 'lead AH');
  assert(E.applyPlay(g, 1, '2H').ok, 'B follows');
  assert(E.applyPlay(g, 2, '4H').ok, 'C follows');
  assert(g.players[0].out, 'A is out and safe');
  assertEq(g.turn, 1, 'lead passes to the next active player');
});

// (g) Full random games end with exactly one Bhabhi.
test('(g) random full games end with exactly one Bhabhi and everyone else safe', function () {
  for (var seed = 10; seed < 20; seed++) {
    var g = playRandomGame(3, seed);
    assertEq(g.phase, 'over', 'game over (3p, seed ' + seed + ')');
    assert(g.bhabhi !== null, 'a Bhabhi is set (3p, seed ' + seed + ')');
    var withCards = g.players.filter(function (p) { return p.hand.length > 0; });
    assertEq(withCards.length, 1, 'exactly one player holds cards (3p, seed ' + seed + ')');
    assertEq(withCards[0], g.players[g.bhabhi], 'the card holder is the Bhabhi');
    assertEq(g.safeOrder.length, g.numPlayers - 1, 'everyone else got away');
  }
  for (var s2 = 20; s2 < 30; s2++) {
    var g4 = playRandomGame(4, s2);
    assertEq(g4.phase, 'over', 'game over (4p, seed ' + s2 + ')');
    assert(g4.bhabhi !== null, 'a Bhabhi is set (4p, seed ' + s2 + ')');
    var withCards4 = g4.players.filter(function (p) { return p.hand.length > 0; });
    assertEq(withCards4.length, 1, 'exactly one player holds cards (4p, seed ' + s2 + ')');
  }
});

// (h) Tiebreak: all remaining players empty hands on the same trick —
// the leader of that trick is the Bhabhi.
test('(h) tiebreak: leader of the final trick is the Bhabhi when everyone empties', function () {
  var g = E.createGame(3, {
    hands: [['5H'], ['7H'], []],
    names: ['A', 'B', 'C'],
    isFirstTrick: false, trickLeader: 0
  });
  g.players[2].out = true; // C already got away earlier
  g.trickPlayers = [0, 1]; // only the two remaining players play this trick
  assert(E.applyPlay(g, 0, '5H').ok, 'A leads last card');
  var r = E.applyPlay(g, 1, '7H'); // B plays last card too
  assert(r.ok && r.trickOver, 'trick ends');
  assertEq(g.phase, 'over', 'game is over');
  assertEq(g.bhabhi, 0, 'the trick leader (A) is the Bhabhi');
  assert(g.safeOrder.indexOf(0) === -1, 'the Bhabhi is not listed as safe');
  assert(g.safeOrder.indexOf(1) !== -1, 'B got away');
});

// (i) Bot always returns a legal move over 200 random simulated states.
test('(i) bot always returns a legal move over 200 random states', function () {
  for (var i = 0; i < 200; i++) {
    var n = (i % 2 === 0) ? 3 : 4;
    var g = E.createGame(n, { rng: rng(1000 + i) });
    // Play a random number of legal moves to reach a mid-game state.
    var steps = Math.floor(rng(2000 + i)() * 12);
    for (var k = 0; k < steps && g.phase === 'playing'; k++) {
      var legal = E.legalMoves(g, g.turn);
      if (!legal.length) break;
      var card = legal[Math.floor(rng(3000 + i * 10 + k)() * legal.length)];
      E.applyPlay(g, g.turn, card);
    }
    if (g.phase !== 'playing') continue;
    var move = Bots.chooseBotMove(E, g, g.turn);
    var legalNow = E.legalMoves(g, g.turn);
    assert(move !== null, 'bot must return a move when legal moves exist (state ' + i + ')');
    assert(legalNow.indexOf(move) !== -1,
      'bot move ' + move + ' is not legal (state ' + i + ', legal: ' + legalNow.join(',') + ')');
  }
});

// Extra: illegal plays are rejected (out-of-turn, wrong player, unknown card).
test('illegal plays are rejected', function () {
  var g = E.createGame(3, { rng: rng(99) });
  var holder = g.trickLeader;
  var other = (holder + 1) % 3;
  var r1 = E.applyPlay(g, other, g.players[other].hand[0]);
  assert(!r1.ok, 'out-of-turn play rejected');
  var r2 = E.applyPlay(g, holder, 'ZZ');
  assert(!r2.ok, 'unknown card rejected');
  var r3 = E.applyPlay(g, holder, g.players[holder].hand[0] === 'AS' ? '2C' : g.players[holder].hand[0]);
  assert(!r3.ok || g.players[holder].hand[0] === 'AS', 'non-AS first lead rejected');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed.');
process.exit(failed ? 1 : 0);
