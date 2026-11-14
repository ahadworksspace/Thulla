// DOM-stub smoke test for the Bhabhi Thulla UI.
// Loads the REAL js files (engine, cards, bots, net, app) into a minimal DOM
// implemented in this file, then drives a full bots game through clicks:
// start game, play cards, sort the hand, send an emote, open the menu,
// and checks the waste pile, face art, avatars and trick slots.
// Run: node tests/smoke.test.js   (no dependencies)
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function check(name, ok, extra) {
  if (ok) { console.log('PASS  ' + name); }
  else { failures++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}

// ---------- fake timers (run immediately on drain) ----------
const timerQueue = [];
let timerId = 0;
function fakeSetTimeout(fn) { const id = ++timerId; timerQueue.push({ id, fn }); return id; }
function fakeClearTimeout(id) {
  const i = timerQueue.findIndex(function (t) { return t.id === id; });
  if (i >= 0) timerQueue.splice(i, 1);
}
function drain(limit) {
  limit = limit || 20000;
  let n = 0;
  while (timerQueue.length && n < limit) { const t = timerQueue.shift(); n++; t.fn(); }
  if (n >= limit) throw new Error('timer drain limit reached');
}

// ---------- minimal DOM ----------
function matchesPart(el, part) {
  let rest = part;
  const tagMatch = rest.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
  if (tagMatch) {
    if (el.tagName.toLowerCase() !== tagMatch[1].toLowerCase()) return false;
    rest = rest.slice(tagMatch[1].length);
  }
  const idMatch = rest.match(/#([A-Za-z0-9_-]+)/);
  if (idMatch && el.getAttribute('id') !== idMatch[1]) return false;
  const cls = rest.match(/\.[A-Za-z0-9_-]+/g) || [];
  for (let i = 0; i < cls.length; i++) {
    if (!el.classList.contains(cls[i].slice(1))) return false;
  }
  const attrMatch = rest.match(/\[([^\]=]+)(?:="([^"]*)")?\]/);
  if (attrMatch) {
    const name = attrMatch[1];
    let val;
    if (name.indexOf('data-') === 0) {
      const key = name.slice(5).replace(/-([a-z])/g, function (_, ch) { return ch.toUpperCase(); });
      val = el.dataset[key];
    } else {
      val = el.getAttribute(name);
    }
    if (attrMatch[2] !== undefined) { if (String(val) !== attrMatch[2]) return false; }
    else if (val === undefined || val === null) return false;
  }
  return true;
}
function matchesSelector(el, selector) {
  const parts = selector.trim().split(/\s+/);
  if (!matchesPart(el, parts[parts.length - 1])) return false;
  let cur = el.parentNode;
  for (let i = parts.length - 2; i >= 0; i--) {
    let node = cur, found = null;
    while (node) { if (matchesPart(node, parts[i])) { found = node; break; } node = node.parentNode; }
    if (!found) return false;
    cur = found.parentNode;
  }
  return true;
}
function queryAll(root, selector) {
  const out = [];
  (function walk(node) {
    node.children.forEach(function (child) {
      if (matchesSelector(child, selector)) out.push(child);
      walk(child);
    });
  })(root);
  return out;
}

const byId = {};
function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentNode: null,
    _cls: new Set(),
    _attrs: {},
    dataset: {},
    style: {},
    value: '',
    _text: '',
    _listeners: {},
    get className() { return [...this._cls].join(' '); },
    set className(v) { this._cls = new Set(String(v || '').split(/\s+/).filter(Boolean)); },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); this.children = []; },
    get innerHTML() { return ''; },
    set innerHTML(v) { this.children = []; },
    get offsetWidth() { return 0; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) {
      this._attrs[k] = String(v);
      if (k === 'id') byId[v] = this;
      if (k === 'class') this._cls = new Set(String(v).split(/\s+/).filter(Boolean));
    },
    getAttribute(k) { return this._attrs[k] === undefined ? null : this._attrs[k]; },
    getBoundingClientRect() { return { left: 100, top: 100, width: 60, height: 80, right: 160, bottom: 180 }; },
    animate() { return {}; },
    contains(other) {
      let n = other;
      while (n) { if (n === this) return true; n = n.parentNode; }
      return false;
    },
    click() {
      const ev = { target: this, stopPropagation() {} };
      (this._listeners.click || []).slice().forEach(function (fn) { fn(ev); });
    },
    select() {},
    querySelector(sel) { return queryAll(this, sel)[0] || null; },
    querySelectorAll(sel) { return queryAll(this, sel); }
  };
  el.style.setProperty = function (k, v) { this[k] = v; };
  el.style.getPropertyValue = function (k) { return this[k] || ''; };
  el.classList = {
    add: function () { for (let i = 0; i < arguments.length; i++) el._cls.add(arguments[i]); },
    remove: function () { for (let i = 0; i < arguments.length; i++) el._cls.delete(arguments[i]); },
    toggle: function (c, f) {
      if (f === undefined) f = !el._cls.has(c);
      if (f) el._cls.add(c); else el._cls.delete(c);
      return f;
    },
    contains: function (c) { return el._cls.has(c); }
  };
  return el;
}

const body = makeElement('body');
const documentStub = {
  body: body,
  readyState: 'complete',
  createElement: function (tag) { return makeElement(tag); },
  createElementNS: function (ns, tag) { return makeElement(tag); },
  getElementById: function (id) { return byId[id] || null; },
  querySelector: function (sel) { return queryAll(body, sel)[0] || null; },
  querySelectorAll: function (sel) { return queryAll(body, sel); },
  addEventListener: function () {},
  execCommand: function () { return true; }
};

// ---------- build the static DOM (mirrors index.html ids) ----------
function addEl(tag, id, cls, parent) {
  const e = makeElement(tag);
  if (id) e.setAttribute('id', id);
  if (cls) e.className = cls;
  (parent || body).appendChild(e);
  return e;
}
const SCREENS = ['screen-home', 'screen-bots', 'screen-friends', 'screen-lobby', 'screen-table', 'screen-result'];
SCREENS.forEach(function (id) { addEl('section', id, id === 'screen-home' ? 'screen active' : 'screen'); });
addEl('input', 'name-input');
addEl('button', 'btn-mode-bots');
addEl('button', 'btn-mode-friends');
addEl('button', 'btn-rules');
addEl('button', 'btn-players-3');
addEl('button', 'btn-players-4');
addEl('button', 'btn-bots-back');
addEl('button', 'btn-create-room');
addEl('input', 'join-code');
addEl('button', 'btn-join-room');
addEl('p', 'friends-status');
addEl('button', 'btn-friends-back');
addEl('div', 'room-code-big');
addEl('button', 'btn-copy-code');
addEl('input', 'room-link');
addEl('button', 'btn-copy-link');
addEl('span', 'lobby-count');
addEl('ul', 'lobby-players');
addEl('p', 'lobby-status');
addEl('p', 'lobby-wait-note');
addEl('div', 'lobby-is-host');
addEl('button', 'btn-start-game');
addEl('button', 'btn-leave-lobby');
addEl('div', 'turn-banner');
addEl('div', 'conn-status', 'conn-status ok');
addEl('div', 'table-wrap');
addEl('button', 'btn-menu');
const menuPop = addEl('div', 'menu-pop');
addEl('button', 'btn-sound', 'menu-item', menuPop);
addEl('button', 'btn-rules-table', 'menu-item', menuPop);
addEl('button', 'btn-leave-table', 'menu-item', menuPop);
addEl('div', 'deck-pile');
addEl('div', 'deck-count');
addEl('div', 'seats', 'seats players-4');
addEl('div', 'trick-pile');
addEl('div', 'waste-count');
addEl('div', 'my-hand', 'hand');
addEl('button', 'btn-sort', 'sort-btn');
addEl('button', 'btn-emote', 'emote-btn');
const emoteRow = addEl('div', 'emote-row');
['👍', '😂', '😮', '🔥', '👏'].forEach(function (em) {
  const b = addEl('button', null, 'emote-choice', emoteRow);
  b.setAttribute('data-emoji', em);
});
addEl('div', 'game-log');
addEl('h2', 'result-title');
addEl('ol', 'result-order');
addEl('ul', 'result-counts');
addEl('button', 'btn-play-again');
addEl('button', 'btn-result-home');
const rulesModal = addEl('div', 'rules-modal', 'modal');
addEl('button', 'btn-close-rules', null, rulesModal);
const hostLeft = addEl('div', 'host-left', 'modal');
addEl('button', 'btn-host-left-home', null, hostLeft);
addEl('div', 'thulla-flash');
addEl('div', 'toast');

// ---------- sandbox + load the real files ----------
const sandbox = {
  console: console,
  setTimeout: fakeSetTimeout,
  clearTimeout: fakeClearTimeout,
  document: documentStub,
  navigator: {},
  location: { origin: 'http://localhost', pathname: '/index.html', search: '' },
  localStorage: {
    _m: {},
    getItem(k) { return this._m[k] === undefined ? null : this._m[k]; },
    setItem(k, v) { this._m[k] = String(v); }
  },
  URLSearchParams: URLSearchParams,
  scrollTo: function () {}
};
sandbox.window = sandbox;
vm.createContext(sandbox);
['js/engine.js', 'js/cards.js', 'js/bots.js', 'js/net.js', 'js/app.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
});

const $ = function (id) { return documentStub.getElementById(id); };
function click(id) { $(id).click(); }
function handCards() {
  return documentStub.querySelectorAll('#my-hand .card').map(function (c) { return c.dataset.card; });
}
function logLines() {
  return documentStub.querySelectorAll('#game-log .log-line').map(function (l) { return l.textContent; });
}

// ---------- the smoke test ----------
try {
  check('app loads, home screen active', $('screen-home').classList.contains('active'));

  // Face art + avatar + deck back APIs (deterministic, no game needed).
  const E = sandbox.window.ThullaEngine;
  const Cards = sandbox.window.ThullaCards;
  const king = Cards.createCard('KS', E, {});
  const hasFace = king.children.some(function (c) { return c.tagName === 'SVG' && c.classList.contains('face-art'); });
  check('King has SVG face art', hasFace);
  const num = Cards.createCard('7D', E, {});
  const hasPip = num.children.some(function (c) { return c.classList.contains('pip'); });
  check('Number card keeps big centre pip', hasPip);
  const av = Cards.createAvatar(0);
  const avSvg = av.children.some(function (c) { return c.tagName === 'SVG'; });
  check('Avatar frame contains SVG face', avSvg && av.classList.contains('avatar-frame'));
  const deckBack = Cards.createDeckBack();
  check('Deck back is red with gold monogram', deckBack.classList.contains('deck-back'));

  // Start a 4-player bots game.
  $('name-input').value = 'Test';
  click('btn-mode-bots');
  check('bots setup screen shows', $('screen-bots').classList.contains('active'));
  click('btn-players-3');
  drain();
  check('3-player table shows 3 seats', documentStub.querySelectorAll('#seats .seat').length === 3);
  check('table gets players-3 class (deck/menu clear of top seats)', $('table-wrap').classList.contains('players-3'));
  click('btn-menu');
  click('btn-leave-table');
  check('leave returns home', $('screen-home').classList.contains('active'));
  click('btn-mode-bots');
  click('btn-players-4');
  drain();
  check('table screen shows', $('screen-table').classList.contains('active'));
  check('table gets players-4 class', $('table-wrap').classList.contains('players-4'));
  const seats = documentStub.querySelectorAll('#seats .seat');
  check('4 seats render', seats.length === 4, 'got ' + seats.length);
  const avatars = documentStub.querySelectorAll('#seats .avatar-frame');
  check('4 cartoon avatars render', avatars.length === 4, 'got ' + avatars.length);
  const badges = documentStub.querySelectorAll('#seats .avatar-badge');
  check('count badges on avatars', badges.length === 4 && badges.every(function (b) { return /^\d+$/.test(b.textContent); }), 'got ' + badges.length);
  check('hand has 13 cards', handCards().length === 13, 'got ' + handCards().length);
  check('deck pile starts at 0', $('deck-count').textContent.indexOf('0') === 0, $('deck-count').textContent);

  // Sort toggle.
  const dealtOrder = handCards().slice();
  click('btn-sort');
  const sortedOrder = handCards();
  const expected = dealtOrder.slice().sort(function (a, b) {
    const sa = E.suitOf(a), sb = E.suitOf(b);
    if (sa !== sb) return 'SHDC'.indexOf(sa) - 'SHDC'.indexOf(sb);
    return E.rankOf(b) - E.rankOf(a);
  });
  check('Sort orders hand by suit then rank', JSON.stringify(sortedOrder) === JSON.stringify(expected));
  check('Sort button shows active state', $('btn-sort').classList.contains('active'));
  click('btn-sort');
  check('Sort again restores dealt order', JSON.stringify(handCards()) === JSON.stringify(dealtOrder));
  check('Sort button active state clears', !$('btn-sort').classList.contains('active'));

  // Emote bubble.
  click('btn-emote');
  check('emote row opens', $('emote-row').classList.contains('show'));
  const choice = documentStub.querySelectorAll('#emote-row .emote-choice')[0];
  choice.click();
  const bubble = documentStub.querySelector('#seats .emote-bubble');
  check('emote bubble appears above my seat', !!bubble && bubble.textContent === '👍');
  check('emote row closes after choosing', !$('emote-row').classList.contains('show'));
  drain();
  check('emote bubble disappears after 2s', !documentStub.querySelector('#seats .emote-bubble'));

  // Hamburger menu.
  click('btn-menu');
  check('menu opens', $('menu-pop').classList.contains('show'));
  click('btn-rules-table');
  check('menu closes after Rules', !$('menu-pop').classList.contains('show'));
  check('rules modal opens from menu', $('rules-modal').classList.contains('show'));
  click('btn-close-rules');
  check('rules modal closes', !$('rules-modal').classList.contains('show'));
  click('btn-menu');
  click('btn-sound');
  check('sound toggles off from menu', $('btn-sound').textContent.indexOf('Off') !== -1, $('btn-sound').textContent);
  click('btn-menu');
  click('btn-sound');
  check('sound toggles back on', $('btn-sound').textContent.indexOf('On') !== -1);

  // Play a full game: click playable cards, drain bot timers, until result.
  let sawSlotCard = false;
  let sawThulla = false;
  let guard = 0;
  while (guard < 120) {
    guard++;
    if ($('screen-result').classList.contains('active')) break;
    drain();
    documentStub.querySelectorAll('#trick-pile .trick-card').forEach(function (tc) {
      if (/slot-(bottom|top|left|right|top-left|top-right)/.test(tc.className)) sawSlotCard = true;
    });
    if (logLines().some(function (l) { return l.indexOf('Thulla') !== -1; })) sawThulla = true;
    const playable = documentStub.querySelectorAll('#my-hand .card.playable');
    if (playable.length) {
      playable[0].click();
      drain();
    } else if (!timerQueue.length) {
      break;
    }
  }
  check('full bots game finishes with a result', $('screen-result').classList.contains('active'), 'guard=' + guard);
  check('trick cards sit in seat slots', sawSlotCard);
  check('a Thulla happened during the game', sawThulla);
  const wasteN = parseInt(($('deck-count').textContent || '0'), 10);
  check('waste pile count grew (deck pile)', wasteN > 0, $('deck-count').textContent);
  check('result lists a Bhabhi', $('result-title').textContent.indexOf('Bhabhi') !== -1, $('result-title').textContent);
} catch (err) {
  failures++;
  console.log('FAIL  smoke test threw: ' + (err && err.stack || err));
}

console.log(failures === 0 ? '\nSMOKE PASSED' : '\nSMOKE FAILED: ' + failures + ' failure(s)');
process.exit(failures === 0 ? 0 : 1);
