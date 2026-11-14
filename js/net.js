// PeerJS (WebRTC) wrapper for "Play with Friends" — no accounts, no server.
// Uses the free public PeerJS cloud. PeerJS is loaded from a CDN with a
// fallback: unpkg first, jsdelivr if the first fails to load.
// Room ids look like: thulla-room-482913  (6-digit code).
(function (root) {
  'use strict';

  var PEER_CDNS = [
    'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'
  ];

  function roomPeerId(code) { return 'thulla-room-' + code; }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  // Returns the Peer constructor, trying each CDN in turn.
  function ensurePeerJS() {
    if (typeof window !== 'undefined' && window.Peer) return Promise.resolve(window.Peer);
    var chain = Promise.reject();
    PEER_CDNS.forEach(function (src) {
      chain = chain.catch(function () {
        return loadScript(src).then(function () {
          if (!window.Peer) throw new Error('PeerJS did not load from ' + src);
          return window.Peer;
        });
      });
    });
    return chain;
  }

  // Host: open a peer with the room id. Handlers:
  //   onOpen(id), onConnection(conn), onError(err)
  // An 'unavailable-id' error means the code is already taken.
  function createRoom(code, handlers) {
    return ensurePeerJS().then(function (Peer) {
      var peer = new Peer(roomPeerId(code));
      peer.on('open', function (id) { handlers.onOpen && handlers.onOpen(id); });
      peer.on('connection', function (conn) { handlers.onConnection && handlers.onConnection(conn); });
      peer.on('error', function (err) { handlers.onError && handlers.onError(err); });
      peer.on('disconnected', function () { handlers.onDisconnected && handlers.onDisconnected(); });
      return peer;
    });
  }

  // Client: connect to a room. Handlers:
  //   onOpen(conn), onData(data), onClose(), onError(err)
  // A 'peer-unavailable' error means the room does not exist.
  function joinRoom(code, handlers) {
    return ensurePeerJS().then(function (Peer) {
      var peer = new Peer();
      var conn = null;
      peer.on('open', function () {
        conn = peer.connect(roomPeerId(code), { reliable: true });
        conn.on('open', function () { handlers.onOpen && handlers.onOpen(conn); });
        conn.on('data', function (d) { handlers.onData && handlers.onData(d); });
        conn.on('close', function () { handlers.onClose && handlers.onClose(); });
        conn.on('error', function (e) { handlers.onError && handlers.onError(e); });
      });
      peer.on('error', function (err) { handlers.onError && handlers.onError(err); });
      return {
        peer: peer,
        getConn: function () { return conn; },
        destroy: function () { try { peer.destroy(); } catch (e) { /* ignore */ } }
      };
    });
  }

  var api = {
    roomPeerId: roomPeerId,
    ensurePeerJS: ensurePeerJS,
    createRoom: createRoom,
    joinRoom: joinRoom
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ThullaNet = api;
  if (typeof root !== 'undefined') root.ThullaNet = api;
})(typeof self !== 'undefined' ? self : this);
