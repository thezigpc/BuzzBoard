import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { BoxAdminLink, staffSignIn } from "@bargames/gamekit/client";
import { ADMIN_SETTINGS_LIMITS, type AdminOverview, type AdminRoomSummary, type Board, type BoardSummary } from "@buzzboard/shared";
import { BoardEditor } from "../components/BoardEditor";
import { serverUrl } from "../socket";
import { useVenue } from "../useVenue";

const TOKEN_KEY = "buzzboard_admin_token";
const loadToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
};
const saveToken = (t: string) => {
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
};

export async function api<T>(path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${serverUrl}/api/admin${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? `Request failed (${res.status}).`), { status: res.status });
  return body as T;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min ago` : `${Math.floor(h / 24)} d ${h % 24} h ago`;
}

/** The kit's /api/admin/status (venueLogin and setupAllowed are true only on a box). */
interface AdminStatus {
  setupNeeded: boolean;
  authenticated: boolean;
  trusted?: boolean;
  venueLogin?: boolean;
  setupAllowed?: boolean;
}

export function AdminPage() {
  const [token, setToken] = useState(loadToken);
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [error, setError] = useState("");
  // After a manual Sign out, don't sign venue staff straight back in on this page.
  const [signedOut, setSignedOut] = useState(false);
  const venue = useVenue();

  const refreshStatus = useCallback(() => {
    api<AdminStatus>("/status", token)
      .then(async (s) => {
        // Venue staff (the box vouches for this browser): a session without the password.
        // Never true off a box, so standalone always shows the form.
        if (!s.authenticated && s.trusted && !signedOut) {
          const t = await staffSignIn(serverUrl);
          if (t) {
            saveToken(t);
            setToken(t);
            return;
          }
        }
        setStatus(s);
      })
      .catch((e: Error) => setError(e.message));
  }, [token, signedOut]);
  useEffect(refreshStatus, [refreshStatus]);

  const signedIn = (t: string) => {
    saveToken(t);
    setToken(t);
  };
  const signOut = async () => {
    await api("/logout", token, { method: "POST" }).catch(() => {});
    setSignedOut(true);
    signedIn("");
  };

  return (
    <main className="admin">
      {/* "← Box admin" for staff who came from the venue box; nothing standalone. */}
      <BoxAdminLink ctx={venue} />
      <header className="admin-head">
        <h1>Admin</h1>
        <Link to="/" className="muted">
          ← Home
        </Link>
      </header>
      {error && <p className="error">{error}</p>}
      {!status ? (
        <p className="muted">Loading…</p>
      ) : status.authenticated ? (
        <Dashboard token={token} onSignOut={signOut} onExpired={() => signedIn("")} />
      ) : (
        <PasswordForm status={status} onToken={signedIn} />
      )}
    </main>
  );
}

function PasswordForm({ status, onToken }: { status: AdminStatus; onToken: (t: string) => void }) {
  const setupNeeded = status.setupNeeded;
  // On a venue box its admin password signs in here too, even before the game has a
  // password of its own; only staff the box vouches for may set a separate one.
  const onBox = status.venueLogin === true;
  const canSetOwn = onBox && setupNeeded && status.setupAllowed === true;
  const [ownPassword, setOwnPassword] = useState(false);
  const setup = setupNeeded && (!onBox || (canSetOwn && ownPassword));
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (setup && password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await api<{ token: string }>(setup ? "/setup" : "/login", "", { method: "POST", body: { password } });
      onToken(r.token);
    } catch (err) {
      const msg = (err as Error).message;
      setError(onBox && setupNeeded && !setup && /set up/i.test(msg) ? "That isn't the venue's admin password." : msg);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="panel admin-login" onSubmit={submit}>
      <h2>{setup ? "Set the admin password" : "Sign in"}</h2>
      {onBox && !setup && (
        <p className="muted small">{setupNeeded ? "Use the venue's admin password." : "Use this game's admin password, or the venue's admin password."}</p>
      )}
      {setup && (
        <p className="warning">
          No admin password has been set yet. Whoever sets it first becomes the admin, so do this now. It can't be changed here later; the{" "}
          <code>ADMIN_PASSWORD</code> environment variable overrides it.
        </p>
      )}
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setup ? "new-password" : "current-password"} autoFocus />
      </label>
      {setup && (
        <label>
          Confirm password
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary btn-big" disabled={busy || password.length === 0}>
        {setup ? "Set password" : "Sign in"}
      </button>
      {canSetOwn && (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setOwnPassword(!ownPassword);
            setError("");
          }}
        >
          {ownPassword ? "Sign in with the venue's password instead" : "Set a separate password for this game instead"}
        </button>
      )}
    </form>
  );
}

function Dashboard({ token, onSignOut, onExpired }: { token: string; onSignOut: () => void; onExpired: () => void }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [idle, setIdle] = useState("");
  /** The board open in the editor: an existing one, a copy, an import, or a blank. */
  const [editing, setEditing] = useState<{ board: Board | null; id: string | null } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<AdminOverview>("/overview", token));
      setError("");
    } catch (err) {
      if ((err as { status?: number }).status === 401) onExpired();
      else setError((err as Error).message);
    }
  }, [token, onExpired]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (data && idle === "") setIdle(String(data.settings.roomIdleMinutes));
  }, [data, idle]);

  const run = async (fn: () => Promise<string | void>) => {
    setError("");
    setNote("");
    try {
      const msg = await fn();
      if (msg) setNote(msg);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const close = (r: AdminRoomSummary) =>
    window.confirm(`Close room ${r.code}? Everyone in it will be sent back to the start.`) &&
    run(async () => {
      await api(`/rooms/${r.code}/close`, token, { method: "POST" });
      return `Closed ${r.code}.`;
    });

  const saveIdle = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api("/settings", token, { method: "PUT", body: { roomIdleMinutes: Number(idle) } });
      return "Saved. Rooms idle longer than that are closed automatically.";
    });
  };

  const open = (b: BoardSummary, copy: boolean) =>
    run(async () => {
      const { board } = await api<{ board: Board }>(`/boards/${b.id}`, token);
      setEditing(copy ? { board: { ...board, id: "", title: `${board.title} (copy)` }, id: null } : { board, id: board.id });
    });
  const remove = (b: BoardSummary) =>
    window.confirm(`Delete the board "${b.title}"? Games already in progress keep their copy.`) &&
    run(async () => {
      await api(`/boards/${b.id}`, token, { method: "DELETE" });
      return `Deleted "${b.title}".`;
    });
  const setDefault = (id: string) =>
    run(async () => {
      await api("/settings", token, { method: "PUT", body: { defaultBoardId: id } });
      return "Saved. New rooms start on that board (the host can still change it).";
    });

  const { min, max } = ADMIN_SETTINGS_LIMITS.roomIdleMinutes;
  const skew = data ? data.serverTime - Date.now() : 0;
  const defaultId = data ? (data.boards.some((b) => b.id === data.settings.defaultBoardId) ? data.settings.defaultBoardId : (data.boards[0]?.id ?? "")) : "";

  if (editing) {
    return (
      <BoardEditor
        initial={editing.board}
        saving={async (board) => {
          const saved = await api<{ board: Board }>(editing.id ? `/boards/${editing.id}` : "/boards", token, { method: editing.id ? "PUT" : "POST", body: board });
          setEditing(null);
          setNote(`Saved "${saved.board.title}".`);
          await load();
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <>
      {error && <p className="error">{error}</p>}
      {note && <p className="note">{note}</p>}

      <section className="panel">
        <div className="admin-row">
          <h2>
            Boards <span className="muted">({data?.boards.length ?? "…"})</span>
          </h2>
          <button className="btn btn-primary" onClick={() => setEditing({ board: null, id: null })}>
            New board
          </button>
        </div>
        <p className="muted small">
          A board is one or two rounds of categories and clues, plus an optional Last Call. Write your own, or import a JSON or CSV file from the editor.
          The samples can't be changed, but you can copy one and edit the copy.
        </p>
        {data && (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Board</th>
                  <th>Size</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.boards.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.title}</strong>
                      {b.sample && <span className="tag" style={{ marginLeft: "0.5rem" }}>Sample</span>}
                      {b.id === defaultId && <div className="muted small">New rooms start on this board</div>}
                    </td>
                    <td className="muted">
                      {b.rounds === 1 ? "1 round" : `${b.rounds} rounds`}, {b.clues} clues
                      {b.lastCall ? ", Last Call" : ""}
                    </td>
                    <td className="admin-actions">
                      {b.id !== defaultId && (
                        <button className="btn btn-small btn-ghost" onClick={() => setDefault(b.id)}>
                          Use for new rooms
                        </button>
                      )}
                      {!b.sample && (
                        <button className="btn btn-small btn-secondary" onClick={() => open(b, false)}>
                          Edit
                        </button>
                      )}
                      <button className="btn btn-small btn-ghost" onClick={() => open(b, true)}>
                        {b.sample ? "Copy and edit" : "Copy"}
                      </button>
                      {!b.sample && (
                        <button className="btn btn-small btn-danger" onClick={() => remove(b)}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="admin-row">
          <h2>
            Rooms <span className="muted">({data?.rooms.length ?? "…"})</span>
          </h2>
          <button className="btn btn-small btn-ghost" onClick={load}>
            Refresh
          </button>
        </div>
        {data && data.rooms.length === 0 && <p className="muted">No open rooms.</p>}
        {data && data.rooms.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Status</th>
                  <th>People</th>
                  <th>Last activity</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.rooms.map((r) => (
                  <tr key={r.code}>
                    <td className="admin-code">{r.code}</td>
                    <td>
                      {phaseText(r)}
                      <div className="muted small">
                        {r.boardTitle}
                        {r.kind === "venue" ? " · venue room" : ""}
                      </div>
                    </td>
                    <td>
                      <span className={`dot ${r.hostConnected ? "on" : ""}`} /> host
                      <div className="muted small">
                        {r.playersConnected}/{r.players} players online
                        {r.tables > 0 && ` · ${r.tables} screen${r.tables === 1 ? "" : "s"}`}
                      </div>
                    </td>
                    <td>
                      {ago(Date.now() + skew - r.lastActivityAt)}
                      <div className="muted small">opened {ago(Date.now() + skew - r.createdAt)}</div>
                    </td>
                    <td className="admin-actions">
                      <button className="btn btn-small btn-danger" onClick={() => close(r)}>
                        Close
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Auto-close idle rooms</h2>
        <form className="admin-form" onSubmit={saveIdle}>
          <label>
            Close a room automatically after this many minutes with no activity
            <input type="number" min={min} max={max} value={idle} onChange={(e) => setIdle(e.target.value)} />
          </label>
          <button className="btn btn-primary" disabled={!data || Number(idle) === data.settings.roomIdleMinutes}>
            Save
          </button>
        </form>
        <p className="muted small">
          Between {min} minutes and {max / 1440} days. A room the venue put on a TV stays open while that TV shows it.
        </p>
      </section>

      <button className="btn btn-ghost" onClick={onSignOut}>
        Sign out
      </button>
    </>
  );
}

function phaseText(r: AdminRoomSummary): string {
  switch (r.phase) {
    case "lobby":
      return "Waiting to start";
    case "lastCall":
      return "Last Call";
    case "final":
      return "Finished";
    case "roundEnd":
      return `End of round ${r.round}`;
    default:
      return `Round ${r.round}`;
  }
}
