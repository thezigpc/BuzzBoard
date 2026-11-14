# Buzz Board: project notes

A quiz-board game for the **Bar Games box** ("Venuebox"), and playable standalone. A board
of categories and point values is on the venue's TV; players buzz in from their phones; a
host runs the game. It joins Bingo and No Filter in the venue's games list.

**Status: 0.1.3 released (2026-11-14; 0.1.0 on 2026-11-12).** The repo is `thezigpc/BuzzBoard` (public), the
image `ghcr.io/thezigpc/buzzboard:0.1.0` pulls anonymously, and the platform session was
asked to install it on the box. See "As built" below, [README.md](README.md) for
players and operators, and [BARGAMES.md](BARGAMES.md) for the box integration report.
The repo's git identity is set locally (`thezigpc`, the GitHub noreply address), as in Bingo.

## What it is (the format)

- **The board:** 5 or 6 categories, 5 clues each, worth rising points (100 to 500 by
  default; a second round can double them). Picking a square shows its clue on the TV.
- **Buzzing in:** when the host opens the buzzers, the first phone to buzz gets to answer.
  The server decides who was first (its clock, not the phones'), and locks the rest out.
- **Judging:** the host marks the answer right (points added, that player picks next) or
  wrong (points taken off, buzzers reopen for the others). A timer ends an unanswered clue.
- **"Double Down" squares:** one or two hidden squares per round where only the player who
  picked it answers, after wagering up to their score (or the round's top value).
- **"Last Call":** the final round. One clue; everyone wagers in secret, types an answer
  on their phone, and the host reveals and judges them one by one.
- **Winner:** highest score after Last Call.

Answers "in the form of a question" are **not** required; judging is the host's call.

### The smaller rules, as decided while building (2026-11-12)

Change these only on purpose; `test/specs/02-game-flow.test.mjs` pins each one.

- **Who scores:** a "contestant" is a team, or one player in a solo room. Teams are a
  room setting, fixed once the game starts. In a team room players pick or name a team
  when they join, and can switch in the lobby. A team with nobody left is removed.
- **Control:** each round starts with the lowest score in control (the earliest to join on
  a tie). A right answer takes control; a wrong answer or a timeout leaves it where it
  was. The host can hand it to anyone, and always taps the squares; the room setting
  "players pick" lets the contestant in control tap one on their own phone too.
- **Points:** 100 to 500 by row. Round 2 is worth double (a room setting, on by default).
- **Wrong answers** take the clue's value off and lock that contestant (the whole team)
  out of that clue; the buzzers reopen on a fresh clock for the rest. "Wrong answers
  cost" can be turned off. When everyone has been wrong, the answer goes up.
- **The buzz clock** is 10 s by default (3 to 60). There is no clock on the answer: the
  host judges when they've heard enough.
- **A square picked by mistake** can be put back until the buzzers open.
- **Double Down:** 1 per round by default (0 to 2), never in the cheapest row. Only the
  contestant in control answers. Wager: 5 up to their score, or up to the round's top
  value if that's more. A miss always costs the wager. The clue stays hidden until the
  wager is in; the host can type the wager for them. With nobody in control it plays as
  an ordinary clue.
- **Skipping:** the host can end a round early ("Skip to …"); unplayed squares are lost.
- **Last Call:** played when the board has one and the room setting is on. Everyone in
  the room when it starts plays, whatever their score. Wager: 0 up to their score, or up
  to the last round's top value if that's more (so nobody is shut out). No wager in
  time counts as 0. Any phone on a team can set the wager and the answer; the last one
  sent counts. 45 s to answer by default (15 to 180), or the host locks early. Answers
  are revealed from the lowest score up; the host judges each.
- **Winner:** the highest score; a tie is a shared win. Scores can go below zero.
- **Latecomers** join on 0 at any time, but only watch a Last Call already under way.
- **The host doesn't play.** In a room whose host seat is open (`firstJoinerHosts`), the
  first phone to join becomes the host.
- **Play again** returns to the lobby with the same players on 0.

## Names and content: keep it original

- The game is **Buzz Board**. Its own terms: "Double Down" (the wager square), "Last Call"
  (the final round), "clue", "board", "buzz in".
- **Never use** the name, logo, look, music, sound effects or wording of the TV show this
  format resembles, or its trademarked terms ("Jeopardy!", "Daily Double", "Final
  Jeopardy", "Double Jeopardy"), anywhere: UI, code identifiers, docs, sample data, the
  README. The general format (a category board, buzzing in) is fine; the show's identity
  and its clue archive are not.
- **Clues are the venue's own.** Ship a few short original sample boards written for this
  project (general knowledge, bar-friendly). Never copy clues from the show or from clue
  archives. Staff build and edit boards in the admin, and can import/export a board as a
  JSON or CSV file.
- Visual design: the venue's theme from the box (colors, font, logo), not a blue-board
  look-alike.

## Roles and screens

| Role | Device | What it does |
|---|---|---|
| **TV** (`table`) | the venue's TVs, cast by the box | the board, the current clue, who buzzed, scores, the join QR. No controls. |
| **Host** | staff iPad or a phone | picks squares (or lets the last correct player pick), opens buzzers, judges, runs wagers and Last Call. Sees the answer; the TV never does until revealed. |
| **Player** | phone | joins by QR or code with a name, one big Buzz button, wager and Last Call inputs, their score. |

- **Teams or solo:** support both (a setting per room). In a bar, teams per table are
  common: several phones on one team, any of them can buzz.
- **Room kinds:** `venue` (staff start it from the box; the first joiner can be the host
  when the box says so, see `firstJoinerHosts`) and `patron` (a customer hosts for their
  own table, on their phone, with or without a TV).
- A player who reloads or loses signal keeps their seat and score (the kit's session store
  and `useRoomConnection`).

## The platform: read these first

The box, its SDK and the shared game kit are the user's other projects:

- **Integration guide (the contract):** `C:\CodeProjects\GameBroker\integration\README.md`.
  Read "The rules", "Integration levels" and every "What's new" section down from 0.11.
- **Game kit:** `C:\CodeProjects\GameKit\README.md` and `CHANGELOG.md`. Use it for rooms,
  room codes, admin sign-in, sockets, sessions, logging and storage instead of rewriting them.
- **A finished game to copy from:** `C:\CodeProjects\BingoDigitalGame` (same stack, level 3,
  roles host/table/player, claims the host confirms). `C:\CodeProjects\NoFilterGame` is the
  other. Read their `CLAUDE.md` and `BARGAMES.md` for how they met each rule.
- Vendored here: `vendor/bargames-sdk-0.13.2.tgz`, `vendor/bargames-gamekit-0.7.4.tgz`
  (install them as file dependencies, as Bingo does).

### Rules that are easy to miss

1. **Standalone must work unchanged.** Off a box the SDK does nothing: no theme, no events,
   box headers ignored. The game runs by itself with `docker compose up`.
2. **Stack:** npm workspaces (`shared/`, `server/`, `client/`), TypeScript, Express 4,
   socket.io, React 18 + Vite 5, Node 22 image, `node:test` tests. Same as Bingo.
3. **Runs under a path** (`https://venue/buzzboard/`): `serveSpa` from the kit, Vite
   `base: "./"`, `serverBase()` for fetches, `socketPath()` for socket.io, router
   `basename={basePath()}`, links from `bg.publicUrl()` / `joinUrl()`. Declared as
   `"routing": { "basePath": true }`. Test with `npx bargames mock-box --base /buzzboard`
   (in Git Bash set `MSYS_NO_PATHCONV=1`, or use PowerShell).
4. **Level 3:** commands the box's iPad can send (`create_room`, `start`, `next_round`,
   `end`, and this game's own) and a status provider listing open rooms (code, kind, phase,
   players, `joinPath`). `create_room` must honor `firstJoinerHosts`.
5. **Events** the box and Home Assistant hear: `room_created`, `room_closed`,
   `players_changed`, `round_started`, `round_ended`, `winner`, `game_over`, and
   `bg.reportResults()` at the end so the venue leaderboard counts the win.
6. **Shared address:** every game is on one hostname. Prefix every storage key
   (`buzzboard_…`), set no `Path=/` cookies, no service worker.
7. **Admin:** the box's password signs staff in (`createAdminAuth({ venuePassword, onBox })`,
   `adminRouter({ trusted: bg.isStaff })`, `staffSignIn()`), and `<BoxAdminLink>` sits at
   the top of `/admin`.
8. **Announcements and countdowns:** `<VenueAnnouncement>` at the app root (TV view too:
   it hides itself where it doesn't belong), and lift bottom-fixed bars (the Buzz button!)
   with `bottom: var(--bargames-announcement-bottom, 0px)`; the TV board's height is
   `calc(100vh - var(--bargames-announcement-top, 0px) - var(--bargames-announcement-bottom, 0px))`.
9. **TV view:** call `tableMode()` / `markSharedScreen()`; show the join QR from the box's
   address; no controls; readable from across a room (the idle TV is 1080p).
10. `npx bargames check` must pass before every release.

## Buzzing fairly (the hard part)

- The server stamps each buzz on arrival and picks the earliest; ties go to the earlier
  socket event. Phones never decide.
- Buzzers open only when the host opens them (after reading the clue). A buzz before that
  is ignored and locks that player out for a short penalty (a setting, default 250 ms), so
  mashing early doesn't win.
- Show every phone the result at once: who got it, and "locked" for the rest.
- WebSocket first (the kit's `SOCKET_OPTIONS`); a buzz must never ride long-polling.
- Test it: specs with several fake clients buzzing within a few milliseconds.

## Release and the box

- Repo: create `thezigpc/BuzzBoard` on GitHub (public, like the other games) when the user
  says so. Image `ghcr.io/thezigpc/buzzboard:<version>`, built by
  `.github/workflows/publish-image.yml` when `bargames.json` changes on main. The first
  run is started by hand, and the package must be made Public once.
- **Never commit infrastructure details** (IPs, hostnames, logins, key names): this repo
  will be public. Machine-specific notes go in `CLAUDE.local.md` (git-ignored).
- **Installing and updating on the box is the platform session's job.** When a release is
  published and its image pulls anonymously, message the session named `gamebroker-…`
  (ListAgents shows it) with the version; it runs the install/update on the box. First
  install: tell it the repo URL. Report SDK or kit bugs and gaps to it the same way.
- Commit and push only when the user asks; they have allowed the platform session to
  relay push requests for releases.

## As built (2026-11-12)

Layout: npm workspaces, the same shape as Bingo.

- `shared/src/board.ts`: the board model, `sanitizeBoard()` (the one validator for the
  editor, imports and the saved file), `valueFor()`, and CSV / JSON import and export.
  `samples.ts`: the three sample boards (original clues). `protocol.ts`: socket events,
  `RoomView`, settings and their limits, error strings.
- `server/src/rooms/Room.ts`: the whole game as a server-side state machine. Phases
  `lobby`, `board`, `clue` (stages `wager`, `reading`, `open`, `answering`, `revealed`),
  `roundEnd`, `lastCall` (stages `wager`, `answer`, `reveal`), `final`. It builds a view
  per member: only the host's view carries an answer before it's revealed. It implements
  the kit's `KitRoom`. The room copies its board at `startGame`, so admin edits never
  touch a game in progress.
- `server/src/socket/index.ts`: intents. `on()` runs a Room method then broadcasts;
  `onHost()` adds the host check. **`buzz` has its own handler** (see below).
- `server/src/boards.ts`: the venue's boards in `DATA_DIR/boards.json`, plus the samples
  (read-only). `admin/`: the kit's auth and router, settings (`roomIdleMinutes`,
  `defaultBoardId`), board routes. `bargames.ts`: the one connection to the SDK.
- `client/src/pages`: `HomePage` (join, host, `/join/:code`), `RoomPage` (resumes the
  seat; `?role=table` joins as a TV by itself), `HostView`, `PlayerView`, `TableView`,
  `AdminPage`; `components/BoardEditor.tsx` (the editor, import, export),
  `TvsPanel.tsx` (casting, box only), `bits.tsx` (grid, scores, timer bar, QR).
- `test/specs/`: 54 specs. `harness.mjs` starts a throwaway server per spec file;
  `tinyBoard()` is a 2x2 board so games are short.

**The buzzer** (the brief's "hard part"):
- The socket handler stamps `preciseNow()` (the server's clock, sub-millisecond) before
  anything else and passes it to `Room.buzz()`. Node runs one event at a time, so the
  first buzz handled while the stage is `open` wins; nothing a phone sends is trusted.
- An early buzz (stage `reading`) sets that **phone's** `penaltyUntil = now + penalty`,
  and tells only that phone. Each further early press renews it, so a masher stays
  locked while a teammate who waited can still buzz.
- `buzz()` returns who needs a new view (`all`, `self`, `none`): ignored buzzes
  broadcast nothing, so mashing can't flood the room. The winning buzz broadcasts to
  every member in one tick.
- The first buzz and up to three runners-up are kept with their milliseconds after
  the buzzers opened; the host's screen shows them.
- A buzz from a socket whose transport isn't `websocket` is refused (`SLOW_LINK`). The
  client uses the kit's `SOCKET_OPTIONS` (WebSocket first) and shows "Reconnecting" in
  place of the buzzer while it has no WebSocket (`canBuzz()` in `client/src/socket.ts`).
- The button fires on `pointerdown`, not on the click that follows.

**Things that bit while building:**
- The join address under a QR: `joinInfo()` (SDK `joinDisplay`: the box's short room link
  when there is one, else the game's address) printed by the kit's `<JoinAddress>` via
  `Address` in `bits.tsx`. Keep each box's width cap in CSS, never let a long address widen
  it; the floor is `--join-min-size`, no `!important`. Test with `mock-box --public-url
  https://<a long invented address>/buzzboard`.
- The TV's root element must not carry a class that a child also uses: `tv-${phase}`
  collided with `.tv-clue` and `.tv-lobby`, so the root's classes are `tv phase-<phase>`.
- `reportResults()` makes the box emit `game_result`. SDK 0.11.4+ no longer needs it
  listed in `bargames.json` `events`; it stays listed, which is harmless.
- Shell heredocs with several files in one Git Bash call failed here; write files with
  the editor tools.

**Verifying a change:**
1. `npm run test:build`.
2. `npx bargames validate .`, then the mock box. Start it from PowerShell:
   `npx bargames mock-box . --base /buzzboard --port <p> --core-port <p> --game http://127.0.0.1:<port>`,
   run the server with the env it prints, and `npx bargames check --game http://127.0.0.1:<port>`.
   Use spare ports: other projects' mock boxes and dev sites hold the defaults.
3. A browser walk-through (Playwright, host + two phones + a 1920x1080 TV) at the root
   and through the mock gateway under `/buzzboard`. Check the TV for scrolling, anything
   off screen, and text under about 3vh.

**Not built** (only when asked): sounds, a timer on the spoken answer, per-clue images,
a host-run TV ("host on this screen"), more than two rounds.

**Docker:** this PC has no Docker. The image is built only by the publish workflow (the
0.1.0 run succeeded from a clean checkout).
