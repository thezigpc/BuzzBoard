// Buzzing fairly: the server's clock decides, one winner, everyone told at once,
// and jumping the gun never wins.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { io } from "socket.io-client";
import { startServer, setupRoom, contestantOf, sleep } from "../harness.mjs";

let server;
before(async () => (server = await startServer()));
after(async () => server.stop());

const NAMES = ["Ann", "Bo", "Cy", "Di", "Ed", "Flo", "Gus", "Hal"];

async function openClue(host, cat = 0, row = 0) {
  await host.ok("pickSquare", { cat, row });
  await host.ok("openBuzzers");
}

test("eight phones buzz within a few milliseconds: exactly one gets it, the first to arrive", async () => {
  const { host, players } = await setupRoom(server, NAMES);
  await host.ok("startGame");
  for (let round = 0; round < 4; round++) {
    await openClue(host, round % 2, round < 2 ? 0 : 1);
    await Promise.all(players.map((p) => p.waitFor((s) => s.clue?.stage === "open")));
    // Fire in a shuffled order, all in the same tick: the events reach the server
    // within a millisecond or two of each other, on eight separate sockets.
    const order = [...players].sort(() => Math.random() - 0.5);
    const results = await Promise.all(order.map((p) => p.ok("buzz")));
    const firsts = results.filter((r) => r.result === "first");
    assert.equal(firsts.length, 1, `one winner, got ${JSON.stringify(results.map((r) => r.result))}`);
    assert.ok(results.every((r) => r.result === "first" || r.result === "late"));

    const s = await host.waitFor((v) => v.clue?.stage === "answering");
    const winner = order[results.findIndex((r) => r.result === "first")];
    assert.equal(s.clue.buzzedName, winner.name);
    assert.equal(s.clue.buzzedBy, contestantOf(s, winner.name).id);
    // The runners-up are listed in arrival order, each later than the one before.
    const final = await host.waitFor((v) => v.clue.buzzes.length === 4, "the close calls are listed");
    assert.equal(final.clue.buzzes[0].name, winner.name);
    const ms = final.clue.buzzes.map((b) => b.ms);
    assert.deepEqual(ms, [...ms].sort((a, b) => a - b));
    assert.equal(new Set(final.clue.buzzes.map((b) => b.contestantId)).size, 4, "one line per contestant");

    await host.ok("judge", { correct: true });
    await host.ok("continueGame");
  }
});

test("every phone hears who got it in the same broadcast", async () => {
  const { host, players } = await setupRoom(server, NAMES.slice(0, 5));
  await host.ok("startGame");
  await openClue(host);
  await Promise.all(players.map((p) => p.waitFor((s) => s.clue?.stage === "open")));
  await players[3].ok("buzz");
  const seen = await Promise.all([host, ...players].map((c) => c.waitFor((s) => s.clue?.stage === "answering")));
  assert.ok(seen.every((s) => s.clue.buzzedName === "Di"));
  // The state that announced it reached all six sockets within a few milliseconds.
  const arrival = [host, ...players].map((c) => c.states.find((x) => x.s.clue?.stage === "answering").at);
  assert.ok(Math.max(...arrival) - Math.min(...arrival) < 50, `spread ${Math.max(...arrival) - Math.min(...arrival)} ms`);
});

test("a buzz before the buzzers open is ignored and locks that phone out for the penalty", async () => {
  const { host, players: [ann, bo] } = await setupRoom(server, ["Ann", "Bo"], { settings: { earlyPenaltyMs: 400 } });
  await host.ok("startGame");
  await host.ok("pickSquare", { cat: 0, row: 0 });
  await ann.waitFor((s) => s.clue?.stage === "reading");
  await bo.waitFor((s) => s.clue?.stage === "reading");

  const statesBefore = bo.states.length;
  assert.equal((await ann.ok("buzz")).result, "early");
  const mine = await ann.waitFor((s) => s.you.penaltyUntil !== null, "Ann's phone is told about its penalty");
  // penaltyUntil is on the server's high-resolution clock, serverTime on Date.now(): they can
  // differ by a few milliseconds, so allow a little either side of 400.
  const left = mine.you.penaltyUntil - mine.serverTime;
  assert.ok(left > 300 && left <= 410, `penalty left: ${left} ms`);
  assert.equal(mine.clue.stage, "reading", "the clue is untouched");
  await sleep(30);
  assert.equal(bo.states.length, statesBefore, "nobody else hears about an early buzz");

  // The buzzers open while Ann is still locked: her buzz does nothing, Bo's wins.
  await host.ok("openBuzzers");
  assert.equal((await ann.ok("buzz")).result, "penalty");
  assert.equal(host.state.clue.stage, "open");
  assert.equal((await bo.ok("buzz")).result, "first");
  await host.ok("judge", { correct: false });

  // Once the penalty has run out she buzzes normally.
  await sleep(450);
  assert.equal((await ann.ok("buzz")).result, "first");
});

test("mashing early keeps renewing the penalty, so a patient player beats a masher", async () => {
  const { host, players: [masher, patient] } = await setupRoom(server, ["Masher", "Patient"], { settings: { earlyPenaltyMs: 250 } });
  await host.ok("startGame");
  await host.ok("pickSquare", { cat: 0, row: 0 });
  await masher.waitFor((s) => s.clue?.stage === "reading");
  let mashing = true;
  const mash = (async () => {
    while (mashing) {
      masher.socket.emit("buzz");
      await sleep(40);
    }
  })();
  await sleep(200);
  await host.ok("openBuzzers");
  await sleep(120); // a human's reaction time; the masher has buzzed two or three times since
  assert.equal(host.state.clue.stage, "open", "the masher's buzzes while locked did nothing");
  assert.equal((await patient.ok("buzz")).result, "first");
  mashing = false;
  await mash;
  assert.equal((await host.waitFor((s) => s.clue?.stage === "answering")).clue.buzzedName, "Patient");
});

test("no penalty at 0 ms; and with the setting on, the lockout is per phone, not per team", async () => {
  const solo = await setupRoom(server, ["Ann"], { settings: { earlyPenaltyMs: 0 } });
  await solo.host.ok("startGame");
  await solo.host.ok("pickSquare", { cat: 0, row: 0 });
  assert.equal((await solo.players[0].ok("buzz")).result, "early");
  await solo.host.ok("openBuzzers");
  assert.equal((await solo.players[0].ok("buzz")).result, "first");

  const { host, players: [ann, bo] } = await setupRoom(server, ["Ann", "Bo"], { teams: ["Reds", "Reds"], settings: { earlyPenaltyMs: 2000 } });
  await host.ok("startGame");
  await host.ok("pickSquare", { cat: 0, row: 0 });
  assert.equal((await ann.ok("buzz")).result, "early");
  await host.ok("openBuzzers");
  assert.equal((await ann.ok("buzz")).result, "penalty");
  assert.equal((await bo.ok("buzz")).result, "first", "a teammate who waited can still buzz");
});

test("only seated players buzz; the host, the TV and strangers can't", async () => {
  const { code, host, players: [ann] } = await setupRoom(server, ["Ann"]);
  const table = await server.client();
  await table.ok("joinRoom", { code, role: "table" });
  const stranger = await server.client();
  await host.ok("startGame");
  await openClue(host);
  for (const c of [host, table, stranger]) assert.equal((await c.emit("buzz")).ok, false);
  assert.equal(host.state.clue.stage, "open");
  assert.equal((await ann.ok("buzz")).result, "first");
  // A second buzz from the same phone changes nothing.
  assert.equal((await ann.ok("buzz")).result, "late");
  assert.equal((await host.waitFor((s) => s.clue?.stage === "answering")).clue.buzzes.length, 1);
});

test("a buzz never rides long-polling: a polling connection is refused, a WebSocket one wins", async () => {
  const { code, host, players: [ann] } = await setupRoom(server, ["Ann"]);
  // Bo's phone could only get a long-polling connection.
  const socket = io(server.url, { transports: ["polling"], upgrade: false, reconnection: false, forceNew: true });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  const call = (event, ...args) => new Promise((r) => socket.emit(event, ...args, r));
  assert.equal((await call("joinRoom", { code, role: "player", name: "Bo" })).ok, true, "polling can still join and follow the game");
  await host.ok("startGame");
  await openClue(host);
  const res = await call("buzz");
  assert.equal(res.ok, false);
  assert.match(res.error, /connection/i);
  assert.equal(host.state.clue.stage, "open");
  assert.equal((await ann.ok("buzz")).result, "first");
  socket.close();
});
