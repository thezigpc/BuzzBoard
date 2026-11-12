import { useState, type ChangeEvent } from "react";
import {
  BOARD_LIMITS,
  MAX_CATEGORIES,
  MAX_ROUNDS,
  boardFromFile,
  boardToCsv,
  emptyBoard,
  emptyCategory,
  sanitizeBoard,
  valueFor,
  type Board,
  type BoardRound,
  type Category,
} from "@buzzboard/shared";

/** Hands the browser a file to save. */
function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fileName = (title: string) => (title.trim().replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "board").toLowerCase();

/** Every round shows the full six columns while editing; empty ones are dropped on save. */
const padded = (b: Board): Board => ({
  ...b,
  rounds: b.rounds.map((r) => ({ categories: [...r.categories, ...Array.from({ length: Math.max(0, 5 - r.categories.length) }, emptyCategory)] })),
});

/**
 * The staff's board editor: a title, one or two rounds of up to six categories with five
 * clues each (leave a row empty and that square isn't on the board), and an optional
 * Last Call. Import reads a JSON or CSV file into the editor; export saves what's on
 * screen. Nothing is stored until Save.
 */
export function BoardEditor({ initial, saving, onCancel }: { initial: Board | null; saving: (board: Board) => Promise<void>; onCancel: () => void }) {
  const [board, setBoard] = useState<Board>(() => padded(initial ?? emptyBoard()));
  const [round, setRound] = useState(0);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const last = board.lastCall ?? { category: "", clue: "", answer: "" };

  const change = (next: Board) => {
    setBoard(next);
    setDirty(true);
    setNote("");
  };
  const setRoundAt = (ri: number, fn: (r: BoardRound) => BoardRound) => change({ ...board, rounds: board.rounds.map((r, i) => (i === ri ? fn(r) : r)) });
  const setCat = (ci: number, fn: (c: Category) => Category) => setRoundAt(round, (r) => ({ categories: r.categories.map((c, i) => (i === ci ? fn(c) : c)) }));

  /** The cleaned board, or a message saying what to fix. */
  const checked = (): Board | null => {
    try {
      setError("");
      return sanitizeBoard(board, board.id);
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  };

  const save = async () => {
    const clean = checked();
    if (!clean) return;
    setBusy(true);
    try {
      await saving(clean);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const exportAs = (kind: "json" | "csv") => {
    const clean = checked();
    if (!clean) return;
    if (kind === "json") download(`${fileName(clean.title)}.json`, JSON.stringify({ ...clean, id: undefined }, null, 2), "application/json");
    else download(`${fileName(clean.title)}.csv`, boardToCsv(clean), "text/csv");
  };

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (dirty && !window.confirm("Replace what's in the editor with the file's board?")) return;
    try {
      if (file.size > 400_000) throw new Error("That file is too big to be a board.");
      const imported = boardFromFile(await file.text(), file.name);
      // Importing into an existing board replaces its content but keeps it the same board.
      setBoard(padded({ ...imported, id: board.id }));
      setRound(0);
      setDirty(true);
      setError("");
      setNote(`Loaded "${imported.title}" from ${file.name}. Check it, then save.`);
    } catch (err) {
      setError(`Couldn't read ${file.name}: ${(err as Error).message}`);
    }
  };

  const current = board.rounds[round];
  return (
    <section className="panel">
      <div className="admin-row">
        <h2>{initial?.id ? "Edit board" : "New board"}</h2>
        <div className="row wrap">
          <label className="btn btn-small btn-ghost file-btn">
            Import a file
            <input type="file" accept=".json,.csv,application/json,text/csv" onChange={importFile} aria-label="Import a board file (JSON or CSV)" />
          </label>
          <button className="btn btn-small btn-ghost" onClick={() => exportAs("json")}>
            Export JSON
          </button>
          <button className="btn btn-small btn-ghost" onClick={() => exportAs("csv")}>
            Export CSV
          </button>
        </div>
      </div>
      <p className="muted small">
        CSV files have one line per clue: <code>round,category,row,clue,answer</code>. Round is 1, 2 or "last" (the Last Call); row is 1 to 5, cheapest
        first. Export a board to see the shape, edit it in a spreadsheet, and import it back.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {note && <p className="note">{note}</p>}

      <label>
        Title
        <input value={board.title} maxLength={BOARD_LIMITS.title} onChange={(e) => change({ ...board, title: e.target.value })} placeholder="Thursday Trivia" />
      </label>

      <div className="admin-row">
        <div className="editor-tabs" role="tablist">
          {board.rounds.map((_, i) => (
            <button key={i} role="tab" aria-selected={round === i} className={`btn btn-small ${round === i ? "on" : "btn-ghost"}`} onClick={() => setRound(i)}>
              Round {i + 1}
            </button>
          ))}
        </div>
        <div className="row wrap">
          {board.rounds.length < MAX_ROUNDS && (
            <button
              className="btn btn-small btn-ghost"
              onClick={() => {
                change({ ...board, rounds: [...board.rounds, emptyBoard().rounds[0]] });
                setRound(board.rounds.length);
              }}
            >
              Add round 2
            </button>
          )}
          {board.rounds.length > 1 && (
            <button
              className="btn btn-small btn-ghost"
              onClick={() => {
                if (!window.confirm(`Remove round ${round + 1} and its clues?`)) return;
                change({ ...board, rounds: board.rounds.filter((_, i) => i !== round) });
                setRound(0);
              }}
            >
              Remove this round
            </button>
          )}
          {current.categories.length < MAX_CATEGORIES && (
            <button className="btn btn-small btn-ghost" onClick={() => setRoundAt(round, (r) => ({ categories: [...r.categories, emptyCategory()] }))}>
              Add a category
            </button>
          )}
        </div>
      </div>
      <p className="muted small">
        Five or six categories fill the TV best. Points shown are for this round{round > 0 ? " when the host keeps \"round 2 is worth double\" on" : ""}. A row
        left empty isn't on the board.
      </p>

      <div className="editor-cats">
        {current.categories.map((c, ci) => (
          <div className="editor-cat" key={`${round}:${ci}`}>
            <div className="row">
              <input
                value={c.name}
                maxLength={BOARD_LIMITS.category}
                onChange={(e) => setCat(ci, (x) => ({ ...x, name: e.target.value }))}
                placeholder={`Category ${ci + 1}`}
                aria-label={`Category ${ci + 1} name`}
              />
              <button
                className="icon-btn small"
                title="Remove this category"
                aria-label={`Remove category ${ci + 1}`}
                onClick={() => {
                  const filled = c.name || c.clues.some((x) => x.clue || x.answer);
                  if (filled && !window.confirm(`Remove "${c.name || `category ${ci + 1}`}" and its clues?`)) return;
                  setRoundAt(round, (r) => ({ categories: r.categories.filter((_, i) => i !== ci) }));
                }}
              >
                ✕
              </button>
            </div>
            {c.clues.map((x, row) => (
              <div className="editor-clue" key={row}>
                <span className="pts">{valueFor(round, row, true)}</span>
                <div>
                  <textarea
                    rows={2}
                    value={x.clue}
                    maxLength={BOARD_LIMITS.clue}
                    onChange={(e) => setCat(ci, (cat) => ({ ...cat, clues: cat.clues.map((y, i) => (i === row ? { ...y, clue: e.target.value } : y)) }))}
                    placeholder="Clue"
                    aria-label={`${c.name || `Category ${ci + 1}`}, row ${row + 1}: clue`}
                  />
                  <input
                    value={x.answer}
                    maxLength={BOARD_LIMITS.answer}
                    onChange={(e) => setCat(ci, (cat) => ({ ...cat, clues: cat.clues.map((y, i) => (i === row ? { ...y, answer: e.target.value } : y)) }))}
                    placeholder="Answer"
                    aria-label={`${c.name || `Category ${ci + 1}`}, row ${row + 1}: answer`}
                  />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <h2>Last Call</h2>
      <p className="muted small">The final clue: everyone wagers, then types an answer. Leave all three empty for a board without one.</p>
      <label>
        Category
        <input value={last.category} maxLength={BOARD_LIMITS.category} onChange={(e) => change({ ...board, lastCall: { ...last, category: e.target.value } })} />
      </label>
      <label>
        Clue
        <textarea rows={2} value={last.clue} maxLength={BOARD_LIMITS.clue} onChange={(e) => change({ ...board, lastCall: { ...last, clue: e.target.value } })} />
      </label>
      <label>
        Answer
        <input value={last.answer} maxLength={BOARD_LIMITS.answer} onChange={(e) => change({ ...board, lastCall: { ...last, answer: e.target.value } })} />
      </label>

      <div className="row">
        <button className="btn btn-primary" disabled={busy} onClick={save}>
          Save board
        </button>
        <button className="btn btn-ghost" onClick={() => (!dirty || window.confirm("Leave without saving your changes?")) && onCancel()}>
          Cancel
        </button>
      </div>
    </section>
  );
}
