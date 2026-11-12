// A whole game over real sockets: the board, judging, Double Down, rounds, Last Call, the winner.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, setupRoom, tinyBoard, scoreOf, contestantOf, sleep } from "../harness.mjs";

let server;
before(async () => (server = await startServer()));
after(async () => server.stop());

/** Picks a square, opens the buzzers, has `player` buzz, and judges. */
async function play(host, player, cat, row, correct) {
  await host.ok("pickSquare", { cat, row });
  await host.ok("openBuzzers");
  assert.equal((await player.ok("buzz")).result, "first");
  await host.ok("judge", { correct });
}

test("lobby: the host sees the boards and settings; the answers never reach a player or the TV", async () => {
  const { code, host, players: [ann] } = await setupRoom(server, ["Ann"]);
  const table = await server.client();
  await table.ok("joinRoom", { code, role: "table" });
  const h = await host.waitFor((s) => s.tableCount === 1);
  assert.equal(h.phase, "lobby");
  assert.ok(h.boards.some((b) => b.sample) && h.boards.some((b) => b.title === "Tiny"));
  assert.equal(h.boardTitle, "Tiny");
  assert.deepEqual(ann.state.boards, [], "only the host gets the board list");
  assert.equal((await ann.emit("startGame")).ok, false, "a player can't start");

  await host.ok("startGame");
  await host.ok("pickSquare", { cat: 0, row: 0 });
  const hv = await host.waitFor((s) => s.clue?.stage === "reading");
  assert.equal(hv.clue.answer, "Red1 A1", "the host reads the answer");
  for (const c of [ann, table]) {
    const v = await c.waitFor((s) => s.clue?.stage === "reading");
    assert.equal(v.clue.text, "Red1 one?");
    assert.equal(v.clue.answer, null);
    assert.ok(!JSON.stringify(v).includes("A1"), "no answer anywhere in a non-host view");
  }
  await host.ok("skipClue");
  const shown = await table.waitFor((s) => s.clue?.stage === "revealed");
  assert.equal(shown.clue.answer, "Red1 A1", "revealed to everyone once the clue is over");
  assert.equal(shown.clue.winnerId, null);
});

test("right answers add points and take control; wrong ones cost and reopen the buzzers", async () => {
  const { host, players: [ann, bo] } = await setupRoom(server, ["Ann", "Bo"]);
  await host.ok("startGame");
  let s = await host.waitFor((v) => v.phase === "board");
  assert.deepEqual(s.grid.categories, ["Red1", "Blue1"]);
  assert.deepEqual(s.grid.values, [100, 200, 300, 400, 500]);
  assert.deepEqual(s.grid.cells[0], ["open", "open", "blank", "blank", "blank"]);
  assert.equal(s.pickerId, contestantOf(s, "Ann").id, "all on 0: the first to join starts in control");
  assert.equal(s.round, 1);

  // Bo gets it wrong (-100) and is locked out; Ann then gets it right (+100).
  await host.ok("pickSquare", { cat: 0, row: 0 });
  assert.equal((await ann.emit("pickSquare", { cat: 0, row: 1 })).ok, false, "one clue at a time");
  await host.ok("openBuzzers");
  assert.equal((await bo.ok("buzz")).result, "first");
  assert.equal((await host.waitFor((v) => v.clue?.stage === "answering")).clue.buzzedName, "Bo");
  await host.ok("judge", { correct: false });
  s = await host.waitFor((v) => v.clue?.stage === "open");
  assert.equal(scoreOf(s, "Bo"), -100);
  assert.deepEqual(s.clue.lockedOut, [contestantOf(s, "Bo").id]);
  assert.equal((await bo.ok("buzz")).result, "locked");
  assert.equal((await ann.ok("buzz")).result, "first");
  await host.ok("judge", { correct: true });
  s = await host.waitFor((v) => v.clue?.stage === "revealed");
  assert.equal(scoreOf(s, "Ann"), 100);
  assert.equal(s.clue.winnerId, contestantOf(s, "Ann").id);
  assert.equal(s.pickerId, contestantOf(s, "Ann").id);
  assert.equal((await ann.emit("continueGame")).ok, false, "only the host moves on");
  await host.ok("continueGame");
  s = await host.waitFor((v) => v.phase === "board");
  assert.equal(s.grid.cells[0][0], "used");
  assert.equal((await host.emit("pickSquare", { cat: 0, row: 0 })).ok, false, "a used square");
  assert.equal((await host.emit("pickSquare", { cat: 0, row: 2 })).ok, false, "a blank square");

  // Everyone wrong: the answer goes up by itself.
  await host.ok("pickSquare", { cat: 0, row: 1 });
  await host.ok("openBuzzers");
  await ann.ok("buzz");
  await host.ok("judge", { correct: false });
  await bo.ok("buzz");
  await host.ok("judge", { correct: false });
  s = await host.waitFor((v) => v.clue?.stage === "revealed");
  assert.equal(s.clue.winnerId, null);
  assert.equal(scoreOf(s, "Ann"), -100);
  assert.equal(scoreOf(s, "Bo"), -300);
  assert.equal(s.pickerId, contestantOf(s, "Ann").id, "nobody right: control stays put");

  // A square picked by mistake goes back; a score slip is fixed by hand.
  await host.ok("continueGame");
  await host.ok("pickSquare", { cat: 1, row: 0 });
  await host.ok("cancelClue");
  s = await host.waitFor((v) => v.phase === "board");
  assert.equal(s.grid.cells[1][0], "open");
  await host.ok("adjustScore", { contestantId: contestantOf(s, "Bo").id, delta: 300 });
  assert.equal(scoreOf(await host.waitFor((v) => scoreOf(v, "Bo") === 0), "Bo"), 0);
  assert.equal((await ann.emit("adjustScore", { contestantId: contestantOf(s, "Ann").id, delta: 5000 })).ok, false);
});

test("wrongCosts off: a wrong answer only locks you out", async () => {
  const { host, players: [ann] } = await setupRoom(server, ["Ann", "Bo"], { settings: { wrongCosts: false } });
  await host.ok("startGame");
  await play(host, ann, 0, 1, false);
  assert.equal(scoreOf(await host.waitFor((v) => v.clue?.lockedOut.length === 1), "Ann"), 0);
});

test("the buzz clock: nobody buzzes, the answer goes up", async () => {
  const { host, players: [ann] } = await setupRoom(server, ["Ann"], { settings: { buzzSeconds: 3 } });
  await host.ok("startGame");
  await host.ok("pickSquare", { cat: 1, row: 1 });
  await host.ok("openBuzzers");
  const open = await ann.waitFor((v) => v.clue?.stage === "open");
  assert.ok(open.clue.deadline - open.serverTime > 2500 && open.clue.deadline - open.serverTime <= 3000);
  const done = await ann.waitFor((v) => v.clue?.stage === "revealed", "time ran out", 5000);
  assert.equal(done.clue.answer, "Blue1 A2");
  assert.equal((await ann.ok("buzz")).result, "closed");
});

test("players pick: only the one in control, and only when the room allows it", async () => {
  const { host, players: [ann, bo] } = await setupRoom(server, ["Ann", "Bo"]);
  await host.ok("startGame");
  assert.match((await ann.emit("pickSquare", { cat: 0, row: 0 })).error, /your pick/i);
  await host.ok("updateSettings", { playersPick: true });
  assert.equal((await bo.emit("pickSquare", { cat: 0, row: 0 })).ok, false, "Bo isn't in control");
  await ann.ok("pickSquare", { cat: 0, row: 0 });
  await host.ok("skipClue");
  await host.ok("continueGame");
  const s = await host.waitFor((v) => v.phase === "board");
  await host.ok("setPicker", { contestantId: contestantOf(s, "Bo").id });
  await bo.ok("pickSquare", { cat: 0, row: 1 });
});

test("Double Down: only the picker answers, for a wager up to their score or the round's top value", async () => {
  // Rows 2 of both categories are the only squares off the bottom row, so with two
  // Double Downs both are one.
  const { host, players: [ann, bo] } = await setupRoom(server, ["Ann", "Bo"], { settings: { doubleDowns: 2 } });
  await host.ok("startGame");
  await host.ok("pickSquare", { cat: 0, row: 1 });
  let s = await bo.waitFor((v) => v.clue?.stage === "wager");
  assert.equal(s.clue.doubleDown, true);
  assert.equal(s.clue.text, null, "the clue stays hidden until the wager is in");
  assert.equal(s.clue.buzzedBy, contestantOf(s, "Ann").id);
  assert.equal(s.clue.wagerMax, 500, "on 0 points: up to the round's top value");
  assert.equal((await bo.emit("setWager", { amount: 100 })).ok, false, "not Bo's Double Down");
  for (const bad of [4, 501, 12.5, "lots"]) assert.equal((await ann.emit("setWager", { amount: bad })).ok, false, `wager ${bad}`);
  assert.equal((await host.emit("openBuzzers")).ok, false, "no buzzers on a Double Down");
  await ann.ok("setWager", { amount: 450 });
  s = await bo.waitFor((v) => v.clue?.stage === "answering");
  assert.equal(s.clue.text, "Red1 two?");
  assert.equal(s.clue.wager, 450);
  assert.equal((await bo.ok("buzz")).result, "closed", "nobody buzzes in on a Double Down");
  await host.ok("judge", { correct: true });
  s = await host.waitFor((v) => v.clue?.stage === "revealed");
  assert.equal(scoreOf(s, "Ann"), 450);
  await host.ok("continueGame");

  // The second one: the host types the wager for the player, and a miss costs it.
  await host.ok("pickSquare", { cat: 1, row: 1 });
  s = await host.waitFor((v) => v.clue?.stage === "wager");
  assert.equal(s.clue.wagerMax, 500);
  await host.ok("setWager", { amount: 500 });
  await host.ok("judge", { correct: false });
  s = await host.waitFor((v) => v.clue?.stage === "revealed");
  assert.equal(scoreOf(s, "Ann"), -50);
  assert.equal(s.clue.winnerId, null);

  // The bottom row is never one.
  await host.ok("continueGame");
  await host.ok("pickSquare", { cat: 0, row: 0 });
  assert.equal((await host.waitFor((v) => v.clue?.stage === "reading")).clue.doubleDown, false);
});

test("two rounds (the second doubled), Last Call, and the winner", async () => {
  const { host, players: [ann, bo, cy] } = await setupRoom(server, ["Ann", "Bo", "Cy"], { board: tinyBoard({ rounds: 2 }) });
  const s0 = host.state;
  assert.equal(s0.roundCount, 2);
  assert.equal(s0.hasLastCall, true);
  await host.ok("startGame");
  // Round 1: Ann 100 + 200, Bo 100, one square skipped.
  await play(host, ann, 0, 0, true);
  await host.ok("continueGame");
  await play(host, ann, 0, 1, true);
  await host.ok("continueGame");
  await play(host, bo, 1, 0, true);
  await host.ok("continueGame");
  assert.equal((await ann.emit("nextRound")).ok, false, "only the host");
  await host.ok("pickSquare", { cat: 1, row: 1 });
  await host.ok("skipClue");
  await host.ok("continueGame");
  let s = await host.waitFor((v) => v.phase === "roundEnd", "the board is cleared");
  assert.equal(s.round, 1);

  await host.ok("nextRound");
  s = await host.waitFor((v) => v.phase === "board" && v.round === 2);
  assert.deepEqual(s.grid.categories, ["Red2", "Blue2"]);
  assert.deepEqual(s.grid.values, [200, 400, 600, 800, 1000]);
  assert.equal(s.pickerId, contestantOf(s, "Cy").id, "the lowest score starts the round in control");
  await play(host, cy, 0, 1, true); // Cy 400
  await host.ok("continueGame");
  // The host skips the rest of the round.
  await host.ok("nextRound");

  s = await ann.waitFor((v) => v.phase === "lastCall");
  assert.equal(s.round, 3);
  assert.equal(s.lastCall.stage, "wager");
  assert.equal(s.lastCall.category, "Finale");
  assert.equal(s.lastCall.text, null, "only the category shows while wagers go in");
  assert.equal(s.lastCall.mine.wagerMax, 1000, "your score, or the last round's top value if that's more");
  assert.equal((await ann.emit("lastCallWager", { amount: 1001 })).ok, false);
  assert.equal((await ann.emit("lastCallWager", { amount: -1 })).ok, false);
  await ann.ok("lastCallWager", { amount: 300 });
  await bo.ok("lastCallWager", { amount: 1000 });
  // Cy never wagers: 0.
  const tv = await server.client();
  await tv.ok("joinRoom", { code: s.code, role: "table" });
  let t = await tv.waitFor((v) => v.lastCall?.entries.filter((e) => e.wagered).length === 2);
  assert.ok(t.lastCall.entries.every((e) => e.wager === null), "wagers are secret");
  assert.equal((await ann.emit("lastCallAnswer", { text: "too soon" })).ok, false);

  await host.ok("lastCallAdvance");
  s = await ann.waitFor((v) => v.lastCall?.stage === "answer");
  assert.equal(s.lastCall.text, "The last clue?");
  assert.ok(s.lastCall.deadline > s.serverTime);
  assert.equal((await ann.emit("lastCallWager", { amount: 5 })).ok, false, "wagers are locked");
  await ann.ok("lastCallAnswer", { text: "  the last   answer " });
  await bo.ok("lastCallAnswer", { text: "no idea" });
  await bo.ok("lastCallAnswer", { text: "a wild guess" });
  t = await tv.waitFor((v) => v.lastCall.entries.filter((e) => e.answered).length === 2);
  assert.ok(t.lastCall.entries.every((e) => e.answer === null) && t.lastCall.answer === null, "answers stay hidden");
  assert.equal(ann.state.lastCall.mine.answer, "the last answer");

  await host.ok("lastCallAdvance"); // lock early
  s = await host.waitFor((v) => v.lastCall?.stage === "reveal");
  assert.equal(s.lastCall.answer, "The last answer");
  const order = s.lastCall.entries.map((e) => s.contestants.find((c) => c.id === e.contestantId).name);
  assert.deepEqual(order, ["Bo", "Ann", "Cy"], "revealed from the lowest score up");
  assert.equal((await ann.emit("lastCallAnswer", { text: "late" })).ok, false);
  assert.equal((await host.emit("lastCallJudge", { correct: true })).ok, false, "nothing revealed yet");

  await host.ok("lastCallAdvance");
  t = await tv.waitFor((v) => v.lastCall.revealing !== null);
  let e = t.lastCall.entries.find((x) => x.contestantId === t.lastCall.revealing);
  assert.deepEqual({ answer: e.answer, wager: e.wager, correct: e.correct }, { answer: "a wild guess", wager: null, correct: null });
  assert.equal((await host.emit("lastCallAdvance")).ok, false, "judge this one first");
  await host.ok("lastCallJudge", { correct: false });
  t = await tv.waitFor((v) => v.lastCall.entries[0].correct === false);
  assert.equal(t.lastCall.entries[0].wager, 1000);
  assert.equal(scoreOf(t, "Bo"), -900);
  await host.ok("lastCallAdvance");
  await host.ok("lastCallJudge", { correct: true }); // Ann 300 + 300
  await host.ok("lastCallAdvance");
  await host.ok("lastCallJudge", { correct: true }); // Cy 400 + 0
  t = await tv.waitFor((v) => v.lastCall.entries.every((x) => x.correct !== null));
  assert.equal(t.lastCall.answer, "The last answer", "the answer shows once every entry is judged");
  assert.equal(t.phase, "lastCall");

  await host.ok("lastCallAdvance");
  s = await tv.waitFor((v) => v.phase === "final");
  assert.deepEqual(s.winners, [contestantOf(s, "Ann").id]);
  assert.deepEqual([scoreOf(s, "Ann"), scoreOf(s, "Bo"), scoreOf(s, "Cy")], [600, -900, 400]);

  // Play again: the same players, back in the lobby on 0.
  assert.equal((await ann.emit("playAgain")).ok, false);
  await host.ok("playAgain");
  s = await ann.waitFor((v) => v.phase === "lobby");
  assert.deepEqual(s.contestants.map((c) => c.score), [0, 0, 0]);
  assert.equal(s.lastCall, null);
  await host.ok("startGame");
  await ann.waitFor((v) => v.phase === "board" && v.round === 1);
});

test("the Last Call clock locks the answers by itself; no Last Call goes straight to the scores; ties share the win", async () => {
  const a = await setupRoom(server, ["Ann"], { settings: { lastCallSeconds: 15 } });
  await a.host.ok("startGame");
  await a.host.ok("nextRound");
  await a.host.ok("lastCallAdvance");
  const s = await a.host.waitFor((v) => v.lastCall?.stage === "answer");
  assert.ok(s.lastCall.deadline - s.serverTime > 14_000);

  const b = await setupRoom(server, ["Ann", "Bo"], { settings: { lastCall: false } });
  assert.equal(b.host.state.hasLastCall, false);
  assert.equal((await b.host.emit("nextRound")).ok, false, "not from the lobby");
  await b.host.ok("startGame");
  await b.host.ok("nextRound");
  const f = await b.host.waitFor((v) => v.phase === "final");
  assert.equal(f.winners.length, 2, "0 - 0: both win");
  assert.equal(f.lastCall, null);

  const c = await setupRoom(server, ["Ann"], { board: tinyBoard({ lastCall: false }) });
  assert.equal(c.host.state.hasLastCall, false);
});

test("settings: validated, and the game's shape is fixed once it starts", async () => {
  const { host } = await setupRoom(server, ["Ann"]);
  for (const bad of [{ buzzSeconds: 2 }, { buzzSeconds: 61 }, { earlyPenaltyMs: 2001 }, { doubleDowns: 3 }, { lastCallSeconds: 5 }, { boardId: "nope" }]) {
    assert.equal((await host.emit("updateSettings", bad)).ok, false, JSON.stringify(bad));
  }
  await host.ok("updateSettings", { buzzSeconds: 20, earlyPenaltyMs: 0, lastCallSeconds: 60 });
  await host.ok("startGame");
  assert.equal((await host.emit("startGame")).ok, false, "already started");
  for (const fixed of [{ teams: true }, { doubleDowns: 2 }, { lastCall: false }, { doubleLater: false }]) {
    assert.equal((await host.emit("updateSettings", fixed)).ok, false, JSON.stringify(fixed));
  }
  await host.ok("updateSettings", { buzzSeconds: 5, wrongCosts: false });
  assert.equal((await host.waitFor((v) => v.settings.buzzSeconds === 5)).settings.wrongCosts, false);
});

test("an empty room can't start", async () => {
  const { host } = await setupRoom(server, []);
  assert.match((await host.emit("startGame")).error, /nobody has joined/i);
  await sleep(10);
});
