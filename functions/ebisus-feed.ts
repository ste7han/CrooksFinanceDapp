// functions/ebisus-feed.ts
import { io } from "socket.io-client";

export const onRequestGet: PagesFunction = async (ctx) => {
  const url = new URL(ctx.request.url);
  const addr = (url.searchParams.get("addr") || "").toLowerCase();

  if (!addr) {
    return new Response("addr query param required\n", { status: 400 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const write = (s: string) => controller.enqueue(new TextEncoder().encode(s));
      const send = (event: string, data: unknown) => {
        write(`event: ${event}\n`);
        write(`data: ${JSON.stringify(data)}\n\n`);
      };

      send("hello", { ok: true });

      // connect to EbisuBay WebSocket (Socket.IO)
      const socket = io("wss://api.ebisusbay.com", {
        transports: ["websocket"],
        reconnection: true,
      });

      socket.on("connect", () => {
        console.log("[ebisus-feed] connected");
        send("status", { connected: true });
      });

      socket.on("disconnect", () => {
        console.log("[ebisus-feed] disconnected");
        send("status", { connected: false });
      });

      // EbisuBay emits these events:
      const events = ["Listed", "Sold", "Cancelled", "OfferMade", "OfferUpdated", "OfferAccepted"];

      for (const ev of events) {
        socket.on(ev, (payload: any) => {
          const nftAddr = (payload?.nft?.nftAddress || payload?.nftAddress || "").toLowerCase();
          if (nftAddr === addr) {
            send(ev.toLowerCase(), payload);
          }
        });
      }

      // Ping keepalive (so CF doesn’t close the stream)
      const ping = setInterval(() => send("ping", { t: Date.now() }), 15000);

      // Handle client disconnect
      ctx.request.signal.addEventListener("abort", () => {
        clearInterval(ping);
        try { socket.close(); } catch {}
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "connection": "keep-alive",
      "access-control-allow-origin": "*",
    },
  });
};
