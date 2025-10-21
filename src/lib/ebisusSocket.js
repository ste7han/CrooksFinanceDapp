// src/lib/ebisusSocket.js
import { io } from "socket.io-client";

let socket;

export function getEbisuSocket() {
  if (socket) return socket;

  // connect directly to Ebisu's public Socket.IO endpoint
  socket = io("https://api.ebisusbay.com", {
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelay: 1500,
    timeout: 10000,
  });

  // helpful debug output
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

if (typeof window !== "undefined") window.getEbisuSocket = getEbisuSocket;
