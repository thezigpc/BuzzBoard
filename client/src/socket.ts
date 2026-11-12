import { io, type Socket } from "socket.io-client";
import { createCall, serverBase, serverOrigin, socketPath, SOCKET_OPTIONS } from "@bargames/gamekit/client";
import type { ClientToServerEvents, ServerToClientEvents } from "@buzzboard/shared";

// In dev, Vite serves the client on :5177 while the server runs on :3007. In production
// the server serves the built client itself, so both share one origin.
//
// Under a path prefix (a Bar Games box's https://<venue>/buzzboard/, or BASE_PATH behind
// your own proxy) the server injects the prefix into index.html. `serverUrl` carries it,
// so every fetch is `${serverUrl}/api/...`; socket.io takes the bare origin plus a `path`
// (a URL's path would be read as a namespace).
const dev = { vitePort: 5177, serverPort: 3007, override: import.meta.env.VITE_SERVER_URL as string | undefined };
export const serverUrl = serverBase(dev);

// WebSocket first (the kit's SOCKET_OPTIONS), long-polling only as a fallback. The
// server refuses a buzz that arrives over polling, so `canBuzz()` tells the player.
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(serverOrigin(dev), {
  ...SOCKET_OPTIONS,
  path: socketPath(),
});

/** True once the connection is a WebSocket (it starts as one, or upgrades from polling). */
export const canBuzz = (): boolean => socket.connected && socket.io.engine?.transport?.name === "websocket";

const kitCall = createCall(socket as unknown as Parameters<typeof createCall>[0]);

/** Emit with an ack as a promise. Rejects with the server's error message. */
export function call<T = object>(event: keyof ClientToServerEvents, ...args: unknown[]): Promise<T> {
  return kitCall<T>(event, ...args);
}

const slowKitCall = kitCall.withTimeout(30_000);

/** The same, with 30 s to answer: casting to venue TVs can take a while. */
export function slowCall<T = object>(event: keyof ClientToServerEvents, ...args: unknown[]): Promise<T> {
  return slowKitCall<T>(event, ...args);
}
