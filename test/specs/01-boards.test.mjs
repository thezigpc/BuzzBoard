// The pure rules in shared/: board validation, CSV and JSON files, points, and the samples.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SAMPLE_BOARDS,
  boardFromCsv,
  boardFromFile,
  boardToCsv,
  parseCsv,
  sanitizeBoard,
  summarize,
  valueFor,
} from "@buzzboard/shared";
import { tinyBoard } from "../harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("points rise 100 to 500, and double from the second round when asked", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((r) => valueFor(0, r, true)), [100, 200, 300, 400, 500]);
  assert.deepEqual([0, 4].map((r) => valueFor(1, r, true)), [200, 1000]);
  assert.deepEqual([0, 4].map((r) => valueFor(1, r, false)), [100, 500]);
});

test("the sample boards are valid, 5 or 6 categories of 5 clues, with a Last Call", () => {
  assert.ok(SAMPLE_BOARDS.length >= 3);
  for (const b of SAMPLE_BOARDS) {
    assert.deepEqual(sanitizeBoard(b, b.id), b, `${b.title} survives its own validator unchanged`);
    for (const r of b.rounds) {
      assert.ok(r.categories.length === 5 || r.categories.length === 6, b.title);
      for (const c of r.categories) assert.ok(c.clues.every((x) => x.clue && x.answer), `${b.title} / ${c.name}`);
    }
    assert.ok(b.lastCall, b.title);
  }
  const s = summarize(SAMPLE_BOARDS[0], true);
  assert.deepEqual({ rounds: s.rounds, categories: s.categories, clues: s.clues, lastCall: s.lastCall, sample: s.sample }, { rounds: 2, categories: 10, clues: 50, lastCall: true, sample: true });
});

test("no clue is repeated across the samples", () => {
  const seen = new Set();
  for (const b of SAMPLE_BOARDS)
    for (const r of b.rounds)
      for (const c of r.categories)
        for (const x of c.clues) {
          assert.ok(!seen.has(x.clue), `repeated: ${x.clue}`);
          seen.add(x.clue);
        }
});

test("validation: readable errors, blank squares kept, empty categories dropped", () => {
  const b = tinyBoard();
  b.rounds[0].categories.push({ name: "", clues: [] }); // an untouched editor column
  const clean = sanitizeBoard(b, "x1");
  assert.equal(clean.id, "x1");
  assert.equal(clean.rounds[0].categories.length, 2);
  assert.equal(clean.rounds[0].categories[0].clues.length, 5);
  assert.equal(clean.rounds[0].categories[0].clues[4].clue, "");

  assert.throws(() => sanitizeBoard({ ...tinyBoard(), title: "  " }), /title/i);
  assert.throws(() => sanitizeBoard({ title: "T", rounds: [] }), /at least one round/i);
  assert.throws(() => sanitizeBoard({ title: "T", rounds: [{ categories: [tinyBoard().rounds[0].categories[0]] }] }), /at least 2 categories/i);
  const noAnswer = tinyBoard();
  noAnswer.rounds[0].categories[0].clues[1].answer = "";
  assert.throws(() => sanitizeBoard(noAnswer), /"Red1", row 2: the clue has no answer/);
  const halfLast = tinyBoard();
  halfLast.lastCall.answer = "";
  assert.throws(() => sanitizeBoard(halfLast), /Last Call needs/);
  const three = tinyBoard({ rounds: 2 });
  three.rounds.push(three.rounds[0]);
  assert.throws(() => sanitizeBoard(three), /at most 2 rounds/);
  // Over-long text is trimmed, not rejected.
  const long = tinyBoard();
  long.rounds[0].categories[0].clues[0].clue = "x".repeat(900);
  assert.equal(sanitizeBoard(long).rounds[0].categories[0].clues[0].clue.length, 300);
});

test("CSV: quotes, commas and newlines inside fields", () => {
  assert.deepEqual(parseCsv('a,"b, c","d ""e"""\r\n"two\nlines",x\n\n'), [["a", "b, c", 'd "e"'], ["two\nlines", "x"]]);
});

test("CSV and JSON files round-trip a board", () => {
  for (const b of SAMPLE_BOARDS) {
    const viaCsv = boardFromCsv(boardToCsv(b));
    assert.deepEqual({ ...viaCsv, id: b.id }, b, `${b.title} via CSV`);
    const viaJson = boardFromFile(JSON.stringify(b), "whatever.json");
    assert.deepEqual({ ...viaJson, id: b.id }, b, `${b.title} via JSON`);
    assert.equal(viaJson.id, "", "an imported board never keeps the file's id");
  }
  const tricky = sanitizeBoard({
    ...tinyBoard(),
    title: 'Quotes, "commas" & more',
  });
  tricky.rounds[0].categories[0].clues[0] = { clue: 'He said "cheers", twice', answer: "A, B" };
  assert.deepEqual(boardFromCsv(boardToCsv(tricky)), tricky);
});

test("CSV: a spreadsheet written by hand (points as rows, no title line) imports", () => {
  const csv = ["round,category,row,clue,answer", "1,Drinks,100,Made from grapes,Wine", "1,Drinks,200,Made from apples,Cider", "1,Food,,First,One", "1,Food,,Second,Two", "last,Wrap up,,Final clue,Final answer"].join("\n");
  const b = boardFromFile(csv, "trivia_night-1.csv");
  assert.equal(b.title, "trivia night 1");
  assert.deepEqual(b.rounds[0].categories.map((c) => c.name), ["Drinks", "Food"]);
  assert.equal(b.rounds[0].categories[0].clues[1].answer, "Cider");
  assert.equal(b.rounds[0].categories[1].clues[1].clue, "Second");
  assert.equal(b.lastCall.answer, "Final answer");
  assert.throws(() => boardFromCsv("3,Cat,1,Clue,Answer"), /Line 1: the round must be 1, 2 or "last"/);
  assert.throws(() => boardFromCsv("1,Cat,1,Clue,Answer\n1,Cat,1,Again,Answer"), /row 1 is there twice/);
  assert.throws(() => boardFromFile("{not json", "x.json"), /valid JSON/);
});

test("the show this format resembles is never named, anywhere in the repo", () => {
  // CLAUDE.md is the one file that names the terms, to forbid them.
  const banned = /jeopardy|daily double|trebek/i;
  const skip = new Set(["node_modules", "dist", ".git", "vendor", "data", "CLAUDE.md", "CLAUDE.local.md", "package-lock.json"]);
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|mjs|js|json|md|css|html|yml|csv)$/.test(name) && p !== fileURLToPath(import.meta.url)) {
        if (banned.test(readFileSync(p, "utf8"))) hits.push(path.relative(root, p));
      }
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});
