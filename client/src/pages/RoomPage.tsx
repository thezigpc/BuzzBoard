import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useRoomConnection } from "@bargames/gamekit/client";
import { isOnBox, markSharedScreen, tableMode, type TableModeController } from "@bargames/sdk/client";
import type { JoinResult, RoomView } from "@buzzboard/shared";
import { call, socket } from "../socket";
import { clearSession, loadSession, saveSession, sessions, type StoredSession } from "../session";
import { useVenue } from "../useVenue";
import { roundLabel } from "../components/bits";
import { HostView } from "./HostView";
import { PlayerView } from "./PlayerView";
import { TableView } from "./TableView";

/** Runs a server intent, surfacing a rejection as a short-lived toast. */
export function useAction() {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  const act = useCallback(async <T = object,>(event: Parameters<typeof call>[0], ...args: unknown[]) => {
    try {
      return await call<T>(event, ...args);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Something went wrong.");
      return null;
    }
  }, []);
  return { act, toast, setToast };
}
export type Act = ReturnType<typeof useAction>["act"];

/**
 * /room/CODE. A device with a seat in the room resumes it. /room/CODE?role=table is the
 * TV link (what a Bar Games box casts): it joins as a screen by itself, with no prompt
 * and nothing to tap. Anyone else is sent to the join form.
 */
export function RoomPage() {
  const { code = "" } = useParams();
  const [search] = useSearchParams();
  const upper = code.toUpperCase();
  const tvLink = search.get("role") === "table";
  const [seated, setSeated] = useState(() => loadSession()?.roomCode === upper);
  const [error, setError] = useState("");
  const venue = useVenue();
  const onBox = isOnBox(venue);

  // A TV from its first paint: staff announcements meant for phones never flash on it.
  useEffect(() => (tvLink && onBox ? markSharedScreen() : undefined), [tvLink, onBox]);

  const joining = useRef(false);
  useEffect(() => {
    if (seated || !tvLink || joining.current) return;
    joining.current = true;
    let tries = 0;
    const join = () =>
      call<JoinResult>("joinRoom", { code: upper, role: "table" })
        .then((r) => {
          saveSession({ roomCode: r.code, token: r.token, name: r.name, role: r.role });
          setSeated(true);
        })
        .catch((err: Error) => {
          // A TV can't be tapped: keep trying through a server restart, then say why.
          if (++tries < 4 && !/doesn't exist|full/i.test(err.message)) setTimeout(join, 1500);
          else setError(err.message);
        });
    join();
  }, [seated, tvLink, upper]);

  if (!seated) {
    if (!tvLink) return <Navigate to={`/join/${upper}`} replace />;
    return (
      <main className="center-page">
        {error ? (
          <div className="panel">
            <h2>Room {upper}</h2>
            <p>{error}</p>
          </div>
        ) : (
          <p className="muted">Connecting to room {upper}…</p>
        )}
      </main>
    );
  }
  return <Room code={upper} />;
}

function Room({ code }: { code: string }) {
  const navigate = useNavigate();
  // The kit's room connection: re-sends `resume` on EVERY socket connect, because
  // socket.io's automatic reconnect gives the server a brand-new socket with no seat.
  const { view, status, closedReason, skew, reconnect } = useRoomConnection<RoomView, StoredSession>(code, {
    socket: socket as unknown as Parameters<typeof useRoomConnection>[1]["socket"],
    call,
    sessions,
    // A host link's key resumes the host seat once; from then on this phone keeps the
    // seat's own token (a take-over changes the key but leaves it seated as a co-host).
    resumeArgs: (s) => ({ code: s.roomCode, token: s.token, host: s.hostLink === true }),
    onResumed: (ack, s) => {
      const r = ack as Partial<JoinResult>;
      sessions.save({
        roomCode: s.roomCode,
        token: typeof r.token === "string" ? r.token : s.token,
        name: typeof r.name === "string" ? r.name : s.name,
        role: r.role ?? s.role,
      });
    },
  });
  const { act, toast, setToast } = useAction();

  // One-off messages for this phone: staff took over hosting, or a co-host plays again.
  useEffect(() => {
    const onNotice = (p: { message: string }) => setToast(p.message);
    socket.on("notice", onNotice);
    return () => {
      socket.off("notice", onNotice);
    };
  }, [setToast]);

  // A TV on a Bar Games box: the SDK's tableMode hides the pointer, keeps the screen
  // awake, sets safe margins (--bg-safe-x/y) and shows the standard "Reconnecting…" /
  // "Room closed" banner. Off a box nothing changes.
  const venue = useVenue();
  const role = view?.you.role ?? loadSession()?.role;
  const isTv = role === "table";
  const boxTv = isOnBox(venue) && isTv;
  const tm = useRef<TableModeController | null>(null);
  useEffect(() => {
    if (!boxTv) return;
    tm.current = tableMode(venue);
    return () => {
      tm.current?.stop();
      tm.current = null;
    };
    // The venue context refreshes now and then; tableMode only needs it once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxTv]);
  useEffect(() => {
    tm.current?.setState(closedReason ? "closed" : status === "offline" ? "reconnecting" : "connected", closedReason ?? undefined);
  }, [boxTv, status, closedReason]);

  if (closedReason) {
    return (
      <main className="center-page">
        <div className="panel">
          {/* An old host link or an expired seat: the room may well be open, just not to this link. */}
          <h2>{/expired|not in this room/i.test(closedReason) ? "Can't get you in" : "Room closed"}</h2>
          <p>{closedReason}</p>
          {!isTv && (
            <Link className="btn btn-primary" to="/">
              Back to the start
            </Link>
          )}
        </div>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="center-page">
        <p className="muted">Connecting to room {code}…</p>
      </main>
    );
  }

  const leave = async () => {
    // Only the host's ✕ ends the room; a co-host leaves it.
    const msg = view.you.role === "host" ? "End this room for everyone?" : "Leave this room?";
    if (!window.confirm(msg)) return;
    await call("leaveRoom").catch(() => {});
    clearSession();
    navigate("/");
  };

  return (
    <div className={`room role-${view.you.role}`}>
      {status !== "online" && !boxTv && (
        <div className={`banner ${isTv ? "banner-float" : ""}`} role="status">
          {status === "offline" ? "Connection lost. Reconnecting…" : "Connecting…"}
        </div>
      )}
      {!isTv && (
        <header className="room-header">
          <div className="room-id">
            <span className="room-code">{view.code}</span>
            <span className="muted">
              {view.you.role === "host" ? "Host" : view.you.name}
              {view.you.role === "cohost" && <span className="badge">Co-host</span>}
              {roundLabel(view) && ` · ${roundLabel(view)}`}
            </span>
          </div>
          <div className="header-actions">
            <button className="icon-btn" onClick={reconnect} title="Reconnect" aria-label="Reconnect">
              ⟳
            </button>
            <button className="icon-btn" onClick={leave} title={view.you.role === "host" ? "End room" : "Leave"} aria-label={view.you.role === "host" ? "End room" : "Leave"}>
              ✕
            </button>
          </div>
        </header>
      )}
      {(view.you.role === "host" || view.you.role === "cohost") && <HostView view={view} skew={skew} act={act} />}
      {view.you.role === "player" && <PlayerView view={view} skew={skew} act={act} online={status === "online"} />}
      {isTv && <TableView view={view} skew={skew} />}
      {toast && (
        <div className="toast" role="alert" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  );
}
