# Buzz Board

A quiz-board game for bars. A board of categories and point values is on the TV, players
buzz in from their phones, and a host runs the game from a phone or tablet. It runs by
itself, or on a Bar Games venue box next to the venue's other games.

## How a game goes

1. **The host starts a room** and gets a four-letter code. Players scan the QR code (or
   type the code) and enter a name. The room is either everyone for themselves or
   **teams**: several phones share one score, and any of them can buzz.
2. **The board** has 5 or 6 categories of 5 clues, worth 100 to 500. Whoever is in control
   names a square; the host taps it and reads the clue out.
3. **Buzzing in.** The host opens the buzzers when they finish reading. The first phone
   to buzz answers out loud, and everyone else's phone says who got it. Buzzing before
   the buzzers open locks that phone out for a moment, so mashing early never wins.
4. **Judging.** Right: the points are added and that player picks next. Wrong: the points
   come off, and the buzzers reopen for everyone else. If the clock runs out, the answer
   goes up and nobody scores.
5. **Double Down.** One hidden square per round (the host can make it none or two). Only
   the player who picked it answers, after wagering up to their score, or up to the
   round's top value if that's more.
6. **A second round**, if the board has one, is worth double.
7. **Last Call.** One final clue. Everyone sees the category and wagers in secret, then
   types an answer before the clock runs out. The host reveals the answers one by one,
   lowest score first.
8. **The highest score wins.** Ties share the win.

Answers don't have to be phrased as a question. The host's call is final, and the host
can fix a score at any time.

## The three screens

| Screen | Where | What it shows |
|---|---|---|
| **Host** | a phone or tablet | The board to pick from, each clue **with its answer**, the buttons that run the game, the scores |
| **Player** | each player's phone | Their score, the clue in play, one big Buzz button, wagers and the Last Call answer |
| **TV** | any browser on a big screen | The board, the clue, who buzzed, the scores and how to join. Never an answer until the host reveals it. No controls |

The TV link is `/room/<CODE>?role=table`; the host's lobby has a button for it. A game
works without a TV too: the clue is on every phone.

**Co-hosts.** The host can tap **Add a co-host** and have someone scan the QR: a co-host
runs the game alongside (picks squares, opens the buzzers, judges, keeps score) and
doesn't play. The invite works once and expires after 10 minutes. Only the host can end
the room, remove players or remove a co-host (who then plays, starting on 0).

## Boards

Three sample boards ship with the game. A venue writes its own in **/admin**:

- **New board** opens the editor: a title, one or two rounds, up to six categories of
  five clues, and an optional Last Call. A row left empty isn't on the board.
- **Copy** any board (the samples included) and edit the copy.
- **Import a file** reads a JSON or CSV board into the editor. **Export** saves one.
- **Use for new rooms** picks the board new rooms start on. A host can still change it.

A CSV board has one line per clue:

```csv
title,Thursday Trivia
round,category,row,clue,answer
1,On the Map,1,This European country is shaped like a boot.,Italy
1,On the Map,2,Canada's capital city.,Ottawa
2,At the Movies,1,This 1997 film is about a ship that sank in 1912.,Titanic
last,The Night Sky,,The brightest star in the night sky.,Sirius
```

`round` is 1, 2 or `last` (the Last Call). `row` is 1 to 5, cheapest first; leave it
empty to fill the category in order. Export a board to get a file in the right shape.

## Run it

Needs Node 22.

```bash
npm install
npm run dev          # server on :3007, client on :5177 (open the client)
```

Or as one container:

```bash
docker compose up -d --build     # http://localhost:3007
```

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3007` | The port the server listens on |
| `GAME_NAME` | `Buzz Board` | The name on every screen |
| `ADMIN_PASSWORD` | unset | The `/admin` password. Unset: whoever opens `/admin` first chooses one, so do that right after deploying |
| `DATA_DIR` | `./data` (`/data` in the image) | Where the password hash, settings and boards are kept |
| `BASE_PATH` | unset | Serve under a path such as `/quiz`. Your proxy must strip the prefix |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |

The image runs as a non-root user (uid 1000) and writes only to `/data`. If `./data` was
created by root, run `sudo chown -R 1000:1000 ./data` once.

Players' phones connect by WebSocket. A proxy in front of the game must pass WebSockets
through: a buzz sent over long-polling is refused, because its arrival time says little
about when the button was pressed.

## Tests

```bash
npm run test:build   # builds, then runs the node:test specs under test/specs
```

Each spec file starts its own server on a free port and talks to it over real sockets.
`03-buzz.test.mjs` covers the buzzer: several phones buzzing within a few milliseconds,
early buzzes, and a player who mashes the button.

## On a Bar Games box

`bargames.json` is the manifest and [BARGAMES.md](BARGAMES.md) is the integration
report: the events, the commands, the TV view and the container. Off a box none of that
is active and the game behaves exactly as described above.
