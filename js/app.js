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
    mySeat = 0;
    inGame = true;
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
      var card = Bots.chooseBotMove(E, game, game.turn);
      if (!card) return;
      var res = E.applyPlay(game, game.turn, card);
      if (!res.ok) return;
      if (mode === 'friends' && isHost) broadcastState();
      renderTable();
      afterMove();
    }, 600 + Math.random() * 300);
  }

  function afterMove() {
    if (!game) return;
    if (game.phase === 'over') { showResult(); return; }
    advanceBots();
  }

  function onCardClick(card) {
    if (mode === 'bots') {
      var res = E.applyPlay(game, mySeat, card);
      if (!res.ok) { toast(res.error || 'That card cannot be played now.'); return; }
      renderTable();
      afterMove();
    } else if (mode === 'friends') {
      if (isHost) {
        var r2 = E.applyPlay(game, mySeat, card);
        if (!r2.ok) { toast(r2.error || 'That card cannot be played now.'); return; }
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

  function renderTable() {
    var view = null;
    if (mode === 'bots' || isHost) {
      if (!game) return;
      view = buildView(game, mySeat);
    } else {
      view = viewState;
      if (!view) return;
    }
    renderTableView(view);
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

    // Trick pile in the centre.
    var pile = $('trick-pile');
    pile.innerHTML = '';
    if (!view.trick.length) {
      pile.appendChild(el('div', 'trick-empty',
        view.isFirstTrick ? 'First trick: the Ace of Spades must be led.' : 'Waiting for the lead…'));
    } else {
      view.trick.forEach(function (t, i) {
        var wrap = el('div', 'trick-card');
        wrap.style.setProperty('--rot', ((i - (view.trick.length - 1) / 2) * 7) + 'deg');
        wrap.appendChild(Cards.createCard(t.card, E, { small: true }));
        wrap.appendChild(el('div', 'trick-who', view.players[t.player].name));
        pile.appendChild(wrap);
      });
    }
    $('waste-count').textContent = 'Waste pile: ' + view.wasteCount + ' cards';

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
    renderHand(view);

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

  function renderHand(view) {
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
    sorted.forEach(function (card) {
      var playable = legal.indexOf(card) !== -1;
      var canPlay = view.phase === 'playing' && view.turn === mySeat;
      handBox.appendChild(Cards.createCard(card, E, {
        playable: canPlay && playable,
        dimmed: canPlay && !playable,
        onClick: (canPlay && playable) ? onCardClick : null
      }));
    });
    if (!sorted.length) {
      handBox.appendChild(el('div', 'hand-empty', me.out ? 'You got away! 🎉' : 'No cards.'));
    }
  }

  function flashThulla(text) {
    var f = $('thulla-flash');
    f.textContent = text;
    f.classList.add('show');
    setTimeout(function () { f.classList.remove('show'); }, 1400);
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
    mySeat = 0;
    inGame = true;
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
