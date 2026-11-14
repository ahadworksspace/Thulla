// Bhabhi Thulla — UI flow and screens.
// Modes:
//   A) Play vs Bots (offline): you + 2 or 3 bots.
//   B) Play with Friends (online, no accounts): PeerJS rooms with a 6-digit
//      code. The host owns the engine and is authoritative; clients only ever
//      see their own hand plus public info.
(function () {
  'use strict';

  var E = window.ThullaEngine;
  var Cards = window.ThullaCards;
  var Bots = window.ThullaBots;
  var Net = window.ThullaNet;

  // ---------- small helpers ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text !== undefined && text !== null) d.textContent = text;
    return d;
  }
  function show(id) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
    $(id).classList.add('active');
    window.scrollTo(0, 0);
  }
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('show'); }, 3500);
  }

  // ---------- sounds (Web Audio, synthesized — no audio files) ----------
  var Sound = (function () {
    var ctx = null;
    function ac() {
      if (soundMuted) return null;
      try {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
      } catch (e) { return null; }
    }
    function blip(freq0, freq1, dur, vol, type) {
      var c = ac(); if (!c) return;
      try {
        var t = c.currentTime;
        var o = c.createOscillator(); var g = c.createGain();
        o.type = type || 'sine';
        o.frequency.setValueAtTime(freq0, t);
        if (freq1) o.frequency.exponentialRampToValueAtTime(freq1, t + dur);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g); g.connect(c.destination);
        o.start(t); o.stop(t + dur + 0.02);
      } catch (e) { /* ignore */ }
    }
    // Low slam + noise burst: the "THAK" of a Thulla hitting the table.
    function thud() {
      var c = ac(); if (!c) return;
      blip(130, 42, 0.22, 0.5, 'sine');
      try {
        var t = c.currentTime;
        var len = Math.floor(c.sampleRate * 0.09);
        var buf = c.createBuffer(1, len, c.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        var src = c.createBufferSource(); src.buffer = buf;
        var g = c.createGain();
        g.gain.setValueAtTime(0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        src.connect(g); g.connect(c.destination); src.start(t);
      } catch (e) { /* ignore */ }
    }
    function tick() { blip(880, null, 0.06, 0.12, 'triangle'); }
    function chime() {
      blip(660, null, 0.14, 0.16, 'sine');
      setTimeout(function () { blip(990, null, 0.2, 0.16, 'sine'); }, 110);
    }
    return { thud: thud, tick: tick, chime: chime };
  })();

  // ---------- session state ----------
  var myName = localStorage.getItem('thulla-name') || '';
  var mode = null;              // 'bots' | 'friends'
  var isHost = false;
  var game = null;              // engine state (bots mode, and host in friends mode)
  var viewState = null;         // friends client: masked state received from host
  var mySeat = 0;
  var numPlayers = 4;
  var roomCode = null;
  var peer = null;              // host peer or client peer wrapper
  var hostConn = null;          // client -> host connection
  var hostConns = {};           // host: peerId -> {conn, name, seat}
  var lobbyPlayers = [];        // {name, seat, isHost} — host view of the lobby
  var lobbyStarted = false;
  var bhabhiCounts = {};        // name -> times Bhabhi this session
  var botTimer = null;
  var lastFlashKey = '';
  var connected = false;
  var inGame = false;
  var soundMuted = false;
  try { soundMuted = localStorage.getItem('thulla-muted') === '1'; } catch (e) { soundMuted = false; }
  var pendingHandRect = null;   // {card, rect} of the human's just-clicked card
  var lastPlay = null;          // {player, card, thulla} of the most recent play
  var lastRenderedView = null;  // view used by the last completed table render
  var latestView = null;        // newest view (may be waiting out a trick pause)
  var renderTimer = null;       // pending deferred render after a trick resolves
  var dealPlayed = false;       // dealing animation already ran for this game
  var AVATAR_COLORS = ['#c0392b', '#2471a3', '#7d3c98', '#b9770e', '#117a65', '#6c3483'];

  var BOT_NAMES = ['Ravi', 'Simran', 'Aisha', 'Gurpreet', 'Meera', 'Arjun'];
  var MIN_PLAYERS = 3, MAX_PLAYERS = 4;

  // ---------- name ----------
  function getName() {
    var v = ($('name-input').value || '').trim();
    if (v) {
      myName = v;
      localStorage.setItem('thulla-name', v);
    }
    return myName || 'You';
  }

  // ---------- masked view ----------
  // Build what one player is allowed to see: their own hand, everyone else's
  // card counts, the public table, the log and the scoreboard.
  function buildView(state, forSeat) {
    return {
      numPlayers: state.numPlayers,
      players: state.players.map(function (p, i) {
        return {
          name: p.name,
          hand: i === forSeat ? p.hand.slice() : null,
          count: p.hand.length,
          out: p.out,
          isBot: !!p.isBot,
          disconnected: !!p.disconnected
        };
      }),
      trick: state.trick.map(function (t) { return { player: t.player, card: t.card }; }),
      trickLeader: state.trickLeader,
      turn: state.turn,
      phase: state.phase,
      isFirstTrick: state.isFirstTrick,
      wasteCount: state.waste.length,
      safeOrder: state.safeOrder.slice(),
      bhabhi: state.bhabhi,
      log: state.log.slice(-30),
      lastEvent: state.lastEvent,
      lastPlay: lastPlay ? { player: lastPlay.player, card: lastPlay.card, thulla: lastPlay.thulla } : null,
      bhabhiCounts: JSON.parse(JSON.stringify(bhabhiCounts))
    };
  }

  // A view is shaped so engine.legalMoves works on it for my own seat.
  function viewAsEngineState(view) {
    return {
      numPlayers: view.numPlayers,
      players: view.players.map(function (p) {
        return { name: p.name, hand: p.hand || [], out: p.out };
      }),
      trick: view.trick,
      trickLeader: view.trickLeader,
      turn: view.turn,
      phase: view.phase,
      isFirstTrick: view.isFirstTrick
    };
  }

  // ---------- bots mode ----------
  function startBotsGame(n) {
    numPlayers = n;
    mode = 'bots';
    isHost = false;
    var names = [getName()];
    for (var i = 1; i < n; i++) names.push(BOT_NAMES[i - 1]);
    game = E.createGame(n, {
      names: names,
      bots: names.map(function (_, i) { return i > 0; })
    });
    if (Bots.resetBotMemory) Bots.resetBotMemory();
    mySeat = 0;
    inGame = true;
    dealPlayed = false;
    lastRenderedView = null;
    show('screen-table');
    renderTable();
    advanceBots();
  }

  function advanceBots() {
    if (!game || game.phase !== 'playing') {
      if (game && game.phase === 'over') showResult();
      return;
    }
    var cur = game.turn;
    if (!game.players[cur].isBot) return; // human's turn — wait for a click
    clearTimeout(botTimer);
    botTimer = setTimeout(function () {
      if (!game || game.phase !== 'playing') return;
      var seat = game.turn;
      var card = Bots.chooseBotMove(E, game, seat);
      if (!card) return;
      var res = E.applyPlay(game, seat, card);
      if (!res.ok) return;
      lastPlay = { player: seat, card: card, thulla: res.thulla };
      if (mode === 'friends' && isHost) broadcastState();
      renderTable();
      afterMove();
    }, 1400 + Math.random() * 800);
  }

  function afterMove() {
    if (!game) return;
    if (game.phase === 'over') { showResult(); return; }
    advanceBots();
  }

  function onCardClick(card) {
    // Remember where the card was in the hand so it can fly to the table.
    var cardEl = document.querySelector('#my-hand .card[data-card="' + card + '"]');
    if (cardEl) pendingHandRect = { card: card, rect: cardEl.getBoundingClientRect() };
    if (mode === 'bots') {
      var res = E.applyPlay(game, mySeat, card);
      if (!res.ok) { pendingHandRect = null; toast(res.error || 'That card cannot be played now.'); return; }
      lastPlay = { player: mySeat, card: card, thulla: res.thulla };
      renderTable();
      afterMove();
    } else if (mode === 'friends') {
      if (isHost) {
        var r2 = E.applyPlay(game, mySeat, card);
        if (!r2.ok) { pendingHandRect = null; toast(r2.error || 'That card cannot be played now.'); return; }
        lastPlay = { player: mySeat, card: card, thulla: r2.thulla };
        broadcastState();
        renderTable();
        afterMove();
      } else if (hostConn && hostConn.open) {
        hostConn.send({ t: 'play', card: card });
      }
    }
  }

  // ---------- table rendering ----------
  // Seat positions around the table, clockwise from you (bottom):
  // 4 players: bottom, left, top, right. 3 players: bottom, top-left, top-right.
  var SEAT_CLASS_4 = ['seat-bottom', 'seat-left', 'seat-top', 'seat-right'];
  var SEAT_CLASS_3 = ['seat-bottom', 'seat-top-left', 'seat-top-right'];

  // Render the table. When a trick has just resolved, first show the
  // just-played card flying in (the engine already cleared the trick, so the
  // intermediate state is rebuilt from lastPlay), let it sit for a beat so
  // everyone can see it, then render the resolved state (flying the pile to
  // the player who picked it up, if any). Mid-trick plays render immediately
  // and cancel any pending hold.
  function renderTable() {
    var view = null;
    if (mode === 'bots' || isHost) {
      if (!game) return;
      view = buildView(game, mySeat);
    } else {
      view = viewState;
      if (!view) return;
    }
    latestView = view;
    var prev = lastRenderedView;
    var resolution = prev && prev.trick && prev.trick.length > 0 &&
      view.trick.length === 0 && view.phase === 'playing';
    if (resolution) {
      // Show the final card of the trick flying in before clearing it.
      var lp = view.lastPlay || lastPlay;
      var delay = 900;
      if (lp && prev.trick.filter(function (t) { return t.card === lp.card; }).length === 0) {
        var mid = cloneViewWithTrick(view, prev.trick.concat([{ player: lp.player, card: lp.card }]));
        mid.lastEvent = { type: lp.thulla ? 'thulla' : 'play', player: lp.player, card: lp.card };
        clearTimeout(renderTimer);
        renderTimer = null;
        renderTableView(mid);
        lastRenderedView = mid;
        delay = lp.thulla ? 1100 : 900;
      }
      clearTimeout(renderTimer);
      renderTimer = setTimeout(function () {
        renderTimer = null;
        if (latestView.lastEvent && latestView.lastEvent.type === 'thulla-pickup') {
          animatePileToSeat(latestView.lastEvent.player);
          flashThulla('PICK UP!', 'thulla-pickup|' + JSON.stringify(latestView.lastEvent));
        }
        renderTableView(latestView);
        lastRenderedView = latestView;
      }, delay);
      return;
    }
    clearTimeout(renderTimer);
    renderTimer = null;
    renderTableView(view);
    lastRenderedView = view;
  }

  // Shallow copy of a view with a different trick (for the intermediate
  // render of a just-resolved trick).
  function cloneViewWithTrick(view, trick) {
    var v = {};
    for (var k in view) v[k] = view[k];
    v.trick = trick;
    return v;
  }

  function renderTableView(view) {
    var n = view.numPlayers;
    var seatCls = n === 3 ? SEAT_CLASS_3 : SEAT_CLASS_4;
    var seatsBox = $('seats');
    seatsBox.className = 'seats players-' + n;
    seatsBox.innerHTML = '';

    for (var rel = 0; rel < n; rel++) {
      var idx = (mySeat + rel) % n;
      var p = view.players[idx];
      var seat = el('div', 'seat ' + seatCls[rel] + (view.turn === idx && view.phase === 'playing' ? ' turn' : ''));
      seat.dataset.player = idx;
      var av = el('div', 'avatar', (p.name || '?').charAt(0).toUpperCase());
      av.style.background = AVATAR_COLORS[idx % AVATAR_COLORS.length];
      seat.appendChild(av);
      var nameRow = el('div', 'seat-name', p.name + (idx === mySeat ? ' (You)' : ''));
      if (p.isBot) nameRow.appendChild(el('span', 'tag', ' BOT'));
      if (p.disconnected) nameRow.appendChild(el('span', 'tag warn', ' DISCONNECTED'));
      seat.appendChild(nameRow);

      if (rel === 0) {
        // My hand is rendered separately in the hand area.
        seat.appendChild(el('div', 'seat-count', p.count + (p.count === 1 ? ' card' : ' cards')));
      } else {
        seat.appendChild(Cards.createMiniBacks(p.count));
      }

      var status = '';
      if (view.phase === 'over') {
        if (view.bhabhi === idx) status = 'Bhabhi!';
        else if (p.out) status = 'Safe ✓';
      } else if (p.out) {
        status = 'Safe ✓';
      } else if (view.turn === idx) {
        status = p.isBot ? 'Thinking…' : 'Your turn';
      }
      if (status) seat.appendChild(el('div', 'seat-status' + (status === 'Bhabhi!' ? ' bhabhi' : ''), status));
      seatsBox.appendChild(seat);
    }

    // Trick pile in the centre — each card sits by the seat of the player
    // who played it. Newly played cards fly in from that player's seat.
    var prevTrick = lastRenderedView ? lastRenderedView.trick : [];
    var prevCards = {};
    prevTrick.forEach(function (t) { prevCards[t.card] = t.player; });
    var pile = $('trick-pile');
    pile.innerHTML = '';
    if (!view.trick.length) {
      pile.appendChild(el('div', 'trick-empty',
        view.isFirstTrick ? 'First trick: the Ace of Spades must be led.' : 'Waiting for the lead…'));
    } else {
      view.trick.forEach(function (t, i) {
        var rel = (t.player - mySeat + n) % n;
        var wrap = el('div', 'trick-card small ' + seatCls[rel]);
        wrap.dataset.card = t.card;
        wrap.style.setProperty('--rot', ((i - (view.trick.length - 1) / 2) * 6) + 'deg');
        wrap.appendChild(Cards.createCard(t.card, E, { small: true }));
        wrap.appendChild(el('div', 'trick-who', view.players[t.player].name));
        pile.appendChild(wrap);
        if (!prevCards[t.card]) {
          var isThulla = view.lastEvent && view.lastEvent.type === 'thulla' &&
            view.lastEvent.card === t.card && view.lastEvent.player === t.player;
          var fromRect = null;
          if (pendingHandRect && pendingHandRect.card === t.card) {
            fromRect = pendingHandRect.rect;
            pendingHandRect = null;
          } else {
            var sEl = seatElForPlayer(t.player);
            if (sEl) fromRect = sEl.getBoundingClientRect();
          }
          if (fromRect) flyCardToTrick(wrap, fromRect, isThulla);
          if (isThulla) { slamTable(); Sound.thud(); }
          else Sound.tick();
        }
      });
    }
    $('waste-count').textContent = 'Waste pile: ' + view.wasteCount + ' cards';

    // Dealing animation on a fresh deal (once per game).
    var dealtNow = false;
    if (!dealPlayed && view.phase === 'playing' && view.isFirstTrick &&
        view.trick.length === 0 &&
        view.players.reduce(function (a, p) { return a + p.count; }, 0) === 52) {
      dealPlayed = true;
      dealtNow = true;
      dealAnimation(view);
    }

    // Turn banner.
    var banner = $('turn-banner');
    if (view.phase === 'over') {
      banner.textContent = view.players[view.bhabhi].name + ' is the Bhabhi!';
    } else if (view.turn === mySeat) {
      banner.textContent = view.isFirstTrick && view.trick.length === 0
        ? 'Your turn — lead the Ace of Spades!'
        : 'Your turn — tap a glowing card.';
    } else {
      banner.textContent = view.players[view.turn].name + ' is thinking…';
    }

    // My hand (bottom fan).
    renderHand(view, dealtNow);

    // Chime when someone got away.
    var prevSafe = lastRenderedView ? lastRenderedView.safeOrder.length : 0;
    if (view.safeOrder.length > prevSafe) Sound.chime();

    // Log.
    var logBox = $('game-log');
    logBox.innerHTML = '';
    view.log.slice(-6).forEach(function (line) {
      logBox.appendChild(el('div', 'log-line', line));
    });

    // Connection status.
    var conn = $('conn-status');
    if (mode === 'friends') {
      conn.textContent = connected ? '● Connected to room ' + roomCode : '○ Connecting…';
      conn.className = 'conn-status ' + (connected ? 'ok' : 'bad');
    } else {
      conn.textContent = '● Offline game vs bots';
      conn.className = 'conn-status ok';
    }

    // Thulla flash.
    var ev = view.lastEvent;
    var key = ev ? (ev.type + '|' + JSON.stringify(ev)) : '';
    if (ev && (ev.type === 'thulla' || ev.type === 'thulla-pickup') && key !== lastFlashKey) {
      lastFlashKey = key;
      flashThulla(ev.type === 'thulla' ? 'THULLA!' : 'PICK UP!');
    }
  }

  function renderHand(view, dealtNow) {
    var handBox = $('my-hand');
    handBox.innerHTML = '';
    var me = view.players[mySeat];
    if (!me.hand) return;
    var legal = [];
    if (view.phase === 'playing' && view.turn === mySeat) {
      legal = E.legalMoves(viewAsEngineState(view), mySeat);
    }
    var sorted = me.hand.slice().sort(function (a, b) {
      var sa = E.suitOf(a), sb = E.suitOf(b);
      if (sa !== sb) return 'SHDC'.indexOf(sa) - 'SHDC'.indexOf(sb);
      return E.rankOf(b) - E.rankOf(a);
    });
    sorted.forEach(function (card, i) {
      var playable = legal.indexOf(card) !== -1;
      var canPlay = view.phase === 'playing' && view.turn === mySeat;
      var cardEl = Cards.createCard(card, E, {
        playable: canPlay && playable,
        dimmed: canPlay && !playable,
        onClick: (canPlay && playable) ? onCardClick : null
      });
      if (dealtNow) {
        cardEl.classList.add('deal-in');
        cardEl.style.animationDelay = (i * 45) + 'ms';
      }
      handBox.appendChild(cardEl);
    });
    if (!sorted.length) {
      handBox.appendChild(el('div', 'hand-empty', me.out ? 'You got away! 🎉' : 'No cards.'));
    }
  }

  function flashThulla(text, key) {
    if (key) lastFlashKey = key;
    var f = $('thulla-flash');
    f.textContent = text;
    f.classList.add('show');
    setTimeout(function () { f.classList.remove('show'); }, 900);
  }

  // ---------- table animation helpers ----------
  function seatElForPlayer(idx) {
    var seats = document.querySelectorAll('#seats .seat');
    for (var i = 0; i < seats.length; i++) {
      if (Number(seats[i].dataset.player) === idx) return seats[i];
    }
    return null;
  }

  // Fly a trick card from a source rect (a seat, or the human's hand) to its
  // final slot. FLIP-style: the card is already placed, we animate it in.
  function flyCardToTrick(cardEl, fromRect, isThulla) {
    if (!cardEl || !fromRect || !cardEl.animate) return;
    var toRect = cardEl.getBoundingClientRect();
    var dx = (fromRect.left + fromRect.width / 2) - (toRect.left + toRect.width / 2);
    var dy = (fromRect.top + fromRect.height / 2) - (toRect.top + toRect.height / 2);
    var rot = cardEl.style.getPropertyValue('--rot') || '0deg';
    var end = 'translate(0px, 0px) rotate(' + rot + ') scale(1)';
    if (isThulla) {
      // Slam: fast drop with a bounce at the end.
      cardEl.animate([
        { transform: 'translate(' + dx + 'px, ' + (dy - 70) + 'px) rotate(-16deg) scale(1.05)', opacity: 0.9, offset: 0 },
        { transform: 'translate(' + (dx * 0.12) + 'px, ' + (dy * 0.12 - 30) + 'px) rotate(7deg) scale(1.14)', opacity: 1, offset: 0.68 },
        { transform: 'translate(0px, -14px) rotate(' + rot + ') scale(1.2)', offset: 0.85 },
        { transform: end, offset: 1 }
      ], { duration: 680, easing: 'ease-in' });
    } else {
      cardEl.animate([
        { transform: 'translate(' + dx + 'px, ' + dy + 'px) rotate(-12deg) scale(0.85)', opacity: 0.85, offset: 0 },
        { transform: 'translate(' + (dx * 0.5) + 'px, ' + (dy * 0.5 - 36) + 'px) rotate(5deg) scale(0.96)', opacity: 1, offset: 0.55 },
        { transform: end, offset: 1 }
      ], { duration: 750, easing: 'cubic-bezier(.25,.7,.3,1)' });
    }
  }

  function slamTable() {
    var t = $('table-wrap');
    if (!t) return;
    t.classList.remove('shake');
    void t.offsetWidth; // restart the shake animation
    t.classList.add('shake');
    setTimeout(function () { t.classList.remove('shake'); }, 450);
  }

  // Fly ghost copies of the trick pile to the player who picked it up.
  function animatePileToSeat(playerIdx) {
    var pile = $('trick-pile');
    if (!pile || !pile.children.length) return;
    var pileRect = pile.getBoundingClientRect();
    var seat = seatElForPlayer(playerIdx);
    var toRect = seat ? seat.getBoundingClientRect() : pileRect;
    var cx = pileRect.left + pileRect.width / 2;
    var cy = pileRect.top + pileRect.height / 2;
    var tx = toRect.left + toRect.width / 2;
    var ty = toRect.top + toRect.height / 2;
    for (var i = 0; i < 3; i++) {
      (function (k) {
        var g = Cards.createBack({ small: true });
        g.classList.add('fly-ghost');
        g.style.left = (cx - 13 + k * 10) + 'px';
        g.style.top = (cy - 18) + 'px';
        document.body.appendChild(g);
        g.animate([
          { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
          { transform: 'translate(' + (tx - cx) + 'px, ' + (ty - cy) + 'px) scale(0.55)', opacity: 0.9 }
        ], { duration: 700, delay: k * 70, easing: 'cubic-bezier(.4,.6,.4,1)', fill: 'forwards' });
        setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 950 + k * 70);
      })(i);
    }
  }

  // Cards fly one by one from a centre deck pile to each seat.
  function dealAnimation(view) {
    var wrap = $('table-wrap');
    if (!wrap) return;
    var wrapRect = wrap.getBoundingClientRect();
    var cx = wrapRect.left + wrapRect.width / 2;
    var cy = wrapRect.top + wrapRect.height * 0.42;
    var deck = Cards.createBack({});
    deck.classList.add('fly-ghost', 'deal-deck');
    deck.style.left = (cx - 42) + 'px';
    deck.style.top = (cy - 58) + 'px';
    document.body.appendChild(deck);
    var n = view.numPlayers;
    var maxHand = 0;
    view.players.forEach(function (p) { if (p.count > maxHand) maxHand = p.count; });
    for (var r = 0; r < maxHand; r++) {
      for (var p = 0; p < n; p++) {
        if (r >= view.players[p].count) continue;
        (function (playerIdx, delay) {
          var g = Cards.createBack({ small: true });
          g.classList.add('fly-ghost');
          g.style.left = (cx - 13) + 'px';
          g.style.top = (cy - 18) + 'px';
          document.body.appendChild(g);
          var seat = seatElForPlayer(playerIdx);
          var sr = seat ? seat.getBoundingClientRect() : { left: cx, top: cy, width: 0, height: 0 };
          var dx = (sr.left + sr.width / 2) - cx;
          var dy = (sr.top + sr.height / 2) - cy;
          g.animate([
            { transform: 'translate(0px, 0px) rotate(0deg)', opacity: 1 },
            { transform: 'translate(' + (dx * 0.6) + 'px, ' + (dy * 0.6 - 22) + 'px) rotate(12deg)', opacity: 1, offset: 0.6 },
            { transform: 'translate(' + dx + 'px, ' + dy + 'px) rotate(0deg) scale(0.7)', opacity: 0.95 }
          ], { duration: 520, delay: delay, easing: 'ease-out', fill: 'forwards' });
          setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, delay + 620);
        })(p, r * 95 + p * 45);
      }
    }
    setTimeout(function () { if (deck.parentNode) deck.parentNode.removeChild(deck); }, maxHand * 95 + 500);
  }

  // ---------- result ----------
  function showResult() {
    var view = null;
    if (mode === 'bots' || isHost) {
      if (!game) return;
      view = buildView(game, mySeat);
    } else {
      view = viewState;
      if (!view) return;
    }
    inGame = false;

    // Update the session scoreboard (host/bots own the counts; clients get
    // them inside the broadcast state).
    if (mode === 'bots' || isHost) {
      var bName = view.players[view.bhabhi].name;
      bhabhiCounts[bName] = (bhabhiCounts[bName] || 0) + 1;
      view.bhabhiCounts = JSON.parse(JSON.stringify(bhabhiCounts));
      // Re-broadcast so friends see the updated scoreboard too.
      if (mode === 'friends' && isHost) broadcastState();
    }

    $('result-title').textContent = view.players[view.bhabhi].name + ' is the Bhabhi! 😄';
    var order = $('result-order');
    order.innerHTML = '';
    view.safeOrder.forEach(function (idx, i) {
      order.appendChild(el('li', '', (i + 1) + '. ' + view.players[idx].name + ' — got away'));
    });
    order.appendChild(el('li', 'bhabhi-line',
      'Last: ' + view.players[view.bhabhi].name + ' — the Bhabhi'));

    var counts = $('result-counts');
    counts.innerHTML = '';
    Object.keys(view.bhabhiCounts || {}).sort().forEach(function (name) {
      var c = view.bhabhiCounts[name];
      counts.appendChild(el('li', '', name + ': ' + c + (c === 1 ? ' time' : ' times') + ' Bhabhi'));
    });

    $('btn-play-again').textContent = mode === 'friends' && !isHost
      ? 'Waiting for the host to start a new round…'
      : 'Play Again';
    $('btn-play-again').disabled = (mode === 'friends' && !isHost);
    $('btn-result-home').style.display = '';
    show('screen-result');
  }

  function playAgain() {
    if (mode === 'bots') {
      startBotsGame(numPlayers);
    } else if (mode === 'friends' && isHost) {
      startFriendsRound();
    }
  }

  // ---------- friends: host ----------
  function randomCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  function createRoom() {
    getName();
    mode = 'friends';
    isHost = true;
    dealPlayed = false;
    lastRenderedView = null;
    roomCode = randomCode();
    lobbyPlayers = [{ name: myName, seat: 0, isHost: true }];
    lobbyStarted = false;
    showLobby();
    setLobbyStatus('Opening room…');
    Net.createRoom(roomCode, {
      onOpen: function () {
        connected = true;
        setLobbyStatus('Room is open. Share the code with your friends!');
      },
      onConnection: function (conn) { handleHostConnection(conn); },
      onError: function (err) {
        if (err && err.type === 'unavailable-id') {
          // Code taken — regenerate and try again.
          roomCode = randomCode();
          peer = null;
          createRoomRetry();
        } else {
          setLobbyStatus('Could not open the room. Check your connection and try again.');
        }
      }
    }).then(function (p) { peer = p; }).catch(function () {
      setLobbyStatus('Could not load the connection library. Check your internet and try again.');
    });
  }

  function createRoomRetry() {
    showLobby();
    setLobbyStatus('That code was taken — trying a new one…');
    Net.createRoom(roomCode, {
      onOpen: function () {
        connected = true;
        setLobbyStatus('Room is open. Share the code with your friends!');
      },
      onConnection: function (conn) { handleHostConnection(conn); },
      onError: function (err) {
        setLobbyStatus('Could not open the room. Check your connection and try again.');
      }
    }).then(function (p) { peer = p; });
  }

  function handleHostConnection(conn) {
    conn.on('data', function (data) {
      if (!data || typeof data !== 'object') return;
      if (data.t === 'join') {
        handleJoin(conn, data.name);
      } else if (data.t === 'play') {
        handleRemotePlay(conn, data.card);
      }
    });
    conn.on('close', function () { handleHostDisconnect(conn); });
    conn.on('error', function () { handleHostDisconnect(conn); });
  }

  function handleJoin(conn, name) {
    var pid = conn.peer;
    if (lobbyStarted) {
      try { conn.send({ t: 'error', msg: 'This game has already started.' }); } catch (e) { /* ignore */ }
      setTimeout(function () { try { conn.close(); } catch (e) { /* ignore */ } }, 300);
      return;
    }
    if (lobbyPlayers.length >= MAX_PLAYERS) {
      try { conn.send({ t: 'full' }); } catch (e) { /* ignore */ }
      setTimeout(function () { try { conn.close(); } catch (e) { /* ignore */ } }, 300);
      return;
    }
    var seat = lobbyPlayers.length;
    hostConns[pid] = { conn: conn, name: name, seat: seat };
    lobbyPlayers.push({ name: name, seat: seat, isHost: false });
    try { conn.send({ t: 'welcome', seat: seat, players: lobbyPlayers, code: roomCode }); } catch (e) { /* ignore */ }
    broadcastLobby();
  }

  function handleRemotePlay(conn, card) {
    if (!game || game.phase !== 'playing' || lobbyStarted === false) return;
    var entry = hostConns[conn.peer];
    if (!entry) return;
    var seat = entry.seat;
    if (game.turn !== seat) return;
    var res = E.applyPlay(game, seat, card);
    if (!res.ok) {
      try { conn.send({ t: 'error', msg: res.error || 'Illegal move.' }); } catch (e) { /* ignore */ }
      return;
    }
    lastPlay = { player: seat, card: card, thulla: res.thulla };
    broadcastState();
    renderTable();
    afterMove();
  }

  function handleHostDisconnect(conn) {
    var entry = hostConns[conn.peer];
    if (!entry) return;
    delete hostConns[conn.peer];
    if (!lobbyStarted) {
      lobbyPlayers = lobbyPlayers.filter(function (p) { return p.seat !== entry.seat; });
      // Renumber seats so they stay contiguous (0..n-1) for the game.
      lobbyPlayers.forEach(function (p, i) { p.seat = i; });
      Object.keys(hostConns).forEach(function (pid) {
        var e2 = hostConns[pid];
        var match = lobbyPlayers.filter(function (p) { return p.name === e2.name; })[0];
        if (match) e2.seat = match.seat;
      });
      broadcastLobby();
      return;
    }
    // Mid-game: the seat becomes a bot so the game can continue.
    if (game && game.phase === 'playing') {
      var pl = game.players[entry.seat];
      pl.isBot = true;
      pl.disconnected = true;
      game.log.push(pl.name + ' disconnected — a bot takes over their seat.');
      broadcastState();
      renderTable();
      advanceBots();
    }
  }

  function broadcastLobby() {
    renderLobbyList();
    Object.keys(hostConns).forEach(function (pid) {
      try { hostConns[pid].conn.send({ t: 'lobby', players: lobbyPlayers }); } catch (e) { /* ignore */ }
    });
  }

  function broadcastState() {
    if (!game) return;
    Object.keys(hostConns).forEach(function (pid) {
      var entry = hostConns[pid];
      try { entry.conn.send({ t: 'state', state: buildView(game, entry.seat) }); } catch (e) { /* ignore */ }
    });
  }

  function startFriendsRound() {
    if (lobbyPlayers.length < MIN_PLAYERS) {
      toast('Need at least 3 players to start.');
      return;
    }
    lobbyStarted = true;
    var names = lobbyPlayers.slice().sort(function (a, b) { return a.seat - b.seat; })
      .map(function (p) { return p.name; });
    game = E.createGame(lobbyPlayers.length, { names: names });
    if (Bots.resetBotMemory) Bots.resetBotMemory();
    mySeat = 0;
    inGame = true;
    dealPlayed = false;
    lastRenderedView = null;
    broadcastState();
    show('screen-table');
    renderTable();
    advanceBots();
  }

  // ---------- friends: client ----------
  function joinRoom(code) {
    getName();
    mode = 'friends';
    isHost = false;
    dealPlayed = false;
    lastRenderedView = null;
    roomCode = code;
    setFriendsStatus('Connecting to room ' + code + '…');
    Net.joinRoom(code, {
      onOpen: function (conn) {
        hostConn = conn;
        connected = true;
        hostConn.send({ t: 'join', name: myName });
      },
      onData: function (data) {
        if (!data || typeof data !== 'object') return;
        if (data.t === 'welcome') {
          mySeat = data.seat;
          lobbyPlayers = data.players;
          showLobby();
          setLobbyStatus('Joined room ' + code + '. Waiting for the host to start…');
          renderLobbyList();
        } else if (data.t === 'lobby') {
          lobbyPlayers = data.players;
          renderLobbyList();
        } else if (data.t === 'state') {
          viewState = data.state;
          inGame = true;
          if (!$('screen-table').classList.contains('active')) show('screen-table');
          renderTable();
          if (viewState.phase === 'over') showResult();
        } else if (data.t === 'full') {
          setFriendsStatus('That room is full (4 players max).');
        } else if (data.t === 'error') {
          var msg = data.msg || 'Could not join the room.';
          if ($('screen-table').classList.contains('active')) toast(msg);
          else setFriendsStatus(msg);
        }
      },
      onClose: function () {
        connected = false;
        if (inGame) {
          $('host-left').classList.add('show');
        } else {
          setFriendsStatus('Disconnected from the room. Check the code and try again.');
        }
      },
      onError: function (err) {
        connected = false;
        if (err && err.type === 'peer-unavailable') {
          setFriendsStatus('Room ' + code + ' not found. Check the code and try again.');
        } else {
          setFriendsStatus('Could not connect. Check your internet and try again.');
        }
      }
    }).then(function (p) { peer = p; }).catch(function () {
      setFriendsStatus('Could not load the connection library. Check your internet and try again.');
    });
  }

  // ---------- lobby UI ----------
  function showLobby() {
    $('room-code-big').textContent = roomCode || '------';
    var link = location.origin + location.pathname + '?room=' + roomCode;
    $('room-link').value = link;
    $('lobby-is-host').style.display = isHost ? '' : 'none';
    $('btn-start-game').style.display = isHost ? '' : 'none';
    $('lobby-wait-note').style.display = isHost ? 'none' : '';
    setLobbyStatus(isHost ? 'Room is open. Share the code with your friends!' : '');
    renderLobbyList();
    show('screen-lobby');
  }

  function renderLobbyList() {
    var list = $('lobby-players');
    list.innerHTML = '';
    lobbyPlayers.forEach(function (p) {
      var li = el('li', '', p.name + (p.isHost ? ' (Host)' : ''));
      list.appendChild(li);
    });
    $('lobby-count').textContent = lobbyPlayers.length + ' / 4 players';
    var startBtn = $('btn-start-game');
    startBtn.disabled = lobbyPlayers.length < MIN_PLAYERS;
    startBtn.textContent = lobbyPlayers.length < MIN_PLAYERS
      ? 'Start Game (need ' + (MIN_PLAYERS - lobbyPlayers.length) + ' more)'
      : 'Start Game (' + lobbyPlayers.length + ' players)';
  }

  function setLobbyStatus(msg) { $('lobby-status').textContent = msg || ''; }
  function setFriendsStatus(msg) { $('friends-status').textContent = msg || ''; }

  function copyText(text, okMsg) {
    function done() { toast(okMsg); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else {
      fallbackCopy(text);
      done();
    }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  function leaveGame() {
    clearTimeout(botTimer);
    clearTimeout(renderTimer);
    renderTimer = null;
    lastRenderedView = null;
    latestView = null;
    pendingHandRect = null;
    dealPlayed = false;
    try { if (peer && peer.destroy) peer.destroy(); } catch (e) { /* ignore */ }
    try { if (hostConn) hostConn.close(); } catch (e) { /* ignore */ }
    peer = null; hostConn = null; hostConns = {};
    game = null; viewState = null; inGame = false; connected = false;
    lobbyPlayers = []; lobbyStarted = false; roomCode = null;
    $('host-left').classList.remove('show');
    show('screen-home');
  }

  // ---------- rules modal ----------
  function openRules() { $('rules-modal').classList.add('show'); }
  function closeRules() { $('rules-modal').classList.remove('show'); }

  // ---------- sound toggle ----------
  function updateSoundBtn() {
    var b = $('btn-sound');
    if (b) b.textContent = soundMuted ? '🔇 Sound: Off' : '🔊 Sound: On';
  }

  // ---------- wire up ----------
  function init() {
    if (myName) $('name-input').value = myName;

    $('btn-mode-bots').addEventListener('click', function () {
      getName();
      show('screen-bots');
    });
    $('btn-mode-friends').addEventListener('click', function () {
      getName();
      show('screen-friends');
    });
    $('btn-rules').addEventListener('click', openRules);
    $('btn-rules-table').addEventListener('click', openRules);
    $('btn-sound').addEventListener('click', function () {
      soundMuted = !soundMuted;
      try { localStorage.setItem('thulla-muted', soundMuted ? '1' : '0'); } catch (e) { /* ignore */ }
      updateSoundBtn();
      if (!soundMuted) Sound.tick();
    });
    updateSoundBtn();
    $('btn-close-rules').addEventListener('click', closeRules);
    $('rules-modal').addEventListener('click', function (e) {
      if (e.target === $('rules-modal')) closeRules();
    });

    $('btn-players-3').addEventListener('click', function () { startBotsGame(3); });
    $('btn-players-4').addEventListener('click', function () { startBotsGame(4); });
    $('btn-bots-back').addEventListener('click', function () { show('screen-home'); });

    $('btn-create-room').addEventListener('click', createRoom);
    $('btn-join-room').addEventListener('click', function () {
      var code = ($('join-code').value || '').trim();
      if (!/^\d{6}$/.test(code)) {
        setFriendsStatus('Enter the 6-digit room code.');
        return;
      }
      joinRoom(code);
    });
    $('btn-friends-back').addEventListener('click', function () { show('screen-home'); });

    $('btn-copy-code').addEventListener('click', function () {
      if (roomCode) copyText(roomCode, 'Room code copied!');
    });
    $('btn-copy-link').addEventListener('click', function () {
      copyText($('room-link').value, 'Game link copied! Share it with your friends.');
    });
    $('btn-start-game').addEventListener('click', startFriendsRound);
    $('btn-leave-lobby').addEventListener('click', leaveGame);
    $('btn-leave-table').addEventListener('click', leaveGame);

    $('btn-play-again').addEventListener('click', playAgain);
    $('btn-result-home').addEventListener('click', leaveGame);
    $('btn-host-left-home').addEventListener('click', leaveGame);

    // Joining from a shared link: ?room=482913 pre-fills the code.
    var params = new URLSearchParams(location.search);
    var roomParam = params.get('room');
    if (roomParam && /^\d{6}$/.test(roomParam)) {
      $('join-code').value = roomParam;
      show('screen-friends');
      setFriendsStatus('Room code ' + roomParam + ' filled in — enter your name and tap Join.');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
