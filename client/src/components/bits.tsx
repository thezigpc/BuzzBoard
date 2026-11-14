import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { CSSProperties } from "react";
import { JoinAddress } from "@bargames/gamekit/client";
import { joinDisplay, type VenueContext } from "@bargames/sdk/client";
import type { ContestantView, GridView, RoomView } from "@buzzboard/shared";

/** Points as text: 1,200 or −300 (a real minus sign, so it reads from across the room). */
export const pts = (n: number): string => (n < 0 ? `−${Math.abs(n).toLocaleString("en-US")}` : n.toLocaleString("en-US"));

export const contestant = (view: RoomView, id: string | null | undefined): ContestantView | undefined =>
  id ? view.contestants.find((c) => c.id === id) : undefined;

export const nameOf = (view: RoomView, id: string | null | undefined): string => contestant(view, id)?.name ?? "";

/** Highest score first; join order on a tie. */
export const standings = (view: RoomView): ContestantView[] =>
  view.contestants.map((c, i) => ({ c, i })).sort((a, b) => b.c.score - a.c.score || a.i - b.i).map((x) => x.c);

/** Re-renders a few times a second while `active`, for countdowns. */
export function useNow(active: boolean, everyMs = 100): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs]);
  return now;
}

/** A draining bar and the seconds left until `deadline` (server time; `skew` = server − local). */
export function TimerBar({ deadline, totalSeconds, skew }: { deadline: number | null; totalSeconds: number; skew: number }) {
  const now = useNow(deadline !== null);
  if (deadline === null) return null;
  const left = Math.max(0, deadline - (now + skew));
  const pct = Math.min(100, (left / (totalSeconds * 1000)) * 100);
  return (
    <div className="timer" role="timer" aria-label={`${Math.ceil(left / 1000)} seconds left`}>
      <div className="timer-fill" style={{ width: `${pct}%` }} />
      <span className="timer-num">{Math.ceil(left / 1000)}</span>
    </div>
  );
}

export function QrCode({ text, size = 160 }: { text: string; size?: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(text, { margin: 1, width: size * 2 })
      .then(setSrc)
      .catch(() => setSrc(""));
  }, [text, size]);
  return src ? <img className="qr" src={src} width={size} height={size} alt={`QR code for ${text}`} /> : null;
}

/**
 * How to join a room. `url` is for the QR code: on a Bar Games box it's on the venue's
 * public address (which a TV opened on an internal address wouldn't know), path prefix
 * included; standalone it's this page's own origin. `shown` is what to print under it:
 * the box's short room link ("play.example.net/AB12", box 0.15.6+) when there is one,
 * else the game's address ("play.example.net/buzzboard"), next to the room code.
 */
export function joinInfo(code: string, venue: VenueContext | null = null): { url: string; shown: string; roomLink: boolean } {
  const d = joinDisplay(venue, `/join/${code}`, code);
  return { url: d.url, shown: d.roomShort ?? d.short, roomLink: !!d.roomShort };
}

/** A link without its scheme, for reading off a screen. */
export const shortUrl = (url: string): string => url.replace(/^https?:\/\//, "");

/**
 * "Join at <address>", from the kit: breaks after "." and "/", shrinks a long address and
 * never overflows its box (a venue address has no spaces to wrap at). The box's width and
 * the smallest size (`--join-min-size`) are the caller's CSS. On the TV (`tv`) it wraps onto
 * a second line before it shrinks, and shrinks less.
 */
export function Address({
  shown,
  label = "Join at",
  tv = false,
  align,
  style,
}: {
  shown: string;
  label?: string;
  tv?: boolean;
  align?: "center" | "start";
  style?: CSSProperties;
}) {
  return <JoinAddress url={shown} label={label} align={align} style={style} {...(tv ? { minScale: 0.8, lines: 2 } : {})} />;
}

/** The board: a column per category, a row per point value. `onPick` makes open squares buttons. */
export function BoardGrid({
  grid,
  onPick,
  active,
}: {
  grid: GridView;
  onPick?: (cat: number, row: number) => void;
  active?: { cat: number; row: number } | null;
}) {
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${grid.categories.length}, minmax(0, 1fr))` }}>
      {grid.categories.map((name, cat) => (
        <div className="grid-cat" key={`c${cat}`} style={{ gridColumn: cat + 1, gridRow: 1 }}>
          <span>{name}</span>
        </div>
      ))}
      {grid.cells.map((col, cat) =>
        col.map((cell, row) => {
          const style = { gridColumn: cat + 1, gridRow: row + 2 };
          const on = active?.cat === cat && active.row === row;
          const cls = `grid-cell ${cell} ${on ? "active" : ""}`;
          const label = cell === "open" || on ? pts(grid.values[row]) : "";
          return onPick && cell === "open" ? (
            <button key={`${cat}:${row}`} className={cls} style={style} onClick={() => onPick(cat, row)} aria-label={`${name(grid, cat)} for ${grid.values[row]}`}>
              {label}
            </button>
          ) : (
            <div key={`${cat}:${row}`} className={cls} style={style}>
              {label}
            </div>
          );
        }),
      )}
    </div>
  );
}
const name = (grid: GridView, cat: number) => grid.categories[cat];

/** Scores, highest first. `max` cuts the list (the TV's strip) and says how many more there are. */
export function Scores({ view, max, mine }: { view: RoomView; max?: number; mine?: string | null }) {
  const all = standings(view);
  const shown = max ? all.slice(0, max) : all;
  return (
    <ol className="scores">
      {shown.map((c) => (
        <li
          key={c.id}
          className={`score ${c.id === mine ? "mine" : ""} ${c.id === view.pickerId && (view.phase === "board" || view.phase === "clue") ? "picker" : ""} ${c.connected ? "" : "away"} ${c.score < 0 ? "neg" : ""}`}
        >
          <span className="score-name">{c.name}</span>
          <span className="score-pts">{pts(c.score)}</span>
        </li>
      ))}
      {max !== undefined && all.length > shown.length && <li className="score more">+{all.length - shown.length} more</li>}
    </ol>
  );
}

/** "Round 1 of 2", "Last Call", or nothing in the lobby. */
export function roundLabel(view: RoomView): string {
  if (view.phase === "lobby") return "";
  if (view.phase === "lastCall") return "Last Call";
  if (view.phase === "final") return "Final scores";
  return view.roundCount > 1 ? `Round ${view.round} of ${view.roundCount}` : "Round 1";
}

/** What comes after this round: the host's button and the TV's caption use the same words. */
export function nextUp(view: RoomView): string {
  if (view.round < view.roundCount) return `Round ${view.round + 1}`;
  return view.hasLastCall && view.contestants.length > 0 ? "Last Call" : "Final scores";
}
