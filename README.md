# Bhabhi Thulla

A complete, free, static web game of **Bhabhi Thulla** — the classic Punjabi shedding card game, also known as **Getaway**. No accounts, no sign-up, no server, no paid services. Just open the link and play.

**Live game:** host it with GitHub Pages (see below) and share the link — anyone can open it and play.

## How to play

**Goal:** get rid of all your cards. The last player still holding cards is the **Bhabhi** (the loser).

**In 30 seconds:**
1. Whoever holds the **Ace of Spades** starts by playing it.
2. On your turn, play a card of the same suit as the card that was led — if you have one.
3. If you don't have that suit, you may play any card — that is a **Thulla**. It ends the trick at once, and the player with the highest card of the led suit picks up all the cards played.
4. Play your last card and you escape, safe. The last player left holding cards is the Bhabhi!

## Full rules

- **Deck:** standard 52-card deck, no jokers. Ranks high to low: A K Q J 10 9 8 7 6 5 4 3 2. There are no trump suits. Play goes clockwise.
- **Deal:** all 52 cards are dealt. With 3 players the hands are 18 / 17 / 17; with 4 players everyone gets 13 cards.
- **First trick:** the player holding the **Ace of Spades must lead it** face-up. Every other player plays one card clockwise. Players holding a spade must play a spade; players with no spade may play any card. A Thulla does **not** stop the first trick — everyone still plays. All first-trick cards go to the waste pile, and the Ace of Spades holder leads the second trick.
- **Later tricks:** the leader plays any card. Each following player **must** play a card of the led suit if they hold one. If they hold none, they may play any card — that off-suit card is the **Thulla** (also called *tochoo*). A Thulla ends the trick immediately: players after the Thulla player do not play.
- **Clean trick** (everyone followed suit): the cards are discarded to the waste pile, and the player who played the **highest card of the led suit** leads the next trick.
- **Thulla trick:** the player who played the highest card of the **led suit** picks up **all** the cards played in that trick and leads the next trick.
- **Getting away:** a player who plays their last card is out and safe.
- **House rule (power edge case):** if a player's last card was the highest of the led suit in a clean trick, they would normally hold the power to lead — but they have no cards left. In this game they are out and safe, and the lead passes to the next active player clockwise.
- **The Bhabhi:** play continues until only **one** player still holds cards — that player is the Bhabhi. **Tiebreak:** if all remaining players empty their hands on the same trick, the player who **led** that trick is the Bhabhi.
- **Scoreboard:** the game counts how many times each player has been the Bhabhi across rounds in the session. Tap **Play Again** for another round.
- **Illegal play is impossible:** the game only ever lets you tap a legal card — playable cards glow, the rest are dimmed.

## Two modes

### 1. Play vs Bots (offline)
Choose 3 or 4 players in total. The other seats are bots. Bots act after a short pause and always play legal cards: they lead with the lowest card of their longest suit, follow suit with their lowest card of that suit, and Thulla with their lowest card overall.

### 2. Play with Friends (online, no accounts)
1. Enter your name, tap **Play with Friends**, then **Create a Room**. You get a **6-digit room code** and a shareable game link.
2. Share the code or the link with your friends. They open the link (the code is already filled in), enter their name, and tap **Join Room**.
3. The host taps **Start Game** when 3–4 players are in the room (minimum 3, maximum 4 — extra joiners get a "room full" message).
4. The host's browser runs the game and checks every move; each player only sees their own hand plus public info (other players' card counts, the table, the log).

Friends connect directly to each other with WebRTC through the free public PeerJS cloud — there is no game server and no account. If a friend disconnects mid-game, a bot takes over their seat so the game can continue. If the host leaves, the game ends for everyone with a clear message.

## Hosting on GitHub Pages

This game is 100% static (HTML/CSS/JS only). To put it online for free:

1. Push this folder to a public GitHub repository (e.g. `Thulla`).
2. On GitHub, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**, branch **main**, folder **/ (root)**.
4. Save. After a minute or two the game is live at `https://<your-username>.github.io/<repo>/`.
5. Share that link. Friends who open a link like `https://<your-username>.github.io/<repo>/?room=482913` get the room code pre-filled.

To play locally without hosting, serve the folder with any static server (for example `python3 -m http.server` inside the folder, then open `http://localhost:8000`). The bots mode also works by opening `index.html` directly, but the friends mode needs `http(s)` because browsers restrict WebRTC on `file://` pages.

## Files

| File | What it does |
|---|---|
| `index.html` | All screens: Home, Bots setup, Friends lobby, Table, Result, Rules |
| `css/style.css` | Dark green felt table, gold accents, responsive mobile-first layout |
| `js/engine.js` | Pure game logic (deck, deal, legal moves, trick resolution, escape/Bhabhi detection) — no DOM, shared by both modes and by the tests |
| `js/cards.js` | CSS-drawn cards (no external images) and card backs |
| `js/bots.js` | Bot strategy (always legal) |
| `js/net.js` | PeerJS wrapper: room create/join, CDN fallback (unpkg → jsdelivr) |
| `js/app.js` | UI flow, table rendering, host/client networking |
| `tests/engine.test.js` | Engine tests, runnable with plain `node tests/engine.test.js` |

## Tests

```bash
node tests/engine.test.js   # 14 tests, no dependencies
node --check js/engine.js js/cards.js js/bots.js js/net.js js/app.js
```

## Notes

- The only external dependency is PeerJS (loaded from a CDN, unpkg first with a jsdelivr fallback) for the friends mode. Everything else is self-contained.
- Cards are drawn with CSS, so there are no card image files to download.
- All text in the game is in English.
