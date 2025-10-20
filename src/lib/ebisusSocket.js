// src/lib/ebisusSocket.js
import { io } from "socket.io-client";

let socket;

export function getEbisuSocket() {
  if (socket) return socket;

  // through your Vite proxy (vite.config has /ebisus -> https://api.ebisusbay.com)
  socket = io(window.location.origin, {
    path: "/ebisus/socket.io",
    transports: ["polling", "websocket"],
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelay: 1500,
    timeout: 10000,
  });

  // very loud debug so we SEE the lifecycle
  socket.on("connect", () => {
    console.debug("[ebisus] connected", socket.id,
      "transport:", socket.io.engine?.transport?.name);
  });
  socket.io.engine?.on?.("upgrade", (t) => {
    console.debug("[ebisus] upgraded transport →", t.name);
  });
  socket.on("disconnect", (r) => console.debug("[ebisus] disconnected:", r));
  socket.on("connect_error", (e) =>
    console.warn("[ebisus] connect_error:", e?.message || e)
  );
  socket.onAny((event, ...args) => {
    console.debug("[ebisus] event:", event, args?.[0]);
  });

  return socket;
}
