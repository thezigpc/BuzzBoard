// Bar Games integration (BARGAMES.md): standalone the game runs by itself and the box
// endpoints stay shut; on a (fake) box the commands, status, events and results work.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { io } from "socket.io-client";
import { DEFAULT_GAME_NAME } from "@buzzboard/shared";
import { startServer, setupRoom, tinyBoard, post, sleep, scoreOf } from "../harness.mjs";

const TOKEN = "test-token";

const TVS = {
  enabled: true,
  pinRequired: true,
  displays: [
    { id: "roku:A1", name: "Bar left", busy: false, showingThisGame: false },
    { id: "roku:B2", name: "Bar right", busy: true, showingThisGame: true, roomCode: "WXYZ" },
  ],
};

/** A fake box core: serves the venue context and TVs, records every event, cast and result. */
async function fakeCore() {
  const events = [];
  const casts = [];
  const results = [];
  const passwordChecks = [];
  const json = (res, body) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return void res.writeHead(401).end();
      if (req.url === "/internal/events") {
        events.push(JSON.parse(body));
        return void res.writeHead(204).end();
      }
      if (req.url === "/internal/results") {
        results.push(JSON.parse(body));
        return void json(res, { ok: true });
      }
      if (req.url === "/internal/venue-password") {
        const b = JSON.parse(body);
        passwordChecks.push(b);
        return void json(res, { ok: b.password === "box-password" });
      }
      if (req.url === "/internal/displays") return void json(res, TVS);
      if (req.url === "/internal/cast" || req.url === "/internal/cast/stop") {
        const b = JSON.parse(body);
        casts.push({ url: req.url, ...b });
        if (b.pin !== "4321") return void json(res, { ok: false, message: "Wrong TV PIN" });
        return void json(res, { ok: true, results: Object.fromEntries(b.displayIds.map((id) => [id, { ok: true }])) });
      }
      if (req.url === "/internal/venue") {
        const theme = { colors: { background: "#0b2a2a", surface: "#12403f", text: "#f2fffd", primary: "#ff4fa3", accent: "#ffd23f" } };
        return void json(res, {
          protocol: 1,
          venue: { name: "Test Bar", theme },
          game: { id: "buzzboard", displayName: "Buzz Board at Test Bar", theme },
          standalone: false,
          generatedAt: new Date().toISOString(),
        });
      }
      res.writeHead(404).end();
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${srv.address().port}`,
    events,
    casts,
    results,
    passwordChecks,
    of: (type, code) => events.filter((e) => e.type === type && (!code || e.roomCode === code)),
    async waitFor(pred, label, ms = 5000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const hit = events.find(pred);
        if (hit) return hit;
        await sleep(25);
      }
      throw new Error(`no event: ${label}; got ${JSON.stringify(events.map((e) => e.type))}`);
    },
    close: () => new Promise((r) => srv.close(r)),
  };
}

/** Fails roomInfo `n` times with the given headers; returns the last ack. */
async function failJoins(url, headers, n) {
  const socket = io(url, { transports: ["websocket"], reconnection: false, forceNew: true, extraHeaders: headers });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  let last;
  for (let i = 0; i < n; i++) last = await new Promise((r) => socket.emit("roomInfo", { code: "ZZZZ" }, r));
  socket.close();
  return last;
}
const RATE_LIMITED = /too many/i;
const STAFF = { "x-bargames-via": "1", "x-bargames-staff": "1" };

describe("standalone (no BG_* env)", () => {
  let server;
  before(async () => (server = await startServer()));
  after(async () => server.stop());

  test("/api/config has the game's own name (or GAME_NAME); venue.json says standalone", async () => {
    assert.deepEqual(await (await fetch(`${server.url}/api/config`)).json(), { gameName: DEFAULT_GAME_NAME });
    const venue = await (await fetch(`${server.url}/__bargames/venue.json`)).json();
    assert.equal(venue.standalone, true);
    assert.equal(venue.game.displayName, DEFAULT_GAME_NAME);
    const named = await startServer({ GAME_NAME: "Quiz at Joe's" });
    try {
      assert.deepEqual(await (await fetch(`${named.url}/api/config`)).json(), { gameName: "Quiz at Joe's" });
    } finally {
      await named.stop();
    }
  });

  test("box endpoints are closed, and gateway headers are ignored", async () => {
    const auth = { authorization: `Bearer ${TOKEN}` };
    assert.equal((await fetch(`${server.url}/__bargames/status`, { headers: auth })).status, 401);
    assert.equal((await post(`${server.url}/__bargames/command`, { command: "start", roomCode: "ABCD" }, auth)).status, 401);
    const st = await (await fetch(`${server.url}/api/admin/status`, { headers: STAFF })).json();
    assert.equal(st.trusted, false);
    assert.equal(st.venueLogin, false);
    assert.equal((await fetch(`${server.url}/api/admin/trusted`, { method: "POST", headers: STAFF })).status, 403);
    assert.equal((await post(`${server.url}/api/admin/login`, { password: "box-password" })).status, 401);
  });

  test("venue TVs: hidden (enabled false) and refused off a box; host only", async () => {
    const { host, players } = await setupRoom(server, ["Ann"]);
    assert.deepEqual((await host.ok("listTvs")).tvs, { enabled: false, pinRequired: false, displays: [] });
    assert.equal((await host.ok("castToTvs", { ids: ["roku:A1"], pin: "1" })).result.ok, false);
    assert.equal((await host.ok("stopTvs", { ids: ["roku:A1"] })).result.ok, false);
    for (const ev of ["listTvs", "castToTvs", "stopTvs"]) {
      const res = ev === "listTvs" ? await players[0].emit(ev) : await players[0].emit(ev, { ids: ["roku:A1"] });
      assert.equal(res.ok, false, `${ev} from a player`);
      assert.match(res.error, /only the host/i);
    }
  });

  test("a whole game runs with no box: nothing is sent anywhere", async () => {
    const { host } = await setupRoom(server, ["Ann"], { settings: { lastCall: false } });
    await host.ok("startGame");
    await host.ok("nextRound");
    assert.equal((await host.waitFor((s) => s.phase === "final")).winners.length, 1);
    assert.ok(!/bargames|fetch failed|ECONNREFUSED/i.test(server.output), server.output);
  });

  test("the join rate limit keys on the real client IP, not a spoofed gateway header", async () => {
    const a = { "cf-connecting-ip": "203.0.113.1", "x-bargames-via": "1", "x-bargames-client-ip": "10.0.0.1" };
    assert.match((await failJoins(server.url, a, 21)).error, RATE_LIMITED, "the 21st failure from one IP is limited");
    const b = { "cf-connecting-ip": "203.0.113.2", "x-bargames-via": "1", "x-bargames-client-ip": "10.0.0.1" };
    assert.doesNotMatch((await failJoins(server.url, b, 1)).error, RATE_LIMITED);
  });
});

describe("on a box", () => {
  let server, core;
  before(async () => {
    core = await fakeCore();
    server = await startServer({ BG_GAME_ID: "buzzboard", BG_CORE_URL: core.url, BG_GAME_TOKEN: TOKEN, ADMIN_PASSWORD: "" });
  });
  after(async () => {
    await server.stop();
    await core.close();
  });

  const auth = { authorization: `Bearer ${TOKEN}` };
  const command = async (command, roomCode, args, token = TOKEN) => {
    const res = await post(`${server.url}/__bargames/command`, { command, roomCode, args }, { authorization: `Bearer ${token}` });
    return { status: res.status, ...(await res.json()) };
  };
  const status = async () => (await (await fetch(`${server.url}/__bargames/status`, { headers: auth })).json()).rooms;
  /** Signed in as box staff, so specs can save boards without a game password. */
  const staffBoard = async (board) => {
    const { token } = await (await fetch(`${server.url}/api/admin/trusted`, { method: "POST", headers: STAFF })).json();
    const res = await post(`${server.url}/api/admin/boards`, board, { authorization: `Bearer ${token}` });
    return (await res.json()).board;
  };
  /** A host and players on a tiny board (the harness's setupRoom needs the game's own password). */
  async function room(names, settings = {}, board = tinyBoard()) {
    const { id } = await staffBoard(board);
    const made = await setupRoom(server, [], { board: null });
    await made.host.ok("updateSettings", { boardId: id, doubleDowns: 0, ...settings });
    const players = [];
    for (const name of names) {
      const p = await server.client();
      const j = await p.ok("joinRoom", { code: made.code, role: "player", name });
      p.token = j.token;
      players.push(p);
    }
    return { ...made, players };
  }

  test("the name comes from the venue; the token is never served or logged", async () => {
    assert.deepEqual(await (await fetch(`${server.url}/api/config`)).json(), { gameName: "Buzz Board at Test Bar" });
    const venue = await (await fetch(`${server.url}/__bargames/venue.json`)).text();
    assert.equal(JSON.parse(venue).standalone, false);
    assert.ok(!venue.includes(TOKEN));
    assert.ok(!server.output.includes(TOKEN), "token never logged");
    assert.equal((await command("start", "ABCD", undefined, "wrong")).status, 401);
  });

  test("start: good room, unknown room, wrong state; after a finished game it starts another", async () => {
    const { code, host } = await room(["Ann"], { lastCall: false });
    assert.equal((await command("start", "QQQQ")).ok, false, "unknown room");
    const ok = await command("start", code);
    assert.equal(ok.ok, true, ok.message);
    await host.waitFor((s) => s.phase === "board", "the host sees the game start");
    const again = await command("start", code);
    assert.equal(again.ok, false, "already playing");
    assert.match(again.message, /can't be done right now/i);
    await host.ok("nextRound");
    await host.waitFor((s) => s.phase === "final");
    assert.equal((await command("start", code)).ok, true, "a new game with the same players");
    await host.waitFor((s) => s.phase === "board" && s.round === 1);

    const empty = await room([]);
    const refused = await command("start", empty.code);
    assert.equal(refused.ok, false);
    assert.match(refused.message, /nobody has joined/i);
  });

  test("next_round: good room, unknown room, wrong state", async () => {
    const { code, host } = await room(["Ann"], {}, tinyBoard({ rounds: 2 }));
    assert.equal((await command("next_round", code)).ok, false, "lobby: use start");
    assert.equal((await command("next_round", "QQQQ")).ok, false);
    await host.ok("startGame");
    assert.equal((await command("next_round", code)).ok, true);
    await host.waitFor((s) => s.phase === "board" && s.round === 2, "round 2");
    await host.ok("pickSquare", { cat: 0, row: 0 });
    assert.equal((await command("next_round", code)).ok, false, "not in the middle of a clue");
    await host.ok("skipClue");
    await host.ok("continueGame");
    assert.equal((await command("next_round", code)).ok, true);
    await host.waitFor((s) => s.phase === "lastCall", "Last Call");
    assert.equal((await command("next_round", code)).ok, false, "the host runs Last Call");
  });

  test("status lists rooms for the box's Rooms page; end closes like the host's Close room", async () => {
    const { code, host, players } = await room(["Ann", "Bo"]);
    const table = await server.client();
    await table.ok("joinRoom", { code, role: "table" });
    const mine = (await status()).find((r) => r.code === code);
    assert.deepEqual(
      { ...mine, createdAt: undefined, lastActivityAt: undefined },
      { code, kind: "patron", players: 2, phase: "lobby", round: 0, title: "Tiny", hostConnected: true, hostName: "Host", tables: 1, maxPlayers: 100, createdAt: undefined, lastActivityAt: undefined, joinPath: `/join/${code}` },
    );
    assert.ok(Date.parse(mine.createdAt) <= Date.parse(mine.lastActivityAt), "ISO times");
    assert.equal((await fetch(`${server.url}/__bargames/status`)).status, 401);

    assert.equal((await command("end", code)).ok, true);
    await sleep(100);
    assert.equal(host.closedReason, "The host ended this room.");
    assert.equal(players[0].closedReason, "The host ended this room.");
    assert.equal(table.closedReason, "The host ended this room.");
    assert.equal((await command("end", code)).ok, false, "already gone");
    assert.ok(!(await status()).some((r) => r.code === code), "closed means gone from status");
    await core.waitFor((e) => e.type === "room_closed" && e.roomCode === code && e.data.reason === "host", "room_closed");
  });

  test("events and results: created, players (debounced), rounds, winner, game_over, the leaderboard", async () => {
    const { code, host, players: [ann, bo] } = await room(["Ann", "Bo"], {}, tinyBoard({ rounds: 2 }));
    const created = await core.waitFor((e) => e.type === "room_created" && e.roomCode === code, "room_created");
    assert.equal(created.sessionKind, "patron");
    assert.equal(created.gameId, "buzzboard");

    // Two joins, then a third and a leave inside 2 s: one event with the final count.
    const cy = await server.client();
    await cy.ok("joinRoom", { code, role: "player", name: "Cy" });
    await cy.ok("leaveRoom");
    await sleep(2600);
    const pc = core.of("players_changed", code);
    assert.equal(pc.length, 1, JSON.stringify(pc));
    assert.deepEqual(pc[0].data, { players: 2 });
    // A reconnect is not a player change.
    const again = await server.client();
    await again.ok("resume", { code, token: ann.token });
    await sleep(2300);
    assert.equal(core.of("players_changed", code).length, 1);

    await host.ok("startGame");
    const r1 = await core.waitFor((e) => e.type === "round_started" && e.roomCode === code, "round_started");
    assert.deepEqual(r1.data, { round: 1, rounds: 2, board: "Tiny" });
    await host.ok("pickSquare", { cat: 0, row: 1 });
    await host.ok("openBuzzers");
    await ann.ok("buzz");
    await host.ok("judge", { correct: true }); // Ann 200
    await host.ok("continueGame");
    await host.ok("nextRound");
    await core.waitFor((e) => e.type === "round_ended" && e.roomCode === code && e.data.round === 1, "round 1 ended");
    await core.waitFor((e) => e.type === "round_started" && e.roomCode === code && e.data.round === 2, "round 2 started");
    await host.ok("nextRound");
    const lc = await core.waitFor((e) => e.type === "round_started" && e.roomCode === code && e.data.lastCall === true, "Last Call started");
    assert.equal(lc.data.round, 3);
    await ann.ok("lastCallWager", { amount: 50 });
    await host.ok("lastCallAdvance");
    await host.ok("lastCallAdvance");
    await host.ok("lastCallAdvance"); // Bo (0) is revealed first
    await host.ok("lastCallJudge", { correct: false });
    await host.ok("lastCallAdvance");
    await host.ok("lastCallJudge", { correct: true }); // Ann 250
    await host.ok("lastCallAdvance");
    const s = await host.waitFor((v) => v.phase === "final");
    assert.equal(scoreOf(s, "Ann"), 250);

    const win = await core.waitFor((e) => e.type === "winner" && e.roomCode === code, "winner");
    assert.deepEqual(win.data, { name: "Ann", score: 250 });
    const over = await core.waitFor((e) => e.type === "game_over" && e.roomCode === code, "game_over");
    assert.deepEqual(over.data, { winners: ["Ann"] });
    assert.deepEqual(core.of("round_ended", code).map((e) => e.data.round), [1, 2, 3]);
    const end = Date.now() + 3000;
    while (!core.results.some((r) => r.roomCode === code) && Date.now() < end) await sleep(25);
    const res = core.results.find((r) => r.roomCode === code);
    assert.deepEqual(res.results, [
      { player: { name: "Ann" }, place: 1, score: 250 },
      { player: { name: "Bo" }, place: 2, score: 0 },
    ]);

    // Privacy: no tokens, socket ids or IPs in anything sent to the box.
    const all = JSON.stringify([core.events, core.results]);
    assert.ok(!all.includes(ann.token) && !all.includes(bo.token) && !all.includes(ann.socket.id) && !all.includes("127.0.0.1"));
  });

  test("create_room: a venue room with no host phone, run by commands and the staff iPad", async () => {
    const created = await command("create_room", undefined, { kind: "venue", purpose: "display", title: "Friday Quiz" });
    assert.equal(created.ok, true, created.message);
    const { roomCode: code, hostUrl } = created.data;
    assert.match(code, /^[A-Z]{4}$/);
    const ev = await core.waitFor((e) => e.type === "room_created" && e.roomCode === code, "room_created");
    assert.equal(ev.sessionKind, "venue");
    assert.deepEqual(ev.data, { title: "Friday Quiz" });

    const mine = (await status()).find((r) => r.code === code);
    assert.deepEqual({ kind: mine.kind, players: mine.players, hostConnected: mine.hostConnected, phase: mine.phase }, { kind: "venue", players: 0, hostConnected: false, phase: "lobby" });
    assert.match(mine.title, /^Friday Quiz · /);

    // A TV opens the table route; players join by code as usual, and are players (the host seat isn't open).
    const tv = await server.client();
    assert.equal((await tv.ok("joinRoom", { code, role: "table" })).role, "table");
    const ann = await server.client();
    assert.equal((await ann.ok("joinRoom", { code, role: "player", name: "Ann" })).role, "player");
    assert.equal((await command("start", code)).ok, true);
    await tv.waitFor((s) => s.phase === "board", "the board is up");

    // hostUrl's token takes the empty host seat (the staff iPad), which runs the game.
    const url = new URL(hostUrl, server.url);
    assert.equal(url.pathname, `/join/${code}`);
    const ipad = await server.client();
    const seat = await ipad.ok("resume", { code, token: url.searchParams.get("host") });
    assert.equal(seat.role, "host");
    await ipad.ok("pickSquare", { cat: 0, row: 0 });
    await ipad.ok("openBuzzers");
    assert.equal((await ann.ok("buzz")).result, "first");
    await ipad.ok("judge", { correct: true });

    // A venue room on a TV is never idle-closed; "end" closes it.
    const { token } = await (await fetch(`${server.url}/api/admin/trusted`, { method: "POST", headers: STAFF })).json();
    assert.equal((await command("end", code)).ok, true);
    await sleep(100);
    assert.equal(tv.closedReason, "The host ended this room.");
    await core.waitFor((e) => e.type === "room_closed" && e.roomCode === code, "room_closed");
    assert.ok(token);
  });

  test("create_room with firstJoinerHosts: the first phone to join becomes the host, the rest play", async () => {
    const created = await command("create_room", undefined, { kind: "venue", firstJoinerHosts: true });
    const code = created.data.roomCode;
    const tv = await server.client();
    await tv.ok("joinRoom", { code, role: "table" });
    assert.equal((await tv.waitFor((s) => s.hostOpen === true)).hostConnected, false);
    const first = await server.client();
    assert.equal((await first.ok("roomInfo", { code })).hostOpen, true);
    const seat = await first.ok("joinRoom", { code, role: "player", name: "Sam" });
    assert.deepEqual({ role: seat.role, name: seat.name }, { role: "host", name: "Sam" });
    const s = await tv.waitFor((v) => v.hostOpen === false);
    assert.equal(s.hostConnected, true);
    assert.equal(s.contestants.length, 0, "the host doesn't play");
    assert.equal((await status()).find((r) => r.code === code).hostName, "Sam");
    const second = await server.client();
    assert.equal((await second.ok("joinRoom", { code, role: "player", name: "Ann" })).role, "player");
    await first.ok("startGame");
    await command("end", code);
  });

  // ---------------------------------------- hosting from the box (SDK 0.14.0, kit 0.8.0)
  const keyOf = (url) => new URL(url, server.url).searchParams.get("host");
  const inviteOf = (url) => new URL(url, server.url).searchParams.get("cohost");
  const notices = (c) => {
    const list = [];
    c.socket.on("notice", ({ message }) => list.push(message));
    return list;
  };

  test("firstJoinerHosts: once staff open the host link, the next phone to join is a player", async () => {
    const created = await command("create_room", undefined, { kind: "venue", firstJoinerHosts: true });
    const { roomCode: code, hostUrl } = created.data;
    const tv = await server.client();
    await tv.ok("joinRoom", { code, role: "table" });
    await tv.waitFor((s) => s.hostOpen === true, "the offer is open");
    // Staff open the host link first (0.1.x: this left the offer open, and the next phone got the same seat).
    const ipad = await server.client();
    const seat = await ipad.ok("resume", { code, token: keyOf(hostUrl), host: true });
    assert.equal(seat.role, "host");
    assert.notEqual(seat.token, keyOf(hostUrl), "the phone gets its own seat token, not the link's key");
    await tv.waitFor((s) => s.hostOpen === false, "the offer closed");
    const phone = await server.client();
    assert.equal((await phone.ok("roomInfo", { code })).hostOpen, false);
    const joined = await phone.ok("joinRoom", { code, role: "player", name: "Ann" });
    assert.equal(joined.role, "player");
    assert.notEqual(joined.memberId, seat.memberId);
    await command("end", code);
  });

  test("host_link: staff take over with a new link; the old link is dead and the old host is a co-host", async () => {
    const created = await command("create_room", undefined, { kind: "venue", firstJoinerHosts: true });
    const { roomCode: code, hostUrl } = created.data;
    const sam = await server.client();
    const samNotices = notices(sam);
    const samSeat = await sam.ok("joinRoom", { code, role: "player", name: "Sam" });
    assert.equal(samSeat.role, "host");
    const ann = await server.client();
    const annSeat = await ann.ok("joinRoom", { code, role: "player", name: "Ann" });

    const first = await command("host_link", code);
    assert.equal(first.ok, true, first.message);
    assert.equal(new URL(first.data.url, server.url).pathname, `/join/${code}`);
    assert.notEqual(keyOf(first.data.url), keyOf(hostUrl), "a new key");
    // Sam stays on as a co-host, and is told.
    const samView = await sam.waitFor((s) => s.you.role === "cohost", "Sam is a co-host");
    assert.deepEqual(samView.cohosts.map((c) => c.name), ["Sam"]);
    await sleep(50);
    assert.match(samNotices.join(" "), /staff took over/i);
    // The old link is dead; the new one opens a fresh host seat.
    const old = await (await server.client()).emit("resume", { code, token: keyOf(hostUrl), host: true });
    assert.equal(old.ok, false);
    assert.match(old.error, /host link has expired/i);
    const staff = await server.client();
    const staffSeat = await staff.ok("resume", { code, token: keyOf(first.data.url), host: true });
    assert.equal(staffSeat.role, "host");
    assert.notEqual(staffSeat.memberId, samSeat.memberId);
    // Sam reloads with his own token: still a co-host.
    const samAgain = await server.client();
    assert.equal((await samAgain.ok("resume", { code, token: samSeat.token })).role, "cohost");

    // A co-host runs the game, sees the answers, but can't end the room or remove anyone.
    await sam.ok("startGame");
    await sam.ok("pickSquare", { cat: 0, row: 0 });
    const clue = await sam.waitFor((s) => s.phase === "clue" && s.clue, "the clue");
    assert.ok(clue.clue.answer, "a co-host sees the answer");
    await sam.ok("openBuzzers");
    assert.equal((await ann.ok("buzz")).result, "first");
    await sam.ok("judge", { correct: true });
    assert.match((await sam.emit("closeRoom")).error, /only the host/i);
    assert.match((await sam.emit("kickPlayer", annSeat.memberId)).error, /only the host/i);
    assert.match((await sam.emit("cohostInvite")).error, /only the host/i);
    // A second take-over: another new key, and the first one is dead too.
    const second = await command("host_link", code);
    assert.notEqual(keyOf(second.data.url), keyOf(first.data.url));
    assert.equal((await (await server.client()).emit("resume", { code, token: keyOf(first.data.url), host: true })).ok, false);
    await staff.waitFor((s) => s.you.role === "cohost", "the first staff phone is a co-host now");
    await command("end", code);
  });

  test("cohost_link: a single-use invite that expires; remove_cohost makes them a player", async () => {
    const created = await command("create_room", undefined, { kind: "venue" });
    const { roomCode: code, hostUrl } = created.data;
    const ipad = await server.client();
    await ipad.ok("resume", { code, token: keyOf(hostUrl), host: true });

    const before = Date.now();
    const inv = await command("cohost_link", code, { minutes: 5 });
    assert.equal(inv.ok, true, inv.message);
    assert.equal(new URL(inv.data.url, server.url).pathname, `/join/${code}`);
    const ttl = Date.parse(inv.data.expiresAt) - before;
    assert.ok(ttl > 4.9 * 60_000 && ttl <= 5 * 60_000 + 1000, `expires in 5 minutes (${ttl} ms)`);
    const capped = await command("cohost_link", code, { minutes: 600 });
    assert.ok(Date.parse(capped.data.expiresAt) - Date.now() <= 60 * 60_000 + 1000, "60 minutes at most");
    const dflt = await command("cohost_link", code);
    assert.ok(Math.abs(Date.parse(dflt.data.expiresAt) - Date.now() - 10 * 60_000) < 5000, "10 minutes by default");

    const cy = await server.client();
    const cyNotices = notices(cy);
    const seat = await cy.ok("joinRoom", { code, role: "player", name: "Cy", cohost: inviteOf(inv.data.url) });
    assert.equal(seat.role, "cohost");
    await ipad.waitFor((s) => s.cohosts.some((c) => c.name === "Cy"), "the host sees the co-host");
    assert.equal(ipad.state.contestants.length, 0, "a co-host doesn't play");
    // Single use.
    const dee = await server.client();
    assert.match((await dee.emit("joinRoom", { code, role: "player", name: "Dee", cohost: inviteOf(inv.data.url) })).error, /invite has expired or was already used/i);
    assert.match((await dee.emit("joinRoom", { code, role: "player", name: "Dee", cohost: "made-up" })).error, /invite/i);

    assert.equal((await command("remove_cohost", code, { memberId: "nobody" })).ok, false);
    assert.equal((await command("remove_cohost", code, { memberId: seat.memberId })).ok, true);
    const back = await cy.waitFor((s) => s.you.role === "player", "Cy plays again");
    assert.ok(back.you.contestantId, "with a seat on the scoreboard");
    assert.deepEqual(back.cohosts, []);
    await sleep(50);
    assert.match(cyNotices.join(" "), /not a co-host any more/i);
    assert.match((await cy.emit("startGame")).error, /only the host/i);
    await command("end", code);
  });

  test("casting from the host's screen goes through the box, with the venue's PIN", async () => {
    const { code, host } = await room(["Ann"]);
    assert.deepEqual((await host.ok("listTvs")).tvs, TVS);
    assert.equal((await host.ok("castToTvs", { ids: [] })).result.ok, false, "no TV picked");
    const wrong = await host.ok("castToTvs", { ids: ["roku:A1"], pin: "0000" });
    assert.deepEqual(wrong.result, { ok: false, message: "Wrong TV PIN" });
    const ok = await host.ok("castToTvs", { ids: ["roku:A1"], pin: "4321" });
    assert.equal(ok.result.ok, true);
    assert.deepEqual({ url: core.casts.at(-1).url, roomCode: core.casts.at(-1).roomCode, displayIds: core.casts.at(-1).displayIds }, { url: "/internal/cast", roomCode: code, displayIds: ["roku:A1"] });
    assert.equal((await host.ok("stopTvs", { ids: ["roku:A1"], pin: "4321" })).result.ok, true);
    assert.equal(core.casts.at(-1).url, "/internal/cast/stop");
  });

  test("admin on a box: staff sign in without a password, the box's password works, guests can't claim it", async () => {
    const guest = await (await fetch(`${server.url}/api/admin/status`)).json();
    assert.deepEqual({ setupNeeded: guest.setupNeeded, venueLogin: guest.venueLogin, setupAllowed: guest.setupAllowed, trusted: guest.trusted }, { setupNeeded: true, venueLogin: true, setupAllowed: false, trusted: false });
    for (const headers of [{ "x-bargames-via": "1" }, { "x-bargames-staff": "1" }, {}]) {
      assert.equal((await fetch(`${server.url}/api/admin/trusted`, { method: "POST", headers })).status, 403);
    }
    assert.notEqual((await post(`${server.url}/api/admin/setup`, { password: "claimed-by-a-guest" }, { "x-bargames-via": "1" })).status, 200);
    const staff = await (await fetch(`${server.url}/api/admin/trusted`, { method: "POST", headers: STAFF })).json();
    assert.equal(staff.ok, true);
    assert.equal((await fetch(`${server.url}/api/admin/overview`, { headers: { authorization: `Bearer ${staff.token}` } })).status, 200);

    assert.equal((await post(`${server.url}/api/admin/login`, { password: "nope" })).ok, false);
    const box = await post(`${server.url}/api/admin/login`, { password: "box-password" });
    assert.equal(box.status, 200);
    assert.equal(core.passwordChecks.at(-1).password, "box-password");
    assert.ok(core.passwordChecks.at(-1).clientIp, "the box gets the client IP for its own limits");
  });

  test("on a box the join rate limit keys on the gateway's client IP", async () => {
    const a = { "x-bargames-via": "1", "x-bargames-client-ip": "10.0.0.7" };
    assert.match((await failJoins(server.url, a, 21)).error, RATE_LIMITED);
    const b = { "x-bargames-via": "1", "x-bargames-client-ip": "10.0.0.8" };
    assert.doesNotMatch((await failJoins(server.url, b, 1)).error, RATE_LIMITED, "another phone in the same bar isn't limited");
  });
});
