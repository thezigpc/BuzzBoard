# Bar Games integration: Buzz Board

**Level reached: 3** (hosted, branded, connected, controllable), with `create_room`
(including `firstJoinerHosts`), casting from the host's screen, results for the venue's
leaderboards, staff sign-in and the box's admin password, running under a path prefix,
and announcements at the top or bottom of phones and TVs.

- **SDK:** 0.11.3, vendored at `vendor/bargames-sdk-0.11.3.tgz`.
- **Game kit:** 0.7.2, vendored at `vendor/bargames-gamekit-0.7.2.tgz`.
- **Manifest:** [bargames.json](bargames.json), Buzz Board `0.1.0`, port 3007, with
  `"routing": { "basePath": true }`.

```
$ npx bargames validate .
! image: not pinned by digest; releases should use image@sha256:…
✓ buzzboard@0.1.0 (sdk level 3)

$ npx bargames check --game http://127.0.0.1:3018
buzzboard@0.1.0 · level 3 · http://127.0.0.1:3018
✓ health /health → 200
✓ /__bargames/venue.json returns the box's branding ("Buzz Board (mock)")
✓ /__bargames/theme.css served
✓ "room_closed" declared (the box takes a closed room off the TVs at once)
✓ status refuses requests without the game token
✓ status → 0 room(s)
✓ unknown commands are rejected
✓ command "start" is wired (and refuses a missing room)
✓ command "next_round" is wired (and refuses a missing room)
✓ command "end" is wired (and refuses a missing room)
✓ create_room → room ZFDS (with hostUrl)
✓ status lists ZFDS as a venue room
✓ table view /room/ZFDS?role=table → 200
✓ end closes ZFDS
✓ ZFDS left status after "end"

all checks passed
```

Run on 2026-11-12 with the game under `/buzzboard` (`BG_BASE_PATH=/buzzboard`), behind
`npx bargames mock-box . --base /buzzboard --port 7087 --core-port 7187 --game
http://127.0.0.1:3018 --tv-pin 1234 --announce "Last call at 1:30" --announce-position
bottom`. The spare ports are because other projects hold the defaults on the dev PC;
inside the container the game listens on 3007, as the manifest says.

## Where things live

| File | What |
|---|---|
| `server/src/bargames.ts` | `bg` (the SDK instance), `clientIp`, `displayName`, `tvs` (casting), and `registerBarGames`: the kit's `wireBarGames` with `create_room`, `start` and `next_round` |
| `server/src/rooms/registry.ts` | The kit's `RoomRegistry` (codes, cap, idle sweep, close messages, `joinPath`) and `createVenueRoom()` |
| `server/src/rooms/Room.ts` | Implements the kit's `KitRoom`; emits the in-game events and reports results |
| `server/src/index.ts` | `app.use(bg.middleware())` before `/api` and the SPA; `/api/config`; `serveSpa`; the kit's `installShutdown` (flushes events) |
| `server/src/admin/routes.ts` | The kit's admin auth (`venuePassword`, `onBox`) and router (`trusted: bg.isStaff`) |
| `server/src/socket/index.ts` | `clientIp(socket.request)` for the join rate limit; host-only `listTvs`, `castToTvs`, `stopTvs` |
| `client/src/main.tsx` | `<VenueAnnouncement>` once at the root, for every page |
| `client/src/pages/HomePage.tsx` | `<BackToGames>` at the bottom of the landing page; the `?host=` link |
| `client/src/pages/RoomPage.tsx` | `?role=table` joins as a TV; `markSharedScreen()` and `tableMode()` on a box |
| `client/src/pages/AdminPage.tsx` | `<BoxAdminLink>`, `staffSignIn()` |
| `client/src/components/TvsPanel.tsx` | The host's "Venue TVs" control (box only) |
| `client/src/index.css` | `--venue-*` mapped onto the chrome; `--bargames-announcement-top/-bottom`; `--bg-safe-x/y` |
| `test/specs/06-bargames.test.mjs` | Standalone and on-a-box specs (15) |

## Events

Every event carries `roomCode` and `sessionKind` (`room.kind`). All are fire-and-forget;
off a box nothing is sent.

| Event | Emitted at | `data` |
|---|---|---|
| `room_created` | The kit's `wireBarGames`, from the registry | `{ title }` when the box gave one |
| `room_closed` | The kit's `wireBarGames`, on **every** close: host, box `end`, admin, idle sweep, a room's crash, shutdown | `{ reason: "host" \| "admin" \| "idle" \| "error" \| "shutdown" }` |
| `players_changed` | The kit's `wireBarGames`, from `rooms.notePlayers(room)`: joins, leaves, kicks (never reconnects) | `{ players }`, at most once per room per 2 s |
| `round_started` | `server/src/rooms/Room.ts:417` (each round of the board) and `:613` (Last Call) | `{ round, rounds, board }`; Last Call: `{ round, rounds, lastCall: true }` with `round = rounds + 1` |
| `round_ended` | `Room.ts:586` (a board round is cleared or skipped) and `:693` (Last Call is judged) | `{ round }` |
| `winner` | `Room.ts:694`, once per winner (several on a tie) | `{ name, score }` |
| `game_over` | `Room.ts:695` | `{ winners: string[] }` |
| `game_result` | Emitted by the SDK when `bg.reportResults()` runs (`Room.ts:698`) | `{ roomCode, results: [{ player: { name }, place, score }] }`; tied scores share a place |

In a team room the names are team names. Nothing else leaves the game: no clue text, no
answers, no tokens, socket ids or IPs (a spec checks this).

**Closed means gone:** the registry removes the room before `room_closed` fires.

**Not emitted:** `claim_pending`. A buzz is judged within seconds by the host who is
standing there; there is nothing for staff to resolve from the iPad.

## Commands

All in `server/src/bargames.ts`, through the kit's `wireBarGames`, which looks the room
up, refuses an unknown one, and turns a thrown `GameError` into `{ ok: false, message }`.
Each runs the same `Room` method as the host's socket intent, then `room.broadcast()`.

| Command | Room method | Refused when |
|---|---|---|
| `create_room` | `createVenueRoom()`: a `venue` room with an empty host seat. `hostUrl` is `/join/<code>?host=<seat token>`. With `args.firstJoinerHosts` the first phone to join takes the seat instead | The room cap is reached |
| `start` | `room.startGame()` (the host's Start). From the final screen it first calls `room.playAgain()`, so it starts another game with the same players | Unknown room. A game is in progress. Nobody has joined. |
| `next_round` | `room.nextRound()` (the host's "Skip to …" / "On to …"): the next round, then Last Call, then the final scores | Unknown room. The lobby. A clue is in play. Last Call (the host runs it). The final screen. |
| `end` | The kit closes the room like the host's "End the room" (cause `host`) | Unknown room |

`pause` / `resume` aren't implemented: nothing in the game advances by itself except
the buzz and Last Call clocks, which are seconds long.

**A venue room needs a host** to pick squares and judge answers: the staff iPad through
`hostUrl`, or a patron through `firstJoinerHosts`. The commands alone can start it and
move between rounds, but can't play a clue.

## Status

The kit's `overviews()`: `code`, `kind`, `players`, `phase` (`lobby`, `board`, `clue`,
`roundEnd`, `lastCall`, `final`), `round`, `title` (the box's title and the board's),
`hostConnected`, `hostName`, `tables`, `maxPlayers` (100), `createdAt`,
`lastActivityAt`, and `joinPath: /join/<code>`.

## Casting from the host's screen

The host's lobby shows "Venue TVs" only on a box that allows casting from games. It
lists the TVs, asks for the venue's TV PIN when required, and shows the box's own
messages. Server side: host-only `listTvs` / `castToTvs` / `stopTvs` call
`bg.displays()` / `bg.cast()` / `bg.stopCast()`. Casting uses a 30 s call timeout.

## The table (TV) route: `/room/{code}?role=table`

| Check | Result |
|---|---|
| The URL alone joins as a display | Yes. `RoomPage` sends `joinRoom { role: "table" }` by itself and keeps the seat's token for reloads. No name, no prompt, no tap. It retries for a few seconds if the server is restarting. |
| Nothing depends on audio | The game has no sound. |
| Fills 1920x1080, no scrolling, readable | `.tv` is exactly the viewport less any announcement strip, `overflow: hidden`, sized in `vh`/`vw`. The browser walk-through checks every phase for scrolling, anything off screen, and text under about 3vh. |
| Recovers by itself | The kit's `useRoomConnection` resumes on every socket connect; a room that's gone shows "Room closed". On a box `tableMode` shows the standard banners. |
| Light on animation | Only the timer bar moves. |
| No pointer needed | The TV view has no buttons, links or hover states. |
| Never shows an answer early | Views are built per member on the server; only the host's carries an answer before it's revealed. Specs check the TV's view for answers, wagers and Last Call entries. |

On a box the page is marked as a shared screen from its first paint
(`markSharedScreen()`), then `tableMode()` hides the pointer, keeps the screen awake and
sets the safe margins. The join QR and address come from the SDK's `joinUrl()`, so they
use the venue's public address.

## Branding and the shared address

- **Theme:** `--venue-bg`, `-surface`, `-text`, `-primary`, `-on-primary`, `-accent`,
  `-font` and `-radius` drive the page, panels, category headers, point values and
  primary buttons, each with the game's own value as the fallback. Colors that carry
  meaning stay fixed: right (green), wrong (red), the live buzzer and timer (yellow).
- **Name:** `/api/config` returns the venue's name for the game on a box.
- **Logo:** the TV's header shows `theme.logoUrl` when the venue has one.
- **Announcements:** `<VenueAnnouncement>` at the root. The Buzz button and toasts sit
  above a bottom strip (`bottom: var(--bargames-announcement-bottom, 0px)`), and the TV's
  height subtracts both strips.
- **"← All games":** the landing page only.
- **Under a path:** `serveSpa`, Vite `base: "./"`, `serverBase()` for every fetch,
  `socketPath()` for socket.io, `basename={basePath()}`. The walk-through through the
  mock gateway under `/buzzboard` made no request outside the prefix, and every
  WebSocket was `/buzzboard/socket.io/`.
- **One origin for every game:** all storage keys start with `buzzboard_` (the kit's
  session store, and `buzzboard_admin_token`). No cookies, no service worker.

## Admin

`routes.admin` is `/admin`. Staff signed in to the box get a session without a password
(`staffSignIn()`); the box's admin password signs in too; on a box only staff the box
vouches for may set a separate game password. `<BoxAdminLink>` is at the top of the
page. The admin holds the venue's boards, the board new rooms start on, the room list
and the idle time.

## Container

- `node:22-slim`, `USER node` (uid 1000), `PORT` from the environment (3007 by default).
- **Written under `/data` only:** `admin.json` (password hash), `settings.json`,
  `boards.json`. Nothing is written anywhere else; the server makes no outbound calls
  except to the box's core.
- `docker-compose.yml` runs it standalone with `read_only: true`, a `/tmp` tmpfs and
  `cap_drop: ALL`.
- **Not yet run in a container.** The dev PC has no Docker, so neither `docker build`
  nor the read-only run has been tried. The Dockerfile has the same shape as Bingo's.
  A copy of the files that would be committed built and passed its tests from scratch
  (`npm ci`, `npm run build`, `npm test`).

## Standalone

With no `BG_*` variables: `/api/config` returns `GAME_NAME` or "Buzz Board",
`/__bargames/venue.json` says `standalone: true`, the box endpoints answer 401, gateway
headers are ignored (staff headers grant nothing, the rate limit uses the real client
IP), the box's password is never accepted, the TVs panel renders nothing, and a whole
game runs with nothing sent anywhere. Specs cover each of these, and the same browser
walk-through passes at the root with no box.

## The image

- **Name:** `ghcr.io/thezigpc/buzzboard:0.1.0` (the tag equals `version`).
- **Workflow:** `.github/workflows/publish-image.yml` is in place. **It has not run:**
  the repo isn't on GitHub yet and nothing is committed.
- **Still to do, when the user asks for the first release:** create
  `thezigpc/BuzzBoard`, push `main`, start the first run by hand, make the package
  public, and check the image pulls anonymously.

## SDK and kit requests

1. **`game_result` must be declared.** `bg.reportResults()` emits `game_result`, and the
   mock box flags it as undeclared unless `bargames.json` lists it in `events`. The
   integration guide's 0.9.0 notes and events table don't say so. Either say it in the
   guide, or have the box accept `game_result` from any game that reports results.
2. **`bargames check` doesn't exercise `firstJoinerHosts`.** A check that sends
   `create_room` with the flag and reads `hostOpen`-style state back would need a
   convention for status; noted in case it's wanted.
