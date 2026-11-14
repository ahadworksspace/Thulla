// Card DOM rendering for Bhabhi Thulla.
// Cards are drawn with pure CSS/HTML + inline SVG — no external images.
// Face cards (K/Q/J) carry cartoon face art; number cards show a big centre
// suit pip. Card backs are blue/purple with a spade monogram; the waste pile
// uses a red back with a gold monogram.
(function (root) {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';

  function el(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text !== undefined && text !== null) d.textContent = text;
    return d;
  }

  function svgEl(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) {
      for (var k in attrs) n.setAttribute(k, attrs[k]);
    }
    return n;
  }

  // ---- cartoon face art for K / Q / J (viewBox 0 0 100 140) ----
  // Red suits wear crimson, black suits wear navy. King: crown + beard.
  // Queen: small crown + long hair. Jack: cap, young face.
  function faceArt(rank, suit) {
    var red = suit === 'H' || suit === 'D';
    var outfit = red ? '#b03a2e' : '#1f3a5f';
    var outfitDark = red ? '#7e281e' : '#14263d';
    var skin = '#f2c89b';
    var svg = svgEl('svg', { viewBox: '0 0 100 140', 'class': 'face-art', 'aria-hidden': 'true' });

    // Shoulders / robe.
    svg.appendChild(svgEl('path', { d: 'M8 140 C8 112 28 104 50 104 C72 104 92 112 92 140 Z', fill: outfit }));
    // Gold collar + medallion.
    svg.appendChild(svgEl('path', { d: 'M38 104 L50 118 L62 104 L62 112 L50 126 L38 112 Z', fill: '#f1c40f' }));
    svg.appendChild(svgEl('circle', { cx: '50', cy: '130', r: '7', fill: '#f1c40f', stroke: '#b8912a', 'stroke-width': '1.5' }));
    svg.appendChild(svgEl('circle', { cx: '50', cy: '130', r: '3', fill: red ? '#c0392b' : '#2471a3' }));

    // Neck + face.
    svg.appendChild(svgEl('rect', { x: '44', y: '90', width: '12', height: '16', fill: skin }));
    svg.appendChild(svgEl('ellipse', { cx: '50', cy: '64', rx: '18', ry: '26', fill: skin }));

    if (rank === 13) {
      // KING: beard + big crown.
      svg.appendChild(svgEl('path', {
        d: 'M34 70 Q33 94 50 98 Q67 94 66 70 L66 64 Q60 74 50 74 Q40 74 34 64 Z',
        fill: red ? '#6b4a2f' : '#2c2c2c'
      }));
      svg.appendChild(svgEl('path', {
        d: 'M34 66 Q42 60 50 66 Q58 60 66 66 L66 60 Q58 54 50 60 Q42 54 34 60 Z',
        fill: red ? '#6b4a2f' : '#2c2c2c'
      }));
      svg.appendChild(svgEl('polygon', {
        points: '30,42 37,16 45,34 50,12 55,34 63,16 70,42',
        fill: '#f1c40f', stroke: '#b8912a', 'stroke-width': '1.5'
      }));
      svg.appendChild(svgEl('circle', { cx: '50', cy: '38', r: '3', fill: '#c0392b' }));
      svg.appendChild(svgEl('circle', { cx: '37', cy: '34', r: '2', fill: '#2471a3' }));
      svg.appendChild(svgEl('circle', { cx: '63', cy: '34', r: '2', fill: '#2471a3' }));
    } else if (rank === 12) {
      // QUEEN: long hair + small crown.
      svg.appendChild(svgEl('path', {
        d: 'M30 62 Q26 30 50 28 Q74 30 70 62 Q70 48 62 42 Q66 66 60 74 L58 60 Q56 48 50 48 Q44 48 42 60 L40 74 Q34 66 38 42 Q30 48 30 62 Z',
        fill: red ? '#e8c33c' : '#7a4a21'
      }));
      svg.appendChild(svgEl('polygon', {
        points: '34,42 40,24 46,36 50,20 54,36 60,24 66,42',
        fill: '#f1c40f', stroke: '#b8912a', 'stroke-width': '1.5'
      }));
      svg.appendChild(svgEl('circle', { cx: '50', cy: '38', r: '2.6', fill: '#c0392b' }));
      // Earrings.
      svg.appendChild(svgEl('circle', { cx: '33', cy: '72', r: '2', fill: '#f1c40f' }));
      svg.appendChild(svgEl('circle', { cx: '67', cy: '72', r: '2', fill: '#f1c40f' }));
    } else {
      // JACK: cap, young face.
      svg.appendChild(svgEl('path', {
        d: 'M31 46 A19 17 0 0 1 69 46 L69 42 Q69 28 50 28 Q31 28 31 42 Z',
        fill: outfitDark
      }));
      svg.appendChild(svgEl('rect', { x: '27', y: '43', width: '46', height: '6', rx: '3', fill: outfitDark }));
      svg.appendChild(svgEl('circle', { cx: '50', cy: '30', r: '3', fill: '#f1c40f' }));
    }

    // Eyes + smile (shared).
    svg.appendChild(svgEl('circle', { cx: '43', cy: '60', r: '2.6', fill: '#222' }));
    svg.appendChild(svgEl('circle', { cx: '57', cy: '60', r: '2.6', fill: '#222' }));
    svg.appendChild(svgEl('path', { d: 'M43 78 Q50 84 57 78', stroke: '#7a4a21', 'stroke-width': '2', fill: 'none', 'stroke-linecap': 'round' }));
    return svg;
  }

  // Build a face-up card element for a card id like 'AS', '10H', 'QD', '2C'.
  // opts: { playable, dimmed, small, onClick, label }
  function createCard(cardId, engine, opts) {
    opts = opts || {};
    var card = el('div', 'card' + (engine.isRed(cardId) ? ' red' : ' black') +
      (opts.small ? ' small' : '') +
      (opts.playable ? ' playable' : '') +
      (opts.dimmed ? ' dimmed' : ''));
    card.dataset.card = cardId;

    var rank = engine.rankOf(cardId);
    var label = rank === 14 ? 'A' : rank === 13 ? 'K' : rank === 12 ? 'Q' :
      rank === 11 ? 'J' : String(rank);
    var suit = engine.SUIT_SYMBOL[engine.suitOf(cardId)];

    var tl = el('div', 'corner top-left');
    tl.appendChild(el('div', 'rank', label));
    tl.appendChild(el('div', 'suit', suit));
    var br = el('div', 'corner bottom-right');
    br.appendChild(el('div', 'rank', label));
    br.appendChild(el('div', 'suit', suit));
    card.appendChild(tl);
    card.appendChild(br);

    if (rank >= 11 && rank <= 13) {
      card.appendChild(faceArt(rank, engine.suitOf(cardId)));
    } else {
      card.appendChild(el('div', 'pip', suit));
    }

    if (opts.label) card.appendChild(el('div', 'card-label', opts.label));
    if (opts.onClick) card.addEventListener('click', function () { opts.onClick(cardId); });
    return card;
  }

  // A face-down card (blue/purple back with a spade monogram).
  function createBack(opts) {
    opts = opts || {};
    var card = el('div', 'card back' + (opts.small ? ' small' : ''));
    card.appendChild(el('div', 'back-mono', '♠'));
    return card;
  }

  // Red back with a gold monogram, used for the waste/deck pile.
  function createDeckBack() {
    var card = el('div', 'card back deck-back');
    card.appendChild(el('div', 'back-mono gold', '♠'));
    return card;
  }

  // A small stack of mini face-down cards used to show another player's
  // remaining card count. opts: { showCount } (default true).
  function createMiniBacks(count, opts) {
    opts = opts || {};
    var wrap = el('div', 'mini-backs');
    var shown = Math.min(count, 5);
    for (var i = 0; i < shown; i++) wrap.appendChild(createBack({ small: true }));
    if (count > 0 && opts.showCount !== false) wrap.appendChild(el('div', 'count-badge', String(count)));
    return wrap;
  }

  // ---- cartoon portrait avatars (viewBox 0 0 100 100) ----
  // Four flat-style faces, one per seat. Each has a background colour and a
  // coloured frame; the frame colour is set on the wrapper by the caller.
  var AVATARS = [
    { bg: '#3a86d8', frame: '#2e9e5b', skin: '#c98d5f', kind: 'cowboy' },   // 0: cowboy hat, beard
    { bg: '#f39c12', frame: '#f2c200', skin: '#8d5524', kind: 'blue' },    // 1: dark skin, blue shirt
    { bg: '#a8d8f0', frame: '#2f7fe0', skin: '#f2c89b', kind: 'blond' },   // 2: blond young man
    { bg: '#8e44ad', frame: '#8e44ad', skin: '#e8b88a', kind: 'cap' }      // 3: red cap, beard
  ];

  function avatarSVG(v) {
    var svg = svgEl('svg', { viewBox: '0 0 100 100', 'class': 'avatar-svg', 'aria-hidden': 'true' });
    svg.appendChild(svgEl('rect', { x: '0', y: '0', width: '100', height: '100', fill: v.bg }));
    // Shoulders / shirt.
    var shirt = v.kind === 'blue' ? '#2f7fe0' : v.kind === 'blond' ? '#f2f2f2' :
      v.kind === 'cap' ? '#2e9e5b' : '#3a3a3a';
    svg.appendChild(svgEl('path', { d: 'M8 100 Q8 76 50 76 Q92 76 92 100 Z', fill: shirt }));
    // Neck + face.
    svg.appendChild(svgEl('rect', { x: '44', y: '66', width: '12', height: '14', fill: v.skin }));
    svg.appendChild(svgEl('ellipse', { cx: '50', cy: '50', rx: '17', ry: '20', fill: v.skin }));

    if (v.kind === 'cowboy') {
      // Wide-brim hat + beard.
      svg.appendChild(svgEl('ellipse', { cx: '50', cy: '36', rx: '34', ry: '8', fill: '#7a4a21' }));
      svg.appendChild(svgEl('path', { d: 'M32 36 Q32 14 50 14 Q68 14 68 36 Z', fill: '#8a5a28' }));
      svg.appendChild(svgEl('path', {
        d: 'M36 56 Q35 76 50 78 Q65 76 64 56 L64 52 Q58 60 50 60 Q42 60 36 52 Z', fill: '#3a2a18'
      }));
    } else if (v.kind === 'blue') {
      // Short black hair.
      svg.appendChild(svgEl('path', { d: 'M33 44 A17 17 0 0 1 67 44 L67 38 Q67 26 50 26 Q33 26 33 38 Z', fill: '#1a1a1a' }));
      // Smile (open).
      svg.appendChild(svgEl('path', { d: 'M43 64 Q50 70 57 64', stroke: '#5a3a1a', 'stroke-width': '2.5', fill: 'none', 'stroke-linecap': 'round' }));
    } else if (v.kind === 'blond') {
      // Blond swoop.
      svg.appendChild(svgEl('path', {
        d: 'M33 46 Q29 24 50 24 Q71 24 67 46 Q62 32 50 32 Q38 32 33 46 Z', fill: '#f0c040'
      }));
      svg.appendChild(svgEl('path', { d: 'M43 64 Q50 69 57 64', stroke: '#7a4a21', 'stroke-width': '2', fill: 'none', 'stroke-linecap': 'round' }));
    } else {
      // Red cap + beard.
      svg.appendChild(svgEl('path', { d: 'M31 42 A19 16 0 0 1 69 42 Z', fill: '#c0392b' }));
      svg.appendChild(svgEl('rect', { x: '28', y: '40', width: '44', height: '6', rx: '3', fill: '#a93226' }));
      svg.appendChild(svgEl('path', {
        d: 'M36 56 Q35 76 50 78 Q65 76 64 56 L64 52 Q58 60 50 60 Q42 60 36 52 Z', fill: '#6b4a2f'
      }));
      svg.appendChild(svgEl('path', { d: 'M43 64 Q50 69 57 64', stroke: '#7a4a21', 'stroke-width': '2', fill: 'none', 'stroke-linecap': 'round' }));
    }

    // Eyes (shared, drawn last so they sit above hair/beard edges).
    svg.appendChild(svgEl('circle', { cx: '43', cy: '48', r: '2.4', fill: '#222' }));
    svg.appendChild(svgEl('circle', { cx: '57', cy: '48', r: '2.4', fill: '#222' }));
    if (v.kind === 'cowboy') {
      svg.appendChild(svgEl('path', { d: 'M44 64 Q50 68 56 64', stroke: '#2a1a0c', 'stroke-width': '2', fill: 'none', 'stroke-linecap': 'round' }));
    }
    return svg;
  }

  // Rounded-square avatar frame with a coloured border, as in the reference.
  function createAvatar(idx) {
    var v = AVATARS[((idx % AVATARS.length) + AVATARS.length) % AVATARS.length];
    var frame = el('div', 'avatar-frame');
    frame.style.borderColor = v.frame;
    frame.appendChild(avatarSVG(v));
    return frame;
  }

  var api = {
    createCard: createCard,
    createBack: createBack,
    createDeckBack: createDeckBack,
    createMiniBacks: createMiniBacks,
    createAvatar: createAvatar,
    AVATARS: AVATARS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ThullaCards = api;
  if (typeof root !== 'undefined') root.ThullaCards = api;
})(typeof self !== 'undefined' ? self : this);
