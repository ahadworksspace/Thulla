// Card DOM rendering for Bhabhi Thulla.
// Cards are drawn with pure CSS/HTML — no external card images.
// A card shows rank + suit in the top-left and bottom-right corners and a
// large centre suit symbol. Hearts/diamonds are red, spades/clubs black.
// Card backs use a deep-green felt pattern with a gold border.
(function (root) {
  'use strict';

  function el(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text !== undefined && text !== null) d.textContent = text;
    return d;
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
    var pip = el('div', 'pip', suit);

    card.appendChild(tl);
    card.appendChild(pip);
    card.appendChild(br);

    if (opts.label) card.appendChild(el('div', 'card-label', opts.label));
    if (opts.onClick) card.addEventListener('click', function () { opts.onClick(cardId); });
    return card;
  }

  // A face-down card (card back).
  function createBack(opts) {
    opts = opts || {};
    var card = el('div', 'card back' + (opts.small ? ' small' : ''));
    card.appendChild(el('div', 'back-pattern', '✦'));
    return card;
  }

  // A small stack of mini face-down cards used to show another player's
  // remaining card count (up to 5 minis, plus a number badge).
  function createMiniBacks(count) {
    var wrap = el('div', 'mini-backs');
    var shown = Math.min(count, 5);
    for (var i = 0; i < shown; i++) wrap.appendChild(createBack({ small: true }));
    if (count > 0) wrap.appendChild(el('div', 'count-badge', String(count)));
    return wrap;
  }

  var api = { createCard: createCard, createBack: createBack, createMiniBacks: createMiniBacks };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ThullaCards = api;
  if (typeof root !== 'undefined') root.ThullaCards = api;
})(typeof self !== 'undefined' ? self : this);
